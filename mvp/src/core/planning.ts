// Data for planning (proposal points 3, 5 and 6): where blood is needed, for which conditions,
// and where requests go unmet. Aggregated only — counts under 5 are suppressed so no one can be
// traced. Suggestions are for health officials; decisions stay with them.

import { CONDITIONS, conditionOf, type ConditionCode } from './conditions';
import { ZONES, zoneOf, type Zone } from './city';
import { DAY, type PastRequest } from './history';
import type { Org } from './types';
import type { BloodGroup, ComponentCode } from './blood';

export const SUPPRESS_BELOW = 5;
export const suppress = (n: number): string => (n > 0 && n < SUPPRESS_BELOW ? `<${SUPPRESS_BELOW}` : String(n));

export interface Filters {
  days: number;
  condition: ConditionCode | 'all';
  component: ComponentCode | 'all';
}

export interface AreaRow {
  key: string;
  zone: Zone;
  requests: number;
  units: number;
  fulfilled: number;
  unmet: number;
  unmetRate: number;
  medianMinutes: number | null;
  medianKm: number | null;
}

export interface Warning {
  zone: Zone;
  condition: ConditionCode;
  last7: number;
  weeklyAvg: number;
  ratio: number;
}

export interface Suggestion {
  kind: 'storage' | 'camp' | 'apheresis' | 'daycare';
  title: string;
  where: string;
  evidence: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function filterRequests(all: PastRequest[], f: Filters, now: number) {
  return all.filter(
    (r) => r.at > now - f.days * DAY && r.at <= now && (f.condition === 'all' || r.condition === f.condition) && (f.component === 'all' || r.component === f.component),
  );
}

function rowFor(key: string, zone: Zone, rs: PastRequest[]): AreaRow {
  const done = rs.filter((r) => r.outcome !== 'cancelled');
  const fulfilled = done.filter((r) => r.outcome === 'fulfilled');
  const unmet = done.filter((r) => r.outcome === 'unmet').length;
  return {
    key,
    zone,
    requests: rs.length,
    units: rs.reduce((a, r) => a + r.units, 0),
    fulfilled: fulfilled.length,
    unmet,
    unmetRate: done.length ? unmet / done.length : 0,
    medianMinutes: median(fulfilled.map((r) => r.minutesToDelivery!)),
    medianKm: median(fulfilled.map((r) => r.distanceKm!)),
  };
}

export function byZone(rs: PastRequest[], orgs: Org[]): AreaRow[] {
  const zoneOfOrg = (id: string) => zoneOf(orgs.find((o) => o.id === id)!.area);
  return ZONES.map((z) => rowFor(z, z, rs.filter((r) => zoneOfOrg(r.receiverOrgId) === z)));
}

/** One row per requesting hospital's locality (for the map). */
export function byLocality(rs: PastRequest[], orgs: Org[]): (AreaRow & { org: Org })[] {
  return orgs
    .filter((o) => o.type === 'hospital')
    .map((o) => ({ ...rowFor(o.area, zoneOf(o.area), rs.filter((r) => r.receiverOrgId === o.id)), org: o }))
    .filter((r) => r.requests > 0);
}

export function byCondition(rs: PastRequest[]) {
  return CONDITIONS.map((c) => {
    const x = rs.filter((r) => r.condition === c.code);
    return { condition: c, requests: x.length, units: x.reduce((a, r) => a + r.units, 0), unmet: x.filter((r) => r.outcome === 'unmet').length };
  }).sort((a, b) => b.requests - a.requests);
}

export function unmetByGroup(rs: PastRequest[]): { group: BloodGroup; units: number }[] {
  const map = new Map<BloodGroup, number>();
  for (const r of rs) if (r.outcome === 'unmet') map.set(r.group, (map.get(r.group) ?? 0) + r.units);
  return [...map.entries()].map(([group, units]) => ({ group, units })).sort((a, b) => b.units - a.units);
}

/** Requests per week for the last `weeks` weeks (oldest first). */
export function weekly(rs: PastRequest[], now: number, weeks = 13) {
  return Array.from({ length: weeks }, (_, i) => {
    const end = now - (weeks - 1 - i) * 7 * DAY;
    const x = rs.filter((r) => r.at > end - 7 * DAY && r.at <= end);
    return { end, requests: x.length, unmet: x.filter((r) => r.outcome === 'unmet').length };
  });
}

/** Early warning: a condition in a zone this week is at least 2× its average of the previous 4 weeks. */
export function warnings(all: PastRequest[], orgs: Org[], now: number): Warning[] {
  const zoneOfOrg = (id: string) => zoneOf(orgs.find((o) => o.id === id)!.area);
  const out: Warning[] = [];
  for (const z of ZONES) {
    for (const c of CONDITIONS) {
      const x = all.filter((r) => r.condition === c.code && zoneOfOrg(r.receiverOrgId) === z);
      const last7 = x.filter((r) => r.at > now - 7 * DAY && r.at <= now).length;
      const prev = x.filter((r) => r.at > now - 35 * DAY && r.at <= now - 7 * DAY).length / 4;
      if (last7 >= SUPPRESS_BELOW && last7 >= 2 * Math.max(prev, 1)) out.push({ zone: z, condition: c.code, last7, weeklyAvg: prev, ratio: last7 / Math.max(prev, 1) });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

/** Rule-based suggestions for officials, each with the evidence behind it. */
export function suggestions(rs: PastRequest[], orgs: Org[]): Suggestion[] {
  const out: Suggestion[] = [];
  const zones = byZone(rs, orgs);
  const localities = byLocality(rs, orgs);

  // Blood storage centre: localities where blood takes longest to arrive
  const slow = localities.filter((l) => l.fulfilled >= SUPPRESS_BELOW && (l.medianMinutes ?? 0) >= 45).sort((a, b) => (b.medianMinutes ?? 0) - (a.medianMinutes ?? 0));
  for (const l of slow.slice(0, 2)) {
    out.push({
      kind: 'storage',
      title: 'Consider a blood storage centre',
      where: `${l.key} (${l.zone} zone)`,
      evidence: `${l.requests} requests; blood took a median ${Math.round(l.medianMinutes!)} min over ${l.medianKm!.toFixed(0)} km; ${Math.round(l.unmetRate * 100)}% went unmet.`,
    });
  }

  // Donation camp: blood groups with most unmet units, in the zone where they are most unmet
  const groups = unmetByGroup(rs).slice(0, 2);
  for (const g of groups) {
    if (g.units < SUPPRESS_BELOW) continue;
    const worst = zones
      .map((z) => ({ z: z.zone, u: rs.filter((r) => r.outcome === 'unmet' && r.group === g.group && zoneOf(orgs.find((o) => o.id === r.receiverOrgId)!.area) === z.zone).reduce((a, r) => a + r.units, 0) }))
      .sort((a, b) => b.u - a.u)[0];
    out.push({
      kind: 'camp',
      title: `Donation camp for ${g.group}`,
      where: `${worst.z} zone`,
      evidence: `${g.units} unit(s) of ${g.group} could not be found in time across the city; ${suppress(worst.u)} of them in the ${worst.z} zone.`,
    });
  }

  // Apheresis machine: zone with the most dengue platelet requests
  const dengue = zones
    .map((z) => ({ z, n: rs.filter((r) => r.condition === 'dengue' && r.component === 'PLT' && zoneOf(orgs.find((o) => o.id === r.receiverOrgId)!.area) === z.zone) }))
    .sort((a, b) => b.n.length - a.n.length)[0];
  if (dengue && dengue.n.length >= 10) {
    const unmet = dengue.n.filter((r) => r.outcome === 'unmet').length;
    out.push({
      kind: 'apheresis',
      title: 'Add apheresis (single-donor platelet) capacity',
      where: `${dengue.z.zone} zone`,
      evidence: `${dengue.n.length} dengue platelet requests, ${suppress(unmet)} unmet. Platelets last only 5 days, so local collection matters most in dengue season.`,
    });
  }

  // Thalassaemia day-care: hospitals with recurring thalassaemia requests
  const weeks = Math.max(1, (Math.max(...rs.map((r) => r.at)) - Math.min(...rs.map((r) => r.at))) / (7 * 24 * 3600_000));
  const thal = orgs
    .filter((o) => o.type === 'hospital')
    .map((o) => ({ o, n: rs.filter((r) => r.condition === 'thalassaemia' && r.receiverOrgId === o.id).length }))
    .filter((x) => x.n / weeks >= 1.5)
    .sort((a, b) => b.n - a.n);
  for (const t of thal.slice(0, 2)) {
    out.push({
      kind: 'daycare',
      title: 'Support a thalassaemia day-care centre',
      where: `${t.o.name}, ${t.o.area}`,
      evidence: `About ${(t.n / weeks).toFixed(1)} thalassaemia transfusion requests a week — a steady group of patients who need blood every 3–4 weeks.`,
    });
  }
  return out;
}

/** CSV for the district report: zone × condition, with small counts suppressed. */
export function reportCsv(rs: PastRequest[], orgs: Org[], f: Filters): string {
  const zoneOfOrg = (id: string) => zoneOf(orgs.find((o) => o.id === id)!.area);
  const lines = [`# HemoArrive district blood & disease report (simulated data), last ${f.days} days. Counts under ${SUPPRESS_BELOW} shown as <${SUPPRESS_BELOW}.`];
  lines.push('zone,condition,icd10,requests,units,fulfilled,unmet');
  for (const z of ZONES) {
    for (const c of CONDITIONS) {
      const x = rs.filter((r) => r.condition === c.code && zoneOfOrg(r.receiverOrgId) === z);
      if (!x.length) continue;
      const cell = (n: number) => suppress(n);
      lines.push(
        [z, `"${conditionOf(c.code).label}"`, `"${c.icd}"`, cell(x.length), cell(x.reduce((a, r) => a + r.units, 0)), cell(x.filter((r) => r.outcome === 'fulfilled').length), cell(x.filter((r) => r.outcome === 'unmet').length)].join(','),
      );
    }
  }
  return lines.join('\n');
}
