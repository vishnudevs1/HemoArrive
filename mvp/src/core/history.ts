// Network history: what the platform has observed over time.
// Two kinds of record:
//  - Obs: one observation about one organisation (feeds the Hospital Performance Score)
//  - PastRequest: one blood request and its outcome (feeds the planning dashboard)
// The MVP seeds 90 days of synthetic history; live requests in the app append to it.

import { BLOOD_GROUPS, GROUP_WEIGHTS, type BloodGroup, type ComponentCode } from './blood';
import { CONDITIONS, type ConditionCode } from './conditions';
import { zoneOf } from './city';
import { haversine } from './geo';
import { mulberry32, normal, pickWeighted, poisson, randInt, type Rng } from './rng';
import type { Org, Urgency } from './types';

export const DAY = 24 * 3600_000;
export const HISTORY_DAYS = 90;

export type ObsBody =
  /** sender: was a broadcast with matching stock answered inside the window? */
  | { k: 'broadcast'; answered: boolean }
  /** sender: answer to a selection (approve/decline) or a 5-min timeout */
  | { k: 'selected'; answerMin: number | null; timedOut: boolean }
  /** sender: approved — were the units really there? */
  | { k: 'approval'; conflict: boolean }
  /** sender: a delivery leg finished */
  | { k: 'delivery'; lateMin: number; excused: boolean; dispatchMin: number; incident: 'none' | 'driver' | 'system' }
  /** sender: what the receiver's report said about this delivery */
  | { k: 'report_in'; tempOk: boolean; bagsOk: boolean; short: boolean }
  /** sender: inventory updated */
  | { k: 'inventory_update' }
  /** sender: a week of stock stewardship */
  | { k: 'stock_week'; prepared: number; discarded: number; sharedBeforeExpiry: number }
  /** receiver: report filed, minutes after confirming receipt */
  | { k: 'report_filed'; minutes: number }
  /** receiver: request cancelled */
  | { k: 'cancel' }
  /** receiver: a critical request reviewed later — was it really routine? */
  | { k: 'urgency_check'; overstated: boolean };

export type Obs = ObsBody & { id: number; orgId: string; at: number; requestId?: string; appealed?: boolean; note?: string };

export interface PastRequest {
  id: string;
  at: number;
  receiverOrgId: string;
  condition: ConditionCode;
  component: ComponentCode;
  group: BloodGroup;
  units: number;
  urgency: Urgency;
  outcome: 'fulfilled' | 'unmet' | 'cancelled';
  supplierOrgId?: string;
  minutesToDelivery?: number;
  distanceKm?: number;
}

export interface History {
  obs: Obs[];
  requests: PastRequest[];
}

interface Profile {
  answerRate: number;
  answerMin: number;
  timeoutRate: number;
  conflictRate: number;
  shortRate: number;
  onTimeRate: number;
  dispatchMin: number;
  driverReports: number;
  tempOkRate: number;
  bagsOkRate: number;
  wastage: number;
  shareRate: number;
  inventoryEveryDays: number;
  reportOnTime: number;
  cancelRate: number;
  overstated: number;
}

/** Hospitals with deliberately poor behaviour, so the score and its flags can be demonstrated. */
export const PROBLEM_ORGS: Record<string, string> = {
  'org-jamdoli': 'shows stock it does not have (frequent conflicts, short deliveries, stale inventory)',
  'org-murlipura': 'slow dispatch, late deliveries and cold-chain breaches',
};

function profileFor(org: Org, rng: Rng): Profile {
  const u = (a: number, b: number) => a + rng() * (b - a);
  const p: Profile = {
    answerRate: u(0.86, 0.99),
    answerMin: u(1, 3.5),
    timeoutRate: u(0, 0.06),
    conflictRate: u(0, 0.04),
    shortRate: u(0, 0.03),
    onTimeRate: u(0.82, 0.98),
    dispatchMin: u(5, 14),
    driverReports: u(0.75, 1),
    tempOkRate: u(0.94, 1),
    bagsOkRate: u(0.9, 1),
    wastage: u(0.03, 0.12),
    shareRate: u(0.25, 0.75),
    inventoryEveryDays: 1,
    reportOnTime: u(0.85, 1),
    cancelRate: u(0, 0.07),
    overstated: u(0, 0.1),
  };
  if (org.id === 'org-jamdoli') Object.assign(p, { answerRate: 0.7, conflictRate: 0.3, shortRate: 0.2, inventoryEveryDays: 6, wastage: 0.16, shareRate: 0.1 });
  if (org.id === 'org-murlipura') Object.assign(p, { onTimeRate: 0.5, dispatchMin: 32, tempOkRate: 0.68, bagsOkRate: 0.7, driverReports: 0.3, timeoutRate: 0.18, answerMin: 4.5 });
  return p;
}

/** Dengue season: rises from August, peaks early October. */
function dengueFactor(t: number): number {
  const d = new Date(t);
  const dayOfYear = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY;
  const peak = 278; // ~5 October
  return 0.3 + 4 * Math.exp(-(((dayOfYear - peak) / 25) ** 2));
}

const OUTER_AREAS = new Set(['Chaksu', 'Bagru', 'Kanota', 'Achrol', 'Chomu', 'Bassi', 'Kalwar']);
const BASE_CONDITION_WEIGHTS: Record<ConditionCode, number> = {
  injury: 20, obstetric: 18, surgery: 20, anaemia: 12, thalassaemia: 0, sickle_cell: 2, dengue: 6, cancer: 8,
};
/** Hospitals running thalassaemia day-care: recurring requests every week. */
const THAL_PER_WEEK: Record<string, number> = { 'org-gopalpura': 5, 'org-malviya': 3, 'org-banipark': 1, 'org-chomu': 2 };

export function generateHistory(orgs: Org[], now: number, seed = 11): History {
  const rng = mulberry32(seed);
  const verified = orgs.filter((o) => o.verified);
  const profiles = new Map(orgs.map((o) => [o.id, profileFor(o, rng)]));
  const obs: Obs[] = [];
  const requests: PastRequest[] = [];
  let oid = 1;
  let rid = 1;
  const push = (orgId: string, at: number, body: ObsBody, requestId?: string) => obs.push({ ...body, id: oid++, orgId, at, requestId });
  const start = now - HISTORY_DAYS * DAY;

  for (let day = 0; day < HISTORY_DAYS; day++) {
    const dayStart = start + day * DAY;
    const dengue = dengueFactor(dayStart);
    const lastWeek = day >= HISTORY_DAYS - 7;

    // stock stewardship and inventory updates
    for (const o of verified) {
      const p = profiles.get(o.id)!;
      if (day % p.inventoryEveryDays === 0 && rng() < 0.97) push(o.id, dayStart + 9 * 3600_000, { k: 'inventory_update' });
      if (day % 7 === 6) {
        const prepared = o.type === 'blood_bank' ? randInt(rng, 50, 80) : randInt(rng, 10, 25);
        const atRisk = Math.round(prepared * p.wastage * (1 + p.shareRate));
        const shared = Math.round(atRisk * p.shareRate);
        push(o.id, dayStart + 20 * 3600_000, { k: 'stock_week', prepared, discarded: atRisk - shared, sharedBeforeExpiry: shared });
      }
    }

    // requests from hospitals
    for (const o of verified) {
      if (o.type !== 'hospital') continue;
      const rate = o.tier === 1 ? 0.75 : o.tier === 2 ? 0.45 : 0.25;
      const conds: { c: ConditionCode; n: number }[] = [];
      const weights = { ...BASE_CONDITION_WEIGHTS, dengue: BASE_CONDITION_WEIGHTS.dengue * dengue };
      // localised dengue outbreak in the South zone over the last week
      if (lastWeek && zoneOf(o.area) === 'South') weights.dengue *= 3;
      const total = Object.values(weights).reduce((a, b) => a + b, 0);
      const k = poisson(rng, rate * (total / 86));
      for (let i = 0; i < k; i++) conds.push({ c: pickWeighted(rng, CONDITIONS.map((x) => x.code), CONDITIONS.map((x) => weights[x.code])), n: 1 });
      const thal = THAL_PER_WEEK[o.id] ?? 0;
      if (thal) for (let i = 0; i < poisson(rng, thal / 7); i++) conds.push({ c: 'thalassaemia', n: 1 });

      for (const { c } of conds) {
        const at = dayStart + (7 + rng() * 14) * 3600_000;
        const cond = CONDITIONS.find((x) => x.code === c)!;
        const comps = Object.keys(cond.components) as ComponentCode[];
        const component = pickWeighted(rng, comps, comps.map((x) => cond.components[x]!));
        const group = pickWeighted(rng, BLOOD_GROUPS, BLOOD_GROUPS.map((g) => GROUP_WEIGHTS[g]));
        const urgency = pickWeighted<Urgency>(rng, ['routine', 'urgent', 'critical'], c === 'thalassaemia' || c === 'surgery' ? [80, 18, 2] : [35, 40, 25]);
        const units = c === 'thalassaemia' ? randInt(rng, 1, 2) : randInt(rng, 1, 3);
        simulateRequest(o, { at, condition: c, component, group, urgency, units, dengue });
      }
    }
  }
  return { obs, requests };

  function simulateRequest(
    receiver: Org,
    r: { at: number; condition: ConditionCode; component: ComponentCode; group: BloodGroup; urgency: Urgency; units: number; dengue: number },
  ) {
    const id = `H-${rid++}`;
    const rp = profiles.get(receiver.id)!;
    const near = verified
      .filter((o) => o.id !== receiver.id)
      .map((o) => ({ o, km: (haversine(o.location, receiver.location) / 1000) * 1.3 }))
      .sort((a, b) => a.km - b.km);

    // broadcasts to the nearest hospitals with stock
    const alerted = near.slice(0, 6);
    for (const { o } of alerted) push(o.id, r.at + 60_000, { k: 'broadcast', answered: rng() < profiles.get(o.id)!.answerRate }, id);

    if (r.urgency === 'critical') push(receiver.id, r.at + 2 * DAY, { k: 'urgency_check', overstated: rng() < rp.overstated }, id);

    if (rng() < rp.cancelRate) {
      push(receiver.id, r.at + 30 * 60_000, { k: 'cancel' }, id);
      requests.push({ ...pick(r), id, receiverOrgId: receiver.id, outcome: 'cancelled' });
      return;
    }

    // chance that no usable stock is found in reach
    let unmet = 0.03;
    if (r.group.endsWith('-')) unmet += 0.12;
    if (r.component === 'PLT') unmet += 0.04 * r.dengue;
    if (OUTER_AREAS.has(receiver.area)) unmet += 0.08;
    if (rng() < Math.min(unmet, 0.6)) {
      requests.push({ ...pick(r), id, receiverOrgId: receiver.id, outcome: 'unmet' });
      return;
    }

    // supplier: usually one of the 3 nearest; a hospital advertising stock it doesn't have gets picked more often
    const ghost = alerted.find((a) => a.o.id === 'org-jamdoli');
    const { o: sender, km } = ghost && rng() < 0.4 ? ghost : near[Math.min(Math.floor(rng() ** 2 * 3), near.length - 1)];
    const sp = profiles.get(sender.id)!;
    const timedOut = rng() < sp.timeoutRate;
    push(sender.id, r.at + 3 * 60_000, { k: 'selected', answerMin: timedOut ? null : Math.max(0.3, sp.answerMin * Math.exp(normal(rng) * 0.4)), timedOut }, id);
    const conflict = rng() < sp.conflictRate;
    push(sender.id, r.at + 6 * 60_000, { k: 'approval', conflict }, id);

    const dispatchMin = Math.max(1, sp.dispatchMin * Math.exp(normal(rng) * 0.35));
    const travelMin = 2 + (km / 30) * 60 * Math.exp(normal(rng) * 0.2);
    const onTime = rng() < sp.onTimeRate;
    const lateMin = onTime ? rng() * 8 : 11 + rng() * 30;
    const incidentRoll = rng();
    const incident = incidentRoll < 0.04 ? (rng() < sp.driverReports ? 'driver' : 'system') : 'none';
    const excused = !onTime && rng() < 0.25; // e.g. traffic outside the sender's control
    const minutesToDelivery = 8 + dispatchMin + travelMin + lateMin;
    push(sender.id, r.at + minutesToDelivery * 60_000, { k: 'delivery', lateMin, excused, dispatchMin, incident }, id);

    const tempOk = rng() < sp.tempOkRate;
    push(sender.id, r.at + (minutesToDelivery + 30) * 60_000, { k: 'report_in', tempOk, bagsOk: rng() < sp.bagsOkRate, short: rng() < sp.shortRate }, id);
    const reportMin = rng() < rp.reportOnTime ? 5 + rng() * 50 : 65 + rng() * 120;
    push(receiver.id, r.at + (minutesToDelivery + reportMin) * 60_000, { k: 'report_filed', minutes: reportMin }, id);

    requests.push({ ...pick(r), id, receiverOrgId: receiver.id, outcome: 'fulfilled', supplierOrgId: sender.id, minutesToDelivery, distanceKm: km });
  }

  function pick(r: { at: number; condition: ConditionCode; component: ComponentCode; group: BloodGroup; urgency: Urgency; units: number }) {
    return { at: r.at, condition: r.condition, component: r.component, group: r.group, urgency: r.urgency, units: r.units };
  }
}
