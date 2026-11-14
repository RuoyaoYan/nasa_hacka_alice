# Momoot (Komoot for Mars)

*NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map*

## Idea

A desktop game-style route planner for astronauts on Mars. Each sol (Mars day), you pick a science mission, choose a route, and walk it. Like Komoot, the app suggests several routes with an elevation profile, terrain mix and duration. Every route is built from real NASA data. During the walk, real conditions such as dust storms or radiation spikes force you to adapt, and the app helps you reroute safely.

## How it works

1. **Pick a mission:** e.g. "Sample the delta clay, because clay forms in water."
2. **Choose a route:** *Safest*, *Fastest* or *Most science*, each with distance, time, climb, oxygen use and risk.
3. **Walk it:** track oxygen, suit power and radiation, and see a real rover photo at each stop.
4. **React:** an event hits, and you choose between rerouting, sheltering or returning to base.

## NASA data we use

| Feature | Data |
|---|---|
| Map | HiRISE imagery via Mars Trek |
| Elevation and slope | HiRISE elevation model |
| Terrain type | THEMIS thermal data |
| Science targets | CRISM mineral maps |
| Stop photos | Perseverance Raw Images |
| Events | Rover weather (MEDA, REMS) and radiation (RAD) data |

## Scope for the hackathon

One location (Jezero crater), 3 missions, 3 pre-computed routes each, and 3–4 event types (dust, radiation, cold, blocked path). It's a web app built on Mars Trek map tiles.

## Why it fits the challenge

It is a layered, route-focused map for a Marswalk. It uses more than three NASA data types, puts astronaut safety first, and adds a playable demo that judges can try themselves.
