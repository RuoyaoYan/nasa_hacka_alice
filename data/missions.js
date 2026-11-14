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
  const P = {
    habitat:    [18.4385, 77.4462],
    landing:    [18.4447, 77.4508], // Octavia E. Butler Landing (real)
    seitah:     [18.4262, 77.4208],
    seitahWest: [18.4292, 77.4098],
    kodiak:     [18.4318, 77.3905],
    threeForks: [18.4522, 77.4012],
    hawksbill:  [18.4642, 77.3992],
    enchanted:  [18.4598, 77.3918],
    upperFan:   [18.4795, 77.3842],
    isoHill:    [18.4752, 77.3648],
    belva:      [18.4905, 77.3702],
    fanLobe:    [18.4968, 77.3528],
    neretva:    [18.4985, 77.3365],
    rimSlope:   [18.4602, 77.3168],
    lookout:    [18.4705, 77.3018],
    rimSouth:   [18.4545, 77.3052]
  };

  const sample = "sample", photo = "photo", measure = "measure";

  window.MOMOOT_DATA = {
    sol: 23,
    site: "Jezero crater",
    conditions: { dust: "Low", tempC: -38, radiation: "Normal" },
    places: P,
    habitat: { pos: P.habitat, name: "Habitat" },
    planArea: [[18.405, 77.285], [18.515, 77.470]],

    landmarks: [
      { pos: P.landing, name: "Octavia E. Butler Landing", note: "Perseverance landing site, 2021" }
    ],

    // Hazards for the cost map (approximate, for gameplay)
    hazards: {
      sand: [
        { pos: [18.4262, 77.4185], rx: 1.5, ry: 0.75 },   // Séítah ripple field
        { pos: [18.4515, 77.3395], rx: 0.9, ry: 1.4 },    // sand sheet at the foot of the rim
        { pos: [18.4440, 77.3700], rx: 0.8, ry: 0.5 }
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
      safest:  { label: "Safest", note: "Avoids slopes over 12° and every boulder field", color: "#2E9E52", maxSlope: 12, steep: 6, sand: 4, rock: Infinity, bonus: false },
      fastest: { label: "Fastest", note: "Shortest distance, accepts sand, rocks and steeper ground", color: "#2F6FD6", maxSlope: 25, steep: 0.4, sand: 0.3, rock: 0.6, bonus: false },
      easiest: { label: "Easiest", note: "Least climbing and soft sand, even if a little longer", color: "#8A4FE0", maxSlope: 9, steep: 14, sand: 9, rock: Infinity, bonus: false }
    },

    missions: [
      {
        id: "delta-front",
        name: "Delta front survey",
        goal: "Five tasks along the foot of the ancient river delta: sample clay, photograph the layers and measure the wind. Clay forms in water, so it tells us how long Jezero's lake lasted.",
        difficulty: 1,
        weather: [{ type: "dust", at: 0.62 }],
        objectives: [
          { id: "hg", pos: P.hawksbill, type: sample, name: "Clay sample at Hawksbill Gap", points: 300, minutes: 45, photo: "delta", detail: "CRISM shows clay minerals in these layers.", main: true },
          { id: "tf", pos: P.threeForks, type: photo, name: "Three Forks sample depot", points: 60, minutes: 20, photo: "rim", detail: "Photograph the ten tubes Perseverance cached in 2022 and 2023." },
          { id: "el", pos: P.enchanted, type: photo, name: "Enchanted Lake panorama", points: 80, minutes: 25, photo: "delta", detail: "Where Perseverance first saw sedimentary rocks up close." },
          { id: "se", pos: P.seitah, type: measure, name: "Wind reading in Séítah", points: 70, minutes: 30, photo: "dunes", detail: "Set up the anemometer on a ripple crest." },
          { id: "ls", pos: P.landing, type: photo, name: "Landing site survey", points: 40, minutes: 15, photo: "rim", detail: "Document Perseverance's landing site and any blown debris." },
          { id: "ko", pos: P.kodiak, type: photo, name: "Kodiak butte layers", points: 90, minutes: 25, photo: "rim", detail: "A flat topped remnant of the delta.", optional: true },
          { id: "sw", pos: P.seitahWest, type: sample, name: "Séítah sand sample", points: 80, minutes: 30, photo: "dunes", detail: "Wind blown sand from the ripple field.", optional: true }
        ]
      },
      {
        id: "belva",
        name: "Upper fan and Belva crater",
        goal: "Climb onto the delta's upper fan. Sample the layers exposed in Belva crater and photograph the boulders a late flood carried in.",
        difficulty: 2,
        weather: [{ type: "radiation", at: 0.45 }],
        objectives: [
          { id: "bv", pos: P.belva, type: sample, name: "Belva crater wall sample", points: 450, minutes: 50, photo: "rim", detail: "The impact exposed river laid layers in the crater wall.", main: true },
          { id: "hg", pos: P.hawksbill, type: photo, name: "Hawksbill Gap valley", points: 60, minutes: 15, photo: "delta", detail: "The valley where Perseverance first drove onto the delta." },
          { id: "tf", pos: P.threeForks, type: measure, name: "Depot tube inventory", points: 60, minutes: 25, photo: "rim", detail: "Check the seals on the cached sample tubes." },
          { id: "el", pos: P.enchanted, type: sample, name: "Enchanted Lake mudstone", points: 90, minutes: 35, photo: "delta", detail: "Fine grained lake sediment." },
          { id: "uf", pos: P.upperFan, type: photo, name: "Upper fan boulders", points: 70, minutes: 20, photo: "rim", detail: "Boulders carried in by a late, high energy flood." },
          { id: "ih", pos: P.isoHill, type: photo, name: "Isolated hill", points: 80, minutes: 20, photo: "rim", detail: "Stacked river layers formed by a deep, fast river.", optional: true },
          { id: "fl", pos: P.fanLobe, type: sample, name: "Northern fan lobe", points: 80, minutes: 30, photo: "delta", detail: "Coarse river sediment near the old channel.", optional: true }
        ]
      },
      {
        id: "rim",
        name: "Crater rim expedition",
        goal: "A full day traverse to Jezero's western rim. The rim exposes rock from deep inside Mars, thrown up by the impact 3.9 billion years ago.",
        difficulty: 3,
        weather: [{ type: "radiation", at: 0.4 }, { type: "dust", at: 0.74 }],
        objectives: [
          { id: "lh", pos: P.lookout, type: sample, name: "Rim rock at Lookout Hill", points: 600, minutes: 60, photo: "rim", detail: "Ancient crust lifted by the impact. Views out over Nili Planum.", main: true },
          { id: "nv", pos: P.neretva, type: photo, name: "Neretva Vallis inlet", points: 120, minutes: 25, photo: "delta", detail: "The river channel that once filled the lake." },
          { id: "bv", pos: P.belva, type: sample, name: "Belva crater", points: 120, minutes: 40, photo: "rim", detail: "Delta layers exposed in the crater wall." },
          { id: "rs", pos: P.rimSlope, type: measure, name: "Radiation on the rim slope", points: 80, minutes: 30, photo: "rim", detail: "Compare dose on open slopes with the crater floor." },
          { id: "ko", pos: P.kodiak, type: photo, name: "Kodiak butte", points: 90, minutes: 20, photo: "rim", detail: "A last remnant of the delta, standing alone." },
          { id: "sr", pos: P.rimSouth, type: sample, name: "Southern rim outcrop", points: 100, minutes: 35, photo: "rim", detail: "Altered rock that may record ancient hot springs.", optional: true },
          { id: "se", pos: P.seitah, type: measure, name: "Wind reading in Séítah", points: 70, minutes: 30, photo: "dunes", detail: "Wind data on the way home.", optional: true }
        ]
      }
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
        source: "Loose sand vs bedrock is mapped from THEMIS thermal data (Mars Odyssey).",
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
      { id: "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", name: "HiRISE 25 cm", ext: "png", minZoom: 11, maxNative: 17, group: "imagery", bounds: [[18.3068, 77.2229], [18.6693, 77.584]], attribution: "MRO HiRISE, NASA/JPL Caltech/University of Arizona, USGS" }
    ],

    traverseUrl: "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json"
  };
})();
