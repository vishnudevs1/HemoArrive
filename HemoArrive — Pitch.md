# HemoArrive — Pitch

Oct 16, 2026 · For the judging round · 5-minute pitch + 3-minute live demo + Q&A

> **One line:** HemoArrive finds blood that can actually reach the patient in time, splits it across hospitals when one bank isn't enough, tracks every unit to the bedside, and turns every request into data that helps the government plan.

---

## How this pitch maps to the judging criteria

| Criterion | Where we prove it | What judges will see |
| --- | --- | --- |
| **Technical Implementation** | Live demo + "What we built" | A working app: request → split supply → live tracking → re-route → report → PDF record, with 37 automated tests |
| **Improvement Based on Previous Feedback** | "What changed since mentor feedback" | Every mentor point answered: credit points built, planning data built, regulator routing researched and corrected |
| **Novelty & Innovation** | "What no one else does" | Remaining-life-at-arrival check, editable split supply, competing-hospital handling, half-way re-route rule, performance credit score |
| **Ideation & Problem-Solving** | The emergency story + the problem slide | A real, sourced problem; a clear flow anyone can follow; honest limits |

---

## 1. Opening — the emergency (60 seconds)

*Speak slowly. No slides for the first 20 seconds: just the story.*

> “It is 11:40 at night. A bus has overturned on the highway outside Jaipur. Three people are brought into a district hospital in Sanganer, all bleeding heavily. The doctor needs **6 units of O-positive red cells, 4 units of B-positive, and 4 units of AB-positive plasma** — now.
>
> The hospital's own fridge has two units. So the blood bank officer picks up the phone.
>
> The first blood bank doesn't answer. The second says yes — but the units they promised were already given to another hospital an hour ago. The third has the blood, but its oldest bag expires before the van can even get there. Forty minutes later, the officer is still calling.
>
> This is not a story about blood shortage. The blood existed — in four different hospitals within 10 kilometres. **What was missing was a way to find it, reserve it, and move it in time.**
>
> We built that. It's called HemoArrive.”

*This scenario is illustrative: the hospital names in our demo are fictional. The problems in it — unanswered calls, double-promised units, units that expire in transit — are the ones described in the research below.*

---

## 2. The problem — with sources (45 seconds)

| What happens today | The evidence |
| --- | --- |
| **Blood is short**, and nobody agrees by how much | 11.1 million units collected vs 13 million needed in 2016–17 ([IndiaSpend](https://www.indiaspend.com/india-60-tankers-short-of-blood-in-2016-17-as-shortage-increases-53935)); modelling studies put the gap at 26–41 million units ([Daily Pioneer / Lancet Haematology](https://www.dailypioneer.com/2019/india/blood-supply-in-india-runs-short-of-41-million-units.html), [ISBT 2025](https://isbtweb.foleon.com/transfusion-today/transfusion-today-july-2025-copy-1/unmet-needs)) |
| **And yet blood is thrown away** | 18.7% of units discarded at one Indian tertiary centre, expiry the top reason ([MSJ Online](https://www.msjonline.org/index.php/ijrms/article/download/13332/8600/61253)); about 96% of platelet discards in a Punjab study were due to expiry ([AJPCR](https://www.journals.innovareacademics.in/index.php/ajpcr/article/download/53772/31656/253063)) |
| **Delay kills mothers** | Postpartum haemorrhage causes about 35–38% of maternal deaths in India ([Down To Earth, NHM note](https://www.downtoearth.org.in/news/health/postpartum-haemorrhage-remains-leading-cause-of-maternal-deaths-in-kerala-report-81873)) |
| **Some patients need blood for life** | 10,000–15,000 children are born with thalassaemia major every year; each needs about 30 units a year ([Tribune](https://www.tribuneindia.com/news/health/india-has-largest-number-of-kids-with-thalassemia-major-127968/amp), [Medical Dialogues](https://medicaldialogues.in/delhi-govt-takes-step-to-sensitise-students-about-thalassemia)) |
| **Dengue season breaks the system** | Platelets last 5 days; families search for donors on WhatsApp ([Punekar News](https://www.punekarnews.in/?p=244156), [Deccan Herald](https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fplatelets-in-state-scarce-dengue-patients-hit-744174.html)) |

> “Existing portals show **how many** units a blood bank has. They don't tell you **which unit can reach your patient before it expires, without being promised to someone else**. That's the gap.”

---

## 3. The solution in one picture (30 seconds)

```
 Hospital needs blood          HemoArrive                                   Result
 ─────────────────────         ──────────────────────────────────────       ─────────────────────
 3 patients, 14 units  ──▶  ① alert verified hospitals (10 → 25 → 50 km)
                            ② collect offers for 2.5 minutes
                            ③ suggest a plan — split across banks if needed ──▶ 3 hospitals send
                            ④ each hospital approves its own share              3 vans move at once
                            ⑤ live tracking; breakdown → re-route rule      ──▶ units arrive
                            ⑥ mandatory delivery report (temperature, bags) ──▶ PDF record
                            ⑦ every request feeds planning + hospital scores ──▶ data for government
```

> “Four taps to ask. Two and a half minutes to find. One map to track. And a record for every unit.”

---

## 4. Live demo script (3 minutes)

*Run `npm run dev` in `mvp/` before going on stage. Open http://localhost:5173. Set speed to **20×** (the demos do this automatically).*

| Time | Click | Say |
| --- | --- | --- |
| 0:00 | **Live request → "Mass casualty: 3 patients"** | “This is the bus accident. One request, three patients.” |
| 0:20 | Watch the countdown and offers arrive | “Ten verified hospitals alerted. Offers come in live.” |
| 0:40 | Plan appears: units split across hospitals | “No single bank had everything. HemoArrive split the order across three hospitals — and the officer can still edit it.” |
| 1:00 | Three vans on the map | “Three hospitals approve their own share. Three vehicles, tracked at once.” |
| 1:20 | **Closed screen → Download record (PDF)** | “Every unit, every temperature, every decision — in one record. Our simulation closes this request in about 16 minutes.” |
| 1:40 | **Back → "Breakdown late in the trip"** (or press 🔧 Breakdown) | “Now the worst case. A van breaks down at 70% of the trip.” |
| 2:00 | Decision card appears | “Under half way, we fetch fresh units. Past half way, the units on the road are fastest — we send the nearest driver to collect them. And if the other option is clearly faster, ETA wins.” |
| 2:20 | **Performance tab → click Jamdoli Hospital** | “Every hospital earns credit points from what it actually does. This one kept showing stock it didn't have — it's in Review, with red flags.” |
| 2:40 | **Planning tab** | “And every request becomes data. Right now there's a dengue warning in the South zone, and the data suggests where a blood storage centre would help most.” |
| 3:00 | End | — |

**Backup:** if the live demo fails, play a screen recording of the same sequence. Record it the day before.

---

## 5. What changed since mentor feedback (45 seconds)

*This section scores "Improvement Based on Previous Feedback". Say it as a list, fast and confident.*

| Mentor feedback | What we did | Status |
| --- | --- | --- |
| 1. What change does this bring to society? | Researched and sourced the problem; five concrete changes; measured our own results against a baseline | ✅ Answered (this pitch) |
| 2. Credit points for hospital performance | **Hospital Performance Score** — 100 points from 12 observed metrics, based on Kayakalp and NABH blood bank indicators; Gold / Silver / Watch / Review bands; red flags; appeals | ✅ **Built** |
| 3. How do diseases entered identify diseases and the people dealing with them? | Conditions mapped to **ICD-10** codes. They show which diseases drive demand where, and **which hospitals** treat them — never which patients (DPDP Act 2023) | ✅ **Built** |
| 4. Poor performers → medical council + surprise inspection | Corrected the target: blood banks are inspected by the **State Drugs Controller + CDSCO** and monitored by the **State Blood Transfusion Council**, not the NMC. Designed a flag → notice → review → referral process with due process | 📄 Designed, partly built (flags + Review band) |
| 5. Help allocate medicines by area | District demand signals and early warnings, for RMSCL and health officials | ✅ Data built · 📄 integration designed |
| 6. Publish a government survey from the data | Area report by zone and condition, anonymised (counts under 5 hidden), downloadable | ✅ **Built** (CSV) |
| *Also new* | One request for **many patients**, **split supply** across hospitals, **competing hospitals** taking stock in real time, **PDF records** | ✅ **Built** |

> “We didn't just add features. On point 4 we found that the body the feedback named doesn't inspect blood banks — so we routed it to the regulators who do.”

---

## 6. What no one else does — novelty (45 seconds)

| Others | HemoArrive |
| --- | --- |
| e-RaktKosh shows **stock counts per bank** | We check **life left on arrival**: a unit is offered only if it still has 24 h (red cells) or 6 h (platelets) when it gets there |
| You call one bank at a time | We **split one request across several banks** and let the officer edit the plan |
| Two hospitals can be promised the same unit | Units are **reserved on approval**; if another hospital took them first, that share fails and we **move you to the next bank automatically** |
| A breakdown means more phone calls | A **written re-route rule**: under half way → fresh units; past half way → hand-off; ETA always wins |
| No one rates reliability | A **performance credit score** built only from observed behaviour, with appeals |
| Data dies in phone logs | **Anonymous disease-demand maps** with early warnings for planners |

> “e-RaktKosh tells you **where** blood is. HemoArrive tells you **which unit can actually get there in time** — and gets it there.”

---

## 7. Technical implementation (30 seconds)

| Layer | What we built |
| --- | --- |
| App | React + TypeScript + Vite; Leaflet live map |
| Core logic (no UI) | Matching and scoring, re-route rule, simulation engine, hospital scoring, planning analytics — plain TypeScript, ready to move to a server |
| Simulation | 30 fictional hospitals on real Jaipur localities; seeded and repeatable; 90 days of history; failure injection; competing demand |
| Quality | **37 automated tests**, including safety rules: no unit promised twice, units never created or lost when stock is split, substitutes never added automatically, a plan never asks for more than needed |
| Outputs | PDF request records, CSV area reports |
| Production path | Supabase (Postgres + PostGIS, Auth, Realtime), a Node worker, OpenRouteService routing, a driver phone app — designed in our architecture doc |

**Measured, not claimed** — our "Smart vs Nearest" simulation plays the same 3 days twice, 30 runs each:

| Measure | Nearest available (phone calls) | HemoArrive |
| --- | --- | --- |
| Emergency units on time | 97.1% | 98.8% |
| All units on time | 98.4% | 99.6% |
| Units arriving almost expired, per run | 4.0 | **0** |
| O-negative used on non-O-negative patients | 5.2 | 0.7 |
| Kilometres driven | 893 | 1,145 (+28%) |

> “These are **simulated** results on synthetic data, and we show the trade-off: we drive further, because we refuse to send blood that would expire on the way.”

---

## 8. Impact on society (30 seconds)

1. **Minutes instead of phone calls** — in trauma and childbirth bleeding, where delay kills.
2. **Less wasted blood** — no unit sent that expires on the way; short-dated stock used first.
3. **Rare blood protected** — O-negative kept for the patients who truly need it.
4. **Accountability** — every unit, temperature and decision recorded; hospitals earn trust with points.
5. **Data for planning** — for the first time, a district can see where blood is needed, for which conditions, and where requests go unmet: where to put a storage centre, a donation camp, an apheresis machine, or a thalassaemia day-care centre.

---

## 9. Closing (20 seconds)

> “Remember the bus accident. In our simulation, three patients, fourteen units, three hospitals — closed in about sixteen minutes, with a record of every bag.
>
> The blood already exists. HemoArrive makes sure it **arrives**.
>
> Thank you.”

---

## 10. Questions judges are likely to ask

| Question | Answer |
| --- | --- |
| **Does the app decide who gets blood?** | No. It's a coordination tool. Doctors decide; substitutes always need a doctor's confirmation; every plan is sent by a person. |
| **Is the data real?** | No — 30 fictional hospitals with synthetic stock, calibrated to published Indian figures (blood-group mix, shelf lives). Hospital locations are real Jaipur localities. A pilot would use real inventory, ideally from e-RaktKosh. |
| **Why would hospitals share their stock?** | They already share it by phone; we make it faster and fairer. The performance score rewards reliable senders, and an honest "no stock" never costs points. |
| **What about patient privacy?** | We store no patient names or IDs — only the condition as an ICD-10 code. Reports are aggregated and hide counts under 5. |
| **How is this different from e-RaktKosh?** | e-RaktKosh shows counts per bank. We check life left on arrival, reserve units, split orders, track delivery and re-route. We'd sit on top of e-RaktKosh, not replace it. |
| **What if two hospitals want the same unit?** | Units are reserved when a sender approves. If another hospital took them first, that share fails and the receiver is moved to the next bank. Next step: give priority to the more urgent request. |
| **Who acts on poor performers?** | A person reviews every flag first. Safety issues go to the State Drugs Controller; performance issues to the State Blood Transfusion Council. Nothing is reported automatically. |
| **What if the internet is down?** | Planned: SMS fallback for critical alerts and an offline queue in the driver app. Not in this MVP. |
| **Isn't driving 28% more a problem?** | It's the cost of never sending blood that expires on the way. The weights are tunable. |
| **What's next?** | A pilot with one district and its SBTC: real inventory, the driver phone app with GPS, and the regulator review queue. |

---

## 11. Demo-day checklist

- [ ] Laptop charged; app running (`npm run dev` in `mvp/`); browser zoom 100%
- [ ] Internet works (map tiles) — or a MapTiler key in `.env.local`
- [ ] Screen recording of the demo as backup
- [ ] Each team member knows their section: [Team member 1] story + problem · [Team member 2] demo · [Team member 3] feedback + novelty · [Team member 4] tech + Q&A
- [ ] One printed PDF record to hand to judges
- [ ] Rehearsed to under 8 minutes total

---

## Sources

- [IndiaSpend — India 60 tankers short of blood in 2016-17](https://www.indiaspend.com/india-60-tankers-short-of-blood-in-2016-17-as-shortage-increases-53935)
- [Daily Pioneer — Blood supply in India runs short of 41 million units](https://www.dailypioneer.com/2019/india/blood-supply-in-india-runs-short-of-41-million-units.html)
- [ISBT Transfusion Today — Unmet needs (2025)](https://isbtweb.foleon.com/transfusion-today/transfusion-today-july-2025-copy-1/unmet-needs)
- [MSJ Online — Discard of blood units](https://www.msjonline.org/index.php/ijrms/article/download/13332/8600/61253)
- [AJPCR — Blood component discard, Punjab](https://www.journals.innovareacademics.in/index.php/ajpcr/article/download/53772/31656/253063)
- [Down To Earth — PPH leading cause of maternal deaths](https://www.downtoearth.org.in/news/health/postpartum-haemorrhage-remains-leading-cause-of-maternal-deaths-in-kerala-report-81873)
- [Tribune — India has largest number of kids with thalassemia major](https://www.tribuneindia.com/news/health/india-has-largest-number-of-kids-with-thalassemia-major-127968/amp)
- [Medical Dialogues — Delhi govt on thalassemia](https://medicaldialogues.in/delhi-govt-takes-step-to-sensitise-students-about-thalassemia)
- [Punekar News — Pune blood shortage amid dengue](https://www.punekarnews.in/?p=244156)
- [Deccan Herald — Platelets scarce in Karnataka](https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fplatelets-in-state-scarce-dengue-patients-hit-744174.html)
- Full research and regulator sources: `HemoArrive — Mentor Feedback Research & Proposal.md`
