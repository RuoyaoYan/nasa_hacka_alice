#!/usr/bin/env python3
"""Turn the CRISM mineral map of Jezero into a map overlay for Momoot.

Source: "Map of the dominant mineralogy over and around the Mars2020 landing
ellipse", built from MRO CRISM observations HRL000040FF, FRT000047A3,
FRT0005C5E and FRS00031442 (Parente et al. 2021, UMass). Zenodo DOI
10.5281/zenodo.5575824, licence CC BY 4.0.

    python3 tools/crism/make_crism_overlay.py            # downloads from Zenodo
    python3 tools/crism/make_crism_overlay.py --tif jezeroFinal.tif --legend jezeroEM.png

Writes data/crism_jezero.png (null pixels transparent), data/crism_jezero.json
(latitude/longitude bounds and credits) and data/crism_legend.png (the
dataset's own colour key). Needs only Pillow (and numpy).
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ZENODO = "https://zenodo.org/records/5575824/files/"
SOURCE = ("CRISM mineral map of Jezero (MRO CRISM HRL000040FF, FRT000047A3, FRT0005C5E, FRS00031442), "
          "Parente et al. 2021, Zenodo DOI 10.5281/zenodo.5575824, CC BY 4.0")
MARS_R = 3396190.0  # IAU 2000 Mars sphere used by USGS Mars 2020 map products

TAG_PIXEL_SCALE, TAG_TIEPOINT, TAG_GEOKEYS, TAG_GEODOUBLES = 33550, 33922, 34735, 34736
KEY_MODEL_TYPE, KEY_SEMI_MAJOR = 1024, 2057
KEY_STD_PARALLEL, KEY_NAT_ORIGIN_LON, KEY_CENTER_LON = 3078, 3080, 3088
JEZERO = (18.0, 77.0, 18.9, 77.9)  # south, west, north, east: sanity check


def download(name: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    print(f"Downloading {name} from Zenodo …")
    with urllib.request.urlopen(ZENODO + name + "?download=1", timeout=60) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    return dest


def geokeys(tags) -> dict[int, float]:
    """GeoKeyDirectory as {key: value}; values stored in GeoDoubleParams are resolved."""
    raw = tags.get(TAG_GEOKEYS)
    doubles = tags.get(TAG_GEODOUBLES) or ()
    out: dict[int, float] = {}
    if not raw:
        return out
    raw = list(raw)
    for k in range(int(raw[3])):
        key, loc, count, val = raw[4 + 4 * k: 8 + 4 * k]
        if loc == 0:
            out[key] = val
        elif loc == TAG_GEODOUBLES and val < len(doubles):
            out[key] = doubles[val]
    return out


def bounds_latlon(tags, w: int, h: int, args) -> tuple[float, float, float, float]:
    """(south, west, north, east) in degrees for the whole raster."""
    scale, tie = tags.get(TAG_PIXEL_SCALE), tags.get(TAG_TIEPOINT)
    if not scale or not tie:
        sys.exit("The TIFF has no GeoTIFF georeference. Pass --bounds S W N E.")
    sx, sy = float(scale[0]), float(scale[1])
    i, j, x, y = float(tie[0]), float(tie[1]), float(tie[3]), float(tie[4])
    x0, y0 = x - i * sx, y + j * sy
    x1, y1 = x0 + w * sx, y0 - h * sy
    keys = geokeys(tags)
    geographic = keys.get(KEY_MODEL_TYPE) == 2 or (abs(x0) <= 360 and abs(y0) <= 90 and sx < 1)
    if geographic:
        return y1, x0, y0, x1
    R = args.radius or float(keys.get(KEY_SEMI_MAJOR, MARS_R))
    lon0 = args.lon0 if args.lon0 is not None else float(keys.get(KEY_CENTER_LON, keys.get(KEY_NAT_ORIGIN_LON, 0.0)))
    lat_ts = args.lat_ts if args.lat_ts is not None else float(keys.get(KEY_STD_PARALLEL, 0.0))
    k = R * math.cos(math.radians(lat_ts))
    lon = lambda xm: lon0 + math.degrees(xm / k)
    lat = lambda ym: math.degrees(ym / R)
    print(f"Projected raster: equirectangular, R = {R:.0f} m, centre lon {lon0}°, true scale lat {lat_ts}°")
    return lat(y1), lon(x0), lat(y0), lon(x1)


def to_rgba(im: Image.Image) -> np.ndarray:
    """RGBA array with the dataset's null value (0 / black) made transparent."""
    if im.mode == "P":
        idx = np.array(im)
        rgba = np.array(im.convert("RGBA"))
        rgba[..., 3] = np.where(idx == 0, 0, 255)
        return rgba
    if im.mode in ("L", "I", "I;16", "F"):
        codes = np.array(im).astype(np.int64)
        rng = np.random.default_rng(7)
        pal = rng.integers(40, 255, size=(int(codes.max()) + 1, 3))
        rgba = np.zeros(codes.shape + (4,), np.uint8)
        rgba[..., :3] = pal[codes]
        rgba[..., 3] = np.where(codes == 0, 0, 255)
        print("Single band raster: class codes drawn with stand in colours (no palette in the file).")
        return rgba
    rgba = np.array(im.convert("RGBA"))
    black = (rgba[..., 0] == 0) & (rgba[..., 1] == 0) & (rgba[..., 2] == 0)
    rgba[..., 3] = np.where(black, 0, 255)
    return rgba


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tif", type=Path, help="jezeroFinal.tif (downloaded from Zenodo if left out)")
    ap.add_argument("--legend", type=Path, help="jezeroEM.png, the dataset's colour key (downloaded if left out)")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "data")
    ap.add_argument("--bounds", type=float, nargs=4, metavar=("S", "W", "N", "E"), help="override the georeference")
    ap.add_argument("--radius", type=float, help="sphere radius in metres for projected files")
    ap.add_argument("--lon0", type=float, help="centre longitude for projected files")
    ap.add_argument("--lat-ts", type=float, dest="lat_ts", help="latitude of true scale for projected files")
    args = ap.parse_args()

    work = Path(__file__).resolve().parent / "cache"
    work.mkdir(exist_ok=True)
    tif = args.tif or download("jezeroFinal.tif", work / "jezeroFinal.tif")
    legend = args.legend or download("jezeroEM.png", work / "jezeroEM.png")

    im = Image.open(tif)
    # Pillow returns one-value tags as scalars: make every tag a tuple
    tags = {k: (v if isinstance(v, tuple) else (v,)) for k, v in dict(getattr(im, "tag_v2", {})).items()}
    w, h = im.size
    s, wl, n, e = args.bounds if args.bounds else bounds_latlon(tags, w, h, args)
    rgba = to_rgba(im)

    # crop to the mapped pixels so the overlay stays small
    rows = np.where(rgba[..., 3].any(axis=1))[0]
    cols = np.where(rgba[..., 3].any(axis=0))[0]
    if not len(rows):
        sys.exit("Every pixel is null: nothing to draw.")
    r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    rgba = rgba[r0:r1, c0:c1]
    dlat, dlon = (n - s) / h, (e - wl) / w
    n2, s2 = n - r0 * dlat, n - r1 * dlat
    w2, e2 = wl + c0 * dlon, wl + c1 * dlon

    if not (s2 < JEZERO[2] and n2 > JEZERO[0] and w2 < JEZERO[3] and e2 > JEZERO[1]):
        print(f"Warning: bounds {s2:.4f} {w2:.4f} {n2:.4f} {e2:.4f} do not overlap Jezero. "
              "Check the projection or pass --bounds / --lon0.")

    args.out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.out / "crism_jezero.png", optimize=True)
    shutil.copyfile(legend, args.out / "crism_legend.png")
    meta = {
        "bounds": [[round(s2, 6), round(w2, 6)], [round(n2, 6), round(e2, 6)]],
        "width": int(rgba.shape[1]), "height": int(rgba.shape[0]),
        "mappedPixels": int((rgba[..., 3] > 0).sum()),
        "source": SOURCE,
        "legend": "Colours are the dataset's spectral classes, keyed in crism_legend.png (jezeroEM.png). "
                  "Brighter tones mean a closer match to the class spectrum.",
    }
    (args.out / "crism_jezero.json").write_text(json.dumps(meta, indent=1))
    print(f"Wrote {args.out / 'crism_jezero.png'} ({meta['width']} x {meta['height']} px), bounds "
          f"{s2:.4f}°N {w2:.4f}°E to {n2:.4f}°N {e2:.4f}°E")


if __name__ == "__main__":
    main()
