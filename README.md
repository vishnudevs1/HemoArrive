# HemoArrive 🩸

> **Blood that can actually reach the patient in time.**
> HemoArrive finds blood across nearby hospitals and blood banks, splits a request across several
> of them when one isn't enough, tracks every unit to the bedside, and turns every request into
> data that helps plan the region's blood supply.

![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet&logoColor=white)
![Tests](https://img.shields.io/badge/tests-37%20passing-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Table of contents

- [The problem](#the-problem)
- [What HemoArrive does](#what-hemoarrive-does)
- [Quick start](#quick-start)
- [App tour](#app-tour)
- [Core rules](#core-rules)
- [Project structure](#project-structure)
- [Tech stack](#tech-stack)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Disclaimer](#disclaimer)
- [License](#license)

---

## The problem

Sometimes hospital needs blood now but they don't have stock of that specific Blood Group needed. Its own fridge is short, so the blood bank officer starts phoning around:
one bank doesn't answer, another already promised its units to someone else, a third has the blood
but the bag expires before the van can get there.

Often the blood **does exist** in hospitals a few kilometres away. What's missing is a way to
**find it, reserve it, and move it in time**. Existing portals show *how many* units a bank has.
They don't show *which unit can reach your patient before it expires, without being promised to
someone else*.

## What HemoArrive does

| | Feature | Why it matters |
| --- | --- | --- |
| 🔎 | **Life-at-arrival matching** | A unit is offered only if it still has enough shelf life when it *arrives*, not just when it's found. |
| 🧩 | **Split supply** | One request can be filled from several hospitals. The receiver can edit the suggested plan. |
| 🏁 | **Competing-demand handling** | If another hospital takes the stock first, that share fails cleanly and the next-best bank is suggested. |
| 🚑 | **Live multi-vehicle tracking** | Every vehicle is shown on the map with its ETA and a status timeline. |
| 🔀 | **Half-way re-route rule** | On a breakdown or delay, the system decides whether to send fresh units or keep the ones already on the road, and explains why. |
| 📊 | **Hospital Performance Score** | A 0–100 credit score (Gold / Silver / Watch / Review) based on how reliably each hospital responds and delivers. |
| 🗺️ | **Planning data** | Aggregated demand by area and condition (ICD-10), early warnings, and suggestions for storage centres and donation camps. |
| 📄 | **Delivery records** | A delivery report per hospital, downloadable as a PDF. |

### The flow

```
 Ask ──► Alert (10 → 25 → 50 km) ──► 2.5-min matching window ──► Suggested supply plan
                                                                          │
 Report ◄── Confirm received ◄── Live tracking / re-route ◄── Dispatch ◄── Approve / decline
```

## Quick start

The MVP is a **simulation build**. It runs entirely in the browser on a simulated Jaipur network
(30 fictional hospitals, synthetic stock), so you don't need a backend.

**Requirements:** Node.js 18+ and npm.

```bash
git clone https://github.com/vishnudevs1/HemoArrive.git
cd HemoArrive/mvp
npm install
npm run dev        # → http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run the unit tests (compatibility, scoring, re-route rule, full loop, twin simulation) |
| `npm run typecheck` | Type-check with `tsc` |
| `npm run build` | Type-check and build a production bundle into `dist/` |
| `npm run preview` | Serve the production build locally |

### Map tiles (optional)

If you don't set a key, the map uses openstreetmap.org tiles, which is fine for a local demo. For
anything beyond that, get a free [MapTiler](https://www.maptiler.com/) key:

```bash
cp .env.example .env.local
# then edit .env.local:
VITE_MAPTILER_KEY=your_maptiler_key_here
```

`.env.local` is git-ignored, so the key is never committed.

## App tour

| Tab | What it shows |
| --- | --- |
| **Live request** | The full 9-step flow for one or more patients. Includes competing-demand simulation (Off / Normal / Busy), breakdown and heavy-traffic buttons that trigger the re-route rule, and six one-click auto demos. |
| **Hospitals & stock** | Network dashboard (units by blood group, units expiring within 72 h), stock lots for each hospital, and an admin "Verify licence" action. |
| **Performance** | Hospital Performance Score over the last 90 days: leaderboard, bands, per-metric scorecard, red flags, and "Appeal" on any event. |
| **Planning** | Where blood is needed, for which conditions, and where requests go unmet: map, zone table, weekly trend, early warnings, suggestions, and a CSV area report. Counts under 5 show as "<5". |
| **Smart vs Nearest** | A twin simulation that plays the same seeded 3-day event stream through a nearest-available planner and through HemoArrive, over 1, 10 or 30 seeds, with 95% intervals. |

Use the speed controls (⏸ 1× 10× 30× 60×) to control simulated time.

## Core rules

- **Matching score** (lower is better; the top 5 are shown):

  ```
  score = 0.6 · ETA/ETAmax + 0.2 · (1 − offered/needed) + 0.1 · expiryRank + 0.1 · performanceBand
  ```

  Exact blood group by default. Compatible substitutes are listed separately and are never applied
  automatically; they need a doctor's confirmation.
- **Arrival margin:** a lot is offered only if it will still have **≥ 24 h** of life left on arrival
  (red cells, plasma, whole blood), or **≥ 6 h** for platelets.
- **Re-route rule:** triggered by a breakdown or an ETA slip of more than 10 min.
  - Less than 50% of the trip travelled → **Case 1**: send fresh units from near the receiver.
  - 50% or more travelled → **Case 2**: keep the units on the road (hand-off or continue).
  - If the other option is at least 3 min faster, it wins. Every decision is explained on screen and logged.
- **Sender timeout:** 5 min. A decline returns the receiver to the option list.
- **Privacy:** no patient data is stored. The reason for a request is recorded as a category only.

## Project structure

```
HemoArrive/
├── README.md                     ← you are here
├── HemoArrive — *.md             ← design, research and pitch documents (see below)
└── mvp/                          ← the runnable app
    ├── index.html
    ├── package.json
    ├── .env.example
    └── src/
        ├── main.tsx, App.tsx, styles.css
        ├── core/                 pure TypeScript, no UI; can move into a backend worker unchanged
        │   ├── blood.ts            blood groups, components, shelf life, compatibility table
        │   ├── city.ts             30 fictional Jaipur organisations, drivers, seeded inventory
        │   ├── matching.ts         finding suppliers, offers, scoring, nearest-available baseline
        │   ├── reroute.ts          Case 1 / Case 2 decision
        │   ├── engine.ts           simulated clock + jobs (broadcast, window close, timeouts, ETA watch, re-route)
        │   ├── twin.ts             Smart vs Nearest twin simulation
        │   ├── conditions.ts       request conditions mapped to ICD-10 blocks
        │   ├── history.ts          90 days of seeded network history
        │   ├── performance.ts      Hospital Performance Score
        │   ├── planning.ts         area aggregation, early warnings, suggestions, CSV report
        │   ├── geo.ts, rng.ts, types.ts
        │   └── core.test.ts        37 unit tests
        └── ui/                   React screens (Leaflet map, PDF records)
```

## Tech stack

**This MVP:** React 18, TypeScript, Vite, Leaflet (OpenStreetMap / MapTiler tiles), jsPDF, Vitest.

**Target production architecture** (see the architecture doc):

| Layer | Choice |
| --- | --- |
| Web app + driver PWA | Next.js + TypeScript + Tailwind |
| Database | Supabase Postgres + PostGIS |
| Auth & access | Supabase Auth + Row Level Security |
| Realtime | Supabase Realtime |
| Fast state & jobs | Upstash Redis + BullMQ worker |
| Routing & ETA | OpenRouteService / OSRM |
| Maps | MapLibre GL + OpenStreetMap |

## Documentation

| Document | What's inside |
| --- | --- |
| [Pitch](HemoArrive%20%E2%80%94%20Pitch.md) | The problem with sources, the solution, what's novel, and the demo script |
| [MVP Architecture](HemoArrive%20%E2%80%94%20MVP%20Architecture.md) | System design, request lifecycle, data model, matching and re-routing |
| [Tech Stack Documentation](HemoArrive%20%E2%80%94%20Tech%20Stack%20Documentation.md) | Each technology choice and the reason for it |
| [User Flow Documentation](HemoArrive%20%E2%80%94%20User%20Flow%20Documentation.md) | Roles, onboarding, and the receiver, sender and driver flows |
| [Mentor Feedback Research & Proposal](HemoArrive%20%E2%80%94%20Mentor%20Feedback%20Research%20%26%20Proposal.md) | How each piece of mentor feedback was researched and addressed |
| [BloodStock: MVP Research & Blueprint](BloodStock%20%E2%80%94%20MVP%20Research%20%26%20Blueprint%20%281%29.md) | Early research and blueprint (the project's earlier name) |
| [MVP README](mvp/README.md) | App-level notes for developers |

## Roadmap

Not in this build yet. These are the next steps toward the full architecture:

- [ ] Supabase backend (Postgres + PostGIS, Auth/RLS, Realtime, Storage)
- [ ] Redis/BullMQ worker for timed jobs
- [ ] Real road routing and ETAs (OpenRouteService)
- [ ] Push, SMS and email notifications
- [ ] Driver PWA with real GPS
- [ ] Multi-user logins per hospital

## Disclaimer

HemoArrive is a **prototype**. All hospitals, drivers, stock and history in the app are **fictional
and simulated**. It is not a medical device and must not be used for real clinical or transfusion
decisions.

## License

Released under the [MIT License](LICENSE). © 2026 Vishnu Kumar

---

<p align="center">Made by <a href="https://github.com/vishnudevs1">Vishnu Kumar</a></p>
