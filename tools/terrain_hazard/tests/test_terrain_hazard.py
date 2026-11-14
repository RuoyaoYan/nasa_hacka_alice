"""Run: python3 -m pytest terrain_hazard/tests -q"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import make_synthetic  # noqa: E402
import rover_rocks  # noqa: E402
import terrain_hazard  # noqa: E402
from geotiff import Raster, read_elevation, write_geotiff  # noqa: E402
from hazards import CRATER, NODATA, ROCK, SLOPE, Params, build_cost_matrix, coverage_fraction, grid_for, slope_deg  # noqa: E402


@pytest.fixture(scope="session")
def scene(tmp_path_factory):
    d = tmp_path_factory.mktemp("syn")
    make_synthetic.main(str(d))
    return d, json.loads((d / "truth.json").read_text())


@pytest.fixture(scope="session")
def run(scene, tmp_path_factory):
    d, truth = scene
    out = tmp_path_factory.mktemp("out")
    rc = terrain_hazard.main(["--dem", str(d / "dem.tif"), "--image", str(d / "ortho.tif"),
                              "--cell", "1", "--sun-azimuth", "270", "--out", str(out)])
    assert rc == 0
    return out, truth


def cell_of(truth, x, y, cell=1.0):
    return int((truth["y0"] - y) // cell), int((x - truth["x0"]) // cell)


# ---------------------------------------------------------------- output contract

def test_outputs_are_a_binary_grid_with_matching_files(run):
    out, _ = run
    doc = json.loads((out / "cost_matrix.json").read_text())
    grid = np.array(doc["grid"])
    assert grid.shape == (doc["height"], doc["width"]) == (300, 300)
    assert set(np.unique(grid)) <= {0, 1}
    assert np.array_equal(grid, np.load(out / "cost_matrix.npy"))
    csv_rows = (out / "cost_matrix.csv").read_text().strip().splitlines()
    assert len(csv_rows) == 300 and csv_rows[0].count(",") == 299
    reasons = np.array(doc["reasons"])
    assert np.array_equal(grid == 1, reasons > 0)
    assert (out / "hazard_overlay.png").stat().st_size > 10_000
    cost_tif = read_elevation(out / "cost_matrix.tif")
    assert np.array_equal(cost_tif.data.astype(int), grid)


# ---------------------------------------------------------------- detectors vs truth

def test_slope_blocks_the_scarp(scene, run):
    d, _ = scene
    out, _ = run
    truth = np.load(d / "slope_truth.npy") > 20
    pred = (np.load(out / "reasons.npy") & SLOPE) > 0
    iou = (truth & pred).sum() / (truth | pred).sum()
    assert iou > 0.85, iou


def test_hazardous_craters_found_and_shallow_bowl_left_walkable(run):
    out, truth = run
    dets = [x for x in json.loads((out / "detections.json").read_text())["detections"] if x["kind"] == "crater"]
    reasons = np.load(out / "reasons.npy")
    for c in truth["craters"]:
        match = [x for x in dets if math.hypot(x["x"] - c["x"], x["y"] - c["y"]) < 0.3 * c["diameter_m"]]
        center_flag = reasons[cell_of(truth, c["x"], c["y"])] & CRATER
        if c["hazard"]:
            assert match, f"missed crater D={c['diameter_m']}"
            assert abs(match[0]["diameter_m"] - c["diameter_m"]) < 0.25 * c["diameter_m"]
            assert center_flag
        else:
            assert not match and not center_flag, "shallow eroded bowl should stay walkable"


def test_rocks_are_blocked_and_decoys_are_not(run):
    out, truth = run
    reasons = np.load(out / "reasons.npy")
    flagged = [r for r in truth["rocks"] if reasons[cell_of(truth, r["x"], r["y"])] & ROCK]
    assert len(flagged) / len(truth["rocks"]) >= 0.85
    rocks = [x for x in json.loads((out / "detections.json").read_text())["detections"] if x["kind"] == "rock"]
    false = [x for x in rocks if not any(math.hypot(x["x"] - r["x"], x["y"] - r["y"]) < max(2.0, r["diameter_m"] + 1)
                                         for r in truth["rocks"])]
    assert len(false) / len(rocks) <= 0.15
    decoy_hits = sum(any(math.hypot(x["x"] - q["x"], x["y"] - q["y"]) < 2 for x in rocks) for q in truth["decoys"])
    assert decoy_hits <= 2


def test_missing_elevation_is_blocked_not_flat(run):
    out, truth = run
    reasons = np.load(out / "reasons.npy")
    box = truth["nodata_box_m"]
    inner = reasons[box["south_min"] + 2: box["south_max"] - 2, 0: box["east_max"] - 2]
    assert inner.size and np.all(inner & NODATA)


# ---------------------------------------------------------------- units and geometry

def test_slope_of_a_known_plane():
    for deg in (5, 20, 35):
        n = 50
        x = np.arange(n) * 2.0
        z = np.tile(x * math.tan(math.radians(deg)), (n, 1)).astype(np.float32)
        s = slope_deg(Raster(z, 0, 100, 2.0, 2.0))
        assert abs(float(np.nanmedian(s)) - deg) < 0.2


def test_one_hazard_pixel_blocks_its_cell():
    r = Raster(np.zeros((40, 40), np.float32), 0.0, 10.0, 0.25, 0.25)
    m = np.zeros((40, 40), bool)
    m[13, 22] = True  # map x = 5.625, y = 6.625 -> 1 m cell (row 3, col 5)
    g = grid_for(r.bounds, 1.0)
    frac = coverage_fraction(r, m, g)
    assert (frac > 0).sum() == 1 and frac[3, 5] > 0


def test_coarse_source_on_fine_grid():
    r = Raster(np.zeros((10, 10), np.float32), 0.0, 10.0, 1.0, 1.0)
    m = np.zeros((10, 10), bool)
    m[2, 7] = True
    g = grid_for(r.bounds, 0.5)
    frac = coverage_fraction(r, m, g)
    assert frac[4:6, 14:16].min() > 0 and (frac > 0).sum() == 4


def test_cell_size_changes_grid_shape(scene, tmp_path):
    d, _ = scene
    assert terrain_hazard.main(["--dem", str(d / "dem.tif"), "--cell", "2", "--out", str(tmp_path)]) == 0
    doc = json.loads((tmp_path / "cost_matrix.json").read_text())
    assert (doc["width"], doc["height"]) == (150, 150)
    assert doc["inputs"]["image"] is None


def test_latlon_crop_reads_only_the_requested_area(scene, tmp_path):
    d, truth = scene
    r = 3396190.0
    # center of the big crater, 100 x 60 m window
    c = truth["craters"][0]
    lat, lon = math.degrees(c["y"] / r), math.degrees(c["x"] / r)
    assert terrain_hazard.main(["--dem", str(d / "dem.tif"), "--image", str(d / "ortho.tif"),
                                "--center-latlon", f"{lat}", f"{lon}", "--size", "100", "60",
                                "--out", str(tmp_path)]) == 0
    doc = json.loads((tmp_path / "cost_matrix.json").read_text())
    assert (doc["width"], doc["height"]) == (100, 60)
    grid = np.array(doc["reasons"])
    assert grid[30, 50] & CRATER  # the crater is at the center of the window


def test_local_frame_matches_the_game_convention(scene, tmp_path):
    d, truth = scene
    c = truth["craters"][0]  # put the "habitat" 50 m west and 30 m north of the big crater
    ox, oy = c["x"] - 50, c["y"] + 30
    assert terrain_hazard.main(["--dem", str(d / "dem.tif"), "--origin", f"{ox}", f"{oy}",
                                "--out", str(tmp_path)]) == 0
    doc = json.loads((tmp_path / "cost_matrix.json").read_text())
    lf = doc["localFrame"]
    x, z = 50.0, 30.0  # crater centre in game coords: 50 m east (+X), 30 m south (+Z)
    col = math.floor((x - lf["westX"]) / lf["cellSizeM"])
    row = math.floor((z - lf["northZ"]) / lf["cellSizeM"])
    assert doc["reasons"][row][col] & CRATER
    assert "localFrame" in doc and json.loads((tmp_path / "cost_matrix.json").read_text())["grid"][row][col] == 1


def test_plain_heightmap_needs_pixel_size(tmp_path):
    z = np.zeros((30, 30), np.float32)
    z[:, 15:] = np.arange(15) * 1.0  # 45 deg ramp
    np.save(tmp_path / "h.npy", z)
    assert terrain_hazard.main(["--dem", str(tmp_path / "h.npy"), "--out", str(tmp_path / "o")]) == 1
    assert terrain_hazard.main(["--dem", str(tmp_path / "h.npy"), "--pixel-size", "1",
                                "--out", str(tmp_path / "o")]) == 0
    cost = np.load(tmp_path / "o" / "cost_matrix.npy")
    assert cost[:, 17:28].all() and not cost[:, 3:12].any()


def test_windowed_geotiff_read_matches_full_read(tmp_path):
    a = np.random.default_rng(0).normal(size=(600, 500)).astype(np.float32)
    write_geotiff(tmp_path / "t.tif", Raster(a, 100.0, 900.0, 1.0, 1.0))
    w = read_elevation(tmp_path / "t.tif", bbox=(250.0, 400.0, 330.0, 470.0))
    assert np.array_equal(w.data, a[430:500, 150:230])
    assert (w.x0, w.y0) == (250.0, 470.0)


def test_params_file_and_unknown_keys(scene, tmp_path):
    d, _ = scene
    (tmp_path / "p.json").write_text(json.dumps({"max_slope_deg": 10}))
    assert terrain_hazard.main(["--dem", str(d / "dem.tif"), "--params", str(tmp_path / "p.json"),
                                "--out", str(tmp_path / "o")]) == 0
    doc = json.loads((tmp_path / "o" / "cost_matrix.json").read_text())
    assert doc["params"]["max_slope_deg"] == 10
    (tmp_path / "bad.json").write_text(json.dumps({"max_slop": 10}))
    assert terrain_hazard.main(["--dem", str(d / "dem.tif"), "--params", str(tmp_path / "bad.json"),
                                "--out", str(tmp_path / "o2")]) == 1


def test_build_cost_matrix_rejects_non_overlapping_inputs():
    dem = Raster(np.zeros((10, 10), np.float32), 0, 10, 1, 1)
    img = Raster(np.zeros((10, 10), np.float32), 1000, 10, 1, 1)
    with pytest.raises(ValueError, match="do not overlap"):
        build_cost_matrix(dem, img, 1.0, Params())


# ---------------------------------------------------------------- rover photos

@pytest.mark.parametrize("seed", [3, 4, 5])
def test_rover_photo_rocks(seed):
    img, truth, horizon = make_synthetic.rover_scene(seed)
    rocks, mask, h = rover_rocks.detect(img)
    assert abs(h - horizon) < 20
    inbox = lambda t, r: (r["bbox"][0] - 3 <= t["x"] <= r["bbox"][0] + r["bbox"][2] + 3  # noqa: E731
                          and r["bbox"][1] - 3 <= t["y"] <= r["bbox"][1] + r["bbox"][3] + 3)
    hit = [t for t in truth if any(inbox(t, r) for r in rocks)]
    false = [r for r in rocks if not any(inbox(t, r) for t in truth)]
    assert len(hit) / len(truth) >= 0.85
    assert len(false) <= 3
    assert not mask[: horizon - 5].any()
