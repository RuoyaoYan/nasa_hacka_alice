/* MarsMap · a small slippy map for NASA Mars Trek tiles.
 *
 * Mars Trek serves Mars in an equirectangular projection (Mars 2000 sphere,
 * longitudes −180..180, east positive). Tiles are 256 px, level 0 is two
 * columns by one row, row 0 is the north edge, URL order is {z}/{y}/{x}.
 *
 * No dependencies. Exposes window.MarsMap.
 */
(() => {
  "use strict";

  const TILE = 256;
  const MARS_RADIUS_M = 3389500;
  const CIRC_M = 2 * Math.PI * MARS_RADIUS_M;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => 1 - Math.pow(1 - t, 3); // decelerates into place

  const TREK = "https://trek.nasa.gov/tiles/Mars/EQ";

  class MarsMap {
    constructor(el, opts = {}) {
      this.el = el;
      this.center = { lat: opts.lat ?? 18.44, lon: opts.lon ?? 77.43 };
      this.zoom = opts.zoom ?? 13;
      this.minZoom = opts.minZoom ?? 2;
      this.maxZoom = opts.maxZoom ?? 18;
      this.layers = [];
      this.listeners = { render: [], click: [], move: [] };
      this.anim = null;

      el.classList.add("mm");
      this.tilePane = div("mm-tiles", el);
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.setAttribute("class", "mm-svg");
      el.appendChild(this.svg);
      this.markerPane = div("mm-markers", el);

      this.bindInput();
      this.ro = new ResizeObserver(() => this.render());
      this.ro.observe(el);
    }

    // ---------- Projection ----------
    worldW(z) { return TILE * Math.pow(2, z + 1); }
    project(lat, lon, z = this.zoom) {
      const w = this.worldW(z);
      return { x: ((lon + 180) / 360) * w, y: ((90 - lat) / 180) * (w / 2) };
    }
    unproject(x, y, z = this.zoom) {
      const w = this.worldW(z);
      return { lat: 90 - (y / (w / 2)) * 180, lon: (x / w) * 360 - 180 };
    }
    size() { return { w: this.el.clientWidth, h: this.el.clientHeight }; }
    toScreen(lat, lon) {
      const p = this.project(lat, lon), c = this.project(this.center.lat, this.center.lon), s = this.size();
      return { x: p.x - c.x + s.w / 2, y: p.y - c.y + s.h / 2 };
    }
    fromScreen(x, y) {
      const c = this.project(this.center.lat, this.center.lon), s = this.size();
      return this.unproject(c.x + x - s.w / 2, c.y + y - s.h / 2);
    }
    metersPerPixel(lat = this.center.lat) { return (CIRC_M * Math.cos((lat * Math.PI) / 180)) / this.worldW(this.zoom); }

    // ---------- Layers ----------
    /** Add a Mars Trek layer. opts: id, name, ext, minZoom, maxNative, bounds [[s,w],[n,e]], opacity, attribution */
    addTrekLayer(opts) {
      const layer = Object.assign({ ext: "jpg", minZoom: 0, maxNative: 7, opacity: 1, visible: true, errors: 0, loads: 0 }, opts);
      layer.template = `${TREK}/${layer.id}/1.0.0/default/default028mm/{z}/{y}/{x}.${layer.ext}`;
      layer.pane = div("mm-layer", this.tilePane);
      layer.tiles = new Map();
      this.layers.push(layer);
      // Read the real tile template from the WMTS capabilities when reachable
      fetch(`${TREK}/${layer.id}/1.0.0/WMTSCapabilities.xml`)
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((xml) => {
          const m = xml.match(/template="([^"]+)"/);
          if (m) {
            const t = m[1].replace("{TileMatrix}", "{z}").replace("{TileRow}", "{y}").replace("{TileCol}", "{x}").replace(/\{Style\}/g, "default").replace(/\{TileMatrixSet\}/g, "default028mm");
            if (t !== layer.template) { layer.template = t; this.clearLayer(layer); this.render(); }
          }
        })
        .catch(() => {});
      this.render();
      return layer;
    }
    clearLayer(layer) { layer.tiles.forEach((t) => t.img.remove()); layer.tiles.clear(); }
    setVisible(layer, v) { layer.visible = v; layer.pane.style.opacity = v ? layer.opacity : 0; this.render(); }

    renderTiles() {
      const s = this.size();
      for (const L of this.layers) {
        L.pane.style.opacity = L.visible ? (this.zoom < L.minZoom - 0.6 ? 0 : L.opacity) : 0;
        if (!L.visible || this.zoom < L.minZoom - 0.6) continue;
        const tz = clamp(Math.round(this.zoom), 0, L.maxNative);
        const scale = Math.pow(2, this.zoom - tz);
        const ts = TILE * scale;
        const c = this.project(this.center.lat, this.center.lon, tz);
        const cx = c.x * scale, cy = c.y * scale;
        const cols = Math.pow(2, tz + 1), rows = Math.pow(2, tz);
        let x0 = Math.floor((cx - s.w / 2) / ts), x1 = Math.floor((cx + s.w / 2) / ts);
        let y0 = Math.floor((cy - s.h / 2) / ts), y1 = Math.floor((cy + s.h / 2) / ts);
        y0 = clamp(y0, 0, rows - 1); y1 = clamp(y1, 0, rows - 1);
        x0 = clamp(x0, 0, cols - 1); x1 = clamp(x1, 0, cols - 1);
        if (L.bounds) {
          const [[sLat, wLon], [nLat, eLon]] = L.bounds;
          x0 = Math.max(x0, Math.floor(((wLon + 180) / 360) * cols));
          x1 = Math.min(x1, Math.floor(((eLon + 180) / 360) * cols));
          y0 = Math.max(y0, Math.floor(((90 - nLat) / 180) * rows));
          y1 = Math.min(y1, Math.floor(((90 - sLat) / 180) * rows));
        }
        const needed = new Set();
        let allLoaded = true;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const key = `${tz}/${y}/${x}`;
            needed.add(key);
            let t = L.tiles.get(key);
            if (!t) {
              const img = new Image();
              img.className = "mm-tile";
              img.alt = "";
              img.decoding = "async";
              img.draggable = false;
              t = { img, z: tz, x, y, loaded: false };
              img.onload = () => { t.loaded = true; L.loads++; img.classList.add("in"); this.renderSoon(); };
              img.onerror = () => {
                t.loaded = true; t.failed = true; L.errors++; img.style.display = "none";
                // Some Trek layers are png, others jpg: if nothing loads, try the other format once
                if (!L.swapped && L.loads === 0 && L.errors >= 4) {
                  L.swapped = true;
                  L.template = L.template.replace(/\.(png|jpg)$/, (m) => (m === ".png" ? ".jpg" : ".png"));
                  this.clearLayer(L);
                }
                this.renderSoon(); this.emit("tileerror", L);
              };
              img.src = L.template.replace("{z}", tz).replace("{y}", y).replace("{x}", x);
              L.pane.appendChild(img);
              L.tiles.set(key, t);
            }
            if (!t.loaded) allLoaded = false;
          }
        }
        // position every tile by its own zoom level (keeps old tiles in place while new ones load)
        for (const [key, t] of L.tiles) {
          if (!needed.has(key) && (allLoaded || t.z === tz || L.tiles.size > 400)) { t.img.remove(); L.tiles.delete(key); continue; }
          const sc = Math.pow(2, this.zoom - t.z);
          const cc = this.project(this.center.lat, this.center.lon, t.z);
          const px = t.x * TILE * sc - cc.x * sc + s.w / 2;
          const py = t.y * TILE * sc - cc.y * sc + s.h / 2;
          t.img.style.transform = `translate(${px}px, ${py}px) scale(${sc * 1.002})`;
          t.img.style.zIndex = t.z === tz ? 2 : 1;
        }
      }
    }

    // ---------- Rendering ----------
    render() {
      this.renderTiles();
      const s = this.size();
      this.svg.setAttribute("width", s.w);
      this.svg.setAttribute("height", s.h);
      this.svg.setAttribute("viewBox", `0 0 ${s.w} ${s.h}`);
      this.emit("render");
    }
    renderSoon() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderTiles(); });
    }

    setView(lat, lon, zoom) {
      this.center = { lat: clamp(lat, -85, 85), lon: clamp(lon, -180, 180) };
      this.zoom = clamp(zoom ?? this.zoom, this.minZoom, this.maxZoom);
      this.render();
      this.emit("move");
    }

    // opts.arc: for a long pan, zoom out on the way and back in at the end (a fly over)
    // opts.done: called when the flight ends
    flyTo(lat, lon, zoom, ms = 600, opts = {}) {
      cancelAnimationFrame(this.anim);
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) { this.setView(lat, lon, zoom); if (opts.done) opts.done(); return; }
      const a = { lat: this.center.lat, lon: this.center.lon, z: this.zoom };
      const b = { lat, lon, z: clamp(zoom ?? this.zoom, this.minZoom, this.maxZoom) };
      let dip = 0;
      if (opts.arc) {
        // how many screens apart the two views are, at the lower of the two zooms
        const zl = Math.min(a.z, b.z), W = this.worldW(zl), size = this.size();
        const dx = ((b.lon - a.lon) / 360) * W, dy = ((b.lat - a.lat) / 180) * (W / 2);
        const screens = Math.hypot(dx, dy) / Math.max(1, Math.min(size.w, size.h));
        dip = screens > 0.6 ? clamp(Math.log2(screens / 0.6) + 0.6, 0, 4) : 0;
      }
      const t0 = performance.now();
      const step = (now) => {
        const raw = Math.min(1, (now - t0) / ms), t = ease(raw);
        this.setView(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t, a.z + (b.z - a.z) * t - dip * Math.sin(Math.PI * raw));
        if (raw < 1) this.anim = requestAnimationFrame(step);
        else { this.anim = null; if (opts.done) opts.done(); }
      };
      this.anim = requestAnimationFrame(step);
    }

    fitBounds(pts, pad = 60, maxZoom = 16) {
      let n = -90, sLat = 90, e = -180, w = 180;
      for (const [la, lo] of pts) { n = Math.max(n, la); sLat = Math.min(sLat, la); e = Math.max(e, lo); w = Math.min(w, lo); }
      const size = this.size();
      const spanX = ((e - w) / 360) * this.worldW(0);
      const spanY = ((n - sLat) / 180) * (this.worldW(0) / 2);
      const zx = Math.log2((size.w - pad * 2) / Math.max(spanX, 1e-9));
      const zy = Math.log2((size.h - pad * 2) / Math.max(spanY, 1e-9));
      const z = clamp(Math.min(zx, zy, maxZoom), this.minZoom, this.maxZoom);
      return { lat: (n + sLat) / 2, lon: (e + w) / 2, zoom: z };
    }

    zoomBy(d, anchor) {
      const target = clamp(Math.round((this.zoom + d) * 2) / 2, this.minZoom, this.maxZoom);
      if (anchor) {
        const before = this.fromScreen(anchor.x, anchor.y);
        const z0 = this.zoom;
        this.zoom = target;
        const after = this.fromScreen(anchor.x, anchor.y);
        const lat = this.center.lat + (before.lat - after.lat), lon = this.center.lon + (before.lon - after.lon);
        this.zoom = z0;
        return this.flyTo(lat, lon, target, 300);
      }
      this.flyTo(this.center.lat, this.center.lon, target, 300);
    }

    // ---------- Input ----------
    bindInput() {
      const el = this.el;
      let drag = null;
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest(".mm-ctl, .mm-marker.clickable")) return;
        cancelAnimationFrame(this.anim);
        drag = { x: e.clientX, y: e.clientY, c: this.project(this.center.lat, this.center.lon), moved: false, id: e.pointerId };
        el.setPointerCapture(e.pointerId);
        el.classList.add("dragging");
      });
      el.addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        const p = this.unproject(drag.c.x - dx, drag.c.y - dy);
        this.setView(p.lat, p.lon);
      });
      const end = (e) => {
        if (!drag) return;
        el.classList.remove("dragging");
        if (!drag.moved) {
          const r = el.getBoundingClientRect();
          const ll = this.fromScreen(e.clientX - r.left, e.clientY - r.top);
          this.emit("click", { ...ll, target: e.target });
        }
        drag = null;
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", () => { drag = null; el.classList.remove("dragging"); });
      el.addEventListener("wheel", (e) => {
        e.preventDefault();
        cancelAnimationFrame(this.anim);
        const r = el.getBoundingClientRect();
        const ax = e.clientX - r.left, ay = e.clientY - r.top;
        const before = this.fromScreen(ax, ay);
        this.zoom = clamp(this.zoom - e.deltaY * 0.0025, this.minZoom, this.maxZoom);
        const after = this.fromScreen(ax, ay);
        this.setView(this.center.lat + (before.lat - after.lat), this.center.lon + (before.lon - after.lon));
      }, { passive: false });
      el.addEventListener("dblclick", (e) => {
        if (e.target.closest(".mm-ctl")) return;
        const r = el.getBoundingClientRect();
        this.zoomBy(1, { x: e.clientX - r.left, y: e.clientY - r.top });
      });
    }

    on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
    emit(ev, arg) { (this.listeners[ev] || []).forEach((f) => f(arg)); }
  }

  function div(cls, parent) { const d = document.createElement("div"); d.className = cls; parent.appendChild(d); return d; }

  // Distance on the Mars sphere, km
  MarsMap.distanceKm = (a, b) => {
    const toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
    return (2 * MARS_RADIUS_M * Math.asin(Math.sqrt(h))) / 1000;
  };

  window.MarsMap = MarsMap;
})();
