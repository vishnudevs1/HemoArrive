// The simulation engine. In production these jobs live in the Node worker (broadcast, closeWindow,
// senderTimeout, etaWatch, reroute); here they run on a simulated clock in the browser so the
// whole loop can be demoed with no backend.
//
// A request has one or more lines (patients). After the matching window HemoArrive suggests a
// supply plan that may split a line across several hospitals; the receiver edits and sends it.
// Each hospital's share is a Part: approved, carried and reported on its own. Other hospitals can
// take stock at the same time; a part whose stock is gone fails and the plan is re-suggested.

import { COMPONENTS, TRANSPORT_TEMP, tempInRange, type BloodGroup, type ComponentCode } from './blood';
import { buildInventory, buildOrgs, DEMO_RECEIVER_ID } from './city';
import { CONDITIONS, type ConditionCode } from './conditions';
import { haversine, makeRoute, pointAlong, routeLength, type LatLng } from './geo';
import { generateHistory, type History, type ObsBody } from './history';
import {
  etaSeconds,
  findSuppliers,
  hitToOffer,
  isUsableOnArrival,
  LOAD_S,
  MATCH_WINDOW_S,
  MAX_OPTIONS,
  rankOffers,
  RINGS_KM,
  SENDER_TIMEOUT_S,
  SPEED_MPS,
  type SupplierHit,
} from './matching';
import { rankTier, scoreAll, type OrgScore } from './performance';
import { decideReroute, DELAY_TRIGGER_S } from './reroute';
import { hashString, mulberry32, pickWeighted, randInt } from './rng';
import type {
  Actor,
  BloodRequest,
  Delivery,
  DeliveryReport,
  Driver,
  Lot,
  LotStatus,
  Offer,
  Org,
  Part,
  RequestLine,
  RerouteDecision,
  TimelineEvent,
  Urgency,
} from './types';

export type Scenario = 'manual' | 'happy' | 'breakdown_early' | 'breakdown_late' | 'delay' | 'mass_casualty' | 'competing';
export type Competition = 'off' | 'normal' | 'busy';

export interface NewLine {
  group: BloodGroup;
  component: ComponentCode;
  units: number;
  reason: ConditionCode;
}

export interface NewRequest {
  lines: NewLine[];
  urgency: Urgency;
}

const SINGLE: NewRequest = { lines: [{ group: 'B+', component: 'PRBC', units: 2, reason: 'injury' }], urgency: 'critical' };
export const MASS_CASUALTY: NewRequest = {
  urgency: 'critical',
  lines: [
    { group: 'O+', component: 'PRBC', units: 6, reason: 'injury' },
    { group: 'B+', component: 'PRBC', units: 4, reason: 'injury' },
    { group: 'AB+', component: 'FFP', units: 4, reason: 'injury' },
  ],
};

export const SCENARIOS: Record<Exclude<Scenario, 'manual'>, { title: string; text: string; injectAt?: number; request: NewRequest; competition: Competition }> = {
  happy: { title: 'Smooth delivery', text: 'Request → match → approve → deliver → report, no problems.', request: SINGLE, competition: 'off' },
  mass_casualty: {
    title: 'Mass casualty: 3 patients',
    text: 'Road accident. One request for 3 patients; units split across several blood banks.',
    request: MASS_CASUALTY,
    competition: 'off',
  },
  competing: {
    title: 'Competing hospitals',
    text: 'Busy day: another hospital takes the stock first; HemoArrive moves you to the next bank.',
    request: { urgency: 'critical', lines: [{ group: 'O+', component: 'PRBC', units: 4, reason: 'obstetric' }] },
    competition: 'busy',
  },
  breakdown_early: { title: 'Breakdown early in the trip', text: 'Vehicle breaks down at 30% of the route.', injectAt: 0.3, request: SINGLE, competition: 'off' },
  breakdown_late: { title: 'Breakdown late in the trip', text: 'Vehicle breaks down at 70% of the route.', injectAt: 0.7, request: SINGLE, competition: 'off' },
  delay: { title: 'Heavy traffic', text: 'Vehicle gets stuck in traffic at 25% of the route.', injectAt: 0.25, request: SINGLE, competition: 'off' },
};

export const COMPETITION: Record<Competition, { label: string; meanGapS: number; targetChance: number }> = {
  off: { label: 'Off', meanGapS: Infinity, targetChance: 0 },
  normal: { label: 'Normal', meanGapS: 240, targetChance: 0.4 },
  busy: { label: 'Busy', meanGapS: 75, targetChance: 0.75 },
};

export interface EngineState {
  version: number;
  now: number;
  speed: number;
  orgs: Org[];
  lots: Lot[];
  receiverOrgId: string;
  request: BloodRequest | null;
  deliveries: Delivery[];
  timeline: TimelineEvent[];
  decisions: RerouteDecision[];
  scenario: Scenario;
  injected: boolean;
  /** other hospitals requesting blood at the same time */
  competition: Competition;
  nextCompetitorAt: number;
  /** 90 days of observations and past requests; live requests append to it */
  history: History;
}

const HANDOVER_S = 120;
const HELPER_PREP_S = 60;
const WATCH_EVERY_MS = 30_000;
const ACTIVE: Delivery['status'][] = ['loading', 'moving', 'stopped', 'handover'];
/** part states that still hold (or will hold) units for the request */
const LIVE_PART: Part['status'][] = ['awaiting_approval', 'approved', 'in_transit', 'arrived', 'received', 'reported'];
/** part states where something still has to happen */
const OPEN_PART: Part['status'][] = ['awaiting_approval', 'approved', 'in_transit', 'arrived', 'received'];

export const minutes = (s: number) => Math.max(1, Math.round(s / 60));
export const describeLine = (l: { units: number; group: BloodGroup; component: ComponentCode }) => `${l.units}× ${l.group} ${COMPONENTS[l.component].short}`;

export class Engine {
  state: EngineState;
  private listeners = new Set<() => void>();
  private scheduled: { at: number; fn: () => void }[] = [];
  private pendingOffers = new Map<string, Offer[]>();
  private seq = 1;
  private evSeq = 1;
  private rng = mulberry32(99);

  constructor() {
    this.state = this.initial();
  }

  private initial(): EngineState {
    const now = Date.now();
    const orgs = buildOrgs();
    return {
      version: 0,
      now,
      speed: 10,
      orgs,
      lots: buildInventory(orgs, now),
      receiverOrgId: DEMO_RECEIVER_ID,
      request: null,
      deliveries: [],
      timeline: [],
      decisions: [],
      scenario: 'manual',
      injected: false,
      competition: 'off',
      nextCompetitorAt: Infinity,
      history: generateHistory(orgs, now),
    };
  }

  // ---------- history and performance scores ----------

  private historyRev = 0;
  private obsSeq = 1_000_000;
  /** changes whenever history changes — screens use it to memoise heavy aggregations */
  get historyVersion() {
    return this.historyRev;
  }
  private scoreCache: { rev: number; hour: number; map: Map<string, OrgScore> } | null = null;

  /** Performance scores for every organisation, recomputed when history changes or each sim hour. */
  scores(): Map<string, OrgScore> {
    const hour = Math.floor(this.state.now / 3600_000);
    const c = this.scoreCache;
    if (!c || c.rev !== this.historyRev || c.hour !== hour) {
      this.scoreCache = { rev: this.historyRev, hour, map: scoreAll(this.state.orgs.map((o) => o.id), this.state.history.obs, this.state.now) };
    }
    return this.scoreCache!.map;
  }

  private record(orgId: string, body: ObsBody, requestId?: string, note?: string) {
    this.state.history.obs.push({ ...body, id: this.obsSeq++, orgId, at: this.state.now, requestId, note });
    this.historyRev++;
  }

  /** Appeal an event: it is left out of the score until reviewed. */
  toggleAppeal(obsId: number) {
    const o = this.state.history.obs.find((x) => x.id === obsId);
    if (!o) return;
    o.appealed = !o.appealed;
    this.historyRev++;
    this.emit();
  }

  /** Write the finished request to the planning ledger: one record per line (split into met and unmet units). */
  private archive() {
    const req = this.state.request;
    if (!req || req.archived) return;
    req.archived = true;
    for (const line of req.lines) {
      const base = { at: req.createdAt, receiverOrgId: req.requesterOrgId, condition: line.reason, component: line.component, group: line.group, urgency: req.urgency };
      if (req.status === 'cancelled') {
        this.state.history.requests.push({ ...base, id: `${req.id}-${line.id}`, units: line.units, outcome: 'cancelled' });
        continue;
      }
      const done = req.parts.filter((p) => p.status === 'reported' && p.items.some((i) => i.lineId === line.id));
      const delivered = done.reduce((a, p) => a + p.items.filter((i) => i.lineId === line.id).reduce((x, i) => x + i.units, 0), 0);
      if (delivered > 0) {
        const lastArrival = Math.max(...done.map((p) => p.arrivedAt ?? req.createdAt));
        const legs = done.map((p) => this.state.deliveries.find((d) => d.id === p.deliveryId)).filter((d): d is Delivery => !!d);
        this.state.history.requests.push({
          ...base,
          id: `${req.id}-${line.id}`,
          units: Math.min(delivered, line.units),
          outcome: 'fulfilled',
          supplierOrgId: done[0].supplierOrgId,
          minutesToDelivery: (lastArrival - req.createdAt) / 60_000,
          distanceKm: legs.length ? legs.reduce((a, d) => a + d.lengthM, 0) / legs.length / 1000 : undefined,
        });
      }
      if (delivered < line.units) {
        this.state.history.requests.push({ ...base, id: `${req.id}-${line.id}-short`, units: line.units - delivered, outcome: 'unmet' });
      }
    }
    this.historyRev++;
  }

  private tierOf = (orgId: string) => rankTier(this.scores().get(orgId));

  // ---------- store plumbing (used with React's useSyncExternalStore) ----------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.state.version;

  private batching = false;

  private emit() {
    if (this.batching) return; // one emit at the end of a clock tick
    this.state = { ...this.state, version: this.state.version + 1 };
    this.listeners.forEach((fn) => fn());
  }

  // ---------- lookups ----------

  org(id: string): Org {
    return this.state.orgs.find((o) => o.id === id)!;
  }
  get receiver() {
    return this.org(this.state.receiverOrgId);
  }
  get isAuto() {
    return this.state.scenario !== 'manual';
  }
  line(lineId: string): RequestLine {
    return this.state.request!.lines.find((l) => l.id === lineId)!;
  }
  offer(offerId: string): Offer | undefined {
    return this.state.request?.offers.find((o) => o.id === offerId);
  }
  part(partId: string): Part | undefined {
    return this.state.request?.parts.find((p) => p.id === partId);
  }
  deliveryOf(part: Part): Delivery | undefined {
    return part.deliveryId ? this.state.deliveries.find((d) => d.id === part.deliveryId) : undefined;
  }
  partOf(d: Delivery): Part | undefined {
    return this.state.request?.parts.find((p) => p.id === d.partId);
  }

  /** Units this offer can still give right now (other hospitals may have taken some). */
  available(offer: Offer): number {
    const free = offer.lotIds.reduce((a, id) => {
      const l = this.state.lots.find((x) => x.id === id);
      return a + (l && l.status === 'available' ? l.units : 0);
    }, 0);
    return Math.min(free, this.line(offer.lineId).units);
  }

  /** Units of a line already sent to hospitals (and not failed). */
  committed(lineId: string): number {
    const req = this.state.request!;
    return req.parts
      .filter((p) => LIVE_PART.includes(p.status))
      .reduce((a, p) => a + p.items.filter((i) => i.lineId === lineId).reduce((x, i) => x + i.units, 0), 0);
  }
  remaining(lineId: string): number {
    return this.line(lineId).units - this.committed(lineId);
  }
  draftUnits(lineId: string): number {
    const req = this.state.request!;
    return req.draft.reduce((a, p) => a + (this.offer(p.offerId)?.lineId === lineId ? p.units : 0), 0);
  }
  /** Units of a line that nothing (sent or planned) covers. */
  uncovered(lineId: string): number {
    return Math.max(0, this.remaining(lineId) - this.draftUnits(lineId));
  }

  private id(prefix: string) {
    return `${prefix}-${this.seq++}`;
  }

  private log(actor: Actor, text: string, tone: TimelineEvent['tone'] = 'info') {
    this.state.timeline.push({ id: this.evSeq++, at: this.state.now, actor, text, tone });
  }

  private after(seconds: number, fn: () => void) {
    this.scheduled.push({ at: this.state.now + seconds * 1000, fn });
  }

  freeDrivers(orgId?: string): Driver[] {
    const busy = new Set(this.state.deliveries.filter((d) => ACTIVE.includes(d.status)).map((d) => d.driver.id));
    return this.state.orgs
      .filter((o) => o.verified && (!orgId || o.id === orgId))
      .flatMap((o) => o.drivers)
      .filter((d) => !busy.has(d.id));
  }

  nearestArea(pos: LatLng): string {
    let best = this.state.orgs[0];
    for (const o of this.state.orgs) if (haversine(o.location, pos) < haversine(best.location, pos)) best = o;
    return best.area;
  }

  /**
   * Move `units` from the given lots into a new status, soonest-expiring first.
   * A lot that is only partly taken is split, so stock is never double-counted.
   */
  private takeUnits(lotIds: string[], units: number, status: LotStatus): string[] {
    const taken: string[] = [];
    let need = units;
    for (const id of lotIds) {
      if (need <= 0) break;
      const l = this.state.lots.find((x) => x.id === id);
      if (!l || l.status !== 'available') continue;
      const t = Math.min(l.units, need);
      if (t === l.units) {
        l.status = status;
        taken.push(l.id);
      } else {
        l.units -= t;
        const part: Lot = { ...l, id: `${l.id}.${this.seq++}`, units: t, status };
        this.state.lots.push(part);
        taken.push(part.id);
      }
      need -= t;
    }
    return taken;
  }

  private releaseLots(ids: string[]) {
    for (const id of ids) {
      const l = this.state.lots.find((x) => x.id === id);
      if (l && l.status === 'reserved') l.status = 'available';
    }
  }

  // ---------- controls ----------

  setSpeed(speed: number) {
    this.state.speed = speed;
    this.emit();
  }

  setReceiver(orgId: string) {
    if (this.state.request && !['closed', 'cancelled', 'no_match'].includes(this.state.request.status)) return;
    this.state.receiverOrgId = orgId;
    this.emit();
  }

  setCompetition(level: Competition) {
    this.state.competition = level;
    this.state.nextCompetitorAt = level === 'off' ? Infinity : this.state.now + this.competitorGap();
    if (level !== 'off') this.log('System', `Other hospitals requesting blood at the same time: ${COMPETITION[level].label.toLowerCase()} (simulated)`);
    this.emit();
  }

  reset() {
    const speed = this.state.speed;
    this.scheduled = [];
    this.pendingOffers.clear();
    this.state = { ...this.initial(), speed, version: this.state.version + 1 };
    this.emit();
  }

  /** Start a new request on the same city, keeping stock changes from earlier requests. */
  newRequest() {
    this.scheduled = [];
    this.pendingOffers.clear();
    Object.assign(this.state, { request: null, deliveries: [], timeline: [], decisions: [], scenario: 'manual', injected: false });
    this.emit();
  }

  verifyOrg(id: string) {
    this.org(id).verified = true;
    this.log('Admin', `${this.org(id).name} verified — it can now send and receive blood`, 'good');
    this.emit();
  }

  startDemo(scenario: Exclude<Scenario, 'manual'>) {
    this.reset();
    const sc = SCENARIOS[scenario];
    this.state.scenario = scenario;
    this.state.speed = 20; // fast enough to watch the whole loop in ~2 minutes, slow enough to follow
    this.log('System', `Demo started: ${sc.title}. Everyone acts automatically — just watch.`);
    this.state.competition = sc.competition;
    this.state.nextCompetitorAt = sc.competition === 'off' ? Infinity : this.state.now + this.competitorGap();
    this.createRequest(sc.request);
  }

  // ---------- 1–3: request, broadcast, matching window ----------

  createRequest(spec: NewRequest) {
    const { now, orgs, lots } = this.state;
    const receiver = this.receiver;
    const exclude = [receiver.id];
    const reqId = `REQ-${String(100 + this.seq++)}`;
    const lines: RequestLine[] = spec.lines.map((l, i) => ({ id: `L${i + 1}`, ...l }));
    this.log(
      'Receiver',
      `${receiver.name} asked for blood${lines.length > 1 ? ` for ${lines.length} patients` : ''}: ${lines.map(describeLine).join(', ')} — ${spec.urgency}`,
    );

    // widen 10 → 25 → 50 km until every line has 3 hospitals and enough units in total
    let radiusKm: number = RINGS_KM[0];
    for (const r of RINGS_KM) {
      radiusKm = r;
      const short = lines.filter((l) => {
        const hits = findSuppliers(orgs, lots, receiver.location, l, r, now, { excludeOrgIds: exclude });
        return hits.length < 3 || hits.reduce((a, h) => a + h.units, 0) < l.units;
      });
      if (short.length === 0 || r === RINGS_KM[RINGS_KM.length - 1]) break;
      this.log('System', `Within ${r} km there isn't enough ${short.map((l) => `${l.group} ${COMPONENTS[l.component].short}`).join(', ')} — widening the search`, 'warn');
    }

    this.pendingOffers.clear();
    const withStock = new Set<string>();
    for (const line of lines) {
      const hits: SupplierHit[] = [
        ...findSuppliers(orgs, lots, receiver.location, line, radiusKm, now, { excludeOrgIds: exclude }),
        ...findSuppliers(orgs, lots, receiver.location, line, radiusKm, now, { excludeOrgIds: exclude, substitutes: true }),
      ];
      for (const h of hits) {
        withStock.add(h.org.id);
        const list = this.pendingOffers.get(h.org.id) ?? [];
        list.push(hitToOffer(h, line.units, this.id('OFF'), line.id));
        this.pendingOffers.set(h.org.id, list);
      }
    }

    const rng = mulberry32(hashString(reqId));
    const notified = orgs.filter((o) => o.verified && o.id !== receiver.id && haversine(o.location, receiver.location) <= radiusKm * 1000);
    const request: BloodRequest = {
      id: reqId,
      requesterOrgId: receiver.id,
      lines,
      urgency: spec.urgency,
      status: 'searching',
      createdAt: now,
      matchDeadline: now + MATCH_WINDOW_S * 1000,
      radiusKm,
      broadcasts: notified.map((o) => ({
        orgId: o.id,
        distanceM: haversine(o.location, receiver.location),
        ringKm: RINGS_KM.find((r) => haversine(o.location, receiver.location) <= r * 1000) ?? radiusKm,
        hasStock: withStock.has(o.id),
        respondAt: now + (8 + rng() * (MATCH_WINDOW_S - 30)) * 1000,
        responded: false,
      })),
      offers: [],
      draft: [],
      excludedOfferIds: [],
      failedOrgIds: [],
      substitutesConfirmed: false,
      parts: [],
    };
    this.state.request = request;

    this.log('System', `Alert sent to ${notified.length} verified hospitals within ${radiusKm} km. Collecting offers for 2.5 min.`);
    if (spec.urgency === 'critical') this.log('System', 'Critical request — SMS also sent to blood bank officers', 'warn');
    if (withStock.size === 0) {
      request.status = 'no_match';
      this.log('System', `No hospital within ${radiusKm} km has usable stock for this request. Platform admin alerted.`, 'bad');
      this.archive();
    }
    this.emit();
  }

  skipWindow() {
    if (this.state.request?.status !== 'searching') return;
    this.state.request.broadcasts.forEach((b) => (b.respondAt = Math.min(b.respondAt, this.state.now)));
    this.state.request.matchDeadline = this.state.now;
    this.runBatched(0);
  }

  private collectOffers() {
    const req = this.state.request!;
    let changed = false;
    for (const b of req.broadcasts) {
      if (b.responded || b.respondAt > this.state.now) continue;
      b.responded = true;
      if (!b.hasStock) continue;
      const offers = this.pendingOffers.get(b.orgId) ?? [];
      for (const o of offers) {
        req.offers.push(o);
        this.log('Sender', `${this.org(b.orgId).name} can send ${o.units}× ${o.group} ${COMPONENTS[this.line(o.lineId).component].short}${o.substitute ? ' (substitute)' : ''}`);
      }
      changed = true;
    }
    if (changed) this.rerank();
  }

  /** Rank each line's offers; exact group first, substitutes after. */
  private rerank() {
    const req = this.state.request!;
    req.offers = req.lines.flatMap((line) => {
      const mine = req.offers.filter((o) => o.lineId === line.id);
      return [
        ...rankOffers(mine.filter((o) => !o.substitute), this.state.orgs, line.units, this.tierOf),
        ...rankOffers(mine.filter((o) => o.substitute), this.state.orgs, line.units, this.tierOf),
      ];
    });
  }

  private closeWindow() {
    const req = this.state.request!;
    this.collectOffers();
    for (const b of req.broadcasts) if (b.hasStock) this.record(b.orgId, { k: 'broadcast', answered: b.responded }, req.id);
    req.offers = req.lines.flatMap((line) => {
      const mine = req.offers.filter((o) => o.lineId === line.id);
      return [...mine.filter((o) => !o.substitute).slice(0, MAX_OPTIONS), ...mine.filter((o) => o.substitute).slice(0, 3)];
    });
    if (req.offers.length === 0) {
      req.status = 'no_match';
      this.log('System', 'Matching window closed with no offers. Platform admin alerted.', 'bad');
      this.archive();
      return;
    }
    req.status = 'planning';
    this.suggest();
    const hospitals = new Set(req.draft.map((p) => this.offer(p.offerId)!.supplierOrgId)).size;
    const planned = req.draft.reduce((a, p) => a + p.units, 0);
    const needed = req.lines.reduce((a, l) => a + l.units, 0);
    this.log(
      'System',
      `Matching window closed — suggested plan: ${planned} of ${needed} units from ${hospitals} hospital(s)${hospitals > 1 ? ' (split across hospitals)' : ''}`,
      planned < needed ? 'warn' : 'good',
    );
    if (this.isAuto) this.after(10, () => this.sendPlan());
  }

  // ---------- 4: the supply plan ----------

  /**
   * Keep the receiver's picks (clamped to what is still available) and fill any gap per line
   * with the best-ranked exact-group offers. Substitutes are never added automatically.
   * Returns true if the plan changed.
   */
  private suggest(): boolean {
    const req = this.state.request!;
    const before = JSON.stringify(req.draft);
    req.draft = req.draft
      .filter((p) => {
        const o = this.offer(p.offerId);
        return o && !req.failedOrgIds.includes(o.supplierOrgId);
      })
      .map((p) => ({ ...p, units: Math.min(p.units, this.available(this.offer(p.offerId)!)) }))
      .filter((p) => p.units > 0);
    for (const line of req.lines) {
      // never plan more than still needed
      let over = this.draftUnits(line.id) - this.remaining(line.id);
      for (let i = req.draft.length - 1; i >= 0 && over > 0; i--) {
        const p = req.draft[i];
        if (this.offer(p.offerId)!.lineId !== line.id) continue;
        const cut = Math.min(p.units, over);
        p.units -= cut;
        over -= cut;
      }
      req.draft = req.draft.filter((p) => p.units > 0);
      let need = this.uncovered(line.id);
      const candidates = req.offers.filter(
        (o) =>
          o.lineId === line.id &&
          !o.substitute &&
          !req.excludedOfferIds.includes(o.id) &&
          !req.failedOrgIds.includes(o.supplierOrgId) &&
          !req.draft.some((p) => p.offerId === o.id),
      );
      for (const o of candidates) {
        if (need <= 0) break;
        const take = Math.min(this.available(o), need);
        if (take <= 0) continue;
        req.draft.push({ offerId: o.id, units: take });
        need -= take;
      }
    }
    return JSON.stringify(req.draft) !== before;
  }

  private canEditPlan() {
    const s = this.state.request?.status;
    return s === 'planning' || s === 'in_progress';
  }

  togglePick(offerId: string) {
    const req = this.state.request;
    const o = this.offer(offerId);
    if (!req || !o || !this.canEditPlan()) return;
    const i = req.draft.findIndex((p) => p.offerId === offerId);
    if (i >= 0) {
      req.draft.splice(i, 1);
      if (!req.excludedOfferIds.includes(offerId)) req.excludedOfferIds.push(offerId);
    } else {
      // the newly ticked hospital takes over units from the lowest-ranked other picks of the same line
      req.excludedOfferIds = req.excludedOfferIds.filter((x) => x !== offerId);
      const take = Math.min(this.available(o), this.remaining(o.lineId));
      if (take <= 0) return;
      req.draft.push({ offerId, units: take });
      let over = this.draftUnits(o.lineId) - this.remaining(o.lineId);
      for (let k = req.draft.length - 2; k >= 0 && over > 0; k--) {
        const p = req.draft[k];
        if (this.offer(p.offerId)!.lineId !== o.lineId) continue;
        const cut = Math.min(p.units, over);
        p.units -= cut;
        over -= cut;
      }
      req.draft = req.draft.filter((p) => p.units > 0);
    }
    this.emit();
  }

  setPickUnits(offerId: string, units: number) {
    const req = this.state.request;
    const pick = req?.draft.find((p) => p.offerId === offerId);
    const o = this.offer(offerId);
    if (!req || !pick || !o) return;
    const others = this.draftUnits(o.lineId) - pick.units;
    pick.units = Math.max(1, Math.min(units, this.available(o), this.remaining(o.lineId) - others));
    this.emit();
  }

  /** Throw away edits and take HemoArrive's suggestion again. */
  resetPlan() {
    const req = this.state.request;
    if (!req || !this.canEditPlan()) return;
    req.draft = [];
    req.excludedOfferIds = [];
    this.suggest();
    this.emit();
  }

  confirmSubstitutes(ok: boolean) {
    if (!this.state.request) return;
    this.state.request.substitutesConfirmed = ok;
    this.emit();
  }

  get planNeedsSubstituteConfirmation() {
    const req = this.state.request;
    return !!req && req.draft.some((p) => this.offer(p.offerId)?.substitute) && !req.substitutesConfirmed;
  }

  /** Send the plan: one part per hospital (a hospital supplying several lines sends one vehicle). */
  sendPlan() {
    const req = this.state.request;
    if (!req || !this.canEditPlan() || req.draft.length === 0 || this.planNeedsSubstituteConfirmation) return;
    const bySupplier = new Map<string, Part['items']>();
    for (const p of req.draft) {
      const o = this.offer(p.offerId)!;
      const units = Math.min(p.units, this.available(o));
      if (units <= 0) continue;
      bySupplier.set(o.supplierOrgId, [...(bySupplier.get(o.supplierOrgId) ?? []), { lineId: o.lineId, offerId: o.id, units, lotIds: [] }]);
    }
    const created: Part[] = [];
    for (const [supplierOrgId, items] of bySupplier) {
      const part: Part = {
        id: this.id('PART'),
        supplierOrgId,
        items,
        units: items.reduce((a, i) => a + i.units, 0),
        status: 'awaiting_approval',
        sentAt: this.state.now,
        senderDeadline: this.state.now + SENDER_TIMEOUT_S * 1000,
      };
      req.parts.push(part);
      created.push(part);
      this.log(
        'Receiver',
        `Request sent to ${this.org(supplierOrgId).name}: ${items.map((i) => describeLine({ ...this.line(i.lineId), group: this.offer(i.offerId)!.group, units: i.units })).join(', ')} — 5 min to answer`,
      );
    }
    req.draft = [];
    req.status = 'in_progress';
    if (this.isAuto) {
      created.forEach((p, i) => this.after(25 + 10 * i, () => this.approve(p.id)));
      // competing demo: another hospital takes the first bank's stock before it can approve
      if (this.state.scenario === 'competing' && created[0] && req.parts.length === created.length) {
        this.after(10, () => this.competitorTakes(created[0]));
      }
    }
    this.emit();
  }

  // ---------- 5: approve / decline / timeout, per part ----------

  approve(partId: string) {
    const req = this.state.request;
    const part = this.part(partId);
    if (!req || !part || part.status !== 'awaiting_approval') return;
    this.record(part.supplierOrgId, { k: 'selected', answerMin: (this.state.now - part.sentAt) / 60_000, timedOut: false }, req.id);
    const short = part.items.find((i) => this.available(this.offer(i.offerId)!) < i.units);
    if (short) {
      this.record(part.supplierOrgId, { k: 'approval', conflict: true }, req.id, 'Approved units were already taken');
      this.failPart(part, 'conflict', `${this.org(part.supplierOrgId).name} no longer has the units — another hospital took them first`);
      this.emit();
      return;
    }
    for (const i of part.items) i.lotIds = this.takeUnits(this.offer(i.offerId)!.lotIds, i.units, 'reserved');
    this.record(part.supplierOrgId, { k: 'approval', conflict: false }, req.id);
    part.status = 'approved';
    part.approvedAt = this.state.now;
    this.log('Sender', `${this.org(part.supplierOrgId).name} approved — ${part.units} unit(s) reserved`, 'good');
    if (this.isAuto) {
      const driver = this.freeDrivers(part.supplierOrgId)[0];
      if (driver) this.after(15, () => this.dispatch(part.id, driver.id));
    }
    this.emit();
  }

  decline(partId: string) {
    const req = this.state.request;
    const part = this.part(partId);
    if (!req || !part || part.status !== 'awaiting_approval') return;
    this.record(part.supplierOrgId, { k: 'selected', answerMin: (this.state.now - part.sentAt) / 60_000, timedOut: false }, req.id);
    this.failPart(part, 'declined', `${this.org(part.supplierOrgId).name} declined`);
    this.emit();
  }

  /** A part could not go ahead: free its units and suggest other hospitals for them. */
  private failPart(part: Part, status: 'declined' | 'timed_out' | 'conflict' | 'cancelled', text: string) {
    const req = this.state.request!;
    part.status = status;
    part.failReason = text;
    for (const i of part.items) this.releaseLots(i.lotIds);
    if (!req.failedOrgIds.includes(part.supplierOrgId)) req.failedOrgIds.push(part.supplierOrgId);
    this.log(status === 'declined' ? 'Sender' : 'System', text, 'bad');
    if (status === 'cancelled') return;
    this.suggest();
    if (req.draft.length) {
      const names = [...new Set(req.draft.map((p) => this.org(this.offer(p.offerId)!.supplierOrgId).name))];
      this.log('System', `${part.units} unit(s) need a new source — suggested: ${names.join(', ')}`, 'warn');
      if (this.isAuto) this.after(10, () => this.sendPlan());
    } else {
      this.maybeClose();
    }
  }

  // ---------- 6–7: dispatch and live tracking ----------

  dispatch(partId: string, driverId: string) {
    const req = this.state.request;
    const part = this.part(partId);
    if (!req || !part || part.status !== 'approved') return;
    const driver = this.freeDrivers(part.supplierOrgId).find((d) => d.id === driverId);
    if (!driver) return;
    const route = this.offer(part.items[0].offerId)!.route;
    const d = this.newDelivery('main', part, part.supplierOrgId, driver, route, part.items.flatMap((i) => i.lotIds), part.units, LOAD_S, {
      dispatchMin: (this.state.now - (part.approvedAt ?? this.state.now)) / 60_000,
    });
    part.deliveryId = d.id;
    part.status = 'in_transit';
    this.log(
      'Sender',
      `${this.org(part.supplierOrgId).name}: driver ${driver.name} assigned. ${(d.lengthM / 1000).toFixed(1)} km, ETA ${minutes((d.eta - this.state.now) / 1000)} min`,
    );
    this.emit();
  }

  private newDelivery(
    kind: Delivery['kind'],
    part: Part,
    fromOrgId: string,
    driver: Driver,
    route: LatLng[],
    lotIds: string[],
    units: number,
    waitS: number,
    extra: Partial<Delivery> = {},
  ): Delivery {
    const lengthM = routeLength(route);
    const now = this.state.now;
    const handover = extra.handoffAtM != null ? HANDOVER_S : 0;
    const eta = now + (waitS + lengthM / SPEED_MPS + handover) * 1000;
    const d: Delivery = {
      id: this.id('DEL'),
      partId: part.id,
      kind,
      fromOrgId,
      driver,
      route,
      lengthM,
      travelledM: 0,
      status: 'loading',
      waitUntil: now + waitS * 1000,
      speedFactor: 1,
      dispatchedAt: now,
      plannedArrival: eta,
      eta,
      lotIds,
      units,
      lastWatch: now,
      dispatchMin: 0,
      ...extra,
      promisedArrival: eta,
    };
    this.state.deliveries.push(d);
    return d;
  }

  // ---------- 8: worst case ----------

  /** Deliveries that can still have a problem injected (moving, not a rescue leg). */
  canInject(d?: Delivery): boolean {
    const x = d ?? this.firstInjectable();
    return !!x && x.status === 'moving' && x.kind !== 'handoff' && this.partOf(x)?.deliveryId === x.id;
  }
  private firstInjectable() {
    return this.state.deliveries.find((d) => d.status === 'moving' && d.kind !== 'handoff' && this.partOf(d)?.deliveryId === d.id);
  }

  injectBreakdown(deliveryId?: string) {
    const d = deliveryId ? this.state.deliveries.find((x) => x.id === deliveryId) : this.firstInjectable();
    if (!d || !this.canInject(d)) return;
    d.status = 'stopped';
    const pos = pointAlong(d.route, d.travelledM).pos;
    this.log('Driver', `${d.driver.name}'s vehicle broke down near ${this.nearestArea(pos)} — incident reported`, 'bad');
    this.reroute(d, 'breakdown');
    this.emit();
  }

  injectDelay(deliveryId?: string) {
    const d = deliveryId ? this.state.deliveries.find((x) => x.id === deliveryId) : this.firstInjectable();
    if (!d || !this.canInject(d) || d.speedFactor < 1) return;
    d.speedFactor = 0.2;
    const pos = pointAlong(d.route, d.travelledM).pos;
    this.log('Driver', `${d.driver.name} is stuck in heavy traffic near ${this.nearestArea(pos)}`, 'warn');
    this.updateEta(d);
    this.emit();
  }

  /** Best other hospital that can supply every item of this part (same blood groups), with a free driver. */
  private findFreshSource(part: Part, exclude: string[]) {
    const receiver = this.receiver;
    let best: { org: Org; route: LatLng[]; etaS: number; lotsByItem: string[][] } | null = null;
    for (const org of this.state.orgs) {
      if (!org.verified || exclude.includes(org.id) || this.freeDrivers(org.id).length === 0) continue;
      const route = makeRoute(org.location, receiver.location, `${org.id}->${receiver.location.join(',')}`);
      const etaS = etaSeconds(routeLength(route));
      const lotsByItem: string[][] = [];
      let ok = true;
      for (const item of part.items) {
        const line = this.line(item.lineId);
        const group = this.offer(item.offerId)!.group;
        const usable = this.state.lots
          .filter((l) => l.orgId === org.id && l.component === line.component && l.group === group && isUsableOnArrival(l, this.state.now, etaS))
          .sort((a, b) => a.expiresAt - b.expiresAt);
        if (usable.reduce((a, l) => a + l.units, 0) < item.units) {
          ok = false;
          break;
        }
        lotsByItem.push(usable.map((l) => l.id));
      }
      if (ok && (!best || etaS < best.etaS)) best = { org, route, etaS, lotsByItem };
    }
    return best;
  }

  private reroute(d: Delivery, trigger: 'breakdown' | 'delay') {
    const req = this.state.request!;
    const part = this.partOf(d)!;
    const now = this.state.now;
    const { pos, rest } = pointAlong(d.route, d.travelledM);
    const remainingM = d.lengthM - d.travelledM;

    // Option A: fresh units from the best other hospital
    const fresh = this.findFreshSource(part, [this.receiver.id, d.fromOrgId, ...req.failedOrgIds]);
    const freshEtaS = fresh ? fresh.etaS : null;

    // Option B: keep the units on the road (hand-off to the nearest free driver, or keep going)
    let helper: { driver: Driver; org: Org; route: LatLng[] } | null = null;
    let keepEtaS: number | null = null;
    if (trigger === 'breakdown') {
      for (const drv of this.freeDrivers()) {
        const org = this.org(drv.orgId);
        if (!helper || haversine(org.location, pos) < haversine(helper.org.location, pos)) helper = { driver: drv, org, route: [] };
      }
      if (helper) {
        helper.route = makeRoute(helper.org.location, pos, `${helper.driver.id}->rescue`);
        keepEtaS = HELPER_PREP_S + routeLength(helper.route) / SPEED_MPS + HANDOVER_S + remainingM / SPEED_MPS;
      }
    } else {
      keepEtaS = (d.eta - now) / 1000;
    }

    const result = decideReroute({ travelledM: d.travelledM, plannedM: d.lengthM, keepEtaS, freshEtaS });
    const pct = Math.round(result.fraction * 100);
    const keepKey = trigger === 'breakdown' ? 'handoff' : 'continue';
    const chosen = result.choice === 'fresh' ? 'fresh' : keepKey;
    const freshLabel = fresh ? `Fresh units from ${fresh.org.name}` : 'Fresh units from another hospital (none available)';
    const keepLabel =
      trigger === 'breakdown'
        ? helper
          ? `Send ${helper.driver.name} (${helper.org.name}) to collect the units from the vehicle`
          : 'Hand-off (no free driver)'
        : 'Keep going through the traffic';
    const rule =
      result.caseNo === 1
        ? `The vehicle had covered ${pct}% of the trip — less than half — so the rule (Case 1) is: get fresh units near the receiver.`
        : `The vehicle had covered ${pct}% of the trip — half or more — so the rule (Case 2) is: the units already on the road are the fastest, keep them.`;
    const why = result.overridden ? ` But the other option is clearly faster, so HemoArrive took it instead (ETA always wins).` : '';
    this.state.decisions.push({
      partId: part.id,
      at: now,
      trigger,
      travelledPct: pct,
      caseNo: result.caseNo,
      options: [
        { key: 'fresh', label: freshLabel, etaMin: freshEtaS != null ? minutes(freshEtaS) : null },
        { key: keepKey, label: keepLabel, etaMin: keepEtaS != null ? minutes(keepEtaS) : null },
      ],
      chosen,
      explanation: rule + why,
    });
    this.log('System', `Re-route check (${trigger}): Case ${result.caseNo}, ${pct}% travelled → ${chosen === 'fresh' ? 'fresh units' : chosen === 'handoff' ? 'hand-off' : 'keep going'}`, 'warn');

    if (freshEtaS == null && keepEtaS == null) {
      this.log('System', 'No alternative available — platform admin alerted to call hospitals directly', 'bad');
      return;
    }

    // performance score for the original sender: traffic is outside their control (excused), a breakdown is not
    if (d.kind !== 'handoff' && !d.recorded) {
      const newEtaS = chosen === 'fresh' ? freshEtaS : keepEtaS;
      d.recorded = true;
      this.record(
        d.fromOrgId,
        { k: 'delivery', lateMin: Math.max(0, (now + (newEtaS ?? 0) * 1000 - d.promisedArrival) / 60_000), excused: trigger === 'delay', dispatchMin: d.dispatchMin, incident: 'driver' },
        req.id,
        trigger === 'delay' ? 'Delayed by heavy traffic' : 'Vehicle breakdown',
      );
    }

    if (chosen === 'fresh' && fresh) {
      d.status = 'cancelled';
      this.releaseLots(d.lotIds);
      this.log('System', `Original leg cancelled — ${d.units} unit(s) go back to ${this.org(d.fromOrgId).name}`);
      part.items.forEach((item, i) => (item.lotIds = this.takeUnits(fresh.lotsByItem[i], item.units, 'reserved')));
      part.supplierOrgId = fresh.org.id;
      const driver = this.freeDrivers(fresh.org.id)[0];
      const nd = this.newDelivery('fresh', part, fresh.org.id, driver, fresh.route, part.items.flatMap((i) => i.lotIds), part.units, LOAD_S, { parentId: d.id });
      part.deliveryId = nd.id;
      this.log('Sender', `${fresh.org.name} confirmed emergency re-supply — driver ${driver.name} dispatched`, 'good');
    } else if (chosen === 'handoff' && helper) {
      const route = [...helper.route, ...rest.slice(1)];
      const nd = this.newDelivery('handoff', part, helper.org.id, helper.driver, route, d.lotIds, d.units, HELPER_PREP_S, {
        parentId: d.id,
        handoffAtM: routeLength(helper.route),
      });
      part.deliveryId = nd.id;
      this.log('System', `${helper.driver.name} from ${helper.org.name} is going to collect the units (hand-off leg)`, 'good');
    } else {
      d.delayChecked = true;
      d.plannedArrival = d.eta;
      this.log('System', `Kept on route — still the fastest way. New ETA ${minutes((d.eta - now) / 1000)} min`);
    }
  }

  // ---------- 9: arrival and report, per part ----------

  confirmReceived(partId: string) {
    const req = this.state.request;
    const part = this.part(partId);
    if (!req || !part || part.status !== 'arrived') return;
    part.status = 'received';
    part.receivedAt = this.state.now;
    this.log('Receiver', `Confirmed ${part.units} unit(s) from ${this.org(part.supplierOrgId).name}. Delivery report required.`);
    if (this.isAuto) {
      const d = this.deliveryOf(part)!;
      this.after(30, () =>
        this.fileReport(part.id, {
          receivedBy: 'Dr. A. Mathur (Blood bank officer)',
          unitsReceived: part.units,
          bagNumbers: d.lotIds.map((id, i) => `JP-${id.replace('lot-', '')}-${i + 1}`).join(', '),
          tempOnArrival: TRANSPORT_TEMP[this.line(part.items[0].lineId).component].typical,
          condition: 'good',
          notes: 'Cold box sealed, labels intact.',
          filedAt: this.state.now,
        }),
      );
    }
    this.emit();
  }

  fileReport(partId: string, report: DeliveryReport) {
    const req = this.state.request;
    const part = this.part(partId);
    if (!req || !part || part.status !== 'received') return;
    for (const i of part.items) {
      for (const id of i.lotIds) {
        const l = this.state.lots.find((x) => x.id === id);
        if (l) l.status = 'issued';
      }
    }
    part.report = { ...report, filedAt: this.state.now };
    part.status = 'reported';
    // performance score: the sender is rated on cold chain and stock; the receiver on filing promptly.
    // A part can mix components; it is in range only if every component's range allows the reading.
    const tempOk = part.items.every((i) => tempInRange(this.line(i.lineId).component, report.tempOnArrival));
    const short = report.unitsReceived < part.units;
    this.record(
      part.supplierOrgId,
      { k: 'report_in', tempOk, bagsOk: report.bagNumbers.trim().length > 0, short },
      req.id,
      !tempOk ? `Arrived at ${report.tempOnArrival} °C` : short ? `${report.unitsReceived} of ${part.units} units received` : undefined,
    );
    this.record(req.requesterOrgId, { k: 'report_filed', minutes: (this.state.now - (part.receivedAt ?? this.state.now)) / 60_000 }, req.id);
    this.log('Receiver', `Report filed for ${this.org(part.supplierOrgId).name}: ${report.unitsReceived} unit(s), ${report.tempOnArrival} °C, ${report.condition}`, 'good');
    this.maybeClose();
    this.emit();
  }

  /** Close when nothing is still moving and no further plan can be sent. */
  private maybeClose() {
    const req = this.state.request;
    if (!req || req.status !== 'in_progress') return;
    if (req.parts.some((p) => OPEN_PART.includes(p.status))) return;
    if (req.draft.length > 0) return; // the receiver still has a plan to send
    const short = req.lines.map((l) => ({ l, n: this.remaining(l.id) })).filter((x) => x.n > 0);
    const delivered = req.parts.some((p) => p.status === 'reported');
    req.status = delivered ? 'closed' : 'no_match';
    req.closedAt = this.state.now;
    if (short.length) {
      this.log('System', `Shortfall: ${short.map((x) => describeLine({ ...x.l, units: x.n })).join(', ')} could not be found within ${req.radiusKm} km. Platform admin alerted.`, 'bad');
    }
    if (delivered) this.log('System', `Request ${req.id} closed. Total time ${minutes((this.state.now - req.createdAt) / 1000)} min.`, 'good');
    this.archive();
  }

  /** Receiver accepts the shortfall and closes now (only when no more options exist). */
  closeWithShortfall() {
    const req = this.state.request;
    if (!req || req.status !== 'in_progress') return;
    req.draft = [];
    this.maybeClose();
    this.emit();
  }

  cancelRequest() {
    const req = this.state.request;
    if (!req || !['searching', 'planning', 'in_progress'].includes(req.status)) return;
    if (req.parts.some((p) => ['in_transit', 'arrived', 'received'].includes(p.status))) return; // blood already on the way
    for (const p of req.parts) if (OPEN_PART.includes(p.status)) this.failPart(p, 'cancelled', `Request to ${this.org(p.supplierOrgId).name} withdrawn`);
    req.status = 'cancelled';
    req.draft = [];
    this.scheduled = [];
    this.log('Receiver', 'Request cancelled', 'warn');
    this.record(req.requesterOrgId, { k: 'cancel' }, req.id);
    this.archive();
    this.emit();
  }

  get canCancel() {
    const req = this.state.request;
    return !!req && ['searching', 'planning', 'in_progress'].includes(req.status) && !req.parts.some((p) => ['in_transit', 'arrived', 'received', 'reported'].includes(p.status));
  }

  // ---------- other hospitals requesting at the same time ----------

  private competitorGap() {
    const mean = COMPETITION[this.state.competition].meanGapS;
    return -Math.log(1 - this.rng()) * mean * 1000;
  }

  /** Another hospital raises a request and takes stock — sometimes exactly the stock you were planning on. */
  private competitorEvent() {
    const req = this.state.request;
    const level = COMPETITION[this.state.competition];
    const hospitals = this.state.orgs.filter((o) => o.verified && o.type === 'hospital' && o.id !== this.state.receiverOrgId);
    const requester = hospitals[randInt(this.rng, 0, hospitals.length - 1)];
    // offers you are relying on right now
    const watched =
      req && (req.status === 'planning' || req.status === 'in_progress')
        ? [...req.draft.map((p) => p.offerId), ...req.parts.filter((p) => p.status === 'awaiting_approval').flatMap((p) => p.items.map((i) => i.offerId))]
            .map((id) => this.offer(id)!)
            .filter((o) => this.available(o) > 0)
        : [];
    if (watched.length && this.rng() < level.targetChance) {
      const o = watched[randInt(this.rng, 0, watched.length - 1)];
      const n = Math.min(this.available(o), randInt(this.rng, 1, 3));
      this.competitorTakesFromOffer(o, n, requester);
      return;
    }
    // elsewhere in the network
    const lot = this.state.lots.filter((l) => l.status === 'available' && l.expiresAt > this.state.now)[randInt(this.rng, 0, 400) % 400];
    if (!lot) return;
    const n = Math.min(lot.units, randInt(this.rng, 1, 2));
    this.takeUnits([lot.id], n, 'issued');
    this.recordCompetitor(requester, lot.orgId, lot.group, lot.component, n);
  }

  private competitorTakesFromOffer(o: Offer, n: number, requester?: Org) {
    const line = this.line(o.lineId);
    const who =
      requester ??
      this.state.orgs.filter((x) => x.verified && x.type === 'hospital' && x.id !== this.state.receiverOrgId && x.id !== o.supplierOrgId)[0];
    this.takeUnits(o.lotIds, n, 'issued');
    this.recordCompetitor(who, o.supplierOrgId, o.group, line.component, n);
    this.log('System', `Meanwhile ${who.name} took ${n}× ${o.group} ${COMPONENTS[line.component].short} from ${this.org(o.supplierOrgId).name} (another emergency)`, 'warn');
    const req = this.state.request!;
    if (req.status === 'planning' || req.status === 'in_progress') {
      if (this.suggest()) this.log('System', 'Stock changed — your supply plan was updated to what is still available', 'warn');
    }
  }

  /** Competing demo: take all of a part's stock just before the sender can approve. */
  private competitorTakes(part: Part) {
    if (part.status !== 'awaiting_approval') return;
    const item = part.items[0];
    const o = this.offer(item.offerId)!;
    const n = this.available(o);
    if (n > 0) this.competitorTakesFromOffer(o, n);
  }

  private recordCompetitor(requester: Org, supplierOrgId: string, group: BloodGroup, component: ComponentCode, units: number) {
    const reasons = CONDITIONS.map((c) => c.code);
    this.state.history.requests.push({
      id: this.id('C'),
      at: this.state.now,
      receiverOrgId: requester.id,
      condition: pickWeighted(this.rng, reasons, reasons.map(() => 1)),
      component,
      group,
      units,
      urgency: 'urgent',
      outcome: 'fulfilled',
      supplierOrgId,
      minutesToDelivery: 25,
      distanceKm: haversine(requester.location, this.org(supplierOrgId).location) / 1000,
    });
    this.historyRev++;
  }

  // ---------- clock ----------

  tick(realMs: number) {
    if (this.state.speed === 0) return;
    this.runBatched(realMs * this.state.speed);
  }

  private runBatched(simMs: number) {
    this.batching = true;
    try {
      this.process(simMs);
    } finally {
      this.batching = false;
    }
    this.emit();
  }

  private process(simMs: number) {
    const s = this.state;
    s.now += simMs;

    // scheduled autopilot actions
    const due = this.scheduled.filter((a) => a.at <= s.now);
    this.scheduled = this.scheduled.filter((a) => a.at > s.now);
    due.forEach((a) => a.fn());

    // other hospitals
    if (s.now >= s.nextCompetitorAt) {
      this.competitorEvent();
      s.nextCompetitorAt = s.now + this.competitorGap();
    }

    const req = s.request;
    if (!req) return;

    if (req.status === 'searching') {
      this.collectOffers();
      if (s.now >= req.matchDeadline) this.closeWindow();
    }

    for (const part of req.parts) {
      if (part.status === 'awaiting_approval' && s.now >= part.senderDeadline) {
        this.record(part.supplierOrgId, { k: 'selected', answerMin: null, timedOut: true }, req.id, 'Did not answer in 5 min');
        this.failPart(part, 'timed_out', `${this.org(part.supplierOrgId).name} did not answer in 5 min`);
      }
    }

    for (const d of s.deliveries) this.moveDelivery(d, simMs);

    // autopilot failure injection (first delivery that is moving)
    const sc = s.scenario !== 'manual' ? SCENARIOS[s.scenario] : null;
    const target = this.firstInjectable();
    if (sc?.injectAt && !s.injected && target && target.travelledM / target.lengthM >= sc.injectAt) {
      s.injected = true;
      if (s.scenario === 'delay') this.injectDelay(target.id);
      else this.injectBreakdown(target.id);
    }
  }

  private moveDelivery(d: Delivery, simMs: number) {
    const s = this.state;
    if (d.status === 'loading' || d.status === 'handover') {
      if (s.now >= d.waitUntil) {
        const was = d.status;
        d.status = 'moving';
        if (was === 'handover') this.log('Driver', `Hand-off done — ${d.driver.name} continues to ${this.receiver.name}`, 'good');
        else if (d.kind === 'handoff') this.log('Driver', `${d.driver.name} is driving to the broken-down vehicle`);
        else this.log('Driver', `${d.driver.name} picked up ${d.units} unit(s) — out for delivery`);
      }
    } else if (d.status === 'moving') {
      d.travelledM += SPEED_MPS * d.speedFactor * (simMs / 1000);
      if (d.handoffAtM != null && !d.handoffDone && d.travelledM >= d.handoffAtM) {
        d.travelledM = d.handoffAtM;
        d.handoffDone = true;
        d.status = 'handover';
        d.waitUntil = s.now + HANDOVER_S * 1000;
        const parent = s.deliveries.find((x) => x.id === d.parentId);
        if (parent) parent.status = 'handed_off';
        this.log('Driver', `${d.driver.name} reached the vehicle — moving units to the new cold box`);
      } else if (d.travelledM >= d.lengthM) {
        d.travelledM = d.lengthM;
        d.status = 'arrived';
        if (d.kind !== 'handoff' && !d.recorded) {
          d.recorded = true;
          const lateMin = Math.max(0, (s.now - d.promisedArrival) / 60_000);
          this.record(d.fromOrgId, { k: 'delivery', lateMin, excused: d.speedFactor < 1, dispatchMin: d.dispatchMin, incident: 'none' }, s.request?.id,
            lateMin > 10 ? `Arrived ${Math.round(lateMin)} min late` : undefined);
        }
        const part = this.partOf(d);
        if (part && part.deliveryId === d.id) {
          part.status = 'arrived';
          part.arrivedAt = s.now;
          this.log('Driver', `${d.driver.name} arrived at ${this.receiver.name} with ${part.units} unit(s)`, 'good');
          if (this.isAuto) this.after(15, () => this.confirmReceived(part.id));
        }
      }
    }
    if (!ACTIVE.includes(d.status)) return;
    if (d.status !== 'stopped') this.updateEta(d);

    // etaWatch: every 30 s, check for a big slip
    if (s.now - d.lastWatch >= WATCH_EVERY_MS || d.speedFactor < 1) {
      d.lastWatch = s.now;
      if (d.status === 'moving' && !d.delayChecked && d.eta - d.plannedArrival > DELAY_TRIGGER_S * 1000 && this.partOf(d)?.deliveryId === d.id) {
        d.delayChecked = true;
        this.log('System', `ETA slipped by ${minutes((d.eta - d.plannedArrival) / 1000)} min (more than 10) — running re-route check`, 'warn');
        this.reroute(d, 'delay');
      }
    }
  }

  private updateEta(d: Delivery) {
    const now = this.state.now;
    const wait = Math.max(0, d.waitUntil - now) / 1000;
    const speed = SPEED_MPS * (d.status === 'moving' ? d.speedFactor : 1);
    const pendingHandover = d.handoffAtM != null && !d.handoffDone ? HANDOVER_S : 0;
    d.eta = now + (wait + (d.lengthM - d.travelledM) / speed + pendingHandover) * 1000;
  }
}

export const engine = new Engine();
