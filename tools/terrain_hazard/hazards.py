"""Hazard detection on a DEM and a co-registered orthoimage, and aggregation to a 0/1 cost matrix.

Every detector returns a boolean mask on the grid of its input raster, plus a list of detections.
`build_cost_matrix` resamples all masks onto one output grid: a cell is 1 (blocked) when the
fraction of its area covered by any hazard exceeds `block_fraction` (default 0 = any part).
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

import cv2
import numpy as np
from skimage.morphology import reconstruction

from geotiff import Raster

# Reason bits stored alongside the 0/1 grid so the route planner can explain a blocked cell.
SLOPE, CRATER, ROCK, NODATA = 1, 2, 4, 8
REASONS = {SLOPE: "steep slope", CRATER: "crater", ROCK: "rock", NODATA: "no elevation data"}


@dataclass
class Params:
    # slopes
    max_slope_deg: float = 20.0          # steeper than this is blocked for a walking crew
    slope_smooth_m: float = 0.0          # optional Gaussian sigma (m) on the DEM before slope
    # craters (DEM depressions, optionally confirmed circles in the image)
    crater_min_diameter_m: float = 4.0
    crater_max_diameter_m: float = 150.0
    crater_min_depth_m: float = 1.0      # shallower bowls are walkable
    crater_footprint_depth_m: float = 0.15
    crater_min_circularity: float = 0.55
    crater_rim_factor: float = 0.2       # extra blocked ring outside the bowl, as a fraction of D
    hough_craters: bool = True
    # rocks
    rock_min_diameter_m: float = 0.75
    rock_max_diameter_m: float = 6.0
    rock_shadow_z: float = 5.0           # shadow: dark top-hat this many robust std above typical texture
    rock_bright_z: float = 3.0           # sunlit side: bright top-hat threshold
    rock_require_sunlit_side: bool = True
    rock_clearance_m: float = 0.5        # keep-out distance around each rock
    rock_dem_min_height_m: float = 1.0   # boulders tall enough to show in the DEM
    sun_azimuth_deg: float | None = None  # where the light comes FROM, degrees clockwise from map north
    sun_elevation_deg: float | None = None
    rock_min_height_m: float = 0.3       # used only when sun elevation is known
    # aggregation
    block_fraction: float = 0.0


@dataclass
class Detection:
    kind: str            # "crater" | "rock"
    source: str          # "dem" | "image" | "image+dem"
    x: float             # map coordinates of the center
    y: float
    diameter_m: float
    depth_or_height_m: float | None = None
    score: float | None = None
    extra: dict = field(default_factory=dict)

    def to_json(self):
        d = asdict(self)
        return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in d.items() if v is not None}


# --------------------------------------------------------------------------- helpers

def disk(radius_px: float) -> np.ndarray:
    r = max(1, int(math.ceil(radius_px)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def dilate(mask: np.ndarray, radius_px: float) -> np.ndarray:
    if radius_px < 0.5:
        return mask
    return cv2.dilate(mask.astype(np.uint8), disk(radius_px)).astype(bool)


def filled(z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    valid = np.isfinite(z)
    out = z.copy()
    out[~valid] = np.nanmedian(z) if valid.any() else 0.0
    return out.astype(np.float32), valid


def shape_stats(comp: np.ndarray) -> tuple[float, float, float]:
    """(circularity 4piA/P^2, aspect ratio of min-area rectangle, solidity) of a binary blob."""
    cnts, _ = cv2.findContours(comp.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts:
        return 0.0, 99.0, 0.0
    c = max(cnts, key=cv2.contourArea)
    area = float(comp.sum())
    perim = cv2.arcLength(c, True) + math.pi  # half-pixel correction keeps tiny blobs sane
    circ = min(1.0, 4 * math.pi * area / (perim * perim))
    (_, _), (w, h), _ = cv2.minAreaRect(c)
    aspect = max(w, h, 1.0) / max(min(w, h), 1.0)
    hull = cv2.convexHull(c)
    solidity = area / max(cv2.contourArea(hull), area, 1.0)
    return circ, aspect, solidity


# --------------------------------------------------------------------------- slope

def slope_deg(dem: Raster, smooth_m: float = 0.0) -> np.ndarray:
    """Horn's method (3x3 Sobel) in degrees. NaN where the 3x3 window touches missing data."""
    z, valid = filled(dem.data)
    if smooth_m > 0:
        s = smooth_m / dem.dx
        w = cv2.GaussianBlur(valid.astype(np.float32), (0, 0), s)
        z = cv2.GaussianBlur(np.where(valid, z, 0).astype(np.float32), (0, 0), s) / np.maximum(w, 1e-6)
    gx = cv2.Sobel(z, cv2.CV_32F, 1, 0, ksize=3) / (8 * dem.dx)
    gy = cv2.Sobel(z, cv2.CV_32F, 0, 1, ksize=3) / (8 * dem.dy)
    s = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)
    s[dilate(~valid, 1)] = np.nan
    return s


# --------------------------------------------------------------------------- craters

def depression_depth(dem: Raster) -> np.ndarray:
    """Depth (m) of closed depressions: fill-sinks (morphological reconstruction) minus the DEM.
    Missing data and the raster border act as outlets, so nothing is filled across unknown ground."""
    z, valid = filled(dem.data)
    low = float(z.min()) - 1000.0
    z = np.where(valid, z, low).astype(np.float64)
    seed = np.full_like(z, z.max())
    edge = np.zeros_like(valid)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    outlets = edge | ~valid
    seed[outlets] = z[outlets]
    fill = reconstruction(seed, z, method="erosion")
    depth = (fill - z).astype(np.float32)
    depth[~valid] = 0
    return depth


def detect_craters_dem(dem: Raster, p: Params) -> tuple[np.ndarray, list[Detection], np.ndarray]:
    """Returns (hazard mask, detections, depth map)."""
    depth = depression_depth(dem)
    foot = (depth > p.crater_footprint_depth_m).astype(np.uint8)
    n, labels, stats, cent = cv2.connectedComponentsWithStats(foot, connectivity=8)
    mask = np.zeros(foot.shape, bool)
    dets: list[Detection] = []
    px = dem.dx
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        diam = math.sqrt(4 * area / math.pi) * px
        if not (p.crater_min_diameter_m <= diam <= p.crater_max_diameter_m):
            continue
        sl = (slice(y, y + h), slice(x, x + w))
        comp = labels[sl] == i
        dmax = float(depth[sl][comp].max())
        if dmax < p.crater_min_depth_m:
            continue
        circ, aspect, solidity = shape_stats(comp)
        if circ < p.crater_min_circularity or aspect > 2.0:
            continue
        pad = int(math.ceil(p.crater_rim_factor * diam / px)) + 1
        y0, y1 = max(y - pad, 0), min(y + h + pad, mask.shape[0])
        x0, x1 = max(x - pad, 0), min(x + w + pad, mask.shape[1])
        local = labels[y0:y1, x0:x1] == i
        mask[y0:y1, x0:x1] |= dilate(local, p.crater_rim_factor * diam / px)
        cx, cy = dem.center_of(cent[i][0], cent[i][1])
        dets.append(Detection("crater", "dem", float(cx), float(cy), diam, dmax, round(circ, 2)))
    return mask, dets, depth


def detect_craters_image(img: Raster, dem: Raster | None, depth: np.ndarray | None, known: list[Detection],
                         p: Params) -> tuple[list[Detection], list[Detection]]:
    """Circle candidates (Hough) in the image. With a DEM, a candidate counts only if its floor sits
    at least crater_min_depth_m below its rim; otherwise it is reported as unconfirmed."""
    a_full, _ = filled(img.data)
    accepted: list[Detection] = []
    rejected: list[Detection] = []
    # Scale bands (max/min diameter <= 4 each): big craters are searched on a coarser image,
    # which keeps HoughCircles fast and its radius range narrow.
    d_lo = p.crater_min_diameter_m
    while d_lo < p.crater_max_diameter_m:
        d_hi = min(p.crater_max_diameter_m, d_lo * 4)
        _hough_band(img, a_full, dem, known, accepted, rejected, d_lo, d_hi, p)
        d_lo = d_hi
    return accepted, rejected


def _hough_band(img, a, dem, known, accepted, rejected, d_lo, d_hi, p):
    target_px = max(img.dx, d_lo / 8)
    f = img.dx / target_px
    small = cv2.resize(a, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else a
    lo, hi = np.percentile(small, [1, 99])
    u8 = np.clip((small - lo) / max(hi - lo, 1e-6) * 255, 0, 255).astype(np.uint8)
    u8 = cv2.GaussianBlur(u8, (0, 0), 1.2)
    rmin = max(3, int(d_lo / 2 / target_px))
    rmax = max(rmin + 2, int(math.ceil(d_hi / 2 / target_px)))
    circles = cv2.HoughCircles(u8, cv2.HOUGH_GRADIENT_ALT, dp=1.5, minDist=2 * rmin, param1=150,
                               param2=0.6, minRadius=rmin, maxRadius=rmax)
    if circles is None:
        return
    for cx, cy, r in circles[0]:
        x, y = img.center_of((cx + 0.5) / f - 0.5, (cy + 0.5) / f - 0.5)
        diam = 2 * r * target_px
        if any(math.hypot(d.x - x, d.y - y) < 0.5 * max(d.diameter_m, diam) for d in known + accepted + rejected):
            continue
        det = Detection("crater", "image", float(x), float(y), float(diam))
        if dem is None:
            det.extra["note"] = "image only; no DEM to confirm depth"
            accepted.append(det)
            continue
        col, row = dem.pixel_of(x, y)
        rr = r * target_px / dem.dx
        span = int(math.ceil(1.3 * rr)) + 1
        r0, r1 = max(int(row) - span, 0), min(int(row) + span + 1, dem.height)
        c0, c1 = max(int(col) - span, 0), min(int(col) + span + 1, dem.width)
        if r1 <= r0 or c1 <= c0:
            continue
        yy, xx = np.ogrid[r0:r1, c0:c1]
        d2 = (xx + 0.5 - col) ** 2 + (yy + 0.5 - row) ** 2
        win = dem.data[r0:r1, c0:c1]
        floor = win[d2 <= (0.4 * rr) ** 2]
        rim = win[(d2 >= (0.9 * rr) ** 2) & (d2 <= (1.25 * rr) ** 2)]
        floor, rim = floor[np.isfinite(floor)], rim[np.isfinite(rim)]
        if floor.size < 3 or rim.size < 6:
            continue
        dz = float(np.median(rim) - np.median(floor))
        det.depth_or_height_m = dz
        if dz >= p.crater_min_depth_m:
            det.source = "image+dem"
            accepted.append(det)
        else:
            det.extra["note"] = f"circle in image but only {dz:.2f} m deep in DEM"
            rejected.append(det)


def paint_circles(r: Raster, dets: list[Detection], rim_factor: float) -> np.ndarray:
    mask = np.zeros((r.height, r.width), np.uint8)
    for d in dets:
        col, row = r.pixel_of(d.x, d.y)
        rad = (d.diameter_m / 2 * (1 + 2 * rim_factor)) / r.dx
        cv2.circle(mask, (int(round(col - 0.5)), int(round(row - 0.5))), max(1, int(round(rad))), 1, -1)
    return mask.astype(bool)


# --------------------------------------------------------------------------- rocks

def tophats(a: np.ndarray, valid: np.ndarray, size_px: int) -> tuple[np.ndarray, np.ndarray]:
    """(dark, bright) small-feature responses as robust z-scores.

    Black/white top-hats with a square of `size_px` respond only to features narrower than it, so
    broad dark sand or albedo patches and their edges do not look like rock shadows. Each response
    is normalised by its own median and MAD, because a top-hat of plain texture is never zero."""
    a = cv2.GaussianBlur(a, (0, 0), 0.7)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (size_px | 1, size_px | 1))
    out = []
    for op in (cv2.MORPH_BLACKHAT, cv2.MORPH_TOPHAT):
        th = cv2.morphologyEx(a, op, k)
        v = th[valid]
        med = float(np.median(v)) if v.size else 0.0
        s = 1.4826 * float(np.median(np.abs(v - med))) if v.size else 1.0
        out.append((th - med) / max(s, 1e-6))
    return out[0], out[1]


def elongation(comp: np.ndarray) -> float:
    """Ratio of principal axes from second moments (1 = round). Robust for small, ragged blobs."""
    ys, xs = np.nonzero(comp)
    if xs.size < 3:
        return 1.0
    cov = np.cov(np.vstack([xs, ys]).astype(float)) + np.eye(2) * (1 / 12)
    ev = np.linalg.eigvalsh(cov)
    return float(math.sqrt(ev[1] / max(ev[0], 1e-9)))


def detect_rocks_image(img: Raster, p: Params) -> tuple[np.ndarray, list[Detection]]:
    """Rocks in an overhead image: a compact shadow blob next to a sunlit (bright) blob.

    With sun_azimuth_deg the bright side must face the sun; with sun_elevation_deg the rock height
    is estimated from the shadow length (h = L * tan(elevation)) and short rocks are dropped."""
    a, valid = filled(img.data)
    px = img.dx
    size = int(math.ceil(1.5 * p.rock_max_diameter_m / px))
    dark_z, bright_z = tophats(a, valid, size)
    edge = dilate(~valid, 2)
    shadow = ((dark_z > p.rock_shadow_z) & valid & ~edge).astype(np.uint8)
    bright = ((bright_z > p.rock_bright_z) & valid & ~edge).astype(np.uint8)
    nb, blabels = cv2.connectedComponents(bright, connectivity=8)
    n, labels, stats, cent = cv2.connectedComponentsWithStats(shadow, connectivity=8)
    mask = np.zeros(shadow.shape, bool)
    dets: list[Detection] = []
    sun = None
    if p.sun_azimuth_deg is not None:
        az = math.radians(p.sun_azimuth_deg)
        sun = np.array([math.sin(az), -math.cos(az)])  # toward the sun, in (col, row)
    min_area = math.pi * (0.5 * p.rock_min_diameter_m / px / 2) ** 2  # shadows can be ~half the rock
    max_area = math.pi * (p.rock_max_diameter_m / px / 2) ** 2
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < max(2, min_area) or area > max_area:
            continue
        r_search = max(2, int(math.ceil(max(w, h) * 1.2)))
        y0, y1 = max(y - r_search, 0), min(y + h + r_search, shadow.shape[0])
        x0, x1 = max(x - r_search, 0), min(x + w + r_search, shadow.shape[1])
        comp = labels[y0:y1, x0:x1] == i
        if elongation(comp) > 3.0:
            continue
        near = dilate(comp, max(1.5, 0.5 * max(w, h))) & ~comp
        ids = np.unique(blabels[y0:y1, x0:x1][near & (bright[y0:y1, x0:x1] > 0)])
        ids = ids[ids > 0]
        partner = np.zeros_like(comp)
        sc = np.array([cent[i][0] - x0, cent[i][1] - y0])
        for b in ids:
            bm = blabels[y0:y1, x0:x1] == b
            if bm.sum() > 4 * max_area:
                continue
            if sun is not None:
                ys_, xs_ = np.nonzero(bm)
                v = np.array([xs_.mean(), ys_.mean()]) - sc
                if np.linalg.norm(v) > 0 and float(v @ sun) / np.linalg.norm(v) < 0.3:
                    continue
            partner |= bm
        if p.rock_require_sunlit_side and not partner.any():
            continue
        rock = comp | partner
        ys_, xs_ = np.nonzero(rock)
        diam = math.sqrt(4 * rock.sum() / math.pi) * px
        if diam < p.rock_min_diameter_m or diam > p.rock_max_diameter_m * 1.5:
            continue
        height = None
        if sun is not None and p.sun_elevation_deg is not None:
            sy, sx = np.nonzero(comp)
            proj = (sx - sc[0]) * -sun[0] + (sy - sc[1]) * -sun[1]
            length = (proj.max() - proj.min() + 1) * px
            height = length * math.tan(math.radians(p.sun_elevation_deg))
            if height < p.rock_min_height_m:
                continue
        mask[y0:y1, x0:x1] |= dilate(rock, p.rock_clearance_m / px)
        cx, cy = img.center_of(xs_.mean() + x0, ys_.mean() + y0)
        score = round(float(dark_z[y0:y1, x0:x1][comp].max()), 1)
        dets.append(Detection("rock", "image", float(cx), float(cy), diam, height, score))
    return mask, dets


def detect_rocks_dem(dem: Raster, exclude: np.ndarray, p: Params) -> tuple[np.ndarray, list[Detection]]:
    """Boulders big enough to stand out in the DEM: white top-hat above rock_dem_min_height_m."""
    z, valid = filled(dem.data)
    k = disk(1.0 * p.rock_max_diameter_m / dem.dx)
    tophat = z - cv2.morphologyEx(z, cv2.MORPH_OPEN, k)
    cand = ((tophat > p.rock_dem_min_height_m) & valid & ~dilate(~valid, 2) & ~exclude).astype(np.uint8)
    n, labels, stats, cent = cv2.connectedComponentsWithStats(cand, connectivity=8)
    mask = np.zeros(cand.shape, bool)
    dets = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        diam = math.sqrt(4 * area / math.pi) * dem.dx
        if diam > p.rock_max_diameter_m:
            continue
        comp = labels[y:y + h, x:x + w] == i
        _, aspect, solidity = shape_stats(comp)
        if aspect > 3.0 or solidity < 0.6:
            continue
        # isolated bump, not a piece of a ridge or crater rim: ground must drop away on all sides
        pr, pc = np.unravel_index(np.argmax(np.where(comp, z[y:y + h, x:x + w], -np.inf)), comp.shape)
        pr, pc = pr + y, pc + x
        rin = max(w, h) / 2 + 1.5
        rout = rin + 2.5
        span = int(math.ceil(rout)) + 1
        r0, r1 = max(pr - span, 0), min(pr + span + 1, z.shape[0])
        c0, c1 = max(pc - span, 0), min(pc + span + 1, z.shape[1])
        yy, xx = np.ogrid[r0:r1, c0:c1]
        d2 = (yy - pr) ** 2 + (xx - pc) ** 2
        ring = (d2 >= rin ** 2) & (d2 <= rout ** 2) & valid[r0:r1, c0:c1]
        zw = z[r0:r1, c0:c1]
        if ring.sum() < 8 or np.mean(zw[ring] < z[pr, pc] - 0.7 * p.rock_dem_min_height_m) < 0.85:
            continue
        pad = int(math.ceil(p.rock_clearance_m / dem.dx)) + 1
        y0, y1 = max(y - pad, 0), min(y + h + pad, mask.shape[0])
        x0, x1 = max(x - pad, 0), min(x + w + pad, mask.shape[1])
        mask[y0:y1, x0:x1] |= dilate(labels[y0:y1, x0:x1] == i, p.rock_clearance_m / dem.dx)
        cx, cy = dem.center_of(cent[i][0], cent[i][1])
        dets.append(Detection("rock", "dem", float(cx), float(cy), max(diam, dem.dx),
                              float(tophat[y:y + h, x:x + w][comp].max())))
    return mask, dets


# --------------------------------------------------------------------------- output grid

@dataclass
class Grid:
    x0: float  # west edge
    y0: float  # north edge
    cell: float
    width: int
    height: int


def grid_for(bounds: tuple[float, float, float, float], cell: float) -> Grid:
    west, south, east, north = bounds
    w = int(math.floor((east - west) / cell + 1e-6))
    h = int(math.floor((north - south) / cell + 1e-6))
    if w < 1 or h < 1:
        raise ValueError("output cell size is larger than the analysed area")
    return Grid(west, north, cell, w, h)


def coverage_fraction(r: Raster, mask: np.ndarray, g: Grid) -> np.ndarray:
    """Fraction of each output cell's source pixels where mask is True (pixels assigned by center)."""
    cols = np.floor((r.x0 + (np.arange(r.width) + 0.5) * r.dx - g.x0) / g.cell).astype(np.int64)
    rows = np.floor((g.y0 - (r.y0 - (np.arange(r.height) + 0.5) * r.dy)) / g.cell).astype(np.int64)
    okc, okr = (cols >= 0) & (cols < g.width), (rows >= 0) & (rows < g.height)
    sub = mask[np.ix_(okr, okc)]
    idx = (rows[okr][:, None] * g.width + cols[okc][None, :]).ravel()
    n = g.width * g.height
    total = np.bincount(idx, minlength=n)
    hit = np.bincount(idx, weights=sub.ravel().astype(np.float64), minlength=n)
    frac = np.zeros(n)
    covered = total > 0
    frac[covered] = hit[covered] / total[covered]
    if r.dx > g.cell:  # source coarser than output: some cells get no pixel center, use nearest
        frac2 = cv2.resize(mask.astype(np.float32), None, fx=r.dx / g.cell, fy=r.dy / g.cell,
                           interpolation=cv2.INTER_NEAREST)
        c_off = int(round((r.x0 - g.x0) / g.cell))
        r_off = int(round((g.y0 - r.y0) / g.cell))
        out = np.zeros((g.height, g.width), np.float32)
        ys, xs = slice(max(r_off, 0), min(r_off + frac2.shape[0], g.height)), slice(max(c_off, 0), min(c_off + frac2.shape[1], g.width))
        out[ys, xs] = frac2[ys.start - r_off:ys.stop - r_off, xs.start - c_off:xs.stop - c_off]
        frac = np.where(covered, frac, out.ravel())
    return frac.reshape(g.height, g.width)


@dataclass
class Result:
    grid: Grid
    cost: np.ndarray       # uint8 0/1, row 0 = north edge
    reasons: np.ndarray    # uint8 bitmask of SLOPE | CRATER | ROCK | NODATA
    slope: np.ndarray | None
    detections: list[Detection]
    unconfirmed: list[Detection]
    stats: dict


def build_cost_matrix(dem: Raster | None, img: Raster | None, cell: float, p: Params) -> Result:
    if dem is None and img is None:
        raise ValueError("need a DEM, an orthoimage, or both")
    if dem is not None and img is not None:
        dw, ds, de, dn = dem.bounds
        iw, is_, ie, in_ = img.bounds
        bounds = (max(dw, iw), max(ds, is_), min(de, ie), min(dn, in_))
        if bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
            raise ValueError("the DEM and the image do not overlap; check they share a map projection")
    else:
        bounds = (dem or img).bounds
    g = grid_for(bounds, cell)
    layers: list[tuple[int, Raster, np.ndarray]] = []
    dets: list[Detection] = []
    unconfirmed: list[Detection] = []
    slope = None
    crater_mask_dem = None
    depth = None

    if dem is not None:
        slope = slope_deg(dem, p.slope_smooth_m)
        nodata = ~np.isfinite(dem.data)
        layers.append((NODATA, dem, nodata))
        layers.append((SLOPE, dem, np.nan_to_num(slope, nan=0.0) > p.max_slope_deg))
        crater_mask_dem, cdets, depth = detect_craters_dem(dem, p)
        layers.append((CRATER, dem, crater_mask_dem))
        dets += cdets
        rmask, rdets = detect_rocks_dem(dem, crater_mask_dem, p)
        layers.append((ROCK, dem, rmask))
        dets += rdets
    if img is not None:
        if p.hough_craters:
            known = [d for d in dets if d.kind == "crater"]
            acc, rej = detect_craters_image(img, dem, depth, known, p)
            unconfirmed += rej
            if acc:
                target = dem if dem is not None else img
                layers.append((CRATER, target, paint_circles(target, acc, p.crater_rim_factor)))
                dets += acc
        rmask, rdets = detect_rocks_image(img, p)
        layers.append((ROCK, img, rmask))
        dets += rdets

    reasons = np.zeros((g.height, g.width), np.uint8)
    for bit, r, m in layers:
        frac = coverage_fraction(r, m, g)
        reasons[frac > p.block_fraction] |= bit
    cost = (reasons > 0).astype(np.uint8)

    stats = {
        "cells": int(cost.size),
        "blocked": int(cost.sum()),
        "blockedFraction": round(float(cost.mean()), 4),
        "byReason": {name: int(((reasons & bit) > 0).sum()) for bit, name in REASONS.items()},
        "craters": sum(d.kind == "crater" for d in dets),
        "rocks": sum(d.kind == "rock" for d in dets),
    }
    if slope is not None and np.isfinite(slope).any():
        stats["slopeDeg"] = {"median": round(float(np.nanmedian(slope)), 2),
                             "p95": round(float(np.nanpercentile(slope, 95)), 2),
                             "max": round(float(np.nanmax(slope)), 2)}
    return Result(g, cost, reasons, slope, dets, unconfirmed, stats)
