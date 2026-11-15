/*
 * Momoot game data · Jezero crater, Mars.
 *
 * Positions are [latitude, longitude] in degrees (planetocentric, east
 * positive), the same system NASA Mars Trek uses. Landmark positions are
 * approximate: press D in the game, click on the HiRISE imagery, and paste
 * the logged [lat, lon] points here to refine them.
 *
 * Routes are NOT drawn by hand. For each mission, planner.js finds the
 * cheapest safe path between every pair of targets on a terrain cost map,
 * then a depth first search picks the best order to visit them.
 *
 * Game rules (not real mission figures, see README):
 *   rover speed  : 6 km/h on firm ground, slower on sand
 *   life support : 1.5 % per km, plus 0.5 % per 20 m climbed, plus 2 % per target
 */
(() => {
  // Positions marked "sol N" are where Perseverance actually was on that sol
  // (NASA/JPL M20 waypoints). Others are estimates, noted on each line.
  const P = {
    habitat:    [18.4425, 77.4480], // 400 m south west of the landing site
    landing:    [18.4446, 77.4509], // Octavia E. Butler Landing, sol 13 waypoint 18.44463, 77.45089
    vanZyl:     [18.4448, 77.4521], // Van Zyl Overlook, sol 52 (Kodiak photographed from here, sols 57 and 63)
    seitah:     [18.4340, 77.4430], // South Séítah, Brac outcrop, sol 248
    seitahWest: [18.4327, 77.4414], // Séítah sand among the ripples, sol 286
    seitahSouth:[18.4332, 77.4418], // South Séítah panorama spot, sols 200 to 210
    kodiak:     [18.4430, 77.4120], // estimate: about 2.2 km west of Van Zyl Overlook, south of the delta front
    threeForks: [18.4528, 77.4082], // Three Forks depot, sols 654 to 686
    hawksbill:  [18.4580, 77.4070], // Hawksbill Gap ascent, sols 441 to 464
    enchanted:  [18.4498, 77.4031], // Enchanted Lake, sols 415 to 428
    deltaView:  [18.4571, 77.4218], // delta front panorama, sol 405
    belva:      [18.4805, 77.3775], // Belva crater centre: USGS gazetteer 18.48, 77.38, refined so Echo Creek sits on the rim
    belvaRim:   [18.4810, 77.3692], // Echo Creek on Belva's west rim, sols 765 to 775
    upperFan:   [18.4814, 77.3658], // upper fan boulder field (Mount Julian), sols 843 to 848
    isoHill:    [18.4752, 77.3648], // estimate
    fanLobe:    [18.4954, 77.3466], // northern fan, sol 1000
    neretva:    [18.4907, 77.3135], // Neretva Vallis channel, sols 1150 to 1156
    neretvaView:[18.4941, 77.3140], // Mount Washburn above the channel, sol 1162
    rimSlope:   [18.4703, 77.2947], // rim climb, sol 1295
    lookout:    [18.4575, 77.2685], // Lookout Hill on the rim crest, sol 1354
    rimSouth:   [18.4796, 77.2993], // Dox Castle at the foot of the rim, sols 1250 to 1288
    rimSkyline: [18.4285, 77.3555], // estimate: open floor with the whole rim in view
    // beyond the western rim: "Lac de Charmes", where Perseverance drove from late 2025 (NASA/JPL M20 waypoints)
    falbreen:   [18.4526, 77.2546], // Falbreen, sol 1518: maybe older than Jezero crater itself
    kerrlaguna: [18.4508, 77.2556], // Kerrlaguna megaripples, sol 1593
    scotia:     [18.4476, 77.2643], // Scotiafjellet megabreccia workspace, sol 1608
    arathusa:   [18.4277, 77.2267], // Arathusa outcrop and the rover selfie, sols 1792 to 1797
    arbot:      [18.4305, 77.2212], // Arbot ridgeline mosaic, sol 1883
    idubi:      [18.4356, 77.2331], // on the way to Idubi, sols 2006 to 2022
    lacPlain:   [18.4296, 77.2392], // first stop beyond the rim, sol 1707
    // other landing sites
    forksPlain: [18.4500, 77.4140],
    fanCamp:    [18.4875, 77.3925],
    floorSouth: [18.3985, 77.4380]
  };

  const sample = "sample", photo = "photo", measure = "measure", sightsee = "sightsee";

  window.MOMOOT_DATA = {
    sol: 23,
    site: "Jezero crater",
    conditions: { dust: "Low", tempC: -38, radiation: "Normal" },
    places: P,
    habitat: { pos: P.habitat, name: "Octavia E. Butler Landing" }, // replaced by the chosen landing site
    // Where the crew landed: the habitat, start and end of every tour
    landingSites: [
      { id: "butler", pos: P.habitat, name: "Octavia E. Butler Landing", note: "Perseverance's real landing site. Flat crater floor, close to Séítah and the delta front." },
      { id: "forks", pos: P.forksPlain, name: "Three Forks plain", note: "Beside the sample depot at the foot of the delta. Short drives to Hawksbill Gap." },
      { id: "fan", pos: P.fanCamp, name: "Upper fan camp", note: "On top of the delta. Belva crater and the rim are close, the crater floor is far." },
      { id: "south", pos: P.floorSouth, name: "Southern crater floor", note: "Open plains south of Séítah. Long, flat drives to everything." },
      { id: "charmes", pos: P.lacPlain, name: "Lac de Charmes plain", note: "Beyond the western rim, where Perseverance drove in 2026. Ancient crust close by, the crater floor is a long way back." }
    ],
    // ~17 x 22 km: Jezero's crater floor, Séítah, the delta, Belva, the western rim and,
    // beyond it, the plains of Lac de Charmes
    planArea: [[18.330, 77.160], [18.600, 77.545]],
    // the HiRISE hazard scan covers the crater (keeps loading fast); the rest uses the terrain model
    scanArea: [[18.350, 77.240], [18.575, 77.545]],

    // Terrain types that are not in the elevation model (approximate outlines, for gameplay).
    // rx, ry are radii in km. Craters, rim slopes, the delta and Lac de Charmes come from the model.
    terrainZones: [
      { type: "margin", pos: [18.5060, 77.3250], rx: 1.0, ry: 2.4 },       // Margin unit: olivine and carbonate along the inner rim, sampled 2023 to 2024
      { type: "channel", pos: [18.4930, 77.3080], rx: 2.0, ry: 0.32 },     // Neretva Vallis river channel floor
      { type: "megabreccia", pos: [18.4476, 77.2650], rx: 0.30, ry: 0.25 }, // Scotiafjellet blocks
      { type: "megabreccia", pos: [18.4318, 77.2185], rx: 0.45, ry: 0.35 }, // Arbot ridgeline blocks
      { type: "megabreccia", pos: [18.4220, 77.2290], rx: 0.40, ry: 0.30 }  // field of light toned blocks south of Arathusa (estimate)
    ],

    landmarks: [
      { pos: P.landing, name: "Octavia E. Butler Landing", note: "Perseverance landing site, 2021" }
    ],

    // Hazards for the cost map (approximate, for gameplay)
    hazards: {
      sand: [
        { pos: [18.4300, 77.4330], rx: 1.4, ry: 0.7 },    // Séítah ripple field
        { pos: [18.4515, 77.3395], rx: 0.9, ry: 1.4 },    // sand sheet at the foot of the rim
        { pos: [18.4440, 77.3700], rx: 0.8, ry: 0.5 },
        { pos: [18.4060, 77.4120], rx: 1.2, ry: 0.6 },    // South Séítah dunes
        { pos: [18.5060, 77.3320], rx: 0.7, ry: 1.0 }     // dunes in Neretva Vallis
      ],
      boulders: [
        { pos: [18.4562, 77.4178], r: 0.38 },
        { pos: [18.4470, 77.4310], r: 0.22 },
        { pos: [18.4822, 77.3905], r: 0.35 },
        { pos: [18.4418, 77.3602], r: 0.45 },
        { pos: [18.4662, 77.3330], r: 0.4 }
      ]
    },

    // Risk profiles used to plan the three route options
    profiles: {
      // terrain: extra cost per km on each terrain type. avoid: how hard it keeps away from the
      // options planned before it (planOrder), so the three options take visibly different lines.
      safest:  { label: "Safest", note: "Avoids slopes over 12°, every boulder field and megabreccia", color: "#2E9E52", maxSlope: 12, steep: 6, sand: 4, rock: Infinity, bonus: false,
                 terrain: { channel: 0.6, ridges: 1.2, rim: 1.0, margin: 0.4, crater: 3 }, avoid: 1.2, planOrder: 2 },
      fastest: { label: "Fastest", note: "Shortest distance, accepts sand, rocks and steeper ground", color: "#2F6FD6", maxSlope: 25, steep: 0.2, sand: 0.15, rock: 0.4, bonus: false,
                 terrain: { megabreccia: 0.8 }, avoid: 0, planOrder: 1 },
      easiest: { label: "Easiest", note: "Flattest ground: keeps to the crater floor and channels, avoids sand, ridges and rough rock", color: "#8A4FE0", maxSlope: 8, steep: 18, sand: 12, rock: Infinity, bonus: false,
                 terrain: { floor: -0.2, channel: -0.2, delta: 0.8, margin: 1.5, ridges: 3, rim: 3, crater: 5, megabreccia: 8 }, avoid: 2.2, planOrder: 3 }
    },

    // Every task the crew can pick today. "points" is an internal priority weight
    // (shown as High, Medium or Low priority); the highest picked task becomes the main task.
    // Every task the crew can pick today. "today: true" marks the five everyday
    // choices shown first; the others sit farther out.
    // "storm" closes a task (greyed out, cannot be picked) during a dust storm (Settings → Demo weather).
    tasks: [
      { id: "hg", pos: P.hawksbill, type: sample, name: "Clay sample at Hawksbill Gap", points: 300, minutes: 45, today: true, detail: "CRISM shows clay minerals in these delta layers. Clay forms in water, so it tells us how long the lake lasted." },
      { id: "tf", pos: P.threeForks, type: photo, name: "Three Forks sample depot", points: 60, minutes: 20, today: true, detail: "Photograph the ten tubes Perseverance cached in 2022 and 2023 and check none are buried by dust." },
      { id: "se", pos: P.seitah, type: measure, name: "Wind reading in Séítah", points: 70, minutes: 30, today: true, detail: "Set up the anemometer on a ripple crest to see how fast the sand is moving." },
      { id: "ls", pos: P.landing, type: photo, name: "Landing site survey", points: 40, minutes: 15, today: true, detail: "Document Octavia E. Butler Landing and any debris the wind has moved since 2021." },
      { id: "el", pos: P.enchanted, type: sample, name: "Enchanted Lake mudstone", points: 90, minutes: 35, today: true, detail: "Fine grained lake sediment at the very bottom of the delta." },
      { id: "ko", pos: P.kodiak, type: photo, name: "Kodiak butte layers", points: 90, minutes: 25, detail: "A flat topped remnant of the delta, standing alone on the crater floor." },
      { id: "sw", pos: P.seitahWest, type: sample, name: "Séítah sand sample", points: 80, minutes: 30, detail: "Wind blown sand from the ripple field." },
      { id: "bv", pos: P.belva, type: sample, name: "Belva crater wall sample", points: 450, minutes: 50, detail: "The impact exposed river laid layers in the crater wall, like a road cut on Earth." },
      { id: "uf", pos: P.upperFan, type: photo, name: "Upper fan boulders", points: 70, minutes: 20, detail: "Boulders carried in by a late, high energy flood." },
      { id: "ih", pos: P.isoHill, type: photo, name: "Isolated hill layers", points: 80, minutes: 20, detail: "Stacked river layers formed by a deep, fast river." },
      { id: "fl", pos: P.fanLobe, type: sample, name: "Northern fan lobe", points: 80, minutes: 30, detail: "Coarse river sediment near the old channel." },
      { id: "nv", pos: P.neretva, type: photo, name: "Neretva Vallis inlet", points: 120, minutes: 25, detail: "The river channel that once filled the lake." },
      { id: "lh", storm: "Steep rim climb, too exposed in storm winds", pos: P.lookout, type: sample, name: "Rim rock at Lookout Hill", points: 600, minutes: 60, detail: "Ancient crust lifted by the impact, with views out over Nili Planum." },
      { id: "rs", storm: "Steep rim climb, too exposed in storm winds", pos: P.rimSlope, type: measure, name: "Radiation on the rim slope", points: 80, minutes: 30, detail: "Halfway up the 780 m climb to the rim. Compare the dose on open slopes with the crater floor." },
      { id: "fb", pos: P.falbreen, type: photo, name: "Falbreen ancient terrain", points: 120, minutes: 25, detail: "Perseverance stopped here in May 2025 (sol 1516). It may be some of the oldest terrain the rover has explored, perhaps older than Jezero crater itself." },
      { id: "kl", pos: P.kerrlaguna, type: measure, name: "Kerrlaguna megaripples", points: 80, minutes: 30, detail: "Inactive megaripples shaped by ancient winds, studied in August 2025. Measure the crests and check whether any sand still moves." },
      { id: "sc", pos: P.scotia, type: sample, name: "Scotiafjellet megabreccia", points: 400, minutes: 50, detail: "A chaotic mix of rock broken by ancient impacts. It could hold pieces of deep crust, some of the oldest rock within reach." },
      { id: "ar", pos: P.arathusa, type: sample, name: "Arathusa igneous outcrop", points: 500, minutes: 45, detail: "Perseverance abraded this outcrop and took a selfie here in March 2026. Its large crystals formed underground, likely before Jezero crater existed." },
      { id: "id", pos: P.idubi, type: measure, name: "Idubi hot spring search", points: 150, minutes: 35, detail: "Where Perseverance broke Opportunity's driving record in October 2026, on its way to Idubi to look for traces of ancient hydrothermal systems." },
      { id: "sr", storm: "Steep rim climb, too exposed in storm winds", pos: P.rimSouth, type: sample, name: "Dox Castle outcrop", points: 100, minutes: 35, detail: "Rim rock at the start of the climb that may record ancient hot springs." },
      // Sightseeing: drive to a viewpoint, take photos, and leave them for the next crew
      { id: "vb", storm: "Dust hides the view today", pos: P.belvaRim, type: sightsee, group: "sight", name: "Belva crater panorama", points: 90, minutes: 25, detail: "Stand on Echo Creek, where Perseverance took its 152 image mosaic, and look across the 900 m crater." },
      { id: "vk", storm: "Dust hides the view today", pos: P.vanZyl, type: sightsee, group: "sight", name: "Kodiak from Van Zyl Overlook", points: 60, minutes: 20, detail: "Perseverance shot Kodiak from this rise at 8:15 in the morning, when low sun picks out the layers. Repeat the shot." },
      { id: "vs", storm: "Dust hides the view today", pos: P.seitahSouth, type: sightsee, group: "sight", name: "South Séítah ridges", points: 70, minutes: 20, detail: "Rocky ridges rising out of the dunes, some of the oldest rock in the crater." },
      { id: "vn", storm: "Dust hides the view today", pos: P.neretvaView, type: sightsee, group: "sight", name: "Neretva Vallis overlook", points: 110, minutes: 30, detail: "Look down the dry river channel that once filled Jezero's lake." },
      { id: "ab", storm: "Dust hides the view today", pos: P.arbot, type: sightsee, group: "sight", name: "Arbot ridgeline", points: 100, minutes: 25, detail: "Perseverance shot a mosaic of this ridgeline in April 2026 (sol 1882). Blocks as big as buildings, possible megabreccia, sit on the slopes." },
      { id: "vr", storm: "Dust hides the view today", pos: P.rimSkyline, type: sightsee, group: "sight", name: "Jezero rim skyline", points: 50, minutes: 15, detail: "The whole western rim in one frame, 300 m high and 20 km long." }
    ],

    // Real Perseverance photos of the same place (or the nearest one it imaged).
    // Loaded from NASA when the game runs; each falls back to a HiRISE view.
    photos: {
      hg: { pia: "PIA25212", url: "photojournal/pia/pia25/pia25212/PIA25212.jpg", caption: "Delta front east of Hawksbill Gap, Mastcam-Z, sol 406" },
      tf: { pia: "PIA25736", url: "mars/resources/detail_files/2/7/27307_27307_PIA25736-web1.jpg", caption: "The Three Forks sample depot, Mastcam-Z, sol 693" },
      se: { pia: "PIA25023", url: "mars/resources/detail_files/2/6/26437_PIA25023-web.jpg", caption: "Rock outcrop in Séítah, Mastcam-Z, sol 237" },
      ls: { pia: "PIA23727", url: "photojournal/pia/pia23/pia23727/PIA23727.jpg", caption: "View from the landing site, Mastcam-Z, sol 4" },
      el: { pia: "Sol 424", url: "mars/mars2020-raw-images/pub/ods/surface/sol/00424/ids/edr/browse/zcam/ZR0_0424_0704571095_818EBY_N0240000ZCAM08445_1100LMJ01_1200.jpg", caption: "Rocks at Enchanted Lake, Mastcam-Z raw image, sol 424", raw: true, credit: "NASA/JPL-Caltech/ASU" },
      ko: { pia: "PIA24802", url: "mars/resources/detail_files/2/6/26413_Sol0057_zcam08103_Z110_R0E_web.jpg", caption: "Kodiak butte, Mastcam-Z, sol 57" },
      sw: { pia: "PIA24816", url: "mars/internal_resources/1155.jpeg", caption: "Ridges and ripples of South Séítah, Mastcam-Z, sol 210" },
      bv: { pia: "PIA25889", url: "mars/resources/detail_files/2/7/27471_PIA25889-web.jpg", caption: "Inside Belva crater, Mastcam-Z, sol 772" },
      uf: { pia: "PIA25963", url: "mars/resources/detail_files/2/7/27574_PIA25963-web.jpg", caption: "Boulder field on the upper fan, Mastcam-Z, sol 845" },
      ih: { pia: "PIA25965", url: "mars/resources/detail_files/2/7/27664_PIA25965-NaturalLight-web.jpg", caption: "Looking west across the upper fan, Mastcam-Z, sol 847" },
      fl: { pia: "PIA25212", url: "photojournal/pia/pia25/pia25212/PIA25212.jpg", caption: "Jezero delta layers, Mastcam-Z, sol 406" },
      nv: { pia: "PIA26335", url: "photojournal/pia/pia26/pia26335/PIA26335.jpg", caption: "Neretva Vallis river channel, Mastcam-Z, sol 1152" },
      lh: { pia: "PIA26511", url: "photojournal/pia/pia26/pia26511/PIA26511.jpg", caption: "First view over the rim from Lookout Hill, Navcam, sol 1354", credit: "NASA/JPL-Caltech" },
      rs: { pia: "PIA24264", url: "mars/resources/detail_files/2/5/25643_PIA24264-Panorama_supplement-crater-rim.jpg", caption: "Jezero's rim from the crater floor, Mastcam-Z, sol 2" },
      vb: { pia: "PIA25889", url: "mars/resources/detail_files/2/7/27471_PIA25889-web.jpg", caption: "Belva crater from Echo Creek, Mastcam-Z, sol 772" },
      vk: { pia: "PIA24802", url: "mars/resources/detail_files/2/6/26413_Sol0057_zcam08103_Z110_R0E_web.jpg", caption: "Kodiak from Van Zyl Overlook, Mastcam-Z, sol 57" },
      vs: { pia: "PIA24816", url: "mars/internal_resources/1155.jpeg", caption: "South Séítah ridges, Mastcam-Z, sol 210" },
      vn: { pia: "PIA26335", url: "photojournal/pia/pia26/pia26335/PIA26335.jpg", caption: "Looking down Neretva Vallis, Mastcam-Z, sol 1152" },
      vr: { pia: "PIA24264", url: "mars/resources/detail_files/2/5/25643_PIA24264-Panorama_supplement-crater-rim.jpg", caption: "Jezero's rim from the crater floor, Mastcam-Z, sol 2" },
      sr: { pia: "PIA26373", url: "photojournal/pia/pia26/pia26373/PIA26373.jpg", caption: "Looking up toward Dox Castle and the rim, Mastcam-Z, sol 1233" }
    },

    // Filled in from the tasks you pick on the task page
    missions: [
      { id: "today", name: "Today's EVA", goal: "", difficulty: 1, weather: [{ type: "dust", at: 0.62 }], objectives: [] }
    ],

    // Events replay the kind of conditions NASA rovers have recorded.
    events: {
      dust: {
        title: "Dust storm incoming", kicker: "Conditions changed",
        text: "A dust front is moving toward your route. Visibility will drop before you can finish. What do you do?",
        countdown: "38:12",
        source: "Replays dust season conditions recorded by Perseverance (MEDA) and Curiosity (REMS) weather stations.",
        choices: [
          { id: "return", label: "Return to the habitat now", hint: "Known safe ground, the way you came. You keep samples already collected.", recommended: true, effect: { returnNow: true } },
          { id: "shelter", label: "Shelter in the rover and wait", hint: "Keeps the mission alive. Costs 12 % life support and 90 minutes.", effect: { o2: -12, minutes: 90 } }
        ]
      },
      radiation: {
        title: "Solar particle event", kicker: "Radiation alert",
        text: "The habitat reports a jump in high energy particles from the Sun. The rover's shielded cabin and the terrain both help.",
        countdown: "12:00",
        source: "Based on solar particle events measured on the surface by Curiosity's RAD instrument.",
        choices: [
          { id: "ridge", label: "Park behind the ridge and wait", hint: "Waits out the peak in the shielded cabin. Costs 6 % life support and 60 minutes.", recommended: true, effect: { o2: -6, minutes: 60, dose: 0.02 } },
          { id: "push", label: "Keep driving", hint: "Saves time, but your dose rises sharply.", effect: { dose: 0.3 } }
        ]
      },
      rock: {
        title: "Boulder field ahead", kicker: "Terrain",
        text: "This route crosses a boulder field seen in HiRISE imagery. Some rocks are too big for the rover's wheels.",
        countdown: null,
        source: "Boulder fields come from HiRISE orbital imagery (25 cm per pixel).",
        choices: [
          { id: "slow", label: "Crawl through slowly", hint: "Adds 25 minutes and 3 % life support.", recommended: true, effect: { o2: -3, minutes: 25 } },
          { id: "through", label: "Keep speed", hint: "Faster, but risks a wheel. Costs 20 % rover power.", effect: { o2: -1, minutes: 5, suit: -20 } }
        ]
      },
      sand: {
        title: "Soft sand ahead", kicker: "Terrain",
        text: "Thermal data shows loose sand here. The rover could bog down, the way Spirit got stuck in 2009.",
        countdown: null,
        source: "Sand fields are placed from the ripples visible in HiRISE. To check them in thermal data, open Layers and turn on THEMIS day IR (Mars Odyssey): loose sand warms up fast and shows bright.",
        choices: [
          { id: "careful", label: "Lower tyre pressure, drive slowly", hint: "Adds 20 minutes and 2 % life support.", recommended: true, effect: { o2: -2, minutes: 20 } },
          { id: "push", label: "Push through", hint: "Costs 6 % life support and 15 % rover power.", effect: { o2: -6, minutes: 10, suit: -15 } }
        ]
      }
    },

    mapLayers: [
      { id: "Mars_MGS_MOLA_ClrShade_merge_global_463m", name: "MOLA elevation", ext: "jpg", minZoom: 0, maxNative: 7, group: "elevation", attribution: "MGS MOLA" },
      { id: "Mars_Viking_MDIM21_ClrMosaic_global_232m", name: "Viking colour", ext: "jpg", minZoom: 0, maxNative: 7, group: "imagery", attribution: "Viking MDIM 2.1, NASA/USGS" },
      { id: "CTX_beta01_uncontrolled_5m_Caltech", name: "CTX 5 m", ext: "png", minZoom: 7, maxNative: 13, group: "imagery", attribution: "MRO CTX, NASA/JPL Caltech/MSSS, Caltech Murray Lab" },
      { id: "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", name: "HiRISE 25 cm", ext: "png", minZoom: 11, maxNative: 17, group: "imagery", bounds: [[18.3068, 77.2229], [18.6693, 77.584]], attribution: "MRO HiRISE, NASA/JPL Caltech/University of Arizona, USGS" },
      // Overlay: THEMIS daytime thermal infrared, 100 m per pixel (Mars Odyssey, USGS controlled mosaic).
      // By day, loose sand and dust heat up fast and look bright; bedrock stays cooler and looks dark.
      { id: "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", name: "THEMIS day IR", ext: "png", minZoom: 0, maxNative: 9, group: "thermal", overlay: true, opacity: 0.7, attribution: "Mars Odyssey THEMIS, NASA/JPL/ASU, USGS controlled mosaic" }
    ],

    // CRISM mineral map of Jezero (MRO). Made by tools/crism/make_crism_overlay.py from
    // Parente et al. 2021 (UMass, GAN mineral mapping), Zenodo DOI 10.5281/zenodo.5575824 (CC BY 4.0).
    crism: { meta: "data/crism_jezero.json", image: "data/crism_jezero.png", legend: "data/crism_legend.png" },

    traverseUrl: "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json"
  };
})();
