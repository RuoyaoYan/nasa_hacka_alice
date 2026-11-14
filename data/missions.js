/*
 * Momoot game data · Jezero crater, Mars.
 *
 * All positions are [latitude, longitude] in degrees (planetocentric,
 * east positive), the same system NASA Mars Trek uses.
 *
 * Positions of the habitat, targets and routes are approximate and chosen
 * for gameplay. Press D in the game to turn on draw mode: every click on the
 * map logs a [lat, lon] point to the browser console, so you can retrace
 * routes precisely on the HiRISE imagery and paste them here.
 *
 * Game rules (not real spacesuit figures, see README):
 *   walking speed : 2 km/h on firm ground, slower on sand
 *   oxygen        : 7 % per km walked, plus 1 % per 10 m climbed
 *   every walk is a round trip back to the habitat
 */
window.MOMOOT_DATA = {
  sol: 23,
  site: "Jezero crater",
  conditions: { dust: "Low", tempC: -38, radiation: "Normal" },

  habitat: { pos: [18.4385, 77.4462], name: "Habitat" },

  // Real reference point: where Perseverance landed on 18 February 2021
  landmarks: [
    { pos: [18.4447, 77.4508], name: "Octavia E. Butler Landing", note: "Perseverance landing site, 2021" }
  ],

  missions: [
    {
      id: "delta-clay",
      name: "Sample the delta clay",
      goal: "Clay minerals form in water. A sample from the delta front tells us how long Jezero's lake lasted.",
      difficulty: 2,
      target: { pos: [18.4572, 77.4032], name: "Delta front outcrop", dataNote: "CRISM shows clay minerals here" },
      finalStop: { name: "Delta front outcrop", points: 300, photo: "delta", detail: "Layered rock where an ancient river met the lake." },
      routes: [
        {
          id: "safest", label: "Safest", note: "Stays on the crater floor, gentle climb at the end", color: "#2E9E52", risk: 1, climb: 48,
          terrain: { bedrock: 55, gravel: 30, sand: 15 },
          profile: [0, 2, 4, 6, 9, 12, 15, 19, 25, 32, 40, 48],
          points: [[18.4385, 77.4462], [18.4412, 77.4384], [18.4458, 77.4286], [18.4502, 77.4186], [18.4541, 77.4104], [18.4572, 77.4032]],
          stops: [], events: [{ type: "dust", at: 0.55 }]
        },
        {
          id: "fastest", label: "Fastest", note: "Direct line, crosses a boulder field", color: "#2F6FD6", risk: 3, climb: 55,
          terrain: { bedrock: 40, gravel: 50, sand: 10 },
          profile: [0, 4, 8, 12, 18, 24, 31, 37, 43, 48, 52, 55],
          points: [[18.4385, 77.4462], [18.4446, 77.4322], [18.4510, 77.4176], [18.4572, 77.4032]],
          stops: [], events: [{ type: "rock", at: 0.4 }, { type: "dust", at: 0.72 }]
        },
        {
          id: "science", label: "Most science", note: "Detour through Séítah for a sand sample", color: "#8A4FE0", risk: 2, climb: 52,
          terrain: { bedrock: 40, gravel: 25, sand: 35 },
          profile: [0, 1, 2, 3, 5, 8, 12, 18, 26, 35, 44, 52],
          points: [[18.4385, 77.4462], [18.4334, 77.4390], [18.4290, 77.4268], [18.4366, 77.4170], [18.4470, 77.4094], [18.4572, 77.4032]],
          stops: [{ at: 0.38, name: "Séítah sand ripples", points: 80, photo: "dunes", detail: "Wind blown sand shows how today's winds move material." }],
          events: [{ type: "dust", at: 0.7 }]
        }
      ]
    },
    {
      id: "sample-depot",
      name: "Retrieve the sample depot",
      goal: "Perseverance left sealed sample tubes on the crater floor. Collect them for the return flight to Earth.",
      difficulty: 3,
      target: { pos: [18.4521, 77.4118], name: "Sample depot", dataNote: "Tubes cached by Perseverance" },
      finalStop: { name: "Sample depot", points: 450, photo: "delta", detail: "Sealed tubes of rock, regolith and atmosphere, waiting for pickup." },
      routes: [
        {
          id: "safest", label: "Safest", note: "Follows the rover's old tracks on firm ground", color: "#2E9E52", risk: 1, climb: 22,
          terrain: { bedrock: 60, gravel: 30, sand: 10 },
          profile: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
          points: [[18.4385, 77.4462], [18.4425, 77.4388], [18.4478, 77.4262], [18.4508, 77.4170], [18.4521, 77.4118]],
          stops: [], events: [{ type: "radiation", at: 0.5 }]
        },
        {
          id: "fastest", label: "Fastest", note: "Straight across a field of loose rock", color: "#2F6FD6", risk: 3, climb: 26,
          terrain: { bedrock: 45, gravel: 45, sand: 10 },
          profile: [0, 3, 6, 9, 12, 15, 17, 19, 21, 23, 25, 26],
          points: [[18.4385, 77.4462], [18.4455, 77.4290], [18.4521, 77.4118]],
          stops: [], events: [{ type: "rock", at: 0.45 }, { type: "radiation", at: 0.75 }]
        },
        {
          id: "science", label: "Most science", note: "Passes the Perseverance landing site first", color: "#8A4FE0", risk: 2, climb: 30,
          terrain: { bedrock: 55, gravel: 30, sand: 15 },
          profile: [0, 1, 3, 4, 7, 10, 13, 17, 20, 24, 27, 30],
          points: [[18.4385, 77.4462], [18.4447, 77.4508], [18.4492, 77.4392], [18.4515, 77.4250], [18.4521, 77.4118]],
          stops: [{ at: 0.16, name: "Octavia E. Butler Landing", points: 120, photo: "rim", detail: "Where Perseverance touched down in 2021. Check the landing area for blown debris." }],
          events: [{ type: "radiation", at: 0.66 }]
        }
      ]
    },
    {
      id: "seitah",
      name: "Study the Séítah ripples",
      goal: "Measure how today's wind moves sand, so future crews know where dust will build up.",
      difficulty: 1,
      target: { pos: [18.4262, 77.4208], name: "Séítah ripple field", dataNote: "HiRISE shows active ripples here" },
      finalStop: { name: "Séítah ripple field", points: 150, photo: "dunes", detail: "Set up the wind sensor on a ripple crest and collect a sand sample." },
      routes: [
        {
          id: "safest", label: "Safest", note: "Firm ground until the last stretch", color: "#2E9E52", risk: 1, climb: 12,
          terrain: { bedrock: 60, gravel: 25, sand: 15 },
          profile: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12],
          points: [[18.4385, 77.4462], [18.4350, 77.4384], [18.4302, 77.4292], [18.4262, 77.4208]],
          stops: [], events: []
        },
        {
          id: "fastest", label: "Fastest", note: "Cuts straight through soft sand", color: "#2F6FD6", risk: 2, climb: 15,
          terrain: { bedrock: 20, gravel: 20, sand: 60 },
          profile: [0, 2, 3, 5, 6, 8, 9, 10, 12, 13, 14, 15],
          points: [[18.4385, 77.4462], [18.4318, 77.4330], [18.4262, 77.4208]],
          stops: [], events: [{ type: "sand", at: 0.45 }]
        },
        {
          id: "science", label: "Most science", note: "Loops past a layered outcrop for an extra reading", color: "#8A4FE0", risk: 2, climb: 18,
          terrain: { bedrock: 35, gravel: 25, sand: 40 },
          profile: [0, 2, 4, 6, 8, 10, 12, 13, 14, 15, 17, 18],
          points: [[18.4385, 77.4462], [18.4398, 77.4352], [18.4340, 77.4262], [18.4262, 77.4208]],
          stops: [{ at: 0.6, name: "Layered outcrop", points: 60, photo: "rim", detail: "Thin rock layers record changes in the old lake floor." }],
          events: [{ type: "dust", at: 0.82 }]
        }
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
        { id: "shelter", label: "Shelter and wait it out", hint: "Keeps the mission alive. Costs 15 % oxygen and 40 minutes.", effect: { o2: -15, minutes: 40 } }
      ]
    },
    radiation: {
      title: "Solar particle event", kicker: "Radiation alert",
      text: "The habitat reports a jump in high energy particles from the Sun. Terrain can block part of it.",
      countdown: "12:00",
      source: "Based on solar particle events measured on the surface by Curiosity's RAD instrument.",
      choices: [
        { id: "ridge", label: "Shelter behind the ridge", hint: "Waits out the peak. Costs 8 % oxygen and 30 minutes.", recommended: true, effect: { o2: -8, minutes: 30, dose: 0.02 } },
        { id: "push", label: "Keep walking", hint: "Saves time, but your dose rises sharply.", effect: { dose: 0.3 } }
      ]
    },
    rock: {
      title: "Boulder field ahead", kicker: "Terrain",
      text: "Boulders block the direct line. They are visible in HiRISE imagery but harder to cross on foot.",
      countdown: null,
      source: "Boulder positions come from HiRISE orbital imagery (25 cm per pixel).",
      choices: [
        { id: "around", label: "Go around", hint: "Adds 12 minutes and 4 % oxygen.", recommended: true, effect: { o2: -4, minutes: 12 } },
        { id: "through", label: "Climb through", hint: "Hard work in a suit. Costs 9 % oxygen and risks a suit tear.", effect: { o2: -9, minutes: 4, suit: -15 } }
      ]
    },
    sand: {
      title: "Soft sand ahead", kicker: "Terrain",
      text: "Thermal data shows loose sand here. Each step sinks and costs more energy.",
      countdown: null,
      source: "Loose sand vs bedrock is mapped from THEMIS thermal data (Mars Odyssey).",
      choices: [
        { id: "detour", label: "Detour on firm ground", hint: "Adds 10 minutes and 3 % oxygen.", recommended: true, effect: { o2: -3, minutes: 10 } },
        { id: "push", label: "Push through", hint: "Costs 8 % oxygen and drains suit power.", effect: { o2: -8, minutes: 6, suit: -10 } }
      ]
    }
  },

  // NASA Mars Trek tile layers, bottom to top. Higher layers fade in as you zoom.
  mapLayers: [
    { id: "Mars_MGS_MOLA_ClrShade_merge_global_463m", name: "MOLA elevation", ext: "jpg", minZoom: 0, maxNative: 7, group: "elevation", attribution: "MGS MOLA" },
    { id: "Mars_Viking_MDIM21_ClrMosaic_global_232m", name: "Viking colour", ext: "jpg", minZoom: 0, maxNative: 7, group: "imagery", attribution: "Viking MDIM 2.1, NASA/USGS" },
    { id: "CTX_beta01_uncontrolled_5m_Caltech", name: "CTX 5 m", ext: "png", minZoom: 7, maxNative: 13, group: "imagery", attribution: "MRO CTX, NASA/JPL Caltech/MSSS, Caltech Murray Lab" },
    { id: "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", name: "HiRISE 25 cm", ext: "png", minZoom: 11, maxNative: 17, group: "imagery", bounds: [[18.3068, 77.2229], [18.6693, 77.584]], attribution: "MRO HiRISE, NASA/JPL Caltech/University of Arizona, USGS" }
  ],

  // Perseverance's real traverse, published by NASA (loaded at runtime if the server allows it)
  traverseUrl: "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json"
};
