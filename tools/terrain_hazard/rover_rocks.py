#!/usr/bin/env python3
"""Rock detection in a Perseverance (or Curiosity) rover photo: Navcam, Hazcam or Mastcam-Z.

    python3 rover_rocks.py NLF_0100_....png --out out_rover/

This works in IMAGE space. A rover photo is a perspective view, so a rock's pixel position does not
map to a cell of the hazard grid without the camera pose and model (the CAHVOR model in the image's
PDS label). Use it to show and count rocks in the scene, or to check the orbital detections near
the rover. The terrain_hazard.py grid comes from overhead DEM + orthoimage only.

Outputs: rocks_annotated.jpg (boxes), rocks_mask.png (white = rock), rocks.json.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np


def find_horizon(gray: np.ndarray) -> int:
    """First row (from the top) where ground texture starts. Sky is smooth; ground is textured."""
    g = cv2.GaussianBlur(gray.astype(np.float32), (0, 0), 1.5)
    mag = np.hypot(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
    rows = np.median(mag, axis=1)
    rows = np.convolve(rows, np.ones(9) / 9, mode="same")
    ground = np.median(rows[len(rows) // 2:])
    above = np.nonzero(rows > 0.4 * ground)[0]
    if above.size == 0:
        return 0
    # require the texture to persist, so a dust streak in the sky does not count
    for r in above:
        if np.mean(rows[r:r + 15] > 0.4 * ground) > 0.8:
            return int(r)
    return int(above[0])


def detect(img_bgr: np.ndarray, horizon: int | None = None, min_rock_px_bottom: int = 400,
           k_dark: float = 4.0, k_bright: float = 4.0) -> tuple[list[dict], np.ndarray, int]:
    gray = img_bgr if img_bgr.ndim == 2 else cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape
    if horizon is None:
        horizon = find_horizon(gray)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    eq = clahe.apply(gray)
    ground = np.zeros_like(gray, bool)
    start = min(H - 2, horizon + max(8, H // 40))  # skip the sky/ground seam
    ground[start:, :] = True
    # Median background: rocks cover a minority of any large window, so they do not pull the
    # background toward themselves (no bright halos joining neighbouring rocks, unlike a Gaussian).
    fill = eq.copy()
    above = eq[start:start + start][::-1]  # mirror the ground into the sky band so the seam has no step
    fill[start - above.shape[0]:start] = above
    ksize = max(31, (H // 9) | 1)
    bg = cv2.medianBlur(fill, ksize).astype(np.float32)
    diff = cv2.GaussianBlur(eq.astype(np.float32), (0, 0), 1.0) - bg
    v = diff[ground]
    med = float(np.median(v)) if v.size else 0.0
    s = 1.4826 * float(np.median(np.abs(v - med))) or 1.0
    zmap = (diff - med) / s
    dark, bright = -zmap, zmap
    cand = (((dark > k_dark) | (bright > k_bright)) & ground).astype(np.uint8)
    cand = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    cand = cv2.morphologyEx(cand, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    n, labels, stats, cent = cv2.connectedComponentsWithStats(cand, connectivity=8)
    rocks, mask = [], np.zeros_like(gray, np.uint8)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        bottom = y + h
        # perspective: things shrink toward the horizon; scale the minimum size with depth into the image
        depth = max(0.05, (bottom - horizon) / max(1, H - horizon))
        min_area = max(12, min_rock_px_bottom * depth ** 2)
        if area < min_area or area > 0.15 * H * W:
            continue
        comp = labels[y:y + h, x:x + w] == i
        ys, xs = np.nonzero(comp)
        cov = np.cov(np.vstack([xs, ys]).astype(float)) + np.eye(2) / 12
        ev = np.linalg.eigvalsh(cov)
        if math.sqrt(ev[1] / max(ev[0], 1e-9)) > 4.0:
            continue
        fill = area / float(w * h)
        if fill < 0.3:
            continue
        mask[y:y + h, x:x + w][comp] = 255
        rocks.append({
            "bbox": [int(x), int(y), int(w), int(h)],
            "center": [round(float(cent[i][0]), 1), round(float(cent[i][1]), 1)],
            "areaPx": int(area),
            "relativeRange": round(1 - depth, 3),  # 0 = bottom of frame (near), 1 = horizon (far)
            "contrast": round(float(max(dark[y:y + h, x:x + w][comp].max(), bright[y:y + h, x:x + w][comp].max())), 1),
        })
    rocks.sort(key=lambda r: -r["areaPx"])
    return rocks, mask, horizon


def annotate(img_bgr: np.ndarray, rocks: list[dict], horizon: int) -> np.ndarray:
    out = img_bgr.copy() if img_bgr.ndim == 3 else cv2.cvtColor(img_bgr, cv2.COLOR_GRAY2BGR)
    cv2.line(out, (0, horizon), (out.shape[1], horizon), (255, 200, 0), 1, cv2.LINE_AA)
    for i, r in enumerate(rocks, 1):
        x, y, w, h = r["bbox"]
        cv2.rectangle(out, (x, y), (x + w, y + h), (0, 0, 255), 2)
        cv2.putText(out, str(i), (x, max(12, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)
    cv2.putText(out, f"{len(rocks)} rock candidates (image space)", (10, out.shape[0] - 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", help="rover photo (PNG/JPG)")
    ap.add_argument("--out", default="out_rover")
    ap.add_argument("--horizon-row", type=int, help="override the automatic horizon (pixel row)")
    ap.add_argument("--min-rock-px", type=int, default=400, help="smallest rock area (px) at the bottom of the frame")
    ap.add_argument("--k", type=float, default=4.0, help="contrast threshold in robust std (higher = fewer detections)")
    a = ap.parse_args(argv)
    img = cv2.imread(a.image, cv2.IMREAD_COLOR)
    if img is None:
        print(f"error: cannot read {a.image}", file=sys.stderr)
        return 1
    rocks, mask, horizon = detect(img, a.horizon_row, a.min_rock_px, a.k, a.k)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out / "rocks_annotated.jpg"), annotate(img, rocks, horizon))
    cv2.imwrite(str(out / "rocks_mask.png"), mask)
    (out / "rocks.json").write_text(json.dumps({
        "image": Path(a.image).name, "width": img.shape[1], "height": img.shape[0],
        "horizonRow": horizon, "space": "image pixels (not map coordinates)", "rocks": rocks}, indent=1))
    print(f"{len(rocks)} rock candidates below horizon row {horizon}; outputs in {out}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
