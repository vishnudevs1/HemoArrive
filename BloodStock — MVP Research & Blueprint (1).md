# BloodStock — MVP Research & Blueprint

Oct 15, 2026 · @Vishnu Kumar

## What BloodStock solves

BloodStock answers one question per request: **which specific unit, from which facility, can reach this patient's ward before it expires and while it is still compatible, without stealing a unit already promised elsewhere?** Today that answer lives in phone calls between blood-bank staff.

Why it matters in India: expiry is the single largest controllable cause of discard. One tertiary-centre study found 18.7% of units discarded, with expiry the top reason at about 36% of discards ([MSJ Online](https://www.msjonline.org/index.php/ijrms/article/download/13332/8600/61253)). For platelets, which last only 5 days, expiry explains roughly 96% of platelet discards in a Punjab study ([AJPCR](https://www.journals.innovareacademics.in/index.php/ajpcr/article/download/53772/31656/253063)). A study that cut red-cell wastage named "failure to transfer near-expiry/surplus units to other centres" as a root cause ([PAFMJ](https://pafmj.org/PAFMJ/article/download/6459/6176/114303)). That transfer decision is exactly what BloodStock plans.

### The gaps it closes

| Gap today | What BloodStock adds |
| --- | --- |
| Portals show *stock counts*, not *reachable, usable* stock | Feasibility = compatible AND arrives before expiry AND before clinical need-by time AND not reserved |
| Nearest-available matching ignores expiry and future demand | Network-wide optimisation that uses the oldest safe unit and keeps rare units for rare patients |
| Double booking when two hospitals call the same bank | Reservation ledger with atomic holds and expiry of holds |
| Plans break when a van breaks down or demand spikes | Event-driven replanning that keeps every committed promise unless physically impossible |
| No explanation of *why* a unit was chosen | Plain-language reason and trade-off per recommendation |

### Scope boundary (state this on slide 1)

BloodStock is **logistics decision support**. It never decides who should be transfused, how many units, or whether a substitution is clinically appropriate. Compatibility rules are a configurable table owned by the transfusion officer. Every recommendation needs a human "Approve" click. All facilities, patients and units are synthetic.

## Competitors and existing systems

Nobody in the list below does **unit-level, expiry-aware, transport-aware transfer planning across hospitals with live replanning and explanations**. Existing tools either show stock, take orders, or control fridges inside one hospital; the research models optimise but ship no usable tool.

| System | What it does | Where it stops (your opening) |
| --- | --- | --- |
| [e-RaktKosh](https://vajiramandravi.com/current-affairs/2025/6/22) (MoHFW, India) | National blood bank management; 3,800+ centres; real-time stock counts, donor and camp management, expiry tracking | Shows *counts per bank*, no feasibility check against travel time and expiry, no transfer recommendation, no reservation across banks |
| Donor-matching apps (Friends2Support, Blood Warriors, community platforms) | Connect patients with willing donors | Solve *donor* supply, not existing-unit allocation; no inventory model |
| [BloodHub / InVita](https://www.riversidecompany.com/currents/bloodhub-news-release) (USA) | Online ordering and inventory between blood centres and hospitals | Order-and-fulfil workflow; supplier picks units; no network optimisation or what-if simulation |
| [Bloodbuy](https://bloodbuy.com/news/innovationfwd) (USA) | Marketplace where hospitals source blood from other centres | Price/availability marketplace, not a planner; no expiry-vs-transit check |
| [Haemonetics BloodTrack](https://hospital.haemonetics.com/fr-ca/transfusion-management/bloodtrack) | Smart fridges and software controlling units *inside one hospital* | Single-site; no inter-hospital transfers |
| [Zipline](https://knowledge.wharton.upenn.edu/article/how-rwanda-is-using-drones-to-improve-health-care/) (Rwanda, Ghana) | Drone delivery of blood; wastage at served hospitals fell markedly | A *transport mode*, not an allocation brain; BloodStock could treat drones as one more lane |
| [Zhang et al., Operations Research 2023](https://www.ebsco.com/articles/health-and-medicine/02db80e3-f7ab-505a-b4b2-9af53681fa2a/inventory-sharing-for-perishable-products-application-to-platelet-inventory-management-in-hospital-blood-banks) (Emory) | MDP transshipment policy for platelets; about 20% fewer outdates in practice | Two hospitals only; policy, not software; no live events |
| [Valizadeh et al., 2026](https://findanexpert.unimelb.edu.au/scholarlywork/2258347-platelet-inventory-management-in-hospital-networks--a-reinforcement-learning-approach) | RL ordering with ABO substitution and fixed transshipment | Transshipment is a fixed rule; black-box; not explainable |

**Positioning line for the pitch:** e-RaktKosh tells you *where* blood is; BloodStock tells you *which unit can actually get there in time, and what you give up by moving it.* Build it as a layer that could sit on top of e-RaktKosh-style data, not as a replacement.

## Datasets required

No public dataset gives unit-level stock across Indian hospitals, so the MVP **generates synthetic data calibrated to published Indian figures**. That is a strength: judges can see every number has a citation.

### Reference parameters (calibration inputs)

| Parameter | Value to use | Source |
| --- | --- | --- |
| ABO mix (Delhi, n = 16,925) | B 37.7%, O 29.3%, A 23.1%, AB 10.0% | [PMC10563568](https://pmc.ncbi.nlm.nih.gov/articles/PMC10563568/table/T3) |
| Rh(D) negative | about 5% (range 3.5–9% by region) | same table |
| PRBC shelf life | 42 days in SAGM/additive, 35 days CPDA-1, store 1–6 °C, transport 1–10 °C | [study guide](https://open-exam-prep.com/study-guides/amt-mlt/ch4/blood-components-storage) |
| Platelets | 5 days, 20–24 °C with agitation | [study guide](https://open-exam-prep.com/study-guides/amt-mls/blood-banking-transfusion/donor-selection-components) |
| FFP / cryo | 1 year at ≤ −18 °C; thawed FFP use within 6 h | same |
| Expiry share of discards | about 36% of all discards; about 96% of platelet discards | [MSJ](https://www.msjonline.org/index.php/ijrms/article/download/13332/8600/61253), [AJPCR](https://www.journals.innovareacademics.in/index.php/ajpcr/article/download/53772/31656/253063) |

### Synthetic tables to generate

| Table | Key fields | How to generate |
| --- | --- | --- |
| `facility` | id, name, type (blood centre / tertiary / district / clinic), lat, lon, fridge capacity per component, operating hours | 8–12 fictional facilities placed on a real city map (e.g. Jaipur) so travel times are realistic |
| `unit` | unit\_id, component, ABO, Rh, collected\_at, expires\_at, location, status (available / reserved / in\_transit / issued / expired / quarantined), irradiated, CMV-neg | Collections as a Poisson process per centre; ABO/Rh sampled from the mix above; expiry = collected + shelf life |
| `request` | req\_id, facility, component, ABO, Rh, qty, urgency (P1 emergency / P2 urgent / P3 scheduled), need\_by, special flags | Poisson arrivals per facility, rate scaled by facility size; 10% P1, 30% P2, 60% P3 as a starting guess, labelled as assumption |
| `lane` | from, to, mode (van / bike / ambulance / drone), base\_minutes, variance, cold-chain max minutes, availability | Road times from OSRM or OpenRouteService on OpenStreetMap; peak-hour multiplier 1.3–1.8 |
| `vehicle` | id, home facility, mode, capacity (units), status | 1–2 per blood centre |
| `compat_rule` | component, recipient type, allowed donor types, preference rank, hard/soft | Config file owned by the "transfusion officer" role (next sub-section) |
| `event` | t, type, payload | Event log written by the simulator; also the audit trail |

### Compatibility rule table (default, editable)

- **Red cells:** recipient O− accepts O−; O+ accepts O±; A− accepts A−, O−; A+ accepts A±, O±; B mirrors A; AB+ accepts all. Rank 1 = identical type, rank 2 = compatible substitute.
- **Plasma (FFP):** reversed. AB plasma suits everyone; O plasma suits only O.
- **Platelets:** ABO-identical preferred, others allowed as a lower-rank *soft* option; Rh-negative recipients flagged.
- **Special flags:** irradiated or CMV-negative requests can only take units carrying the same flag (hard).

Rule of thumb for the demo: anything that could harm a patient is *hard*; anything that is merely preferable is *soft* with a penalty. The clinician-owned table is what keeps the tool on the right side of "no clinical decisions".

### Optional real data hooks

- A public blood-bank directory (data.gov.in hosts lists of licensed blood banks with addresses; verify the current file) to place realistic facility locations.
- OpenStreetMap road network for travel times.
- Keep e-RaktKosh as an *integration target* in the architecture, not a scraped source.

## Novelty

The novelty is not "an optimiser for blood" (papers exist). It is **a live, explainable, failure-tolerant planner with a measured baseline**, which no shipped product or paper combines.

1. **Remaining-life-at-arrival as the core feasibility test.** A unit is judged by `expires_at − (now + pickup + travel + handling)`, not by shelf life today. This single quantity drives feasibility, cost and the explanation.
2. **Commitment-aware replanning.** Units already in a van or reserved for a P1 patient are *frozen*; the solver may only re-route them if the original plan becomes physically impossible. Judges will try to break this; it must hold.
3. **Counterfactual explanations.** Every recommendation says why this unit, and what the next-best option would have cost ("Using the O− from City Hospital instead would arrive 18 min later and leave the network with zero O− for 6 h").
4. **Scarcity shadow price.** The solver penalises using a rare unit (O−, AB plasma, Rh− platelets) for a common recipient, scaled by how many rare units the network holds. This keeps universal-donor stock for those who truly need it.
5. **Side-by-side baseline.** The same event stream runs through nearest-available and through BloodStock, so the gain (expiries avoided, P1 requests met on time, km driven) is a measured number, not a claim.
6. **Deterministic, replayable scenarios.** A seeded event log means judges can replay the exact van breakdown and see the same recovery every time.
7. **Robust slack on travel time.** Plans use a pessimistic travel time (e.g. 80th percentile) for P1, so a traffic jam does not turn a feasible plan into a missed patient.

## System architecture and design

BloodStock is five small services around one event log. The simulator plays the real world, the planner reacts to events, and nothing changes stock until a human approves and the ledger accepts the hold.

&#91;embedded content: BloodStock architecture · 5 layers\]

The planner reads current state and writes proposed plans back as events; the baseline runs on the same stream so every KPI is a like-for-like comparison.

### Design decisions

- **Event sourcing:** state is rebuilt from the log, which gives replay, audit and "what changed and why" for free.
- **Stateless planner:** each call gets a snapshot (units, requests, lanes, frozen commitments) and returns a plan plus reasons. Easy to test and to time-box (2 s limit, fall back to last plan).
- **Ledger is the only source of truth for reservations:** the solver can be wrong or stale; the database constraint cannot.
- **Pre-computed travel matrix** with p50 and p80 times per lane and time-of-day band, so the demo never depends on a live map API.
- **Explainer is deterministic:** reason codes + template sentences, generated from the solver's chosen and runner-up options.

### Core API

| Endpoint | Purpose |
| --- | --- |
| `POST /requests` | Create a request (facility, component, type, qty, urgency, need\_by) |
| `GET /plan` | Current recommendations with source, destination, feasibility, ETA, RLA, reason |
| `POST /plan/{id}/approve` | Atomically reserve units and dispatch |
| `POST /scenario/{type}` | Inject lane\_down, spike, cancel, stock\_arrival, quarantine |
| `GET /kpi?planner=both` | Live KPI comparison |
| `WS /events` | Stream of events and replans to the UI |

## Tech stack

Pick boring, fast-to-build tools and spend the time on the model and the demo.

| Layer | Choice | Why |
| --- | --- | --- |
| Optimiser | **Google OR-Tools CP-SAT** (Python) | Handles hard constraints, integer unit assignment, time windows and lexicographic objectives; free; solves this size in under 1 s |
| Fallback / ablation | OR-Tools `SimpleMinCostFlow` or NetworkX | Shows the min-cost-flow formulation the PS mentions; good for the "why we chose CP-SAT" slide |
| Simulator | **SimPy** discrete-event engine | Native event queue, timeouts, resources (vans); reproducible with a seed |
| Backend API | **FastAPI** + Pydantic | Typed models for unit/request/plan; WebSocket for live updates |
| State + ledger | **PostgreSQL** (SQLite for local demo) | Row-level locks and a unique constraint give hard no-double-allocation guarantees |
| Event bus | In-process queue for MVP; Redis Streams if time allows | Simulator, planner and UI subscribe to the same events |
| Routing data | OSRM / OpenRouteService on OSM, pre-computed into a matrix | No live API dependency during the demo |
| Frontend | **React + Vite**, Tailwind, **MapLibre GL** (map), Recharts (KPIs) | Map of facilities and moving vans, recommendation table, scenario buttons |
| Explanations | Template-based text from solver outputs; optional LLM only to rephrase | Templates are deterministic and auditable; never let an LLM choose units |
| Testing | pytest + **Hypothesis** property tests | Prove invariants: no unit used twice, no arrival after expiry, no incompatible match |
| Packaging | Docker Compose | One command for judges |

## Optimisation model

Use **CP-SAT as the main solver** and keep a min-cost-flow version as a comparison. Min-cost flow is elegant and fast, but it cannot express fixed per-trip costs, vehicle capacity, or "freeze this commitment" cleanly; CP-SAT can, and at 10 facilities × a few hundred units it still solves in well under a second.

### Step 1: build only feasible pairs (pre-filter)

For each available unit u at source s and each open request r at destination d, compute the arrival time and the remaining life on arrival:

```latex
a_{ur} = t_{now} + t^{pick}_{s} + \tau^{p80}_{sd} + t^{handle}
```

```latex
RLA_{ur} = e_u - a_{ur}
```

Keep the pair only if **all** hard checks pass. Each failed check is stored as a reason code, which later feeds the "why not" explanation.

| Hard check | Rule | Reason code if it fails |
| --- | --- | --- |
| Compatibility | (component, donor type, recipient type) is allowed in `compat_rule` | `INCOMPATIBLE` |
| Special flags | irradiated / CMV-neg requirement met | `FLAG_MISMATCH` |
| Expiry on arrival | RLA ≥ minimum usable margin for that component (e.g. 6 h for platelets, 24 h for PRBC) | `EXPIRES_IN_TRANSIT` |
| Clinical deadline | arrival ≤ need\_by | `TOO_LATE` |
| Cold chain | travel minutes ≤ lane cold-chain limit for the component | `COLD_CHAIN` |
| Status | unit is available, or already reserved for this same request | `RESERVED_ELSEWHERE` |
| Lane | lane is up and a vehicle is free in time | `NO_TRANSPORT` |

### Step 2: decision variables

- `x[u,r] ∈ {0,1}`: unit u is assigned to request r (only for feasible pairs).
- `y[s,d,k] ∈ {0,1}`: trip k from s to d is dispatched (batching several units in one van).
- `short[r] ≥ 0`: units of request r left unmet.

### Step 3: constraints

```latex
\sum_{r} x_{ur} \le 1 \quad \forall u \qquad \text{(no double allocation)}
```

```latex
\sum_{u} x_{ur} + short_r = q_r \quad \forall r
```

```latex
\sum_{u \in s,\, r \in d} x_{ur} \le \sum_k cap_k \, y_{sdk} \quad \forall s,d
```

- **Frozen commitments:** `x[u,r] = 1` is fixed for units in transit or for P1 reservations already confirmed by a human.
- **Safety stock:** a facility may not send away its last N units of O− red cells (configurable), unless the request is P1.
- **Local-first for in-house units:** a unit already at the requesting hospital costs zero transport.

### Step 4: objective (lexicographic, solved in order)

1. Minimise unmet demand weighted by urgency: P1 × 10,000, P2 × 100, P3 × 1.
2. Minimise expected network wastage: reward using units with the *least* remaining life that are still safe (first-expiry-first-out across the network), and penalise leaving units to expire unused.
3. Minimise scarcity cost: penalty for using O− red cells, AB plasma or Rh− platelets on a recipient that could take something more common, scaled by `1 / (rare stock in network)`.
4. Minimise transport: trips × fixed cost + km.
5. Minimise plan churn: penalty for every assignment that differs from the previous plan, so replans are stable and staff are not whipsawed.

Solve level 1, fix its optimum as a constraint, solve level 2, and so on. This keeps the priorities defensible on a slide: no amount of saved fuel ever outweighs a missed P1 patient.

### Reservations and the no-double-allocation guarantee

- The solver proposes; a human approves. On approval, the API runs one database transaction: `UPDATE unit SET status='reserved', reserved_for=:r WHERE unit_id=:u AND status='available'`. Zero rows updated means someone else took it, and the plan is re-solved.
- A unique index on `reservation(unit_id) WHERE active` makes double booking impossible even if two planners race.
- Unconfirmed holds expire after a TTL (e.g. 15 min for P2/P3), releasing the unit back to the pool.

### Min-cost-flow version (for comparison)

Source → one node per (facility, component, ABO/Rh, expiry bucket) with capacity = units held → arcs to each request node where the pair is feasible, cost = transport + scarcity − freshness bonus → request nodes to sink with capacity = qty, plus a high-cost "unmet" arc. It solves fast but treats each unit-move as independent, so it cannot batch trips. Show both in the evaluation.

## How the simulation works

The simulator is a **seeded discrete-event simulation** (SimPy). It owns the "real world"; the planner only sees what a real blood bank would see, and must react to events it did not predict.

### Clock and run modes

- Simulated time runs in minutes. A demo run covers 72 h (enough for platelets to expire) and plays at 1 sim-hour ≈ 5 real seconds, with pause and step.
- Every run has a seed. Same seed + same scenario = identical event log, so results are reproducible.
- **Twin runs:** each scenario is run twice on the same event stream, once with the nearest-available baseline and once with BloodStock. The KPI panel shows both.

### Event types

| Event | Generated by | What changes |
| --- | --- | --- |
| `UNIT_COLLECTED` | Poisson per blood centre | New unit appears with expiry |
| `UNIT_EXPIRED` | Timer at `expires_at` | Status → expired, counted as waste |
| `REQUEST_CREATED` | Poisson per hospital, by urgency | Open demand appears |
| `REQUEST_CANCELLED` | Probability per request, or a scenario button | Demand removed, reservations released |
| `DISPATCH` / `PICKUP` / `ARRIVAL` | Planner decision + travel time sampled from lane distribution | Unit moves; status in\_transit → available at destination |
| `ISSUED` | Arrival at requesting hospital before need\_by | Request filled |
| `LANE_DOWN` / `VEHICLE_BREAKDOWN` | Scenario control or random rate | Travel time on lane → ∞, or vehicle stuck mid-route |
| `DELAY` | Random multiplier on actual travel | Arrival later than planned |
| `DEMAND_SPIKE` | Scenario control | Request rate × k at chosen hospitals for T hours |
| `STOCK_ARRIVAL` | Scenario control (donation camp, inter-state supply) | Batch of new units |
| `QUARANTINE` | Scenario control | Unit pulled (e.g. failed check), even if reserved |

**Planned vs actual travel** is the key realism trick: the planner uses the 80th-percentile time; the simulator samples the *actual* time from a lognormal around the median. Some trips arrive late, which tests whether the slack was enough.

### When the planner runs

- On every event that changes feasibility (new request, cancellation, lane down, arrival, stock arrival, quarantine).
- On a timer every 15 sim-minutes, to catch slow drift such as units getting close to expiry.
- Proactive rebalancing: every 6 sim-hours, look for units that will expire unused at their current site but could be used elsewhere, and suggest a transfer even with no request open (this is the Emory insight: move older stock toward where it will be used).

### Nearest-available baseline

For each request in arrival order: take the closest facility that has a compatible unit of the right type, pick its oldest unit, dispatch immediately. No look-ahead, no scarcity awareness, no batching, no check that the unit survives the trip until it fails. This is close to how phone-based coordination works and gives a fair, simple baseline.

### What the simulator measures

Units expired (by component), requests met on time by urgency, mean and worst lateness for P1, units moved, km and trips, O− used on non-O− recipients, number of replans and plan churn, and solver time. These feed the evaluation section.

## Scenario handling and post-execution constraints

Every disruption follows the same five-step loop: **detect → mark what is now impossible → freeze what must not move → re-solve the rest → explain the diff.** Once a plan is executing, these post-execution rules hold in every replan:

- A unit physically in a vehicle can only be re-routed, never re-reserved at its origin.
- A unit issued to a patient leaves the model.
- Confirmed P1 reservations are frozen unless they become infeasible; if they do, the P1 request is re-planned *first*, before anything else.
- Hard compatibility, expiry-on-arrival and cold-chain checks are re-run on the *new* arrival times, never reused from the old plan.
- Every change is written to the event log with old plan, new plan and reason.

### 1. Transport failure (lane down, van breakdown, long delay)

| Case | What BloodStock does |
| --- | --- |
| Van not yet departed | Release its trip; units stay reserved for the same requests; re-solve for a different vehicle or lane |
| Van broke down mid-route | Units become "stranded at location L". Compute time-to-cold-chain-limit. If another vehicle can reach L and still deliver before expiry and need\_by, plan a rescue pickup. Otherwise mark those units *lost* (quarantine on recovery) and re-solve the requests from other stock |
| Lane closed (road, flood) | Set travel time to ∞ for that lane; recompute all feasible pairs; drone or alternative lane used if configured |
| Delay but still moving | Recompute arrival; if still feasible keep plan; if P1 would now be late, dispatch a *parallel backup* unit from the next-best source and cancel whichever arrives second |

Explanation shown: "Van V3 broke down near Sitapura at 14:20. Request R-112 (P1, 2 × O+ PRBC) re-sourced from Central Blood Centre; new ETA 15:05, 25 min later than plan, still 55 min before need-by."

### 2. Demand spike (mass-casualty event)

- Switch the hospital into **surge mode**: P1 weight increases further, safety-stock rules at *other* sites relax for O− and O+ PRBC, and proactive rebalancing runs immediately.
- Allow substitution ranks to widen (rank 2 compatible types become normal) — still within the hard compatibility table.
- Batch trips: one van carries many units to the surge site instead of many small trips.
- If total network stock cannot meet demand, the plan says so explicitly: "Shortfall of 6 O+ PRBC network-wide; earliest relief: donation camp batch at 20:00 (scenario)." The tool never pretends a shortfall is solved.

### 3. Cancellation

- Release all reservations and in-transit assignments for that request.
- Units already in transit are re-assigned to the best open request *along or near their route* (cheap re-route) rather than sent back.
- If no request needs them, route them to the site where they are most likely to be used before expiry (highest forecast demand for that type), or return to origin if that is closer and stock there is low.
- Cancellations happen often in real life (surgery postponed), so the TTL on unconfirmed holds also acts as an automatic soft cancellation.

### 4. New stock arrival and stock alternatives

- New units enter the pool and trigger a replan. Because of the churn penalty, existing plans only change if the gain is real (e.g. a fresh local unit lets a long-distance transfer be cancelled).
- **Alternatives when the exact type is out:** the solver walks the substitution ladder in `compat_rule` (identical → compatible rank 2 → …) and shows the cost of each rung: "No A+ platelets reachable in time. Option: O+ platelets (lower-rank match, needs clinician confirmation)." Soft substitutions are *proposed for a human to approve*, never auto-applied.
- **Quarantine or recall:** the unit is removed even if reserved; affected requests are re-planned first.

### Edge cases to test before the demo

- Two requests compete for the last O− unit: higher urgency wins; tie broken by earlier need\_by; the loser gets an explicit shortfall message.
- A unit expires at the exact minute it would arrive: treated as infeasible (margin rule).
- A cancellation and a new request arrive in the same minute: process in timestamp order, then a single replan.
- Solver times out: fall back to the last feasible plan plus the greedy baseline for new requests, and show a warning.

## User flow and screens

Three roles: **hospital blood-bank staff** (raise requests, receive units), **network coordinator** (approves transfers), **transfusion officer** (owns compatibility rules and safety stock). The judge uses the coordinator view.

### Main flow: an urgent request

1. Hospital staff raise a request: "2 × O+ PRBC, P1, need by 15:30, St. Mira District Hospital".
2. The planner runs within 1–2 s and shows a ranked recommendation list.
3. Each row shows: unit IDs, source → destination, **Feasible / Not feasible**, ETA (p50 and p80), remaining life on arrival, transport mode, and a one-line reason. Infeasible nearby options are shown too, greyed, with the reason ("Expires in transit", "Reserved for R-108").
4. The coordinator expands "Why this?" to see the trade-off against the runner-up.
5. Coordinator clicks **Approve**. The ledger reserves the units atomically; the van appears on the map.
6. If an event breaks the plan, a banner shows the change (old → new, reason) and asks for re-approval only where a human decision is needed (e.g. a soft substitution).
7. Receiving hospital confirms arrival; units become available locally and are issued.

### Screens

| Screen | Contents |
| --- | --- |
| Network map | Facilities coloured by stock health per component, vans moving, closed lanes in red |
| Recommendations | The table above, filter by urgency and component, approve / reject |
| Inventory | Per facility: units by type and expiry bucket (0–24 h, 1–3 d, 3–7 d, > 7 d) |
| Scenario panel | Buttons: lane down, van breakdown, demand spike (× k for T h), cancel request, stock arrival, quarantine unit; seed selector; play / pause / step |
| KPI panel | BloodStock vs baseline: expiries, P1 on-time, O− misuse, trips; updates live |
| Event log | Every event and replan with its reason, filterable, exportable as CSV |
| Rules (officer) | Compatibility table, margins, safety stock; edits are versioned |

Every screen carries the banner "Decision support only · synthetic data · clinical decisions remain with the treating team".

## Evaluation and baseline comparison

Run each scenario with **30 seeds** for both planners and report mean ± 95% interval. One lucky run proves nothing; 30 seeds turn the demo into evidence.

| Metric | Definition | Direction |
| --- | --- | --- |
| P1 fill-on-time | P1 units delivered before need\_by ÷ P1 units requested | higher |
| All-urgency fill rate | units delivered on time ÷ units requested | higher |
| Expiry wastage | units expired ÷ units available, per component | lower |
| Expired-in-transit | units that expired between dispatch and arrival | must be 0 for BloodStock |
| Double allocations | units assigned to two requests at once | must be 0 (invariant) |
| Incompatible matches | assignments violating a hard rule | must be 0 (invariant) |
| O− misuse | O− PRBC given to non-O− recipients while O−-only patients waited | lower |
| Transport effort | trips, km | lower |
| Plan churn | assignments changed per replan | lower |
| Solver latency | p95 seconds per replan | < 2 s |

Scenario matrix to run: steady state, transport failure, demand spike, mass cancellation, new stock arrival, and a combined "bad day" (spike + lane down + quarantine). Show results as a chart of the gap between BloodStock and baseline for each scenario, not as raw tables.

Expectation to state carefully: published transshipment policies cut platelet outdates by about 20% in a real two-hospital system ([Zhang et al.](https://www.ebsco.com/articles/health-and-medicine/02db80e3-f7ab-505a-b4b2-9af53681fa2a/inventory-sharing-for-perishable-products-application-to-platelet-inventory-management-in-hospital-blood-banks)). Present your own simulated numbers as simulated, and compare them against this real-world anchor rather than claiming a big percentage.

## MVP build plan, risks and demo script

A 4-person team can ship the full MVP in four weeks if the simulator and baseline come first; compress each phase to 1–2 days for a 36-hour hackathon.

&#91;embedded content: MVP roadmap · 4 phases, 3 gates\]

Do not start the UI until gate 2 passes: a pretty map on top of a planner that double-books will lose the round.

### Suggested team split

| Person | Owns |
| --- | --- |
| A | Data generator, SimPy simulator, scenario injection |
| B | Feasibility filter, CP-SAT model, explainer |
| C | FastAPI, Postgres ledger, WebSocket, tests |
| D | React UI, map, KPI charts, pitch deck |

### Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Judges say "this makes clinical decisions" | Clinician-owned rule table, human approval on every plan, soft substitutions never auto-applied, banner on every screen |
| Solver too slow on stage | Pre-filter pairs, 2 s time limit, warm start from last plan, greedy fallback |
| Synthetic data looks fake | Calibrate to the cited Indian figures and show the citation in the UI's "About data" panel |
| Demo randomness goes wrong live | Fixed seeds; rehearsed scenario script; recorded backup video |
| Overbuilding | Cut drones, LLM text and Redis first; never cut the baseline comparison or invariant tests |

### 5-minute demo script

1. Map of 10 fictional Jaipur facilities, steady state, both planners running.
2. P1 request at a district hospital: baseline picks the nearest unit, which expires in transit; BloodStock picks a further unit with 40 h of life left and explains why.
3. Press **Van breakdown**: show the rescue / re-source and the plan diff.
4. Press **Demand spike** at a trauma centre: surge mode, batching, explicit shortfall message.
5. Press **Cancel** and **Stock arrival**: units re-routed mid-trip; churn stays low.
6. Close on the KPI panel across 30 seeds: expiries, P1 on-time, O− misuse, zero double bookings.

## Sources

- [MSJ Online: discard of blood units, Indian tertiary centre](https://www.msjonline.org/index.php/ijrms/article/download/13332/8600/61253)
- [AJPCR: blood component discard, Punjab](https://www.journals.innovareacademics.in/index.php/ajpcr/article/download/53772/31656/253063)
- [PAFMJ: reducing red-cell discards](https://pafmj.org/PAFMJ/article/download/6459/6176/114303)
- [Vajiram & Ravi: e-RaktKosh overview](https://vajiramandravi.com/current-affairs/2025/6/22)
- [Riverside: BloodHub acquisition](https://www.riversidecompany.com/currents/bloodhub-news-release)
- [Bloodbuy interview](https://bloodbuy.com/news/innovationfwd)
- [Haemonetics BloodTrack](https://hospital.haemonetics.com/fr-ca/transfusion-management/bloodtrack)
- [Wharton: drone delivery of blood in Rwanda](https://knowledge.wharton.upenn.edu/article/how-rwanda-is-using-drones-to-improve-health-care/)
- [Zhang et al., Operations Research 2023 (Emory platelets)](https://www.ebsco.com/articles/health-and-medicine/02db80e3-f7ab-505a-b4b2-9af53681fa2a/inventory-sharing-for-perishable-products-application-to-platelet-inventory-management-in-hospital-blood-banks)
- [Valizadeh et al. 2026, RL platelet inventory](https://findanexpert.unimelb.edu.au/scholarlywork/2258347-platelet-inventory-management-in-hospital-networks--a-reinforcement-learning-approach)
- [ABO/Rh frequencies across Indian states (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10563568/table/T3)
- [Component storage and shelf life](https://open-exam-prep.com/study-guides/amt-mlt/ch4/blood-components-storage)
- [Donor selection and component storage](https://open-exam-prep.com/study-guides/amt-mls/blood-banking-transfusion/donor-selection-components)
