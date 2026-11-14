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
    landing:    [18.4446, 77.4509], // Octavia E. Butler Landing, exact (NASA/JPL, Wikipedia)
    seitah:     [18.4262, 77.4208],
    seitahWest: [18.4292, 77.4098],
    kodiak:     [18.4318, 77.3905],
    threeForks: [18.4522, 77.4012],
    hawksbill:  [18.4642, 77.3992],
    enchanted:  [18.4598, 77.3918],
    upperFan:   [18.4740, 77.3900],
    isoHill:    [18.4752, 77.3648],
    belva:      [18.4800, 77.3800], // Belva crater centre, 0.9 km wide (USGS Gazetteer of Planetary Nomenclature)
    fanLobe:    [18.4968, 77.3528],
    neretva:    [18.4985, 77.3365],
    rimSlope:   [18.4602, 77.3168],
    lookout:    [18.4705, 77.3018],
    rimSouth:   [18.4545, 77.3052],
    // sightseeing viewpoints
    belvaRim:   [18.4800, 77.3718], // Echo Creek, on Belva's west rim (where the sol 772 mosaic was taken)
    kodiakView: [18.4338, 77.4002],
    seitahSouth:[18.4120, 77.4195],
    neretvaView:[18.5085, 77.3455],
    rimSkyline: [18.4285, 77.3555],
    // other landing sites
    forksPlain: [18.4488, 77.4085],
    fanCamp:    [18.4875, 77.3925],
    floorSouth: [18.3985, 77.4380]
  };

  const sample = "sample", photo = "photo", measure = "measure", sightsee = "sightsee";

  window.MOMOOT_DATA = {
    sol: 23,
    site: "Jezero crater",
    conditions: { dust: "Low", tempC: -38, radiation: "Normal" },
    places: P,
    habitat: { pos: P.habitat, name: "Habitat" },
    // Where the crew landed: the habitat, start and end of every tour
    landingSites: [
      { id: "butler", pos: P.habitat, name: "Octavia E. Butler Landing", note: "Perseverance's real landing site. Flat crater floor, close to Séítah and the delta front." },
      { id: "forks", pos: P.forksPlain, name: "Three Forks plain", note: "Beside the sample depot at the foot of the delta. Short drives to Hawksbill Gap." },
      { id: "fan", pos: P.fanCamp, name: "Upper fan camp", note: "On top of the delta. Belva crater and the rim are close, the crater floor is far." },
      { id: "south", pos: P.floorSouth, name: "Southern crater floor", note: "Open plains south of Séítah. Long, flat drives to everything." }
    ],
    // ~14 x 17 km of Jezero: crater floor, Séítah, the delta, Belva and the western rim
    planArea: [[18.350, 77.240], [18.575, 77.545]],

    landmarks: [
      { pos: P.landing, name: "Octavia E. Butler Landing", note: "Perseverance landing site, 2021" }
    ],

    // Hazards for the cost map (approximate, for gameplay)
    hazards: {
      sand: [
        { pos: [18.4262, 77.4185], rx: 1.5, ry: 0.75 },   // Séítah ripple field
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
      safest:  { label: "Safest", note: "Avoids slopes over 12° and every boulder field", color: "#2E9E52", maxSlope: 12, steep: 6, sand: 4, rock: Infinity, bonus: false },
      fastest: { label: "Fastest", note: "Shortest distance, accepts sand, rocks and steeper ground", color: "#2F6FD6", maxSlope: 25, steep: 0.4, sand: 0.3, rock: 0.6, bonus: false },
      easiest: { label: "Easiest", note: "Least climbing and soft sand, even if a little longer", color: "#8A4FE0", maxSlope: 9, steep: 14, sand: 9, rock: Infinity, bonus: false }
    },

    // Every task the crew can pick today. "points" is an internal priority weight
    // (shown as High, Medium or Low priority); the highest picked task becomes the main task.
    // Every task the crew can pick today. "today: true" marks the five everyday
    // choices shown first; the others sit farther out.
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
      { id: "lh", pos: P.lookout, type: sample, name: "Rim rock at Lookout Hill", points: 600, minutes: 60, detail: "Ancient crust lifted by the impact, with views out over Nili Planum." },
      { id: "rs", pos: P.rimSlope, type: measure, name: "Radiation on the rim slope", points: 80, minutes: 30, detail: "Compare the dose on open slopes with the crater floor." },
      { id: "sr", pos: P.rimSouth, type: sample, name: "Southern rim outcrop", points: 100, minutes: 35, detail: "Altered rock that may record ancient hot springs." },
      // Sightseeing: drive to a viewpoint, take photos, and leave them for the next crew
      { id: "vb", pos: P.belvaRim, type: sightsee, group: "sight", name: "Belva crater panorama", points: 90, minutes: 25, detail: "Stand on Echo Creek, where Perseverance took its 152 image mosaic, and look across the 900 m crater." },
      { id: "vk", pos: P.kodiakView, type: sightsee, group: "sight", name: "Kodiak at sunrise", points: 60, minutes: 20, detail: "Early light picks out the layers in the butte. Photograph it before the shadows go." },
      { id: "vs", pos: P.seitahSouth, type: sightsee, group: "sight", name: "South Séítah ridges", points: 70, minutes: 20, detail: "Rocky ridges rising out of the dunes, some of the oldest rock in the crater." },
      { id: "vn", pos: P.neretvaView, type: sightsee, group: "sight", name: "Neretva Vallis overlook", points: 110, minutes: 30, detail: "Look down the dry river channel that once filled Jezero's lake." },
      { id: "vr", pos: P.rimSkyline, type: sightsee, group: "sight", name: "Jezero rim skyline", points: 50, minutes: 15, detail: "The whole western rim in one frame, 300 m high and 20 km long." }
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
      rs: { pia: "PIA26373", url: "photojournal/pia/pia26/pia26373/PIA26373.jpg", caption: "The climb up Jezero's rim, Mastcam-Z, sol 1233" },
      vb: { pia: "PIA25889", url: "mars/resources/detail_files/2/7/27471_PIA25889-web.jpg", caption: "Belva crater from Echo Creek, Mastcam-Z, sol 772" },
      vk: { pia: "PIA24802", url: "mars/resources/detail_files/2/6/26413_Sol0057_zcam08103_Z110_R0E_web.jpg", caption: "Kodiak butte, Mastcam-Z, sol 57" },
      vs: { pia: "PIA24816", url: "mars/internal_resources/1155.jpeg", caption: "South Séítah ridges, Mastcam-Z, sol 210" },
      vn: { pia: "PIA26335", url: "photojournal/pia/pia26/pia26335/PIA26335.jpg", caption: "Looking down Neretva Vallis, Mastcam-Z, sol 1152" },
      vr: { pia: "PIA24264", url: "mars/resources/detail_files/2/5/25643_PIA24264-Panorama_supplement-crater-rim.jpg", caption: "Jezero's rim from the crater floor, Mastcam-Z, sol 2" },
      sr: { pia: "PIA24264", url: "mars/resources/detail_files/2/5/25643_PIA24264-Panorama_supplement-crater-rim.jpg", caption: "Jezero crater rim, Mastcam-Z, sol 2" }
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
