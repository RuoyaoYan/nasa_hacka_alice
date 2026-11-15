/* Momoot · Komoot for Mars
 * Plain JavaScript, no build step. Map engine in marsmap.js, data in data/missions.js.
 */
(() => {
  "use strict";

  const D = window.MOMOOT_DATA;
  // Start planning must always close the intro, even if something below fails
  document.getElementById("btn-intro").addEventListener("click", () => { document.getElementById("intro").hidden = true; document.getElementById("tasks").hidden = false; document.body.dataset.screen = "tasks"; });
  const MarsMap = window.MarsMap;
  const SVGNS = "http://www.w3.org/2000/svg";
  const $ = (sel) => document.querySelector(sel);

  // ---------- Game rules ----------
  const RULES = {
    speedKmh: 6,            // pressurised rover on firm ground
    sandSlowdown: 0.5,      // 100 % sand would be 50 % slower
    o2PerKm: 1.5,           // life support % per km
    o2Per20mClimb: 0.5,     // life support % per 20 m climbed
    stopO2: 2,              // walking EVA at each stop
    stopMinutes: 30,
    powerPerKm: 1,          // rover power % per km
    dosePerMinute: 0.00045, // mSv per minute, close to the surface average Curiosity's RAD measured
    tourSeconds: 22,        // a whole tour plays in about this many seconds
    returnBoost: 2,
    fastForward: 3
  };

  const state = {
    screen: "intro", missionIdx: 0, routeIdx: 0, totals: { sample: 0, photo: 0, measure: 0, sightsee: 0, points: 0 },
    drawMode: false, drawPts: [], run: null,
    showRoutes: true, showHazards: true, showTraverse: false, traverse: null
  };

  // ---------- Helpers ----------
  function html(tag, attrs = {}, text) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === "class") n.className = v; else n.setAttribute(k, v); }
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function svg(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtMin = (m) => { m = Math.round(m); const h = Math.floor(m / 60); const mm = m % 60; return h ? `${h} h ${String(mm).padStart(2, "0")}` : `${mm} min`; };
  const fmtClock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
  const fmtLatLon = (lat, lon) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? "E" : "W"}`;
  const mission = () => D.missions[state.missionIdx];
  const route = () => mission().routes[state.routeIdx];

  // ---------- Developer settings ----------
  // "Demo weather" is only for recording demo videos: it swaps the forecast for a
  // dust storm scenario and makes the dust storm event show up early on every route.
  // Turn it on in Settings → Developers only, or open the page with ?demo=1 (?demo=0 turns it off).
  const DEV_KEY = "momoot.dev.demoWeather";
  const dev = { demoWeather: false };
  try {
    const q = new URLSearchParams(location.search).get("demo");
    if (q !== null) localStorage.setItem(DEV_KEY, q === "0" ? "0" : "1");
    dev.demoWeather = localStorage.getItem(DEV_KEY) === "1";
  } catch { /* storage blocked: demo weather stays off */ }
  const DEMO_DUST_AT = 0.3; // fraction of the outbound leg where the demo dust storm hits
  // the demo storm shown in the weather panel (visible dust opacity and wind)
  const DEMO_STORM = { tau: 1.45, wind: 42, note: "Regional dust storm building" };
  const dustBase = () => (dev.demoWeather ? ["Moderate", "warn"] : ["Low", "good"]);

  // ---------- Route planning ----------
  // Routes come from planner.js: a terrain cost map, Dijkstra between every
  // pair of targets, and a depth first search over visiting orders.
  const Planner = window.MomootPlanner;
  const TYPE = { sample: { label: "Sample", icon: "ph-flask" }, photo: { label: "Photo", icon: "ph-camera" }, measure: { label: "Measure", icon: "ph-gauge" }, sightsee: { label: "Sightseeing", icon: "ph-binoculars" } };
  const TODAY = D.missions[0];
  TODAY.objectives = D.tasks;
  state.selected = { [TODAY.id]: new Set(D.tasks.filter((t) => t.today).slice(0, 3).map((t) => t.id)) };
  // What scientists track instead of points: priority and the data each task returns
  const priority = (t) => (t.points >= 250 ? "High" : t.points >= 80 ? "Medium" : "Low");
  const PRODUCT = { sample: ["core sample", "core samples"], photo: ["image set", "image sets"], measure: ["measurement", "measurements"], sightsee: ["panorama", "panoramas"] };
  function returnOf(list) {
    const n = {}; for (const t of list) n[t.type] = (n[t.type] || 0) + 1;
    return Object.keys(PRODUCT).filter((k) => n[k]).map((k) => `${n[k]} ${PRODUCT[k][n[k] > 1 ? 1 : 0]}`).join(" · ") || "Nothing yet";
  }
  state.landing = D.landingSites[0].id;
  state.draftLanding = state.landing;
  const landingOf = (id) => D.landingSites.find((s) => s.id === id);
  // each landing site has its own letter (A, B, C, ...); the habitat badge shows the chosen site's letter
  const siteLetter = (id) => String.fromCharCode(65 + Math.max(0, D.landingSites.findIndex((s) => s.id === id)));
  const habLetter = () => siteLetter(state.landing);
  const habKm = (t) => MarsMap.distanceKm(landingOf(state.draftLanding).pos, t.pos);

  function measureLine(r) {
    r.cum = [0];
    for (let i = 1; i < r.dense.length; i++) r.cum.push(r.cum[i - 1] + MarsMap.distanceKm(r.dense[i - 1], r.dense[i]));
    r.km = r.cum[r.cum.length - 1];
  }

  function planMission(m) {
    const sel = state.selected[m.id];
    // plan the options in planOrder (fastest first); later ones keep away from the lines already planned
    const plans = {}, done = [];
    for (const [id, W] of Object.entries(D.profiles).sort((x, y) => (x[1].planOrder || 0) - (y[1].planOrder || 0))) {
      const picked = m.objectives.filter((o) => sel.has(o.id));
      const topId = picked.reduce((b, o) => (!b || o.points > b.points ? o : b), null).id;
      plans[id] = Planner.plan(D, picked.map((o) => ({ ...o, main: o.id === topId })), W, done);
      done.push(plans[id].line);
    }
    m.routes = Object.entries(D.profiles).map(([id, W]) => {
      const picked = m.objectives.filter((o) => sel.has(o.id));
      const topId = picked.reduce((b, o) => (!b || o.points > b.points ? o : b), null).id;
      const targets = picked.map((o) => ({ ...o, main: o.id === topId }));
      const plan = plans[id];
      const r = { id, label: W.label, note: W.note, color: W.color, plan, targets };
      r.dense = plan.line;
      measureLine(r);
      // where each target sits along the line (end of its leg)
      let acc = 0;
      r.allStops = plan.order.map((ti, k) => {
        for (let i = 1; i < plan.legs[k].length; i++) acc += MarsMap.distanceKm(plan.legs[k][i - 1], plan.legs[k][i]);
        const o = targets[ti];
        return { ...o, key: o.id, at: acc / r.km, order: k + 1, target: !!o.main };
      });
      const an = Planner.analyse(D, r.dense, r.cum);
      r.climb = Math.round(an.climb);
      const e0 = an.elev[0];
      r.profileKm = r.cum; r.profileElev = an.elev.map((v) => v - e0);
      r.terrain = an.terrain;
      r.steepKm = an.steepKm;
      // terrain events where the line first enters sand or boulders, plus the mission's weather
      const ev = [];
      const firstSand = an.hazards.find((h) => h.type === "sand"), firstRock = an.hazards.find((h) => h.type === "rock");
      if (firstRock) ev.push({ type: "rock", at: firstRock.km / r.km });
      if (firstSand) ev.push({ type: "sand", at: firstSand.km / r.km });
      if (!dev.demoWeather) for (const w of m.weather) ev.push({ ...w });
      if (r.km > 15) ev.push({ type: "radiation", at: 0.42 });
      ev.sort((x, y) => x.at - y.at);
      r.events = ev.filter((x, i) => i === 0 || x.at - ev[i - 1].at > 0.06).slice(0, 3);
      if (dev.demoWeather) {
        // demo videos: the dust storm always happens, early on, on every route
        const dust = { type: "dust", at: DEMO_DUST_AT };
        r.events = [...r.events.filter((x) => Math.abs(x.at - dust.at) > 0.06).slice(0, 2), dust].sort((x, y) => x.at - y.at);
      }
      r.risk = clamp(1 + (firstRock ? 1 : 0) + (firstSand || r.steepKm > 0.15 ? 1 : 0), 1, 3);
      const sandF = 1 + (an.terrain.sand / 100) * RULES.sandSlowdown;
      r.minPerKm = (60 / RULES.speedKmh) * sandF;
      const stopMin = r.allStops.reduce((t, s) => t + (s.minutes || RULES.stopMinutes), 0);
      r.totalMinutes = r.km * r.minPerKm + stopMin;
      r.o2Total = Math.round(r.km * RULES.o2PerKm + (r.climb / 20) * RULES.o2Per20mClimb + r.allStops.length * RULES.stopO2);
      return r;
    });
    // describe today's tour from what was picked
    const safest = m.routes[0], n = safest.allStops.length;
    m.difficulty = safest.km < 12 ? 1 : safest.km < 18 ? 2 : 3;
    const main = safest.allStops.find((s) => s.main);
    m.goal = `${n} task${n > 1 ? "s" : ""} picked at the habitat briefing. Main task: ${main.name}. The planner tried every visiting order and kept the shortest safe loop.`;
  }
  for (const m of D.missions) planMission(m);

  function pointAtKm(r, km) {
    km = clamp(km, 0, r.km);
    let lo = 1, hi = r.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (r.cum[mid] < km) lo = mid + 1; else hi = mid; }
    const i = lo, a = r.dense[i - 1], b = r.dense[i];
    const seg = r.cum[i] - r.cum[i - 1] || 1;
    const t = (km - r.cum[i - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  const pointAt = (r, frac) => pointAtKm(r, frac * r.km);
  function slice(r, kmFrom, kmTo) {
    const out = [pointAtKm(r, kmFrom)];
    for (let i = 0; i < r.dense.length; i++) if (r.cum[i] > kmFrom && r.cum[i] < kmTo) out.push(r.dense[i]);
    out.push(pointAtKm(r, kmTo));
    return out;
  }

  // ---------- Map ----------
  const map = new MarsMap($("#map"), { lat: D.habitat.pos[0], lon: D.habitat.pos[1], zoom: 14, minZoom: 3, maxZoom: 18 });
  const L = {};
  for (const def of D.mapLayers) L[def.id] = map.addTrekLayer(Object.assign({}, def));
  const layerIds = D.mapLayers.map((d) => d.id);
  const MOLA = layerIds[0], VIKING = layerIds[1], CTX = layerIds[2], HIRISE = layerIds[3];
  const THEMIS = layerIds.find((id) => id.startsWith("THEMIS"));
  if (THEMIS) map.setVisible(L[THEMIS], false); // overlay, off until ticked

  function setBase(mode) {
    map.setVisible(L[MOLA], mode === "mola");
    map.setVisible(L[VIKING], mode !== "mola");
    map.setVisible(L[CTX], mode === "auto");
    map.setVisible(L[HIRISE], mode === "auto");
  }
  setBase("auto");

  // Tile health: tell the person when NASA tiles can't be reached
  map.on("tileerror", () => {
    const vis = Object.values(L).filter((l) => l.visible);
    const dead = vis.length && vis.every((l) => l.loads === 0 && l.errors >= 6);
    const st = $("#map-status");
    if (dead) { st.textContent = "NASA Mars Trek tiles did not load. Check your internet connection, then reload the page."; st.hidden = false; }
  });
  map.on("render", () => { if (Object.values(L).some((l) => l.loads > 0)) $("#map-status").hidden = true; });

  // SVG overlay groups
  const gCrism = svg("g", { style: "display:none" }, map.svg);
  const gTerrain = svg("g", { style: "display:none" }, map.svg); // terrain types from the planner model
  const gHaz = svg("g", {}, map.svg);
  let hazImg = Planner.hazardImage(D);
  const hazEl = svg("image", { href: hazImg.url, preserveAspectRatio: "none", opacity: 0.6, style: "image-rendering: pixelated" }, gHaz);
  const gTraverse = svg("g", {}, map.svg);
  const gRoutes = svg("g", {}, map.svg);
  const gEva = svg("g", {}, map.svg);

  // HTML markers
  let markers = [];
  function setMarkers(list) {
    markers.forEach((m) => m.el.remove());
    markers = list.map((m) => { map.markerPane.appendChild(m.el); return m; });
    positionMarkers();
  }
  function positionMarkers() {
    const w = map.size().w;
    for (const m of markers) {
      const p = map.toScreen(m.pos[0], m.pos[1]);
      m.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      m.el.classList.toggle("flip", p.x > w - 260);
    }
  }
  function pinEl(cls, text, label, sub, color) {
    const wrap = html("div", { class: "mm-marker" });
    const pin = html("div", { class: `pin ${cls}` }, text || "");
    if (color) pin.style.background = color;
    if (label) {
      const l = html("div", { class: "pin-label" }, label);
      if (sub) l.append(html("small", {}, sub));
      pin.append(l);
    }
    wrap.append(pin);
    return wrap;
  }

  function pathD(pts) {
    let d = "";
    pts.forEach((p, i) => { const s = map.toScreen(p[0], p[1]); d += `${i ? "L" : "M"}${s.x.toFixed(1)} ${s.y.toFixed(1)}`; });
    return d;
  }

  function drawOverlays() {
    // CRISM mineral map, under the hazards
    gCrism.style.display = state.showCrism && state.crism ? "" : "none";
    if (state.showCrism && state.crism) {
      const [[s, w], [n, e]] = state.crism.bounds;
      const a = map.toScreen(n, w), b = map.toScreen(s, e);
      state.crism.el.setAttribute("x", a.x); state.crism.el.setAttribute("y", a.y);
      state.crism.el.setAttribute("width", Math.max(1, b.x - a.x)); state.crism.el.setAttribute("height", Math.max(1, b.y - a.y));
    }
    // terrain types (planner model), under the hazards
    gTerrain.style.display = state.showTerrain ? "" : "none";
    if (state.showTerrain && state.terrainImg) {
      const [[s, w], [n, e]] = state.terrainImg.bounds;
      const a = map.toScreen(n, w), b = map.toScreen(s, e);
      const el = state.terrainImg.el;
      el.setAttribute("x", a.x); el.setAttribute("y", a.y);
      el.setAttribute("width", Math.max(1, b.x - a.x)); el.setAttribute("height", Math.max(1, b.y - a.y));
    }
    // hazard map from the planner's cost grid
    gHaz.style.display = state.showHazards ? "" : "none";
    if (state.showHazards) {
      const [[s, w], [n, e]] = hazImg.bounds;
      const a = map.toScreen(n, w), b = map.toScreen(s, e);
      hazEl.setAttribute("x", a.x); hazEl.setAttribute("y", a.y);
      hazEl.setAttribute("width", Math.max(1, b.x - a.x)); hazEl.setAttribute("height", Math.max(1, b.y - a.y));
      for (const f of fieldEls) {
        const [[fs, fw], [fn, fe]] = f.bounds;
        const p = map.toScreen(fn, fw), q = map.toScreen(fs, fe);
        f.el.setAttribute("x", p.x); f.el.setAttribute("y", p.y);
        f.el.setAttribute("width", Math.max(1, q.x - p.x)); f.el.setAttribute("height", Math.max(1, q.y - p.y));
      }
    }
    // Perseverance traverse
    gTraverse.innerHTML = "";
    if (state.showTraverse && state.traverse) {
      for (const line of state.traverse) {
        svg("path", { d: pathD(line), fill: "none", stroke: "#FFFFFF", "stroke-width": 3, "stroke-dasharray": "2 5", "stroke-linecap": "round", opacity: 0.9 }, gTraverse);
      }
    }
    // Routes
    gRoutes.innerHTML = "";
    const m = mission();
    const inEva = !!state.run;
    if (state.showRoutes || inEva) {
      // while new routes are being revealed, each line grows from the habitat (see revealRoutes)
      const part = (r, i) => { const p = inEva ? 1 : routeProgress(i); return p >= 1 ? r.dense : p <= 0 ? null : slice(r, 0, p * r.km); };
      if (!inEva) {
        m.routes.forEach((r, i) => {
          if (i === state.routeIdx) return;
          const line = part(r, i); if (!line) return;
          svg("path", { d: pathD(line), fill: "none", stroke: "#1D1C1A", "stroke-width": 7, opacity: 0.35, "stroke-linejoin": "round" }, gRoutes);
          svg("path", { d: pathD(line), fill: "none", stroke: r.color, "stroke-width": 4, "stroke-dasharray": "10 6", "stroke-linejoin": "round", opacity: 0.95 }, gRoutes);
        });
      }
      const r = route();
      const line = part(r, state.routeIdx);
      if (!line) { /* not revealed yet */ } else {
      const d = pathD(line);
      svg("path", { d, fill: "none", stroke: "#FFFFFF", "stroke-width": 10, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: inEva ? 0.6 : 1 }, gRoutes);
      svg("path", { d, fill: "none", stroke: r.color, "stroke-width": 6, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: inEva ? 0.45 : 1 }, gRoutes);
      if (line === r.dense) drawArrows(r, gRoutes);
      }
    }
    // part of the route selected on the elevation chart
    if (state.sel && !state.run) {
      const part = slice(route(), state.sel[0], state.sel[1]);
      svg("path", { d: pathD(part), fill: "none", stroke: "#1D1C1A", "stroke-width": 14, opacity: 0.35, "stroke-linecap": "round", "stroke-linejoin": "round" }, gRoutes);
      svg("path", { d: pathD(part), fill: "none", stroke: "#FFD84D", "stroke-width": 8, "stroke-linecap": "round", "stroke-linejoin": "round" }, gRoutes);
    }
    // EVA: walked track, return path
    gEva.innerHTML = "";
    if (state.run) {
      const run = state.run, r = run.r;
      const walked = slice(r, 0, run.dir > 0 ? run.km : run.maxKm);
      svg("path", { d: pathD(walked), fill: "none", stroke: r.color, "stroke-width": 6, "stroke-linejoin": "round", "stroke-linecap": "round" }, gEva);
      if (run.returnPath) {
        const d2 = pathD(run.returnPath);
        svg("path", { d: d2, fill: "none", stroke: "#1D1C1A", "stroke-width": 9, opacity: 0.45, "stroke-linecap": "round" }, gEva);
        svg("path", { d: d2, fill: "none", stroke: "#F5B400", "stroke-width": 5, "stroke-dasharray": "12 7", "stroke-linecap": "round" }, gEva);
      }
    }
    positionMarkers();
    updateScale();
  }

  // Direction arrows along the selected route, like Komoot
  function drawArrows(r, parent) {
    const pts = r.dense.map((p) => map.toScreen(p[0], p[1]));
    let acc = 0, next = 60;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (seg > 0 && acc + seg >= next) {
        const t = (next - acc) / seg;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        svg("path", { d: "M-3 -3 L1 0 L-3 3", transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})`, fill: "none", stroke: "#FFFFFF", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" }, parent);
        next += 90;
      }
      acc += seg;
    }
  }

  function updateScale() {
    const mpp = map.metersPerPixel();
    const maxM = mpp * 120;
    const pow = Math.pow(10, Math.floor(Math.log10(maxM)));
    const nice = [5, 2, 1].map((k) => k * pow).find((v) => v <= maxM) || pow;
    $("#scale-bar").style.width = `${Math.round(nice / mpp)}px`;
    $("#scale-label").textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
  }

  function buildMarkers() {
    const m = mission(), r = route();
    const list = [];
    const stopPts = r.allStops.map((s) => s.pos);
    for (const lm of D.landmarks) {
      if (stopPts.some((p) => MarsMap.distanceKm(p, lm.pos) < 0.05)) continue; // a stop already marks this spot
      list.push({ pos: lm.pos, el: pinEl("landmark", "", lm.name, lm.note) });
    }
    if (state.showHazards) {
      for (const ev of r.events) {
        if (ev.type === "rock" || ev.type === "sand") {
          list.push({ pos: pointAt(r, ev.at), el: pinEl("hazard", "!", ev.type === "rock" ? "Boulder field" : "Soft sand", ev.type === "rock" ? "HiRISE" : "HiRISE ripples · see THEMIS layer") });
        }
      }
    }
    // targets not on this route: faint, click to add
    const onRoute = new Set(r.allStops.map((s) => s.id));
    if (false) {
      for (const o of m.objectives) {
        if (onRoute.has(o.id)) continue;
        const el = pinEl("off", "+", o.name, `${TYPE[o.type].label} · ${priority(o)} priority`);
        el.classList.add("clickable"); el.title = "Add this target";
        el.addEventListener("click", (e) => { e.stopPropagation(); toggleObjective(o.id, true); });
        list.push({ pos: o.pos, el });
      }
    }
    for (const s of r.allStops) {
      const el = pinEl(s.main ? "target" : "stop", String(s.order), s.name, `${TYPE[s.type].label} · ${priority(s)} priority`, s.main ? null : r.color);
      list.push({ pos: s.pos, el });
    }
    if (state.showPhotos) {
      for (const h of highlights) {
        const el = html("div", { class: "mm-marker" });
        const pin = html("div", { class: `pin photo ${h.tag}`, tabindex: "0", "aria-label": `${TAGS[h.tag].label} photo point: ${h.title}` });
        pin.innerHTML = `<i class="ph-fill ${TAGS[h.tag].icon}" aria-hidden="true"></i>`;
        if (!state.run) { const lb = html("div", { class: "pin-label" }, h.title); lb.append(html("small", {}, `${TAGS[h.tag].label} · ${h.by}`)); pin.append(lb); }
        el.append(pin);
        list.push({ pos: h.pos, el });
      }
    }
    list.push({ pos: D.habitat.pos, el: pinEl("", habLetter(), "Habitat", D.habitat.name) });
    state.playerMarker = null;
    if (state.run) {
      const el = html("div", { class: "mm-marker" });
      el.append(html("div", { class: "player", "aria-label": "You" }));
      state.playerMarker = { pos: pointAtKm(state.run.r, state.run.km), el };
      list.push(state.playerMarker);
    }
    for (const p of state.drawPts) { const el = html("div", { class: "mm-marker" }); el.append(html("div", { class: "draw-pt" })); list.push({ pos: p, el }); }
    setMarkers(list);
  }

  // ---------- Route reveal: fly over to the new routes, then draw them one after another ----------
  const REVEAL = { stagger: 350, dur: 1100 };
  function revealOrder() { // the other options first, the selected one last (on top)
    const n = mission().routes.length, idx = [...Array(n).keys()].filter((i) => i !== state.routeIdx);
    return [...idx, state.routeIdx];
  }
  function routeProgress(i) {
    const a = state.routeAnim; if (!a) return 1;
    if (a.t0 == null) return 0; // still flying
    const k = revealOrder().indexOf(i);
    const t = (performance.now() - a.t0 - k * REVEAL.stagger) / REVEAL.dur;
    return t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 2);
  }
  function revealRoutes(flyMs = 1400) {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { state.routeAnim = null; fitRoute(true, 0); drawOverlays(); return; }
    const anim = state.routeAnim = { t0: null };
    drawOverlays();
    const m = mission(), pts = [D.habitat.pos, ...m.routes.flatMap((r) => r.dense)];
    const v = map.fitBounds(pts, 90, 16.5);
    map.flyTo(v.lat, v.lon, v.zoom, flyMs, { arc: true, done: () => {
      if (state.routeAnim !== anim) return;
      anim.t0 = performance.now();
      const total = REVEAL.dur + REVEAL.stagger * (m.routes.length - 1);
      const tick = () => {
        if (state.routeAnim !== anim) return;
        drawOverlays();
        if (performance.now() - anim.t0 < total) requestAnimationFrame(tick); else { state.routeAnim = null; drawOverlays(); }
      };
      requestAnimationFrame(tick);
    } });
  }

  function fitRoute(all = true, ms = 700) {
    const m = mission();
    const pts = [D.habitat.pos, ...(all ? m.routes.flatMap((r) => r.dense) : route().dense)];
    const v = map.fitBounds(pts, 90, 16.5);
    map.flyTo(v.lat, v.lon, v.zoom, ms);
  }

  map.on("render", drawOverlays);

  // Deep link to the same view in NASA Mars Trek (same projection as Trek's own URLs)
  function updateTrekLink() {
    const c = map.center;
    const hash = `v=0.1&x=${c.lon.toFixed(5)}&y=${c.lat.toFixed(5)}&z=${Math.round(map.zoom)}&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104905&d=&locale=&b=mars&e=&sfz=&w=`;
    $("#lnk-trek").href = `https://trek.nasa.gov/mars/#${hash}`;
  }
  map.on("render", updateTrekLink);

  // Cursor coordinates
  $("#map").addEventListener("pointermove", (e) => {
    const rc = $("#map").getBoundingClientRect();
    const ll = map.fromScreen(e.clientX - rc.left, e.clientY - rc.top);
    $("#coords").textContent = fmtLatLon(ll.lat, ll.lon);
  });

  // Draw mode clicks
  map.on("click", (ll) => {
    if (!state.drawMode) return;
    state.drawPts.push([+ll.lat.toFixed(5), +ll.lon.toFixed(5)]);
    console.log("Momoot draw mode points [lat, lon]:", JSON.stringify(state.drawPts));
    buildMarkers();
    toast(`Point ${fmtLatLon(ll.lat, ll.lon)} added. ${state.drawPts.length} points logged to the console.`);
  });

  // ---------- Map controls ----------
  $("#btn-zin").addEventListener("click", () => map.zoomBy(1));
  $("#btn-zout").addEventListener("click", () => map.zoomBy(-1));
  $("#btn-fit").addEventListener("click", () => fitRoute(!state.run));
  $("#btn-full").addEventListener("click", () => {
    const card = $("#map-card");
    const full = card.classList.toggle("full");
    $("#btn-full").innerHTML = full ? '<i class="ph ph-arrows-in-simple" aria-hidden="true"></i>' : '<i class="ph ph-arrows-out-simple" aria-hidden="true"></i>';
    $("#btn-full").setAttribute("aria-label", full ? "Exit full screen map" : "Full screen map");
    requestAnimationFrame(() => map.render());
  });
  $("#btn-layers").addEventListener("click", () => {
    const p = $("#layer-panel"); p.hidden = !p.hidden;
    $("#btn-layers").setAttribute("aria-expanded", String(!p.hidden));
  });
  document.querySelectorAll('input[name="base"]').forEach((r) => r.addEventListener("change", (e) => setBase(e.target.value)));
  $("#ov-routes").addEventListener("change", (e) => { state.showRoutes = e.target.checked; drawOverlays(); });
  $("#ov-hazards").addEventListener("change", (e) => { state.showHazards = e.target.checked; buildMarkers(); drawOverlays(); });
  // THEMIS daytime thermal infrared (Mars Odyssey), live Mars Trek tiles
  $("#ov-themis").addEventListener("change", (e) => {
    map.setVisible(L[THEMIS], e.target.checked);
    $("#themis-legend").hidden = !e.target.checked;
    if (e.target.checked && map.zoom > 12.5) toast("THEMIS pixels are 100 m wide, so zoom out to see the sand and bedrock pattern.");
  });
  // CRISM mineral map (MRO), made by tools/crism/make_crism_overlay.py
  function loadCrism() {
    return fetch(D.crism.meta, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("missing"))))
      .then((meta) => {
        const el = svg("image", { href: D.crism.image, preserveAspectRatio: "none", opacity: 0.8 }, gCrism);
        state.crism = { bounds: meta.bounds, el, meta };
        $("#crism-legend img").src = D.crism.legend;
        $("#crism-note").textContent = "";
        $("#ov-crism").disabled = false;
        drawOverlays();
      })
      .catch(() => {
        $("#ov-crism").disabled = true;
        $("#crism-note").textContent = "(not built yet: run tools/crism/make_crism_overlay.py)";
      });
  }
  $("#ov-terrain").addEventListener("change", (e) => {
    state.showTerrain = e.target.checked;
    if (state.showTerrain && !state.terrainImg) {
      const t = Planner.terrainImage(D);
      state.terrainImg = { ...t, el: svg("image", { href: t.url, preserveAspectRatio: "none", style: "image-rendering: pixelated" }, gTerrain) };
      const ul = $("#terrain-legend"); ul.innerHTML = "";
      for (const [, [name, col]] of Object.entries(TERRAIN_NAMES)) { const li = html("li"); const sw = html("i"); sw.style.background = col; li.append(sw, document.createTextNode(name)); ul.append(li); }
    }
    $("#terrain-legend").hidden = !state.showTerrain;
    if (state.showTerrain) { const [[s, w], [n, ee]] = state.terrainImg.bounds; const v = map.fitBounds([[s, w], [n, ee]], 30, 14); map.flyTo(v.lat, v.lon, v.zoom, 800); }
    drawOverlays();
  });
  $("#ov-crism").addEventListener("change", (e) => {
    state.showCrism = e.target.checked;
    $("#crism-legend").hidden = !e.target.checked;
    if (e.target.checked) { const [[s, w], [n, ee]] = state.crism.bounds; const v = map.fitBounds([[s, w], [n, ee]], 40, 15); if (map.zoom < v.zoom - 2 || map.zoom > v.zoom + 3) map.flyTo(v.lat, v.lon, v.zoom, 700); }
    drawOverlays();
  });
  loadCrism();
  $("#ov-traverse").addEventListener("change", (e) => {
    state.showTraverse = e.target.checked;
    if (state.showTraverse && !state.traverse) loadTraverse(); else drawOverlays();
  });

  function loadTraverse() {
    if (window.M20_WAYPOINTS) { // bundled copy of NASA's waypoint file: no server needed
      state.traverse = [window.M20_WAYPOINTS.map((w) => [w[0], w[1]])];
      $("#traverse-note").textContent = "";
      drawOverlays();
      return;
    }
    $("#traverse-note").textContent = "(loading)";
    fetch(D.traverseUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((gj) => {
        const lines = [];
        for (const f of gj.features || []) {
          const g = f.geometry; if (!g) continue;
          const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
          for (const part of parts) lines.push(part.map((c) => [c[1], c[0]]));
        }
        if (!lines.length) throw new Error("no lines");
        state.traverse = lines;
        $("#traverse-note").textContent = "";
        drawOverlays();
        toast("Perseverance's real path loaded from NASA JPL.");
      })
      .catch(() => {
        state.showTraverse = false;
        $("#ov-traverse").checked = false;
        $("#traverse-note").textContent = "(NASA server did not allow loading it here)";
        toast("Could not load Perseverance's path. NASA's server did not allow this page to read it.");
      });
  }

  // ---------- Plan column ----------

  function renderPlan() {
    const m = mission(), r = route();
    $("#m-name").textContent = m.name;
    $("#m-goal").textContent = m.goal;
    const meta = $("#m-meta"); meta.innerHTML = "";
    const addMeta = (icon, label, val) => { const li = html("li"); li.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`; li.append(document.createTextNode(label + " "), html("strong", {}, val)); meta.append(li); };
    addMeta("ph-mountains", "Difficulty", ["", "Easy", "Moderate", "Hard"][m.difficulty]);
    addMeta("ph-flag-banner", "Tasks", `${r.allStops.length}`);
    addMeta("ph-package", "Science return", returnOf(r.allStops));
    renderObjectives(m, r);

    const list = $("#route-list"); list.innerHTML = "";
    m.routes.forEach((rt, i) => {
      const b = html("button", { class: "route-card", type: "button", role: "radio", "aria-checked": String(i === state.routeIdx) });
      b.style.setProperty("--route-color", rt.color);
      const sw = html("span", { class: "swatch" }); sw.style.background = rt.color;
      const t = html("span", { class: "t" });
      t.append(html("span", { class: "title-3" }, rt.label), html("span", { class: "caption-5 muted" }, rt.note));
      const rr = html("span", { class: "r" });
      rr.append(html("span", { class: "title-4" }, `${rt.km.toFixed(1)} km`), html("span", { class: "caption-5 muted" }, fmtMin(rt.totalMinutes)));
      b.append(sw, t, rr);
      b.addEventListener("click", () => selectRoute(i));
      list.append(b);
    });

    const stats = $("#route-stats"); stats.innerHTML = "";
    const add = (dd, dt) => { const d = html("div"); d.append(html("dd", { class: "heading-6" }, dd), html("dt", { class: "caption-5" }, dt)); stats.append(d); };
    add(fmtMin(r.totalMinutes), "Duration");
    add(`${r.km.toFixed(1)} km`, "Distance");
    add(`↑ ${r.climb} m`, "Climb");
    add(`${r.o2Total} %`, "Life support");

    renderDetails(r, m);

    const riskCols = ["#2E9E52", "#C27803", "#C8322B"];
    [...$("#route-risk").children].forEach((s, i) => { s.style.background = i < r.risk ? riskCols[r.risk - 1] : ""; });

    renderWaypoints(r, m);
  }

  // ---------- Route details (Komoot style) ----------
  const BASE_ELEV = -2570; // Jezero crater floor, metres relative to the Mars datum (approximate)
  const fmtM = (v) => `${v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en")} m`;
  const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km`);

  // Elevation every 25 m along the route
  function profileOf(r) {
    if (r._prof) return r._prof;
    const out = [];
    for (let km = 0; km <= r.km + 1e-9; km += 0.025) {
      const p = pointAtKm(r, Math.min(km, r.km));
      out.push({ km: Math.min(km, r.km), e: BASE_ELEV + Planner.elevAt(p[0], p[1]) });
    }
    // light smoothing so 25 m steps don't read as bumps
    const sm = out.map((q, i) => { let s = 0, n = 0; for (let k = -2; k <= 2; k++) { const v = out[i + k]; if (v) { s += v.e; n++; } } return { km: q.km, e: s / n }; });
    return (r._prof = sm);
  }
  function rangeStats(prof, k0, k1) {
    let up = 0, down = 0, hi = -Infinity, lo = Infinity;
    for (let i = 0; i < prof.length; i++) {
      const q = prof[i]; if (q.km < k0 || q.km > k1) continue;
      hi = Math.max(hi, q.e); lo = Math.min(lo, q.e);
      const pr = prof[i - 1];
      if (pr && pr.km >= k0) { const d = q.e - pr.e; if (d > 0) up += d; else down -= d; }
    }
    return { up, down, hi, lo };
  }
  function climbsOf(prof, sign) {
    const out = [];
    let start = 0, best = 0;
    const val = (i) => sign * prof[i].e;
    for (let i = 1; i < prof.length; i++) {
      if (val(i) > val(best)) best = i;
      if (val(best) - val(i) > 6 || i === prof.length - 1) {
        const gain = val(best) - val(start), len = prof[best].km - prof[start].km;
        if (gain >= 12 && len >= 0.2) out.push({ from: prof[start].km, to: prof[best].km, gain, len, grade: (gain / (len * 1000)) * 100 });
        start = i; best = i;
      }
      if (val(i) < val(start)) { start = i; best = i; }
    }
    return out;
  }

  function renderDetails(r, m) {
    state.sel = null;
    renderProfile(r);
    renderClimbs(r);
    renderSurfaces(r);
    renderWeather();
    renderRouteNotes(r);
    renderHighlights();
  }

  function renderProfile(r) {
    const s = $("#route-profile"); s.innerHTML = "";
    const prof = profileOf(r);
    const W = 480, H = 190, l = 56, rr = 14, t = 40, b = 30;
    const es = prof.map((q) => q.e);
    const lo0 = Math.min(...es), hi0 = Math.max(...es);
    const span = Math.max(30, hi0 - lo0);
    const step = span > 400 ? 200 : span > 150 ? 50 : span > 60 ? 20 : 10;
    const bot = Math.floor(lo0 / step) * step, top = Math.ceil(hi0 / step) * step + (Math.ceil(hi0 / step) * step === bot ? step : 0);
    const X = (km) => l + (km / r.km) * (W - l - rr);
    const Y = (v) => t + (1 - (v - bot) / (top - bot)) * (H - t - b);
    const txt = (x, y, str, o = {}) => { const n = svg("text", Object.assign({ x, y, "font-size": 12, "font-family": "Poppins, sans-serif", fill: "#8C877D" }, o), s); n.textContent = str; return n; };
    const ticks = [bot, (bot + top) / 2, top];
    for (const v of ticks) { svg("line", { x1: l, x2: W - rr, y1: Y(v), y2: Y(v), stroke: "#D6D1C6", "stroke-dasharray": "4 4" }, s); txt(l - 8, Y(v) + 4, fmtM(v), { "text-anchor": "end" }); }
    const kStep = r.km > 15 ? 5 : r.km > 6 ? 2 : 1;
    for (let k = kStep; X(r.km) - X(k) > 44; k += kStep) { svg("line", { x1: X(k), x2: X(k), y1: t, y2: H - b, stroke: "#D6D1C6", "stroke-dasharray": "4 4" }, s); txt(X(k), H - 10, `${k} km`, { "text-anchor": "middle" }); }
    txt(l, H - 10, "0 m"); txt(W - rr, H - 10, `${r.km.toFixed(1)} km`, { "text-anchor": "end" });
    // area + line, steep stretches in orange
    let d = "";
    prof.forEach((q, i) => { d += `${i ? "L" : "M"}${X(q.km).toFixed(1)} ${Y(q.e).toFixed(1)}`; });
    svg("path", { d: `${d}L${X(r.km)} ${Y(bot)}L${X(0)} ${Y(bot)}Z`, fill: "#7FB24A", opacity: 0.16 }, s);
    svg("path", { d, fill: "none", stroke: "#7FB24A", "stroke-width": 2.2, "stroke-linejoin": "round" }, s);
    for (let i = 1; i < prof.length; i++) {
      const g = Math.abs(prof[i].e - prof[i - 1].e) / 25;
      if (g > 0.08) {
        svg("rect", { x: X(prof[i - 1].km), y: t, width: Math.max(1, X(prof[i].km) - X(prof[i - 1].km)), height: H - t - b, fill: "#F2B27A", opacity: 0.25 }, s);
        svg("line", { x1: X(prof[i - 1].km), y1: Y(prof[i - 1].e), x2: X(prof[i].km), y2: Y(prof[i].e), stroke: "#E8762C", "stroke-width": 2.6 }, s);
      }
    }
    // markers: A at both ends, targets by order
    const mark = (km, label, fill) => {
      const x = X(km), g = svg("g", { transform: `translate(${x} 18)` }, s);
      svg("rect", { x: -10, y: -10, width: 20, height: 20, fill }, g);
      const n = svg("text", { x: 0, y: 4, "text-anchor": "middle", "font-size": 11, "font-family": "Poppins, sans-serif", "font-weight": 600, fill: "#FFFFFF" }, g); n.textContent = label;
    };
    mark(0, habLetter(), "#1D1C1A");
    for (const st of r.allStops) mark(st.at * r.km, String(st.order), st.main ? "#C2410C" : r.color);
    mark(r.km, habLetter(), "#1D1C1A");
    // selection layer
    const selRect = svg("rect", { x: 0, y: t, width: 0, height: H - t - b, fill: "#1D1C1A", opacity: 0.12, visibility: "hidden" }, s);
    const toKm = (ev) => { const rc = s.getBoundingClientRect(); const x = ((ev.clientX - rc.left) / rc.width) * W; return clamp(((x - l) / (W - l - rr)) * r.km, 0, r.km); };
    let k0 = null;
    s.onpointerdown = (ev) => { k0 = toKm(ev); s.setPointerCapture(ev.pointerId); };
    s.onpointermove = (ev) => {
      if (k0 === null) return;
      const k1 = toKm(ev), a = Math.min(k0, k1), z = Math.max(k0, k1);
      if (z - a < 0.05) return;
      selRect.setAttribute("x", X(a)); selRect.setAttribute("width", X(z) - X(a)); selRect.setAttribute("visibility", "visible");
      setSelection(r, prof, a, z);
    };
    s.onpointerup = (ev) => {
      const k1 = k0 === null ? null : toKm(ev);
      if (k0 !== null && Math.abs(k1 - k0) < 0.05) { selRect.setAttribute("visibility", "hidden"); setSelection(r, prof, null); }
      k0 = null;
    };
    setSelection(r, prof, null);
  }

  function setSelection(r, prof, a, z) {
    const st = a === null ? rangeStats(prof, 0, r.km) : rangeStats(prof, a, z);
    const box = $("#elev-stats"); box.innerHTML = "";
    const add = (dd, dt) => { const d = html("div"); d.append(html("dd", { class: "heading-6" }, dd), html("dt", { class: "caption-5" }, dt)); box.append(d); };
    add(`${Math.round(st.up)} m`, "Uphill"); add(`${Math.round(st.down)} m`, "Downhill"); add(fmtM(st.hi), "Highest point"); add(fmtM(st.lo), "Lowest point");
    if (a === null) {
      state.sel = null;
      $("#elev-hint").textContent = "Nothing selected. Click and drag on the chart to see the stats for part of the route.";
    } else {
      state.sel = [a, z];
      const len = z - a, net = (prof.find((q) => q.km >= z) || prof[prof.length - 1]).e - (prof.find((q) => q.km >= a) || prof[0]).e;
      $("#elev-hint").textContent = `Selected ${a.toFixed(2)} to ${z.toFixed(2)} km: ${fmtKm(len)}, average grade ${((net / (len * 1000)) * 100).toFixed(1)} %. Highlighted on the map.`;
    }
    drawOverlays();
  }

  state.cdTab = "climbs";
  function renderClimbs(r) {
    const prof = profileOf(r);
    const list = state.cdTab === "climbs" ? climbsOf(prof, 1) : climbsOf(prof, -1);
    const ol = $("#climbs"); ol.innerHTML = "";
    if (!list.length) { ol.append(html("li", { class: "empty" }, state.cdTab === "climbs" ? "No climbs over 12 m on this route." : "No descents over 12 m on this route.")); return; }
    list.sort((x, y) => y.gain - x.gain).slice(0, 6).forEach((c, i) => {
      const li = html("li");
      const cat = c.grade < 4 ? ["#7FB24A", "Easy"] : c.grade < 8 ? ["#E8B23C", "Moderate"] : ["#D9452B", "Hard"];
      const sw = html("i"); sw.style.background = cat[0];
      const ce = html("span", { class: "cat body-6" }); ce.append(sw, document.createTextNode(cat[1]));
      li.append(html("span", { class: "n" }, `#${i + 1}`), ce);
      const g = html("span"); g.innerHTML = `△ <strong>${c.grade.toFixed(0)}</strong> %`;
      const h = html("span"); h.innerHTML = `${state.cdTab === "climbs" ? "↗" : "↘"} <strong>${Math.round(c.gain)}</strong> m`;
      const d = html("span"); d.innerHTML = `↔ <strong>${c.len.toFixed(2)}</strong> km`;
      li.append(g, h, d);
      li.style.cursor = "pointer";
      li.title = "Show this part on the chart and map";
      li.addEventListener("click", () => setSelection(r, prof, c.from, c.to));
      ol.append(li);
    });
  }
  document.querySelectorAll("[data-cd]").forEach((b) => b.addEventListener("click", () => {
    state.cdTab = b.dataset.cd;
    document.querySelectorAll("[data-cd]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    renderClimbs(route());
  }));

  const TERRAIN_LABELS = { floor: "Crater floor", delta: "Delta deposits", margin: "Margin unit (olivine, carbonate)", channel: "River channel (Neretva Vallis)", crater: "Impact crater (Belva)",
    rim: "Crater rim slopes", ridges: "Valleys and ridges (Lac de Charmes)", megabreccia: "Megabreccia blocks", sand: "Sand ripple fields" };
  const TERRAIN_NAMES = Object.fromEntries(Object.entries(TERRAIN_LABELS).map(([k, v]) => { const c = Planner.TERRAIN_COLORS[k]; return [k, [v, `rgb(${c[0]}, ${c[1]}, ${c[2]})`]]; }));
  const SURF_NAMES = { bedrock: ["Bedrock", "#8D96A3"], gravel: ["Gravel slope", "#C5BFB4"], sand: ["Loose sand", "#E6D3A8"], rough: ["Rough ground", "#A99474"], boulders: ["Boulders", "#8A7F76"], unknown: ["Unknown", "#111111"] };
  function renderSurfaces(r) {
    const tKm = {}, sKm = {};
    for (let i = 1; i < r.dense.length; i++) {
      const a = r.dense[i - 1], b = r.dense[i], d = r.cum[i] - r.cum[i - 1];
      const c = Planner.classify((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      tKm[c.terrain] = (tKm[c.terrain] || 0) + d; sKm[c.surface] = (sKm[c.surface] || 0) + d;
    }
    const draw = (bar, list, km, names) => {
      const B = $(bar), Ls = $(list); B.innerHTML = ""; Ls.innerHTML = "";
      Object.entries(km).filter(([, v]) => v > 0.005).sort((x, y) => y[1] - x[1]).forEach(([k, v]) => {
        const [name, col] = names[k];
        const sp = html("span"); sp.style.width = `${(v / r.km) * 100}%`; sp.style.background = col; B.append(sp);
        const li = html("li"); const sw = html("i"); sw.style.background = col;
        li.append(sw, html("span", {}, name), html("span", { class: "km" }, fmtKm(v)));
        Ls.append(li);
      });
    };
    draw("#way-bar", "#way-list", tKm, TERRAIN_NAMES);
    draw("#surf-bar", "#surf-list", sKm, SURF_NAMES);
  }

  // Measured weather: Perseverance MEDA (live NASA feed, or the copy in data/weather.js)
  // and the dust climatology for this season at Jezero (Montabone et al.)
  const WX = window.MOMOOT_WEATHER || { meda: { sols: [] }, dust: null };
  state.wx = { sols: WX.meda.sols, live: false };
  const num = (v) => (typeof v === "number" ? v : v === "--" || v == null || v === "" ? null : Number(v));
  const fmtT = (v) => (v == null || Number.isNaN(v) ? "n/a" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)} °C`);
  const hhmm = (t) => (t || "").slice(0, 5);
  function dustAt(ls) {
    const d = WX.dust; if (!d || ls == null) return null;
    const b = clamp(Math.floor(ls / d.binDeg), 0, d.mean.length - 1);
    return { mean: d.mean[b], max: d.max[b], year: d.maxYear[b], bin: [b * d.binDeg, (b + 1) * d.binDeg] };
  }
  function medaSols() {
    // newest first, keep sols that measured at least one value
    return [...state.wx.sols].filter((s) => num(s.max_temp) != null || num(s.pressure) != null).sort((a, b) => Number(b.sol) - Number(a.sol));
  }
  function loadLiveWeather() {
    if (!WX.meda.feed || !window.fetch) return;
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 5000);
    fetch(WX.meda.feed, { signal: ctl ? ctl.signal : undefined })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((feed) => {
        if (!feed || !Array.isArray(feed.sols) || !feed.sols.length) throw new Error("empty");
        state.wx = { sols: feed.sols, live: true };
        renderWeather(); applyWeather();
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  }
  // The dust event and the top bar use the same measured values
  function applyWeather() {
    const s = medaSols()[0]; if (!s) return;
    const hi = num(s.max_temp);
    if (hi != null) $("#cond-temp").textContent = fmtT(hi);
    const du = dustAt(num(s.ls));
    if (du) D.events.dust.source = `Dust season at Jezero: at this time of year (Ls ${du.bin[0]}° to ${du.bin[1]}°) the dust opacity averages τ ${du.mean.toFixed(2)} and reached τ ${du.max.toFixed(2)} in Mars Year ${du.year} (Montabone et al. dust climatology). Temperatures from Perseverance MEDA.`;
  }
  function sunIcon(tau) {
    const s = svg("svg", { viewBox: "0 0 64 64", class: "wx-icon", "aria-hidden": "true" });
    for (let k = 0; k < 16; k++) { const ang = (k / 16) * Math.PI * 2; svg("line", { x1: 32 + Math.cos(ang) * 16, y1: 32 + Math.sin(ang) * 16, x2: 32 + Math.cos(ang) * 29, y2: 32 + Math.sin(ang) * 29, stroke: "#E8762C", "stroke-width": 4, "stroke-linecap": "round" }, s); }
    svg("circle", { cx: 32, cy: 32, r: 13, fill: "#E8762C" }, s);
    if (tau > 0.8) svg("rect", { x: 0, y: 36, width: 64, height: 28, fill: "#C9A27A", opacity: 0.75 }, s);
    return s;
  }
  function renderWeather() {
    const list = medaSols();
    const box = $("#wx-today"); box.innerHTML = "";
    $("#wx-src").textContent = (dev.demoWeather ? "Demo storm scenario · temperatures " : "") + (state.wx.live ? "Live from NASA's MEDA feed" : `Perseverance MEDA, NASA feed copied ${WX.meda.copied || ""}`);
    const f = list[0];
    if (!f) { box.append(html("p", { class: "body-6 muted" }, "No MEDA readings available.")); return; }
    const ls = num(f.ls), du = dustAt(ls);
    const t = html("div");
    t.append(html("p", { class: "heading-5" }, dev.demoWeather ? "Dust storm today" : "Latest reading"), html("p", { class: "body-6 muted" }, `${dev.demoWeather ? `${DEMO_STORM.note} · wind up to ${DEMO_STORM.wind} km/h · ` : ""}Perseverance sol ${f.sol} · ${f.terrestrial_date} · ${f.season}, Ls ${ls != null ? ls.toFixed(0) : "?"}°`));
    const temps = html("div", { class: "wx-temps" });
    const p = num(f.pressure);
    temps.innerHTML = `<span class="up">▲ ${fmtT(num(f.max_temp))}</span><span>${p != null ? p.toFixed(0) + " Pa" : "n/a"}</span><span class="down">▼ ${fmtT(num(f.min_temp))}</span><span>${dev.demoWeather ? "Dust τ " + DEMO_STORM.tau.toFixed(2) : du ? "Dust τ " + du.mean.toFixed(2) : ""}</span>`;
    box.append(sunIcon(dev.demoWeather ? DEMO_STORM.tau : du ? du.mean * 2.6 : 0), t, temps);
    const more = $("#wx-more"); more.innerHTML = "";
    for (const d of list.slice(1, 6)) {
      const row = html("div", { class: "wx-row" });
      const pp = num(d.pressure);
      row.append(html("span", { class: "title-4" }, `Sol ${d.sol} · ${d.terrestrial_date}`), html("span", {}, `▲ ${fmtT(num(d.max_temp))}`), html("span", { class: "muted" }, `▼ ${fmtT(num(d.min_temp))}`), html("span", {}, pp != null ? `${pp.toFixed(0)} Pa` : "n/a"));
      more.append(row);
    }
    $("#wx-toggle").hidden = list.length < 2;
    const tips = $("#wx-tips");
    tips.innerHTML = "";
    tips.append(html("p", { class: "title-4" }, "What the data means for today's EVA"));
    const ul = html("ul");
    const tip = (icon, text) => { const li = html("li"); li.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`; li.append(document.createTextNode(text)); ul.append(li); };
    if (dev.demoWeather) tip("ph-cloud-warning", `Dust storm: visible dust opacity τ ${DEMO_STORM.tau.toFixed(2)}, winds up to ${DEMO_STORM.wind} km/h. Sightseeing and rim climbs are closed. Keep the tour short and close to the habitat.`);
    if (f.sunrise && f.sunset) tip("ph-sun-horizon", `Daylight ${hhmm(f.sunrise)} to ${hhmm(f.sunset)} local mean solar time. Plan to be back an hour before sunset.`);
    const lo = num(f.min_temp);
    if (lo != null) tip("ph-thermometer-cold", `Night low ${fmtT(lo)}: rover batteries and suit heaters need the full overnight charge.`);
    if (du) tip("ph-cloud", `Dust season check: at Ls ${du.bin[0]}° to ${du.bin[1]}° the dust opacity averages τ ${du.mean.toFixed(2)} (9.3 µm), but reached τ ${du.max.toFixed(2)} in Mars Year ${du.year}. A storm can arrive within sols.`);
    tip("ph-radioactive", "Background radiation about 0.64 mSv per sol, the surface average Curiosity's RAD measured (Hassler et al. 2014).");
    tips.append(ul);
    tips.append(html("p", { class: "caption-5 muted" }, `Temperature and pressure: Perseverance MEDA via NASA's weather feed. Dust: ${WX.dust ? WX.dust.source : "n/a"}. Your crew's sol counter is separate from Perseverance's.`));
  }
  $("#wx-toggle").addEventListener("click", () => {
    const m = $("#wx-more"); m.hidden = !m.hidden;
    $("#wx-toggle").textContent = m.hidden ? "Show more sols" : "Show fewer sols";
    $("#wx-toggle").setAttribute("aria-expanded", String(!m.hidden));
  });

  // Target picker and planner stats
  function renderObjectives(m, r) {
    const ul = $("#obj-select"); ul.innerHTML = "";
    for (const s of r.allStops) {
      const li = html("li", { class: `body-6${s.main ? " main" : ""}` });
      li.innerHTML = `<i class="ph ${TYPE[s.type].icon}" aria-hidden="true"></i>`;
      li.append(document.createTextNode(s.name + (s.main ? " · main" : "")));
      ul.append(li);
    }
    const p = r.plan;
    $("#plan-info").textContent = `Planner checked ${p.nodes.toLocaleString("en")} search steps over ${p.orders.toLocaleString("en")} possible orders in ${Math.max(1, Math.round(p.ms))} ms. Best order: ${r.allStops.map((s) => s.order + " " + s.name.split(" ").slice(0, 2).join(" ")).join(" → ")}.${p.relaxed ? " Some targets sit on steep ground or among hazards this route type normally avoids, so it crosses the shortest stretch it has to. Check the map before you go." : ""}`;
  }

  function toggleObjective(id, on) {
    const m = mission(), sel = state.selected[m.id];
    if (on) sel.add(id); else if (sel.size > 1) sel.delete(id); else { toast("Keep at least one target on the tour."); renderPlan(); return; }
    planMission(m);
    renderPlan(); buildMarkers(); drawOverlays();
  }

  function renderWaypoints(r, m) {
    const ol = $("#waypoints"); ol.innerHTML = "";
    ol.style.setProperty("--route-color", r.color);
    const items = [{ badge: habLetter(), cls: "", name: "Habitat", km: 0, pos: D.habitat.pos, sub: `${D.habitat.name}. Board the rover and head out` }];
    for (const s of r.allStops) {
      items.push({ badge: String(s.order), cls: s.main ? "target" : "stop", name: s.name, km: s.at * r.km, pos: s.pos, sub: `${TYPE[s.type].label} · ${s.minutes} min on site · ${priority(s)} priority. ${s.detail}`, photo: s.id });
    }
    items.push({ badge: habLetter(), cls: "", name: "Back at the habitat", km: r.km, pos: D.habitat.pos, sub: "Tour complete" });
    for (const it of items) {
      const li = html("li", { class: "wp" });
      li.append(html("span", { class: `wp-badge ${it.cls}`, "aria-hidden": "true" }, it.badge));
      const body = html("div", { class: "wp-body" });
      const row = html("div", { class: "wp-row" });
      row.append(html("span", { class: "title-2" }, it.name), html("span", { class: "caption-4 wp-km" }, `${it.km.toFixed(1)} km`));
      body.append(row, html("p", { class: "body-6 muted" }, it.sub));
      const go = html("button", { class: "wp-link body-5", type: "button" }, "Show on map");
      go.addEventListener("click", () => map.flyTo(it.pos[0], it.pos[1], 16.5, 700));
      body.append(go);
      if (it.photo) { const f = html("figure", { class: "wp-photo" }); body.append(f); renderPhoto(f, it.photo, it.name); }
      li.append(body);
      ol.append(li);
    }
  }

  function selectRoute(i) {
    state.routeIdx = i;
    renderPlan(); buildMarkers(); drawOverlays();
  }

  // ---------- Screens ----------
  function setScreen(s) {
    state.screen = s;
    document.body.dataset.screen = s;
    $("#intro").hidden = s !== "intro";
    $("#tasks").hidden = s !== "tasks";
    $("#event").hidden = s !== "event";
    $("#end").hidden = s !== "end";
  }

  // ---------- EVA ----------
  function startEva() {
    state.routeAnim = null;
    const m = mission(), r = route();
    state.run = {
      m, r, km: 0, dir: 1, maxKm: 0,
      o2: 100, suit: 100, dose: 0, minutes: 0, walked: 0,
      stopIdx: 0, eventIdx: 0, paused: false, fast: false, kmPerSec: r.km / RULES.tourSeconds,
      atStop: null, returnedEarly: false, rescued: false, lowWarned: false,
      done: new Set(["leave"]), skipped: new Set(),
      notes: notesAlong(r, 0.15).map((n) => ({ ...n, shown: false })), alert: null, votes: 0, photos: 0,
      started: Date.now(),
      log: [`Left the habitat in the rover on the ${r.label.toLowerCase()} route`]
    };
    $("#stop-card").hidden = true;
    $("#crew-alert").hidden = true;
    $("#photo-count").textContent = "";
    buildMarkers();
    renderChecklist();
    fitRoute(false, 600);
    setScreen("eva");
    last = performance.now();
    requestAnimationFrame(tick);
  }

  function renderChecklist() {
    const run = state.run;
    $("#obj-mission").textContent = run.m.name;
    const items = [{ key: "leave", label: "Leave the habitat" }];
    run.r.allStops.forEach((s) => items.push({ key: s.key, label: s.main ? `${s.name} (main)` : s.name }));
    items.push({ key: "home", label: "Return to the habitat" });
    const ol = $("#obj-list"); ol.innerHTML = "";
    let nowSet = false;
    for (const it of items) {
      const li = html("li"); const box = html("span", { class: "box", "aria-hidden": "true" });
      if (run.done.has(it.key)) { li.className = "done"; box.textContent = "✓"; }
      else if (run.skipped.has(it.key)) { li.className = "skipped"; box.textContent = "–"; }
      else if (!nowSet) { li.className = "now"; nowSet = true; }
      li.append(box, html("span", {}, it.label));
      ol.append(li);
    }
    const doneStops = run.r.allStops.filter((s) => run.done.has(s.key));
    $("#obj-points").textContent = `${doneStops.length} of ${run.r.allStops.length} tasks done · ${returnOf(doneStops)}`;
  }

  let last = 0;
  function tick(now) {
    const run = state.run;
    if (!run || state.screen === "end") return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!run.paused && !run.atStop && state.screen === "eva") step(dt);
    updateHud();
    requestAnimationFrame(tick);
  }

  function step(dt) {
    const run = state.run, r = run.r;
    const speed = run.kmPerSec * (run.dir < 0 ? RULES.returnBoost : 1) * (run.fast ? RULES.fastForward : 1);
    const prev = run.km;
    run.km = clamp(run.km + run.dir * speed * dt, 0, r.km);
    const dk = Math.abs(run.km - prev);
    const mins = dk * r.minPerKm;
    run.walked += dk; run.minutes += mins;
    run.o2 -= dk * RULES.o2PerKm;
    if (run.dir > 0) run.o2 -= (dk / r.km) * (r.climb / 20) * RULES.o2Per20mClimb;
    run.suit -= dk * RULES.powerPerKm;
    run.dose += mins * RULES.dosePerMinute;

    if (run.o2 <= 0) { run.o2 = 0; run.rescued = true; run.log.push("Life support ran out. A rescue rover came from the habitat"); return finish(); }
    if (!run.lowWarned && run.dir > 0 && run.o2 - Math.min(r.km - run.km, run.km) * RULES.o2PerKm < 10) {
      run.lowWarned = true;
      toast("Life support reserve is getting low. Make sure you can still get home.");
    }
    if (run.dir > 0) {
      const note = run.notes.find((n) => !n.shown && run.km >= n.km - 0.12);
      if (note && !run.alert) { note.shown = true; showCrewAlert(note); } // the next note waits until this one is answered
      const frac = run.km / r.km;
      const ev = r.events[run.eventIdx];
      if (ev && frac >= ev.at) { run.eventIdx++; return openEvent(ev.type); }
      const st = r.allStops[run.stopIdx];
      if (st && frac >= st.at) { run.stopIdx++; return arriveStop(st, st.key); }
      if (frac >= 1) { run.done.add("home"); run.log.push("Back inside the habitat"); return finish(); }
    } else if (run.km <= 0) {
      run.done.add("home"); run.log.push("Back inside the habitat");
      return finish();
    }
  }

  function updateHud() {
    const run = state.run; if (!run) return;
    const p = pointAtKm(run.r, run.km);
    if (state.playerMarker) state.playerMarker.pos = p;
    // keep the astronaut in view
    const sp = map.toScreen(p[0], p[1]), sz = map.size();
    if (!map.anim && (sp.x < sz.w * 0.12 || sp.x > sz.w * 0.88 || sp.y < sz.h * 0.12 || sp.y > sz.h * 0.88)) map.flyTo(p[0], p[1], map.zoom, 500);
    drawOverlays();
    $("#eva-clock").textContent = fmtClock(run.minutes);
    $("#eva-phase").textContent = run.paused ? "Paused" : run.dir > 0 ? (run.fast ? "Outbound · fast forward" : "Outbound") : (run.fast ? "Heading home · fast forward" : "Heading home");
    setBar("o2", run.o2, `${Math.max(0, run.o2).toFixed(0)} %`);
    setBar("suit", run.suit, `${Math.max(0, run.suit).toFixed(0)} %`);
    $("#v-dose").textContent = `${run.dose.toFixed(2)} mSv`;
    const bd = $("#b-dose"); bd.style.transform = `scaleX(${Math.max(0.02, clamp(run.dose, 0, 1))})`;
    bd.classList.toggle("low", run.dose > 0.15 && run.dose <= 0.3); bd.classList.toggle("critical", run.dose > 0.3);
    $("#v-dist").textContent = `${run.walked.toFixed(1)} km`;
  }
  function setBar(id, val, label) {
    $(`#v-${id}`).textContent = label;
    const b = $(`#b-${id}`);
    b.style.transform = `scaleX(${clamp(val, 0, 100) / 100})`;
    b.classList.toggle("low", val <= 40 && val > 20);
    b.classList.toggle("critical", val <= 20);
  }

  // ---------- Stops ----------
  function arriveStop(stop, key) {
    const run = state.run;
    run.atStop = { stop, key };
    $("#stop-kicker").textContent = `${stop.main ? "Main task" : "Task " + stop.order} · ${TYPE[stop.type].label}`;
    $("#stop-name").textContent = stop.name;
    $("#stop-detail").textContent = stop.detail;
    renderPhoto($("#stop-photo"), stop.id, stop.name);
    const b = $("#btn-sample"); b.innerHTML = "";
    const verb = { sample: "Collect sample", photo: "Take photos", measure: "Take measurement", sightsee: "Take photos for the next crew" }[stop.type] || "Collect sample";
    b.append(document.createTextNode(`${verb} `), html("kbd", { class: "key" }, "S"));
    $("#stop-card").hidden = false;
    $("#stop-card").scrollIntoView({ block: "nearest", behavior: "smooth" });
    b.focus({ preventScroll: true });
  }

  function collectSample() {
    const run = state.run; if (!run || !run.atStop) return;
    const { stop, key } = run.atStop;
    run.done.add(key);
    const mins = stop.minutes || RULES.stopMinutes;
    run.minutes += mins; run.o2 -= RULES.stopO2; run.dose += mins * RULES.dosePerMinute;
    if (stop.type === "sightsee") {
      run.log.push(`Panorama at ${stop.name}, saved as a view point for the next crew`);
      highlights.push({ id: `v${Date.now()}`, pos: stop.pos.slice(), tag: "view", title: stop.name, note: stop.detail, by: `You, Sol ${D.sol}` });
      saveHighlights(); notesVersion++;
      run.photos = (run.photos || 0) + 1;
    } else run.log.push(`${stop.name}: ${PRODUCT[stop.type][0]} collected (${mins} min on site)`);
    run.atStop = null;
    $("#stop-card").hidden = true;
    if (stop.main) run.log.push("Main task done");
    toast(`${TYPE[stop.type].label} logged. Press P to leave a photo point for the next crew.`);
    renderChecklist();
  }

  // Real Perseverance photo from NASA; falls back to the full size file,
  // then a HiRISE view of the exact spot, then a drawing.
  const NASA_ASSETS = "https://assets.science.nasa.gov/";
  function photoUrls(p) {
    if (p.raw) return [NASA_ASSETS + "content/dam/science/psd/" + p.url];
    return [NASA_ASSETS + "dynamicimage/assets/science/psd/" + p.url + "?w=960&fit=clip", NASA_ASSETS + "content/dam/science/psd/" + p.url];
  }
  function renderPhoto(fig, id, alt, withCredit = true) {
    fig.innerHTML = "";
    const p = D.photos[id], task = D.tasks.find((t) => t.id === id);
    const fallback = () => {
      fig.innerHTML = "";
      fig.append(illustration(task && task.type === "measure" ? "dunes" : "rim", alt));
      if (task) snapshot(task.pos[0], task.pos[1]).then((url) => { if (url) { fig.innerHTML = ""; fig.append(html("img", { src: url, alt: `HiRISE view of ${alt}` })); } });
    };
    if (!p) { fallback(); return; }
    const urls = photoUrls(p);
    let k = 0;
    const img = html("img", { src: urls[0], alt: `Perseverance view: ${p.caption}`, loading: "lazy", decoding: "async" });
    img.onerror = () => { k++; if (k < urls.length) img.src = urls[k]; else fallback(); };
    fig.append(img);
    if (withCredit) {
      fig.title = `${p.caption}. ${p.credit || "NASA/JPL-Caltech/ASU/MSSS"} (${p.pia})`;
      const cap = fig.nextElementSibling && fig.nextElementSibling.classList.contains("photo-credit") ? fig.nextElementSibling : null;
      const text = `${p.caption} · ${p.credit || "NASA/JPL-Caltech/ASU/MSSS"}`;
      if (cap) cap.textContent = text; else fig.after(html("small", { class: "photo-credit" }, text));
    }
  }

  // Drawn stand in until a real Perseverance photo is added
  function illustration(kind, alt) {
    const s = svg("svg", { viewBox: "0 0 480 200", preserveAspectRatio: "xMidYMid slice", role: "img", "aria-label": `Illustration of ${alt}. Add a Perseverance photo as assets/photos/${kind}.jpg` });
    svg("rect", { width: 480, height: 200, fill: "#E2BB93" }, s);
    svg("rect", { width: 480, height: 80, fill: "#D9B08A" }, s);
    if (kind === "delta") {
      svg("path", { d: "M0 104 Q100 88 170 98 T340 90 T480 100 V200 H0Z", fill: "#B97A50" }, s);
      svg("path", { d: "M210 96 L262 52 L372 60 L432 92Z", fill: "#9C5E3B" }, s);
      for (let i = 0; i < 4; i++) svg("path", { d: `M${236 + i * 8} ${86 - i * 8} H${414 - i * 14}`, stroke: "#7D4429", "stroke-width": 2 }, s);
      svg("path", { d: "M0 148 Q130 130 240 142 T480 136 V200 H0Z", fill: "#A4643F" }, s);
    } else if (kind === "rim") {
      svg("path", { d: "M0 122 L86 66 L170 88 L270 34 L370 72 L480 48 V200 H0Z", fill: "#8E4F33" }, s);
      for (let i = 0; i < 5; i++) svg("path", { d: `M${56 + i * 6} ${112 - i * 12} L${456 - i * 8} ${94 - i * 11}`, stroke: "#6E3A24", "stroke-width": 1.6, opacity: 0.8 }, s);
      svg("path", { d: "M0 156 Q160 138 286 152 T480 144 V200 H0Z", fill: "#A4643F" }, s);
    } else {
      svg("path", { d: "M0 110 Q114 84 228 108 T480 98 V200 H0Z", fill: "#D7A57A" }, s);
      for (let i = 0; i < 8; i++) svg("path", { d: `M0 ${126 + i * 9} Q120 ${116 + i * 9} 240 ${126 + i * 9} T480 ${124 + i * 9}`, stroke: "#B9845B", "stroke-width": 1.6, fill: "none" }, s);
    }
    svg("ellipse", { cx: 84, cy: 176, rx: 30, ry: 9, fill: "#6E3A24" }, s);
    svg("ellipse", { cx: 356, cy: 184, rx: 18, ry: 5, fill: "#6E3A24" }, s);
    const cap = svg("text", { x: 14, y: 24, "font-family": "Poppins, sans-serif", "font-size": 12, "font-weight": 500, fill: "#5C2E1B" }, s);
    cap.textContent = "Illustration · loading NASA photo";
    return s;
  }

  // ---------- Events ----------
  function openEvent(type) {
    const ev = D.events[type], run = state.run;
    run.currentEvent = type;
    $("#event-kicker span").textContent = ev.kicker;
    $("#event-title").textContent = ev.title;
    $("#event-text").textContent = ev.text;
    $("#event-source").textContent = ev.source;
    const cd = $("#event-countdown"); cd.innerHTML = "";
    if (ev.countdown) { cd.append(document.createTextNode(type === "dust" ? "Storm arrives in" : "Peak in")); cd.append(html("strong", {}, ev.countdown)); }
    const box = $("#event-choices"); box.innerHTML = "";
    ev.choices.forEach((c, i) => {
      const b = html("button", { class: `choice${c.recommended ? " recommended" : ""}`, type: "button" });
      b.append(html("kbd", { class: "key" }, String(i + 1)));
      const t = html("span", { class: "c" });
      t.append(html("span", { class: "title-3" }, c.recommended ? `${c.label} · recommended` : c.label), html("span", { class: "caption-5 hint" }, c.hint));
      b.append(t);
      b.addEventListener("click", () => chooseEvent(i));
      box.append(b);
    });
    if (type === "dust") setCond("#cond-dust", "Rising", "warn");
    if (type === "radiation") setCond("#cond-rad", "Elevated", "warn");
    setScreen("event");
    box.querySelector("button").focus({ preventScroll: true });
  }

  function chooseEvent(i) {
    const run = state.run; if (!run || state.screen !== "event") return;
    const type = run.currentEvent, ev = D.events[type], c = ev.choices[i]; if (!c) return;
    const e = c.effect;
    if (e.o2) run.o2 += e.o2;
    if (e.minutes) { run.minutes += e.minutes; run.dose += e.minutes * RULES.dosePerMinute; }
    if (e.dose) run.dose += e.dose;
    if (e.suit) run.suit += e.suit;
    run.log.push(`${ev.title}: ${c.label.toLowerCase()}`);
    if (e.returnNow) {
      run.dir = -1; run.maxKm = run.km; run.returnedEarly = true;
      run.r.allStops.forEach((s) => { if (!run.done.has(s.key)) run.skipped.add(s.key); });
      run.returnPath = slice(run.r, 0, run.km).reverse();
      renderChecklist();
    }
    if (type === "dust") setTimeout(() => setCond("#cond-dust", ...dustBase()), 4000);
    if (type === "radiation") setTimeout(() => setCond("#cond-rad", "Normal", "good"), 4000);
    if (run.o2 <= 0) { run.o2 = 0; run.rescued = true; run.log.push("Life support ran out. A rescue rover came from the habitat"); return finish(); }
    setScreen("eva");
    last = performance.now();
  }

  function setCond(sel, text, cls) { const n = $(sel); n.textContent = text; n.className = cls; }

  // ---------- End ----------
  function finish() {
    const run = state.run;
    const stops = run.r.allStops, done = stops.filter((s) => run.done.has(s.key));
    const missed = stops.filter((s) => !run.done.has(s.key));
    const reserve = Math.max(0, run.o2);
    let title, text;
    if (run.rescued) { title = "EVA aborted"; text = "Life support reached its limit before the crew got back to the habitat. Plan a shorter tour or a route with more margin."; }
    else if (run.returnedEarly) { title = "Returned early"; text = `The crew turned back when conditions changed. ${done.length} of ${stops.length} tasks done.`; }
    else if (!missed.length) { title = "All tasks done"; text = `Every task on the plan was completed, with ${reserve.toFixed(0)} % life support in reserve.`; }
    else { title = "EVA complete"; text = `${done.length} of ${stops.length} tasks done. Skipped: ${missed.map((s) => s.name).join(", ")}.`; }
    if (!run.rescued && reserve < 30) text += " The life support reserve was below the 30 % safety margin.";
    for (const s of done) state.totals[s.type]++;
    state.totals.points += run.photos || 0;
    renderTotals();
    $("#end-kicker").textContent = "EVA report · Sol " + D.sol;
    $("#end-title").textContent = title;
    $("#end-text").textContent = text;
    const outcome = run.rescued ? ["bad", "Rescued"] : run.returnedEarly ? ["warn", "Safe return"] : !missed.length ? ["good", "Mission complete"] : ["accent", "EVA complete"];
    const stamp = $("#end-stamp"); stamp.className = `end-stamp ${outcome[0]}`; stamp.textContent = outcome[1];
    // stats count up from zero once the replay has finished
    const stats = $("#end-stats"); stats.innerHTML = "";
    const add = (to, fmt, dt) => { const d = html("div"); const dd = html("dd", { class: "heading-6" }, fmt(0)); dd.dataset.to = to; d.append(dd, html("dt", { class: "caption-5" }, dt)); stats.append(d); return { dd, to, fmt }; };
    const counters = [
      add(done.length, (v) => `${Math.round(v)} / ${stops.length}`, "Tasks done"),
      add(reserve, (v) => `${v.toFixed(0)} %`, "Life support left"),
      add(run.minutes, (v) => fmtClock(v), "EVA time"),
      add(run.dose, (v) => v.toFixed(2), "Dose, mSv")
    ];
    // science return as chips
    const ret = $("#end-return"); ret.innerHTML = "";
    const n = {}; for (const s of done) n[s.type] = (n[s.type] || 0) + 1;
    for (const k of Object.keys(PRODUCT)) if (n[k]) { const li = html("li", { class: "body-5" }); li.innerHTML = `<i class="ph ${TYPE[k].icon}" aria-hidden="true"></i>`; li.append(document.createTextNode(`${n[k]} ${PRODUCT[k][n[k] > 1 ? 1 : 0]}`)); ret.append(li); }
    if (!ret.children.length) ret.append(html("li", { class: "body-5 none" }, "No science return this time"));
    // the hand off: what this crew leaves behind
    const left = run.photos || 0, rated = run.votes || 0;
    $("#end-crew-text").textContent = left || rated
      ? `${left} new note${left === 1 ? "" : "s"} and ${rated} rating${rated === 1 ? "" : "s"} of earlier notes. They are on the shared map now; send the crew log so the next crew gets them too.`
      : "You left no notes this time. Press P on your next EVA to log hazards, tips and views for whoever drives here next.";
    const log = $("#end-log"); log.innerHTML = "";
    for (const l of run.log) log.append(html("li", {}, l));
    setScreen("end");
    playFinish(run, done, counters, outcome[0] === "good");
    $("#btn-again").focus({ preventScroll: true });
  }

  // ---------- Finish animation: the route draws itself, stops pop in, stats count up ----------
  let finishAnim = 0;
  function playFinish(run, done, counters, celebrate) {
    cancelAnimationFrame(finishAnim);
    const r = run.r, S = $("#end-replay"); S.innerHTML = "";
    const W = 560, H = 220, pad = 26;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // track actually driven: out to the turning point, then the way home
    const outKm = run.returnedEarly ? run.maxKm : run.rescued ? run.km : r.km;
    const outPts = slice(r, 0, Math.max(0.001, outKm));
    const homePts = run.returnedEarly ? outPts.slice().reverse() : [];
    // fit everything into the box, longitude scaled by cos(latitude)
    const all = [...r.dense, D.habitat.pos];
    const k = Math.cos((D.habitat.pos[0] * Math.PI) / 180);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [la, lo] of all) { x0 = Math.min(x0, lo * k); x1 = Math.max(x1, lo * k); y0 = Math.min(y0, la); y1 = Math.max(y1, la); }
    const sc = Math.min((W - pad * 2) / Math.max(x1 - x0, 1e-6), (H - pad * 2) / Math.max(y1 - y0, 1e-6));
    const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
    const P = ([la, lo]) => [ox + (lo * k - x0) * sc, oy + (y1 - la) * sc];
    const toD = (pts) => pts.map((p, i) => { const [x, y] = P(p); return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join("");
    // sky, ground glow and drifting dust
    const defs = svg("defs", {}, S);
    const g = svg("linearGradient", { id: "endSky", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    svg("stop", { offset: "0", "stop-color": "#2B1A14" }, g); svg("stop", { offset: "1", "stop-color": "#6E321A" }, g);
    svg("rect", { width: W, height: H, fill: "url(#endSky)" }, S);
    const dust = svg("g", { class: "end-dust" }, S);
    for (let i = 0; i < 36; i++) svg("circle", { cx: (i * 157) % W, cy: (i * 89) % H, r: 0.6 + (i % 3) * 0.5, fill: "#F4C9A3", opacity: 0.15 + (i % 4) * 0.08, style: `animation-delay:${-(i % 9) * 0.7}s` }, dust);
    // the planned route, faint, then the driven track on top
    svg("path", { d: toD(r.dense), fill: "none", stroke: "#FFFFFF", "stroke-opacity": 0.22, "stroke-width": 2, "stroke-dasharray": "3 5", "stroke-linejoin": "round" }, S);
    const outEl = svg("path", { d: toD(outPts), fill: "none", stroke: r.color, "stroke-width": 4, "stroke-linejoin": "round", "stroke-linecap": "round" }, S);
    const homeEl = homePts.length ? svg("path", { d: toD(homePts), fill: "none", stroke: "#F5B400", "stroke-width": 3, "stroke-dasharray": "8 5", "stroke-linecap": "round" }, S) : null;
    // stops: done ones fill in as the rover passes them
    const stopEls = r.allStops.map((s) => {
      const [x, y] = P(s.pos), ok = run.done.has(s.key);
      const gEl = svg("g", { class: `end-stop ${ok ? "ok" : "miss"}`, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, S);
      svg("circle", { r: 9, fill: ok ? "#FFFFFF" : "none", stroke: ok ? r.color : "#FFFFFF", "stroke-width": 2.5, "stroke-opacity": ok ? 1 : 0.5 }, gEl);
      const t = svg("text", { "text-anchor": "middle", y: 4, "font-size": 11, "font-weight": 700, "font-family": "Poppins, sans-serif", fill: ok ? r.color : "#FFFFFF", "fill-opacity": ok ? 1 : 0.6 }, gEl);
      t.textContent = ok ? "✓" : String(s.order);
      return { gEl, km: s.at * r.km };
    });
    // notes this crew left for the next one
    const t0Run = run.started || 0;
    const mine = highlights.filter((h) => /^[uv]\d+$/.test(h.id) && Number(h.id.slice(1)) >= t0Run);
    const noteEls = mine.map((h) => { const [x, y] = P(h.pos); const e = svg("g", { class: "end-note", transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, S); svg("rect", { x: -5, y: -5, width: 10, height: 10, fill: "#7FB2FF", stroke: "#FFFFFF", "stroke-width": 1.5, transform: "rotate(45)" }, e); return e; });
    const [hx, hy] = P(D.habitat.pos);
    const hab = svg("g", { transform: `translate(${hx.toFixed(1)} ${hy.toFixed(1)})` }, S);
    svg("rect", { x: -10, y: -10, width: 20, height: 20, fill: "#C2410C", stroke: "#FFFFFF", "stroke-width": 2 }, hab);
    const ht = svg("text", { "text-anchor": "middle", y: 4.5, "font-size": 12, "font-weight": 700, "font-family": "Poppins, sans-serif", fill: "#FFFFFF" }, hab); ht.textContent = habLetter();
    const rover = svg("circle", { r: 6, fill: "#FFD84D", stroke: "#1D1C1A", "stroke-width": 2, cx: hx, cy: hy }, S);

    const hero = $("#end-hero"), stamp = $("#end-stamp"), burst = $("#end-burst");
    hero.classList.remove("done"); burst.innerHTML = "";
    const lenOut = outEl.getTotalLength ? outEl.getTotalLength() : 0, lenHome = homeEl && homeEl.getTotalLength ? homeEl.getTotalLength() : 0;
    const total = lenOut + lenHome || 1;
    const finishUp = () => {
      outEl.style.strokeDasharray = ""; outEl.style.strokeDashoffset = "";
      if (homeEl) { homeEl.style.strokeDasharray = "8 5"; homeEl.style.strokeDashoffset = ""; }
      stopEls.forEach((s) => s.gEl.classList.add("in")); noteEls.forEach((e) => e.classList.add("in"));
      const end = homeEl ? P(D.habitat.pos) : P(outPts[outPts.length - 1]);
      rover.setAttribute("cx", end[0]); rover.setAttribute("cy", end[1]);
      hero.classList.add("done");
      if (celebrate && !reduce) for (let i = 0; i < 14; i++) { const sp = html("span"); sp.style.setProperty("--a", `${(i / 14) * 360}deg`); sp.style.setProperty("--d", `${50 + (i % 3) * 22}px`); burst.append(sp); }
      countUp(counters, reduce ? 0 : 700);
      document.querySelectorAll("#end-return li, .end-crew").forEach((el, i) => { el.classList.remove("in"); void el.offsetWidth; el.style.animationDelay = reduce ? "0s" : `${0.15 + i * 0.08}s`; el.classList.add("in"); });
    };
    if (reduce || !lenOut) { finishUp(); return; }
    outEl.style.strokeDasharray = `${lenOut} ${lenOut}`; outEl.style.strokeDashoffset = lenOut;
    if (homeEl) { homeEl.style.strokeDasharray = `${lenHome} ${lenHome}`; homeEl.style.strokeDashoffset = lenHome; }
    const kmPerLen = outKm / lenOut;
    const ms = clamp(1400 + total * 2, 1600, 2800), t0 = performance.now();
    const easeIO = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const stepAnim = (now) => {
      const t = Math.min(1, (now - t0) / ms), L = easeIO(t) * total;
      if (L <= lenOut) {
        outEl.style.strokeDashoffset = lenOut - L;
        const p = outEl.getPointAtLength(L); rover.setAttribute("cx", p.x); rover.setAttribute("cy", p.y);
        stopEls.forEach((s) => { if (s.km <= L * kmPerLen + 0.02) s.gEl.classList.add("in"); });
      } else if (homeEl) {
        outEl.style.strokeDashoffset = 0;
        stopEls.forEach((s) => s.gEl.classList.add("in"));
        const l2 = L - lenOut; homeEl.style.strokeDashoffset = lenHome - l2;
        const p = homeEl.getPointAtLength(l2); rover.setAttribute("cx", p.x); rover.setAttribute("cy", p.y);
      }
      if (t < 1 && state.screen === "end") finishAnim = requestAnimationFrame(stepAnim); else finishUp();
    };
    finishAnim = requestAnimationFrame(stepAnim);
  }
  function countUp(counters, ms) {
    const t0 = performance.now();
    const tick2 = (now) => {
      const t = ms ? Math.min(1, (now - t0) / ms) : 1, e = 1 - Math.pow(1 - t, 3);
      for (const c of counters) c.dd.textContent = c.fmt(c.to * e);
      if (t < 1) requestAnimationFrame(tick2);
    };
    requestAnimationFrame(tick2);
  }
  $("#btn-end-export").addEventListener("click", () => exportLog());
  function renderTotals() {
    const t = state.totals;
    const pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    $("#score-total").textContent = `${pl(t.sample, "sample")} · ${pl(t.photo + t.sightsee, "image set")} · ${pl(t.measure, "measurement")}`;
  }

  function backToPlan() {
    state.run = null; state.playerMarker = null;
    $("#stop-card").hidden = true;
    $("#crew-alert").hidden = true;
    setCond("#cond-dust", ...dustBase()); setCond("#cond-rad", "Normal", "good");
    setScreen("plan");
    renderPlan(); buildMarkers(); drawOverlays(); fitRoute();
  }

  // ---------- Toast ----------
  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800);
  }

  // ---------- Task page: pick what to do today ----------
  const MAX_TASKS = 7;
  state.draft = new Set();
  state.planned = false;
  // Hard weather: during the (demo) dust storm, tasks with a "storm" reason are closed
  const stormToday = () => dev.demoWeather;
  const closedReason = (t) => (t.storm && stormToday() ? t.storm : null);
  // drop closed tasks from the plan; if nothing is left, fall back to the everyday tasks
  function pruneClosed() {
    let dropped = 0;
    for (const m of D.missions) {
      const sel = state.selected[m.id];
      for (const id of [...sel]) { const t = D.tasks.find((x) => x.id === id); if (t && closedReason(t)) { sel.delete(id); dropped++; } }
      if (!sel.size) D.tasks.filter((t) => t.today && !closedReason(t)).slice(0, 3).forEach((t) => sel.add(t.id));
    }
    if (state.draft) for (const id of [...state.draft]) { const t = D.tasks.find((x) => x.id === id); if (t && closedReason(t)) state.draft.delete(id); }
    return dropped;
  }
  function distClass(km) { return km < 2.5 ? ["dist-near", "Near"] : km < 5 ? ["dist-mid", "Medium"] : ["dist-far", "Far"]; }
  function taskCard(t) {
    const closed = closedReason(t);
    const li = html("li", { class: closed ? "task closed" : "task" });
    const id = `task-${t.id}`;
    const cb = html("input", { type: "checkbox", id }); cb.checked = !closed && state.draft.has(t.id);
    if (closed) { cb.disabled = true; cb.setAttribute("aria-describedby", `${id}-closed`); }
    cb.addEventListener("change", () => {
      if (cb.checked && state.draft.size >= MAX_TASKS) { cb.checked = false; toast(`One EVA fits at most ${MAX_TASKS} tasks. Untick one first.`); return; }
      if (cb.checked) state.draft.add(t.id); else state.draft.delete(t.id);
      updateTaskSummary();
    });
    const lab = html("label", { for: id });
    const fig = html("figure", { class: "t-img" });
    const box = html("div", { class: "t-imgbox" });
    box.append(fig);
    lab.append(box);
    const type = html("span", { class: "t-type caption-5" }); type.innerHTML = `<i class="ph ${TYPE[t.type].icon}" aria-hidden="true"></i>`; type.append(document.createTextNode(TYPE[t.type].label));
    const chk = html("span", { class: "t-check", "aria-hidden": "true" }); chk.innerHTML = `<i class="ph ph-check" aria-hidden="true"></i>`;
    const km = habKm(t), [dc, dl] = distClass(km);
    const body = html("div", { class: "t-body" });
    const meta = html("p", { class: "t-meta caption-4" });
    meta.innerHTML = `<span><strong>${priority(t)}</strong> priority</span><span><strong>${t.minutes}</strong> min on site</span><span>Returns <strong>1 ${PRODUCT[t.type][0]}</strong></span><span class="t-dist ${dc}" data-id="${t.id}">${dl} · ${km.toFixed(1)} km</span>`;
    body.append(html("p", { class: "title-3" }, t.name), html("p", { class: "body-6 muted" }, t.detail), meta);
    if (closed) {
      const why = html("p", { class: "t-closed caption-4", id: `${id}-closed` });
      why.innerHTML = `<i class="ph ph-cloud-warning" aria-hidden="true"></i>`; why.append(document.createTextNode(`Not available today: ${closed}`));
      body.append(why);
    }
    lab.append(body);
    li.append(cb, lab);
    renderPhoto(fig, t.id, t.name, false);
    box.append(type, chk);
    if (closed) box.append(html("span", { class: "t-closed-badge caption-5" }, "Closed · dust storm"));
    const p = D.photos[t.id];
    if (p) lab.append(html("small", { class: "t-credit" }, `${p.caption} · ${p.credit || "NASA/JPL-Caltech/ASU/MSSS"}`));
    return li;
  }
  function renderTaskPage() {
    const today = $("#task-today"), far = $("#task-far"), sight = $("#task-sight");
    today.innerHTML = ""; far.innerHTML = ""; sight.innerHTML = "";
    if (state.draft) for (const id of [...state.draft]) { const t = D.tasks.find((x) => x.id === id); if (t && closedReason(t)) state.draft.delete(id); }
    const nClosed = D.tasks.filter(closedReason).length, note = $("#tasks-storm");
    note.hidden = !nClosed;
    if (nClosed) { note.innerHTML = `<i class="ph ph-cloud-warning" aria-hidden="true"></i>`; note.append(document.createTextNode(`Dust storm today (dust τ ${DEMO_STORM.tau.toFixed(2)}). ${nClosed} tasks are closed: sightseeing and the rim climbs. They show in grey and cannot be picked.`)); }
    for (const t of D.tasks) (t.group === "sight" ? sight : t.today ? today : far).append(taskCard(t));
    const nFar = D.tasks.filter((t) => !t.today && t.group !== "sight").length;

    $("#btn-more-tasks span").textContent = far.hidden ? `Show ${nFar} tasks farther away` : "Hide tasks farther away";
    updateTaskSummary();
  }
  // ---------- Live plan panel: best landing site, budget, best fit tasks ----------
  const DETOUR = 1.3; // planned routes run ~30 % longer than the straight line
  const PRIO_VALUE = { High: 3, Medium: 2, Low: 1 };
  const RESERVE = 70; // keep 30 % life support in reserve
  // shortest closed tour from start through all points (Held-Karp, exact for up to ~10 stops)
  function tourKm(start, list) {
    const n = list.length; if (!n) return 0;
    const P = list.map((t) => t.pos), d0 = P.map((p) => MarsMap.distanceKm(start, p));
    const dd = P.map((p) => P.map((q) => MarsMap.distanceKm(p, q)));
    const FULL = 1 << n, dp = new Float64Array(FULL * n).fill(Infinity);
    for (let i = 0; i < n; i++) dp[(1 << i) * n + i] = d0[i];
    for (let m = 1; m < FULL; m++) for (let i = 0; i < n; i++) {
      const v = dp[m * n + i]; if (v === Infinity || !(m & (1 << i))) continue;
      for (let j = 0; j < n; j++) if (!(m & (1 << j))) { const k = (m | (1 << j)) * n + j, w = v + dd[i][j]; if (w < dp[k]) dp[k] = w; }
    }
    let best = Infinity; for (let i = 0; i < n; i++) best = Math.min(best, dp[(FULL - 1) * n + i] + d0[i]);
    return best * DETOUR;
  }
  const lifeUse = (km, list) => km * RULES.o2PerKm + list.length * RULES.stopO2 + km * 0.4; // + rough allowance for climbing
  const evaHours = (km, list) => km / RULES.speedKmh + list.reduce((s, t) => s + t.minutes, 0) / 60;
  function renderPlanPanel() {
    const picked = D.tasks.filter((t) => state.draft.has(t.id));
    // 1) rank landing sites by tour length for the picked tasks
    const sites = D.landingSites.map((s) => ({ ...s, km: tourKm(s.pos, picked) }));
    const best = picked.length ? sites.reduce((b, s) => (s.km < b.km ? s : b)) : null;
    if (best && $("#land-auto").checked) state.draftLanding = best.id;
    const land = $("#land-list"); land.innerHTML = "";
    for (const s of [...sites].sort((x, y) => (picked.length ? x.km - y.km : 0))) {
      const b = html("button", { class: "land", type: "button", role: "radio", "aria-checked": String(s.id === state.draftLanding) });
      const top = html("span", { class: "land-top" });
      top.append(html("span", { class: "land-dot", "aria-hidden": "true" }, siteLetter(s.id)), html("span", { class: "title-4" }, s.name));
      if (best && s.id === best.id) top.append(html("span", { class: "badge" }, "Best"));
      b.append(top, html("span", { class: "caption-4 land-km" }, picked.length ? `Tour about ${s.km.toFixed(1)} km${best && s.id !== best.id ? ` · +${(s.km - best.km).toFixed(1)} km vs best` : ""}` : s.note));
      b.addEventListener("click", () => { $("#land-auto").checked = false; state.draftLanding = s.id; updateTaskSummary(); });
      land.append(b);
    }
    $("#land-hint").textContent = picked.length
      ? `Ranked by the shortest tour through your ${picked.length} task${picked.length > 1 ? "s" : ""}. ${landingOf(state.draftLanding).note}`
      : "Pick tasks first. The planner then ranks the four landing sites by how short the tour from each would be.";
    // distances on the cards follow the chosen landing site
    document.querySelectorAll(".t-dist").forEach((el) => {
      const t = D.tasks.find((x) => x.id === el.dataset.id), km = habKm(t), [dc, dl] = distClass(km);
      el.className = `t-dist ${dc}`; el.textContent = `${dl} · ${km.toFixed(1)} km`;
    });
    // 2) budget
    const site = landingOf(state.draftLanding), km = tourKm(site.pos, picked), use = lifeUse(km, picked);
    const fill = $("#budget-fill");
    fill.style.width = `${Math.min(100, use)}%`;
    fill.className = use > RESERVE ? "over" : use > RESERVE * 0.8 ? "warn" : "";
    $("#budget-text").textContent = picked.length
      ? `About ${km.toFixed(1)} km and ${fmtMin(evaHours(km, picked) * 60)} outside. Life support use about ${Math.round(use)} % of the ${RESERVE} % allowed before the reserve.`
      : "Life support use: none yet. The line marks the 30 % reserve.";
    // 3) best fit: what to add next
    const have = new Set(picked.map((t) => t.type));
    const cands = D.tasks.filter((t) => !state.draft.has(t.id) && !closedReason(t)).map((t) => {
      const k2 = tourKm(site.pos, [...picked, t]), dk = k2 - km;
      const fresh = !have.has(t.type);
      const value = PRIO_VALUE[priority(t)] + (fresh ? 1 : 0);
      const score = value / (dk / RULES.speedKmh + t.minutes / 60 + 0.3);
      const over = lifeUse(k2, [...picked, t]) > RESERVE;
      const why = [];
      if (over) why.push("Would cut into the 30 % life support reserve");
      else {
        why.push(dk < 0.6 ? `On the way, adds only ${Math.max(0, dk).toFixed(1)} km` : `Adds ${dk.toFixed(1)} km to the tour`);
        if (fresh && picked.length) why.push(`first ${PRODUCT[t.type][0]} today`);
        if (priority(t) === "High") why.push("high priority");
      }
      return { t, score, over, why };
    }).sort((x, y) => (x.over - y.over) || (y.score - x.score));
    const ol = $("#fit-list"), prev = [...ol.children].map((li) => li.dataset.id).join();
    ol.innerHTML = "";
    if (state.draft.size >= MAX_TASKS) ol.append(html("li", { class: "caption-4 muted" }, `The tour is full at ${MAX_TASKS} tasks.`));
    else cands.slice(0, 5).forEach((c, i) => {
      const li = html("li", { class: c.over ? "over" : "" }); li.dataset.id = c.t.id;
      const name = html("span", { class: "title-4" }); name.append(html("span", { class: "rank" }, `${i + 1}`), document.createTextNode(c.t.name));
      const add = html("button", { class: "btn btn-ghost button-sm fit-add", type: "button", "aria-label": `Add ${c.t.name}` }, "Add");
      add.addEventListener("click", () => {
        const cb = document.getElementById(`task-${c.t.id}`);
        if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); }
        if (cb && cb.closest("#task-far") && $("#task-far").hidden) $("#btn-more-tasks").click();
      });
      li.append(name, add, html("span", { class: "why caption-4" }, `${TYPE[c.t.type].label} · ${c.why.join(" · ")}`));
      ol.append(li);
    });
    if ([...ol.children].map((li) => li.dataset.id).join() !== prev) [...ol.children].forEach((li) => li.classList.add("flash"));
  }

  function updateTaskSummary() {
    const picked = D.tasks.filter((t) => state.draft.has(t.id));
    const go = $("#btn-tasks-go");
    go.disabled = picked.length === 0;
    renderPlanPanel();
    if (!picked.length) { $("#tasks-summary").textContent = "No tasks picked yet. Tick at least one."; return; }
    const mins = picked.reduce((s, t) => s + t.minutes, 0);
    const far = Math.max(...picked.map(habKm));
    $("#tasks-summary").innerHTML = `<strong>${picked.length}</strong> task${picked.length > 1 ? "s" : ""} · ${returnOf(picked)} · ${Math.floor(mins / 60) ? Math.floor(mins / 60) + " h " : ""}${mins % 60} min on site · farthest stop ${far.toFixed(1)} km from ${landingOf(state.draftLanding).name}`;
  }
  function openTasks() {
    const again = state.planned;
    state.draft = new Set(again ? state.selected[TODAY.id] : []);
    state.draftLanding = state.landing;
    $("#land-auto").checked = !state.manualLanding;
    $("#tasks-title").textContent = again ? "Change your mind?" : "What do you want to do today?";
    $("#tasks-sub").textContent = again
      ? "Add or drop tasks. When you confirm, the planner redesigns all three routes."
      : "Pick one or more tasks. When you confirm, the planner works out the best order and three routes to get there and back safely.";
    $("#btn-tasks-go").firstChild.textContent = again ? "Confirm and redesign route " : "Confirm and plan my route ";
    $("#btn-tasks-cancel").hidden = !again;
    renderTaskPage();
    setScreen("tasks");
    $("#tasks").scrollTop = 0;
    const first = $("#tasks input"); if (first) first.focus({ preventScroll: true });
  }
  function confirmTasks() {
    if (!state.draft.size) return;
    const go = $("#btn-tasks-go"); go.disabled = true; go.firstChild.textContent = "Planning… ";
    setTimeout(() => { // let the button repaint before the planner runs
      state.selected[TODAY.id] = new Set(state.draft);
      state.landing = state.draftLanding;
      state.manualLanding = !$("#land-auto").checked;
      const site = landingOf(state.landing);
      D.habitat.pos = site.pos.slice(); D.habitat.name = site.name;
      planMission(TODAY);
      state.routeIdx = 0; state.planned = true;
      setScreen("plan");
      state.routeAnim = { t0: null }; // hide the new lines until the map has flown over
      renderPlan(); buildMarkers(); drawOverlays();
      setTimeout(() => revealRoutes(), 300); // once the task page has faded out
      $(".plan-only.side-scroll").scrollTop = 0;
      toast(`Route planned for ${state.draft.size} task${state.draft.size > 1 ? "s" : ""}.`);
      $("#btn-start").focus({ preventScroll: true });
    }, 30);
  }
  $("#btn-tasks-go").addEventListener("click", confirmTasks);
  $("#land-auto").addEventListener("change", updateTaskSummary);
  $("#btn-tasks-cancel").addEventListener("click", () => setScreen("plan"));
  $("#btn-change").addEventListener("click", openTasks);
  $("#btn-more-tasks").addEventListener("click", () => {
    const far = $("#task-far"); far.hidden = !far.hidden;
    $("#btn-more-tasks").setAttribute("aria-expanded", String(!far.hidden));
    $("#btn-more-tasks i").className = `ph ${far.hidden ? "ph-caret-down" : "ph-caret-up"}`;
    $("#btn-more-tasks span").textContent = far.hidden ? `Show ${D.tasks.filter((t) => !t.today && t.group !== "sight").length} tasks farther away` : "Hide tasks farther away";
  });

  // ---------- Wiring ----------
  $("#btn-intro").addEventListener("click", openTasks);
  $("#btn-start").addEventListener("click", startEva);
  $("#btn-sample").addEventListener("click", collectSample);
  $("#btn-again").addEventListener("click", backToPlan);
  $("#btn-retry").addEventListener("click", () => { backToPlan(); startEva(); });
  $("#btn-sources").addEventListener("click", () => { $("#sources").hidden = false; $("#btn-sources-close").focus(); });
  $("#btn-sources-close").addEventListener("click", () => { $("#sources").hidden = true; });
  $("#sources").addEventListener("click", (e) => { if (e.target.id === "sources") $("#sources").hidden = true; });

  // Settings: developer options for recording demo videos
  function syncDevUi() {
    $("#dev-demo-weather").checked = dev.demoWeather;
    $("#dev-demo-state").textContent = dev.demoWeather ? "On: dust storm today, storm event early on every route" : "Off: normal forecast";
  }
  $("#btn-settings").addEventListener("click", () => { syncDevUi(); $("#settings").hidden = false; $("#btn-settings-close").focus(); });
  $("#btn-settings-close").addEventListener("click", () => { $("#settings").hidden = true; });
  $("#settings").addEventListener("click", (e) => { if (e.target.id === "settings") $("#settings").hidden = true; });
  $("#dev-demo-weather").addEventListener("change", (e) => {
    dev.demoWeather = e.target.checked;
    try { localStorage.setItem(DEV_KEY, dev.demoWeather ? "1" : "0"); } catch { /* applies until reload */ }
    syncDevUi();
    const dropped = pruneClosed();
    replanAll();
    renderWeather();
    if (state.screen === "tasks") renderTaskPage();
    if (!state.run) setCond("#cond-dust", ...dustBase());
    const closedMsg = dev.demoWeather ? ` Sightseeing and rim climbs are closed${dropped ? `; ${dropped} closed task${dropped > 1 ? "s were" : " was"} taken off the plan` : ""}.` : "";
    toast(dev.demoWeather
      ? `Demo weather on.${state.run ? " It applies from the next EVA." : " The dust storm now hits early on every route."}${closedMsg}`
      : `Demo weather off.${state.run ? " It applies from the next EVA." : " Back to the normal forecast and all tasks open."}`);
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches('input:not([type="checkbox"]), textarea')) return;
    const k = e.key.toLowerCase();
    if (k === "escape" && !$("#photo").hidden) { closePhoto(); return; }
    if (k === "escape") {
      if (!$("#sources").hidden) { $("#sources").hidden = true; return; }
      if (!$("#settings").hidden) { $("#settings").hidden = true; $("#btn-settings").focus(); return; }
      if ($("#map-card").classList.contains("full")) { $("#btn-full").click(); return; }
      if (!$("#layer-panel").hidden) { $("#btn-layers").click(); return; }
    }
    if (!$("#settings").hidden) return; // no game shortcuts while Settings is open
    if (k === "d" && !e.metaKey && !e.ctrlKey) {
      state.drawMode = !state.drawMode;
      if (!state.drawMode) state.drawPts = [];
      buildMarkers();
      toast(state.drawMode ? "Draw mode on. Click the map to log [lat, lon] points to the console." : "Draw mode off.");
      return;
    }
    if (k === "+" || k === "=") { map.zoomBy(1); return; }
    if (k === "-") { map.zoomBy(-1); return; }
    if (state.screen === "intro" && k === "enter") { e.preventDefault(); $("#btn-intro").click(); return; }
    if (state.screen === "tasks") {
      if (k === "enter" && !e.target.matches("button")) { e.preventDefault(); confirmTasks(); }
      if (k === "escape" && state.planned) setScreen("plan");
      return;
    }
    if (state.screen === "plan") {
      if (k === "enter" && !e.target.matches("button")) { e.preventDefault(); startEva(); }
      if (["1", "2", "3"].includes(k)) selectRoute(Number(k) - 1);
      return;
    }
    if (state.screen === "event" && ["1", "2"].includes(k)) { chooseEvent(Number(k) - 1); return; }
    if (state.screen === "eva" && state.run) {
      if (k === " ") { e.preventDefault(); state.run.paused = !state.run.paused; }
      if (k === "f") state.run.fast = !state.run.fast;
      if (k === "s") collectSample();
      if (k === "p") { e.preventDefault(); openPhoto(); }
      if ((k === "y" || k === "n") && !$("#crew-alert").hidden) answerAlert(k === "y");
    }
  });

  // ---------- Crew photo points: data collected for the next astronaut ----------
  const TAGS = {
    hazard: { label: "Hazard", icon: "ph-warning" },
    tip: { label: "Tip", icon: "ph-lightbulb" },
    science: { label: "Science", icon: "ph-flask" },
    view: { label: "View", icon: "ph-mountains" }
  };
  const SEED = [
    { id: "s1", pos: [18.4290, 77.4236], tag: "hazard", title: "Ripples deeper than they look", note: "Wheels sank about 20 cm here. Stay on the bedrock strip to the north.", by: "Crew 2, Sol 11", confirms: 1, seed: true },
    { id: "s2", pos: [18.4512, 77.4046], tag: "tip", title: "Firm strip beside the depot", note: "Flat and rock free. Easiest driving on the whole delta front.", by: "Crew 2, Sol 14", confirms: 2, seed: true },
    { id: "s3", pos: [18.4596, 77.3936], tag: "science", title: "Thin mudstone layers", note: "Best exposure at waist height on the north face. Bring the close up imager.", by: "Crew 3, Sol 4", seed: true },
    { id: "s4", pos: [18.4652, 77.4012], tag: "view", title: "Delta panorama", note: "Walk 20 m up the gap for a view over the whole crater floor.", by: "Crew 3, Sol 6", confirms: 1, seed: true },
    { id: "s5", pos: [18.4565, 77.3205], tag: "hazard", title: "Loose scree on the rim slope", note: "Footing slides on the steeper part. Keep to the ridge line.", by: "Crew 3, Sol 19", seed: true },
    { id: "s6", pos: [18.4455, 77.4372], tag: "hazard", title: "Soft drift across the track", note: "Fresh sand piled up after the last dust event. Rover crawled through at 2 km/h.", by: "Crew 4, Sol 2", seed: true },
    { id: "s7", pos: [18.4548, 77.4140], tag: "tip", title: "Shade for a suit check", note: "The delta scarp throws shade here after 14:00. Good spot to cool the suit and check seals.", by: "Crew 4, Sol 5", confirms: 1, seed: true }
  ];
  const STORE = "momoot.photoPoints.v1";
  const VOTES = "momoot.photoVotes.v1";
  function loadHighlights() { try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { return []; } }
  function saveHighlights() { try { localStorage.setItem(STORE, JSON.stringify(highlights.filter((h) => !h.seed))); } catch { toast("This browser could not save the photo point. It stays until you reload."); } }
  let highlights = [...SEED, ...loadHighlights()];
  // How later crews rate a note: confirmed (still there) or reported gone
  let votes = (() => { try { return JSON.parse(localStorage.getItem(VOTES) || "{}"); } catch { return {}; } })();
  function saveVotes() { try { localStorage.setItem(VOTES, JSON.stringify(votes)); } catch { /* kept in memory */ } }
  const confirmsOf = (h) => (h.confirms || 0) + ((votes[h.id] || {}).up || 0);
  const goneOf = (h) => (h.gone || 0) + ((votes[h.id] || {}).gone || 0);
  const isActive = (h) => goneOf(h) <= confirmsOf(h);
  const crewOf = (h) => String(h.by || "Unknown crew").split(",")[0];
  function statusOf(h) {
    const c = confirmsOf(h), g = goneOf(h);
    if (!isActive(h)) return `Reported gone by ${g} crew${g > 1 ? "s" : ""}${h.tag === "hazard" ? ", no longer avoided" : ""}`;
    if (c) return `Confirmed by ${c} later crew${c > 1 ? "s" : ""}`;
    return "Not confirmed yet";
  }
  let notesVersion = 0; // bumps whenever notes or votes change, so route intel is recomputed
  state.showPhotos = true;
  const snapCache = {};

  function applyCrewHazards() {
    Planner.setPointHazards(D, highlights.filter((h) => h.tag === "hazard" && isActive(h)).map((h) => ({ pos: h.pos, r: 40 })));
  }

  // Notes within maxKm of a route, in the order the crew will pass them
  function notesAlong(r, maxKm = 0.2) {
    if (r._notes && r._notes.v === notesVersion && r._notes.max === maxKm) return r._notes.list;
    const list = [];
    for (const h of highlights) {
      let best = Infinity, bi = 0;
      for (let i = 0; i < r.dense.length; i++) { const d = MarsMap.distanceKm(h.pos, r.dense[i]); if (d < best) { best = d; bi = i; } }
      if (best <= maxKm) list.push({ h, km: r.cum[bi], off: best });
    }
    list.sort((a, b) => a.km - b.km);
    r._notes = { v: notesVersion, max: maxKm, list };
    return list;
  }

  function renderRouteNotes(r) {
    const list = notesAlong(r);
    const ol = $("#intel-list"); ol.innerHTML = "";
    $("#intel-count").textContent = `${list.length} note${list.length === 1 ? "" : "s"}`;
    const haz = list.filter((x) => x.h.tag === "hazard" && isActive(x.h)).length;
    const crews = new Set(list.map((x) => crewOf(x.h))).size;
    $("#intel-lead").textContent = list.length
      ? `${crews} earlier crew${crews > 1 ? "s" : ""} left notes within 200 m of the ${r.label.toLowerCase()} route.${haz ? ` The planner already steers around ${haz} active hazard report${haz > 1 ? "s" : ""}.` : ""} You will get each note on screen as you pass it.`
      : "No crew has left a note along this route yet. Be the first: press P during the EVA.";
    for (const { h, km, off } of list) {
      const li = html("li", { class: `intel-item${isActive(h) ? "" : " gone"}` });
      const b = html("button", { class: "intel-btn", type: "button" });
      const tag = html("span", { class: `tag ${h.tag}` }); tag.innerHTML = `<i class="ph-fill ${TAGS[h.tag].icon}" aria-hidden="true"></i>`;
      const t = html("span", { class: "intel-t" });
      t.append(html("span", { class: "title-4" }, h.title), html("span", { class: "caption-5 muted" }, `${km.toFixed(1)} km in · ${Math.round(off * 1000)} m from the route · ${crewOf(h)} · ${statusOf(h)}`));
      b.append(tag, t);
      b.addEventListener("click", () => map.flyTo(h.pos[0], h.pos[1], 16.8, 700));
      li.append(b);
      ol.append(li);
    }
    renderLogStats();
  }

  function renderLogStats() {
    const crews = new Set(highlights.map(crewOf)).size;
    const haz = highlights.filter((h) => h.tag === "hazard" && isActive(h)).length;
    const mine = highlights.filter((h) => !h.seed).length;
    $("#crew-log-stats").textContent = `${highlights.length} notes from ${crews} crews · ${haz} active hazard reports · ${mine} logged or loaded on this device`;
  }

  // During the EVA: show each crew note as the rover reaches it
  function showCrewAlert(n) {
    const h = n.h, run = state.run;
    run.alert = n;
    $("#ca-kicker").textContent = `${TAGS[h.tag].label} note from ${crewOf(h)}`;
    $("#ca-icon").className = `ph-fill ${TAGS[h.tag].icon}`;
    $("#crew-alert").className = `block crew-alert ${h.tag}`;
    $("#ca-title").textContent = h.title;
    $("#ca-note").textContent = h.note;
    $("#ca-by").textContent = `${h.by} · ${statusOf(h)}`;
    const hz = h.tag === "hazard";
    $("#btn-ca-yes").firstChild.textContent = hz ? "Still there " : "Helpful ";
    $("#btn-ca-no").firstChild.textContent = hz ? "Gone now " : "Not useful ";
    $("#crew-alert").hidden = false;
    toast(`Crew note ahead: ${h.title}`);
  }
  function answerAlert(up) {
    const run = state.run; if (!run || !run.alert) return;
    const h = run.alert.h, hz = h.tag === "hazard";
    const v = (votes[h.id] ||= { up: 0, gone: 0 });
    if (up) v.up++; else if (hz) v.gone++;
    saveVotes(); notesVersion++;
    run.votes = (run.votes || 0) + 1;
    run.log.push(up ? `Confirmed ${crewOf(h)}'s note: ${h.title}` : hz ? `Reported ${crewOf(h)}'s hazard as gone: ${h.title}` : `Rated ${crewOf(h)}'s note not useful: ${h.title}`);
    if (hz) { applyCrewHazards(); for (const m of D.missions) planMission(m); }
    run.alert = null;
    $("#crew-alert").hidden = true;
    buildMarkers();
    toast(up ? "Thanks. The next crew will see your confirmation." : hz ? "Logged. Once more crews agree, routes stop avoiding it." : "Logged.");
  }
  $("#btn-ca-yes").addEventListener("click", () => answerAlert(true));
  $("#btn-ca-no").addEventListener("click", () => answerAlert(false));

  // Crew log: the file one crew hands to the next (or another device)
  function exportLog() {
    const pts = highlights.filter((h) => !h.seed);
    const doc = { format: "momoot-crew-log", version: 1, exported: new Date().toISOString(), site: D.site, sol: D.sol, points: pts, votes };
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: "application/json" }));
    const a = html("a", { href: url, download: `momoot-crew-log-sol${D.sol}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Crew log saved: ${pts.length} note${pts.length === 1 ? "" : "s"} and ${Object.keys(votes).length} ratings. Load it on the next crew's device.`);
  }
  const [[pS, pW], [pN, pE]] = D.planArea;
  function cleanPoint(p) {
    if (!p || typeof p !== "object" || !Array.isArray(p.pos) || p.pos.length !== 2) return null;
    const lat = Number(p.pos[0]), lon = Number(p.pos[1]);
    if (!(lat > pS - 0.5 && lat < pN + 0.5 && lon > pW - 0.5 && lon < pE + 0.5)) return null;
    if (!TAGS[p.tag] || typeof p.title !== "string" || !p.title.trim()) return null;
    const s = (v, n) => String(v == null ? "" : v).slice(0, n);
    const out = { id: s(p.id || `i${Date.now()}${Math.random()}`, 40), pos: [lat, lon], tag: p.tag, title: s(p.title, 60), note: s(p.note || "No note.", 240), by: s(p.by || "Another crew", 40) };
    if (typeof p.img === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(p.img) && p.img.length < 400000) out.img = p.img;
    return out;
  }
  function importLog(file) {
    const rd = new FileReader();
    rd.onload = () => {
      let doc;
      try { doc = JSON.parse(rd.result); } catch { toast("That file is not a Momoot crew log."); return; }
      if (!doc || doc.format !== "momoot-crew-log" || !Array.isArray(doc.points)) { toast("That file is not a Momoot crew log."); return; }
      const have = new Set(highlights.map((h) => h.id));
      let added = 0;
      for (const raw of doc.points) { const p = cleanPoint(raw); if (p && !have.has(p.id)) { highlights.push(p); have.add(p.id); added++; } }
      if (doc.votes && typeof doc.votes === "object") {
        for (const [id, v] of Object.entries(doc.votes)) {
          if (!have.has(id) || !v) continue;
          const mine = (votes[id] ||= { up: 0, gone: 0 });
          mine.up = Math.max(mine.up, Math.min(99, Number(v.up) || 0));
          mine.gone = Math.max(mine.gone, Math.min(99, Number(v.gone) || 0));
        }
      }
      saveHighlights(); saveVotes(); notesVersion++;
      applyCrewHazards(); for (const m of D.missions) planMission(m);
      if (!state.run) { renderPlan(); buildMarkers(); drawOverlays(); }
      toast(added ? `Loaded ${added} new note${added > 1 ? "s" : ""} from another crew. Routes were re planned.` : "No new notes in that log. Ratings were merged.");
    };
    rd.readAsText(file);
  }
  $("#btn-log-export").addEventListener("click", exportLog);
  $("#log-import").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) importLog(f); e.target.value = ""; });

  // A real HiRISE snapshot of the spot, cut from the Mars Trek tiles
  function snapshot(lat, lon) {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (snapCache[key]) return snapCache[key];
    const inHi = lat > 18.31 && lat < 18.66 && lon > 77.23 && lon < 77.58;
    const layer = inHi ? L[HIRISE] : L[CTX], z = inHi ? 16 : 13;
    const Wd = 256 * Math.pow(2, z + 1);
    const gx = ((lon + 180) / 360) * Wd, gy = ((90 - lat) / 180) * (Wd / 2);
    const cw = 240, ch = 160, x0 = gx - cw / 2, y0 = gy - ch / 2;
    const tx0 = Math.floor(x0 / 256), tx1 = Math.floor((x0 + cw) / 256), ty0 = Math.floor(y0 / 256), ty1 = Math.floor((y0 + ch) / 256);
    const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
    const ctx = cv.getContext("2d");
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(new Promise((res, rej) => {
        const im = new Image(); im.crossOrigin = "anonymous";
        im.onload = () => { ctx.drawImage(im, tx * 256 - x0, ty * 256 - y0); res(); };
        im.onerror = rej;
        im.src = layer.template.replace("{z}", z).replace("{y}", ty).replace("{x}", tx);
      }));
    }
    return (snapCache[key] = Promise.all(jobs).then(() => {
      ctx.strokeStyle = "#FFD84D"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cw / 2, ch / 2, 10, 0, Math.PI * 2); ctx.stroke();
      return cv.toDataURL("image/jpeg", 0.8);
    }).catch(() => null));
  }
  function fillPhoto(fig, h) {
    fig.innerHTML = "";
    if (h.img) { fig.append(html("img", { src: h.img, alt: `Photo point: ${h.title}` })); return; }
    fig.append(illustration(h.tag === "science" ? "delta" : h.tag === "hazard" ? "dunes" : "rim", h.title));
    snapshot(h.pos[0], h.pos[1]).then((url) => { if (url) { fig.innerHTML = ""; fig.append(html("img", { src: url, alt: `HiRISE view of ${h.title}` })); } });
  }

  function renderHighlights() {
    const ul = $("#highlights"); ul.innerHTML = "";
    const list = [...highlights].reverse();
    for (const h of list) {
      const li = html("li", { class: `hl${isActive(h) ? "" : " gone"}` });
      const fig = html("figure", { class: "img" }); fillPhoto(fig, h);
      const tx = html("div", { class: "txt" });
      const tag = html("span", { class: `tag ${h.tag}` }); tag.innerHTML = `<i class="ph-fill ${TAGS[h.tag].icon}" aria-hidden="true"></i>`; tag.append(document.createTextNode(TAGS[h.tag].label));
      const go = html("button", { class: "wp-link body-5", type: "button" }, "Show on map");
      go.addEventListener("click", () => map.flyTo(h.pos[0], h.pos[1], 16.8, 700));
      tx.append(tag, html("p", { class: "title-3" }, h.title), html("p", { class: "body-6 muted" }, h.note), html("p", { class: "caption-5 muted" }, `${h.by} · ${statusOf(h)}`), go);
      li.append(fig, tx);
      ul.append(li);
    }
  }

  // Logging during the EVA
  function openPhoto() {
    const run = state.run; if (!run || state.screen !== "eva" || !$("#event").hidden || !$("#photo").hidden) return;
    run.paused = true;
    const p = pointAtKm(run.r, run.km);
    state.photoAt = p;
    $("#photo-where").textContent = `${fmtLatLon(p[0], p[1])} · ${run.km.toFixed(2)} km into the tour`;
    $("#photo-name").value = ""; $("#photo-note").value = ""; $("#photo-error").hidden = true;
    fillPhoto($("#photo-preview"), { pos: p, title: "this spot", tag: "view" });
    $("#photo").hidden = false;
    $("#photo-name").focus();
  }
  function closePhoto() { $("#photo").hidden = true; if (state.run) { state.run.paused = false; last = performance.now(); } }
  function savePhoto() {
    const title = $("#photo-name").value.trim();
    if (!title) { $("#photo-error").hidden = false; $("#photo-name").focus(); return; }
    const tag = document.querySelector('input[name="ptag"]:checked').value;
    const p = state.photoAt;
    const h = { id: `u${Date.now()}`, pos: [+p[0].toFixed(6), +p[1].toFixed(6)], tag, title, note: $("#photo-note").value.trim() || "No note.", by: `You, Sol ${D.sol}` };
    const img = $("#photo-preview img");
    if (img && img.src.startsWith("data:")) h.img = img.src;
    highlights.push(h);
    saveHighlights(); notesVersion++;
    const run = state.run;
    if (run) { run.photos = (run.photos || 0) + 1; run.log.push(`Left a ${TAGS[tag].label.toLowerCase()} photo point: ${title}`); renderChecklist(); }
    $("#photo-count").textContent = `${run ? run.photos : 0} photo points logged on this EVA.`;
    if (tag === "hazard") { applyCrewHazards(); for (const m of D.missions) planMission(m); }
    buildMarkers();
    closePhoto();
    toast(tag === "hazard" ? "Hazard saved. Future routes will keep clear of it." : "Photo point saved for the next crew.");
  }
  $("#btn-photo").addEventListener("click", openPhoto);
  $("#btn-photo-save").addEventListener("click", savePhoto);
  $("#btn-photo-cancel").addEventListener("click", closePhoto);
  $("#ov-photos").addEventListener("change", (e) => { state.showPhotos = e.target.checked; buildMarkers(); });
  applyCrewHazards();
  for (const m of D.missions) planMission(m);

  // ---------- Real hazard data ----------
  // 1) cost_matrix.json from tools/terrain_hazard (HiRISE DTM: slopes, craters, rocks), if present
  // 2) live scan of the HiRISE tiles for shadows next to sunlit slopes
  const fieldEls = [];
  function replanAll(msg) {
    hazImg = Planner.hazardImage(D);
    hazEl.setAttribute("href", hazImg.url);
    // precise detected hazard outlines, drawn at the detector's own resolution
    fieldEls.forEach((f) => f.el.remove()); fieldEls.length = 0;
    for (const f of Planner.fieldImages()) fieldEls.push({ el: svg("image", { href: f.url, preserveAspectRatio: "none" }, gHaz), bounds: f.bounds });
    for (const m of D.missions) planMission(m);
    if (!state.run) { renderPlan(); buildMarkers(); }
    drawOverlays();
    if (msg) setScanStatus(msg);
  }
  function setScanStatus(msg) { const n = $("#scan-info"); if (n) n.textContent = msg; }

  function loadCostMatrix() {
    return fetch("data/cost_matrix.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("none"))))
      .then((doc) => {
        const ll = doc.georef && doc.georef.latLonIfEquirectangular;
        if (!ll || !doc.reasons) throw new Error("no lat/lon bounds");
        const bits = new Uint8Array(doc.width * doc.height);
        for (let r = 0; r < doc.height; r++) for (let c = 0; c < doc.width; c++) bits[r * doc.width + c] = doc.reasons[r][c] & 7; // slope, crater, rock (ignore no data)
        const res = Planner.mergeMask(D, { width: doc.width, height: doc.height, bounds: [[ll.south, ll.west], [ll.north, ll.east]], bits }, 0.05);
        return `HiRISE elevation hazards loaded: ${res.blocked.toLocaleString("en")} blocked cells (slopes ${doc.stats?.byReason?.["steep slope"] ?? "?"}, craters ${doc.stats?.craters ?? "?"}, rocks ${doc.stats?.rocks ?? "?"}).`;
      });
  }

  function runScan() {
    const Scan = window.MomootHazardScan;
    if (!Scan) return;
    setScanStatus("Scanning NASA HiRISE imagery for hazards…");
    const layers = [L[HIRISE], L[CTX]].map((l) => ({ name: l.name, template: l.template }));
    Scan.scan(D.scanArea || D.planArea, layers, 12, (s) => setScanStatus(`Hazard scan: ${s}…`))
      .then((res) => {
        const m = Planner.mergeMask(D, res);
        state.scan = res;
        replanAll((state.cmMsg ? state.cmMsg + " " : "") + `Hazard scan of ${res.source} imagery found ${res.found.coarse} hills or crater walls and ${res.found.fine} boulders or small craters. ${m.blocked.toLocaleString("en")} cells are now blocked for safe routes, and all routes were re planned.`);
      })
      .catch(() => setScanStatus("Hazard scan unavailable: the browser could not read the NASA image pixels. Routes use the terrain model only."));
  }

  loadCostMatrix().then((msg) => { state.cmMsg = msg; replanAll(msg); }).catch(() => {}).finally(runScan);

  // ---------- Boot ----------
  $("#sol-label").textContent = `Sol ${D.sol}`;
  $("#sol-inline").textContent = D.sol;
  $("#cond-temp").textContent = `−${Math.abs(D.conditions.tempC)} °C`;
  applyWeather();
  loadLiveWeather();
  $("#tasks-sol").textContent = D.sol;
  setCond("#cond-dust", ...dustBase());
  renderPlan();
  buildMarkers();
  const v0 = map.fitBounds([D.habitat.pos, ...mission().routes.flatMap((r) => r.dense)], 90, 16.5);
  map.setView(v0.lat, v0.lon, v0.zoom);
  setScreen("intro");
  $("#btn-intro").focus({ preventScroll: true });
  window.momootMap = map; // handy for debugging in the console
})();
