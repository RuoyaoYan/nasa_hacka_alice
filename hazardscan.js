/* Momoot hazard scan · finds dangerous terrain in real NASA orbital imagery.
 *
 * JavaScript port of the image detector in tools/terrain_hazard/hazards.py
 * (detect_rocks_image), adapted to Mars Trek map tiles:
 *
 *   1. Download the HiRISE (or CTX) tiles that cover the planning area.
 *   2. Black top-hat finds compact SHADOWS, white top-hat finds compact
 *      SUNLIT faces, each turned into a robust z-score (median and MAD),
 *      so broad dark sand or bright dust patches don't count.
 *   3. A hazard is a shadow blob with a sunlit blob right next to it: that
 *      pairing is what real relief looks like from orbit (a boulder, a hill,
 *      a crater wall, a scarp). Shadows with no sunlit partner are rejected.
 *   4. It runs at three scales: ~10 m pixels for boulders and small craters,
 *      ~30 m pixels for hills and buttes like the one beside Séítah, and
 *      ~90 m pixels for craters a few hundred metres across.
 *   5. Craters: a crater floor is often dark sand, which step 3 ignores on
 *      purpose. So craters get their own detector: a round patch darker than
 *      the ring of ground around it (the rim), found at several sizes from
 *      ~240 m to ~800 m across. The whole crater, rim included, is marked.
 *      Rings of relief from step 4 also have their floor filled in.
 *   6. Local texture roughness marks rough ground (not blocked, just slower).
 *
 * Output: a mask over the scanned area with reason bits
 *   32 = relief seen in shading (hill, crater wall, scarp, boulder)
 *   64 = rough ground
 * that planner.js merges into its cost grid.
 *
 * Needs the tile server to allow cross origin reads (CORS). If it doesn't,
 * scan() rejects and the game keeps using the terrain model.
 */
(() => {
  "use strict";

  const RELIEF = 32, ROUGH = 64;
  const P = {
    shadowZ: 4.5,   // dark top-hat this many robust std above typical texture (hazards.py uses 5)
    brightZ: 3.0,   // sunlit side threshold (same as hazards.py)
    roughZ: 3.2,
    minArea: 3,     // pixels
    clearance: 1    // pixels of keep-out around each hazard
  };

  // ---------- tiles ----------
  function tileRange(bounds, z) {
    const [[s, w], [n, e]] = bounds;
    const cols = Math.pow(2, z + 1), rows = Math.pow(2, z);
    const x0 = Math.floor(((w + 180) / 360) * cols), x1 = Math.floor(((e + 180) / 360) * cols);
    const y0 = Math.floor(((90 - n) / 180) * rows), y1 = Math.floor(((90 - s) / 180) * rows);
    return { x0, x1, y0, y1, cols, rows };
  }
  function loadImg(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("tile failed"));
      im.src = url;
    });
  }
  async function mosaic(template, bounds, z) {
    const t = tileRange(bounds, z);
    const W = (t.x1 - t.x0 + 1) * 256, H = (t.y1 - t.y0 + 1) * 256;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    let ok = 0;
    const jobs = [];
    for (let y = t.y0; y <= t.y1; y++) for (let x = t.x0; x <= t.x1; x++) {
      const url = template.replace("{z}", z).replace("{y}", y).replace("{x}", x);
      jobs.push(loadImg(url).then((im) => { ctx.drawImage(im, (x - t.x0) * 256, (y - t.y0) * 256); ok++; }).catch(() => {}));
    }
    await Promise.all(jobs);
    if (!ok) throw new Error("no tiles loaded");
    const data = ctx.getImageData(0, 0, W, H).data; // throws if the server blocks cross origin reads
    const gray = new Float32Array(W * H), valid = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
      gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      valid[i] = data[j + 3] > 200 && gray[i] > 2 ? 1 : 0;
    }
    // geographic bounds of the mosaic
    const gb = [[90 - ((t.y1 + 1) / t.rows) * 180, (t.x0 / t.cols) * 360 - 180], [90 - (t.y0 / t.rows) * 180, ((t.x1 + 1) / t.cols) * 360 - 180]];
    return { W, H, gray, valid, bounds: gb, tiles: ok };
  }

  // ---------- image operations ----------
  function blur3(a, W, H) {
    const o = new Float32Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
        const w = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
        s += a[yy * W + xx] * w; n += w;
      }
      o[y * W + x] = s / n;
    }
    return o;
  }
  // separable square min or max filter
  function rank(a, W, H, k, isMax) {
    const r = k >> 1, tmp = new Float32Array(a.length), o = new Float32Array(a.length);
    const pick = isMax ? Math.max : Math.min;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = a[y * W + x];
      for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < W) v = pick(v, a[y * W + xx]); }
      tmp[y * W + x] = v;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = tmp[y * W + x];
      for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < H) v = pick(v, tmp[yy * W + x]); }
      o[y * W + x] = v;
    }
    return o;
  }
  function robustZ(a, valid) {
    const sample = [];
    const step = Math.max(1, Math.floor(a.length / 60000));
    for (let i = 0; i < a.length; i += step) if (valid[i]) sample.push(a[i]);
    sample.sort((x, y) => x - y);
    const med = sample[sample.length >> 1] || 0;
    const dev = sample.map((v) => Math.abs(v - med)).sort((x, y) => x - y);
    const s = 1.4826 * (dev[dev.length >> 1] || 1);
    const z = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) z[i] = (a[i] - med) / Math.max(s, 1e-6);
    return z;
  }
  function downsample(img, f) {
    const W = Math.floor(img.W / f), H = Math.floor(img.H / f);
    const g = new Float32Array(W * H), v = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
        const i = (y * f + dy) * img.W + x * f + dx;
        if (img.valid[i]) { s += img.gray[i]; n++; }
      }
      g[y * W + x] = n ? s / n : 0; v[y * W + x] = n > (f * f) / 2 ? 1 : 0;
    }
    return { W, H, gray: g, valid: v };
  }
  function components(mask, W, H) {
    const lab = new Int32Array(W * H), comps = [];
    let next = 1;
    const stack = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || lab[i]) continue;
      const pix = [];
      lab[i] = next; stack.push(i);
      while (stack.length) {
        const p = stack.pop(); pix.push(p);
        const y = (p / W) | 0, x = p % W;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
          const q = yy * W + xx;
          if (mask[q] && !lab[q]) { lab[q] = next; stack.push(q); }
        }
      }
      comps.push(pix); next++;
    }
    return { lab, comps };
  }

  // One scale of the shadow plus sunlit detector. Returns hazard mask at this scale.
  function detect(img, k) {
    const { W, H, valid } = img;
    const a = blur3(img.gray, W, H);
    const close = rank(rank(a, W, H, k, true), W, H, k, false);
    const open = rank(rank(a, W, H, k, false), W, H, k, true);
    const bh = new Float32Array(a.length), wh = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) { bh[i] = close[i] - a[i]; wh[i] = a[i] - open[i]; }
    const dz = robustZ(bh, valid), bz = robustZ(wh, valid);
    const shadow = new Uint8Array(a.length), bright = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) { if (!valid[i]) continue; shadow[i] = dz[i] > P.shadowZ ? 1 : 0; bright[i] = bz[i] > P.brightZ ? 1 : 0; }
    const S = components(shadow, W, H), B = components(bright, W, H);
    const maxArea = k * k * 1.5;
    const out = new Uint8Array(a.length);
    let found = 0;
    for (const pix of S.comps) {
      if (pix.length < P.minArea || pix.length > maxArea * 4) continue;
      // sunlit partner: a bright blob touching the shadow's neighbourhood
      const partners = new Set();
      for (const p of pix) {
        const y = (p / W) | 0, x = p % W;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
          const lb = B.lab[yy * W + xx];
          if (lb) partners.add(lb);
        }
      }
      const keep = [...partners].filter((lb) => B.comps[lb - 1].length <= maxArea * 4);
      if (!keep.length) continue; // a lone dark patch is sand or albedo, not relief
      found++;
      const all = pix.concat(...keep.map((lb) => B.comps[lb - 1]));
      for (const p of all) {
        const y = (p / W) | 0, x = p % W;
        for (let dy = -P.clearance; dy <= P.clearance; dy++) for (let dx = -P.clearance; dx <= P.clearance; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && xx >= 0 && yy < H && xx < W) out[yy * W + xx] = 1;
        }
      }
    }
    return { mask: out, found };
  }

  // Separable box blur that ignores invalid pixels (normalised convolution)
  function boxBlur(a, valid, W, H, r) {
    const tmp = new Float32Array(a.length), tw = new Float32Array(a.length), o = new Float32Array(a.length), ow = new Float32Array(a.length);
    for (let y = 0; y < H; y++) {
      let s = 0, n = 0; const row = y * W;
      for (let x = -r; x < W + r; x++) {
        const xa = x + r, xr = x - r - 1;
        if (xa < W && xa >= 0 && valid[row + xa]) { s += a[row + xa]; n++; }
        if (xr >= 0 && xr < W && valid[row + xr]) { s -= a[row + xr]; n--; }
        if (x >= 0 && x < W) { tmp[row + x] = s; tw[row + x] = n; }
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let y = -r; y < H + r; y++) {
        const ya = y + r, yr = y - r - 1;
        if (ya < H && ya >= 0) { s += tmp[ya * W + x]; n += tw[ya * W + x]; }
        if (yr >= 0 && yr < H) { s -= tmp[yr * W + x]; n -= tw[yr * W + x]; }
        if (y >= 0 && y < H) { o[y * W + x] = s; ow[y * W + x] = n; }
      }
    }
    for (let i = 0; i < o.length; i++) o[i] = ow[i] > 0 ? o[i] / ow[i] : 0;
    return o;
  }
  // Craters on a ~30 m image: a round floor darker than the rim around it in nearly every direction,
  // and a rim that stands out from the ground beyond it (a raised ring). A dark sand patch has no
  // raised ring, so it is not taken for a crater. Returns a mask (whole crater, rim included).
  function detectCraters(img) {
    const { W, H, gray, valid } = img;
    const out = new Uint8Array(W * H);
    const g1 = boxBlur(gray, valid, W, H, 1);
    // typical local contrast, to set how much brighter a rim has to be
    const lz = []; for (let i = 0; i < g1.length; i += 13) if (valid[i]) lz.push(g1[i]);
    lz.sort((p, q) => p - q);
    const med = lz[lz.length >> 1] || 0, mad = 1.4826 * (lz.map((v) => Math.abs(v - med)).sort((p, q) => p - q)[lz.length >> 1] || 1);
    const at = (x, y) => { const xx = Math.round(x), yy = Math.round(y); return xx < 0 || yy < 0 || xx >= W || yy >= H || !valid[yy * W + xx] ? NaN : g1[yy * W + xx]; };
    const found = [], ANG = 16;
    // only craters too big for the shadow and sunlit detector (~240 m to ~800 m across); smaller ones it already finds
    for (const r of [4, 6, 9, 13]) {               // crater radius in pixels at ~30 m: ~120 m to ~400 m
      const inner = boxBlur(g1, valid, W, H, Math.max(1, Math.round(r * 0.55)));
      const ring = boxBlur(g1, valid, W, H, Math.round(r * 1.3));
      const d = new Float32Array(W * H);
      for (let i = 0; i < d.length; i++) d[i] = valid[i] ? ring[i] - inner[i] : 0;
      const dz = robustZ(d, valid);
      for (let y = r * 2; y < H - r * 2; y++) for (let x = r * 2; x < W - r * 2; x++) {
        const i = y * W + x;
        if (dz[i] < 5 || d[i] < 0.6 * mad) continue;   // clearly darker than its surroundings
        let isMax = true;
        for (let dy = -r; dy <= r && isMax; dy++) for (let dx = -r; dx <= r; dx++) { if ((dx || dy) && dz[(y + dy) * W + x + dx] > dz[i]) { isMax = false; break; } }
        if (!isMax) continue;
        let seen = 0, darkInside = 0, raised = 0;
        for (let k = 0; k < ANG; k++) {
          const c = Math.cos((k / ANG) * Math.PI * 2), sn = Math.sin((k / ANG) * Math.PI * 2);
          const fl = at(x + c * r * 0.45, y + sn * r * 0.45);
          let rim = -Infinity; for (const f of [0.85, 1, 1.15, 1.3]) { const v = at(x + c * r * f, y + sn * r * f); if (v > rim) rim = v; }
          const beyond = (at(x + c * r * 1.9, y + sn * r * 1.9) + at(x + c * r * 2.2, y + sn * r * 2.2)) / 2;
          if (Number.isNaN(fl) || !Number.isFinite(rim) || Number.isNaN(beyond)) continue;
          seen++;
          if (rim - fl > 0.5 * d[i]) darkInside++;       // floor darker than the rim in this direction
          if (rim - beyond > 0.25 * d[i]) raised++;      // rim brighter than the ground beyond it
        }
        if (seen < ANG * 0.6 || darkInside < seen * 0.8 || raised < seen * 0.45) continue;
        if (found.some((f) => Math.hypot(f.x - x, f.y - y) < Math.max(f.r, r) * 1.2)) continue;
        found.push({ x, y, r });
      }
    }
    for (const c of found) {
      const R = c.r * 1.35; // crater plus its rim
      for (let dy = -Math.ceil(R); dy <= Math.ceil(R); dy++) for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) {
        const xx = c.x + dx, yy = c.y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && dx * dx + dy * dy <= R * R) out[yy * W + xx] = 1;
      }
    }
    return { mask: out, found: found.length, W, H };
  }

  // Holes in the relief mask (ground fully ringed by relief, smaller than maxArea pixels) are filled.
  // Ground connected to the edge of the scan, or to invalid (no data) pixels, is open and stays.
  function fillHoles(mask, W, H, valid, maxArea) {
    const seen = new Uint8Array(W * H), stack = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] || seen[i]) continue;
      const pix = []; let open = false;
      seen[i] = 1; stack.push(i);
      while (stack.length) {
        const p = stack.pop(); pix.push(p);
        const y = (p / W) | 0, x = p % W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !valid[p]) open = true;
        for (const q of [p - 1, p + 1, p - W, p + W]) {
          if (q < 0 || q >= mask.length || seen[q] || mask[q]) continue;
          if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
          seen[q] = 1; stack.push(q);
        }
      }
      if (!open && pix.length <= maxArea) for (const p of pix) mask[p] = 1;
    }
  }

  function roughness(img) {
    const { W, H, gray, valid } = img;
    const b = blur3(blur3(gray, W, H), W, H);
    const hp = new Float32Array(gray.length);
    for (let i = 0; i < gray.length; i++) hp[i] = Math.abs(gray[i] - b[i]);
    const loc = rank(hp, W, H, 3, true);
    const z = robustZ(loc, valid);
    const out = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) out[i] = valid[i] && z[i] > P.roughZ ? 1 : 0;
    return out;
  }

  /** Find relief in one mosaic: pure pixel work, runs in a worker (or here if workers are unavailable). */
  function analyse(img) {
    const fine = detect(img, 7);                 // ~10 m pixels: boulders, small craters
    const small = downsample(img, 3);
    const coarse = detect(small, 7);             // ~30 m pixels: hills, buttes, crater walls
    const craters = detectCraters(small);        // ~30 m pixels: crater floors (often dark sand) and rims
    const big = downsample(img, 9);
    const broad = detect(big, 7);                // ~90 m pixels: craters a few hundred metres across
    const rough = roughness(img);
    // upsample the coarser masks smoothly (bilinear, then threshold) so outlines follow the real shape
    const up = (m, f) => {
      const at = (x, y) => m.mask[Math.min(m.H - 1, Math.max(0, y)) * m.W + Math.min(m.W - 1, Math.max(0, x))];
      return (x, y) => {
        const fx = (x + 0.5) / f - 0.5, fy = (y + 0.5) / f - 0.5;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
      };
    };
    const coarseAt = up({ mask: coarse.mask, W: small.W, H: small.H }, 3), broadAt = up({ mask: broad.mask, W: big.W, H: big.H }, 9);
    const craterAt = up(craters, 3);
    const relief = new Uint8Array(img.W * img.H);
    for (let y = 0; y < img.H; y++) for (let x = 0; x < img.W; x++) {
      relief[y * img.W + x] = fine.mask[y * img.W + x] || coarseAt(x, y) >= 0.5 || broadAt(x, y) >= 0.5 || craterAt(x, y) >= 0.5 ? 1 : 0;
    }
    // crater floors: fill the inside of rings of detected relief (up to ~400 m across; bigger craters
    // come from detectCraters, and bigger open pockets are real open ground)
    fillHoles(relief, img.W, img.H, img.valid, Math.round((Math.PI * 200 * 200) / (10 * 10)));
    // close small gaps and round the outline: 5 x 5 majority filter
    const bits = new Uint8Array(img.W * img.H);
    for (let y = 0; y < img.H; y++) for (let x = 0; x < img.W; x++) {
      let n = 0, t = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= img.H || xx >= img.W) continue;
        t++; n += relief[yy * img.W + xx];
      }
      const i = y * img.W + x;
      if (relief[i] ? n * 3 >= t : n * 2 > t) bits[i] |= RELIEF;
      if (rough[i]) bits[i] |= ROUGH;
    }
    return { width: img.W, height: img.H, bounds: img.bounds, bits, tiles: img.tiles,
      found: { fine: fine.found, coarse: coarse.found + broad.found, craters: craters.found } };
  }

  // The heavy part runs in a background worker so the page stays responsive while scanning
  const SELF_URL = typeof document !== "undefined" && document.currentScript ? document.currentScript.src : null;
  let worker = null, jobs = 0;
  const pending = new Map();
  function analyseInWorker(img) {
    if (!worker && SELF_URL && typeof Worker !== "undefined") {
      try {
        worker = new Worker(SELF_URL);
        worker.onmessage = (e) => { const p = pending.get(e.data.id); pending.delete(e.data.id); if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.res); };
        worker.onerror = () => { worker = null; for (const p of pending.values()) p.reject(new Error("worker failed")); pending.clear(); };
      } catch { worker = null; }
    }
    if (!worker) return Promise.resolve().then(() => analyse(img));
    const id = ++jobs;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, img }, [img.gray.buffer, img.valid.buffer]);
    });
  }

  /** Scan the planning area. layers: [{template}] tried in order. */
  async function scan(bounds, layers, z = 12, onStatus = () => {}) {
    let img = null, used = null, lastErr = null;
    for (const L of layers) {
      try { onStatus(`Downloading ${L.name} tiles`); img = await mosaic(L.template, bounds, z); used = L; break; }
      catch (e) { lastErr = e; }
    }
    if (!img) throw lastErr || new Error("no imagery");
    onStatus("Looking for shadows next to sunlit slopes");
    const res = await analyseInWorker(img);
    return { ...res, source: used.name };
  }

  if (typeof window !== "undefined") window.MomootHazardScan = { scan, RELIEF, ROUGH, params: P };
  else self.onmessage = (e) => { // running as the worker
    try { const res = analyse(e.data.img); self.postMessage({ id: e.data.id, res }, [res.bits.buffer]); }
    catch (err) { self.postMessage({ id: e.data.id, error: String(err) }); }
  };
})();
