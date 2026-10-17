# HemoArrive — Mentor Feedback: Research & Proposal

Oct 15, 2026 · Draft for team and mentor approval · Nothing in this document has been built yet

## Summary

The mentors raised six points. Each one is answered below with research, a proposed design, and what we would build. One point needs a correction before we build anything:

> **The "Indian Medical Council" is not the right body for points 4 and 5.** The Medical Council of India was dissolved in September 2020 and replaced by the **National Medical Commission (NMC)**, which regulates medical education and doctors' registration, not blood banks or medicine supply. Blood banks are licensed and inspected under the **Drugs and Cosmetics Act, 1940** by the **State Drugs Controller together with CDSCO**, and monitored by the **State Blood Transfusion Council (SBTC)**. Medicines for government facilities in Rajasthan are bought and distributed by **RMSCL**. Disease research is led by **ICMR**. The design below sends each kind of information to the body that actually acts on it.

| #   | Mentor feedback                                                                  | Our answer in one line                                                                                                                                           | Build in MVP?                       |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | What change will this bring to society?                                          | Faster blood in emergencies, less expiry waste, an audit trail, and district-level data that does not exist today                                                | Impact section + measured KPIs      |
| 2   | Credit points for hospital performance                                           | A 100-point **Hospital Performance Score** modelled on Kayakalp and NABH blood bank indicators, from data the app already records                                | **Yes**                             |
| 3   | How does the disease entered identify diseases and the people dealing with them? | Today it doesn't. Proposed: an ICD-10-mapped reason list that shows **which diseases drive demand where, and which hospitals treat them** — never which patients | **Yes** (aggregated only)           |
| 4   | Send poorly performing hospitals for a surprise inspection                       | Yes, but to the **State Drugs Controller + SBTC**, through a human-reviewed flag with due process, not automatically                                             | **Yes** (review queue, simulated)   |
| 5   | Help allocate medicines by area                                                  | Share district demand signals with **RMSCL / e-Aushadhi** and health officials; the platform informs allocation, it does not decide it                           | **Yes** (demand dashboard + export) |
| 6   | Publish a government survey from the data                                        | A quarterly **District Blood & Disease Report**, aggregated and anonymised, publishable on data.gov.in and shareable with ICMR                                   | **Yes** (report generator)          |

---

## 1. What HemoArrive changes for society

### The problem today

| Fact                                          | Figure                                                                                    | Source                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blood supply gap (official, WHO-norm method)  | 11.1 million units collected vs 13 million needed in 2016–17, a gap of about 1.9 million  | [IndiaSpend](https://www.indiaspend.com/india-60-tankers-short-of-blood-in-2016-17-as-shortage-increases-53935)                                                                                                                                                                                   |
| Blood supply gap (modelling studies)          | 26 to 41 million units, depending on how need is defined                                  | [Daily Pioneer (Lancet Haematology)](https://www.dailypioneer.com/2019/india/blood-supply-in-india-runs-short-of-41-million-units.html), [ISBT 2025](https://isbtweb.foleon.com/transfusion-today/transfusion-today-july-2025-copy-1/unmet-needs)                                                 |
| Units discarded at one Indian tertiary centre | 18.7% of units, expiry the top reason (about 36% of discards)                             | [MSJ Online](https://www.msjonline.org/index.php/ijrms/article/download/13332/8600/61253)                                                                                                                                                                                                         |
| Platelet discards caused by expiry (Punjab)   | about 96%                                                                                 | [AJPCR](https://www.journals.innovareacademics.in/index.php/ajpcr/article/download/53772/31656/253063)                                                                                                                                                                                            |
| Maternal deaths from postpartum haemorrhage   | about 35–38% of maternal deaths in India                                                  | [Down To Earth (NHM note)](https://www.downtoearth.org.in/news/health/postpartum-haemorrhage-remains-leading-cause-of-maternal-deaths-in-kerala-report-81873)                                                                                                                                     |
| Thalassaemia major births per year            | about 10,000–15,000; each child needs about 30 units a year                               | [Tribune](https://www.tribuneindia.com/news/health/india-has-largest-number-of-kids-with-thalassemia-major-127968/amp), [Medical Dialogues](https://medicaldialogues.in/delhi-govt-takes-step-to-sensitise-students-about-thalassemia)                                                            |
| Dengue season                                 | Platelets last 5 days; families search for donors over WhatsApp; apheresis kits run short | [Punekar News](https://www.punekarnews.in/?p=244156), [Deccan Herald](https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fplatelets-in-state-scarce-dengue-patients-hit-744174.html), [Tribune (Karnal)](https://m.tribuneindia.com/news/haryana/karnal-sees-surge-in-dengue-cases-334522) |

The shortage numbers vary widely between sources and most are several years old. We should quote the range, not one number.

### Five changes HemoArrive brings

1. **Minutes instead of phone calls in an emergency.** A hospital sees every verified hospital with usable stock within 10–50 km in one search, with ETA, instead of calling banks one by one. This matters most for postpartum haemorrhage and trauma, where delay kills.
2. **Less wasted blood.** HemoArrive only sends units that still have enough life left on arrival, uses short-dated stock first across the network, and shows hospitals what is about to expire so it can be shared.
3. **Rare blood kept for the patients who need it.** O-negative and other rare stock is protected from being used on patients who could take a common group.
4. **Accountability.** Every request, approval, trip, incident and delivery report is recorded with time and actor. Cold-chain temperature and bag numbers are captured on every delivery.
5. **Data for planning (points 3, 5 and 6).** For the first time, a district can see where blood is needed, for which conditions, and where requests go unmet. That supports decisions on new blood storage centres, donation camps, apheresis machines and thalassaemia day-care centres.

### What we can already show (simulation)

These numbers come from our "Smart vs Nearest" simulation: 30 runs of the same synthetic 3-day Jaipur scenario. They are **simulated, not real-world results**, and must be presented that way.

| Measure                                              | Nearest available (today's phone calls) | HemoArrive             |
| ---------------------------------------------------- | --------------------------------------- | ---------------------- |
| Emergency (P1) units on time                         | 97.1%                                   | 98.8%                  |
| All units delivered on time                          | 98.4%                                   | 99.6%                  |
| Units arriving (almost) expired, per run             | 4.0                                     | 0                      |
| O-negative used for non-O-negative patients, per run | 5.2                                     | 0.7                    |
| Units expired on the shelf                           | 140                                     | 143 (about the same)   |
| Kilometres driven                                    | 893                                     | 1,145 (about 28% more) |

The honest trade-off: HemoArrive drives further to avoid sending units that would expire on the way.

### What HemoArrive does not change

It does not create blood. Donor recruitment, the root cause of the shortage, is out of scope. HemoArrive makes the existing supply reach the right patient faster and with less waste.

---

##

### What we based it on

- **Kayakalp** (MoHFW) scores public health facilities on six parameters, with internal, peer and external assessment tiers. A facility needs at least **70%** to qualify for an award. ([Revised Kayakalp Guidelines](https://nhm.gov.in/images/pdf/in-focus/Revised_Kayakalp_Guidelines.pdf))
- **NABH blood bank quality indicators** include wastage rate (units discarded × 100 ÷ units prepared), turnaround time for routine and emergency issues, and adverse transfusion reaction rate. Accredited blood banks report the first five indicators every six months. ([NABH Quality Indicators](https://testing.nabh.co/wp-content/uploads/2025/07/Quality-Indicators_Blood-Bank.pdf))
- **DVDMS** ranks states on 10 parameters, including stock levels, expiry status and supply time. ([ETV Bharat](https://etvbharat.com/en/!state/rajasthan-free-medicine-scheme-drugs-and-vaccines-enn24072700657))

### Design rules

1. **Score only what the platform observes directly.** No self-reported numbers.
2. **Never penalise an honest "no stock".** A hospital with nothing to give loses no points; one that claims stock it does not have does.
3. **Rolling 90-day window, minimum volume.** No score is shown until a hospital has at least 10 events in the window, so one bad day cannot sink a small hospital.
4. **Every hospital sees its own score breakdown** and can appeal any event.

### Scorecard (100 points)

| Area                         | Metric                    | How it is measured                                                                                          | Points |
| ---------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| **Responsiveness** (25)      | Answers incoming requests | Share of broadcasts answered inside the 2.5-min window                                                      | 10     |
|                              | Approval speed            | Median time from "selected" to approve/decline                                                              | 10     |
|                              | No silent timeouts        | Share of selections that hit the 5-min sender timeout                                                       | 5      |
| **Inventory accuracy** (25)  | Stock shown was real      | Share of approvals with no "units already taken" conflict and no "received fewer units than offered" report | 15     |
|                              | Stock kept up to date     | Inventory updated within the last 24 h                                                                      | 10     |
| **Delivery** (20)            | On-time arrival           | Share of deliveries arriving within 10 min of planned ETA, excluding incidents outside their control        | 10     |
|                              | Fast dispatch             | Median time from approval to driver dispatched                                                              | 5      |
|                              | Incident handling         | Incidents reported promptly by the driver, not detected by the system                                       | 5      |
| **Cold chain & safety** (15) | Temperature in range      | Share of delivery reports with temperature inside the component's range                                     | 10     |
|                              | Traceability              | Bag numbers complete on every report                                                                        | 5      |
| **Stewardship** (15)         | Wastage rate              | NABH formula, from the inventory module                                                                     | 10     |
|                              | Shares short-dated stock  | Units offered to the network before expiry rather than discarded                                            | 5      |

**Receiving hospitals are scored too**, on a smaller card: delivery report filed within 1 hour, cancellation rate, and requests marked "critical" that later prove routine.

### Bands

| Band   | Score    | Meaning                                                      |
| ------ | -------- | ------------------------------------------------------------ |
| Gold   | 85–100   | Badge on the options card and on the district leaderboard    |
| Silver | 70–84    | Meets the standard (70 matches the Kayakalp award threshold) |
| Watch  | 50–69    | Hospital is notified with a breakdown and tips               |
| Review | below 50 | Enters the human review queue (section 4)                    |

### What the points do

- **Badge** next to the hospital on every options card, so receivers can see reliability.
- **Ranking:** today the scoring formula gives 10% weight to a fixed "hospital tier". We propose replacing it with the performance band. It stays at 10%, so speed still dominates in an emergency.
- **Recognition:** a monthly district leaderboard and certificates. We can propose the score to the SBTC as input for state recognition, but we cannot promise awards.

### Gaming risks and defences

| Risk                                                    | Defence                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Hiding stock to avoid requests                          | Compare declared stock against declines; repeated "decline while holding stock" lowers responsiveness |
| Inflating stock to look generous                        | Conflicts at approval and short deliveries in receiver reports lower inventory accuracy               |
| Receivers filing fake low temperatures to hurt a sender | Temperature is also logged by the driver at pickup (planned); outliers are reviewed, not auto-scored  |

---

## 3. Disease data: what it can and cannot identify

### Today

The request form asks for a **reason category** (surgery/trauma, childbirth bleeding, anaemia, cancer, dengue, thalassaemia, other). No patient name or ID is stored. This was deliberate, to keep the MVP clear of the **Digital Personal Data Protection Act, 2023**.

### What this data can honestly tell us

- **Which conditions drive blood demand, where and when.** Example: platelet requests tagged "dengue" doubling in a district in September.
- **Which hospitals are treating those conditions.** Example: the hospitals that request red cells every 3–4 weeks for thalassaemia. This is the useful reading of "the people dealing with them": the facilities and their care teams, identified at hospital level.

### What it cannot and should not do

- **It is not a diagnosis.** The reason is entered by blood bank staff when ordering blood. Most dengue patients never need platelets, so these counts measure **transfusion demand**, not how common a disease is.
- **It must not identify individual patients.** Tracking named patients across hospitals would make HemoArrive a health-records system. That needs consent through ABDM, a legal basis under DPDP, and security we do not have in an MVP. The research and statistics exemption in DPDP Section 17(2)(b) is expected to be read narrowly. ([Tsaaro](https://tsaaro.com/blogs/regulatory-carve-outs-examining-exemptions-under-the-dpdp-act-2023-and-dpdp-rules-2025), [BioSpectrum](https://www.biospectrumindia.com/views/17/26746/can-dpdpas-research-exemption-power-private-sector-breakthroughs-.html))

### Proposed upgrade

Replace the free reason list with a **controlled list mapped to ICD-10 code blocks**, so our data lines up with national systems:

| Reason shown on the form                 | ICD-10 block      | Usual component       | What a rise signals                       |
| ---------------------------------------- | ----------------- | --------------------- | ----------------------------------------- |
| Dengue                                   | A90–A91           | Platelets             | Outbreak; need for apheresis capacity     |
| Thalassaemia                             | D56               | Red cells (recurring) | Need for day-care centre, chelation drugs |
| Sickle cell disease                      | D57               | Red cells             | Same as above, tribal belts               |
| Anaemia (non-pregnancy)                  | D50–D64           | Red cells             | Nutrition programme gaps                  |
| Bleeding in pregnancy / after childbirth | O44–O46, O67, O72 | Red cells, plasma     | Maternal health risk                      |
| Injury / road accident                   | S00–T14           | Red cells, plasma     | Trauma care gaps on highways              |
| Cancer treatment                         | C00–D48           | Platelets, red cells  | Oncology load                             |
| Planned surgery                          | Z (procedure)     | Red cells             | Routine demand baseline                   |

**Optional extra fields**, needing your decision: patient **age band** (0–14, 15–49, 50+) and **sex**. Useful for maternal and paediatric analysis, but they add personal data. We recommend adding age band only.

### Privacy safeguards (built into every report)

- Data is shown only **aggregated** by district and week; there is never a row per patient.
- **Small-cell suppression:** any count under 5 is shown as "<5", so a rare case in a small district cannot be traced to a person.
- Role-based access: hospitals see their own data; officials see district totals.
- A legal review of DPDP compliance before any real data is collected.

Linking to individual records through **ABHA** with patient consent is possible later through ABDM's consent manager, but it is out of scope for the MVP. ([MediaNama on the ABDM health data policy](https://www.medianama.com/2022/06/223-new-health-data-management-policy/))

---

## 4. Poor performers: review, referral and inspection

### Who actually inspects blood banks

| Body                                          | What it does                                                                                                             | Relevant to us                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **State Drugs Controller + CDSCO**            | Licenses blood centres under the Drugs and Cosmetics Act, 1940 and Rules, 1945; joint inspections; can suspend a licence | **Yes: main referral target for safety issues** ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4260301/), [Free Press Journal](https://www.freepressjournal.in/mumbai/fda-maharashtra-suspends-operations-of-two-blood-centres-over-serious-regulatory-violations)) |
| **State Blood Transfusion Council (SBTC)**    | Implements national blood policy in the state; monitors blood centres; issues the NOC needed for licence renewal         | **Yes: referral target for performance issues** ([UP SBTC](https://sbtcup.org/AboutUs.aspx), [Tripura SBTC](https://tsbtc.tripura.gov.in/node/189))                                                                                                                  |
| **National Blood Transfusion Council (NBTC)** | National policy body; its committee can make annual or surprise monitoring visits                                        | Escalation and national reporting ([DGHS](https://dghs.mohfw.gov.in/bts.php))                                                                                                                                                                                        |
| **NABH**                                      | Voluntary accreditation, quality indicators                                                                              | Share scores with accredited hospitals                                                                                                                                                                                                                               |
| **National Medical Commission**               | Medical education and doctors' registration                                                                              | **No**: not responsible for blood banks ([Drishti IAS](https://www.drishtiias.com/daily-news-analysis/national-medical-commission-3))                                                                                                                                |

Surprise monitoring visits already exist in the NBTC system. HemoArrive's role is to **tell inspectors where to look first**, with evidence.

### Proposed process

HemoArrive recommends; people decide. No hospital is reported automatically.

1. **Flag.** A hospital is flagged if it is in the Review band (below 50) for **two consecutive months**, or immediately for a **red flag**:
   - a cold-chain breach on a delivery report,
   - units arriving expired or with less life than offered,
   - units received differing from units offered,
   - three or more inventory conflicts in a month.
2. **Notice.** The hospital sees its flag and score breakdown and has **15 days to respond** with explanations or corrections.
3. **Review.** An SBTC officer reviews the **evidence pack**: score history, the events behind it, delivery reports and the hospital's response.
4. **Referral.** If the officer agrees, HemoArrive sends the evidence pack to the State Drugs Controller (safety issues) or the SBTC (performance issues) and marks the hospital "Referred". Whether to inspect, and whether the visit is a surprise, is the authority's decision.
5. **Close.** The outcome (no action, corrective plan, inspection result) is recorded and the flag is closed.

### Why not refer automatically

- **False accusations.** Delays caused by traffic or a receiver's error could wrongly hit a sender's score.
- **Hospitals leaving the network.** If joining means automatic reports to regulators, hospitals will hide stock or refuse to join, which hurts patients.
- **Legal exposure.** A software score sent to a regulator without human review could be challenged.

For a real pilot we need a written agreement with the Rajasthan SBTC defining who receives referrals.

---

## 5. Helping allocate medicines by area

### Who allocates today (Rajasthan)

- **RMSCL** (Rajasthan Medical Services Corporation, set up in 2011) buys generic medicines centrally for government facilities and supplies them through **district drug warehouses**. ([CAG audit report](https://cag.gov.in/uploads/download_audit_report/2024/Report-4_Public-Health_English_Inner_curve-compressed---Copy_65-83-067ce928c53a6a1.19135586.pdf), [Vikaspedia](https://en.vikaspedia.in/viewcontent/health/health-care-innovations/health-system-strengthening-1/rajasthan-mukhyamantri-nishulk-dava-y0jana-and-strengthening-of-supply-chain-management-system?lgn=en))
- Stock is tracked in **e-Aushadhi**, an inventory system built by CDAC. ([Elets eGov](https://egov.eletsonline.com/2025/06/e-aushadhi-revolutionises-drug-supply-chains-and-empowered-public-healthcare/))
- Demand comes from the medical directorates each year. We found no public source on how district-level forecasts are made.

### What HemoArrive can add

Blood requests are an **early, local signal** for some medicines and supplies. The clinical links below are for clinical teams to confirm before we use them in the product:

| Signal from HemoArrive                                          | Medicines or supplies it may point to                                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Dengue platelet requests rising above the seasonal baseline     | Apheresis kits, platelet agitators, dengue care supplies                   |
| Steady thalassaemia red-cell requests at a hospital             | Iron-chelation drugs, leucodepletion filters, day-care beds                |
| Bleeding in pregnancy / after childbirth requests in a district | Obstetric haemorrhage drugs (e.g. oxytocin, tranexamic acid), plasma stock |
| Injury requests on a highway corridor                           | Trauma kits, plasma, ambulance coverage                                    |

### How it would work

- A **district demand dashboard**: requests by condition, component and week, with unmet requests highlighted.
- **Early-warning alerts** to the district health officer and SBTC when a condition rises well above its usual level for that week (for example, dengue platelet requests at 2× the 4-week average).
- A **CSV/API export** in a format RMSCL or e-Aushadhi teams can use. In the MVP this is a downloadable file; real integration needs their cooperation.

### Limits

Blood requests are a partial view. They should be combined with **IHIP/IDSP** disease surveillance, which tracks 30+ diseases in near real time ([WHO India](https://www.who.int/india/news/item/14-04-2021-next-gen-digital-platform-launched-pan-india-to-accelerate-outbreak-response)), and with HMIS data. Allocation decisions stay with the health department and RMSCL.

---

## 6. Publishing a government survey

### Where it would be published

- **data.gov.in** under the **National Data Sharing and Accessibility Policy (NDSAP)**, which covers shareable, non-sensitive government data in machine-readable form. It already hosts health datasets, such as the All India Health Centres Directory. ([Wikipedia: NDSAP](https://en.wikipedia.org/wiki/National_Data_Sharing_and_Accessibility_Policy), [data.gov.in](https://data.gov.in/catalog/all-india-health-centres-directory))
- **ICMR**, which set up a disease burden estimation unit in 2020, is the natural research partner for analysis. ([ICMR office order](https://icmr.gov.in/icmrobject/custom_data/1703758785_office_order20102020f.pdf))
- The report would be published by the government partner (SBTC or the health department), not by us.

### Proposed "District Blood & Disease Report" (quarterly)

| Section     | Contents                                                                             |
| ----------- | ------------------------------------------------------------------------------------ |
| Demand      | Units requested by component, blood group and condition (ICD-10 block), per district |
| Access      | Requests fulfilled, unmet, median time from request to delivery, distance travelled  |
| Waste       | Wastage rate by component (NABH formula); units shared before expiry                 |
| Rare blood  | O-negative and other rare stock levels and how often they ran out                    |
| Performance | Hospitals per performance band; names published only if you approve                  |
| Gaps        | Areas where the nearest stock is more than 25 km away; conditions with rising demand |

### How it develops an area

- Shows where a **blood storage centre** or **apheresis machine** would cut travel time most.
- Points **donation camps** at the blood groups and districts that run short.
- Shows where a **thalassaemia day-care centre** would serve the most patients.
- Gives ICMR and the state a measured baseline to check whether interventions work.

Every report uses the same privacy rules as section 3: aggregated, small cells suppressed, no patient data.

---

## 7. Proposed build (needs your approval)

### Phase A — in the simulation MVP

All of this runs on synthetic data, labelled as simulated.

| #   | Feature                                                                                                                                                                 | Where it appears                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| A1  | Hospital Performance Score engine and scorecard per hospital                                                                                                            | New tab "Performance" + badge on option cards |
| A2  | ICD-10 mapped reason list (+ optional age band)                                                                                                                         | Request form                                  |
| A3  | District demand dashboard with seasonal early warning                                                                                                                   | New tab "Disease & demand"                    |
| A4  | Review queue: flag → notice → response → SBTC review → referral, with evidence pack                                                                                     | Admin view                                    |
| A5  | Quarterly report generator (on-screen + CSV download)                                                                                                                   | Admin view                                    |
| A6  | Simulator additions: dengue season, recurring thalassaemia requests, two "problem" hospitals (stock that is not real, a cold-chain breach) so flags can be demonstrated | Simulator                                     |

**The driver app screen**, started before this feedback, is paused and can resume after Phase A or alongside it.

### Phase B — before a real pilot (needs partners)

- An agreement with the **Rajasthan SBTC** on referrals and report publication.
- Legal review for **DPDP Act** compliance.
- Data-sharing talks with **RMSCL / e-Aushadhi** and **IHIP**.
- Integration with **e-RaktKosh** for real inventory.

### Out of scope

Patient identity, automatic referrals or inspections, and making medicine allocation decisions.

---

## 8. Decisions needed

- [ ] **Referral targets:** agree to send safety issues to the State Drugs Controller and performance issues to the SBTC, instead of the medical council?
- [ ] **Score weights:** approve the 100-point scorecard in section 2, or change the weights?
- [ ] **Score in ranking:** let the performance band replace the 10% "tier" weight in option ranking, or show it as a badge only?
- [ ] **Public names:** publish hospital names with bands in reports, or bands only?
- [ ] **Extra patient fields:** add age band? Add sex?
- [ ] **Build order:** Phase A before the driver app, or alongside it?

---

## Sources

- [IndiaSpend — India 60 tankers short of blood in 2016-17](https://www.indiaspend.com/india-60-tankers-short-of-blood-in-2016-17-as-shortage-increases-53935)
- [Daily Pioneer — Blood supply in India runs short of 41 million units](https://www.dailypioneer.com/2019/india/blood-supply-in-india-runs-short-of-41-million-units.html)
- [ISBT Transfusion Today — Unmet needs (2025)](https://isbtweb.foleon.com/transfusion-today/transfusion-today-july-2025-copy-1/unmet-needs)
- [The Quint — Blood shortage in India](https://www.thequint.com/amp/story/fit/blood-shortage-in-india)
- [MSJ Online — Discard of blood units](https://www.msjonline.org/index.php/ijrms/article/download/13332/8600/61253)
- [AJPCR — Blood component discard, Punjab](https://www.journals.innovareacademics.in/index.php/ajpcr/article/download/53772/31656/253063)
- [Down To Earth — PPH leading cause of maternal deaths](https://www.downtoearth.org.in/news/health/postpartum-haemorrhage-remains-leading-cause-of-maternal-deaths-in-kerala-report-81873)
- [Tribune — India has largest number of kids with thalassemia major](https://www.tribuneindia.com/news/health/india-has-largest-number-of-kids-with-thalassemia-major-127968/amp)
- [Medical Dialogues — Delhi govt on thalassemia](https://medicaldialogues.in/delhi-govt-takes-step-to-sensitise-students-about-thalassemia)
- [Punekar News — Pune blood shortage amid dengue](https://www.punekarnews.in/?p=244156)
- [Deccan Herald — Platelets scarce in Karnataka](https://www.deccanherald.com/amp/story/india%2Fkarnataka%2Fplatelets-in-state-scarce-dengue-patients-hit-744174.html)
- [Tribune — Karnal dengue surge](https://m.tribuneindia.com/news/haryana/karnal-sees-surge-in-dengue-cases-334522)
- [Revised Kayakalp Guidelines (NHM)](https://nhm.gov.in/images/pdf/in-focus/Revised_Kayakalp_Guidelines.pdf)
- [NABH — Quality Indicators, Blood Bank](https://testing.nabh.co/wp-content/uploads/2025/07/Quality-Indicators_Blood-Bank.pdf)
- [ETV Bharat — Rajasthan free medicine scheme, DVDMS ranking](https://etvbharat.com/en/!state/rajasthan-free-medicine-scheme-drugs-and-vaccines-enn24072700657)
- [Tsaaro — Exemptions under DPDP Act 2023 and Rules 2025](https://tsaaro.com/blogs/regulatory-carve-outs-examining-exemptions-under-the-dpdp-act-2023-and-dpdp-rules-2025)
- [BioSpectrum — DPDPA research exemption](https://www.biospectrumindia.com/views/17/26746/can-dpdpas-research-exemption-power-private-sector-breakthroughs-.html)
- [MediaNama — ABDM Health Data Management Policy](https://www.medianama.com/2022/06/223-new-health-data-management-policy/)
- [PMC — Blood bank licensing process in India](https://pmc.ncbi.nlm.nih.gov/articles/PMC4260301/)
- [Free Press Journal — FDA Maharashtra suspends two blood centres](https://www.freepressjournal.in/mumbai/fda-maharashtra-suspends-operations-of-two-blood-centres-over-serious-regulatory-violations)
- [UP SBTC — About us](https://sbtcup.org/AboutUs.aspx)
- [Tripura SBTC](https://tsbtc.tripura.gov.in/node/189)
- [DGHS — Blood transfusion services](https://dghs.mohfw.gov.in/bts.php)
- [Drishti IAS — National Medical Commission](https://www.drishtiias.com/daily-news-analysis/national-medical-commission-3)
- [CAG — Public health audit report, Rajasthan (2024)](https://cag.gov.in/uploads/download_audit_report/2024/Report-4_Public-Health_English_Inner_curve-compressed---Copy_65-83-067ce928c53a6a1.19135586.pdf)
- [Vikaspedia — Rajasthan Mukhyamantri Nishulk Dava Yojana](https://en.vikaspedia.in/viewcontent/health/health-care-innovations/health-system-strengthening-1/rajasthan-mukhyamantri-nishulk-dava-y0jana-and-strengthening-of-supply-chain-management-system?lgn=en)
- [Elets eGov — e-Aushadhi](https://egov.eletsonline.com/2025/06/e-aushadhi-revolutionises-drug-supply-chains-and-empowered-public-healthcare/)
- [WHO India — IHIP launch](https://www.who.int/india/news/item/14-04-2021-next-gen-digital-platform-launched-pan-india-to-accelerate-outbreak-response)
- [Wikipedia — National Data Sharing and Accessibility Policy](https://en.wikipedia.org/wiki/National_Data_Sharing_and_Accessibility_Policy)
- [data.gov.in — All India Health Centres Directory](https://data.gov.in/catalog/all-india-health-centres-directory)
- [ICMR — Office order on disease burden unit (2020)](https://icmr.gov.in/icmrobject/custom_data/1703758785_office_order20102020f.pdf)
