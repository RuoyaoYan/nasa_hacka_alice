/* Momoot · Komoot for Mars
 * Plain JavaScript, no build step. Map engine in marsmap.js, data in data/missions.js.
 */
(() => {
  "use strict";

  const D = window.MOMOOT_DATA;
  // Start planning must always close the intro, even if something below fails
  document.getElementById("btn-intro").addEventListener("click", () => { document.getElementById("intro").hidden = true; document.body.dataset.screen = "plan"; });
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
    screen: "intro", missionIdx: 0, routeIdx: 0, totalScore: 0,
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
  const fmtMin = (m) => { const h = Math.floor(m / 60); const mm = Math.round(m % 60); return h ? `${h} h ${String(mm).padStart(2, "0")}` : `${mm} min`; };
  const fmtClock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
  const fmtLatLon = (lat, lon) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? "E" : "W"}`;
  const mission = () => D.missions[state.missionIdx];
  const route = () => mission().routes[state.routeIdx];

  // ---------- Route planning ----------
  // Routes come from planner.js: a terrain cost map, Dijkstra between every
  // pair of targets, and a depth first search over visiting orders.
  const Planner = window.MomootPlanner;
  const TYPE = { sample: { label: "Sample", icon: "ph-flask" }, photo: { label: "Photo", icon: "ph-camera" }, measure: { label: "Measure", icon: "ph-gauge" } };
  state.selected = {};
  for (const m of D.missions) state.selected[m.id] = new Set(m.objectives.filter((o) => !o.bonus).map((o) => o.id));

  function measureLine(r) {
    r.cum = [0];
    for (let i = 1; i < r.dense.length; i++) r.cum.push(r.cum[i - 1] + MarsMap.distanceKm(r.dense[i - 1], r.dense[i]));
    r.km = r.cum[r.cum.length - 1];
  }

  function planMission(m) {
    const sel = state.selected[m.id];
    m.routes = Object.entries(D.profiles).map(([id, W]) => {
      const targets = m.objectives.filter((o) => sel.has(o.id) || (W.bonus && o.bonus));
      const plan = Planner.plan(D, targets, W);
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
      for (const w of m.weather) ev.push({ ...w });
      ev.sort((x, y) => x.at - y.at);
      r.events = ev.filter((x, i) => i === 0 || x.at - ev[i - 1].at > 0.06).slice(0, 3);
      r.risk = clamp(1 + (firstRock ? 1 : 0) + (firstSand || r.steepKm > 0.15 ? 1 : 0), 1, 3);
      const sandF = 1 + (an.terrain.sand / 100) * RULES.sandSlowdown;
      r.minPerKm = (60 / RULES.speedKmh) * sandF;
      const stopMin = r.allStops.reduce((t, s) => t + (s.minutes || RULES.stopMinutes), 0);
      r.totalMinutes = r.km * r.minPerKm + stopMin;
      r.o2Total = Math.round(r.km * RULES.o2PerKm + (r.climb / 20) * RULES.o2Per20mClimb + r.allStops.length * RULES.stopO2);
      return r;
    });
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
  const gHaz = svg("g", {}, map.svg);
  const hazImg = Planner.hazardImage(D);
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
    // hazard map from the planner's cost grid
    gHaz.style.display = state.showHazards ? "" : "none";
    if (state.showHazards) {
      const [[s, w], [n, e]] = hazImg.bounds;
      const a = map.toScreen(n, w), b = map.toScreen(s, e);
      hazEl.setAttribute("x", a.x); hazEl.setAttribute("y", a.y);
      hazEl.setAttribute("width", Math.max(1, b.x - a.x)); hazEl.setAttribute("height", Math.max(1, b.y - a.y));
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
      if (!inEva) {
        m.routes.forEach((r, i) => {
          if (i === state.routeIdx) return;
          svg("path", { d: pathD(r.dense), fill: "none", stroke: "#1D1C1A", "stroke-width": 7, opacity: 0.35, "stroke-linejoin": "round" }, gRoutes);
          svg("path", { d: pathD(r.dense), fill: "none", stroke: r.color, "stroke-width": 4, "stroke-dasharray": "10 6", "stroke-linejoin": "round", opacity: 0.95 }, gRoutes);
        });
      }
      const r = route();
      const d = pathD(r.dense);
      svg("path", { d, fill: "none", stroke: "#FFFFFF", "stroke-width": 10, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: inEva ? 0.6 : 1 }, gRoutes);
      svg("path", { d, fill: "none", stroke: r.color, "stroke-width": 6, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: inEva ? 0.45 : 1 }, gRoutes);
      drawArrows(r, gRoutes);
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
    const stopPts = [...r.allStops.map((s) => s.pos), ...m.objectives.map((o) => o.pos)];
    for (const lm of D.landmarks) {
      if (stopPts.some((p) => MarsMap.distanceKm(p, lm.pos) < 0.05)) continue; // a stop already marks this spot
      list.push({ pos: lm.pos, el: pinEl("landmark", "", lm.name, lm.note) });
    }
    if (state.showHazards) {
      for (const ev of r.events) {
        if (ev.type === "rock" || ev.type === "sand") {
          list.push({ pos: pointAt(r, ev.at), el: pinEl("hazard", "!", ev.type === "rock" ? "Boulder field" : "Soft sand", ev.type === "rock" ? "HiRISE" : "THEMIS") });
        }
      }
    }
    // targets not on this route: faint, click to add
    const onRoute = new Set(r.allStops.map((s) => s.id));
    if (!state.run) {
      for (const o of m.objectives) {
        if (onRoute.has(o.id)) continue;
        const el = pinEl("off", "+", o.name, `${TYPE[o.type].label} · +${o.points} pts${o.bonus ? " · bonus" : ""}`);
        el.classList.add("clickable"); el.title = "Add this target";
        el.addEventListener("click", (e) => { e.stopPropagation(); toggleObjective(o.id, true); });
        list.push({ pos: o.pos, el });
      }
    }
    for (const s of r.allStops) {
      const el = pinEl(s.main ? "target" : "stop", String(s.order), s.name, `${TYPE[s.type].label} · +${s.points} pts`, s.main ? null : r.color);
      list.push({ pos: s.pos, el });
    }
    list.push({ pos: D.habitat.pos, el: pinEl("", "A", "Habitat") });
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

  function fitRoute(all = true, ms = 700) {
    const m = mission();
    const pts = [D.habitat.pos, ...m.objectives.map((o) => o.pos), ...(all ? m.routes.flatMap((r) => r.dense) : route().dense)];
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
  $("#ov-traverse").addEventListener("change", (e) => {
    state.showTraverse = e.target.checked;
    if (state.showTraverse && !state.traverse) loadTraverse(); else drawOverlays();
  });

  function loadTraverse() {
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
  function renderTabs() {
    const nav = $("#mission-tabs"); nav.innerHTML = "";
    D.missions.forEach((m, i) => {
      const b = html("button", { class: "tab title-4", type: "button", role: "tab", "aria-selected": String(i === state.missionIdx) }, m.name);
      b.addEventListener("click", () => selectMission(i));
      nav.append(b);
    });
  }

  function renderPlan() {
    const m = mission(), r = route();
    $("#m-name").textContent = m.name;
    $("#m-goal").textContent = m.goal;
    const meta = $("#m-meta"); meta.innerHTML = "";
    const addMeta = (icon, label, val) => { const li = html("li"); li.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`; li.append(document.createTextNode(label + " "), html("strong", {}, val)); meta.append(li); };
    addMeta("ph-mountains", "Difficulty", ["", "Easy", "Moderate", "Hard"][m.difficulty]);
    addMeta("ph-star", "Reward", `+${r.allStops.reduce((t, s) => t + s.points, 0)} pts`);
    addMeta("ph-flag-banner", "Targets", `${r.allStops.length}`);
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

    renderProfile(r, m);

    const mix = $("#route-mix"); mix.innerHTML = "";
    const cols = { firm: "#8E4B2C", sand: "#EBCB9F", rocky: "#F5B400" };
    const names = { firm: "Firm ground", sand: "Loose sand", rocky: "Boulders" };
    const leg = $("#route-mix-legend"); leg.innerHTML = "";
    for (const k of ["firm", "sand", "rocky"]) {
      const s = html("span"); s.style.width = `${r.terrain[k]}%`; s.style.background = cols[k]; mix.append(s);
      const li = html("li"); const sw = html("i"); sw.style.background = cols[k];
      li.append(sw, document.createTextNode(`${names[k]} ${r.terrain[k]} %`)); leg.append(li);
    }

    const riskCols = ["#2E9E52", "#C27803", "#C8322B"];
    [...$("#route-risk").children].forEach((s, i) => { s.style.background = i < r.risk ? riskCols[r.risk - 1] : ""; });

    renderWaypoints(r, m);
  }

  function renderProfile(r, m) {
    const s = $("#route-profile"); s.innerHTML = "";
    const W = 480, H = 120, l = 52, rr = 12, t = 12, b = 28;
    const all = m.routes.flatMap((x) => x.profileElev);
    const lo = Math.min(0, ...all), hiRaw = Math.max(10, ...all);
    const step = hiRaw - lo > 300 ? 100 : hiRaw - lo > 60 ? 20 : 10;
    const bot = Math.floor(lo / step) * step, top = Math.ceil(hiRaw / step) * step;
    const X = (km) => l + (km / r.km) * (W - l - rr);
    const Y = (v) => t + (1 - (v - bot) / (top - bot)) * (H - t - b);
    for (const v of [bot, (bot + top) / 2, top]) {
      svg("line", { x1: l, x2: W - rr, y1: Y(v), y2: Y(v), stroke: "#DEDAD1", "stroke-width": 1 }, s);
      const tx = svg("text", { x: l - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 12, "font-family": "Poppins, sans-serif", fill: "#8C877D" }, s); tx.textContent = `${Math.round(v)} m`;
    }
    const n = r.profileElev.length, stepI = Math.max(1, Math.floor(n / 240));
    let line = "";
    for (let i = 0; i < n; i += stepI) line += `${line ? "L" : "M"}${X(r.profileKm[i]).toFixed(1)} ${Y(r.profileElev[i]).toFixed(1)}`;
    line += `L${X(r.km).toFixed(1)} ${Y(r.profileElev[n - 1]).toFixed(1)}`;
    svg("path", { d: `${line} L${X(r.km)} ${Y(bot)} L${X(0)} ${Y(bot)}Z`, fill: r.color, opacity: 0.18 }, s);
    svg("path", { d: line, fill: "none", stroke: r.color, "stroke-width": 2 }, s);
    for (const st of r.allStops) {
      const x = X(st.at * r.km);
      svg("line", { x1: x, x2: x, y1: t, y2: H - b, stroke: st.main ? "#C2410C" : r.color, "stroke-width": 1, "stroke-dasharray": "3 3" }, s);
      const tx = svg("text", { x, y: t + 2, "text-anchor": "middle", "font-size": 11, "font-family": "Poppins, sans-serif", "font-weight": 600, fill: st.main ? "#C2410C" : "#615D55" }, s); tx.textContent = String(st.order);
    }
    const a0 = svg("text", { x: l, y: H - 8, "font-size": 12, "font-family": "Poppins, sans-serif", fill: "#8C877D" }, s); a0.textContent = "0 km";
    const z = svg("text", { x: W - rr, y: H - 8, "text-anchor": "end", "font-size": 12, "font-family": "Poppins, sans-serif", fill: "#8C877D" }, s); z.textContent = `${r.km.toFixed(1)} km`;
  }

  // Target picker and planner stats
  function renderObjectives(m, r) {
    const ul = $("#obj-select"); ul.innerHTML = "";
    const sel = state.selected[m.id];
    for (const o of m.objectives) {
      const li = html("li");
      const lab = html("label", { class: "obj body-6" });
      const cb = html("input", { type: "checkbox" }); cb.checked = sel.has(o.id);
      cb.addEventListener("change", () => toggleObjective(o.id, cb.checked));
      const ic = html("i", { class: `ph ${TYPE[o.type].icon}`, "aria-hidden": "true" });
      const txt = html("span", { class: "obj-name" }, o.name);
      const tag = html("span", { class: "caption-5 muted" }, `${TYPE[o.type].label} · +${o.points} pts${o.main ? " · main" : ""}${o.bonus ? " · bonus" : ""}`);
      lab.append(cb, ic, txt, tag);
      li.append(lab);
      ul.append(li);
    }
    const p = r.plan;
    $("#plan-info").textContent = `Planner checked ${p.nodes.toLocaleString("en")} search steps over ${p.orders.toLocaleString("en")} possible orders in ${Math.max(1, Math.round(p.ms))} ms. Best order: ${r.allStops.map((s) => s.order + " " + s.name.split(" ").slice(0, 2).join(" ")).join(" → ")}.${p.relaxed ? " Some targets needed steeper ground than this profile allows." : ""}`;
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
    const items = [{ badge: "A", cls: "", name: "Habitat", km: 0, pos: D.habitat.pos, sub: "Board the rover and head out" }];
    for (const s of r.allStops) {
      items.push({ badge: String(s.order), cls: s.main ? "target" : "stop", name: s.name, km: s.at * r.km, pos: s.pos, sub: `${TYPE[s.type].label} · ${s.minutes} min · +${s.points} pts. ${s.detail}`, photo: s.photo });
    }
    items.push({ badge: "A", cls: "", name: "Back at the habitat", km: r.km, pos: D.habitat.pos, sub: "Tour complete" });
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
      if (it.photo) { const f = html("figure", { class: "wp-photo" }); renderPhoto(f, it.photo, it.name); body.append(f); }
      li.append(body);
      ol.append(li);
    }
  }

  function selectMission(i) {
    state.missionIdx = i; state.routeIdx = 0;
    renderTabs(); renderPlan(); buildMarkers(); drawOverlays(); fitRoute();
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
    $("#event").hidden = s !== "event";
    $("#end").hidden = s !== "end";
  }

  // ---------- EVA ----------
  function startEva() {
    const m = mission(), r = route();
    state.run = {
      m, r, km: 0, dir: 1, maxKm: 0,
      o2: 100, suit: 100, dose: 0, minutes: 0, walked: 0,
      science: 0, stopIdx: 0, eventIdx: 0, paused: false, fast: false, kmPerSec: r.km / RULES.tourSeconds,
      atStop: null, returnedEarly: false, rescued: false, lowWarned: false,
      done: new Set(["leave"]), skipped: new Set(),
      log: [`Left the habitat in the rover on the ${r.label.toLowerCase()} route`]
    };
    $("#stop-card").hidden = true;
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
    const possible = run.r.allStops.reduce((a, s) => a + s.points, 0);
    $("#obj-points").textContent = `Science ${run.science} of ${possible} pts`;
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
    $("#stop-kicker").textContent = `${stop.main ? "Main target" : "Target " + stop.order} · ${TYPE[stop.type].label}`;
    $("#stop-name").textContent = stop.name;
    $("#stop-detail").textContent = stop.detail;
    renderPhoto($("#stop-photo"), stop.photo, stop.name);
    const b = $("#btn-sample"); b.innerHTML = "";
    const verb = { sample: "Collect sample", photo: "Take photos", measure: "Take measurement" }[stop.type] || "Collect sample";
    b.append(document.createTextNode(`${verb} · +${stop.points} pts `), html("kbd", { class: "key" }, "S"));
    $("#stop-card").hidden = false;
    $("#stop-card").scrollIntoView({ block: "nearest", behavior: "smooth" });
    b.focus({ preventScroll: true });
  }

  function collectSample() {
    const run = state.run; if (!run || !run.atStop) return;
    const { stop, key } = run.atStop;
    run.science += stop.points; run.done.add(key);
    const mins = stop.minutes || RULES.stopMinutes;
    run.minutes += mins; run.o2 -= RULES.stopO2; run.dose += mins * RULES.dosePerMinute;
    run.log.push(`Collected a sample at ${stop.name} (+${stop.points} pts)`);
    run.atStop = null;
    $("#stop-card").hidden = true;
    if (stop.main) run.log.push("Main target done");
    renderChecklist();
  }

  function renderPhoto(fig, name, alt) {
    fig.innerHTML = "";
    const img = html("img", { src: `assets/photos/${name}.jpg`, alt: `Perseverance view of ${alt}` });
    img.onerror = () => { fig.innerHTML = ""; fig.append(illustration(name, alt)); };
    fig.append(img);
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
    cap.textContent = "Illustration · Perseverance photo goes here";
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
    if (type === "dust") setTimeout(() => setCond("#cond-dust", "Low", "good"), 4000);
    if (type === "radiation") setTimeout(() => setCond("#cond-rad", "Normal", "good"), 4000);
    if (run.o2 <= 0) { run.o2 = 0; run.rescued = true; run.log.push("Life support ran out. A rescue rover came from the habitat"); return finish(); }
    setScreen("eva");
    last = performance.now();
  }

  function setCond(sel, text, cls) { const n = $(sel); n.textContent = text; n.className = cls; }

  // ---------- End ----------
  function finish() {
    const run = state.run;
    const bonus = !run.rescued && run.o2 > 30 ? 50 : 0;
    let score = run.science + bonus, title, text;
    if (run.rescued) { score = Math.max(0, run.science - 100); title = "Rescued"; text = "Life support ran out before you reached the habitat. On Mars, the way home is part of the mission."; }
    else if (run.returnedEarly) { title = "Safe call"; text = "You turned back before conditions got worse. No sample is worth a crew member."; }
    else if (run.o2 > 30) { title = "Safe explorer"; text = "Tour complete with a healthy life support reserve. That earns a +50 pts safety bonus."; }
    else { title = "Bold scientist"; text = "Tour complete, but your life support reserve was thin. Next time, pick a route with more margin."; }
    state.totalScore += score;
    $("#score-total").textContent = state.totalScore;
    $("#end-kicker").textContent = run.rescued ? "EVA ended" : "EVA complete";
    $("#end-title").textContent = title;
    $("#end-text").textContent = text;
    const stats = $("#end-stats"); stats.innerHTML = "";
    const add = (dd, dt) => { const d = html("div"); d.append(html("dd", { class: "heading-6" }, dd), html("dt", { class: "caption-5" }, dt)); stats.append(d); };
    add(`${score}`, "Science pts"); add(`${Math.max(0, run.o2).toFixed(0)} %`, "Life support left"); add(fmtClock(run.minutes), "EVA time"); add(run.dose.toFixed(2), "Dose, mSv");
    const log = $("#end-log"); log.innerHTML = "";
    for (const l of run.log) log.append(html("li", {}, l));
    setScreen("end");
    $("#btn-again").focus({ preventScroll: true });
  }

  function backToPlan() {
    state.run = null; state.playerMarker = null;
    $("#stop-card").hidden = true;
    setCond("#cond-dust", "Low", "good"); setCond("#cond-rad", "Normal", "good");
    setScreen("plan");
    buildMarkers(); drawOverlays(); fitRoute();
  }

  // ---------- Toast ----------
  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800);
  }

  // ---------- Wiring ----------
  $("#btn-intro").addEventListener("click", () => { setScreen("plan"); fitRoute(); $("#mission-tabs button").focus({ preventScroll: true }); });
  $("#btn-start").addEventListener("click", startEva);
  $("#btn-sample").addEventListener("click", collectSample);
  $("#btn-again").addEventListener("click", backToPlan);
  $("#btn-retry").addEventListener("click", () => { backToPlan(); startEva(); });
  $("#btn-sources").addEventListener("click", () => { $("#sources").hidden = false; $("#btn-sources-close").focus(); });
  $("#btn-sources-close").addEventListener("click", () => { $("#sources").hidden = true; });
  $("#sources").addEventListener("click", (e) => { if (e.target.id === "sources") $("#sources").hidden = true; });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    const k = e.key.toLowerCase();
    if (k === "escape") {
      if (!$("#sources").hidden) { $("#sources").hidden = true; return; }
      if ($("#map-card").classList.contains("full")) { $("#btn-full").click(); return; }
      if (!$("#layer-panel").hidden) { $("#btn-layers").click(); return; }
    }
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
    }
  });

  // ---------- Boot ----------
  $("#sol-label").textContent = `Sol ${D.sol}`;
  $("#sol-inline").textContent = D.sol;
  $("#cond-temp").textContent = `−${Math.abs(D.conditions.tempC)} °C`;
  renderTabs();
  renderPlan();
  buildMarkers();
  const v0 = map.fitBounds([D.habitat.pos, ...mission().routes.flatMap((r) => r.dense)], 90, 16.5);
  map.setView(v0.lat, v0.lon, v0.zoom);
  setScreen("intro");
  $("#btn-intro").focus({ preventScroll: true });
  window.momootMap = map; // handy for debugging in the console
})();
