#!/usr/bin/env python3
"""Make a synthetic test scene with known hazards: a 1 m DEM and a 0.25 m orthoimage
(the resolutions of HiRISE DTMs/orthos), placed at Jezero-like map coordinates.

    python3 make_synthetic.py out_dir/

Writes dem.tif, ortho.tif and truth.json. Not Mars data: for testing the detectors only.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geotiff import Raster, write_geotiff  # noqa: E402

R_MARS = 3396190.0
SIZE_M = 300.0
DEM_PX = 1.0
IMG_PX = 0.25
SUN_AZ = 270.0  # light from the west
SUN_EL = 35.0
NODATA_DEM = -3.4028226550889045e38


def scene(seed: int = 7):
    rng = np.random.default_rng(seed)
    # Map coordinates: equirectangular (lat_ts 0, lon0 0) near 18.44 N, 77.45 E
    x0 = round(R_MARS * math.radians(77.45))
    y0 = round(R_MARS * math.radians(18.44))

    n = int(SIZE_M / DEM_PX)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    E = (xx + 0.5) * DEM_PX            # meters east of the west edge
    S = (yy + 0.5) * DEM_PX            # meters south of the north edge

    # gentle regional tilt (~2 deg) + smooth undulation
    z = 0.035 * E - 0.01 * S
    low = cv2.GaussianBlur(rng.normal(0, 1, (n, n)).astype(np.float32), (0, 0), 18)
    z += low / np.abs(low).max() * 1.2

    # steep scarp across the north-east: 12 m rise over ~14 m (about 40 deg)
    d = (E - 190) * 0.8 - (S - 60) * 0.6  # signed distance from a NE-trending line
    z += 12 / (1 + np.exp(-d / 3.5))

    craters = [  # east, south, diameter, depth below surroundings, hazardous?, rim height / D
        (80, 220, 40, 7.0, True, 0.04),
        (205, 165, 16, 2.4, True, 0.04),
        (245, 245, 9, 1.6, True, 0.04),
        (120, 110, 30, 0.35, False, 0.008),  # old shallow, eroded bowl: walkable
    ]
    for cx, cy, D, depth, _, rim_f in craters:
        R = D / 2
        r = np.hypot(E - cx, S - cy)
        rim = rim_f * D
        inside = -depth + (depth + rim) * (r / R) ** 2
        outside = rim * np.exp(-((r - R) / (0.35 * R)) ** 2)
        z += np.where(r <= R, inside, outside)
    z_clean = z.copy()

    # big boulders that show in the 1 m DEM
    boulders = [(150, 240, 4.0, 2.0), (60, 60, 3.5, 1.6), (260, 120, 4.5, 2.2)]
    rocks = []
    for bx, by, bd, bh in boulders:
        rocks.append((bx, by, bd, bh))
    # rock field + scattered rocks (image only unless big)
    for _ in range(45):
        rocks.append((rng.uniform(140, 200), rng.uniform(190, 235), rng.uniform(0.9, 2.5), 0.0))
    for _ in range(25):
        rocks.append((rng.uniform(15, 285), rng.uniform(15, 285), rng.uniform(0.9, 2.2), 0.0))
    # drop rocks that land inside craters, on the scarp, or overlap each other
    keep = []
    for rx, ry, rd, rh in rocks:
        if any(math.hypot(rx - cx, ry - cy) < D / 2 + 4 for cx, cy, D, _, h, _r in craters):
            continue
        if abs((rx - 190) * 0.8 - (ry - 60) * 0.6) < 18:
            continue
        if rx < 25 and 120 < ry < 170:  # nodata strip
            continue
        if any(math.hypot(rx - kx, ry - ky) < (rd + kd) / 2 + 2.5 for kx, ky, kd, _ in keep):
            continue
        keep.append((rx, ry, rd, rh if rh else rd * rng.uniform(0.4, 0.7)))
    rocks = keep

    for rx, ry, rd, rh in rocks[:len(boulders)]:
        r = np.hypot(E - rx, S - ry)
        z += rh * np.exp(-(r / (rd / 2.2)) ** 4)
    z += rng.normal(0, 0.08, z.shape)  # DTM noise

    nodata = (E < 22) & (S > 120) & (S < 170)
    dem = z.astype(np.float32)
    dem[nodata] = NODATA_DEM

    # ---------------- orthoimage at 0.25 m
    m = int(SIZE_M / IMG_PX)
    zf = cv2.resize(z.astype(np.float32), (m, m), interpolation=cv2.INTER_CUBIC)
    fy, fx = np.mgrid[0:m, 0:m].astype(np.float32)
    Ef, Sf = (fx + 0.5) * IMG_PX, (fy + 0.5) * IMG_PX
    for rx, ry, rd, rh in rocks[len(boulders):]:
        r = np.hypot(Ef - rx, Sf - ry)
        zf += (rh * np.sqrt(np.clip(1 - (r / (rd / 2)) ** 2, 0, 1))).astype(np.float32)
    gx = cv2.Sobel(zf, cv2.CV_32F, 1, 0, ksize=3) / (8 * IMG_PX)
    gy = cv2.Sobel(zf, cv2.CV_32F, 0, 1, ksize=3) / (8 * IMG_PX)  # +south
    az, el = math.radians(SUN_AZ), math.radians(SUN_EL)
    sun = np.array([math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)])  # east, north, up
    nx, ny, nz = -gx, gy, np.ones_like(gx)  # normal in (east, north, up); north gradient = -gy
    norm = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    shade = np.clip((nx * sun[0] + ny * sun[1] + nz * sun[2]) / norm, 0, 1)
    albedo = 0.8 + 0.12 * cv2.resize(cv2.GaussianBlur(rng.normal(0, 1, (60, 60)).astype(np.float32), (0, 0), 3),
                                     (m, m)) / 1.0
    img = albedo * (0.25 + 0.75 * shade) + rng.normal(0, 0.012, (m, m))
    # cast shadows of rocks on the side away from the sun
    shadow = np.zeros((m, m), np.uint8)
    to_sun = np.array([math.sin(az), -math.cos(az)])  # (col, row)
    for rx, ry, rd, rh in rocks:
        L = rh / math.tan(el)
        c = np.array([rx, ry]) / IMG_PX - 0.5
        tip = c - to_sun * (L + rd / 2) / IMG_PX
        mid = (c + tip) / 2
        cv2.ellipse(shadow, (int(mid[0]), int(mid[1])),
                    (max(1, int(np.linalg.norm(tip - c) / 2)), max(1, int(rd / 2 / IMG_PX * 0.9))),
                    math.degrees(math.atan2(-to_sun[1], -to_sun[0])), 0, 360, 1, -1)
    img[shadow > 0] *= 0.45
    # a dark sand patch (large, elongated) and small dark spots with no lit side: must NOT be rocks
    sand = np.zeros((m, m), np.uint8)
    cv2.ellipse(sand, (int(95 / IMG_PX), int(40 / IMG_PX)),
                (int(30 / IMG_PX), int(5 / IMG_PX)), 20, 0, 360, 1, -1)
    img[sand > 0] *= 0.6
    decoys = []
    for _ in range(12):
        dx_, dy_ = rng.uniform(20, 280), rng.uniform(20, 280)
        if any(math.hypot(dx_ - rx, dy_ - ry) < 6 for rx, ry, _, _ in rocks):
            continue
        cv2.circle(img, (int(dx_ / IMG_PX), int(dy_ / IMG_PX)), 3, float(np.median(img) * 0.5), -1)
        decoys.append((dx_, dy_))
    img8 = np.clip(img / np.percentile(img, 99.8) * 235, 1, 255).astype(np.uint8)
    img_nodata = cv2.resize(nodata.astype(np.uint8), (m, m), interpolation=cv2.INTER_NEAREST) > 0
    img8[img_nodata] = 0

    # truth slope mask from the noise-free surface (no rocks)
    zc = z_clean.astype(np.float32)
    tgx = cv2.Sobel(zc, cv2.CV_32F, 1, 0, ksize=3) / 8
    tgy = cv2.Sobel(zc, cv2.CV_32F, 0, 1, ksize=3) / 8
    slope_true = np.degrees(np.arctan(np.hypot(tgx, tgy)))

    to_map = lambda e, s: (x0 + e, y0 - s)  # noqa: E731
    truth = {
        "note": "SYNTHETIC test scene. Positions in map meters (same frame as the GeoTIFFs).",
        "sizeM": SIZE_M, "sunAzimuthDeg": SUN_AZ, "sunElevationDeg": SUN_EL,
        "x0": x0, "y0": y0,
        "craters": [{"x": to_map(cx, cy)[0], "y": to_map(cx, cy)[1], "diameter_m": D, "depth_m": dp,
                     "hazard": h} for cx, cy, D, dp, h, _r in craters],
        "rocks": [{"x": to_map(rx, ry)[0], "y": to_map(rx, ry)[1], "diameter_m": round(rd, 2),
                   "height_m": round(rh, 2), "in_dem": i < len(boulders)} for i, (rx, ry, rd, rh) in enumerate(rocks)],
        "decoys": [{"x": to_map(a, b)[0], "y": to_map(a, b)[1]} for a, b in decoys],
        "nodata_box_m": {"east_max": 22, "south_min": 120, "south_max": 170},
    }
    return (Raster(dem, x0, y0, DEM_PX, DEM_PX, "synthetic dem"),
            Raster(img8, x0, y0, IMG_PX, IMG_PX, "synthetic ortho"), truth, slope_true)


def main(out: str):
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    dem, img, truth, slope_true = scene()
    write_geotiff(out_dir / "dem.tif", dem, nodata=NODATA_DEM)
    write_geotiff(out_dir / "ortho.tif", img, nodata=0)
    np.save(out_dir / "slope_truth.npy", slope_true)
    (out_dir / "truth.json").write_text(json.dumps(truth, indent=1))
    print(f"wrote {out_dir}/dem.tif, ortho.tif, truth.json ({len(truth['rocks'])} rocks, "
          f"{len(truth['craters'])} craters)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "synthetic")


def rover_scene(seed: int = 3, W: int = 1024, H: int = 768, horizon: int = 230):
    """A rover-like perspective photo: smooth sky, textured ground, rocks that shrink toward the
    horizon, each with a lit top and a shadow at its base. Returns (BGR image, list of truth boxes)."""
    rng = np.random.default_rng(seed)
    img = np.zeros((H, W), np.float32)
    sky = np.linspace(185, 160, horizon)[:, None]
    img[:horizon] = sky
    tex = rng.normal(0, 1, (H, W)).astype(np.float32)
    for r in range(horizon, H):  # texture gets finer toward the horizon
        d = (r - horizon) / (H - horizon)
        img[r] = 120 + 18 * d
    img[horizon:] += cv2.GaussianBlur(tex, (0, 0), 1.2)[horizon:] * 9
    img[horizon:] += cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 25)[horizon:] * 60
    truth = []
    for _ in range(40):
        y = int(rng.uniform(horizon + 25, H - 30))
        d = (y - horizon) / (H - horizon)
        rx = int(rng.uniform(8, 38) * (0.25 + d))
        ry = max(3, int(rx * rng.uniform(0.45, 0.7)))
        x = int(rng.uniform(rx + 5, W - rx - 5))
        if any(abs(x - tx) < rx + tw and abs(y - ty) < ry + th for tx, ty, tw, th in truth):
            continue
        cv2.ellipse(img, (x + rx // 3, y + ry // 2), (int(rx * 1.1), max(2, ry // 2)), 0, 0, 360, 55, -1)  # shadow
        cv2.ellipse(img, (x, y), (rx, ry), 0, 0, 360, 95, -1)  # body
        cv2.ellipse(img, (x - rx // 4, y - ry // 3), (max(2, rx // 2), max(2, ry // 2)), 0, 0, 360, 185, -1)  # lit
        truth.append((x, y, rx, ry))
    img = np.clip(img + rng.normal(0, 2, img.shape), 0, 255).astype(np.uint8)
    return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR), [{"x": x, "y": y, "rx": rx, "ry": ry} for x, y, rx, ry in truth], horizon
