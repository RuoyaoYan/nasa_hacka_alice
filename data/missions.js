/*
 * Momoot game data.
 *
 * All coordinates are in map units on a 1600 x 900 canvas (the SVG viewBox).
 * If you swap in a real Mars Trek export at assets/map.jpg, press D in the game
 * to turn on draw mode, click along your new paths, and paste the logged
 * points into the routes below.
 *
 * Game rules (not real spacesuit figures, see README):
 *   walking speed  : 2 km/h on firm ground, slower on sand
 *   oxygen         : 7 % per km walked, plus 1 % per 10 m climbed
 *   every walk is a round trip: out to the target, then back to the habitat
 */
window.MOMOOT_DATA = {
  sol: 23,
  site: "Jezero crater",
  kmPerUnit: 0.004, // 250 map units = 1 km
  conditions: { dust: "Low", tempC: -38, radiation: "Normal" },

  habitat: { x: 560, y: 760, name: "Habitat" },

  // Terrain features drawn on the stylised map and used by the layer toggles.
  terrain: {
    craterRim: "M-80 190 Q 380 40 800 120 T 1700 80",
    delta: "M1010 150 Q1080 360 900 480 Q800 545 690 505 Q800 420 850 300 Q890 200 1010 150Z",
    deltaChannels: [
      "M1010 150 Q960 330 780 490",
      "M1010 150 Q1010 340 860 500",
      "M1010 150 Q1040 280 950 430"
    ],
    clayZones: [{ x: 865, y: 468, rx: 78, ry: 36 }, { x: 1032, y: 190, rx: 60, ry: 26 }],
    duneField: { x: 470, y: 565, rx: 125, ry: 62 },
    rockFields: [{ x: 718, y: 640, r: 46 }, { x: 920, y: 370, r: 30 }],
    steepZones: [
      "M1110 560 Q1170 600 1195 720 L1250 705 Q1225 590 1160 535Z",
      "M1090 120 Q1150 150 1180 230 L1240 210 Q1210 130 1140 100Z"
    ],
    labels: [
      { x: 420, y: 150, text: "Jezero crater rim" },
      { x: 760, y: 215, text: "Ancient river delta" },
      { x: 395, y: 660, text: "Dune field" }
    ]
  },

  missions: [
    {
      id: "delta-clay",
      name: "Sample the delta clay",
      goal: "Clay minerals form in water. A sample tells us how long Jezero's lake lasted.",
      difficulty: 2,
      target: { x: 865, y: 468, name: "Delta clay outcrop", dataNote: "CRISM shows clay minerals here" },
      routes: [
        {
          id: "safest",
          label: "Safest",
          note: "Avoids the rock field, gentle slope",
          color: "#3ECF6A",
          risk: 1,
          climb: 64,
          terrain: { bedrock: 55, gravel: 30, sand: 15 },
          profile: [0, 3, 8, 12, 15, 22, 30, 38, 45, 52, 58, 64],
          points: [[560, 760], [580, 680], [630, 600], [700, 552], [780, 505], [865, 468]],
          stops: [],
          events: [{ type: "dust", at: 0.55 }]
        },
        {
          id: "fastest",
          label: "Fastest",
          note: "Shorter, but crosses a rock field",
          color: "#4F8FF7",
          risk: 3,
          climb: 70,
          terrain: { bedrock: 40, gravel: 50, sand: 10 },
          profile: [0, 6, 14, 22, 30, 41, 50, 57, 63, 66, 68, 70],
          points: [[560, 760], [640, 700], [718, 640], [800, 548], [865, 468]],
          stops: [],
          events: [{ type: "rock", at: 0.36 }, { type: "dust", at: 0.7 }]
        },
        {
          id: "science",
          label: "Most science",
          note: "Detour via the dunes for a sand sample",
          color: "#B07CFF",
          risk: 2,
          climb: 66,
          terrain: { bedrock: 40, gravel: 25, sand: 35 },
          profile: [0, 2, 1, 4, 9, 16, 24, 33, 42, 51, 59, 66],
          points: [[560, 760], [505, 700], [470, 625], [478, 565], [560, 520], [680, 500], [780, 482], [865, 468]],
          stops: [{ at: 0.3, name: "Dune sand sample", points: 80, photo: "dunes", detail: "Wind blown sand shows how today's winds move material." }],
          events: [{ type: "dust", at: 0.62 }]
        }
      ],
      finalStop: { name: "Delta clay outcrop", points: 300, photo: "delta", detail: "Layered rock where an ancient river met the lake." }
    },
    {
      id: "crater-rim",
      name: "Survey the crater rim",
      goal: "The rim exposes rock older than the lake itself. Map its layers and bring back a sample.",
      difficulty: 3,
      target: { x: 1035, y: 185, name: "Crater rim outcrop", dataNote: "HiRISE shows exposed layers here" },
      routes: [
        {
          id: "safest",
          label: "Safest",
          note: "Long way round, never steeper than 12 degrees",
          color: "#3ECF6A",
          risk: 1,
          climb: 180,
          terrain: { bedrock: 60, gravel: 30, sand: 10 },
          profile: [0, 6, 14, 25, 38, 55, 76, 98, 122, 146, 166, 180],
          points: [[560, 760], [720, 732], [900, 682], [1010, 592], [1052, 470], [1062, 350], [1050, 250], [1035, 185]],
          stops: [],
          events: [{ type: "radiation", at: 0.5 }]
        },
        {
          id: "fastest",
          label: "Fastest",
          note: "Direct line across the delta and a rock field",
          color: "#4F8FF7",
          risk: 3,
          climb: 195,
          terrain: { bedrock: 45, gravel: 45, sand: 10 },
          profile: [0, 15, 32, 50, 68, 88, 108, 128, 150, 168, 184, 195],
          points: [[560, 760], [700, 622], [820, 482], [920, 370], [1035, 185]],
          stops: [],
          events: [{ type: "rock", at: 0.55 }, { type: "radiation", at: 0.75 }]
        },
        {
          id: "science",
          label: "Most science",
          note: "Passes the clay outcrop on the way up",
          color: "#B07CFF",
          risk: 2,
          climb: 186,
          terrain: { bedrock: 50, gravel: 35, sand: 15 },
          profile: [0, 8, 20, 34, 52, 64, 80, 104, 128, 152, 172, 186],
          points: [[560, 760], [630, 602], [780, 505], [865, 468], [955, 360], [1005, 262], [1035, 185]],
          stops: [{ at: 0.42, name: "Delta clay outcrop", points: 120, photo: "delta", detail: "A bonus clay sample on the way to the rim." }],
          events: [{ type: "radiation", at: 0.68 }]
        }
      ],
      finalStop: { name: "Crater rim outcrop", points: 450, photo: "rim", detail: "Rock layers older than the lake, lifted up by the impact." }
    },
    {
      id: "dune-field",
      name: "Study the dune field",
      goal: "Measure how today's wind moves sand, so future crews know where dust will build up.",
      difficulty: 1,
      target: { x: 440, y: 548, name: "Dune crest", dataNote: "HiRISE shows active ripples here" },
      routes: [
        {
          id: "safest",
          label: "Safest",
          note: "Stays on firm ground until the last stretch",
          color: "#3ECF6A",
          risk: 1,
          climb: 18,
          terrain: { bedrock: 60, gravel: 25, sand: 15 },
          profile: [0, 2, 4, 5, 7, 9, 10, 12, 14, 15, 17, 18],
          points: [[560, 760], [548, 690], [508, 620], [440, 548]],
          stops: [],
          events: []
        },
        {
          id: "fastest",
          label: "Fastest",
          note: "Cuts straight through soft sand",
          color: "#4F8FF7",
          risk: 2,
          climb: 22,
          terrain: { bedrock: 20, gravel: 20, sand: 60 },
          profile: [0, 3, 6, 8, 10, 12, 14, 16, 18, 19, 21, 22],
          points: [[560, 760], [486, 650], [440, 548]],
          stops: [],
          events: [{ type: "sand", at: 0.45 }]
        },
        {
          id: "science",
          label: "Most science",
          note: "Loops past fresh ripples for an extra reading",
          color: "#B07CFF",
          risk: 2,
          climb: 26,
          terrain: { bedrock: 35, gravel: 25, sand: 40 },
          profile: [0, 4, 8, 12, 15, 18, 20, 21, 22, 24, 25, 26],
          points: [[560, 760], [625, 668], [605, 586], [528, 520], [440, 548]],
          stops: [{ at: 0.62, name: "Fresh ripple field", points: 60, photo: "dunes", detail: "Young ripples show which way the wind blew this week." }],
          events: [{ type: "dust", at: 0.8 }]
        }
      ],
      finalStop: { name: "Dune crest", points: 150, photo: "dunes", detail: "Set up the wind sensor on the crest and collect a sand sample." }
    }
  ],

  // Events replay the kind of conditions NASA rovers have recorded.
  events: {
    dust: {
      title: "Dust storm incoming",
      kicker: "Conditions changed",
      text: "A dust front is moving toward your route. Visibility will drop before you can finish. What do you do?",
      countdown: "38:12",
      source: "Replays dust season conditions recorded by Perseverance (MEDA) and Curiosity (REMS) weather stations.",
      choices: [
        { id: "return", label: "Return to the habitat now", hint: "Known safe ground, the way you came. You keep samples already collected.", recommended: true, effect: { returnNow: true } },
        { id: "shelter", label: "Shelter and wait it out", hint: "Keeps the mission alive. Costs 15 % oxygen and 40 minutes.", effect: { o2: -15, minutes: 40 } }
      ]
    },
    radiation: {
      title: "Solar particle event",
      kicker: "Radiation alert",
      text: "The habitat reports a jump in high energy particles from the Sun. Terrain can block part of it.",
      countdown: "12:00",
      source: "Based on solar particle events measured on the surface by Curiosity's RAD instrument.",
      choices: [
        { id: "ridge", label: "Shelter behind the ridge", hint: "Waits out the peak. Costs 8 % oxygen and 30 minutes.", recommended: true, effect: { o2: -8, minutes: 30, dose: 0.02 } },
        { id: "push", label: "Keep walking", hint: "Saves time, but your dose rises sharply.", effect: { dose: 0.3 } }
      ]
    },
    rock: {
      title: "Rock field ahead",
      kicker: "Terrain",
      text: "Boulders block the direct line. They are visible in HiRISE imagery but harder to cross on foot.",
      countdown: null,
      source: "Boulder positions come from HiRISE orbital imagery.",
      choices: [
        { id: "around", label: "Go around", hint: "Adds 12 minutes and 4 % oxygen.", recommended: true, effect: { o2: -4, minutes: 12 } },
        { id: "through", label: "Climb through", hint: "Hard work in a suit. Costs 9 % oxygen and risks a suit tear.", effect: { o2: -9, minutes: 4, suit: -15 } }
      ]
    },
    sand: {
      title: "Soft sand ahead",
      kicker: "Terrain",
      text: "Thermal data shows loose sand here. Each step sinks and costs more energy.",
      countdown: null,
      source: "Loose sand vs bedrock is mapped from THEMIS thermal data (Mars Odyssey).",
      choices: [
        { id: "detour", label: "Detour on firm ground", hint: "Adds 10 minutes and 3 % oxygen.", recommended: true, effect: { o2: -3, minutes: 10 } },
        { id: "push", label: "Push through", hint: "Costs 8 % oxygen and drains suit power.", effect: { o2: -8, minutes: 6, suit: -10 } }
      ]
    }
  }
};
