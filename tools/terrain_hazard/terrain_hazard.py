#!/usr/bin/env python3
"""Terrain hazard grid: NASA DEM + orbital orthoimage -> 2D cost matrix (0 = walkable, 1 = blocked).

Detects steep slopes (DEM), craters (DEM depressions, confirmed Hough circles in the image),
rocks (sunlit/shadow pairs in the image, boulders in the DEM) and treats missing elevation as blocked.

Examples
  # Jezero (Perseverance) USGS mosaics, 200 x 200 m around a lat/lon, 1 m cells
  python3 terrain_hazard.py --dem JEZ_..._DTM_..._1m_....tif --image JEZ_..._orthoMosaic_25cm_....tif \\
      --center-latlon 18.4447 77.4508 --size 200 200 --cell 1 --sun-azimuth 270 --out out/

  # Any GeoTIFF DEM alone, whole file, 2 m cells, stricter slope limit
  python3 terrain_hazard.py --dem dem.tif --cell 2 --max-slope 15 --out out/

  # Plain heightmap (PNG/NPY) with known pixel size
  python3 terrain_hazard.py --dem height.npy --pixel-size 1.0 --out out/

Outputs in --out: cost_matrix.json (grid + reasons + georef), cost_matrix.csv, cost_matrix.npy,
reasons.npy, detections.json, hazard_overlay.png, cost_matrix.tif.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from dataclasses import asdict, fields
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geotiff import Raster, read_elevation, read_image, write_geotiff  # noqa: E402
from hazards import CRATER, NODATA, REASONS, ROCK, SLOPE, Params, Result, build_cost_matrix  # noqa: E402

COLORS = {NODATA: (90, 90, 90), SLOPE: (0, 190, 255), CRATER: (220, 60, 200), ROCK: (30, 30, 255)}  # BGR


def eqc_xy(lat: float, lon: float, radius: float, lon0: float, lat_ts: float) -> tuple[float, float]:
    dlon = (lon - lon0 + 180) % 360 - 180
    return radius * math.radians(dlon) * math.cos(math.radians(lat_ts)), radius * math.radians(lat)


def eqc_latlon(x: float, y: float, radius: float, lon0: float, lat_ts: float) -> tuple[float, float]:
    return math.degrees(y / radius), (lon0 + math.degrees(x / (radius * math.cos(math.radians(lat_ts))))) % 360


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    io = ap.add_argument_group("inputs")
    io.add_argument("--dem", help="elevation: GeoTIFF (meters), or .npy/.png with --pixel-size")
    io.add_argument("--image", help="orthoimage GeoTIFF in the same map projection as the DEM")
    io.add_argument("--pixel-size", type=float, help="meters per pixel for DEMs without georeferencing")
    io.add_argument("--z-scale", type=float, default=1.0, help="multiply raw DEM values (e.g. 16-bit PNG)")
    io.add_argument("--z-offset", type=float, default=0.0)
    area = ap.add_argument_group("area (default: whole DEM)")
    area.add_argument("--bbox", type=float, nargs=4, metavar=("WEST", "SOUTH", "EAST", "NORTH"),
                      help="map coordinates (projection units)")
    area.add_argument("--center", type=float, nargs=2, metavar=("X", "Y"), help="map coordinates of the center")
    area.add_argument("--center-latlon", type=float, nargs=2, metavar=("LAT", "LON"),
                      help="planetocentric lat, east lon; assumes an equirectangular file (see --eqc-*)")
    area.add_argument("--size", type=float, nargs=2, metavar=("W_M", "H_M"), default=(200, 200),
                      help="area size in meters with --center/--center-latlon (default 200 200)")
    area.add_argument("--eqc-radius", type=float, default=3396190.0, help="sphere radius of the projection (m)")
    area.add_argument("--eqc-lon0", type=float, default=0.0, help="central meridian of the projection")
    area.add_argument("--eqc-lat-ts", type=float, default=0.0, help="latitude of true scale")
    frame = ap.add_argument_group("game frame (src/config/mission.js: metres, +X east, -Z north, habitat at 0,0)")
    frame.add_argument("--origin-latlon", type=float, nargs=2, metavar=("LAT", "LON"),
                       help="habitat position; adds a localFrame block to cost_matrix.json")
    frame.add_argument("--origin", type=float, nargs=2, metavar=("X", "Y"), help="habitat in map coordinates")
    out = ap.add_argument_group("output")
    out.add_argument("--cell", type=float, default=1.0, help="output cell size in meters (default 1)")
    out.add_argument("--out", default="out", help="output folder")
    out.add_argument("--params", help="JSON file with detector parameters (names as in hazards.Params)")
    tune = ap.add_argument_group("common detector settings (override --params)")
    tune.add_argument("--max-slope", type=float, help="degrees; steeper is blocked (default 20)")
    tune.add_argument("--crater-min-depth", type=float, help="meters (default 1.0)")
    tune.add_argument("--rock-min-diameter", type=float, help="meters (default 0.75)")
    tune.add_argument("--rock-clearance", type=float, help="keep-out buffer around rocks in meters (default 0.5)")
    tune.add_argument("--sun-azimuth", type=float, help="degrees clockwise from north the light comes FROM")
    tune.add_argument("--sun-elevation", type=float, help="degrees above horizon; enables rock height filter")
    tune.add_argument("--block-fraction", type=float, help="block a cell when more than this fraction is hazardous (default 0 = any)")
    tune.add_argument("--no-hough", action="store_true", help="skip image-based crater circles")
    return ap.parse_args(argv)


def make_params(a) -> Params:
    p = Params()
    if a.params:
        cfg = json.loads(Path(a.params).read_text())
        names = {f.name for f in fields(Params)}
        unknown = set(cfg) - names
        if unknown:
            raise ValueError(f"unknown parameters in {a.params}: {sorted(unknown)}")
        for k, v in cfg.items():
            setattr(p, k, v)
    for arg, name in [("max_slope", "max_slope_deg"), ("crater_min_depth", "crater_min_depth_m"),
                      ("rock_min_diameter", "rock_min_diameter_m"), ("rock_clearance", "rock_clearance_m"),
                      ("sun_azimuth", "sun_azimuth_deg"), ("sun_elevation", "sun_elevation_deg"),
                      ("block_fraction", "block_fraction")]:
        v = getattr(a, arg)
        if v is not None:
            setattr(p, name, v)
    if a.no_hough:
        p.hough_craters = False
    return p


def area_bbox(a):
    if a.bbox:
        return tuple(a.bbox)
    if a.center or a.center_latlon:
        if a.center_latlon:
            cx, cy = eqc_xy(*a.center_latlon, a.eqc_radius, a.eqc_lon0, a.eqc_lat_ts)
        else:
            cx, cy = a.center
        w, h = a.size
        return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    return None


# ------------------------------------------------------------------ outputs

def background(res: Result, dem: Raster | None, img: Raster | None, scale: int) -> np.ndarray:
    g = res.grid
    W, H = g.width * scale, g.height * scale
    xs = g.x0 + (np.arange(W) + 0.5) * g.cell / scale
    ys = g.y0 - (np.arange(H) + 0.5) * g.cell / scale
    X, Y = np.meshgrid(xs, ys)
    src = img if img is not None else None
    if src is not None:
        c, r = src.pixel_of(X, Y)
        a = np.nan_to_num(src.data, nan=0).astype(np.float32)
        out = cv2.remap(a, (c - 0.5).astype(np.float32), (r - 0.5).astype(np.float32), cv2.INTER_LINEAR)
        lo, hi = np.percentile(out, [1, 99.5])
    else:
        z = np.nan_to_num(dem.data, nan=float(np.nanmedian(dem.data))).astype(np.float32)
        gx = cv2.Sobel(z, cv2.CV_32F, 1, 0) / (8 * dem.dx)
        gy = cv2.Sobel(z, cv2.CV_32F, 0, 1) / (8 * dem.dy)
        shade = np.clip((gx * -0.5 + gy * -0.5 + 1) / np.sqrt(1 + gx ** 2 + gy ** 2), 0, 1)
        c, r = dem.pixel_of(X, Y)
        out = cv2.remap(shade, (c - 0.5).astype(np.float32), (r - 0.5).astype(np.float32), cv2.INTER_LINEAR)
        lo, hi = 0.0, 1.0
    u8 = np.clip((out - lo) / max(hi - lo, 1e-6) * 255, 0, 255).astype(np.uint8)
    return cv2.cvtColor(u8, cv2.COLOR_GRAY2BGR)


def overlay_png(res: Result, dem: Raster | None, img: Raster | None, path: Path) -> None:
    g = res.grid
    scale = max(1, min(8, int(700 / max(g.width, g.height))))
    bg = background(res, dem, img, scale)
    over = bg.copy()
    for bit in (NODATA, SLOPE, CRATER, ROCK):  # later wins
        m = np.kron((res.reasons & bit) > 0, np.ones((scale, scale), bool))
        over[m] = COLORS[bit]
    right = cv2.addWeighted(over, 0.55, bg, 0.45, 0)
    if scale >= 5:
        for i in range(0, right.shape[1], scale):
            right[:, i] = (right[:, i] * 0.8).astype(np.uint8)
        for j in range(0, right.shape[0], scale):
            right[j, :] = (right[j, :] * 0.8).astype(np.uint8)
    for d in res.detections:
        cx = int((d.x - g.x0) / g.cell * scale)
        cy = int((g.y0 - d.y) / g.cell * scale)
        rad = max(2, int(d.diameter_m / 2 / g.cell * scale))
        cv2.circle(right, (cx, cy), rad, (255, 255, 255) if d.kind == "crater" else (0, 255, 255), 1, cv2.LINE_AA)
    H, W = bg.shape[:2]
    legend_h = 70
    canvas = np.full((H + legend_h, 2 * W + 10, 3), 24, np.uint8)
    canvas[:H, :W] = bg
    canvas[:H, W + 10:] = right
    f = cv2.FONT_HERSHEY_SIMPLEX
    x = 10
    for bit in (SLOPE, CRATER, ROCK, NODATA):
        cv2.rectangle(canvas, (x, H + 15), (x + 18, H + 33), COLORS[bit], -1)
        label = f"{REASONS[bit]} ({res.stats['byReason'][REASONS[bit]]})"
        cv2.putText(canvas, label, (x + 24, H + 30), f, 0.5, (235, 235, 235), 1, cv2.LINE_AA)
        x += 34 + cv2.getTextSize(label, f, 0.5, 1)[0][0]
    s = res.stats
    cv2.putText(canvas, f"{g.width} x {g.height} cells @ {g.cell:g} m   blocked {s['blocked']} "
                        f"({s['blockedFraction'] * 100:.1f}%)   craters {s['craters']}  rocks {s['rocks']}   north up",
                (10, H + 58), f, 0.5, (200, 200, 200), 1, cv2.LINE_AA)
    cv2.imwrite(str(path), canvas)


def local_frame(g, a) -> dict | None:
    """Where the grid sits in the game's frame: metres from the habitat, +X east, -Z north."""
    if a.origin_latlon:
        ox, oy = eqc_xy(*a.origin_latlon, a.eqc_radius, a.eqc_lon0, a.eqc_lat_ts)
    elif a.origin:
        ox, oy = a.origin
    else:
        return None
    return {
        "convention": "metres from the habitat; +X east, -Z north (as in src/config/mission.js)",
        "originMap": {"x": ox, "y": oy},
        "westX": round(g.x0 - ox, 3),
        "northZ": round(-(g.y0 - oy), 3),
        "cellSizeM": g.cell,
        "lookup": "col = floor((x - westX) / cellSizeM); row = floor((z - northZ) / cellSizeM); blocked = grid[row][col] === 1",
    }


def write_outputs(res: Result, dem, img, a, p: Params, out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    g = res.grid
    np.save(out / "cost_matrix.npy", res.cost)
    np.save(out / "reasons.npy", res.reasons)
    with open(out / "cost_matrix.csv", "w", newline="") as fh:
        csv.writer(fh).writerows(res.cost.tolist())
    write_geotiff(out / "cost_matrix.tif", Raster(res.cost, g.x0, g.y0, g.cell, g.cell), compression=None, tile=None)
    nw = eqc_latlon(g.x0, g.y0, a.eqc_radius, a.eqc_lon0, a.eqc_lat_ts)
    se = eqc_latlon(g.x0 + g.width * g.cell, g.y0 - g.height * g.cell, a.eqc_radius, a.eqc_lon0, a.eqc_lat_ts)
    doc = {
        "format": "terrain-hazard-grid/1",
        "legend": {"0": "walkable", "1": "blocked"},
        "width": g.width,
        "height": g.height,
        "cellSizeM": g.cell,
        "layout": "grid[row][col]; row 0 is the north edge, col 0 the west edge; north up",
        "georef": {
            "westM": g.x0, "northM": g.y0,
            "eastM": g.x0 + g.width * g.cell, "southM": g.y0 - g.height * g.cell,
            "projectionNote": "map coordinates of the input files",
            "latLonIfEquirectangular": {"north": round(nw[0], 6), "west": round(nw[1], 6),
                                        "south": round(se[0], 6), "east": round(se[1], 6),
                                        "assumes": f"sphere R={a.eqc_radius:g} m, lon0={a.eqc_lon0:g}, lat_ts={a.eqc_lat_ts:g}"},
        },
        "localFrame": local_frame(g, a),
        "grid": res.cost.tolist(),
        "reasonBits": {str(b): n for b, n in REASONS.items()},
        "reasons": res.reasons.tolist(),
        "stats": res.stats,
        "params": asdict(p),
        "inputs": {
            "dem": {"file": dem.source, "pixelM": dem.dx} if dem is not None else None,
            "image": {"file": img.source, "pixelM": img.dx} if img is not None else None,
        },
    }
    (out / "cost_matrix.json").write_text(json.dumps(doc, separators=(",", ":")))
    (out / "detections.json").write_text(json.dumps({
        "detections": [d.to_json() for d in res.detections],
        "unconfirmedCraterCandidates": [d.to_json() for d in res.unconfirmed],
    }, indent=1))
    overlay_png(res, dem, img, out / "hazard_overlay.png")
    return doc


def main(argv=None) -> int:
    a = parse_args(argv)
    if not a.dem and not a.image:
        print("error: give --dem, --image, or both", file=sys.stderr)
        return 1
    try:
        p = make_params(a)
        bbox = area_bbox(a)
        dem = read_elevation(a.dem, bbox=bbox, pixel_size=a.pixel_size, z_scale=a.z_scale,
                             z_offset=a.z_offset) if a.dem else None
        img = None
        if a.image:
            ib = bbox if bbox else (dem.bounds if dem is not None else None)
            img = read_image(a.image, bbox=ib)
        if dem is not None and np.isnan(dem.data).all():
            raise ValueError("the selected area has no elevation data")
        res = build_cost_matrix(dem, img, a.cell, p)
        write_outputs(res, dem, img, a, p, Path(a.out))
    except (ValueError, FileNotFoundError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    s = res.stats
    print(f"{res.grid.width} x {res.grid.height} cells at {a.cell:g} m: {s['blocked']} blocked "
          f"({s['blockedFraction'] * 100:.1f} %) - " + ", ".join(f"{k} {v}" for k, v in s["byReason"].items()))
    print(f"craters {s['craters']}, rocks {s['rocks']}; outputs in {a.out}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
