# HemoArrive — MVP Architecture

Oct 15, 2026 · @Vishnu Kumar

## Overview

HemoArrive lets a hospital that needs blood find the nearest hospital or blood bank that has it, get the units approved, and track the delivery live until it is received and reported. The MVP is a web app plus a driver PWA, backed by one Postgres database with geo search, a realtime layer, and a simulator that fakes hospitals, inventory and moving vehicles for demos.

**The flow from the notebook, as the system will run it:**

1. **Receiver raises a need** — blood group, component, units, reason, urgency. Their location comes from the hospital profile (GPS as fallback).
2. **Broadcast** — the request goes to every verified hospital within range that has matching stock.
3. **Matching window (2–3 min)** — responses are collected and ranked by ETA, expiry and units available.
4. **Receiver picks an option** from the dashboard (distance, units, expiry, ETA shown per option).
5. **Sender approves** the request (or declines, which drops the receiver back to the option list).
6. **Dispatch** — sender assigns a driver; units are reserved in inventory.
7. **Out for delivery** — fastest route computed; receiver sees live tracking, ETA, driver contact and a full map view.
8. **Worst case** — a breakdown, delay or cancellation triggers the re-route rule (see Matching and re-routing).
9. **Delivered** — status updated, receiver files the mandatory delivery report, request closes.

**Roles:** Receiver hospital staff · Sender hospital / blood bank staff · Driver · Platform admin (verifies hospitals) · Simulator (demo only).

## System architecture

&#91;embedded content: HemoArrive MVP architecture · 4 clients, 2 app services, 3 stores, worker, external APIs\]

Every client talks to one Next.js API and listens on Supabase Realtime; Postgres holds the truth, Redis holds what changes every few seconds, and the worker runs everything on a timer — the 2–3 min window, ETA checks and the re-route rule. Keeping timed logic out of the API means a slow routing call never blocks a hospital's screen.

## Request lifecycle

&#91;embedded content: Request lifecycle · 10 statuses, 3 exception loops\]

The worker owns every timed transition: it closes the 2–3 min window, expires an unanswered request after 5 min, and fires re-routing; people only move a request forward by acting. Model statuses as Postgres enums so an illegal jump (say, Delivered without Dispatched) fails in the database, not just the UI.

## Tech stack

One language end to end (TypeScript) and one managed backend (Supabase) so a small student team ships in weeks, not months. Everything here has a free tier good enough for an MVP and demo.

| Layer | Pick for MVP | Why | Swap later for |
| --- | --- | --- | --- |
| Hospital web app | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui | One codebase for dashboard, requests, inventory, admin | — |
| Driver app | PWA in the same Next.js repo | Browser Geolocation API is enough; no app-store delay | React Native / Expo |
| Maps (display) | MapLibre GL + OpenStreetMap tiles | Free, no per-load billing | Google Maps JS |
| Routing & ETA | OpenRouteService or OSRM (OSM) | Free directions + distance matrix | Google Routes API (live traffic) |
| Geocoding | Nominatim / OpenRouteService | Address → lat/lng at hospital signup | Google Geocoding |
| Database | Supabase Postgres + PostGIS | Geo queries (nearest hospital) in SQL | Self-hosted Postgres / Cloud SQL |
| Auth & access | Supabase Auth + Row Level Security | Phone/email login, per-hospital data isolation | — |
| Realtime | Supabase Realtime (Postgres changes + broadcast channels) | Live offers, status, driver location | Socket.IO on the worker |
| Fast state | Upstash Redis | Latest driver position, 2–3 min match timers, rate limits | — |
| Background jobs | Node worker (BullMQ on Redis) on Railway/Render | Broadcast fan-out, window close, ETA checks, re-route, expiry sweep | Cloud Run jobs |
| File storage | Supabase Storage (S3-compatible) | Delivery report photos, signatures, licence PDFs | S3 / GCS |
| Notifications | Firebase Cloud Messaging (web push) + SMS (MSG91 or Twilio) | Push for staff, SMS fallback for urgent requests | WhatsApp Business API |
| Email | Resend | Signup, verification, daily expiry digest | — |
| Hosting | Vercel (web) + Supabase cloud (pick an India region) + Railway/Render (worker) | Zero-ops deploys | GCP / AWS |
| Observability | Sentry (errors) + PostHog (product analytics) | Catch failures in the demo, see the funnel | — |
| Testing | Vitest + Playwright | Unit tests for matching, e2e for request → delivery | — |

SMS to Indian numbers needs DLT sender and template registration with your telecom operator before it works; start that in week 1 or rely on push for the demo.

## Data model

Ten Postgres tables cover the whole flow. Locations are PostGIS `geography(Point)` so "nearest hospital with stock" is one indexed query. No patient name or ID is stored in the MVP — `reason` is a category.

| Table | Key columns | Notes |
| --- | --- | --- |
| `organizations` | id, name, type (hospital / blood\_bank), licence\_no, location, address, phone, priority\_tier, verified | Verified by admin before it can send or receive |
| `users` | id, org\_id, role (admin / staff / driver), name, phone | Supabase Auth user + profile |
| `inventory_lots` | id, org\_id, blood\_group, component (WB / PRBC / FFP / PLT / Cryo), units, collected\_at, expires\_at, status (available / reserved / issued / expired) | One row per batch, so expiry is tracked per lot |
| `blood_requests` | id, requester\_org, blood\_group, component, units, reason, urgency, location, status, match\_deadline, selected\_offer\_id | `match_deadline` = created\_at + 2–3 min |
| `request_broadcasts` | request\_id, org\_id, distance\_m, radius\_m, notified\_at, seen\_at | Who was asked, and in which radius ring |
| `offers` | id, request\_id, supplier\_org, lot\_ids, units, nearest\_expiry, distance\_m, eta\_s, score, status (pending / selected / approved / declined / expired) | One per responding hospital |
| `deliveries` | id, request\_id, offer\_id, driver\_id, status, route\_polyline, planned\_distance\_m, travelled\_distance\_m, eta\_at, dispatched\_at, delivered\_at, parent\_delivery\_id | `parent_delivery_id` links a re-routed leg to the original |
| `location_pings` | delivery\_id, ts, point, speed, accuracy | Sampled every 5 s; live copy in Redis, history here |
| `delivery_events` | id, delivery\_id, type, actor\_id, ts, payload (jsonb) | Append-only timeline: dispatched, delayed, incident, rerouted, delivered |
| `delivery_reports` | delivery\_id, received\_by, units\_received, bag\_numbers, temp\_on\_arrival, condition, photo\_url, signature\_url, notes | The mandatory report; request cannot close without it |

**Indexes:** GiST on `organizations.location` and `location_pings.point`; `inventory_lots (blood_group, component, status, expires_at)`; `offers (request_id, score)`; `deliveries (status)`.

**Database functions (SQL / RPC):** `find_suppliers(lat, lng, group, component, units, radius_m)` returns hospitals with enough non-expiring stock, nearest first; `reserve_lots(offer_id)` locks lots in one transaction so two requests can never take the same units.

## API design

REST for actions, realtime channels for anything that changes on screen, and a handful of third-party APIs. All routes live under `/api/v1` as Next.js route handlers; heavy or timed work is pushed to the worker queue.

**REST endpoints**

| Method | Path | Who | Does |
| --- | --- | --- | --- |
| POST | `/orgs` | Hospital admin | Register hospital, upload licence |
| PATCH | `/admin/orgs/:id/verify` | Platform admin | Approve hospital |
| GET / POST / PATCH | `/inventory` | Staff | List, add, update lots |
| POST | `/requests` | Receiver | Create need → starts broadcast + 2–3 min timer |
| GET | `/requests/:id` | Receiver / sender | Status, options, timeline |
| GET | `/requests/:id/offers` | Receiver | Ranked options |
| POST | `/requests/:id/offers` | Sender | Respond with units available |
| POST | `/requests/:id/select` | Receiver | Pick an offer → sends request to that sender |
| POST | `/offers/:id/approve` · `/decline` | Sender | Accept or refuse |
| POST | `/deliveries/:id/dispatch` | Sender | Assign driver, reserve lots, compute route |
| POST | `/deliveries/:id/location` | Driver | GPS ping every 5 s |
| POST | `/deliveries/:id/status` | Driver | picked\_up / out\_for\_delivery / arrived |
| POST | `/deliveries/:id/incident` | Driver / system | Breakdown, delay, cold-chain issue → re-route check |
| POST | `/deliveries/:id/report` | Receiver | Mandatory report (multipart: photo, signature) |
| GET | `/dashboard/summary` | Staff | Stock by group, expiring soon, open requests |
| POST | `/sim/scenario` · `/sim/inject` | Demo only | Seed a city, trigger a failure |

**Realtime channels**

- `org:{orgId}` — `request.incoming` (a nearby hospital needs blood), `offer.selected`, `delivery.assigned`
- `request:{id}` — `offer.new`, `window.closed`, `status.changed`
- `delivery:{id}` — `location` (lat, lng, speed), `eta.updated`, `status.changed`, `rerouted`

**Third-party APIs**

- Routing: directions + distance matrix (OpenRouteService / OSRM; Google Routes for live traffic later)
- Geocoding: Nominatim or OpenRouteService
- Push: Firebase Cloud Messaging
- SMS: MSG91 or Twilio (DLT-registered templates)
- Email: Resend
- Later: e-RaktKosh (India's national blood bank system) for real inventory — check what integration access exists before planning on it

## Matching and re-routing

Matching is a ranked search that widens until it finds stock; re-routing applies the notebook's two-case rule using how far the vehicle has already travelled.

**Matching (runs in the worker)**

1. Call `find_suppliers` at radius 10 km. Fewer than 3 hits → widen to 25 km, then 50 km. No hit at 50 km → mark `no_match`, alert the receiver and the platform admin.
2. Broadcast to every hit (realtime + push; SMS if urgency is critical).
3. For the MVP, an offer is auto-created from live inventory so the window fills instantly; the sender still approves later. Manual confirm can be a toggle per hospital.
4. When the 2–3 min window closes, score each offer and show the top 5:

```latex
\text{score} = 0.6 \cdot \frac{\text{ETA}}{\text{ETA}_{\max}} + 0.2 \cdot \left(1 - \frac{\text{units offered}}{\text{units needed}}\right) + 0.1 \cdot \text{expiry rank} + 0.1 \cdot \text{tier}
```

Lower is better. Expiry rank favours lots that expire soonest but still after ETA plus a safety buffer (first-expiry-first-out), which cuts wastage. The weights are starting values to tune in the simulator.

5. Exact blood-group match by default. Compatible substitutes (for example O-negative red cells) are shown as a separate, labelled option; the clinician decides, the system never auto-substitutes.
6. If the chosen sender declines or does not answer in 5 min, the receiver is returned to the remaining options with one tap.

**Worst case: re-route rule**

Triggers: driver reports an incident, the vehicle has not moved for 3 min, actual ETA slips more than 10 min past plan, or the sender cancels. On any trigger the worker immediately runs a background match from the vehicle's current position, then applies:

- **Case 1 — travelled less than half the planned distance:** source fresh units from the priority hospital (best score from the receiver's location). Cancel the original leg and return its lots to the sender.
- **Case 2 — travelled half or more:** the units in the vehicle are the fastest option. Keep them; send the nearest available driver to the vehicle for a hand-off, and log it as a child delivery.

The 50% threshold is a setting, and the rule should compare ETAs, not just distance: if a fresh source is faster than finishing the current leg, take it. Every decision is written to `delivery_events` so the timeline explains what happened.

## Storage, security and compliance

Three stores, strict per-hospital isolation, and no patient data in the MVP.

**Where data lives**

- **Postgres (Supabase):** all records, history, audit trail. Daily backups on.
- **Redis (Upstash):** latest driver position per delivery (TTL 10 min), match-window timers, job queue, rate-limit counters. Nothing here is the source of truth.
- **Object storage (Supabase Storage):** private buckets `licences/`, `reports/`, `signatures/`. Access only through signed URLs that expire in 10 min.

**Security**

- Row Level Security: staff see their own hospital's inventory; another hospital's stock is visible only as an offer on a request they raised.
- Roles enforced in the database, not only the UI; drivers can only write to deliveries assigned to them.
- Hospitals cannot send or receive until an admin has verified the licence.
- Every state change is written to `delivery_events` with actor and time — this is your audit log.
- Rate-limit request creation per hospital to stop spam broadcasts; secrets only in environment variables.

**Compliance to plan for (not to solve in the MVP)**

- India's Digital Personal Data Protection Act 2023 applies once you store any personal data; keep the MVP to staff and driver details only.
- Blood transfer between banks follows national blood-transfusion guidelines and cold-chain rules; capture temperature and bag numbers in the report now so the data exists when you need it.
- Label the product clearly as a coordination tool; clinical decisions stay with the hospitals.

## MVP scope and build plan

The MVP proves one loop end to end — request, match, approve, deliver with live tracking, re-route, report — in a simulated city. Six weeks with a team of four.

**In scope:** hospital signup + admin verification, inventory CRUD with expiry, request + broadcast + 2–3 min window, ranked options, approve/decline, dispatch, driver PWA with GPS, live map + ETA, re-route rule, mandatory delivery report, dashboard, simulator.

**Out of scope for now:** patient records, payments/billing, donor app, native mobile apps, e-RaktKosh sync, multi-city scale, ML demand forecasting.

**Team split**

- **Frontend:** dashboard, request flow, live map view
- **Backend:** schema, RLS, SQL functions, API routes
- **Worker + integrations:** matching, timers, routing API, notifications, re-route
- **Driver PWA + simulator:** GPS pings, fake hospitals and moving vehicles, failure injection

**Week by week**

1. **Week 1 — Foundation:** repo, Supabase project, schema + PostGIS, auth, roles, RLS, seed 30 fake hospitals around Jaipur. Start SMS DLT registration.
2. **Week 2 — Inventory and requests:** inventory screens, create request, `find_suppliers`, broadcast over realtime + push.
3. **Week 3 — Matching:** worker, 2–3 min window, scoring, options screen, select / approve / decline, lot reservation.
4. **Week 4 — Delivery:** dispatch, routing API, driver PWA, location pings, live map with ETA on the receiver side.
5. **Week 5 — Worst case and closing:** incident triggers, re-route rule, hand-off legs, mandatory report with photo + signature, dashboard summary.
6. **Week 6 — Simulator and demo:** scenario runner, failure injection, Playwright test of the full loop, Sentry, polish, record a 3-minute demo.

**Done means:** in the simulator, a request for 2 units of B+ PRBC is matched within 3 min, delivered with live tracking, survives an injected breakdown via the re-route rule, and closes with a filed report.

## Open questions

Settle these in the first team meeting; each one changes the schema or a screen.

- [ ] Who drives — the sender hospital's own staff/ambulance, or a shared courier pool? (Changes who can be assigned in dispatch.)
- [ ] Does the sender confirm stock manually, or do we trust live inventory and auto-offer?
- [ ] The notebook's worst-case thresholds: is "less than" / "more than" half the distance the right split, or a fixed km value?
- [ ] Which components are in the MVP — whole blood and PRBC only, or plasma and platelets too?
- [ ] Is this headed for a hackathon demo (simulator first) or a pilot with real hospitals (verification and compliance first)?
- [ ] Who are the 1–2 real hospitals or blood banks in Jaipur we can interview to check this flow?
