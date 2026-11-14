# Momoot – One-Night Build Plan

*Komoot for Mars · NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map*
*Solo build · web app · ~8 hours*

---

## 1. Goal for tonight

By morning you have a **playable browser demo** of one full mission:

> Pick a mission → choose 1 of 3 routes → walk it → a dust storm hits → choose to reroute → see your score.

Everything else is a bonus. If you're short on time, cut from the bottom of the list in section 3, never from the core loop.

---

## 2. Key decisions (made so you don't lose time)

| Decision | Choice | Why |
|---|---|---|
| Location | Jezero crater, around the Perseverance landing site | Matches the Perseverance photos in the challenge resources |
| Map | **One static image exported from Mars Trek**, shown with Leaflet `L.CRS.Simple` | Much faster than setting up Mars map tiles. Live tiles are a stretch goal |
| Routes | Hand-drawn in pixel coordinates, stored in JSON | No pathfinding needed tonight |
| Route stats | Pre-calculated numbers in JSON | Reading the elevation profile in Mars Trek is enough |
| Events | Scripted, triggered at a set point on the route | Easy to demo the same way every time |
| Tech | Plain HTML + CSS + JavaScript + Leaflet. No framework, no build step | Nothing to install, opens straight in a browser |
| Hosting | GitHub Pages | Free, gives you a link for the submission |

---

## 3. Scope

**Must have (core loop)**
- [ ] Map of Jezero with Habitat and a science target marked
- [ ] 1 mission: *Sample the delta clay*
- [ ] 3 routes: Safest, Fastest, Most science, each with stats
- [ ] Route panel: distance, time, climb, oxygen used, risk
- [ ] "Start EVA": a marker moves along the chosen route, oxygen goes down
- [ ] 1 event: dust storm with 2 choices
- [ ] End screen: science points, oxygen left, outcome

**Should have**
- [ ] Layer toggles (imagery + slope or minerals overlay)
- [ ] Real Perseverance photo at each science stop
- [ ] Elevation profile chart per route
- [ ] A second event: radiation spike

**Nice to have (only if time is left)**
- [ ] 2 more missions (crater rim, dune field)
- [ ] Live Mars Trek tiles instead of a static image
- [ ] Sound effects, keyboard shortcuts
- [ ] Mission select screen with the 3 missions

---

## 4. Hour-by-hour plan

Each block ends with a **checkpoint**. If you stop at any checkpoint, you still have something to show.

### Hour 0–1 · Gather data
- [ ] Open [Mars Trek](https://trek.nasa.gov/mars/) and go to Jezero crater (Perseverance landing site)
- [ ] Turn on the HiRISE or CTX imagery and frame an area of about 3–4 km that includes the delta front and flat ground near the landing site
- [ ] Export or screenshot it at high resolution, saved as `assets/map.jpg`
- [ ] Save a second version with a slope or elevation colour layer as `assets/slope.jpg` (same framing)
- [ ] Use Mars Trek's distance and elevation profile tools on 3 rough paths and write down distance and climb
- [ ] Download 2–3 photos from the Perseverance Raw Images Gallery that show delta rocks and plain ground, saved in `assets/photos/`
- [ ] Write down the source of every image (for credits)

✅ **Checkpoint:** you have a map image, an overlay, photos and numbers.

### Hour 1–2 · Project skeleton and map
- [ ] Create the folder structure (section 6)
- [ ] `index.html` with 3 areas: left panel, map, right panel
- [ ] Load Leaflet from a CDN and show `map.jpg` with `L.imageOverlay` on `L.CRS.Simple`
- [ ] Add Habitat and Target markers
- [ ] Click on the map and log the pixel coordinates in the console (you'll use these to draw routes)

✅ **Checkpoint:** the Mars map shows in the browser with markers.

### Hour 2–3 · Routes and route panel
- [ ] Click out the 3 routes and save their points in `data/missions.json`
- [ ] Draw them as polylines (green solid, blue dashed, purple dashed)
- [ ] Right panel: 3 route cards; clicking one highlights its line and shows its stats
- [ ] Add the rock-field hazard circle and tooltip

✅ **Checkpoint:** you can compare routes, which is the "Komoot" part working.

### Hour 3–4.5 · The walk (EVA)
- [ ] "Start EVA" button switches to EVA mode and hides the planning panels
- [ ] A player marker moves along the route (step through the points with `setInterval`)
- [ ] HUD: EVA timer, oxygen bar, distance walked, mission checklist
- [ ] Oxygen goes down with distance (faster on steep parts if you have time)
- [ ] Science stop: pause, show a photo card, then "Collect sample" adds points

✅ **Checkpoint:** a full walk without events works from start to end.

### Hour 4.5–5.5 · Dust storm event
- [ ] At ~50% of the route, pause and show the alert with a countdown
- [ ] Choice 1, return to habitat: draw the orange return route, walk back, mission is partial but safe
- [ ] Choice 2, shelter: wait (fast-forward), lose oxygen, continue; risky if oxygen runs low
- [ ] Add a source line: *"Replays real dust-season conditions recorded by Perseverance (MEDA)"*

✅ **Checkpoint:** the core loop is done. **This is your minimum demo.**

### Hour 5.5–6.5 · End screen and polish
- [ ] End screen: outcome, science points, oxygen left, which choice you made
- [ ] Apply the colours and fonts from the mockups
- [ ] Layer toggle: switch between `map.jpg` and `slope.jpg`
- [ ] Add a "Data sources" button listing every NASA dataset

✅ **Checkpoint:** it looks like the mockups.

### Hour 6.5–7.5 · Ship it
- [ ] Push to GitHub and turn on GitHub Pages
- [ ] Test the live link in a private window
- [ ] Record a 30–60 s screen video of the full loop (backup in case the demo breaks)
- [ ] Take 3 screenshots for the submission

✅ **Checkpoint:** it's online and recorded.

### Hour 7.5–8 · Submission text
- [ ] Use the one-page proposal as the project description
- [ ] List all NASA data used, with links
- [ ] Write a 3-sentence "how it works" and a 1-sentence "what's next"

---

## 5. Game design details

### Mission (tonight's only one)

| Field | Value |
|---|---|
| Name | Sample the delta clay |
| Science goal | Clay minerals form in water. A sample tells us how long Jezero's lake existed. |
| Start | Habitat (near the landing site) |
| Target | Delta front outcrop |
| Reward | +300 science points |

### Routes

Fill in the real numbers from Mars Trek in hour 0–1. The values below are placeholders.

| Route | Description | Distance | Time | Climb | O₂ used | Risk | Extra |
|---|---|---|---|---|---|---|---|
| Safest | Avoids rocks, gentle slope | ? km | ? | ? m | 38% | Low | – |
| Fastest | Shorter, crosses a rock field | ? km | ? | ? m | 30% | High | Rock event possible |
| Most science | Detour via the dunes | ? km | ? | ? m | 46% | Medium | +80 pts stop |

**Simple time and oxygen rule** (so the numbers are consistent):
- Walking speed: **1.5 km/h** on flat ground, slower on climbs and sand
- Oxygen: start at **100%**; flat walking uses **12% per km**, climbing adds **+2% per 10 m**
- These are game rules, not real spacesuit figures. Say so in the credits.

### Events

| Event | Trigger | Choices | Effect | Based on |
|---|---|---|---|---|
| Dust storm | 50% of route | Return now / Shelter and continue | Return: safe, half points. Shelter: −15% O₂, full points if O₂ stays above 20% | Perseverance MEDA and Curiosity REMS dust-season records |
| Radiation spike *(should have)* | Random after 30% | Go behind the ridge / Keep going | Shelter: +10 min. Continue: dose bar jumps | Curiosity RAD solar particle events |
| Rock field *(Fastest route only)* | Entering the hazard | Climb through / Go around | Climb: −8% O₂. Around: +10 min | HiRISE imagery |

### Scoring

- Science points from samples collected
- Bonus: **+50** for returning with more than 30% oxygen
- Penalty: **−100** if oxygen drops below 10% (mission failed, crew rescue)
- End title: *Safe explorer* / *Bold scientist* / *Rescued*

---

## 6. Folder structure

```
momoot/
├── index.html          # layout: top bar, left panel, map, right panel, HUD, modals
├── style.css           # dark glassy panels, Mars orange, Inter font
├── app.js              # state, screens, game loop
├── data/
│   └── missions.json   # missions, routes (points + stats), events, stops
└── assets/
    ├── map.jpg         # Mars Trek export, imagery
    ├── slope.jpg       # Mars Trek export, slope or elevation colours
    └── photos/         # Perseverance raw images
```

### `missions.json` shape

```json
{
  "missions": [{
    "id": "delta-clay",
    "name": "Sample the delta clay",
    "goal": "Clay forms in water. Find out how long the lake lasted.",
    "reward": 300,
    "habitat": [y, x],
    "target": [y, x],
    "routes": [{
      "id": "safest",
      "label": "Safest",
      "color": "#3ecf6a",
      "points": [[y, x], [y, x]],
      "km": 0, "minutes": 0, "climb": 0, "o2": 38, "risk": "low",
      "stops": [{ "at": 1.0, "name": "Delta clay outcrop", "photo": "assets/photos/delta.jpg", "points": 300 }]
    }],
    "events": [{ "type": "dust", "at": 0.5 }]
  }]
}
```

### Game state in `app.js`

```
screen:      "plan" | "eva" | "event" | "end"
route:       chosen route object
progress:    0 → 1 along the route
o2:          100 → 0
elapsed:     minutes
science:     points
log:         choices made (for the end screen)
```

---

## 7. NASA data checklist

| Data | Mission | Use in Momoot | Where |
|---|---|---|---|
| HiRISE or CTX imagery | Mars Reconnaissance Orbiter | Base map | Mars Trek |
| Elevation or slope | HiRISE or CTX elevation model | Slope overlay, climb numbers | Mars Trek |
| Mineral map | CRISM (MRO) | Why the delta is a science target | Mars Trek, if available for the area |
| Ground photos | Perseverance | Science stop photos | Perseverance Raw Images Gallery |
| Weather | Perseverance MEDA, Curiosity REMS | Dust storm event | Mention as the source of the event |
| Radiation | Curiosity RAD | Radiation event | Mention as the source of the event |

That gives at least **optical, topographic, spectral and atmospheric** data, which is more than the 3 types the challenge suggests.

---

## 8. Demo script (60 seconds)

1. "Astronauts on Mars will need a Komoot. This is Momoot."
2. Show the 3 routes: "Fastest crosses a rock field we can see in HiRISE imagery. Safest avoids it."
3. Pick Safest and start the EVA. Oxygen ticks down, and a real Perseverance photo appears at the stop.
4. The dust storm hits: "This replays real dust-season conditions from Perseverance's weather station."
5. Choose to return: the orange route appears, and the astronaut gets home with 44% oxygen.
6. "Every layer is real NASA data, and the same engine works for any site on Mars."

---

## 9. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Mars Trek export is slow or blurry | Use a high-resolution screenshot of the browser window |
| Leaflet image coordinates are confusing | Skip Leaflet: put the map in an `<img>`, draw routes in an `<svg>` on top |
| Marker animation is buggy | Jump between route points every 0.5 s instead of smooth movement |
| No CRISM layer for the area | Skip the minerals overlay and explain the science target in text |
| Running out of time | Stop at the hour 4.5–5.5 checkpoint and record the video |
| Live demo breaks on the day | Play the recorded video |

---

## 10. Open questions for later

- Final team name and submission title: is "Momoot" final?
- Do you want the 2 extra missions (crater rim, dune field) after tonight?
- Should the "Most science" route have its own event?
