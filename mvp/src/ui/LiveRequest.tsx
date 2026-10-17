import { useEffect, useState } from 'react';
import { BLOOD_GROUPS, COMPONENTS, COMPONENT_CODES, TRANSPORT_TEMP, tempInRange } from '../core/blood';
import { CONDITIONS, conditionOf } from '../core/conditions';
import { COMPETITION, describeLine, engine, MASS_CASUALTY, minutes, SCENARIOS, type Competition, type EngineState, type NewLine } from '../core/engine';
import { nearestAvailableChoice } from '../core/matching';
import type { Actor, Offer, Part, RequestLine, Urgency } from '../core/types';
import { fmtClock, fmtCountdown, fmtExpiry, fmtKm, fmtTime } from './format';
import { MapView } from './MapView';
import { BandBadge } from './Performance';

const STEPS: { title: string; who: Actor }[] = [
  { title: 'Ask for blood', who: 'Receiver' },
  { title: 'Alert nearby hospitals', who: 'System' },
  { title: 'Collect offers (2.5 min)', who: 'System' },
  { title: 'Choose hospitals (split if needed)', who: 'Receiver' },
  { title: 'Senders approve', who: 'Sender' },
  { title: 'Assign drivers', who: 'Sender' },
  { title: 'On the way — live tracking', who: 'Driver' },
  { title: 'Confirm received', who: 'Receiver' },
  { title: 'File delivery reports', who: 'Receiver' },
];

const PART_STEP: Partial<Record<Part['status'], number>> = { awaiting_approval: 4, approved: 5, in_transit: 6, arrived: 7, received: 8 };

function currentStep(s: EngineState): number {
  const req = s.request;
  if (!req) return 0;
  switch (req.status) {
    case 'searching':
    case 'no_match':
      return 2;
    case 'planning':
      return 3;
    case 'closed':
      return 9;
    case 'cancelled':
      return 0;
    case 'in_progress': {
      const steps = req.parts.map((p) => PART_STEP[p.status]).filter((x): x is number => x != null);
      return steps.length ? Math.min(...steps) : 3;
    }
  }
}

export function Role({ who, name }: { who: Actor; name?: string }) {
  return (
    <span className={`role role-${who.toLowerCase()}`}>
      {who}
      {name ? ` · ${name}` : ''}
    </span>
  );
}

export function LiveRequest({ s }: { s: EngineState }) {
  const req = s.request;
  const current = currentStep(s);
  const rerouted = s.decisions.length > 0;
  const hospitals = req ? new Set(req.parts.filter((p) => !['declined', 'timed_out', 'conflict', 'cancelled'].includes(p.status)).map((p) => p.supplierOrgId)).size : 0;

  return (
    <div className="live">
      <aside className="left">
        <ol className="stepper">
          {STEPS.map((st, i) => {
            const state = i < current ? 'done' : i === current ? 'now' : 'todo';
            return (
              <li key={i} className={`step ${state}`}>
                <span className="num">{state === 'done' ? '✓' : i + 1}</span>
                <span className="st-title">
                  {st.title}
                  {i === 3 && hospitals > 1 && <span className="tag">{hospitals} hospitals</span>}
                  {i === 6 && rerouted && <span className="tag warn">re-routed</span>}
                </span>
                <Role who={st.who} />
              </li>
            );
          })}
        </ol>
      </aside>

      <section className="center">
        <CompetitionBar s={s} />
        {s.scenario !== 'manual' && req && !['closed', 'cancelled', 'no_match'].includes(req.status) && (
          <div className="auto-note">
            ▶ Auto demo: <b>{SCENARIOS[s.scenario].title}</b> — everyone acts by themselves. You can still click buttons.
          </div>
        )}
        <ActionCard s={s} />
      </section>

      <section className="right">
        <MapView s={s} />
        <Timeline s={s} />
      </section>
    </div>
  );
}

function CompetitionBar({ s }: { s: EngineState }) {
  return (
    <div className="competition">
      <span>Other hospitals requesting now:</span>
      <div className="choice inline small">
        {(Object.keys(COMPETITION) as Competition[]).map((c) => (
          <button key={c} className={s.competition === c ? 'on' : ''} onClick={() => engine.setCompetition(c)}>
            {COMPETITION[c].label}
          </button>
        ))}
      </div>
      <span className="hint">Simulated: they can take stock you are planning on.</span>
    </div>
  );
}

function ActionCard({ s }: { s: EngineState }) {
  const req = s.request;
  if (!req) return <RequestForm s={s} />;
  switch (req.status) {
    case 'searching':
      return <Searching s={s} />;
    case 'planning':
      return <PlanEditor s={s} />;
    case 'in_progress':
      return (
        <>
          <PlanEditor s={s} />
          <Parts s={s} />
        </>
      );
    case 'closed':
      return <Closed s={s} />;
    case 'no_match':
      return (
        <div className="card">
          <h2>No blood found</h2>
          <p>No verified hospital within {req.radiusKm} km could supply this request. The platform admin has been alerted.</p>
          <div className="btn-row">
            <DownloadPdf />
            <button className="btn primary" onClick={() => engine.newRequest()}>
              Start a new request
            </button>
          </div>
        </div>
      );
    case 'cancelled':
      return (
        <div className="card">
          <h2>Request cancelled</h2>
          <div className="btn-row">
            <DownloadPdf />
            <button className="btn primary" onClick={() => engine.newRequest()}>
              Start a new request
            </button>
          </div>
        </div>
      );
  }
}

// ---------- step 1 ----------

const blankLine = (): NewLine => ({ group: 'B+', component: 'PRBC', units: 2, reason: 'injury' });

function RequestForm({ s }: { s: EngineState }) {
  const [lines, setLines] = useState<NewLine[]>([blankLine()]);
  const [urgency, setUrgency] = useState<Urgency>('urgent');
  const receiver = engine.receiver;
  const setLine = (i: number, patch: Partial<NewLine>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <>
      <div className="card">
        <h2>
          Need blood? <Role who="Receiver" />
        </h2>
        <label className="field">
          <span>Your hospital</span>
          <select value={s.receiverOrgId} onChange={(e) => engine.setReceiver(e.target.value)}>
            {s.orgs
              .filter((o) => o.type === 'hospital')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — {o.area}
                  {o.verified ? '' : ' (pending verification)'}
                </option>
              ))}
          </select>
        </label>

        {lines.map((l, i) => (
          <div key={i} className="line-card">
            <div className="line-head">
              <b>{lines.length > 1 ? `Patient ${i + 1}` : 'What is needed'}</b>
              {lines.length > 1 && (
                <button className="btn small ghost" onClick={() => setLines(lines.filter((_, k) => k !== i))} title="Remove this patient">
                  ✕ Remove
                </button>
              )}
            </div>
            <div className="line-grid">
              <label className="field">
                <span>Blood group</span>
                <select value={l.group} onChange={(e) => setLine(i, { group: e.target.value as NewLine['group'] })}>
                  {BLOOD_GROUPS.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Component</span>
                <select value={l.component} onChange={(e) => setLine(i, { component: e.target.value as NewLine['component'] })}>
                  {COMPONENT_CODES.map((c) => (
                    <option key={c} value={c}>
                      {COMPONENTS[c].label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span>Units</span>
                <div className="stepper-input">
                  <button onClick={() => setLine(i, { units: Math.max(1, l.units - 1) })}>−</button>
                  <b>{l.units}</b>
                  <button onClick={() => setLine(i, { units: Math.min(20, l.units + 1) })}>+</button>
                </div>
              </div>
              <label className="field">
                <span>Blood needed for</span>
                <select value={l.reason} onChange={(e) => setLine(i, { reason: e.target.value as NewLine['reason'] })}>
                  {CONDITIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}
        <div className="btn-row tight">
          <button className="btn small" onClick={() => setLines([...lines, blankLine()])}>
            + Add another patient
          </button>
          <button
            className="btn small ghost"
            onClick={() => {
              setLines(MASS_CASUALTY.lines.map((l) => ({ ...l })));
              setUrgency('critical');
            }}
          >
            Fill mass-casualty example
          </button>
        </div>

        <div className="field">
          <span>How urgent?</span>
          <div className="choice grid3">
            {(['routine', 'urgent', 'critical'] as Urgency[]).map((u) => (
              <button key={u} className={`${u === urgency ? 'on' : ''} ${u === 'critical' ? 'crit' : ''}`} onClick={() => setUrgency(u)}>
                {u[0].toUpperCase() + u.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <p className="summary">
          Asking for <b>{lines.map(describeLine).join(', ')}</b>, {urgency}, delivered to <b>{receiver.name}</b>, {receiver.area}.
          {lines.length > 1 && ' Each patient is matched separately; units can come from several hospitals.'}
        </p>
        {!receiver.verified ? (
          <p className="banner warn">This hospital is waiting for admin verification, so it cannot request blood yet. Verify it in “Hospitals &amp; stock”.</p>
        ) : (
          <button className="btn primary big" onClick={() => engine.createRequest({ lines, urgency })}>
            Find blood
          </button>
        )}
        <p className="hint">No patient names are stored — only the condition (ICD-10 block), used in anonymous area reports for planning.</p>
      </div>

      <div className="card demo">
        <h3>Or watch a demo</h3>
        <p className="hint">Plays the whole flow by itself from St. Mira District Hospital, Sanganer.</p>
        <div className="demo-grid">
          {(Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]).map((k) => (
            <button key={k} className="btn" onClick={() => engine.startDemo(k)}>
              <b>{SCENARIOS[k].title}</b>
              <small>{SCENARIOS[k].text}</small>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------- steps 2–3 ----------

function Searching({ s }: { s: EngineState }) {
  const req = s.request!;
  const left = (req.matchDeadline - s.now) / 1000;
  const answered = req.broadcasts.filter((b) => b.responded).length;
  const withStock = new Set(req.offers.map((o) => o.supplierOrgId)).size;
  return (
    <div className="card">
      <h2>Searching nearby hospitals</h2>
      <div className="countdown">{fmtCountdown(left)}</div>
      <p className="center-text">time left to collect offers</p>
      <div className="stats">
        <div>
          <b>{req.broadcasts.length}</b>
          <span>hospitals alerted</span>
        </div>
        <div>
          <b>{answered}</b>
          <span>answered</span>
        </div>
        <div>
          <b>{withStock}</b>
          <span>have stock</span>
        </div>
      </div>
      <ul className="mini-list">
        {req.lines.map((l) => {
          const offers = req.offers.filter((o) => o.lineId === l.id && !o.substitute);
          const units = offers.reduce((a, o) => a + o.units, 0);
          return (
            <li key={l.id}>
              <span>{describeLine(l)}</span>
              <span className={units >= l.units ? 'ok-t' : 'warn-t'}>
                {units} offered by {offers.length} hospital(s)
              </span>
            </li>
          );
        })}
      </ul>
      <p className="hint">Search area: {req.radiusKm} km around you (starts at 10 km, widens to 25 and 50 km if there isn't enough stock).</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => engine.skipWindow()}>
          Show options now
        </button>
        <button className="btn ghost" onClick={() => engine.cancelRequest()}>
          Cancel request
        </button>
      </div>
    </div>
  );
}

// ---------- step 4: supply plan ----------

function PlanEditor({ s }: { s: EngineState }) {
  const req = s.request!;
  const openParts = req.parts.some((p) => ['awaiting_approval', 'approved', 'in_transit', 'arrived', 'received'].includes(p.status));
  const needsLines = req.lines.filter((l) => engine.remaining(l.id) > 0);
  // while parts are running, only show the editor if something still needs a source
  if (req.status === 'in_progress' && needsLines.length === 0) return null;

  const planned = req.draft.reduce((a, p) => a + p.units, 0);
  const suppliers = new Set(req.draft.map((p) => engine.offer(p.offerId)!.supplierOrgId)).size;
  const missing = req.lines.reduce((a, l) => a + engine.uncovered(l.id), 0);

  return (
    <div className={`card ${req.status === 'in_progress' ? 'attention' : ''}`}>
      <h2>
        {req.status === 'in_progress' ? 'Some units still need a hospital' : 'Choose hospitals'} <Role who="Receiver" />
      </h2>
      <p className="hint">
        HemoArrive suggests the best-ranked hospitals until each patient's units are covered — split across hospitals if one doesn't have enough. Untick, add, or change
        units before sending. Ranked by arrival time (60%), units (20%), older stock first (10%) and performance band (10%).
      </p>

      {(req.status === 'in_progress' ? needsLines : req.lines).map((l, i) => (
        <LinePlan key={l.id} s={s} line={l} index={i} multi={req.lines.length > 1} />
      ))}

      <div className="plan-footer">
        <div>
          <b>
            {planned} unit(s) from {suppliers} hospital(s)
          </b>
          {missing > 0 && <span className="warn-t"> · {missing} unit(s) not covered</span>}
        </div>
        {req.draft.some((p) => engine.offer(p.offerId)!.substitute) && (
          <label className="confirm">
            <input type="checkbox" checked={req.substitutesConfirmed} onChange={(e) => engine.confirmSubstitutes(e.target.checked)} />
            A doctor has approved the substitute blood group(s) in this plan
          </label>
        )}
        <div className="btn-row">
          <button className="btn primary" disabled={planned === 0 || engine.planNeedsSubstituteConfirmation} onClick={() => engine.sendPlan()}>
            Send request{suppliers > 1 ? `s to ${suppliers} hospitals` : ''}
          </button>
          <button className="btn ghost" onClick={() => engine.resetPlan()}>
            Reset to suggestion
          </button>
          {req.status === 'in_progress' && !openParts && planned === 0 && (
            <button className="btn bad" onClick={() => engine.closeWithShortfall()}>
              Close with shortfall
            </button>
          )}
          {engine.canCancel && (
            <button className="btn ghost" onClick={() => engine.cancelRequest()}>
              Cancel request
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LinePlan({ s, line, index, multi }: { s: EngineState; line: RequestLine; index: number; multi: boolean }) {
  const req = s.request!;
  const [showSubs, setShowSubs] = useState(false);
  const sent = engine.committed(line.id);
  const planned = engine.draftUnits(line.id);
  const missing = engine.uncovered(line.id);
  const exact = req.offers.filter((o) => o.lineId === line.id && !o.substitute);
  const subs = req.offers.filter((o) => o.lineId === line.id && o.substitute);
  const receiver = engine.receiver;
  const nearest = nearestAvailableChoice(s.orgs, s.lots, receiver.location, line, req.radiusKm, s.now, [receiver.id]);
  const pct = (n: number) => `${(n / line.units) * 100}%`;

  return (
    <div className="line-plan">
      <div className="line-head">
        <b>
          {multi ? `Patient ${index + 1}: ` : ''}
          {describeLine(line)}
        </b>
        <span className="muted">{conditionOf(line.reason).label}</span>
      </div>
      <div className="coverage" title={`${sent} sent · ${planned} planned · ${missing} missing`}>
        <div className="cv-sent" style={{ width: pct(sent) }} />
        <div className="cv-plan" style={{ width: pct(planned) }} />
        <div className="cv-miss" style={{ width: pct(missing) }} />
      </div>
      <div className="coverage-legend">
        {sent > 0 && <span>■ {sent} sent</span>}
        <span className="c-plan">■ {planned} planned</span>
        {missing > 0 && <span className="c-miss">■ {missing} not covered</span>}
      </div>

      {nearest && !nearest.usable && (
        <div className="insight small">
          <b>Why not the nearest unit?</b> {nearest.org.name}'s oldest {line.group} unit would arrive with only {Math.max(0, Math.round(nearest.hoursLeftOnArrival))} h of life
          left — below the {COMPONENTS[line.component].marginHours} h safety margin.
        </div>
      )}

      {exact.map((o, i) => (
        <OfferRow key={o.id} o={o} s={s} rank={i + 1} />
      ))}
      {missing > 0 && !exact.some((o) => engine.available(o) > 0 && !req.failedOrgIds.includes(o.supplierOrgId) && !req.draft.some((p) => p.offerId === o.id)) && (
        <p className="banner warn">
          No other hospital within {req.radiusKm} km has {line.group} {COMPONENTS[line.component].short.toLowerCase()} left for the remaining {missing} unit(s)
          {subs.length ? ' — a compatible substitute may help (doctor must confirm).' : '.'}
        </p>
      )}

      {subs.length > 0 && (
        <>
          <button className="link" onClick={() => setShowSubs(!showSubs)}>
            {showSubs ? '▾' : '▸'} Compatible substitutes ({subs.length}) — a doctor must confirm before use
          </button>
          {showSubs && subs.map((o, i) => <OfferRow key={o.id} o={o} s={s} rank={i + 1} />)}
        </>
      )}
    </div>
  );
}

function OfferRow({ o, s, rank }: { o: Offer; s: EngineState; rank: number }) {
  const req = s.request!;
  const org = engine.org(o.supplierOrgId);
  const pick = req.draft.find((p) => p.offerId === o.id);
  const avail = engine.available(o);
  const failed = req.failedOrgIds.includes(o.supplierOrgId);
  const gone = avail === 0;
  const disabled = failed || (gone && !pick);
  return (
    <div className={`offer-row ${pick ? 'picked' : ''} ${disabled ? 'off' : ''}`}>
      <label className="pick">
        <input type="checkbox" checked={!!pick} disabled={disabled} onChange={() => engine.togglePick(o.id)} />
        <span className="rank">{rank}</span>
      </label>
      <div className="or-main">
        <div>
          <b>{org.name}</b> {o.substitute && <span className="tag warn">{o.group} substitute</span>} <BandBadge score={engine.scores().get(org.id)} />
        </div>
        <div className="chips">
          <span>⏱ {minutes(o.etaS)} min</span>
          <span>📍 {fmtKm(o.distanceM)}</span>
          <span className={avail < o.units ? 'warn-t' : ''}>🩸 {gone ? 'none left' : `${avail} available`}</span>
          <span>⌛ {fmtExpiry(o.nearestExpiry, s.now)}</span>
        </div>
        {failed && <div className="muted">Not suggested again — {req.parts.find((p) => p.supplierOrgId === o.supplierOrgId && p.failReason)?.status.replace('_', ' ') ?? 'unavailable'}</div>}
        {gone && !failed && <div className="muted">Taken by other hospitals</div>}
      </div>
      {pick && (
        <div className="stepper-input small">
          <button onClick={() => engine.setPickUnits(o.id, pick.units - 1)}>−</button>
          <b>{pick.units}</b>
          <button onClick={() => engine.setPickUnits(o.id, pick.units + 1)}>+</button>
        </div>
      )}
    </div>
  );
}

// ---------- steps 5–9: one card per hospital ----------

const PART_LABEL: Record<Part['status'], { text: string; tone: string }> = {
  awaiting_approval: { text: 'Waiting for approval', tone: '' },
  approved: { text: 'Approved — assign driver', tone: 'good' },
  in_transit: { text: 'On the way', tone: '' },
  arrived: { text: 'Arrived', tone: 'good' },
  received: { text: 'Report needed', tone: 'warn' },
  reported: { text: 'Done', tone: 'good' },
  declined: { text: 'Declined', tone: 'bad' },
  timed_out: { text: 'No answer', tone: 'bad' },
  conflict: { text: 'Stock gone', tone: 'bad' },
  cancelled: { text: 'Withdrawn', tone: 'bad' },
};

function Parts({ s }: { s: EngineState }) {
  const req = s.request!;
  const active = req.parts.filter((p) => !['declined', 'timed_out', 'conflict', 'cancelled'].includes(p.status));
  const failed = req.parts.filter((p) => ['declined', 'timed_out', 'conflict', 'cancelled'].includes(p.status));
  return (
    <>
      {active.map((p) => (
        <PartCard key={p.id} s={s} part={p} />
      ))}
      {failed.length > 0 && (
        <div className="card failed-parts">
          <h3>Could not supply</h3>
          {failed.map((p) => (
            <div key={p.id} className="muted">
              ✕ {p.failReason} ({p.units} unit(s) re-planned)
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function itemsText(part: Part) {
  return part.items.map((i) => describeLine({ ...engine.line(i.lineId), group: engine.offer(i.offerId)!.group, units: i.units })).join(', ');
}

function PartCard({ s, part }: { s: EngineState; part: Part }) {
  const org = engine.org(part.supplierOrgId);
  const label = PART_LABEL[part.status];
  return (
    <div className={`card part part-${part.status}`}>
      <div className="part-head">
        <div>
          <b>{org.name}</b>
          <div className="muted">{itemsText(part)}</div>
        </div>
        <span className={`tag ${label.tone}`}>{label.text}</span>
      </div>
      {part.status === 'awaiting_approval' && <Approval s={s} part={part} />}
      {part.status === 'approved' && <Dispatch part={part} />}
      {part.status === 'in_transit' && <Tracking s={s} part={part} />}
      {part.status === 'arrived' && (
        <>
          <p>
            {engine.deliveryOf(part)!.driver.name} is at {engine.receiver.name}. Check the cold box, then confirm. <Role who="Receiver" />
          </p>
          <button className="btn primary" onClick={() => engine.confirmReceived(part.id)}>
            Confirm units received
          </button>
        </>
      )}
      {part.status === 'received' && <ReportForm s={s} part={part} />}
      {part.status === 'reported' && part.report && (
        <p className="ok-t">
          ✓ {part.report.unitsReceived} unit(s) received at {part.report.tempOnArrival} °C, condition {part.report.condition}.
        </p>
      )}
      {s.decisions.filter((d) => d.partId === part.id).map((d, i) => (
        <DecisionCard key={i} d={d} />
      ))}
    </div>
  );
}

function Approval({ s, part }: { s: EngineState; part: Part }) {
  const req = s.request!;
  const org = engine.org(part.supplierOrgId);
  const left = (part.senderDeadline - s.now) / 1000;
  return (
    <>
      <p className="muted">
        <Role who="Receiver" /> Waiting for {org.name} — <b>{fmtCountdown(left)}</b> left to answer.
      </p>
      <div className="sender-box">
        <div className="sb-head">
          Incoming request <Role who="Sender" name={org.name} />
        </div>
        <p>
          <b>{engine.receiver.name}</b> needs <b>{itemsText(part)}</b> — <span className={req.urgency === 'critical' ? 'crit-t' : ''}>{req.urgency}</span>.
        </p>
        <div className="btn-row">
          <button className="btn good" onClick={() => engine.approve(part.id)}>
            Approve
          </button>
          <button className="btn bad" onClick={() => engine.decline(part.id)}>
            Decline
          </button>
        </div>
      </div>
    </>
  );
}

function Dispatch({ part }: { part: Part }) {
  const drivers = engine.freeDrivers(part.supplierOrgId);
  const [pick, setPick] = useState(drivers[0]?.id ?? '');
  return (
    <div className="sender-box">
      <div className="sb-head">
        Assign a driver <Role who="Sender" name={engine.org(part.supplierOrgId).name} />
      </div>
      {drivers.length === 0 ? (
        <p className="banner warn">No free drivers at this hospital.</p>
      ) : (
        <div className="radio-list">
          {drivers.map((d) => (
            <label key={d.id} className={pick === d.id ? 'on' : ''}>
              <input type="radio" checked={pick === d.id} onChange={() => setPick(d.id)} />
              <b>{d.name}</b> <span className="muted">{d.phone}</span>
            </label>
          ))}
        </div>
      )}
      <button className="btn primary" disabled={!pick} onClick={() => engine.dispatch(part.id, pick)}>
        Dispatch
      </button>
    </div>
  );
}

function Tracking({ s, part }: { s: EngineState; part: Part }) {
  const d = engine.deliveryOf(part);
  if (!d) return null;
  const pct = Math.round((d.travelledM / d.lengthM) * 100);
  const etaS = (d.eta - s.now) / 1000;
  const status =
    d.status === 'loading'
      ? d.kind === 'handoff'
        ? 'Helper driver getting ready'
        : 'Packing units in a cold box'
      : d.status === 'handover'
        ? 'Moving units from the broken vehicle'
        : d.speedFactor < 1
          ? 'Moving slowly — heavy traffic'
          : d.kind === 'handoff' && !d.handoffDone
            ? 'Driving to the broken vehicle'
            : 'Out for delivery';
  return (
    <>
      <div className="eta compact">
        <div>
          <span>Arrives in</span>
          <b>{minutes(etaS)} min</b>
        </div>
        <div>
          <span>Expected at</span>
          <b>{fmtTime(d.eta)}</b>
        </div>
      </div>
      <p className="status-line">● {status}</p>
      <div className="progress">
        <div style={{ width: `${pct}%` }} />
        <i style={{ left: '50%' }} title="Half-way: re-route rule switches from Case 1 to Case 2" />
      </div>
      <p className="hint">
        {fmtKm(d.travelledM)} of {fmtKm(d.lengthM)} ({pct}%) · <Role who="Driver" name={d.driver.name} />{' '}
        <a href={`tel:${d.driver.phone.replace(/\s/g, '')}`}>📞 {d.driver.phone}</a>
      </p>
      <div className="btn-row tight">
        <span className="hint">Simulate a problem:</span>
        <button className="btn small bad" disabled={!engine.canInject(d)} onClick={() => engine.injectBreakdown(d.id)}>
          🔧 Breakdown
        </button>
        <button className="btn small warn" disabled={!engine.canInject(d) || d.speedFactor < 1} onClick={() => engine.injectDelay(d.id)}>
          🚦 Heavy traffic
        </button>
      </div>
    </>
  );
}

function DecisionCard({ d }: { d: EngineState['decisions'][number] }) {
  return (
    <div className="decision-box">
      <h3>
        Re-route rule applied <span className="tag warn">Case {d.caseNo}</span>
      </h3>
      <p>
        Trigger: <b>{d.trigger === 'breakdown' ? 'vehicle breakdown' : 'delay over 10 min'}</b> at {fmtTime(d.at)} · {d.travelledPct}% of the trip done.
      </p>
      <div className="half-bar">
        <div style={{ width: `${d.travelledPct}%` }} />
        <i />
        <span className="l">Case 1: get fresh units</span>
        <span className="r">Case 2: keep units on the road</span>
      </div>
      <ul className="opts">
        {d.options.map((o) => (
          <li key={o.key} className={o.key === d.chosen ? 'chosen' : ''}>
            <span>
              {o.key === d.chosen ? '✔ ' : ''}
              {o.label}
            </span>
            <b>{o.etaMin != null ? `${o.etaMin} min` : '—'}</b>
          </li>
        ))}
      </ul>
      <p>{d.explanation}</p>
    </div>
  );
}

function ReportForm({ s, part }: { s: EngineState; part: Part }) {
  const d = engine.deliveryOf(part)!;
  const components = [...new Set(part.items.map((i) => engine.line(i.lineId).component))];
  const range = TRANSPORT_TEMP[components[0]];
  const [f, setF] = useState({ receivedBy: '', unitsReceived: String(part.units), bagNumbers: '', temp: String(range.typical), condition: 'good' as 'good' | 'damaged', notes: '' });
  const [tried, setTried] = useState(false);
  const temp = Number(f.temp);
  const errors: Record<string, string> = {};
  if (!f.receivedBy.trim()) errors.receivedBy = 'Who received the units?';
  if (!(Number(f.unitsReceived) >= 0)) errors.unitsReceived = 'Enter a number';
  if (!f.bagNumbers.trim()) errors.bagNumbers = 'Bag numbers are needed for traceability';
  if (f.temp === '' || Number.isNaN(temp)) errors.temp = 'Enter the temperature';
  const coldWarn = f.temp !== '' && !Number.isNaN(temp) && !components.every((c) => tempInRange(c, temp));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  function submit() {
    setTried(true);
    if (Object.keys(errors).length) return;
    engine.fileReport(part.id, {
      receivedBy: f.receivedBy,
      unitsReceived: Number(f.unitsReceived),
      bagNumbers: f.bagNumbers,
      tempOnArrival: temp,
      condition: f.condition,
      notes: f.notes,
      filedAt: s.now,
    });
  }

  const err = (k: string) => tried && errors[k] && <em className="err">{errors[k]}</em>;
  return (
    <div className="report">
      <p className="banner">
        Delivery report — required. <Role who="Receiver" />
      </p>
      <div className="row2">
        <label className="field">
          <span>Received by</span>
          <input value={f.receivedBy} onChange={set('receivedBy')} placeholder="Name and role" />
          {err('receivedBy')}
        </label>
        <label className="field">
          <span>Units received</span>
          <input type="number" min={0} value={f.unitsReceived} onChange={set('unitsReceived')} />
          {err('unitsReceived')}
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>Temperature on arrival (°C)</span>
          <input type="number" step="0.1" value={f.temp} onChange={set('temp')} />
          {err('temp')}
          {coldWarn && <em className="err">Outside the safe range — this will be recorded as a cold-chain breach</em>}
        </label>
        <label className="field">
          <span>Bag numbers</span>
          <input value={f.bagNumbers} onChange={set('bagNumbers')} placeholder={d.lotIds.slice(0, 3).map((id) => `JP-${id.replace('lot-', '')}`).join(', ')} />
          {err('bagNumbers')}
        </label>
      </div>
      <div className="field">
        <span>Condition</span>
        <div className="choice grid2">
          <button className={f.condition === 'good' ? 'on' : ''} onClick={() => setF({ ...f, condition: 'good' })}>
            Good
          </button>
          <button className={f.condition === 'damaged' ? 'on crit' : 'crit'} onClick={() => setF({ ...f, condition: 'damaged' })}>
            Damaged / leaking
          </button>
        </div>
      </div>
      <button className="btn primary" onClick={submit}>
        File report
      </button>
    </div>
  );
}

function Closed({ s }: { s: EngineState }) {
  const req = s.request!;
  const done = req.parts.filter((p) => p.status === 'reported');
  const km = s.deliveries.reduce((a, d) => a + d.travelledM, 0);

  return (
    <>
      <div className="card success">
        <h2>✔ Request closed</h2>
        <div className="stats">
          <div>
            <b>{minutes(((req.closedAt ?? s.now) - req.createdAt) / 1000)} min</b>
            <span>request to close</span>
          </div>
          <div>
            <b>{done.length}</b>
            <span>hospital(s) supplied</span>
          </div>
          <div>
            <b>{fmtKm(km)}</b>
            <span>driven</span>
          </div>
        </div>
        <ul className="mini-list">
          {req.lines.map((l) => {
            const got = engine.committed(l.id);
            return (
              <li key={l.id}>
                <span>{describeLine(l)}</span>
                <span className={got >= l.units ? 'ok-t' : 'warn-t'}>{got >= l.units ? '✓ all received' : `${got} received · ${l.units - got} short`}</span>
              </li>
            );
          })}
        </ul>
        <div className="btn-row">
          <DownloadPdf />
          <button className="btn primary" onClick={() => engine.newRequest()}>
            Start a new request
          </button>
        </div>
      </div>
      {done.map((p) => (
        <PartCard key={p.id} s={s} part={p} />
      ))}
    </>
  );
}

type PdfModule = typeof import('./recordPdf');

/**
 * PDF record of the request. The PDF code is loaded as soon as this button appears, so the
 * click itself builds and downloads synchronously — browsers block downloads that start after
 * an await, because they no longer count as part of the user's click.
 */
function DownloadPdf() {
  const [mod, setMod] = useState<PdfModule | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    import('./recordPdf')
      .then((m) => alive && setMod(m))
      .catch(() => alive && setError('Could not load the PDF tool — reload the page and try again.'));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <button
        className="btn"
        disabled={!mod}
        onClick={() => {
          try {
            mod!.downloadRecordPdf(engine);
            setError('');
          } catch {
            setError('Could not create the PDF.');
          }
        }}
      >
        {mod ? '⬇ Download record (PDF)' : 'Preparing PDF…'}
      </button>
      {error && <em className="err">{error}</em>}
    </>
  );
}

// ---------- timeline ----------

function Timeline({ s }: { s: EngineState }) {
  return (
    <div className="timeline card">
      <h3>What happened (timeline)</h3>
      {s.timeline.length === 0 && <p className="hint">Events will appear here as the request moves.</p>}
      <ul>
        {[...s.timeline].reverse().map((e) => (
          <li key={e.id} className={`tl ${e.tone ?? ''}`}>
            <time>{fmtClock(e.at)}</time>
            <Role who={e.actor} />
            <span>{e.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
