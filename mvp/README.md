# HemoArrive — MVP (simulation build)

A hospital that needs blood finds the nearest hospital or blood bank that has it, gets the units
approved, and tracks the delivery live until it is received and reported. Everything runs in the
browser on a **simulated Jaipur network** (30 fictional hospitals, synthetic stock), so it can be
demoed with no backend.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests: compatibility, scoring, re-route rule, full loop, twin-sim invariants
npm run build
```

Optional: put a free MapTiler key in `.env.local` as `VITE_MAPTILER_KEY=...`. Without it the map
uses openstreetmap.org tiles, which is fine for a local demo but not for real app traffic.

## What's in the app

| Tab | What it shows |
| --- | --- |
| **Live request** | The 9-step flow: ask (one or several patients) → alert (10 → 25 → 50 km) → 2.5-min matching window → suggested supply plan the receiver can edit (a patient's units can be split across hospitals; substitutes only with doctor confirmation) → each hospital approves/declines its share → drivers dispatched → several vehicles tracked live → confirm → a delivery report per hospital. "Other hospitals requesting now: Off / Normal / Busy" simulates competing demand: if a bank's stock is taken first, that share fails and the plan suggests the next bank. Shortfalls are shown plainly. Breakdown / heavy-traffic buttons trigger the re-route rule. Six one-click auto demos. |
| **Hospitals & stock** | Dashboard summary (units by group, expiring in 72 h), per-hospital stock lots, admin "Verify licence". |
| **Performance** | Hospital Performance Score (credit points, 0–100) over the last 90 days: leaderboard, Gold/Silver/Watch/Review bands, per-metric scorecard, red flags, receiver card, and "Appeal" on any event. The band replaces the fixed hospital tier as the 10% term in option ranking, and shows as a badge on option cards. |
| **Planning** | Data for planning: where blood is needed, for which conditions (ICD-10 mapped), and where requests go unmet — map, zone table, weekly trend, early warnings, rule-based suggestions (storage centre, donation camp, apheresis, thalassaemia day-care), CSV area report. Aggregated only; counts under 5 shown as "<5". |
| **Smart vs Nearest** | BloodStock twin simulation: the same seeded 3-day event stream played with a nearest-available planner and with HemoArrive, 1/10/30 seeds, with 95% intervals. |

Use the speed buttons (⏸ 1× 10× 30× 60×) to control simulated time.

## Rules implemented (from the docs)

- **Matching:** `score = 0.6·ETA/ETAmax + 0.2·(1 − offered/needed) + 0.1·expiryRank + 0.1·tier` (lower is better), top 5 shown. Exact group by default; compatible substitutes listed separately and never auto-applied.
- **Arrival margin:** a lot is offered only if it still has ≥ 24 h (red cells, plasma, whole blood) or ≥ 6 h (platelets) of life left on arrival.
- **Re-route rule:** on breakdown, or an ETA slip > 10 min — travelled < 50% → Case 1 (fresh units near the receiver); ≥ 50% → Case 2 (keep the units on the road: hand-off / continue). If the other option is ≥ 3 min faster, it wins. Every decision is explained on screen and logged.
- **Sender timeout** 5 min; decline returns the receiver to the option list.
- No patient data; reason is a category only.

## Code map

```
src/core/      pure TypeScript, no UI — this is what moves to apps/worker + packages/shared later
  blood.ts       groups, components, shelf life, compatibility table
  city.ts        30 fictional Jaipur organisations, drivers, seeded inventory
  matching.ts    find_suppliers, offers, scoring, nearest-available comparison
  reroute.ts     Case 1 / Case 2 decision
  engine.ts      simulated clock + worker jobs (broadcast, closeWindow, senderTimeout, etaWatch, reroute) + autopilot
  twin.ts        Smart vs Nearest twin simulation
  conditions.ts  request conditions mapped to ICD-10 blocks
  history.ts     90 days of seeded network history (two deliberately poor hospitals); live requests append to it
  performance.ts Hospital Performance Score: scorecard, bands, red flags
  planning.ts    area aggregation, early warnings, suggestions, small-count suppression, CSV report
src/ui/        React screens (Leaflet map)
```

## Not in this build (next steps toward the architecture doc)

Supabase (Postgres + PostGIS, Auth/RLS, Realtime, Storage), Redis/BullMQ worker, real routing
(OpenRouteService), push/SMS/email, driver PWA with real GPS, multi-user logins. The `src/core`
logic is written so it can be lifted into the worker and shared package unchanged.
