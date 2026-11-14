"""Read a window of a (possibly huge, tiled, compressed) GeoTIFF without loading the whole file.

Only north-up rasters (no rotation) are supported, which covers USGS/HiRISE map products.
Map coordinates are in the file's projected units (meters for Mars equirectangular products).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace
from pathlib import Path

import logging

import numpy as np
import tifffile

# tifffile warns when it cannot cast GDAL_NODATA to the pixel type; we parse that tag ourselves.
logging.getLogger("tifffile").setLevel(logging.ERROR)

TAG_PIXEL_SCALE = 33550
TAG_TIEPOINT = 33922
TAG_GEOKEYS = 34735
TAG_NODATA = 42113
GEOKEY_RASTER_TYPE = 1025  # 1 = PixelIsArea, 2 = PixelIsPoint


@dataclass
class Raster:
    """A north-up raster. (x0, y0) is the map position of the top-left corner of pixel (0, 0)."""

    data: np.ndarray  # float32 for elevation (NaN = no data); uint8/float for images
    x0: float
    y0: float
    dx: float  # pixel width in map units (> 0)
    dy: float  # pixel height in map units (> 0, rows go toward -y)
    source: str = ""

    @property
    def height(self) -> int:
        return self.data.shape[0]

    @property
    def width(self) -> int:
        return self.data.shape[1]

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        """(west, south, east, north) of the outer pixel edges."""
        return (self.x0, self.y0 - self.height * self.dy, self.x0 + self.width * self.dx, self.y0)

    def pixel_of(self, x, y):
        """Fractional (col, row) of map coordinates; integer + 0.5 is a pixel center."""
        return (np.asarray(x) - self.x0) / self.dx, (self.y0 - np.asarray(y)) / self.dy

    def center_of(self, col, row):
        return self.x0 + (np.asarray(col) + 0.5) * self.dx, self.y0 - (np.asarray(row) + 0.5) * self.dy


def _georef(page) -> tuple[float, float, float, float, float | None]:
    tags = page.tags
    if TAG_PIXEL_SCALE not in tags or TAG_TIEPOINT not in tags:
        raise ValueError("TIFF has no GeoTIFF pixel-scale/tiepoint tags; pass --pixel-size for plain images")
    sx, sy = tags[TAG_PIXEL_SCALE].value[:2]
    tp = tags[TAG_TIEPOINT].value
    i, j, X, Y = tp[0], tp[1], tp[3], tp[4]
    x0, y0 = X - i * sx, Y + j * sy
    if TAG_GEOKEYS in tags:
        keys = tags[TAG_GEOKEYS].value
        for k in range(4, len(keys), 4):
            if keys[k] == GEOKEY_RASTER_TYPE and keys[k + 3] == 2:  # PixelIsPoint: tiepoint at pixel center
                x0, y0 = x0 - sx / 2, y0 + sy / 2
    nodata = None
    if TAG_NODATA in tags:
        try:
            nodata = float(str(tags[TAG_NODATA].value).strip().strip("\x00"))
        except ValueError:
            nodata = None
    return float(x0), float(y0), float(sx), float(sy), nodata


def _read_window(tif: tifffile.TiffFile, page, c0: int, r0: int, w: int, h: int) -> np.ndarray:
    """Decode only the tiles/strips that intersect the window."""
    H, W = page.shape[:2]
    if page.is_tiled:
        th, tw = page.tilelength, page.tilewidth
    else:
        th, tw = page.rowsperstrip or H, W
    across = math.ceil(W / tw)
    spp = page.samplesperpixel
    out = np.zeros((h, w) if spp == 1 else (h, w, spp), dtype=page.dtype)
    if page.planarconfig != 1 and spp > 1:
        raise ValueError("planar-separate multi-band TIFFs are not supported; convert with gdal_translate first")
    fh = tif.filehandle
    for ty in range(r0 // th, (r0 + h - 1) // th + 1):
        for tx in range(c0 // tw, (c0 + w - 1) // tw + 1):
            idx = ty * across + tx
            fh.seek(page.dataoffsets[idx])
            raw = fh.read(page.databytecounts[idx])
            seg = page.decode(raw, idx)[0]
            if seg is None:
                raise ValueError(f"could not decode TIFF segment (compression {page.compression!r}); "
                                 "try `pip install imagecodecs`")
            seg = np.asarray(seg).reshape(-1, tw, spp)[:th] if page.is_tiled else np.asarray(seg).reshape(-1, W, spp)
            ys, xs = ty * th, tx * tw
            a0, a1 = max(r0, ys), min(r0 + h, ys + seg.shape[0], H)
            b0, b1 = max(c0, xs), min(c0 + w, xs + seg.shape[1], W)
            if a1 <= a0 or b1 <= b0:
                continue
            block = seg[a0 - ys:a1 - ys, b0 - xs:b1 - xs]
            out[a0 - r0:a1 - r0, b0 - c0:b1 - c0] = block[..., 0] if spp == 1 else block
    return out


def read_geotiff(path: str | Path, bbox: tuple[float, float, float, float] | None = None,
                 window: tuple[int, int, int, int] | None = None, band: int | None = None) -> tuple[Raster, float | None]:
    """Read a GeoTIFF, optionally only `bbox` = (west, south, east, north) in map units
    or `window` = (col, row, width, height) in pixels. Returns (raster, nodata value)."""
    path = Path(path)
    with tifffile.TiffFile(path) as tif:
        page = tif.pages[0]
        x0, y0, dx, dy, nodata = _georef(page)
        H, W = page.shape[:2]
        if bbox is not None:
            west, south, east, north = bbox
            c0 = int(math.floor((west - x0) / dx))
            r0 = int(math.floor((y0 - north) / dy))
            c1 = int(math.ceil((east - x0) / dx))
            r1 = int(math.ceil((y0 - south) / dy))
            window = (c0, r0, c1 - c0, r1 - r0)
        if window is None:
            window = (0, 0, W, H)
        c0, r0, w, h = window
        c0, r0 = max(c0, 0), max(r0, 0)
        w, h = min(w, W - c0), min(h, H - r0)
        if w <= 0 or h <= 0:
            raise ValueError(f"{path.name}: requested area is outside the raster "
                             f"(raster bounds {x0:.1f}, {y0 - H * dy:.1f}, {x0 + W * dx:.1f}, {y0:.1f})")
        data = _read_window(tif, page, c0, r0, w, h)
    if data.ndim == 3 and band is not None:
        data = data[..., band]
    r = Raster(data, x0 + c0 * dx, y0 - r0 * dy, dx, dy, source=path.name)
    return r, nodata


def read_elevation(path: str | Path, bbox=None, window=None, pixel_size: float | None = None,
                   z_scale: float = 1.0, z_offset: float = 0.0) -> Raster:
    """Elevation in meters, float32, NaN where there is no data.

    GeoTIFF: georeferenced. .npy / .png / .tif without geotags: needs pixel_size (m); PNG values
    are multiplied by z_scale and offset by z_offset (e.g. 16-bit heightmaps)."""
    path = Path(path)
    nodata = None
    if path.suffix.lower() in (".tif", ".tiff"):
        try:
            r, nodata = read_geotiff(path, bbox=bbox, window=window, band=0)
        except ValueError as e:
            if "no GeoTIFF" not in str(e) or pixel_size is None:
                raise
            r = Raster(tifffile.imread(path), 0.0, 0.0, pixel_size, pixel_size, path.name)
    else:
        if pixel_size is None:
            raise ValueError(f"{path.name} has no georeferencing; pass --pixel-size (meters per pixel)")
        if path.suffix.lower() == ".npy":
            arr = np.load(path)
        else:
            import cv2

            arr = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
            if arr is None:
                raise ValueError(f"could not read {path}")
            if arr.ndim == 3:
                arr = arr[..., 0]
        r = Raster(arr, 0.0, float(arr.shape[0]) * pixel_size, pixel_size, pixel_size, path.name)
        if window is not None:
            c0, r0, w, h = window
            r = replace(r, data=r.data[r0:r0 + h, c0:c0 + w], x0=r.x0 + c0 * r.dx, y0=r.y0 - r0 * r.dy)
    z = r.data.astype(np.float32) * np.float32(z_scale) + np.float32(z_offset)
    bad = ~np.isfinite(z) | (z < -1e30) | (z > 1e30)
    if nodata is not None:
        bad |= r.data == np.asarray(nodata, dtype=r.data.dtype)
    z[bad] = np.nan
    return replace(r, data=z)


def read_image(path: str | Path, bbox=None, window=None) -> Raster:
    """Grayscale orthoimage as float32 (NaN = no data, i.e. nodata value or 0 in 8-bit HiRISE products)."""
    r, nodata = read_geotiff(path, bbox=bbox, window=window)
    a = r.data
    if a.ndim == 3:  # RGB(A) -> luminance
        a = a[..., :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    a = a.astype(np.float32)
    bad = ~np.isfinite(a)
    if nodata is not None:
        bad |= r.data[..., 0] == nodata if r.data.ndim == 3 else r.data == nodata
    a[bad] = np.nan
    return replace(r, data=a)


def write_geotiff(path: str | Path, raster: Raster, nodata: float | None = None, compression: str | None = "zlib",
                  tile: tuple[int, int] | None = (256, 256)) -> None:
    """Write a GeoTIFF with pixel-scale/tiepoint tags (no CRS keys beyond raster type)."""
    extratags = [
        (TAG_PIXEL_SCALE, 12, 3, (raster.dx, raster.dy, 0.0), False),
        (TAG_TIEPOINT, 12, 6, (0.0, 0.0, 0.0, raster.x0, raster.y0, 0.0), False),
        (TAG_GEOKEYS, 3, 8, (1, 1, 0, 1, GEOKEY_RASTER_TYPE, 0, 1, 1), False),
    ]
    if nodata is not None:
        text = str(int(nodata)) if np.issubdtype(raster.data.dtype, np.integer) else repr(float(nodata))
        extratags.append((TAG_NODATA, 2, 0, text, False))
    data = raster.data
    if tile and (data.shape[0] < tile[0] or data.shape[1] < tile[1]):
        tile = None
    tifffile.imwrite(path, data, compression=compression, tile=tile, extratags=extratags,
                     photometric="minisblack")
