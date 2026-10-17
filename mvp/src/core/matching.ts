// Matching: find hospitals with usable stock, build offers, rank them.
// Mirrors the find_suppliers() SQL function and the scoring rule in the architecture doc.

import { COMPONENTS, compatibleDonors, type BloodGroup, type ComponentCode } from './blood';
import { haversine, makeRoute, routeLength, type LatLng } from './geo';
import type { Lot, Offer, Org } from './types';

export const RINGS_KM = [10, 25, 50] as const;
export const MATCH_WINDOW_S = 150; // 2.5 min
export const SENDER_TIMEOUT_S = 300; // 5 min
export const LOAD_S = 120; // packing the cold box
export const SPEED_MPS = 30 / 3.6; // 30 km/h city average
export const MAX_OPTIONS = 5;

export const etaSeconds = (routeM: number) => LOAD_S + routeM / SPEED_MPS;

export interface NeedSpec {
  group: BloodGroup;
  component: ComponentCode;
  units: number;
}

export interface SupplierHit {
  org: Org;
  distanceM: number;
  route: LatLng[];
  etaS: number;
  group: BloodGroup;
  substitute: boolean;
  /** usable lots, soonest-expiring first (first-expiry-first-out) */
  lots: Lot[];
  units: number;
  nearestExpiry: number;
}

/** A lot is usable only if it still has the safety margin left when it arrives. */
export function isUsableOnArrival(lot: Lot, now: number, etaS: number): boolean {
  const marginMs = COMPONENTS[lot.component].marginHours * 3600_000;
  return lot.status === 'available' && lot.expiresAt > now + etaS * 1000 + marginMs;
}

/**
 * Verified organisations within `radiusKm` that hold usable stock of the given donor groups.
 * One hit per (org, donor group).
 */
export function findSuppliers(
  orgs: Org[],
  lots: Lot[],
  destination: LatLng,
  need: NeedSpec,
  radiusKm: number,
  now: number,
  opts: { excludeOrgIds?: string[]; substitutes?: boolean } = {},
): SupplierHit[] {
  const donors = compatibleDonors(need.component, need.group);
  const groups = opts.substitutes ? donors.slice(1) : donors.slice(0, 1);
  const hits: SupplierHit[] = [];
  for (const org of orgs) {
    if (!org.verified || opts.excludeOrgIds?.includes(org.id)) continue;
    const straight = haversine(org.location, destination);
    if (straight > radiusKm * 1000) continue;
    const route = makeRoute(org.location, destination, `${org.id}->${destination.join(',')}`);
    const distanceM = routeLength(route);
    const etaS = etaSeconds(distanceM);
    for (const group of groups) {
      const usable = lots
        .filter((l) => l.orgId === org.id && l.component === need.component && l.group === group && isUsableOnArrival(l, now, etaS))
        .sort((a, b) => a.expiresAt - b.expiresAt);
      const units = usable.reduce((s, l) => s + l.units, 0);
      if (units > 0) {
        hits.push({ org, distanceM, route, etaS, group, substitute: group !== need.group, lots: usable, units, nearestExpiry: usable[0].expiresAt });
      }
    }
  }
  return hits.sort((a, b) => a.distanceM - b.distanceM);
}

/**
 * An offer keeps every usable lot (soonest-expiring first), so availability can be re-read live
 * when other hospitals take stock; `units` is what was available when the offer came in.
 */
export function hitToOffer(hit: SupplierHit, unitsNeeded: number, id: string, lineId = 'L1'): Offer {
  return {
    id,
    lineId,
    supplierOrgId: hit.org.id,
    group: hit.group,
    substitute: hit.substitute,
    lotIds: hit.lots.map((l) => l.id),
    units: Math.min(hit.units, unitsNeeded),
    nearestExpiry: hit.nearestExpiry,
    distanceM: hit.distanceM,
    etaS: hit.etaS,
    route: hit.route,
    score: 0,
    status: 'pending',
  };
}

/**
 * score = 0.6·ETA/ETAmax + 0.2·(1 − offered/needed) + 0.1·expiryRank + 0.1·tier   (lower is better)
 * expiryRank favours lots that expire soonest (but already passed the arrival-margin check).
 */
export function scoreOffers<T extends { etaS: number; units: number; nearestExpiry: number; tier: 1 | 2 | 3 }>(
  offers: T[],
  unitsNeeded: number,
): (T & { score: number })[] {
  if (offers.length === 0) return [];
  const etaMax = Math.max(...offers.map((o) => o.etaS));
  const byExpiry = [...offers].sort((a, b) => a.nearestExpiry - b.nearestExpiry);
  const denom = Math.max(offers.length - 1, 1);
  return offers.map((o) => {
    const expiryRank = byExpiry.indexOf(o) / denom;
    const tierNorm = (o.tier - 1) / 2;
    const shortfall = 1 - Math.min(o.units / unitsNeeded, 1);
    const score = 0.6 * (o.etaS / etaMax) + 0.2 * shortfall + 0.1 * expiryRank + 0.1 * tierNorm;
    return { ...o, score: Math.round(score * 1000) / 1000 };
  });
}

/**
 * Rank offers. `tierOf` supplies the 10% "tier" term — by default the hospital's fixed size tier;
 * the engine passes the performance band instead (Gold 1, Silver/unscored 2, Watch/Review 3).
 */
export function rankOffers(
  offers: Offer[],
  orgs: Org[],
  unitsNeeded: number,
  tierOf: (orgId: string) => 1 | 2 | 3 = (id) => orgs.find((x) => x.id === id)!.tier,
): Offer[] {
  const withTier = offers.map((o) => ({ ...o, tier: tierOf(o.supplierOrgId) }));
  return scoreOffers(withTier, unitsNeeded)
    .map(({ tier: _t, ...o }) => o as Offer)
    .sort((a, b) => a.score - b.score);
}

/** What a phone-call "nearest available" approach would do: nearest org with the group, its oldest lot. */
export function nearestAvailableChoice(orgs: Org[], lots: Lot[], destination: LatLng, need: NeedSpec, radiusKm: number, now: number, excludeOrgIds: string[]) {
  let best: { org: Org; lot: Lot; etaS: number; distanceM: number } | null = null;
  for (const org of orgs) {
    if (!org.verified || excludeOrgIds.includes(org.id)) continue;
    if (haversine(org.location, destination) > radiusKm * 1000) continue;
    const oldest = lots
      .filter((l) => l.orgId === org.id && l.status === 'available' && l.component === need.component && l.group === need.group && l.expiresAt > now)
      .sort((a, b) => a.expiresAt - b.expiresAt)[0];
    if (!oldest) continue;
    const distanceM = routeLength(makeRoute(org.location, destination, `${org.id}->${destination.join(',')}`));
    if (!best || distanceM < best.distanceM) best = { org, lot: oldest, etaS: etaSeconds(distanceM), distanceM };
  }
  if (!best) return null;
  const hoursLeftOnArrival = (best.lot.expiresAt - (now + best.etaS * 1000)) / 3600_000;
  return { ...best, hoursLeftOnArrival, usable: hoursLeftOnArrival > COMPONENTS[need.component].marginHours };
}
