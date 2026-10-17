// Hospital Performance Score (credit points), from the mentor-feedback proposal, section 2.
// - Only what the platform observes; an honest "no stock" costs nothing.
// - Rolling 90-day window; no score until a hospital has at least 10 sender events.
// - Metrics with no data are left out and the total is rescaled, so a small hospital is not
//   rewarded or punished for activity it never had.
// - Appealed events are excluded until reviewed.

import { DAY, HISTORY_DAYS, type Obs } from './history';

export const MIN_EVENTS = 10;
export const WINDOW_MS = HISTORY_DAYS * DAY;

export type Band = 'gold' | 'silver' | 'watch' | 'review';
export const BANDS: Record<Band, { label: string; min: number; meaning: string }> = {
  gold: { label: 'Gold', min: 85, meaning: 'Highly reliable' },
  silver: { label: 'Silver', min: 70, meaning: 'Meets the standard' },
  watch: { label: 'Watch', min: 50, meaning: 'Notified with tips to improve' },
  review: { label: 'Review', min: 0, meaning: 'Flagged for human review' },
};
export const bandOf = (score: number): Band => (score >= 85 ? 'gold' : score >= 70 ? 'silver' : score >= 50 ? 'watch' : 'review');

export type Area = 'Responsiveness' | 'Inventory accuracy' | 'Delivery' | 'Cold chain & safety' | 'Stewardship';

export interface MetricResult {
  key: string;
  area: Area;
  label: string;
  max: number;
  /** null = no data in the window */
  points: number | null;
  value: string;
  n: number;
  tip: string;
}

export interface ReceiverCard {
  reportOnTime: number | null;
  cancelRate: number | null;
  overstated: number | null;
  score: number | null;
}

export interface OrgScore {
  orgId: string;
  events: number;
  eligible: boolean;
  score: number | null;
  band: Band | null;
  metrics: MetricResult[];
  receiver: ReceiverCard;
  redFlags: string[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** linear: `good` or better → 1, `bad` or worse → 0 (works for both directions) */
const scale = (v: number, bad: number, good: number) => clamp01((v - bad) / (good - bad));
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function scoreOrg(orgId: string, all: Obs[], now: number): OrgScore {
  const obs = all.filter((o) => o.orgId === orgId && !o.appealed && o.at <= now && o.at > now - WINDOW_MS);
  const of = <K extends Obs['k']>(k: K) => obs.filter((o) => o.k === k) as Extract<Obs, { k: K }>[];

  const broadcasts = of('broadcast');
  const selected = of('selected');
  const approvals = of('approval');
  const deliveries = of('delivery');
  const reports = of('report_in');
  const updates = of('inventory_update');
  const weeks = of('stock_week');
  const events = broadcasts.length + selected.length + approvals.length + deliveries.length;

  const m: MetricResult[] = [];
  const add = (r: Omit<MetricResult, 'points'> & { fraction: number | null }) => {
    const { fraction, ...rest } = r;
    m.push({ ...rest, points: fraction == null ? null : Math.round(fraction * r.max * 10) / 10 });
  };

  // Responsiveness (25)
  const answered = broadcasts.filter((b) => b.answered).length / (broadcasts.length || 1);
  add({ key: 'answer', area: 'Responsiveness', label: 'Answers incoming requests', max: 10, n: broadcasts.length,
    fraction: broadcasts.length ? scale(answered, 0.6, 0.98) : null, value: broadcasts.length ? `${pct(answered)} answered in the window` : 'no data',
    tip: 'Keep notifications on at the blood bank desk so requests are answered inside 2.5 minutes.' });
  const answerMins = selected.filter((s) => s.answerMin != null).map((s) => s.answerMin!);
  const medAnswer = median(answerMins);
  add({ key: 'approve_speed', area: 'Responsiveness', label: 'Approval speed', max: 10, n: answerMins.length,
    fraction: answerMins.length ? scale(medAnswer, 5, 2) : null, value: answerMins.length ? `median ${medAnswer.toFixed(1)} min` : 'no data',
    tip: 'Approve or decline within 2 minutes; the receiver is waiting.' });
  const timeouts = selected.filter((s) => s.timedOut).length / (selected.length || 1);
  add({ key: 'timeouts', area: 'Responsiveness', label: 'No silent timeouts', max: 5, n: selected.length,
    fraction: selected.length ? scale(timeouts, 0.2, 0) : null, value: selected.length ? `${pct(timeouts)} timed out` : 'no data',
    tip: 'If you cannot send, decline — a silent timeout costs the receiver 5 minutes.' });

  // Inventory accuracy (25)
  const conflicts = approvals.filter((a) => a.conflict).length;
  const shorts = reports.filter((r) => r.short).length;
  const real = 1 - (conflicts + shorts) / (approvals.length || 1);
  add({ key: 'stock_real', area: 'Inventory accuracy', label: 'Stock shown was real', max: 15, n: approvals.length,
    fraction: approvals.length ? scale(real, 0.7, 1) : null,
    value: approvals.length ? `${conflicts} conflict(s), ${shorts} short delivery(ies) in ${approvals.length} approvals` : 'no data',
    tip: 'Mark units as issued or discarded the moment they leave the fridge.' });
  const lastUpdate = updates.length ? Math.max(...updates.map((u) => u.at)) : null;
  const hours = lastUpdate == null ? null : (now - lastUpdate) / 3600_000;
  add({ key: 'stock_fresh', area: 'Inventory accuracy', label: 'Stock kept up to date', max: 10, n: updates.length,
    fraction: hours == null ? 0 : scale(hours, 72, 24), value: hours == null ? 'never updated' : `last update ${Math.round(hours)} h ago`,
    tip: 'Update inventory at least once a day (CSV upload works).' });

  // Delivery (20)
  const countable = deliveries.filter((d) => !d.excused);
  const onTime = countable.filter((d) => d.lateMin <= 10).length / (countable.length || 1);
  add({ key: 'on_time', area: 'Delivery', label: 'On-time arrival', max: 10, n: countable.length,
    fraction: countable.length ? scale(onTime, 0.6, 1) : null, value: countable.length ? `${pct(onTime)} within 10 min of ETA` : 'no data',
    tip: 'Plan the route before leaving and report delays early.' });
  const dispatch = median(deliveries.map((d) => d.dispatchMin));
  add({ key: 'dispatch', area: 'Delivery', label: 'Fast dispatch', max: 5, n: deliveries.length,
    fraction: deliveries.length ? scale(dispatch, 30, 10) : null, value: deliveries.length ? `median ${Math.round(dispatch)} min after approval` : 'no data',
    tip: 'Keep a driver on call and a packed cold box ready.' });
  const incidents = deliveries.filter((d) => d.incident !== 'none');
  const byDriver = incidents.filter((d) => d.incident === 'driver').length / (incidents.length || 1);
  add({ key: 'incidents', area: 'Delivery', label: 'Incidents reported by the driver', max: 5, n: incidents.length,
    fraction: incidents.length ? byDriver : null, value: incidents.length ? `${pct(byDriver)} of ${incidents.length} reported by the driver` : 'no incidents',
    tip: 'Drivers should report problems in the app before the system detects them.' });

  // Cold chain & safety (15)
  const tempOk = reports.filter((r) => r.tempOk).length / (reports.length || 1);
  add({ key: 'temp', area: 'Cold chain & safety', label: 'Temperature in range on arrival', max: 10, n: reports.length,
    fraction: reports.length ? scale(tempOk, 0.8, 1) : null, value: reports.length ? `${pct(tempOk)} of reports` : 'no data',
    tip: 'Use validated cold boxes and check the temperature log before dispatch.' });
  const bagsOk = reports.filter((r) => r.bagsOk).length / (reports.length || 1);
  add({ key: 'bags', area: 'Cold chain & safety', label: 'Bag numbers complete', max: 5, n: reports.length,
    fraction: reports.length ? scale(bagsOk, 0.8, 1) : null, value: reports.length ? `${pct(bagsOk)} of reports` : 'no data',
    tip: 'Attach a bag list to every cold box.' });

  // Stewardship (15) — NABH wastage rate = discarded × 100 / prepared
  const prepared = weeks.reduce((a, w) => a + w.prepared, 0);
  const discarded = weeks.reduce((a, w) => a + w.discarded, 0);
  const shared = weeks.reduce((a, w) => a + w.sharedBeforeExpiry, 0);
  const wastage = prepared ? discarded / prepared : 0;
  add({ key: 'wastage', area: 'Stewardship', label: 'Wastage rate (NABH)', max: 10, n: weeks.length,
    fraction: prepared ? scale(wastage, 0.2, 0.05) : null, value: prepared ? `${(wastage * 100).toFixed(1)}% discarded` : 'no data',
    tip: 'Use oldest units first and offer short-dated units to the network.' });
  const shareRate = shared + discarded ? shared / (shared + discarded) : 0;
  add({ key: 'share', area: 'Stewardship', label: 'Shares short-dated stock', max: 5, n: weeks.length,
    fraction: shared + discarded ? scale(shareRate, 0, 0.6) : null, value: shared + discarded ? `${pct(shareRate)} of at-risk units shared` : 'no data',
    tip: 'Offer units expiring within 72 h to the network instead of discarding them.' });

  const scored = m.filter((x) => x.points != null);
  const maxAvail = scored.reduce((a, x) => a + x.max, 0);
  const eligible = events >= MIN_EVENTS && maxAvail > 0;
  const score = eligible ? Math.round((scored.reduce((a, x) => a + x.points!, 0) / maxAvail) * 100) : null;

  // red flags (section 4 of the proposal): reviewed immediately by a person, regardless of score
  const redFlags: string[] = [];
  const recent = (o: Obs) => o.at > now - 30 * DAY;
  const breaches = reports.filter((r) => !r.tempOk && recent(r)).length;
  if (breaches) redFlags.push(`${breaches} cold-chain breach(es) reported in the last 30 days`);
  const recentConflicts = approvals.filter((a) => a.conflict && recent(a)).length;
  if (recentConflicts >= 3) redFlags.push(`${recentConflicts} inventory conflicts in the last 30 days`);
  const recentShorts = reports.filter((r) => r.short && recent(r)).length;
  if (recentShorts) redFlags.push(`${recentShorts} delivery(ies) with fewer units than offered in the last 30 days`);

  return { orgId, events, eligible, score, band: score == null ? null : bandOf(score), metrics: m, receiver: receiverCard(obs), redFlags };
}

function receiverCard(obs: Obs[]): ReceiverCard {
  const filed = obs.filter((o) => o.k === 'report_filed') as Extract<Obs, { k: 'report_filed' }>[];
  const cancels = obs.filter((o) => o.k === 'cancel').length;
  const checks = obs.filter((o) => o.k === 'urgency_check') as Extract<Obs, { k: 'urgency_check' }>[];
  const reportOnTime = filed.length ? filed.filter((f) => f.minutes <= 60).length / filed.length : null;
  const cancelRate = filed.length + cancels ? cancels / (filed.length + cancels) : null;
  const overstated = checks.length ? checks.filter((c) => c.overstated).length / checks.length : null;
  const parts = [reportOnTime, cancelRate == null ? null : scale(cancelRate, 0.2, 0), overstated == null ? null : scale(overstated, 0.3, 0)].filter(
    (x): x is number => x != null,
  );
  return { reportOnTime, cancelRate, overstated, score: parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : null };
}

export function scoreAll(orgIds: string[], obs: Obs[], now: number): Map<string, OrgScore> {
  return new Map(orgIds.map((id) => [id, scoreOrg(id, obs, now)]));
}

/** Used in option ranking in place of the fixed hospital tier: Gold 1, Silver or unscored 2, Watch/Review 3. */
export function rankTier(s: OrgScore | undefined): 1 | 2 | 3 {
  if (!s?.band) return 2;
  return s.band === 'gold' ? 1 : s.band === 'silver' ? 2 : 3;
}
