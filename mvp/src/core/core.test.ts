import { describe, expect, it } from 'vitest';
import { compatibleDonors, isCompatible } from './blood';
import { buildInventory, buildOrgs, DEMO_RECEIVER_ID } from './city';
import { Engine } from './engine';
import { findSuppliers, isUsableOnArrival, nearestAvailableChoice, scoreOffers } from './matching';
import { decideReroute, ETA_OVERRIDE_MARGIN_S } from './reroute';
import { runMany, runTwin } from './twin';
import { buildRecordPdf } from '../ui/recordPdf';
import { DAY, generateHistory, PROBLEM_ORGS } from './history';
import { scoreAll, scoreOrg } from './performance';
import { byZone, filterRequests, reportCsv, suggestions, suppress, warnings } from './planning';

describe('compatibility table', () => {
  it('red cells: O- takes only O-, AB+ takes everything', () => {
    expect(compatibleDonors('PRBC', 'O-')).toEqual(['O-']);
    expect(compatibleDonors('PRBC', 'AB+')).toHaveLength(8);
    expect(isCompatible('PRBC', 'B+', 'O-')).toBe(true);
    expect(isCompatible('PRBC', 'B+', 'A+')).toBe(false);
  });
  it('plasma is reversed: AB plasma suits everyone, O plasma only O', () => {
    expect(isCompatible('FFP', 'A+', 'AB+')).toBe(true);
    expect(isCompatible('FFP', 'A+', 'O+')).toBe(false);
    expect(isCompatible('FFP', 'O+', 'A-')).toBe(true);
  });
  it('whole blood is identical-group only', () => {
    expect(compatibleDonors('WB', 'B+')).toEqual(['B+']);
  });
  it('identical group is always listed first', () => {
    expect(compatibleDonors('PLT', 'A+')[0]).toBe('A+');
  });
});

describe('scoring', () => {
  it('prefers faster offers when everything else is equal', () => {
    const [a, b] = scoreOffers(
      [
        { etaS: 600, units: 2, nearestExpiry: 1, tier: 2 as const },
        { etaS: 1200, units: 2, nearestExpiry: 1, tier: 2 as const },
      ],
      2,
    );
    expect(a.score).toBeLessThan(b.score);
  });
  it('penalises partial offers', () => {
    const [full, partial] = scoreOffers(
      [
        { etaS: 600, units: 2, nearestExpiry: 1, tier: 2 as const },
        { etaS: 600, units: 1, nearestExpiry: 1, tier: 2 as const },
      ],
      2,
    );
    expect(full.score).toBeLessThan(partial.score);
  });
});

describe('arrival margin', () => {
  it('skips stock that would arrive with less than the safety margin', () => {
    const now = 0;
    const lot = { id: 'x', orgId: 'o', group: 'B+' as const, component: 'PRBC' as const, units: 1, collectedAt: 0, expiresAt: 9 * 3600_000, status: 'available' as const };
    expect(isUsableOnArrival(lot, now, 900)).toBe(false); // 9 h left < 24 h margin
    expect(isUsableOnArrival({ ...lot, expiresAt: 30 * 3600_000 }, now, 900)).toBe(true);
  });
  it('demo: the nearest hospital only has almost-expired B+ red cells', () => {
    const now = Date.now();
    const orgs = buildOrgs();
    const lots = buildInventory(orgs, now);
    const receiver = orgs.find((o) => o.id === DEMO_RECEIVER_ID)!;
    const need = { group: 'B+' as const, component: 'PRBC' as const, units: 2 };
    const nearest = nearestAvailableChoice(orgs, lots, receiver.location, need, 10, now, [receiver.id]);
    expect(nearest?.org.id).toBe('org-durgapura');
    expect(nearest?.usable).toBe(false);
    const hits = findSuppliers(orgs, lots, receiver.location, need, 10, now, { excludeOrgIds: [receiver.id] });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) for (const l of h.lots) expect(isUsableOnArrival(l, now, h.etaS)).toBe(true);
  });
});

describe('re-route rule', () => {
  it('Case 1 below half the distance → fresh units', () => {
    expect(decideReroute({ travelledM: 4999, plannedM: 10000, keepEtaS: 900, freshEtaS: 900 })).toMatchObject({ caseNo: 1, choice: 'fresh' });
  });
  it('Case 2 at exactly half → keep the units on the road', () => {
    expect(decideReroute({ travelledM: 5000, plannedM: 10000, keepEtaS: 900, freshEtaS: 900 })).toMatchObject({ caseNo: 2, choice: 'keep' });
  });
  it('ETA override: a clearly faster option wins over the case rule', () => {
    const r = decideReroute({ travelledM: 8000, plannedM: 10000, keepEtaS: 2000, freshEtaS: 2000 - ETA_OVERRIDE_MARGIN_S - 1 });
    expect(r).toMatchObject({ caseNo: 2, choice: 'fresh', overridden: true });
  });
  it('falls back to whatever exists', () => {
    expect(decideReroute({ travelledM: 1000, plannedM: 10000, keepEtaS: 900, freshEtaS: null }).choice).toBe('keep');
  });
});

function runEngine(e: Engine, simSeconds: number) {
  for (let i = 0; i < simSeconds; i++) e.tick(1000 / e.state.speed);
}

const totalUnits = (e: Engine) => e.state.lots.reduce((a, l) => a + l.units, 0);
const unitsIn = (e: Engine, status: string) => e.state.lots.filter((l) => l.status === status).reduce((a, l) => a + l.units, 0);

describe('engine — full loop', () => {
  it('happy path: request → plan → approve → deliver → report → closed', () => {
    const e = new Engine();
    e.startDemo('happy');
    runEngine(e, 3 * 3600);
    const req = e.state.request!;
    expect(req.status).toBe('closed');
    expect(req.parts.every((p) => p.status === 'reported' && p.report)).toBe(true);
    expect(unitsIn(e, 'issued')).toBe(2);
  });

  it('mass casualty: 3 lines, at least one split across hospitals, every unit delivered, stock conserved', () => {
    const e = new Engine();
    const before = totalUnits(e);
    e.startDemo('mass_casualty');
    runEngine(e, 4 * 3600);
    const req = e.state.request!;
    expect(req.lines).toHaveLength(3);
    expect(req.status).toBe('closed');
    const suppliersPerLine = req.lines.map((l) => new Set(req.parts.filter((p) => p.status === 'reported' && p.items.some((i) => i.lineId === l.id)).map((p) => p.supplierOrgId)).size);
    expect(Math.max(...suppliersPerLine)).toBeGreaterThan(1);
    for (const l of req.lines) expect(e.committed(l.id)).toBe(l.units);
    expect(unitsIn(e, 'issued')).toBe(14);
    expect(totalUnits(e)).toBe(before); // splitting lots never creates or loses units
    expect(unitsIn(e, 'reserved')).toBe(0);
  });

  it('competing hospitals: the first bank loses its stock, the part fails and the request is re-sourced and closed', () => {
    const e = new Engine();
    e.startDemo('competing');
    runEngine(e, 4 * 3600);
    const req = e.state.request!;
    expect(req.parts.some((p) => p.status === 'conflict')).toBe(true);
    expect(req.status).toBe('closed');
    expect(e.committed('L1')).toBe(4);
    expect(unitsIn(e, 'reserved')).toBe(0);
  });

  it('the suggested plan never uses substitutes, and sending one needs a doctor confirmation', () => {
    const e = new Engine();
    e.createRequest({ urgency: 'urgent', lines: [{ group: 'B+', component: 'PRBC', units: 2, reason: 'injury' }] });
    e.skipWindow();
    const req = e.state.request!;
    expect(req.draft.every((p) => !e.offer(p.offerId)!.substitute)).toBe(true);
    const sub = req.offers.find((o) => o.substitute)!;
    for (const p of [...req.draft]) e.togglePick(p.offerId);
    e.togglePick(sub.id);
    e.sendPlan();
    expect(req.parts).toHaveLength(0); // blocked
    e.confirmSubstitutes(true);
    e.sendPlan();
    expect(req.parts).toHaveLength(1);
  });

  it('a plan never asks for more than the line needs', () => {
    const e = new Engine();
    e.createRequest({ urgency: 'urgent', lines: [{ group: 'B+', component: 'PRBC', units: 3, reason: 'injury' }] });
    e.skipWindow();
    const req = e.state.request!;
    for (const o of req.offers.filter((x) => !x.substitute)) if (!req.draft.some((p) => p.offerId === o.id)) e.togglePick(o.id);
    for (const p of req.draft) e.setPickUnits(p.offerId, 99);
    expect(e.draftUnits('L1')).toBeLessThanOrEqual(3);
  });

  for (const sc of ['breakdown_early', 'breakdown_late', 'delay'] as const) {
    it(`${sc}: re-routes and still closes`, () => {
      const e = new Engine();
      e.startDemo(sc);
      runEngine(e, 4 * 3600);
      expect(e.state.decisions.length).toBe(1);
      expect(e.state.request?.status).toBe('closed');
      // no lot is reserved twice / left dangling
      expect(e.state.lots.filter((l) => l.status === 'reserved')).toHaveLength(0);
    });
  }

  it('early breakdown is Case 1, late breakdown is Case 2', () => {
    const a = new Engine();
    a.startDemo('breakdown_early');
    runEngine(a, 3600);
    expect(a.state.decisions[0].caseNo).toBe(1);
    const b = new Engine();
    b.startDemo('breakdown_late');
    runEngine(b, 3600);
    expect(b.state.decisions[0].caseNo).toBe(2);
  });

  it('a decline frees the units and suggests another hospital, never the one that declined', () => {
    const e = new Engine();
    e.createRequest({ urgency: 'urgent', lines: [{ group: 'B+', component: 'PRBC', units: 2, reason: 'injury' }] });
    e.skipWindow();
    e.sendPlan();
    const req = e.state.request!;
    const first = req.parts[0];
    e.decline(first.id);
    expect(first.status).toBe('declined');
    expect(e.remaining('L1')).toBe(2);
    expect(req.draft.length).toBeGreaterThan(0);
    expect(req.draft.every((p) => e.offer(p.offerId)!.supplierOrgId !== first.supplierOrgId)).toBe(true);
  });
});

describe('PDF record', () => {
  it('contains the request, every supplying hospital, the reports and the timeline', () => {
    const e = new Engine();
    e.startDemo('mass_casualty');
    runEngine(e, 4 * 3600);
    const req = e.state.request!;
    const doc = buildRecordPdf(e);
    const text = doc.output(); // uncompressed PDF source
    expect(text.startsWith('%PDF')).toBe(true);
    expect(text).toContain(req.id);
    expect(text).toContain('Delivery reports');
    expect(text).toContain('Timeline');
    for (const p of req.parts.filter((x) => x.status === 'reported')) expect(text).toContain(e.org(p.supplierOrgId).name);
  });
});

describe('hospital performance score', () => {
  const now = Date.UTC(2026, 9, 16, 6);
  const orgs = buildOrgs();
  const history = generateHistory(orgs, now);
  const scores = scoreAll(orgs.map((o) => o.id), history.obs, now);

  it('prints the band distribution (calibration aid)', () => {
    const rows = orgs
      .filter((o) => o.verified)
      .map((o) => `${scores.get(o.id)!.score ?? '–'} ${scores.get(o.id)!.band ?? 'none'} ${o.name} [${scores.get(o.id)!.events} events; flags: ${scores.get(o.id)!.redFlags.join('; ')}]`);
    console.log(rows.sort().join('\n'));
  });
  it('most hospitals meet the standard; the two problem hospitals do not', () => {
    const verified = orgs.filter((o) => o.verified).map((o) => scores.get(o.id)!);
    const ok = verified.filter((s) => s.band === 'gold' || s.band === 'silver').length;
    expect(ok).toBeGreaterThan(verified.length * 0.7);
    for (const id of Object.keys(PROBLEM_ORGS)) {
      const s = scores.get(id)!;
      expect(['watch', 'review']).toContain(s.band);
      expect(s.redFlags.length).toBeGreaterThan(0);
    }
  });
  it('no score below the minimum number of events', () => {
    const s = scoreOrg('org-cscheme', history.obs.slice(0, 5), now);
    expect(s.score).toBeNull();
    expect(s.band).toBeNull();
  });
  it('an honest "no stock" costs nothing: unscored metrics are left out, not zeroed', () => {
    const obs = Array.from({ length: 12 }, (_, i) => ({ id: i, orgId: 'x', at: now - DAY, k: 'broadcast' as const, answered: true }));
    const s = scoreOrg('x', [...obs, { id: 99, orgId: 'x', at: now - DAY, k: 'inventory_update' as const }], now);
    expect(s.score).toBe(100);
  });
  it('appealed events are left out of the score', () => {
    const id = 'org-jamdoli';
    const base = scoreOrg(id, history.obs, now).score!;
    const bad = (o: (typeof history.obs)[number]) => (o.k === 'approval' && o.conflict) || (o.k === 'report_in' && (o.short || !o.tempOk));
    const appealed = history.obs.map((o) => (o.orgId === id && bad(o) ? { ...o, appealed: true } : o));
    expect(scoreOrg(id, appealed, now).score!).toBeGreaterThan(base);
  });
  it('a live request records events for the sender and the receiver', () => {
    const e = new Engine();
    const before = e.state.history.obs.length;
    const reqsBefore = e.state.history.requests.length;
    e.startDemo('happy');
    runEngine(e, 3 * 3600);
    const added = e.state.history.obs.slice(before);
    expect(added.some((o) => o.k === 'delivery')).toBe(true);
    expect(added.some((o) => o.k === 'report_in')).toBe(true);
    expect(added.some((o) => o.k === 'report_filed' && o.orgId === DEMO_RECEIVER_ID)).toBe(true);
    expect(e.state.history.requests.length).toBe(reqsBefore + 1);
    expect(e.state.history.requests[e.state.history.requests.length - 1]).toMatchObject({ outcome: 'fulfilled', condition: 'injury' });
  });
});

describe('planning data', () => {
  const now = Date.UTC(2026, 9, 16, 6);
  const orgs = buildOrgs();
  const history = generateHistory(orgs, now);

  it('suppresses small counts', () => {
    expect(suppress(0)).toBe('0');
    expect(suppress(3)).toBe('<5');
    expect(suppress(5)).toBe('5');
  });
  it('raises an early warning for the dengue outbreak in the South zone', () => {
    const w = warnings(history.requests, orgs, now);
    expect(w.some((x) => x.zone === 'South' && x.condition === 'dengue')).toBe(true);
  });
  it('suggests a thalassaemia day-care centre at the hospital with recurring requests', () => {
    const rs = filterRequests(history.requests, { days: 90, condition: 'all', component: 'all' }, now);
    const sg = suggestions(rs, orgs);
    expect(sg.some((s) => s.kind === 'daycare' && s.where.includes('Gopalpura'))).toBe(true);
    console.log(sg.map((s) => `${s.kind}: ${s.where} — ${s.evidence}`).join('\n'));
  });
  it('zone totals add up to the city total', () => {
    const rs = filterRequests(history.requests, { days: 90, condition: 'all', component: 'all' }, now);
    expect(byZone(rs, orgs).reduce((a, z) => a + z.requests, 0)).toBe(rs.length);
  });
  it('the CSV report never contains a count between 1 and 4', () => {
    const rs = filterRequests(history.requests, { days: 30, condition: 'all', component: 'all' }, now);
    const csv = reportCsv(rs, orgs, { days: 30, condition: 'all', component: 'all' });
    for (const line of csv.split('\n').slice(2)) {
      const cells = line.split(',').slice(-4);
      for (const c of cells) expect(['1', '2', '3', '4']).not.toContain(c);
    }
  });
});

describe('twin simulation', () => {
  it('is deterministic for a seed', () => {
    expect(runTwin(3, 'normal')).toEqual(runTwin(3, 'normal'));
  });
  it('invariants hold for both planners: no double allocation, no incompatible match', () => {
    const s = runMany(5, 'spike');
    for (const p of [s.nearest, s.smart]) {
      expect(p.doubleAllocations).toBe(0);
      expect(p.incompatible).toBe(0);
    }
    expect(s.smart.expiredInTransit).toBe(0);
  });
  it('prints a summary (calibration aid)', () => {
    const t = performance.now();
    for (const sc of ['normal', 'spike', 'breakdowns'] as const) {
      const s = runMany(10, sc);
      const fmt = (p: typeof s.smart) =>
        `P1 ${p.p1OnTime.toFixed(1)}% fill ${p.fillRate.toFixed(1)}% expired ${p.expired.toFixed(1)} inTransit ${p.expiredInTransit.toFixed(1)} O- ${p.oNegMisuse.toFixed(1)} km ${p.km.toFixed(0)} trips ${p.trips.toFixed(0)}`;
      console.log(`[${sc}] req ${s.requests.toFixed(0)}\n  nearest: ${fmt(s.nearest)}\n  smart:   ${fmt(s.smart)}`);
    }
    console.log(`30 runs x2 took ${(performance.now() - t).toFixed(0)} ms`);
  });
});
