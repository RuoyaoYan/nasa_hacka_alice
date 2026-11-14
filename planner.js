/* Momoot route planner.
 *
 * 1. Terrain cost map: a grid of ~50 m cells over the Jezero study area.
 *    Each cell knows its elevation (simplified terrain model), slope,
 *    and whether it lies in loose sand or a boulder field.
 * 2. Pairwise paths: Dijkstra from every target gives the cheapest path to
 *    every other target. Cost = distance x (1 + risk weights), so paths bend
 *    around steep scarps, sand and boulders.
 * 3. Visiting order: depth first search with branch and bound over every
 *    order of the targets (start and end at the habitat), keeping the cheapest.
 *
 * Exposes window.MomootPlanner. No dependencies.
 */
(() => {
  "use strict";

  const R_KM = 3389.5;
  const KM_PER_DEG = (Math.PI * R_KM) / 180;   // ~59.16 km per degree of latitude
  const S = (x) => 1 / (1 + Math.exp(-x));
  const gauss = (d, w) => Math.exp(-(d * d) / (2 * w * w));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Simplified terrain model (metres above the crater floor) ----------
  // Shapes follow Jezero's main features: the delta front scarp with the
  // Hawksbill Gap valley, the rising upper fan, Kodiak butte, Belva crater,
  // and the western crater rim cut by Neretva Vallis. Approximate, for gameplay.
  function makeElevation(T) {
    const kLon = Math.cos((18.45 * Math.PI) / 180);
    const kmTo = (a, b) => Math.hypot((a[0] - b[0]) * KM_PER_DEG, (a[1] - b[1]) * KM_PER_DEG * kLon);
    return (lat, lon) => {
      // delta front: scarp line runs north north west from the crater floor
      const lonFront = 77.405 - (lat - 18.445) * 0.27;
      const gapW = 0.0012 + 0.0045 * gauss(lat - T.hawksbill[0], 0.0028); // the gap softens the scarp
      const inDeltaLat = S((lat - 18.441) / 0.0025);
      const delta = inDeltaLat * (85 * S((lonFront - lon) / gapW) + 60 * clamp((lonFront - lon) / 0.07, 0, 1));
      // western rim, notched by Neretva Vallis
      const notch = 1 - 0.7 * gauss(lat - T.neretva[0], 0.006);
      const rim = 540 * notch * S((77.338 - lon) / 0.0068) + 70 * gauss(kmTo([lat, lon], T.lookout), 0.6);
      // Kodiak butte and Belva crater
      const kodiak = 55 * S((0.32 - kmTo([lat, lon], T.kodiak)) / 0.05);
      const db = kmTo([lat, lon], T.belva);
      const belva = -45 * gauss(db, 0.28) + 22 * gauss(db - 0.45, 0.1);
      return delta + rim + kodiak + belva;
    };
  }

  // ---------- Grid ----------
  function buildGrid(D) {
    const T = D.places;
    const [[s, w], [n, e]] = D.planArea;
    const kLon = Math.cos(((s + n) / 2 * Math.PI) / 180);
    const cellKm = 0.05;
    const dLat = cellKm / KM_PER_DEG, dLon = cellKm / (KM_PER_DEG * kLon);
    const rows = Math.ceil((n - s) / dLat), cols = Math.ceil((e - w) / dLon);
    const N = rows * cols;
    const elev = new Float32Array(N), slope = new Float32Array(N), sand = new Float32Array(N), rock = new Uint8Array(N);
    const hd = new Float32Array(N).fill(Infinity); // metres to the nearest detected hazard
    const ext = new Uint8Array(N); // hazards from real data: 1 slope, 2 crater, 4 rock (terrain_hazard tool), 32 relief, 64 rough (HiRISE scan)
    const elevAt = makeElevation(T);
    const kmTo = (a, b) => Math.hypot((a[0] - b[0]) * KM_PER_DEG, (a[1] - b[1]) * KM_PER_DEG * kLon);
    const ll = (r, c) => [n - (r + 0.5) * dLat, w + (c + 0.5) * dLon];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, p = ll(r, c);
      elev[i] = elevAt(p[0], p[1]);
      let sv = 0;
      for (const z of D.hazards.sand) {
        const dy = (p[0] - z.pos[0]) * KM_PER_DEG / z.ry, dx = (p[1] - z.pos[1]) * KM_PER_DEG * kLon / z.rx;
        sv = Math.max(sv, clamp(1.4 - Math.hypot(dx, dy), 0, 1));
      }
      sand[i] = sv;
      for (const b of D.hazards.boulders) if (kmTo(p, b.pos) < b.r) rock[i] = 1;
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const ex = (elev[r * cols + Math.min(cols - 1, c + 1)] - elev[r * cols + Math.max(0, c - 1)]) / (2 * cellKm * 1000);
      const ey = (elev[Math.min(rows - 1, r + 1) * cols + c] - elev[Math.max(0, r - 1) * cols + c]) / (2 * cellKm * 1000);
      slope[i] = (Math.atan(Math.hypot(ex, ey)) * 180) / Math.PI;
    }
    return { rows, cols, N, s, w, n, e, dLat, dLon, cellKm, elev, slope, sand, rock, ext, hd, ll, elevAt, kmTo,
      cellOf: (p) => clamp(Math.floor((n - p[0]) / dLat), 0, rows - 1) * cols + clamp(Math.floor((p[1] - w) / dLon), 0, cols - 1) };
  }

  // Cost to enter a cell, per km, for a given risk profile
  const BLOCK_BITS = 1 | 2 | 4 | 32; // slope, crater, rock, relief seen in imagery
  const CLEAR_M = 50;   // safe routes never come closer than this to a detected hazard
  const BUFFER_M = 70;  // extra cost fades out over this distance beyond the margin
  function cellCost(G, i, W) {
    const sl = G.slope[i];
    if (sl > W.maxSlope) return Infinity;
    if (G.rock[i] && W.rock === Infinity) return Infinity;
    const x = G.ext[i], hd = G.hd[i];
    const safe = W.rock === Infinity;
    if (safe && ((x & BLOCK_BITS) || hd < CLEAR_M)) return Infinity; // keep a hard safety margin
    const steep = clamp((sl - 5) / 10, 0, 1.5);
    let c = 1 + W.steep * steep + W.sand * G.sand[i] + (G.rock[i] ? W.rock : 0);
    if (x & BLOCK_BITS || hd < 15) c += 3;          // fastest profile pays a big penalty instead
    if (safe && hd < CLEAR_M + BUFFER_M) {           // soft buffer: the cheapest line runs parallel to the hazard edge
      const t = 1 - (hd - CLEAR_M) / BUFFER_M;
      c += 0.8 * t * t;
    }
    if (x & 64) c += 0.4 + (W.rock === Infinity ? 0.6 : 0.2); // rough ground is slower
    return c;
  }

  // ---------- Fine hazard fields: distance in metres to the nearest detected hazard ----------
  const fields = [];
  function distanceTransform(block, W, H, pxX, pxY) {
    // two pass chamfer distance (metres) on the mask's own resolution
    const INF = 1e9, d = new Float32Array(W * H);
    for (let i = 0; i < d.length; i++) d[i] = block[i] ? 0 : INF;
    const dg = Math.hypot(pxX, pxY);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + pxX);
      if (y > 0) { v = Math.min(v, d[i - W] + pxY); if (x > 0) v = Math.min(v, d[i - W - 1] + dg); if (x < W - 1) v = Math.min(v, d[i - W + 1] + dg); }
      d[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + pxX);
      if (y < H - 1) { v = Math.min(v, d[i + W] + pxY); if (x < W - 1) v = Math.min(v, d[i + W + 1] + dg); if (x > 0) v = Math.min(v, d[i + W - 1] + dg); }
      d[i] = v;
    }
    return d;
  }
  function addField(m, keepPts) {
    const [[s, w], [n, e]] = m.bounds;
    const kLon = Math.cos((((s + n) / 2) * Math.PI) / 180);
    const pxX = ((e - w) / m.width) * KM_PER_DEG * kLon * 1000, pxY = ((n - s) / m.height) * KM_PER_DEG * 1000;
    const block = new Uint8Array(m.width * m.height);
    for (let i = 0; i < block.length; i++) block[i] = m.bits[i] & BLOCK_BITS ? 1 : 0;
    // keep the habitat and targets reachable: clear 75 m around them
    for (const pt of keepPts) {
      const cx = ((pt[1] - w) / (e - w)) * m.width, cy = ((n - pt[0]) / (n - s)) * m.height;
      const rx = 75 / pxX, ry = 75 / pxY;
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(m.height - 1, Math.ceil(cy + ry)); y++)
        for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(m.width - 1, Math.ceil(cx + rx)); x++)
          if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) block[y * m.width + x] = 0;
    }
    fields.push({ s, w, n, e, W: m.width, H: m.height, block, dist: distanceTransform(block, m.width, m.height, pxX, pxY) });
  }
  // distance (m) from a point to the nearest fine hazard; Infinity where no field covers it
  function hazardDist(lat, lon) {
    let best = Infinity;
    for (const f of fields) {
      if (lat < f.s || lat > f.n || lon < f.w || lon > f.e) continue;
      const fx = ((lon - f.w) / (f.e - f.w)) * f.W - 0.5, fy = ((f.n - lat) / (f.n - f.s)) * f.H - 0.5;
      const x0 = clamp(Math.floor(fx), 0, f.W - 2), y0 = clamp(Math.floor(fy), 0, f.H - 2);
      const tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1);
      const i = y0 * f.W + x0, d = f.dist;
      const v = (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty) + (d[i + f.W] * (1 - tx) + d[i + f.W + 1] * tx) * ty;
      best = Math.min(best, v);
    }
    return best;
  }

  // Merge a hazard mask (any resolution, lat/lon bounds) into the grid.
  // A planner cell takes a bit when more than `frac` of its pixels carry it.
  function mergeMask(D, m, frac = 0.12) {
    if (!G) G = buildGrid(D);
    addField(m, [D.habitat.pos, ...D.missions.flatMap((ms) => ms.objectives.map((ob) => ob.pos))]);
    const [[ms, mw], [mn, me]] = m.bounds;
    const tot = new Uint32Array(G.N), hits = {};
    const bitList = [1, 2, 4, 32, 64];
    for (const b of bitList) hits[b] = new Uint32Array(G.N);
    for (let y = 0; y < m.height; y++) {
      const lat = mn - ((y + 0.5) / m.height) * (mn - ms);
      if (lat > G.n || lat < G.s) continue;
      const r = Math.floor((G.n - lat) / G.dLat);
      for (let x = 0; x < m.width; x++) {
        const lon = mw + ((x + 0.5) / m.width) * (me - mw);
        if (lon < G.w || lon > G.e) continue;
        const c = Math.floor((lon - G.w) / G.dLon);
        if (r < 0 || c < 0 || r >= G.rows || c >= G.cols) continue;
        const i = r * G.cols + c, v = m.bits[y * m.width + x];
        tot[i]++;
        for (const b of bitList) if (v & b) hits[b][i]++;
      }
    }
    // the habitat and every target must stay reachable: clear hazards within ~75 m of them
    const keep = [D.habitat.pos, ...D.missions.flatMap((ms) => ms.objectives.map((ob) => ob.pos))];
    for (const pt of keep) {
      const c0 = G.cellOf(pt), r0 = (c0 / G.cols) | 0, k0 = c0 % G.cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r0 + dr, cc = k0 + dc;
        if (rr >= 0 && cc >= 0 && rr < G.rows && cc < G.cols) { const i = rr * G.cols + cc; hits[1][i] = hits[2][i] = hits[4][i] = hits[32][i] = 0; G.ext[i] &= ~BLOCK_BITS; }
      }
    }
    // distance from each planner cell centre to the nearest fine hazard
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
      const p = G.ll(r, c);
      G.hd[r * G.cols + c] = Math.min(G.hd[r * G.cols + c], hazardDist(p[0], p[1]));
    }
    let blocked = 0;
    for (let i = 0; i < G.N; i++) {
      if (!tot[i]) continue;
      for (const b of bitList) if (hits[b][i] / tot[i] > (b === 64 ? 0.3 : frac)) G.ext[i] |= b;
      if (G.ext[i] & BLOCK_BITS) blocked++;
    }
    return { blocked, cells: G.N };
  }

  // ---------- Dijkstra (binary heap) from one cell to all cells ----------
  function dijkstra(G, src, W) {
    const { rows, cols, N, cellKm } = G;
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const cost = new Float32Array(N);
    for (let i = 0; i < N; i++) cost[i] = cellCost(G, i, W);
    const heap = [], push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    dist[src] = 0; push(0, src);
    const nb = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [1, 1, Math.SQRT2]];
    while (heap.length) {
      const [d, i] = pop();
      if (d > dist[i]) continue;
      const r = (i / cols) | 0, c = i % cols;
      for (const [dr, dc, f] of nb) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        const cj = cost[j];
        if (cj === Infinity) continue;
        const nd = d + f * cellKm * (cost[i] === Infinity ? cj : (cost[i] + cj) / 2);
        if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(nd, j); }
      }
    }
    return { dist, prev };
  }

  // ---------- DFS with branch and bound over visiting orders ----------
  function bestOrder(C) {
    const n = C.length - 1; // index 0 is the habitat
    let best = Infinity, bestPath = null, nodes = 0;
    const path = [0], used = new Array(n + 1).fill(false);
    used[0] = true;
    (function dfs(cost) {
      nodes++;
      if (cost >= best) return; // bound: already worse than the best full tour
      if (path.length === n + 1) {
        const total = cost + C[path[n]][0];
        if (total < best) { best = total; bestPath = path.slice(); }
        return;
      }
      for (let k = 1; k <= n; k++) {
        if (used[k]) continue;
        used[k] = true; path.push(k);
        dfs(cost + C[path[path.length - 2]][k]);
        path.pop(); used[k] = false;
      }
    })(0);
    let fact = 1; for (let k = 2; k <= n; k++) fact *= k;
    return { order: bestPath || [...Array(n + 1).keys()], cost: best, nodes, orders: fact };
  }

  // String pulling: replace grid zigzags with straight segments wherever the
  // straight line is just as safe (no cell costlier than the path it replaces).
  function pullString(cells, W) {
    if (cells.length < 3) return cells;
    const out = [cells[0]];
    const rc = (i) => [(i / G.cols) | 0, i % G.cols];
    let a = 0;
    while (a < cells.length - 1) {
      let best = a + 1;
      let maxCost = 1;
      const fin = (x) => (x === Infinity ? 60 : x); // targets can sit on steep cells; never let that open the gate
      for (let b = a + 1; b < cells.length && b < a + 40; b++) {
        maxCost = Math.max(maxCost, fin(cellCost(G, cells[b], W)));
        const [r0, c0] = rc(cells[a]), [r1, c1] = rc(cells[b]);
        const steps = Math.ceil(Math.hypot(r1 - r0, c1 - c0) * 4);
        let ok = true;
        for (let s = 1; s < steps && ok; s++) {
          const r = Math.floor(r0 + 0.5 + ((r1 - r0) * s) / steps), c = Math.floor(c0 + 0.5 + ((c1 - c0) * s) / steps);
          const i = r * G.cols + c;
          const cc = cellCost(G, i, W);
          if (cc === Infinity || cc > maxCost * 1.05) ok = false;
        }
        if (ok) best = b;
      }
      out.push(cells[best]);
      a = best;
    }
    return out;
  }

  // Chaikin corner cutting: turns grid staircases into smooth driven curves
  function smooth(pts, iters = 3) {
    let p = pts;
    for (let it = 0; it < iters; it++) {
      const q = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      q.push(p[p.length - 1]);
      p = q;
    }
    return p;
  }

  // Split long straight pieces so smoothing keeps them close to the safe line
  function densifyLeg(leg) {
    const out = [leg[0]];
    for (let i = 1; i < leg.length; i++) {
      const a = leg[i - 1], b = leg[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.002));
      for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  }

  // Push points that are too close to a hazard outward along the distance gradient,
  // alternating with gentle smoothing, so the line traces the hazard outline as an arc.
  function hugOutline(leg, target) {
    if (!fields.length) return leg;
    const kLon = Math.cos((18.45 * Math.PI) / 180);
    const mLat = 1 / (KM_PER_DEG * 1000), mLon = 1 / (KM_PER_DEG * 1000 * kLon);
    let p = leg.map((q) => q.slice());
    const n = p.length;
    const keepEnd = (i) => i < 3 || i > n - 4; // targets and their approach stay fixed
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < n; i++) {
        if (keepEnd(i)) continue;
        for (let k = 0; k < 12; k++) {
          const d = hazardDist(p[i][0], p[i][1]);
          if (!(d < target)) break;
          const e = 8; // metres
          const gy = (hazardDist(p[i][0] + e * mLat, p[i][1]) - hazardDist(p[i][0] - e * mLat, p[i][1])) / (2 * e);
          const gx = (hazardDist(p[i][0], p[i][1] + e * mLon) - hazardDist(p[i][0], p[i][1] - e * mLon)) / (2 * e);
          const g = Math.hypot(gx, gy) || 1;
          const step = Math.min(40, target - d + 2);
          p[i][0] += (gy / g) * step * mLat;
          p[i][1] += (gx / g) * step * mLon;
        }
      }
      if (it < 5) {
        const q = p.map((v) => v.slice());
        for (let i = 1; i < n - 1; i++) {
          if (keepEnd(i)) continue;
          q[i][0] = p[i][0] * 0.5 + (p[i - 1][0] + p[i + 1][0]) * 0.25;
          q[i][1] = p[i][1] * 0.5 + (p[i - 1][1] + p[i + 1][1]) * 0.25;
        }
        p = q;
      }
    }
    return p;
  }

  // ---------- Public: plan a tour ----------
  let G = null;
  function plan(D, targets, W) {
    const t0 = performance.now();
    if (!G) G = buildGrid(D);
    const pts = [D.habitat.pos, ...targets.map((t) => t.pos)];
    const cells = pts.map((p) => G.cellOf(p));
    // one Dijkstra per point; relax rules once if something is unreachable
    let runs = cells.map((c) => dijkstra(G, c, W));
    let relaxed = false, runW = W;
    const unreachable = () => runs.some((run) => cells.some((c) => run.dist[c] === Infinity));
    if (unreachable()) {
      relaxed = true;
      const W2 = Object.assign({}, W, { maxSlope: 40, rock: W.rock === Infinity ? 30 : W.rock });
      runs = cells.map((c) => dijkstra(G, c, W2));
      runW = W2;
    }
    const C = runs.map((run) => cells.map((c) => run.dist[c]));
    const { order, nodes, orders } = bestOrder(C);
    // assemble legs
    const full = [order.concat(0)][0];
    const legs = [];
    let line = [];
    for (let k = 0; k < full.length - 1; k++) {
      const a = full[k], b = full[k + 1];
      const cellsPath = [];
      for (let i = cells[b]; i !== -1 && i !== cells[a]; i = runs[a].prev[i]) cellsPath.push(i);
      cellsPath.reverse();
      const pulled = pullString([cells[a], ...cellsPath], runW);
      const leg = [pts[a], ...pulled.slice(1, -1).map((i) => G.ll((i / G.cols) | 0, i % G.cols)), pts[b]];
      let sm = smooth(densifyLeg(leg), 3);
      if (runW.rock === Infinity) sm = hugOutline(sm, CLEAR_M + 10);
      legs.push(sm);
      line = line.concat(k === 0 ? sm : sm.slice(1));
    }
    return { line, legs, order: order.slice(1).map((k) => k - 1), nodes, orders, ms: performance.now() - t0, relaxed };
  }

  // Describe a finished line: climb, profile, terrain mix, hazards crossed
  function analyse(D, line, cum) {
    if (!G) G = buildGrid(D);
    let climb = 0, sandKm = 0, rockKm = 0, steepKm = 0, firmKm = 0;
    const elev = line.map((p) => G.elevAt(p[0], p[1]));
    let lastKm = 0, lastE = elev[0];
    for (let i = 1; i < line.length; i++) {
      if (cum[i] - lastKm >= 0.1 || i === line.length - 1) { if (elev[i] > lastE) climb += elev[i] - lastE; lastKm = cum[i]; lastE = elev[i]; }
    }
    const hazards = [];
    let inSand = false, inRock = false;
    for (let i = 1; i < line.length; i++) {
      const d = cum[i] - cum[i - 1];
      const c = G.cellOf(line[i]);
      const sd = G.sand[c] > 0.35, rk = G.rock[c] === 1 || hazardDist(line[i][0], line[i][1]) < 1, st = G.slope[c] > 12;
      if (sd) sandKm += d; else if (rk) rockKm += d; else firmKm += d;
      if (st) steepKm += d;
      if (sd && !inSand) hazards.push({ type: "sand", km: cum[i], end: cum[i] });
      if (rk && !inRock) hazards.push({ type: "rock", km: cum[i], end: cum[i] });
      if (sd) hazards.filter((h) => h.type === "sand").at(-1).end = cum[i];
      if (rk) hazards.filter((h) => h.type === "rock").at(-1).end = cum[i];
      inSand = sd; inRock = rk;
    }
    // ignore brief grazes of a hazard edge (under 80 m)
    for (let k = hazards.length - 1; k >= 0; k--) if (hazards[k].end - hazards[k].km < 0.08) hazards.splice(k, 1);
    const tot = sandKm + rockKm + firmKm || 1;
    return { climb, elev, steepKm, hazards,
      terrain: { sand: Math.round((sandKm / tot) * 100), rocky: Math.round((rockKm / tot) * 100), firm: 100 - Math.round((sandKm / tot) * 100) - Math.round((rockKm / tot) * 100) } };
  }

  // Hazard picture for the map overlay (canvas data URL over the plan area)
  function hazardImage(D) {
    if (!G) G = buildGrid(D);
    const cv = document.createElement("canvas");
    cv.width = G.cols; cv.height = G.rows;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(G.cols, G.rows);
    for (let i = 0; i < G.N; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      if (G.slope[i] > 12) { r = 214; g = 58; b = 44; a = clamp((G.slope[i] - 12) * 22, 70, 150); }
      else if (G.rock[i]) { r = 245; g = 180; b = 0; a = 120; }
      else if (G.sand[i] > 0.35) { r = 255; g = 236; b = 170; a = 90; }
      img.data.set([r, g, b, a], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    return { url: cv.toDataURL(), bounds: [[G.n - G.rows * G.dLat, G.w], [G.n, G.w + G.cols * G.dLon]] };
  }

  // Full resolution picture of the detected hazards and the safety margin
  function fieldImages() {
    return fields.map((f) => {
      const cv = document.createElement("canvas"); cv.width = f.W; cv.height = f.H;
      const ctx = cv.getContext("2d"), img = ctx.createImageData(f.W, f.H);
      for (let i = 0; i < f.block.length; i++) {
        const d = f.dist[i];
        if (f.block[i]) img.data.set([200, 20, 90, 165], i * 4);
        else if (d < CLEAR_M) img.data.set([200, 20, 90, 55], i * 4);
      }
      ctx.putImageData(img, 0, 0);
      return { url: cv.toDataURL(), bounds: [[f.s, f.w], [f.n, f.e]] };
    });
  }

  window.MomootPlanner = { plan, analyse, hazardImage, mergeMask, fieldImages, hazardDist, CLEAR_M, grid: () => G, init: (D) => { if (!G) G = buildGrid(D); return G; } };
})();
