# HemoArrive — User Flow Documentation

Oct 15, 2026 · @Vishnu Kumar

## Roles and entry points

Four people touch a HemoArrive request: the receiver who needs blood, the sender who has it, the driver who carries it, and the admin who keeps the network trusted. One hospital account can act as both receiver and sender; the role is set by who raised the request.

| Role | Who in real life | Device | Starts at | Main goal |
| --- | --- | --- | --- | --- |
| Receiver | Blood bank officer or ward staff at the hospital in need | Desktop / tablet | Dashboard → New request | Get the right units, fast, with proof of delivery |
| Sender | Blood bank officer at the hospital with stock | Desktop | Dashboard → Incoming requests | Approve safely without losing stock control |
| Driver | Hospital ambulance or courier staff | Phone (PWA) | Driver app → Today's jobs | Pick up, deliver, report problems |
| Admin | HemoArrive platform team | Desktop | Admin → Verification queue | Only verified hospitals on the network; watch live requests |
| Demo operator | Team member during a demo | Desktop | Admin → Simulator | Run a scenario and inject failures |

## Onboarding

A hospital can browse its own dashboard right after signup but cannot send or receive blood until an admin verifies its licence. This keeps unverified sources out of the network.

1. **Sign up** — hospital admin enters name, email, phone, password. Email verification link sent.
2. **Organisation details** — hospital or blood bank, licence number, address. Address is geocoded and shown as a pin to confirm; the admin can drag it to the exact gate.
3. **Upload licence** — PDF or photo of the blood bank licence. Status becomes *Pending verification*.
4. **Add team** — invite staff (email) and drivers (phone number). Drivers get an SMS link to install the PWA and log in with OTP.
5. **Add inventory** — enter lots (group, component, units, collected and expiry dates) or upload a CSV. The dashboard shows stock by group immediately.
6. **Verified** — when an admin approves, the hospital gets an email and push; New request and Incoming requests unlock.

**Empty states to design:** no inventory yet (CTA: add first lot), pending verification (banner explaining what is locked and why), no drivers yet (sender cannot dispatch — prompt to invite).

## Receiver flow

The receiver's job is three decisions: what is needed, which offer to take, and confirming what arrived. Everything between is watching, so those screens must be calm and readable at a glance.

| # | Screen | Receiver does | System does | Receiver sees |
| --- | --- | --- | --- | --- |
| 1 | Dashboard | Taps **New request** | — | Request form |
| 2 | New request | Picks blood group, component, units, reason category, urgency (Routine / Urgent / Critical); confirms delivery location | Validates; uses hospital's saved location, GPS as fallback | Summary to confirm |
| 3 | Confirm | Taps **Find blood** | Creates request, broadcasts to verified hospitals within 10 km, widens to 25 and 50 km if needed | Searching screen with countdown (2–3 min) and live count: "7 hospitals notified, 3 have stock" |
| 4 | Searching | Waits (can cancel) | Collects offers as they arrive | Offers appear live, best first |
| 5 | Options | Compares up to 5 options and taps **Request from this hospital** | Sends request to that sender; starts 5 min answer timer | Each card: hospital, distance, ETA, units available, nearest expiry, verified badge; compatible substitutes in a separate labelled list |
| 6 | Awaiting approval | Waits | Notifies sender | "Waiting for City Hospital — 4:12 left"; button to choose another option |
| 7 | Approved | — | Reserves lots; sender dispatches | "Approved — driver being assigned" |
| 8 | Track | Watches; can call the driver or sender | Streams GPS every 5 s, recomputes ETA every 30 s | Live map with route, vehicle, ETA, driver name + call button, status timeline |
| 9 | Arrived | Taps **Confirm received** | Marks delivered | Mandatory report form |
| 10 | Delivery report | Enters units received, bag numbers, temperature on arrival, condition; photo of bags; signature | Saves report; closes request; releases lots as issued | "Request closed" with full timeline and downloadable record |

**Design rules for the receiver:** the countdown and ETA are always visible; a critical request never needs more than 4 taps from dashboard to *Find blood*; the report cannot be skipped, but it can be saved as draft and finished within 1 hour.
