/*
 * Momoot game data · Jezero crater, Mars.
 *
 * Positions are [latitude, longitude] in degrees (planetocentric, east
 * positive), the same system NASA Mars Trek uses.
 *
 * Tours are driven in the crew's pressurised rover, with walking EVAs at each
 * stop. Routes are drawn through hand placed control points and smoothed into
 * natural curves by app.js. Landmark positions are approximate: press D in the
 * game, click on the HiRISE imagery, and paste the logged [lat, lon] points
 * here to refine them.
 *
 * Game rules (not real mission figures, see README):
 *   rover speed  : 6 km/h on firm ground, slower on sand
 *   life support : 2 % per km, plus 1 % per 20 m climbed, plus 2 % per stop
 */
(() => {
  // Named places (approximate unless noted)
  const P = {
    habitat:  [18.4385, 77.4462],
    landing:  [18.4447, 77.4508], // Octavia E. Butler Landing, Perseverance landing site (real)
    seitah:   [18.4262, 77.4208],
    kodiak:   [18.4318, 77.3905],
    threeForks: [18.4522, 77.4012],
    hawksbill:  [18.4642, 77.3992],
    enchanted:  [18.4598, 77.3918],
    belva:    [18.4905, 77.3702],
    neretva:  [18.4985, 77.3365],
    lookout:  [18.4705, 77.3018]
  };

  window.MOMOOT_DATA = {
    sol: 23,
    site: "Jezero crater",
    conditions: { dust: "Low", tempC: -38, radiation: "Normal" },
    habitat: { pos: P.habitat, name: "Habitat" },

    landmarks: [
      { pos: P.landing, name: "Octavia E. Butler Landing", note: "Perseverance landing site, 2021" }
    ],

    missions: [
      {
        id: "delta-front",
        name: "Delta front loop",
        goal: "Drive to the foot of the ancient river delta and sample clay rich layers. Clay forms in water, so it tells us how long Jezero's lake lasted.",
        difficulty: 1,
        target: { pos: P.hawksbill, name: "Hawksbill Gap", dataNote: "CRISM shows clay minerals here" },
        finalStop: { name: "Hawksbill Gap", points: 300, photo: "delta", detail: "Layered rock where an ancient river met the lake." },
        routes: [
          {
            id: "safest", label: "Safest", note: "Loop on firm crater floor, back past the sample depot", color: "#2E9E52", risk: 1, climb: 62,
            terrain: { bedrock: 55, gravel: 35, sand: 10 },
            points: [P.habitat, [18.4428, 77.4392], [18.4476, 77.4335], [18.4508, 77.4248], [18.4566, 77.4196], [18.4597, 77.4105], [18.4628, 77.4052], P.hawksbill,
                     [18.4601, 77.3968], [18.4557, 77.3985], P.threeForks, [18.4486, 77.4062], [18.4452, 77.4148], [18.4415, 77.4206], [18.4392, 77.4302], [18.4370, 77.4385], P.habitat],
            stops: [{ pos: P.threeForks, name: "Three Forks sample depot", points: 60, photo: "rim", detail: "Check on the ten sealed tubes Perseverance left here in 2022 and 2023." }],
            events: [{ type: "dust", at: 0.62 }]
          },
          {
            id: "fastest", label: "Fastest", note: "Straight out and back, crosses a boulder field", color: "#2F6FD6", risk: 3, climb: 58,
            terrain: { bedrock: 40, gravel: 50, sand: 10 },
            points: [P.habitat, [18.4446, 77.4372], [18.4498, 77.4268], [18.4549, 77.4172], [18.4602, 77.4074], P.hawksbill,
                     [18.4614, 77.4060], [18.4562, 77.4178], [18.4508, 77.4280], [18.4452, 77.4388], P.habitat],
            stops: [],
            events: [{ type: "rock", at: 0.3 }, { type: "dust", at: 0.6 }]
          },
          {
            id: "science", label: "Most science", note: "Through Séítah's ripples and past Kodiak butte", color: "#8A4FE0", risk: 2, climb: 74,
            terrain: { bedrock: 40, gravel: 25, sand: 35 },
            points: [P.habitat, [18.4342, 77.4395], [18.4290, 77.4318], P.seitah, [18.4255, 77.4105], [18.4282, 77.4002], P.kodiak, [18.4392, 77.3884],
                     [18.4488, 77.3902], P.enchanted, P.hawksbill, [18.4596, 77.4082], [18.4532, 77.4176], [18.4478, 77.4280], [18.4428, 77.4372], P.habitat],
            stops: [
              { pos: P.seitah, name: "Séítah sand ripples", points: 80, photo: "dunes", detail: "Wind blown sand shows how today's winds move material." },
              { pos: P.kodiak, name: "Kodiak butte", points: 90, photo: "rim", detail: "A flat topped remnant of the delta, with layers you can read like a book." }
            ],
            events: [{ type: "sand", at: 0.18 }, { type: "dust", at: 0.78 }]
          }
        ]
      },
      {
        id: "belva",
        name: "Climb to Belva crater",
        goal: "Drive up onto the delta's upper fan to Belva crater, where an impact exposed layers deposited by the ancient river.",
        difficulty: 2,
        target: { pos: P.belva, name: "Belva crater rim", dataNote: "HiRISE shows exposed delta layers" },
        finalStop: { name: "Belva crater rim", points: 450, photo: "rim", detail: "Look down into the crater and sample the river laid layers in its wall." },
        routes: [
          {
            id: "safest", label: "Safest", note: "Up the gentle valley at Hawksbill Gap, down the same way", color: "#2E9E52", risk: 1, climb: 128,
            terrain: { bedrock: 50, gravel: 40, sand: 10 },
            points: [P.habitat, [18.4436, 77.4385], [18.4502, 77.4262], [18.4572, 77.4160], [18.4624, 77.4062], P.hawksbill, [18.4702, 77.3940], [18.4762, 77.3872],
                     [18.4822, 77.3820], [18.4868, 77.3752], P.belva, [18.4872, 77.3690], [18.4808, 77.3742], [18.4742, 77.3820], [18.4688, 77.3902], [18.4652, 77.3980],
                     [18.4600, 77.4090], [18.4540, 77.4190], [18.4478, 77.4300], [18.4418, 77.4402], P.habitat],
            stops: [{ pos: P.hawksbill, name: "Hawksbill Gap", points: 80, photo: "delta", detail: "The valley where Perseverance first drove up onto the delta." }],
            events: [{ type: "radiation", at: 0.4 }]
          },
          {
            id: "fastest", label: "Fastest", note: "Direct climb across the fan, steep and rocky", color: "#2F6FD6", risk: 3, climb: 136,
            terrain: { bedrock: 45, gravel: 45, sand: 10 },
            points: [P.habitat, [18.4472, 77.4318], [18.4560, 77.4182], [18.4652, 77.4052], [18.4742, 77.3922], [18.4822, 77.3806], P.belva,
                     [18.4830, 77.3790], [18.4748, 77.3910], [18.4660, 77.4040], [18.4568, 77.4170], [18.4478, 77.4300], P.habitat],
            stops: [],
            events: [{ type: "rock", at: 0.28 }, { type: "radiation", at: 0.46 }]
          },
          {
            id: "science", label: "Most science", note: "Via the sample depot and Enchanted Lake outcrop", color: "#8A4FE0", risk: 2, climb: 140,
            terrain: { bedrock: 50, gravel: 35, sand: 15 },
            points: [P.habitat, P.landing, [18.4492, 77.4422], [18.4512, 77.4300], [18.4515, 77.4160], [18.4520, 77.4070], P.threeForks, [18.4560, 77.3940], P.enchanted,
                     [18.4662, 77.3880], [18.4752, 77.3822], [18.4842, 77.3760], P.belva, [18.4850, 77.3780], [18.4770, 77.3860], [18.4690, 77.3950], P.hawksbill,
                     [18.4600, 77.4100], [18.4520, 77.4230], [18.4450, 77.4350], P.habitat],
            stops: [
              { pos: P.landing, name: "Octavia E. Butler Landing", points: 60, photo: "rim", detail: "Where Perseverance touched down in 2021." },
              { pos: P.threeForks, name: "Three Forks sample depot", points: 60, photo: "rim", detail: "Ten sealed sample tubes, cached for a future return to Earth." },
              { pos: P.enchanted, name: "Enchanted Lake", points: 90, photo: "delta", detail: "Where Perseverance got its first close look at sedimentary rocks." }
            ],
            events: [{ type: "radiation", at: 0.55 }]
          }
        ]
      },
      {
        id: "rim",
        name: "Crater rim expedition",
        goal: "A full day traverse to Jezero's western rim. The rim exposes rock from deep inside Mars, thrown up by the impact 3.9 billion years ago.",
        difficulty: 3,
        target: { pos: P.lookout, name: "Lookout Hill", dataNote: "Rim summit, views beyond Jezero" },
        finalStop: { name: "Lookout Hill", points: 600, photo: "rim", detail: "Sample the ancient rim rock and look out over Nili Planum." },
        routes: [
          {
            id: "safest", label: "Safest", note: "South around Séítah, back down Neretva Vallis", color: "#2E9E52", risk: 2, climb: 410,
            terrain: { bedrock: 50, gravel: 35, sand: 15 },
            points: [P.habitat, [18.4340, 77.4390], P.seitah, [18.4250, 77.4060], P.kodiak, [18.4352, 77.3742], [18.4402, 77.3580], [18.4452, 77.3420], [18.4532, 77.3262],
                     [18.4622, 77.3120], P.lookout, [18.4792, 77.3060], [18.4882, 77.3160], P.neretva, [18.4958, 77.3502], P.belva, [18.4822, 77.3820], [18.4712, 77.3930],
                     P.hawksbill, [18.4600, 77.4090], [18.4530, 77.4200], [18.4462, 77.4320], P.habitat],
            stops: [
              { pos: P.kodiak, name: "Kodiak butte", points: 90, photo: "rim", detail: "A last remnant of the delta, standing alone on the crater floor." },
              { pos: P.neretva, name: "Neretva Vallis", points: 120, photo: "delta", detail: "The old river channel that once filled Jezero's lake." }
            ],
            events: [{ type: "sand", at: 0.08 }, { type: "radiation", at: 0.38 }, { type: "dust", at: 0.72 }]
          },
          {
            id: "fastest", label: "Fastest", note: "Straight west and back, long steep climb", color: "#2F6FD6", risk: 3, climb: 430,
            terrain: { bedrock: 45, gravel: 40, sand: 15 },
            points: [P.habitat, [18.4420, 77.4260], [18.4462, 77.4050], [18.4520, 77.3820], [18.4592, 77.3580], [18.4652, 77.3340], [18.4692, 77.3140], P.lookout,
                     [18.4718, 77.3060], [18.4672, 77.3300], [18.4612, 77.3560], [18.4540, 77.3810], [18.4478, 77.4060], [18.4430, 77.4280], P.habitat],
            stops: [],
            events: [{ type: "rock", at: 0.18 }, { type: "radiation", at: 0.4 }, { type: "dust", at: 0.6 }]
          },
          {
            id: "science", label: "Most science", note: "Out via the upper fan and Belva, back past Kodiak", color: "#8A4FE0", risk: 3, climb: 460,
            terrain: { bedrock: 45, gravel: 35, sand: 20 },
            points: [P.habitat, [18.4452, 77.4352], [18.4540, 77.4200], P.hawksbill, [18.4740, 77.3880], P.belva, [18.4960, 77.3540], P.neretva, [18.4892, 77.3200],
                     [18.4802, 77.3070], P.lookout, [18.4582, 77.3150], [18.4482, 77.3352], [18.4402, 77.3600], P.kodiak, [18.4270, 77.4040], P.seitah, [18.4322, 77.4352], P.habitat],
            stops: [
              { pos: P.belva, name: "Belva crater", points: 120, photo: "rim", detail: "Delta layers exposed in the crater wall." },
              { pos: P.neretva, name: "Neretva Vallis", points: 120, photo: "delta", detail: "The inlet channel where the river entered the lake." },
              { pos: P.kodiak, name: "Kodiak butte", points: 90, photo: "rim", detail: "A flat topped remnant of the delta." }
            ],
            events: [{ type: "radiation", at: 0.3 }, { type: "sand", at: 0.86 }]
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
        text: "Boulders block the direct line. They are visible in HiRISE imagery but too big for the rover's wheels.",
        countdown: null,
        source: "Boulder positions come from HiRISE orbital imagery (25 cm per pixel).",
        choices: [
          { id: "around", label: "Drive around", hint: "Adds 25 minutes and 3 % life support.", recommended: true, effect: { o2: -3, minutes: 25 } },
          { id: "through", label: "Pick a way through", hint: "Faster, but risks a wheel. Costs 5 % life support and 20 % rover power.", effect: { o2: -5, minutes: 10, suit: -20 } }
        ]
      },
      sand: {
        title: "Soft sand ahead", kicker: "Terrain",
        text: "Thermal data shows loose sand here. The rover could bog down, the way Spirit got stuck in 2009.",
        countdown: null,
        source: "Loose sand vs bedrock is mapped from THEMIS thermal data (Mars Odyssey).",
        choices: [
          { id: "detour", label: "Detour on firm ground", hint: "Adds 20 minutes and 2 % life support.", recommended: true, effect: { o2: -2, minutes: 20 } },
          { id: "push", label: "Push through", hint: "Costs 6 % life support and 15 % rover power.", effect: { o2: -6, minutes: 10, suit: -15 } }
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

    traverseUrl: "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json"
  };
})();
