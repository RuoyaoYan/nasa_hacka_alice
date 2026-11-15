/*
 * Measured weather at Jezero for the weather panel and the dust event.
 *
 * 1) meda: Perseverance MEDA daily summary, copied from NASA's public feed
 *    https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json
 *    The game tries the live feed first and uses this copy if the browser
 *    cannot reach it. Refresh the copy with: python3 tools/weather/snapshot_meda.py
 *    Temperatures °C, pressure Pa, sunrise and sunset in local mean solar time.
 *    "--" means MEDA reported no value that sol.
 *
 * 2) dust: column dust optical depth (9.3 µm absorption, normalised to 610 Pa)
 *    for the Jezero cell (19.5° N, 78° E) in 10° Ls bins, averaged over Mars
 *    Years 24 to 36, and the highest year in each bin. Derived from Montabone et
 *    al. 2015 (Icarus 251, 65-95) and 2020 (JGR Planets, doi:10.1029/2019JE006111)
 *    dust climatology, CC BY-SA 3.0. Visible opacity is about 2.6 times larger.
 */
(() => {
  window.MOMOOT_WEATHER = {
    meda: {
      feed: "https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json",
      copied: "2026-11-15",
      sols: [
        {"terrestrial_date": "2024-04-21", "sol": "1127", "ls": "240.202", "season": "late autumn", "min_temp": "--", "max_temp": "--", "pressure": "--", "sunrise": "06:13:15", "sunset": "17:11:36"},
        {"terrestrial_date": "2024-04-22", "sol": "1128", "ls": "240.852", "season": "late autumn", "min_temp": "--", "max_temp": "--", "pressure": "--", "sunrise": "06:14:03", "sunset": "17:11:57"},
        {"terrestrial_date": "2024-04-23", "sol": "1129", "ls": "241.503", "season": "late autumn", "min_temp": "--", "max_temp": "--", "pressure": 774.0, "sunrise": "06:14:52", "sunset": "17:12:18"},
        {"terrestrial_date": "2024-04-24", "sol": "1130", "ls": "242.153", "season": "late autumn", "min_temp": -77.3, "max_temp": -23.2, "pressure": 777.1, "sunrise": "06:15:41", "sunset": "17:12:41"},
        {"terrestrial_date": "2024-04-25", "sol": "1131", "ls": "242.804", "season": "late autumn", "min_temp": -79.2, "max_temp": -17.0, "pressure": 774.9, "sunrise": "06:16:29", "sunset": "17:13:03"},
        {"terrestrial_date": "2024-04-26", "sol": "1132", "ls": "243.455", "season": "late autumn", "min_temp": -77.9, "max_temp": -23.4, "pressure": 774.1, "sunrise": "06:17:18", "sunset": "17:13:27"},
        {"terrestrial_date": "2024-04-27", "sol": "1133", "ls": "244.106", "season": "late autumn", "min_temp": -79.3, "max_temp": -24.7, "pressure": 778.9, "sunrise": "06:18:07", "sunset": "17:13:51"}
      ]
    },
    dust: {
      source: "Montabone et al. dust climatology, Mars Years 24 to 36, Jezero cell 19.5° N 78° E (CC BY-SA 3.0)",
      binDeg: 10,
      mean: [0.151, 0.127, 0.109, 0.097, 0.094, 0.085, 0.083, 0.078, 0.078, 0.086, 0.099, 0.102, 0.103, 0.1, 0.131, 0.139, 0.146, 0.16, 0.187, 0.29, 0.364, 0.413, 0.433, 0.398, 0.361, 0.319, 0.287, 0.263, 0.235, 0.217, 0.192, 0.246, 0.305, 0.292, 0.245, 0.198],
      max: [0.177, 0.149, 0.129, 0.134, 0.153, 0.102, 0.106, 0.107, 0.103, 0.107, 0.114, 0.121, 0.124, 0.149, 0.274, 0.267, 0.248, 0.243, 0.283, 0.869, 1.285, 1.27, 1.139, 0.914, 0.697, 0.516, 0.413, 0.455, 0.509, 0.553, 0.404, 0.417, 0.573, 0.419, 0.302, 0.243],
      maxYear: [35, 34, 34, 35, 35, 35, 35, 33, 33, 34, 29, 29, 29, 27, 29, 29, 36, 29, 34, 34, 34, 25, 25, 25, 25, 25, 25, 28, 28, 28, 28, 28, 34, 34, 34, 36]
    }
  };
})();
