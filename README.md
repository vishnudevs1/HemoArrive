# HemoArrive

A blood logistics tool that helps hospitals find blood in nearby hospitals and blood banks, get it reserved, and track it until it reaches the patient. This repo has the MVP, a browser-only simulation of a hospital network in Jaipur, along with the design and research docs behind it.

## The Problem

Sometimes a hospital needs blood right away but doesn't have the blood group the patient needs. So someone at the blood bank starts calling around. One bank doesn't pick up, another has already promised its units to someone else, and a third has the blood but the bag will expire before the van gets there.

Most of the time the blood is there, just a few kilometres away. What's missing is a way to find it, reserve it and move it in time. Current portals tell you how many units a bank has. They don't tell you which unit can reach your patient before it expires without being promised to someone else.

## What We're Building

HemoArrive lets you:

- Raise a blood request for one or more patients
- Alert nearby hospitals in widening circles (10 km, then 25 km, then 50 km)
- Only see units that will still have enough shelf life when they arrive
- Split one request across several hospitals when one isn't enough
- Edit the suggested supply plan before approving it
- Track every vehicle on a map with its ETA
- Re-route automatically when a vehicle breaks down or gets stuck in traffic
- Rate each hospital on how reliably it responds and delivers
- See where blood is being asked for, and for which conditions, to help plan supply
- Download a PDF delivery record for each hospital

## Request Flow

```text
Ask
  ↓
Alert nearby hospitals (10 → 25 → 50 km)
  ↓
2.5 minute matching window
  ↓
Suggested supply plan
  ↓
Sender approves or declines
  ↓
Dispatch
  ↓
Live tracking / re-route
  ↓
Receiver confirms
  ↓
Delivery report
```

## 🛠️ Tech Stack

What the MVP uses:

- React 18
- TypeScript
- Vite
- Leaflet (OpenStreetMap / MapTiler tiles)
- jsPDF
- Vitest

The production plan is Next.js, Supabase (Postgres + PostGIS, Auth, Realtime), Redis with BullMQ for timed jobs, and OpenRouteService for real road ETAs. The architecture doc goes into the details.

## 📁 Project Structure

```
HemoArrive/
│
├── mvp/
│   ├── src/
│   │   ├── core/
│   │   │   ├── blood.ts
│   │   │   ├── city.ts
│   │   │   ├── matching.ts
│   │   │   ├── reroute.ts
│   │   │   ├── engine.ts
│   │   │   ├── twin.ts
│   │   │   ├── performance.ts
│   │   │   ├── planning.ts
│   │   │   ├── core.test.ts
│   │   │   └── ...
│   │   ├── ui/
│   │   │   ├── LiveRequest.tsx
│   │   │   ├── MapView.tsx
│   │   │   ├── Network.tsx
│   │   │   ├── Performance.tsx
│   │   │   ├── Planning.tsx
│   │   │   ├── Compare.tsx
│   │   │   └── ...
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── .env.example
│   ├── package.json
│   └── ...
│
├── HemoArrive — *.md
├── LICENSE
└── README.md
```

All the logic lives in `src/core`. It's plain TypeScript with no UI code, so it can be moved into a backend worker later without changes. `src/ui` holds the React screens.

## ⚙️ Getting Started

There's no backend in this build. Everything runs in the browser on fictional hospitals and made-up stock. You'll need Node.js 18 or newer.

### 1. Clone the repository

```bash
git clone https://github.com/vishnudevs1/HemoArrive.git
cd HemoArrive
```

### 2. Install dependencies

```bash
cd mvp
npm install
```

### 3. Start the app

```bash
npm run dev
```

The app will run on:

```
http://localhost:5173
```

### 4. Map key (optional)

The map works out of the box with openstreetmap.org tiles, which is fine for trying it locally. If you want to use MapTiler instead, get a free key and add it:

```bash
cp .env.example .env.local
```

Then inside `.env.local`:

```
VITE_MAPTILER_KEY=your_maptiler_key_here
```

`.env.local` is git-ignored so the key won't get committed.

## 🧪 Running the Tests

Inside the `mvp` directory:

```bash
npm test
```

This runs 37 unit tests covering blood compatibility, scoring, the re-route rule, the full request loop and the twin simulation.

Other useful commands:

```bash
npm run typecheck
npm run build
npm run preview
```

## 🔗 Trying It Out

The app has five tabs:

**Live request** runs the whole flow from request to delivery. You can turn on competing demand from other hospitals (Off / Normal / Busy), trigger a breakdown or heavy traffic to see the re-route rule kick in, or just run one of the six auto demos.

**Hospitals & stock** shows stock across the network by blood group, units expiring in the next 72 hours, and the lots held by each hospital.

**Performance** shows each hospital's score over the last 90 days, with a leaderboard, red flags and an option to appeal an event.

**Planning** shows where blood is needed, for which conditions, and where requests go unmet. Counts under 5 are shown as "<5". You can export the area report as a CSV.

**Smart vs Nearest** plays the same 3-day stream of requests through a "nearest available" approach and through HemoArrive, so you can compare the two.

Use the speed buttons (1×, 10×, 30×, 60×) to speed up simulated time.

## How Matching Works

Each offer gets a score, lower is better, and the top 5 are shown:

```
score = 0.6 · ETA/ETAmax + 0.2 · (1 − offered/needed) + 0.1 · expiryRank + 0.1 · performanceBand
```

A few rules sit on top of that:

- Exact blood group by default. Compatible substitutes are listed separately and need a doctor's confirmation
- A unit is only offered if it will have at least 24 hours of life left on arrival (6 hours for platelets)
- If the sender doesn't respond in 5 minutes, the receiver goes back to the option list
- No patient data is stored. The reason for a request is saved as a category only

## Re-routing

When a vehicle breaks down, or its ETA slips by more than 10 minutes:

1. If it has covered less than half the trip, fresh units are sent from near the receiver
2. If it has covered half or more, the units already on the road keep going
3. If the other option is at least 3 minutes faster, that one is picked instead
4. The reason for the decision is shown on screen and logged

## Concepts Covered

- Matching supply to demand across many suppliers
- Shelf life and expiry-aware planning
- Handling races when two hospitals want the same stock
- Event-driven simulation with a simulated clock
- Live tracking on a map
- Scoring and ranking hospitals
- Aggregating data without exposing patients
- Pure logic separated from the UI

## Documentation

- [Pitch](HemoArrive%20%E2%80%94%20Pitch.md)
- [MVP Architecture](HemoArrive%20%E2%80%94%20MVP%20Architecture.md)
- [Tech Stack Documentation](HemoArrive%20%E2%80%94%20Tech%20Stack%20Documentation.md)
- [User Flow Documentation](HemoArrive%20%E2%80%94%20User%20Flow%20Documentation.md)
- [Mentor Feedback Research & Proposal](HemoArrive%20%E2%80%94%20Mentor%20Feedback%20Research%20%26%20Proposal.md)
- [BloodStock: MVP Research & Blueprint](BloodStock%20%E2%80%94%20MVP%20Research%20%26%20Blueprint%20%281%29.md) (the project's earlier name)

## What's Next

- Supabase backend
- Redis/BullMQ worker for timed jobs
- Real road routing and ETAs
- Push, SMS and email notifications
- Driver app with real GPS
- Separate logins for each hospital

## Note

This is a prototype. Every hospital, driver, stock entry and history record in the app is made up. It isn't a medical device and shouldn't be used for real clinical or transfusion decisions.

## License

[MIT](LICENSE)
