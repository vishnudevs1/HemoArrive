// "Smart vs Nearest" twin simulation (from the BloodStock blueprint).
// The same seeded 72-hour event stream — collections, requests, travel times — is played twice:
// once with a nearest-available planner (how phone coordination works today) and once with the
// HemoArrive planner (arrival-margin check, network-wide first-expiry-first-out, keeps rare units).

import { BLOOD_GROUPS, COMPONENTS, GROUP_WEIGHTS, compatibleDonors, isRare, type BloodGroup, type ComponentCode } from './blood';
import { buildOrgs } from './city';
import { haversine } from './geo';
import { hashString, mulberry32, normal, pickWeighted, poisson, randInt, type Rng } from './rng';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEP = 10 * MIN;
const HORIZON = 72 * HOUR;
const SPEED_KMH = 30;
const ROAD_FACTOR = 1.3;
const PICKUP_MIN = 8;
const P80 = Math.exp(0.84 * 0.25); // 80th percentile of the travel-time noise
/** A unit that arrives with less than this left is treated as unusable (expired in transit). */
const UNUSABLE_LEFT_MS = 2 * HOUR;

export type TwinScenario = 'normal' | 'spike' | 'breakdowns';
export const TWIN_SCENARIOS: Record<TwinScenario, string> = {
  normal: 'Normal 3 days',
  spike: 'Mass-casualty spike (trauma centre, hours 24–36)',
  breakdowns: 'Bad roads (1 in 6 trips badly delayed)',
};

type Urg = 'P1' | 'P2' | 'P3';

interface Unit {
  id: number;
  facility: number;
  component: ComponentCode;
  group: BloodGroup;
  expiresAt: number;
  availableAt: number;
  state: 'available' | 'used' | 'expired';
}

interface Req {
  id: number;
  facility: number;
  component: ComponentCode;
  group: BloodGroup;
  qty: number;
  urgency: Urg;
  createdAt: number;
  needBy: number;
}

interface World {
  facilities: { id: string; loc: [number, number]; bank: boolean; weight: number }[];
  units: Unit[];
  arrivals: Unit[]; // collected during the run (availableAt = collection time)
  requests: Req[];
  travelNoise: (reqId: number, unitFacility: number) => number;
}

export interface PlannerKpi {
  p1OnTime: number; // %
  fillRate: number; // % of requested units delivered on time
  expired: number; // units that expired on the shelf
  expiredInTransit: number; // units that arrived (almost) expired
  oNegMisuse: number;
  km: number;
  trips: number;
  doubleAllocations: number;
  incompatible: number;
}

export interface TwinSummary {
  runs: number;
  requests: number;
  nearest: PlannerKpi & { ci: Partial<Record<keyof PlannerKpi, number>> };
  smart: PlannerKpi & { ci: Partial<Record<keyof PlannerKpi, number>> };
}

function buildWorld(seed: number, scenario: TwinScenario): World {
  const rng = mulberry32(seed);
  const orgs = buildOrgs().filter((o) => o.verified);
  const facilities = orgs.map((o) => ({
    id: o.id,
    loc: o.location,
    bank: o.type === 'blood_bank',
    weight: o.type === 'blood_bank' ? 0 : o.tier === 1 ? 2 : o.tier === 2 ? 1.2 : 0.7,
  }));
  const comps: ComponentCode[] = ['PRBC', 'WB', 'FFP', 'PLT'];
  const sampleGroup = (r: Rng) => pickWeighted(r, BLOOD_GROUPS, BLOOD_GROUPS.map((g) => GROUP_WEIGHTS[g]));
  let uid = 1;
  const units: Unit[] = [];
  facilities.forEach((f, fi) => {
    const n = f.bank ? randInt(rng, 70, 100) : randInt(rng, 10, 22);
    for (let i = 0; i < n; i++) {
      const component = pickWeighted(rng, comps, [50, 5, 20, 25]);
      const shelf = COMPONENTS[component].shelfDays * DAY;
      units.push({ id: uid++, facility: fi, component, group: sampleGroup(rng), expiresAt: rng() * shelf, availableAt: 0, state: 'available' });
    }
  });
  // collections at blood banks (Poisson per hour)
  const arrivals: Unit[] = [];
  for (let t = 0; t < HORIZON; t += HOUR) {
    facilities.forEach((f, fi) => {
      if (!f.bank) return;
      const k = poisson(rng, 0.9);
      for (let i = 0; i < k; i++) {
        const component = pickWeighted(rng, comps, [50, 5, 20, 25]);
        arrivals.push({ id: uid++, facility: fi, component, group: sampleGroup(rng), expiresAt: t + COMPONENTS[component].shelfDays * DAY, availableAt: t, state: 'available' });
      }
    });
  }
  // requests (Poisson per hospital per hour; 10% P1, 30% P2, 60% P3 — stated assumption)
  const trauma = facilities.findIndex((f) => f.id === 'org-banipark');
  const requests: Req[] = [];
  let rid = 1;
  for (let t = 0; t < HORIZON; t += HOUR) {
    facilities.forEach((f, fi) => {
      if (f.bank) return;
      let rate = 0.09 * f.weight;
      if (scenario === 'spike' && fi === trauma && t >= 24 * HOUR && t < 36 * HOUR) rate *= 12;
      const k = poisson(rng, rate);
      for (let i = 0; i < k; i++) {
        const urgency = pickWeighted<Urg>(rng, ['P1', 'P2', 'P3'], [10, 30, 60]);
        const createdAt = t + rng() * HOUR;
        const needBy = createdAt + (urgency === 'P1' ? 1.5 : urgency === 'P2' ? 6 : 24) * HOUR;
        requests.push({
          id: rid++,
          facility: fi,
          component: pickWeighted(rng, comps, [60, 5, 15, 20]),
          group: sampleGroup(rng),
          qty: randInt(rng, 1, 3),
          urgency,
          createdAt,
          needBy,
        });
      }
    });
  }
  requests.sort((a, b) => a.createdAt - b.createdAt);
  const travelNoise = (reqId: number, from: number) => {
    const r = mulberry32(hashString(`${seed}:${reqId}:${from}`));
    let m = Math.exp(normal(r) * 0.25);
    if (scenario === 'breakdowns' && r() < 1 / 6) m *= 2.5 + r() * 2;
    return m;
  };
  return { facilities, units, arrivals, requests, travelNoise };
}

type Planner = 'nearest' | 'smart';

function run(world: World, planner: Planner): PlannerKpi {
  const dist = (a: number, b: number) => (a === b ? 0 : (haversine(world.facilities[a].loc, world.facilities[b].loc) / 1000) * ROAD_FACTOR);
  const travelMin = (a: number, b: number) => (a === b ? 0 : PICKUP_MIN + (dist(a, b) / SPEED_KMH) * 60);

  const units: Unit[] = world.units.map((u) => ({ ...u }));
  const pendingArrivals = world.arrivals.map((u) => ({ ...u }));
  const open: Req[] = [];
  let ri = 0;
  const usedIds = new Set<number>();
  const kpi = { p1Req: 0, p1On: 0, reqUnits: 0, onUnits: 0, expired: 0, expiredInTransit: 0, oNegMisuse: 0, km: 0, trips: 0, doubleAllocations: 0, incompatible: 0 };
  const urgWeight = { P1: 0, P2: 1, P3: 2 };

  for (let now = 0; now <= HORIZON; now += STEP) {
    while (pendingArrivals.length && pendingArrivals[0].availableAt <= now) units.push(pendingArrivals.shift()!);
    while (ri < world.requests.length && world.requests[ri].createdAt <= now) {
      const r = world.requests[ri++];
      open.push({ ...r });
      kpi.reqUnits += r.qty;
      if (r.urgency === 'P1') kpi.p1Req += r.qty;
    }
    // shelf expiry
    for (const u of units) {
      if (u.state === 'available' && u.expiresAt <= now) {
        u.state = 'expired';
        kpi.expired++;
      }
    }
    // serve open requests, most urgent first
    open.sort((a, b) => urgWeight[a.urgency] - urgWeight[b.urgency] || a.needBy - b.needBy);
    for (let i = open.length - 1; i >= 0; i--) {
      const r = open[i];
      if (now > r.needBy) open.splice(i, 1); // missed
    }
    for (const r of [...open]) {
      const donors = compatibleDonors(r.component, r.group);
      const candidates = units.filter((u) => u.state === 'available' && u.component === r.component && donors.includes(u.group));
      let chosen: Unit[] = [];
      if (planner === 'nearest') {
        // closest facility that has a compatible unit; take its oldest units; no expiry-on-arrival check
        const byFacility = new Map<number, Unit[]>();
        for (const u of candidates) byFacility.set(u.facility, [...(byFacility.get(u.facility) ?? []), u]);
        const order = [...byFacility.keys()].sort((a, b) => dist(a, r.facility) - dist(b, r.facility));
        for (const f of order) {
          const list = byFacility.get(f)!.sort((a, b) => a.expiresAt - b.expiresAt);
          for (const u of list) if (chosen.length < r.qty) chosen.push(u);
          if (chosen.length >= r.qty) break;
        }
      } else {
        const margin = COMPONENTS[r.component].marginHours * HOUR;
        const rareInNetwork = candidates.filter((u) => isRare(r.component, u.group)).length || 1;
        const scored = candidates
          .map((u) => {
            const t80 = travelMin(u.facility, r.facility) * (u.facility === r.facility ? 1 : P80) * MIN;
            const arrival = now + t80;
            const feasible = u.expiresAt - arrival >= margin && arrival <= r.needBy;
            const lifeLeftDays = (u.expiresAt - arrival) / DAY;
            const cost =
              (t80 / MIN) * (r.urgency === 'P1' ? 3 : 1) + // travel
              Math.min(lifeLeftDays, 5) * 4 + // prefer short-dated safe units (network-wide FEFO), capped so long-dated stock competes on travel
              (u.group !== r.group ? 25 : 0) + // prefer identical group
              (isRare(r.component, u.group) && !isRare(r.component, r.group) ? 400 / rareInNetwork : 0); // keep rare stock
            return { u, feasible, cost };
          })
          .filter((x) => x.feasible)
          .sort((a, b) => a.cost - b.cost);
        chosen = scored.slice(0, r.qty).map((x) => x.u);
      }
      if (chosen.length === 0) continue;

      const facilitiesUsed = new Set<number>();
      for (const u of chosen) {
        if (usedIds.has(u.id)) kpi.doubleAllocations++;
        usedIds.add(u.id);
        if (!compatibleDonors(r.component, r.group).includes(u.group)) kpi.incompatible++;
        u.state = 'used';
        if (u.group === 'O-' && r.group !== 'O-' && (r.component === 'PRBC' || r.component === 'WB')) kpi.oNegMisuse++;
        const actual = travelMin(u.facility, r.facility) * world.travelNoise(r.id, u.facility) * MIN;
        const arrival = now + actual;
        if (u.expiresAt - arrival < UNUSABLE_LEFT_MS) kpi.expiredInTransit++;
        else if (arrival <= r.needBy) {
          kpi.onUnits++;
          if (r.urgency === 'P1') kpi.p1On++;
        }
        if (u.facility !== r.facility && !facilitiesUsed.has(u.facility)) {
          facilitiesUsed.add(u.facility);
          kpi.trips++;
          kpi.km += dist(u.facility, r.facility);
        }
      }
      r.qty -= chosen.length;
      if (r.qty <= 0) open.splice(open.indexOf(r), 1);
    }
  }
  return {
    p1OnTime: kpi.p1Req ? (kpi.p1On / kpi.p1Req) * 100 : 100,
    fillRate: kpi.reqUnits ? (kpi.onUnits / kpi.reqUnits) * 100 : 100,
    expired: kpi.expired,
    expiredInTransit: kpi.expiredInTransit,
    oNegMisuse: kpi.oNegMisuse,
    km: kpi.km,
    trips: kpi.trips,
    doubleAllocations: kpi.doubleAllocations,
    incompatible: kpi.incompatible,
  };
}

export function runTwin(seed: number, scenario: TwinScenario) {
  const world = buildWorld(seed, scenario);
  return { requests: world.requests.length, nearest: run(world, 'nearest'), smart: run(world, 'smart') };
}

export function summarise(list: PlannerKpi[]) {
  const keys = Object.keys(list[0]) as (keyof PlannerKpi)[];
  const mean = {} as PlannerKpi;
  const ci: Partial<Record<keyof PlannerKpi, number>> = {};
  for (const k of keys) {
    const xs = list.map((x) => x[k]);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(xs.length - 1, 1));
    mean[k] = m;
    ci[k] = (1.96 * sd) / Math.sqrt(xs.length);
  }
  return { ...mean, ci };
}

export function runMany(seeds: number, scenario: TwinScenario, firstSeed = 1): TwinSummary {
  const nearest: PlannerKpi[] = [];
  const smart: PlannerKpi[] = [];
  let requests = 0;
  for (let s = firstSeed; s < firstSeed + seeds; s++) {
    const r = runTwin(s, scenario);
    nearest.push(r.nearest);
    smart.push(r.smart);
    requests += r.requests;
  }
  return { runs: seeds, requests: requests / seeds, nearest: summarise(nearest), smart: summarise(smart) };
}
