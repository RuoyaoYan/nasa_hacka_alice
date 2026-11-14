/* Momoot · Komoot for Mars
 * Plain JavaScript, no build step. Data lives in data/missions.js.
 */
(() => {
  "use strict";

  const D = window.MOMOOT_DATA;
  const SVGNS = "http://www.w3.org/2000/svg";
  const $ = (sel) => document.querySelector(sel);

  // ---------- Game rules ----------
  const RULES = {
    speedKmh: 2,          // walking speed on firm ground
    sandSlowdown: 0.6,    // 100 % sand would be 60 % slower
    o2PerKm: 7,           // % oxygen per km walked
    o2Per10mClimb: 1,     // % oxygen per 10 m climbed (outbound)
    suitPerKm: 4,         // % suit power per km
    dosePerMinute: 0.00045, // mSv per minute, roughly the surface average Curiosity measured
    walkUnitsPerSec: 70,  // animation speed outbound
    returnBoost: 2,       // the walk home plays faster
    fastForward: 3
  };

  const state = {
    screen: "intro",
    missionIdx: 0,
    routeIdx: 0,
    totalScore: 0,
    photoMap: false,
    drawMode: false,
    drawPts: [],
    run: null
  };

  // ---------- Small helpers ----------
  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  function html(tag, attrs = {}, text) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else n.setAttribute(k, v);
    }
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtMin = (m) => { const h = Math.floor(m / 60); const mm = Math.round(m % 60); return h ? `${h} h ${String(mm).padStart(2, "0")}` : `${mm} min`; };
  const fmtClock = (m) => { const h = Math.floor(m / 60); const mm = Math.floor(m % 60); return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`; };
  const mission = () => D.missions[state.missionIdx];
  const route = () => mission().routes[state.routeIdx];

  // Smooth path through points (Catmull Rom to cubic Bezier)
  function smoothPath(pts) {
    if (pts.length < 3) return `M${pts[0][0]} ${pts[0][1]} L${pts[1][0]} ${pts[1][1]}`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  // Precompute geometry and stats for every route
  const measure = el("path", { d: "M0 0" });
  el("g", { visibility: "hidden" }, $("#map")).appendChild(measure);
  for (const m of D.missions) {
    for (const r of m.routes) {
      r.d = smoothPath(r.points);
      measure.setAttribute("d", r.d);
      r.length = measure.getTotalLength();
      r.km = r.length * D.kmPerUnit;
      const sandF = 1 + (r.terrain.sand / 100) * RULES.sandSlowdown;
      r.minutesPerUnit = (D.kmPerUnit / RULES.speedKmh) * 60 * sandF;
      r.roundKm = r.km * 2;
      r.roundMinutes = r.length * 2 * r.minutesPerUnit;
      r.o2Round = Math.round(r.roundKm * RULES.o2PerKm + (r.climb / 10) * RULES.o2Per10mClimb);
    }
  }

  // ---------- Map drawing ----------
  function drawBase() {
    const g = $("#layer-base");
    g.innerHTML = "";
    const T = D.terrain;
    el("rect", { x: -200, y: -100, width: 2000, height: 1100, fill: "#B5724A" }, g);
    // broad lighter plain
    el("ellipse", { cx: 760, cy: 520, rx: 720, ry: 380, fill: "#C2825A" }, g);
    el("ellipse", { cx: 720, cy: 500, rx: 460, ry: 250, fill: "#CB8E65" }, g);
    // contours
    const cg = el("g", { stroke: "#F7D6B6", "stroke-width": 1.2, fill: "none", opacity: 0.28 }, g);
    for (let i = 0; i < 7; i++) {
      const y = 380 + i * 80;
      el("path", { d: `M-50 ${y} Q300 ${y - 50} 560 ${y + 20} T1100 ${y - 10} T1650 ${y + 10}` }, cg);
    }
    // crater rim
    el("path", { d: T.craterRim, stroke: "#5C2E1B", "stroke-width": 70, fill: "none", opacity: 0.32 }, g);
    el("path", { d: T.craterRim, stroke: "#F3C9A1", "stroke-width": 2.5, fill: "none", opacity: 0.55 }, g);
    // delta
    el("path", { d: T.delta, fill: "#C98F63", stroke: "#F6D3AD", "stroke-width": 2, opacity: 0.95 }, g);
    for (const c of T.deltaChannels) el("path", { d: c, stroke: "#A5653F", "stroke-width": 1.5, fill: "none" }, g);
    // dunes
    const du = T.duneField;
    el("ellipse", { cx: du.x, cy: du.y, rx: du.rx, ry: du.ry, fill: "url(#pat-sand)", stroke: "#F0C69C", "stroke-width": 1.5, "stroke-dasharray": "5 5" }, g);

    // minerals layer
    const mg = $("#layer-minerals"); mg.innerHTML = "";
    for (const z of T.clayZones) {
      el("ellipse", { cx: z.x, cy: z.y, rx: z.rx, ry: z.ry, fill: "#B07CFF", "fill-opacity": 0.35, stroke: "#D9BFFF", "stroke-width": 1.5, "stroke-dasharray": "4 4" }, mg);
    }
    tag(mg, T.clayZones[0].x - 70, T.clayZones[0].y + 44, "Clay minerals", "CRISM", 140);

    // slope layer
    const sg = $("#layer-slope"); sg.innerHTML = "";
    for (const s of T.steepZones) el("path", { d: s, fill: "url(#pat-steep)" }, sg);
    tag(sg, 1000, 735, "Steep slope", "over 15 degrees", 150);

    // hazards
    const hg = $("#layer-hazards"); hg.innerHTML = "";
    for (const r of T.rockFields) {
      const rocks = el("g", { fill: "#4E2717", opacity: 0.85 }, hg);
      const offs = [[-0.6, -0.2, 0.2], [-0.2, -0.6, 0.13], [0.2, 0.1, 0.24], [-0.45, 0.45, 0.13], [0.6, -0.35, 0.13], [0.15, 0.6, 0.17], [0.7, 0.3, 0.12]];
      for (const [dx, dy, s] of offs) el("circle", { cx: r.x + dx * r.r, cy: r.y + dy * r.r, r: Math.max(3, s * r.r * 0.6) }, rocks);
      el("circle", { cx: r.x, cy: r.y, r: r.r, fill: "none", stroke: "#F5B400", "stroke-width": 2.5, "stroke-dasharray": "5 5" }, hg);
    }
    tag(hg, T.rockFields[0].x + 52, T.rockFields[0].y + 6, "Rock field", "HiRISE", 120);

    // labels
    const lg = $("#layer-labels"); lg.innerHTML = "";
    for (const l of T.labels) { const t = el("text", { x: l.x, y: l.y, class: "map-label" }, lg); t.textContent = l.text.toUpperCase(); }

    // scale bar (500 m)
    const unitsPer500 = 0.5 / D.kmPerUnit;
    const sb = el("g", { transform: "translate(360 830)" }, lg);
    el("rect", { width: unitsPer500 + 90, height: 34, rx: 8, class: "tag-bg" }, sb);
    el("path", { d: `M14 17 H${14 + unitsPer500} M14 11 V23 M${14 + unitsPer500} 11 V23`, stroke: "#fff", "stroke-width": 2.5 }, sb);
    const st = el("text", { x: 26 + unitsPer500, y: 22, class: "tag-t" }, sb); st.textContent = "500 m";
  }

  function tag(parent, x, y, title, sub, w) {
    const g = el("g", { transform: `translate(${x} ${y})` }, parent);
    el("rect", { width: w, height: sub ? 44 : 28, rx: 8, class: "tag-bg" }, g);
    const t = el("text", { x: 12, y: 19, class: "tag-t" }, g); t.textContent = title;
    if (sub) { const s = el("text", { x: 12, y: 36, class: "tag-s" }, g); s.textContent = sub; }
    return g;
  }

  function drawHabitat(parent) {
    const h = D.habitat;
    const g = el("g", { transform: `translate(${h.x} ${h.y})` }, parent);
    el("circle", { r: 20, fill: "#181818", stroke: "#fff", "stroke-width": 4 }, g);
    const t = el("text", { y: 6, "text-anchor": "middle", class: "tag-t", "font-size": 16 }, g); t.textContent = "H";
    tag(g, 28, -14, "Habitat", null, 84);
  }

  function drawPin(parent, x, y, title, sub, color = "#FF6B2C") {
    const g = el("g", { transform: `translate(${x} ${y})` }, parent);
    el("path", { d: "M0 -46 c-16 0 -25 12 -25 23 c0 18 25 41 25 41 s25 -23 25 -41 c0 -11 -9 -23 -25 -23z", fill: color, stroke: "#fff", "stroke-width": 4, transform: "translate(0 5)" }, g);
    el("circle", { cx: 0, cy: -18, r: 8, fill: "#fff" }, g);
    const w = Math.max(title.length, sub ? sub.length * 0.86 : 0) * 8.4 + 28;
    tag(g, x > 950 ? -w - 34 : 34, -40, title, sub, w);
  }

  // Routes for the selected mission
  function drawRoutes() {
    const g = $("#layer-routes"); g.innerHTML = "";
    const mk = $("#layer-markers"); mk.innerHTML = "";
    const m = mission();
    m.routes.forEach((r, i) => {
      const sel = i === state.routeIdx;
      const grp = el("g", { "data-route": i }, g);
      if (sel) el("path", { d: r.d, class: "route", stroke: "#fff", "stroke-width": 13, opacity: 0.9 }, grp);
      el("path", {
        d: r.d, class: "route", stroke: r.color, "stroke-width": sel ? 7 : 5,
        "stroke-dasharray": sel ? "none" : "12 8", opacity: sel ? 1 : 0.85
      }, grp);
      const hit = el("path", { d: r.d, class: "route-hit" }, grp);
      hit.addEventListener("click", () => { if (state.screen === "plan") selectRoute(i); });
    });
    // put selected on top
    const selG = g.querySelector(`[data-route="${state.routeIdx}"]`);
    if (selG) g.appendChild(selG);

    // stops of selected route
    for (const s of route().stops) {
      const p = pointAt(route(), s.at);
      el("circle", { cx: p.x, cy: p.y, r: 12, fill: route().color, stroke: "#fff", "stroke-width": 3 }, mk);
    }
    drawHabitat(mk);
    drawPin(mk, m.target.x, m.target.y, m.target.name, m.target.dataNote);
  }

  function pointAt(r, frac) {
    measure.setAttribute("d", r.d);
    return measure.getPointAtLength(clamp(frac, 0, 1) * r.length);
  }

  // ---------- Plan panels ----------
  function renderMissions() {
    const list = $("#mission-list"); list.innerHTML = "";
    D.missions.forEach((m, i) => {
      const b = html("button", { class: "card", type: "button", role: "radio", "aria-checked": String(i === state.missionIdx) });
      b.append(html("span", { class: "title-3" }, m.name));
      const p = html("span", { class: "body-6 muted", style: "display:block;margin-top:4px" }, m.goal);
      b.append(p);
      const row = html("span", { class: "row" });
      row.append(html("span", { class: "stars", "aria-label": `Difficulty ${m.difficulty} of 3` }, "★".repeat(m.difficulty) + "☆".repeat(3 - m.difficulty)));
      row.append(html("span", { class: "caption-3 reward" }, `+${m.finalStop.points} pts`));
      b.append(row);
      b.addEventListener("click", () => selectMission(i));
      list.append(b);
    });
  }

  function renderRoutes() {
    const m = mission();
    const list = $("#route-list"); list.innerHTML = "";
    m.routes.forEach((r, i) => {
      const b = html("button", { class: "card route-card", type: "button", role: "radio", "aria-checked": String(i === state.routeIdx) });
      b.style.setProperty("--route-color", r.color);
      const dot = html("span", { class: "dot" }); dot.style.background = r.color;
      const t = html("span", { class: "t" });
      t.append(html("span", { class: "title-3" }, r.label));
      t.append(html("span", { class: "caption-5 muted" }, r.note));
      b.append(dot, t);
      b.addEventListener("click", () => selectRoute(i));
      list.append(b);
    });
    const r = route();
    const stats = $("#route-stats"); stats.innerHTML = "";
    const add = (dd, dt) => { const d = html("div"); d.append(html("dd", { class: "heading-6" }, dd), html("dt", { class: "caption-5" }, dt)); stats.append(d); };
    add(`${r.roundKm.toFixed(1)} km`, "round trip");
    add(fmtMin(r.roundMinutes), "walking time");
    add(`↑ ${r.climb} m`, "climb");
    add(`${r.o2Round} %`, "oxygen used");

    // profile
    const svg = $("#route-profile"); svg.innerHTML = "";
    const maxC = Math.max(...m.routes.map((x) => x.climb)) || 1;
    const n = r.profile.length;
    const pts = r.profile.map((v, i) => [(i / (n - 1)) * 300, 52 - (v / maxC) * 46]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    el("path", { d: `${line} L300 56 L0 56Z`, fill: r.color, opacity: 0.2 }, svg);
    el("path", { d: line, stroke: r.color, "stroke-width": 2.5, fill: "none", "vector-effect": "non-scaling-stroke" }, svg);

    // terrain mix
    const mix = $("#route-mix"); mix.innerHTML = "";
    const cols = { bedrock: "#A35A35", gravel: "#D49A6A", sand: "#F1D2AE" };
    for (const k of ["bedrock", "gravel", "sand"]) { const s = html("span"); s.style.width = `${r.terrain[k]}%`; s.style.background = cols[k]; mix.append(s); }
    $("#route-mix-legend").textContent = `Bedrock ${r.terrain.bedrock} %  ·  Gravel ${r.terrain.gravel} %  ·  Sand ${r.terrain.sand} %`;

    // risk
    const riskCols = ["#3ECF6A", "#F5A000", "#F05252"];
    [...$("#route-risk").children].forEach((s, i) => { s.style.background = i < r.risk ? riskCols[r.risk - 1] : ""; });
    $("#route-risk").setAttribute("aria-label", `Risk ${r.risk} of 3`);
  }

  function selectMission(i) {
    state.missionIdx = i; state.routeIdx = 0;
    renderMissions(); renderRoutes(); drawRoutes();
  }
  function selectRoute(i) {
    state.routeIdx = i;
    renderRoutes(); drawRoutes();
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
      m, r, pos: 0, dir: 1, phase: "out",
      o2: 100, suit: 100, dose: 0, minutes: 0, units: 0,
      science: 0, stopIdx: 0, eventIdx: 0, paused: false, fast: false,
      atStop: null, returnedEarly: false, reachedTarget: false, rescued: false,
      lowWarned: false, log: [`Left the habitat on the ${r.label.toLowerCase()} route`]
    };
    // draw EVA layer: walked track + player
    const mk = $("#layer-markers");
    const trail = el("path", { d: r.d, class: "route", stroke: r.color, "stroke-width": 8, "stroke-dasharray": `0 ${r.length + 10}`, id: "trail" });
    $("#layer-routes").appendChild(trail);
    const player = el("g", { id: "player" }, mk);
    el("circle", { r: 26, fill: "#4F8FF7", opacity: 0.28 }, player);
    el("circle", { r: 12, fill: "#4F8FF7", stroke: "#fff", "stroke-width": 4 }, player);
    const you = tag(player, -82, -14, "You", null, 52);
    you.setAttribute("id", "you-tag");
    // fade other routes
    $("#layer-routes").querySelectorAll("g[data-route]").forEach((g) => { if (g.dataset.route != state.routeIdx) g.style.opacity = 0.15; });

    renderChecklist();
    $("#stop-card").hidden = true;
    setScreen("eva");
    last = performance.now();
    requestAnimationFrame(tick);
  }

  function checklistItems(run) {
    const items = [{ key: "leave", label: "Leave the habitat" }];
    run.r.stops.forEach((s, i) => items.push({ key: `stop${i}`, label: s.name }));
    items.push({ key: "target", label: run.m.finalStop.name });
    items.push({ key: "home", label: "Return to the habitat" });
    return items;
  }

  function renderChecklist() {
    const run = state.run;
    $("#obj-mission").textContent = run.m.name;
    const ol = $("#obj-list"); ol.innerHTML = "";
    const done = run.done || (run.done = new Set(["leave"]));
    const skipped = run.skipped || (run.skipped = new Set());
    let nowSet = false;
    for (const it of checklistItems(run)) {
      const li = html("li");
      const box = html("span", { class: "box", "aria-hidden": "true" });
      if (done.has(it.key)) { li.className = "done"; box.textContent = "✓"; }
      else if (skipped.has(it.key)) { li.className = "skipped"; box.textContent = "–"; }
      else if (!nowSet) { li.className = "now"; nowSet = true; }
      li.append(box, html("span", {}, it.label));
      ol.append(li);
    }
    const possible = run.r.stops.reduce((a, s) => a + s.points, 0) + run.m.finalStop.points;
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
    let speed = RULES.walkUnitsPerSec * (run.dir < 0 ? RULES.returnBoost : 1) * (run.fast ? RULES.fastForward : 1);
    const prev = run.pos;
    run.pos = clamp(run.pos + run.dir * speed * dt, 0, r.length);
    const du = Math.abs(run.pos - prev);
    // costs
    const km = du * D.kmPerUnit;
    const mins = du * r.minutesPerUnit;
    run.units += du;
    run.minutes += mins;
    run.o2 -= km * RULES.o2PerKm;
    if (run.dir > 0) run.o2 -= (du / r.length) * (r.climb / 10) * RULES.o2Per10mClimb;
    run.suit -= km * RULES.suitPerKm;
    run.dose += mins * RULES.dosePerMinute;

    if (run.o2 <= 0) { run.o2 = 0; run.rescued = true; run.log.push("Oxygen ran out. The crew rover came to pick you up"); return finish(); }

    // oxygen reserve warning: need enough to walk home
    const needHome = run.pos * D.kmPerUnit * RULES.o2PerKm;
    if (!run.lowWarned && run.dir > 0 && run.o2 - needHome < 12) {
      run.lowWarned = true;
      toast("Oxygen reserve is getting low. Make sure you can still get home.");
    }

    if (run.dir > 0) {
      const frac = run.pos / r.length;
      // events
      const ev = r.events[run.eventIdx];
      if (ev && frac >= ev.at) { run.eventIdx++; return openEvent(ev.type); }
      // stops
      const st = r.stops[run.stopIdx];
      if (st && frac >= st.at) { run.stopIdx++; return arriveStop(st, `stop${run.stopIdx - 1}`); }
      if (frac >= 1) { run.reachedTarget = true; return arriveStop(run.m.finalStop, "target"); }
    } else if (run.pos <= 0) {
      run.done.add("home");
      run.log.push("Back inside the habitat");
      return finish();
    }
  }

  function updateHud() {
    const run = state.run; if (!run) return;
    const p = pointAt(run.r, run.pos / run.r.length);
    $("#player").setAttribute("transform", `translate(${p.x} ${p.y})`);
    $("#trail").setAttribute("stroke-dasharray", run.dir > 0 ? `${run.pos} ${run.r.length + 10}` : `${run.maxPos || run.pos} ${run.r.length + 10}`);
    $("#eva-clock").textContent = fmtClock(run.minutes);
    $("#eva-phase").textContent = run.paused ? "Paused" : run.dir > 0 ? (run.fast ? "Outbound · fast forward" : "Outbound") : (run.fast ? "Heading home · fast forward" : "Heading home");
    setBar("o2", run.o2, `${Math.max(0, run.o2).toFixed(0)} %`, true);
    setBar("suit", run.suit, `${Math.max(0, run.suit).toFixed(0)} %`, true);
    const dosePct = clamp(run.dose / 1, 0, 1) * 100;
    $("#v-dose").textContent = `${run.dose.toFixed(2)} mSv`;
    const bd = $("#b-dose"); bd.style.transform = `scaleX(${Math.max(0.02, dosePct / 100)})`;
    bd.classList.toggle("low", run.dose > 0.15 && run.dose <= 0.3); bd.classList.toggle("critical", run.dose > 0.3);
    $("#v-dist").textContent = `${(run.units * D.kmPerUnit).toFixed(1)} km`;
  }
  function setBar(id, val, label, lowIsBad) {
    $(`#v-${id}`).textContent = label;
    const b = $(`#b-${id}`);
    b.style.transform = `scaleX(${clamp(val, 0, 100) / 100})`;
    b.classList.toggle("low", lowIsBad && val <= 40 && val > 20);
    b.classList.toggle("critical", lowIsBad && val <= 20);
  }

  // ---------- Stops ----------
  function arriveStop(stop, key) {
    const run = state.run;
    run.atStop = { stop, key };
    $("#stop-kicker").textContent = key === "target" ? "Mission target reached" : "Science stop";
    $("#stop-name").textContent = stop.name;
    $("#stop-detail").textContent = stop.detail;
    renderPhoto($("#stop-photo"), stop.photo, stop.name);
    $("#btn-sample").innerHTML = "";
    $("#btn-sample").append(document.createTextNode(`Collect sample · +${stop.points} pts `), Object.assign(html("kbd", { class: "key" }, "S")));
    $("#stop-card").hidden = false;
    $("#btn-sample").focus({ preventScroll: true });
  }

  function collectSample() {
    const run = state.run; if (!run || !run.atStop) return;
    const { stop, key } = run.atStop;
    run.science += stop.points;
    run.done.add(key);
    run.minutes += 20; run.o2 -= 2; run.dose += 20 * RULES.dosePerMinute;
    run.log.push(`Collected a sample at ${stop.name} (+${stop.points} pts)`);
    run.atStop = null;
    $("#stop-card").hidden = true;
    if (key === "target") { run.dir = -1; run.maxPos = run.pos; run.log.push("Turned back toward the habitat"); }
    renderChecklist();
    $("#map").focus?.({ preventScroll: true });
  }

  function renderPhoto(fig, name, alt) {
    fig.innerHTML = "";
    const img = html("img", { src: `assets/photos/${name}.jpg`, alt: `Perseverance view near ${alt}` });
    img.onerror = () => { fig.innerHTML = ""; fig.append(illustration(name, alt)); };
    fig.append(img);
  }

  // Drawn stand in when no real rover photo has been added yet
  function illustration(kind, alt) {
    const s = el("svg", { viewBox: "0 0 336 152", role: "img", "aria-label": `Illustration of ${alt}. Add a Perseverance photo as assets/photos/${kind}.jpg` });
    el("rect", { width: 336, height: 152, fill: "#E2BB93" }, s);
    el("rect", { y: 0, width: 336, height: 60, fill: "#D9B08A" }, s);
    if (kind === "delta") {
      el("path", { d: "M0 78 Q70 66 120 74 T240 68 T336 76 V152 H0Z", fill: "#B97A50" }, s);
      el("path", { d: "M150 72 L186 40 L262 46 L304 70Z", fill: "#9C5E3B" }, s);
      for (let i = 0; i < 4; i++) el("path", { d: `M${166 + i * 6} ${64 - i * 6} H${292 - i * 10}`, stroke: "#7D4429", "stroke-width": 1.6 }, s);
      el("path", { d: "M0 112 Q90 98 170 108 T336 102 V152 H0Z", fill: "#A4643F" }, s);
    } else if (kind === "rim") {
      el("path", { d: "M0 92 L60 50 L120 66 L190 26 L260 54 L336 36 V152 H0Z", fill: "#8E4F33" }, s);
      for (let i = 0; i < 5; i++) el("path", { d: `M${40 + i * 4} ${84 - i * 9} L${320 - i * 6} ${70 - i * 8}`, stroke: "#6E3A24", "stroke-width": 1.4, opacity: 0.8 }, s);
      el("path", { d: "M0 118 Q110 104 200 114 T336 108 V152 H0Z", fill: "#A4643F" }, s);
    } else {
      el("path", { d: "M0 84 Q80 64 160 82 T336 74 V152 H0Z", fill: "#D7A57A" }, s);
      for (let i = 0; i < 7; i++) el("path", { d: `M0 ${96 + i * 8} Q84 ${88 + i * 8} 168 ${96 + i * 8} T336 ${94 + i * 8}`, stroke: "#B9845B", "stroke-width": 1.4, fill: "none" }, s);
    }
    el("ellipse", { cx: 60, cy: 132, rx: 22, ry: 7, fill: "#6E3A24" }, s);
    el("ellipse", { cx: 250, cy: 138, rx: 13, ry: 4, fill: "#6E3A24" }, s);
    const cap = el("text", { x: 12, y: 20, "font-family": "Poppins, sans-serif", "font-size": 12, "font-weight": 500, fill: "#5C2E1B" }, s);
    cap.textContent = "Illustration · real rover photo goes here";
    return s;
  }

  // ---------- Events ----------
  function openEvent(type) {
    const ev = D.events[type];
    const run = state.run;
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
      t.append(html("span", { class: "title-3" }, c.recommended ? `${c.label} · recommended` : c.label));
      t.append(html("span", { class: "caption-5 hint" }, c.hint));
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
    const type = run.currentEvent;
    const ev = D.events[type];
    const c = ev.choices[i]; if (!c) return;
    const e = c.effect;
    if (e.o2) run.o2 += e.o2;
    if (e.minutes) { run.minutes += e.minutes; run.dose += e.minutes * RULES.dosePerMinute; }
    if (e.dose) run.dose += e.dose;
    if (e.suit) run.suit += e.suit;
    run.log.push(`${ev.title}: ${c.label.toLowerCase()}`);
    if (e.returnNow) {
      run.dir = -1; run.maxPos = run.pos; run.returnedEarly = true;
      // mark remaining items skipped
      run.r.stops.forEach((s, k) => { if (!run.done.has(`stop${k}`)) run.skipped.add(`stop${k}`); });
      run.skipped.add("target");
      drawReturnPath(run);
      renderChecklist();
    }
    if (type === "dust") setTimeout(() => setCond("#cond-dust", "Low", "good"), 4000);
    if (type === "radiation") setTimeout(() => setCond("#cond-rad", "Normal", "good"), 4000);
    if (run.o2 <= 0) { run.o2 = 0; run.rescued = true; run.log.push("Oxygen ran out. The crew rover came to pick you up"); return finish(); }
    setScreen("eva");
    last = performance.now();
  }

  function drawReturnPath(run) {
    measure.setAttribute("d", run.r.d);
    const pts = [];
    for (let l = run.pos; l >= 0; l -= 8) { const p = measure.getPointAtLength(l); pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`); }
    pts.push(`${run.r.points[0][0]},${run.r.points[0][1]}`);
    const g = $("#layer-routes");
    el("polyline", { points: pts.join(" "), fill: "none", stroke: "#181818", "stroke-width": 11, "stroke-linecap": "round", opacity: 0.4 }, g);
    el("polyline", { points: pts.join(" "), fill: "none", stroke: "#FFB020", "stroke-width": 7, "stroke-dasharray": "14 8", "stroke-linecap": "round" }, g);
    const mid = measure.getPointAtLength(run.pos * 0.45);
    tag(g, mid.x - 132, mid.y - 14, "Safe way home", null, 124);
  }

  function setCond(sel, text, cls) { const n = $(sel); n.textContent = text; n.className = cls; }

  // ---------- End ----------
  function finish() {
    const run = state.run;
    let title, text;
    const bonus = !run.rescued && run.o2 > 30 ? 50 : 0;
    let score = run.science + bonus;
    if (run.rescued) {
      score = Math.max(0, run.science - 100);
      title = "Rescued by the crew rover";
      text = "You ran out of oxygen before reaching the habitat. On Mars, the walk home is part of the mission.";
    } else if (run.returnedEarly) {
      title = "Safe call";
      text = "You turned back before conditions got worse. No samples are worth a crew member.";
    } else if (run.o2 > 30) {
      title = "Safe explorer";
      text = "Mission complete with a healthy oxygen reserve. That earns a +50 pts safety bonus.";
    } else {
      title = "Bold scientist";
      text = "Mission complete, but your oxygen reserve was thin. Next time, pick a route with more margin.";
    }
    run.final = score;
    state.totalScore += score;
    $("#score-total").textContent = state.totalScore;
    $("#end-kicker").textContent = run.rescued ? "EVA ended" : "EVA complete";
    $("#end-title").textContent = title;
    $("#end-text").textContent = text;
    const stats = $("#end-stats"); stats.innerHTML = "";
    const add = (dd, dt) => { const d = html("div"); d.append(html("dd", { class: "heading-6" }, dd), html("dt", { class: "caption-5" }, dt)); stats.append(d); };
    add(`${score}`, "science pts");
    add(`${Math.max(0, run.o2).toFixed(0)} %`, "oxygen left");
    add(fmtClock(run.minutes), "EVA time");
    add(`${run.dose.toFixed(2)}`, "dose, mSv");
    const log = $("#end-log"); log.innerHTML = "";
    for (const l of run.log) log.append(html("li", {}, l));
    setScreen("end");
    $("#btn-again").focus({ preventScroll: true });
  }

  function backToPlan() {
    state.run = null;
    $("#stop-card").hidden = true;
    setCond("#cond-dust", "Low", "good"); setCond("#cond-rad", "Normal", "good");
    drawRoutes();
    setScreen("plan");
  }

  // ---------- Toast ----------
  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800);
  }

  // ---------- Layers ----------
  function applyLayers() {
    document.querySelectorAll("[data-layer]").forEach((cb) => {
      const name = cb.dataset.layer;
      if (name === "photo") {
        const on = cb.checked;
        $("#layer-photo").setAttribute("visibility", state.photoMap && on ? "visible" : "hidden");
        $("#layer-base").classList.toggle("layer-off", state.photoMap && on);
      } else {
        $(`#layer-${name}`).classList.toggle("layer-off", !cb.checked);
      }
    });
  }

  // Detect a real Mars Trek export at assets/map.jpg
  function detectPhotoMap() {
    const img = new Image();
    img.onload = () => {
      state.photoMap = true;
      $("#map-note").textContent = "Imagery: Mars Trek export (HiRISE / CTX). Press D to redraw routes on it.";
      $("#imagery-src").textContent = "HiRISE and CTX via Mars Trek";
      applyLayers();
    };
    img.src = "assets/map.jpg";
  }

  // ---------- Draw mode (for re-tracing routes on a real map) ----------
  function svgPoint(evt) {
    const svg = $("#map");
    const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [Math.round(p.x), Math.round(p.y)];
  }
  $("#map").addEventListener("click", (e) => {
    if (!state.drawMode) return;
    const p = svgPoint(e);
    state.drawPts.push(p);
    el("circle", { cx: p[0], cy: p[1], r: 6, class: "draw-pt" }, $("#layer-draw"));
    console.log("Momoot draw mode points:", JSON.stringify(state.drawPts));
    toast(`Point ${p[0]}, ${p[1]} added. ${state.drawPts.length} points logged to the console.`);
  });

  // ---------- Wiring ----------
  $("#btn-intro").addEventListener("click", () => { setScreen("plan"); $("#mission-list button").focus({ preventScroll: true }); });
  $("#btn-start").addEventListener("click", startEva);
  $("#btn-sample").addEventListener("click", collectSample);
  $("#btn-again").addEventListener("click", backToPlan);
  $("#btn-retry").addEventListener("click", () => { backToPlan(); startEva(); });
  $("#btn-sources").addEventListener("click", () => { $("#sources").hidden = false; $("#btn-sources-close").focus(); });
  $("#btn-sources-close").addEventListener("click", () => { $("#sources").hidden = true; });
  $("#sources").addEventListener("click", (e) => { if (e.target.id === "sources") $("#sources").hidden = true; });
  document.querySelectorAll("[data-layer]").forEach((cb) => cb.addEventListener("change", applyLayers));

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    const k = e.key.toLowerCase();
    if (k === "escape" && !$("#sources").hidden) { $("#sources").hidden = true; return; }
    if (k === "d" && !e.metaKey && !e.ctrlKey) {
      state.drawMode = !state.drawMode;
      if (!state.drawMode) $("#layer-draw").innerHTML = "", state.drawPts = [];
      toast(state.drawMode ? "Draw mode on. Click the map to log route points to the console." : "Draw mode off.");
      return;
    }
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
      if (k === "l") { const cb = document.querySelector('[data-layer="slope"]'); cb.checked = !cb.checked; applyLayers(); }
    }
  });

  // ---------- Boot ----------
  $("#sol-label").textContent = `Sol ${D.sol}`;
  $("#cond-temp").textContent = `−${Math.abs(D.conditions.tempC)} °C`;
  drawBase();
  renderMissions();
  renderRoutes();
  drawRoutes();
  applyLayers();
  detectPhotoMap();
  setScreen("intro");
  $("#btn-intro").focus({ preventScroll: true });
})();
