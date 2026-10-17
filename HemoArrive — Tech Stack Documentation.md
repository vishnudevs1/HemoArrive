# HemoArrive — Tech Stack Documentation

Oct 15, 2026 · @Vishnu Kumar

## Stack at a glance

HemoArrive is a TypeScript monorepo: one Next.js app (hospital dashboard, admin, driver PWA and API), one Node worker for timed jobs and the simulator, and Supabase for database, auth, realtime and files. Pin exact versions in `package.json` on day 1 and upgrade together, not per person.

| Layer | Tool | Job in HemoArrive |
| --- | --- | --- |
| Language | TypeScript (strict) | One language for web, API, worker, simulator |
| Package manager | pnpm workspaces + Turborepo | Monorepo, shared types, cached builds |
| Web framework | Next.js (App Router) | Dashboard, admin, driver PWA, `/api/v1` routes |
| UI | Tailwind CSS + shadcn/ui + lucide-react | Consistent components without a design team |
| Data fetching | TanStack Query | Caching, refetch, optimistic updates |
| Forms + validation | React Hook Form + Zod | Same Zod schema validates client and server |
| Maps | MapLibre GL JS (react-map-gl) | Live delivery map, hospital pins |
| PWA | Serwist (@serwist/next) | Installable driver app, offline shell |
| Database | Supabase Postgres + PostGIS | All records, geo queries |
| Auth | Supabase Auth + Row Level Security | Login, roles, per-hospital isolation |
| Realtime | Supabase Realtime | Offers, status, GPS pushed to screens |
| Files | Supabase Storage | Reports, photos, signatures, licences |
| Cache + queue | Upstash Redis + BullMQ | Live positions, match timers, job queue |
| Worker | Node.js service (tsx in dev) | Matching, ETA watch, re-route, expiry sweep, simulator |
| Routing / ETA | OpenRouteService API | Directions, distance matrix, geocoding |
| Map tiles | MapTiler or Stadia Maps (OSM data) | Vector tiles with a free tier |
| Push | Firebase Cloud Messaging | Web push to staff and drivers |
| SMS | MSG91 or Twilio | Critical alerts to Indian numbers |
| Email | Resend + React Email | Verification, digests |
| Hosting | Vercel · Supabase cloud · Railway | Web · data · worker |
| Monitoring | Sentry + PostHog | Errors, product analytics |
| Testing | Vitest + Playwright | Unit and end-to-end |

## Repository structure

Two apps, one shared package, and the Supabase folder for everything database. Shared code (Zod schemas, blood-group rules, DB types) lives once in `packages/shared` and is imported by both apps.

```
hemoarrive/
├─ apps/
│  ├─ web/                      # Next.js app
│  │  ├─ app/
│  │  │  ├─ (auth)/              # login, signup, verify
│  │  │  ├─ (hospital)/          # dashboard, inventory, requests, track/[id]
│  │  │  ├─ admin/               # hospital verification, live overview
│  │  │  ├─ driver/              # driver PWA screens
│  │  │  └─ api/v1/              # route handlers
│  │  ├─ components/             # shadcn/ui + app components
│  │  ├─ lib/                    # supabase clients, queue client, maps helpers
│  │  └─ sw.ts                   # service worker (Serwist + FCM)
│  └─ worker/                   # Node service
│     ├─ src/jobs/               # broadcast, closeWindow, etaWatch, reroute, expirySweep
│     ├─ src/services/           # routing, notify, scoring
│     └─ src/simulator/          # seed city, move vehicles, inject failures
├─ packages/
│  └─ shared/
│     ├─ src/schemas/            # Zod: request, offer, delivery, report
│     ├─ src/constants/          # blood groups, components, compatibility
│     └─ src/db.types.ts         # generated from Supabase
├─ supabase/
│  ├─ migrations/               # SQL migrations, one per change
│  ├─ seed.sql                  # 30 fake Jaipur hospitals + inventory
│  └─ config.toml
├─ e2e/                         # Playwright tests
├─ .github/workflows/ci.yml
├─ turbo.json
└─ pnpm-workspace.yaml
```

## Frontend and driver PWA

Server Components render pages; client components handle anything live (maps, realtime, forms). The driver app is the same Next.js app under `/driver`, installable as a PWA.

**Hospital web app**

- **Pages:** Dashboard (stock by group, expiring in 72 h, open requests) · Inventory · New request · Options (ranked offers with countdown) · Track (live map, ETA, driver contact) · Report form · Incoming requests (sender side).
- **State:** server data through TanStack Query; realtime events update the query cache directly (`queryClient.setQueryData`) instead of refetching.
- **Forms:** React Hook Form + `zodResolver` with the schema imported from `packages/shared`, so the API rejects exactly what the form rejects.
- **Map:** `react-map-gl` with MapLibre. Draw the route as a GeoJSON line from the ORS polyline; move the vehicle marker on each `location` event and animate between points so it does not jump every 5 s.
- **Urgency UI:** critical requests get a full-width banner and sound on the sender's dashboard; never rely on colour alone.

**Driver PWA**

- **Screens:** Today's jobs · Job detail (pickup, drop, units) · Navigate (opens Google Maps with the destination) · Status buttons (Picked up · Out for delivery · Arrived) · Report incident.
- **GPS:** `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`; send a ping every 5 s or 30 m moved, whichever comes first. Queue pings in IndexedDB when offline and flush on reconnect.
- **Keep the screen on:** Screen Wake Lock API while a job is active. Browsers, especially iOS Safari, pause GPS when the app is in the background, so the driver must keep the app open. A native app (Expo) is the fix after the MVP.
- **Install + push:** Serwist builds the service worker; add the Firebase messaging handler to the same worker so there is only one.

## Backend API

The API is Next.js route handlers under `app/api/v1`. Each handler does four things in order: authenticate, validate with Zod, run a query as the user (so RLS applies), and enqueue any timed work for the worker. Full endpoint list is in the MVP Architecture doc.

**Two Supabase clients — never mix them up**

- `createServerClient` (from `@supabase/ssr`) with the user's cookie: used in every route. RLS protects data.
- `createClient` with the service-role key: only in the worker and admin-only routes. It bypasses RLS, so it never reaches the browser.

**Handler shape**

```ts
// app/api/v1/requests/route.ts
export async function POST(req: Request) {
  const supabase = await getUserClient();            // cookie-based, RLS on
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(401, 'UNAUTHENTICATED');

  const body = CreateRequestSchema.safeParse(await req.json());
  if (!body.success) return fail(422, 'VALIDATION', body.error.flatten());

  const { data, error } = await supabase.rpc('create_request', body.data);
  if (error) return fail(400, 'DB_ERROR', error.message);

  await queue.add('broadcast', { requestId: data.id });  // worker takes over
  return ok(201, data);
}
```

**Response format (every endpoint)**

- Success: `{ "data": ... }`
- Error: `{ "error": { "code": "VALIDATION", "message": "...", "details": {...} } }`
- Codes: `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 (lots already reserved) · `VALIDATION` 422 · `RATE_LIMITED` 429.

**Rules**

- Multi-row changes (reserve lots, approve offer) are Postgres functions called with `rpc`, so they run in one transaction.
- Driver location pings go to Redis first (latest position) and are batched into `location_pings` every 30 s by the worker.
- Rate limit `POST /requests` per hospital with `@upstash/ratelimit`.

## Database, auth and storage

Supabase gives Postgres, auth and file storage in one project; every schema change is a SQL migration in Git, never a click in the dashboard. Table design is in the MVP Architecture doc.

**Migrations**

- Create: `supabase migration new add_offers_table` → write SQL in the new file.
- Apply locally: `supabase db reset` (re-runs all migrations + `seed.sql`).
- Types: `supabase gen types typescript --local > packages/shared/src/db.types.ts` after every migration, committed with it.
- Enable PostGIS in the first migration: `create extension if not exists postgis;`

**Nearest supplier query (core of matching)**

```sql
create or replace function find_suppliers(
  p_lat float, p_lng float, p_group text, p_component text,
  p_units int, p_radius_m int, p_min_expiry timestamptz
) returns table (org_id uuid, distance_m float, units int, nearest_expiry timestamptz)
language sql stable as $$
  select o.id,
         st_distance(o.location, st_makepoint(p_lng, p_lat)::geography),
         sum(l.units)::int,
         min(l.expires_at)
  from organizations o
  join inventory_lots l on l.org_id = o.id
  where o.verified
    and l.status = 'available'
    and l.blood_group = p_group and l.component = p_component
    and l.expires_at > p_min_expiry
    and st_dwithin(o.location, st_makepoint(p_lng, p_lat)::geography, p_radius_m)
  group by o.id
  having sum(l.units) >= 1
  order by 2;
$$;
```

Note the order: PostGIS points are (longitude, latitude).

**Auth and roles**

- Login with email + password for staff; phone OTP for drivers (needs an SMS provider configured in Supabase Auth).
- Role and `org_id` live in `users`; copy them into the JWT with a custom access token hook so RLS policies can read them without a join.
- Example policy: staff read only their hospital's lots — `using (org_id = (auth.jwt() ->> 'org_id')::uuid)`.
- Turn RLS on for every table in the same migration that creates it.

**Storage**

- Private buckets: `licences`, `reports`, `signatures`. No public buckets.
- Path convention: `reports/{org_id}/{delivery_id}/photo.jpg` so a storage policy can check the folder against the user's org.
- Serve files with `createSignedUrl(path, 600)`; compress photos in the browser to about 1 MB before upload.

## Realtime and background worker

Realtime pushes changes to screens; the worker does everything that runs on a timer or takes longer than a request should. The API never waits on routing or notifications.

**Realtime channels**

| Channel | Events | Sent by | Listened by |
| --- | --- | --- | --- |
| `org:{orgId}` | `request.incoming`, `offer.selected`, `delivery.assigned` | Worker | Hospital dashboard |
| `request:{id}` | `offer.new`, `window.closed`, `status.changed` | Worker | Receiver options screen |
| `delivery:{id}` | `location`, `eta.updated`, `status.changed`, `rerouted` | Worker / API | Receiver track screen, admin |

- Use Broadcast channels for high-frequency events (`location`); use Postgres Changes only for low-frequency table updates.
- Make channels private and authorize them with RLS on `realtime.messages`, so a hospital cannot subscribe to another's request.
- Payloads stay small: ids + changed fields; the client refetches detail if it needs more.

**Worker (apps/worker)**

A long-running Node process with BullMQ queues on Upstash Redis. BullMQ needs a normal Redis TCP connection (`rediss://` URL), not the Upstash REST API.

| Job | Trigger | Does |
| --- | --- | --- |
| `broadcast` | `POST /requests` | `find_suppliers` at 10 → 25 → 50 km, create offers, notify hospitals |
| `closeWindow` | Delayed job, 2–3 min after request | Score offers, publish `window.closed` |
| `senderTimeout` | Delayed 5 min after select | Expire unanswered offer, return receiver to options |
| `etaWatch` | Repeat every 30 s per active delivery | Recompute ETA, detect stops and delays |
| `reroute` | Incident or `etaWatch` breach | Apply case 1 / case 2 rule, create new leg |
| `flushPings` | Repeat every 30 s | Copy Redis positions to `location_pings` |
| `expirySweep` | Cron, hourly | Mark expired lots, alert hospitals at 72 h |
| `notify` | Any job | Push, SMS, email with retries |
| `sim:*` | Simulator API | Seed city, move fake vehicles, inject failures |

- Every job is idempotent (safe to run twice) and has 3 retries with exponential backoff.
- Use `jobId` = the request or delivery id so the same job is never queued twice.

## Maps, routing and notifications

All third-party calls go through one wrapper per provider in `apps/worker/src/services`, so swapping OpenRouteService for Google later touches one file.

**Maps and routing**

| Need | Provider | Endpoint / package |
| --- | --- | --- |
| Directions + route line | OpenRouteService | `POST /v2/directions/driving-car/geojson` |
| ETA to many hospitals at once | OpenRouteService | `POST /v2/matrix/driving-car` |
| Address to coordinates | OpenRouteService | `GET /geocode/search` |
| Map tiles | MapTiler or Stadia Maps | Style URL loaded by MapLibre |
| Turn-by-turn for driver | Google Maps app | Deep link `https://www.google.com/maps/dir/?api=1&destination=lat,lng` |

- Do not use OpenStreetMap's own tile server in the app; its usage policy does not allow app traffic. A tile provider's free tier is fine for the MVP.
- Cache matrix results in Redis for 2 min keyed by origin cell + destination, and check each provider's current free-tier quota before the demo.
- Keep a straight-line distance fallback (PostGIS) if the routing API fails, and label the ETA as estimated.

**Notifications**

| Channel | Provider | Used for |
| --- | --- | --- |
| Web push | Firebase Cloud Messaging (`firebase` client, `firebase-admin` in worker) | Incoming requests, offer decisions, dispatch |
| SMS | MSG91 or Twilio | Critical urgency only, and driver OTP |
| Email | Resend + React Email | Signup, hospital verified, daily expiry digest |

- Store each device's FCM token in a `push_tokens` table (user\_id, token, platform, last\_seen).
- SMS to Indian numbers needs DLT entity, sender ID and template registration first; templates must match the sent text exactly.
- One `notify(userIds, template, data)` function chooses channels by urgency, so features never call providers directly.

## Environment variables

Anything prefixed `NEXT_PUBLIC_` is shipped to the browser, so only public keys get that prefix. Commit a `.env.example` with every key and no values; real values live in Vercel, Railway and each developer's `.env.local`. Validate them at startup with a Zod schema so a missing key fails loudly.

| Variable | Used in | Secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | web, worker | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | No (RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | worker, admin routes | Yes — never in the browser |
| `REDIS_URL` | web (queue add), worker | Yes |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | web (rate limit) | Yes |
| `ORS_API_KEY` | worker | Yes |
| `NEXT_PUBLIC_MAP_STYLE_URL` | web | No (restrict key by domain) |
| `NEXT_PUBLIC_FIREBASE_CONFIG` | web | No |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | web | No |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | worker | Yes |
| `MSG91_AUTH_KEY` (or `TWILIO_ACCOUNT_SID` / `_AUTH_TOKEN` / `_FROM`) | worker | Yes |
| `RESEND_API_KEY` | worker | Yes |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | web, worker | No |
| `NEXT_PUBLIC_POSTHOG_KEY` | web | No |
| `SIMULATOR_ENABLED` | web, worker | No — `false` in production |
| `MATCH_WINDOW_SECONDS` | worker | No — default 150 |
| `REROUTE_DISTANCE_THRESHOLD` | worker | No — default 0.5 |

## Local setup

A new teammate should go from clone to a working request-to-delivery loop in under 30 minutes. Prerequisites: Node.js LTS, pnpm, Docker Desktop (for local Supabase), Git.

1. **Clone and install**

   ```bash
   git clone <repo-url> hemoarrive && cd hemoarrive
   pnpm install
   ```
2. **Start local Supabase** (Postgres, Auth, Realtime, Storage in Docker)

   ```bash
   pnpm dlx supabase start
   pnpm dlx supabase db reset      # migrations + seed: 30 Jaipur hospitals
   ```

   Copy the printed API URL, anon key and service-role key.
3. **Local Redis**

   ```bash
   docker run -d -p 6379:6379 --name hemo-redis redis:7
   ```
4. **Environment** — copy `.env.example` to `apps/web/.env.local` and `apps/worker/.env`, fill the Supabase keys, `REDIS_URL=redis://localhost:6379`, and your own free ORS key.
5. **Generate DB types**

   ```bash
   pnpm dlx supabase gen types typescript --local > packages/shared/src/db.types.ts
   ```
6. **Run everything**

   ```bash
   pnpm dev          # Turborepo starts web (localhost:3000) + worker
   ```
7. **Smoke test** — log in as the seeded receiver, raise a request for 2 units of B+ PRBC, approve it as the seeded sender, start the simulated driver from `/admin/sim`, and watch it on the track screen.

Seeded logins and their passwords go in the repo README, never in this doc.

## Deployment and environments

Three environments, each with its own Supabase project, Redis database and keys; nothing is shared between them. Merging to `main` deploys to staging automatically; production is a manual promote.

| Environment | Web | Database | Worker | Who uses it |
| --- | --- | --- | --- | --- |
| Local | `pnpm dev` | Supabase CLI (Docker) | `pnpm dev` | Each developer |
| Staging | Vercel preview + `staging` branch | Supabase project `hemoarrive-staging` | Railway service | Team, demo rehearsals |
| Production | Vercel production | Supabase project `hemoarrive-prod` | Railway service | Pilot hospitals / judges |

- **Region:** create both Supabase projects in the Mumbai (ap-south-1) region and set Vercel functions to `bom1`, so DB calls stay in India and fast.
- **Migrations in deploy:** CI runs `supabase db push` against staging on merge; production pushes only after the staging check passes.
- **Worker:** Railway builds `apps/worker` from its Dockerfile; keep one replica in the MVP so delayed BullMQ jobs and the simulator do not run twice.
- **Domains:** `app.hemoarrive.<tld>` for the web app; the driver PWA lives at `/driver` on the same domain so one service worker scope is enough.
- **Backups:** confirm daily backups on the production Supabase plan before any real hospital data goes in.
- **Simulator:** `SIMULATOR_ENABLED=false` in production; the demo runs on staging.

## Quality: testing, CI, monitoring, conventions

Test the logic that can hurt someone (matching, expiry, re-routing) hardest; UI gets one end-to-end test of the full loop.

**Testing**

- **Unit (Vitest):** scoring function, blood-group compatibility table, re-route decision (case 1 vs case 2 at the threshold edges), expiry filter, Zod schemas.
- **Database:** run `find_suppliers` and `reserve_lots` against the local Supabase in tests; include two requests racing for the same lot and assert one gets `CONFLICT`.
- **End-to-end (Playwright):** receiver raises request → offers appear → sender approves → simulated driver delivers → report filed → request closed.

**CI (GitHub Actions, on every pull request)**

1. `pnpm install --frozen-lockfile`
2. `pnpm lint` (ESLint + Prettier check) and `pnpm typecheck`
3. `pnpm test` (Vitest)
4. Start Supabase CLI, `supabase db reset`, run Playwright
5. Vercel builds a preview URL for review

**Monitoring**

- Sentry in web and worker, with the request or delivery id attached to every error.
- PostHog events for the funnel: `request_created` → `offer_selected` → `offer_approved` → `delivered` → `report_filed`, plus time between each step.
- Alert (Sentry or a Slack webhook) when a job fails all retries or a delivery has no GPS ping for 3 min.

**Conventions**

- Branches: `feat/…`, `fix/…`, `chore/…`; pull request required for `main`, one reviewer.
- Commits: Conventional Commits (`feat: add offer scoring`).
- Naming: database `snake_case`, TypeScript `camelCase`, components `PascalCase`, API paths kebab-case and plural.
- Times: store UTC (`timestamptz`), display in IST.
- Never log phone numbers or report photos; log ids only.
