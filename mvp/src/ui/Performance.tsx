import { useMemo, useState } from 'react';
import { engine, type EngineState } from '../core/engine';
import { DAY, PROBLEM_ORGS, type Obs } from '../core/history';
import { BANDS, MIN_EVENTS, scoreAll, type Area, type Band, type OrgScore } from '../core/performance';
import { fmtTime } from './format';

const BAND_ICON: Record<Band, string> = { gold: '🥇', silver: '🥈', watch: '⚠', review: '⛔' };
const AREAS: Area[] = ['Responsiveness', 'Inventory accuracy', 'Delivery', 'Cold chain & safety', 'Stewardship'];

/** Small badge used on option cards and in tables. Text label always present, colour is secondary. */
export function BandBadge({ score, showScore = true }: { score?: OrgScore; showScore?: boolean }) {
  if (!score) return null;
  if (!score.band) return <span className="band band-none" title={`Fewer than ${MIN_EVENTS} events — no score yet`}>New</span>;
  return (
    <span className={`band band-${score.band}`} title={`Hospital Performance Score: ${score.score}/100 (${BANDS[score.band].label})`}>
      {BAND_ICON[score.band]} {BANDS[score.band].label}
      {showScore ? ` ${score.score}` : ''}
    </span>
  );
}

export function Performance({ s }: { s: EngineState }) {
  const [filter, setFilter] = useState<'all' | 'hospital' | 'blood_bank'>('all');
  const [selected, setSelected] = useState<string>('org-jamdoli');
  const hv = engine.historyVersion;
  const hour = Math.floor(s.now / 3600_000);

  const scores = engine.scores();
  // scores 30 days ago, for the trend arrow
  const before = useMemo(() => scoreAll(s.orgs.map((o) => o.id), s.history.obs, s.now - 30 * DAY), [hv, hour]);

  const rows = s.orgs
    .filter((o) => o.verified && (filter === 'all' || o.type === filter))
    .map((o) => ({ o, sc: scores.get(o.id)!, prev: before.get(o.id)! }))
    .sort((a, b) => (b.sc.score ?? -1) - (a.sc.score ?? -1));
  const counts = (Object.keys(BANDS) as Band[]).map((b) => ({ b, n: rows.filter((r) => r.sc.band === b).length }));
  const unscored = rows.filter((r) => !r.sc.band).length;
  const sel = scores.get(selected);
  const selOrg = s.orgs.find((o) => o.id === selected);

  return (
    <div className="page wide">
      <div className="toolbar">
        <div>
          <h2>Hospital Performance Score</h2>
          <p className="hint">
            Credit points out of 100, from what HemoArrive observed in the last 90 days. No score until a hospital has {MIN_EVENTS} events. An honest “no stock” costs
            nothing; claiming stock you don’t have does. Based on Kayakalp and NABH blood bank quality indicators.
          </p>
        </div>
        <div className="choice inline">
          {(['all', 'hospital', 'blood_bank'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'hospital' ? 'Hospitals' : 'Blood banks'}
            </button>
          ))}
        </div>
      </div>

      <div className="tiles">
        {counts.map(({ b, n }) => (
          <div key={b} className={`tile band-tile band-${b}`}>
            <span>
              {BAND_ICON[b]} {BANDS[b].label}
            </span>
            <b>{n}</b>
            <small>
              {b === 'review' ? 'below 50' : `${BANDS[b].min}+`} · {BANDS[b].meaning}
            </small>
          </div>
        ))}
        <div className="tile">
          <span>No score yet</span>
          <b>{unscored}</b>
          <small>fewer than {MIN_EVENTS} events</small>
        </div>
      </div>

      <div className="perf-grid">
        <div className="card flush">
          <table className="net leader">
            <thead>
              <tr>
                <th>#</th>
                <th>Hospital / blood bank</th>
                <th>Score</th>
                <th title="Change compared with 30 days ago">30-day change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ o, sc, prev }, i) => {
                const delta = sc.score != null && prev.score != null ? sc.score - prev.score : null;
                return (
                  <tr key={o.id} className={`click ${selected === o.id ? 'sel' : ''}`} onClick={() => setSelected(o.id)}>
                    <td className="muted">{sc.score != null ? i + 1 : '–'}</td>
                    <td>
                      <b>{o.name}</b>
                      <div className="muted">
                        {o.area} · {o.type === 'blood_bank' ? 'Blood bank' : 'Hospital'}
                        {sc.redFlags.length > 0 && <span className="flag"> · 🚩 {sc.redFlags.length} red flag(s)</span>}
                      </div>
                    </td>
                    <td className="score-cell">
                      {sc.score != null ? (
                        <>
                          <div className="score-bar">
                            <div className={`band-fill band-${sc.band}`} style={{ width: `${sc.score}%` }} />
                          </div>
                          <BandBadge score={sc} />
                        </>
                      ) : (
                        <BandBadge score={sc} />
                      )}
                    </td>
                    <td className={delta == null ? 'muted' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'muted'}>
                      {delta == null ? '–' : delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : '= 0'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sel && selOrg && <Scorecard s={s} sc={sel} orgName={selOrg.name} area={selOrg.area} />}
      </div>
    </div>
  );
}

function Scorecard({ s, sc, orgName, area }: { s: EngineState; sc: OrgScore; orgName: string; area: string }) {
  const weakest = sc.metrics.filter((m) => m.points != null).sort((a, b) => a.points! / a.max - b.points! / b.max)[0];
  const events = s.history.obs
    .filter((o) => o.orgId === sc.orgId && o.at > s.now - 90 * DAY && isNotable(o))
    .sort((a, b) => b.at - a.at)
    .slice(0, 10);

  return (
    <div className="card scorecard">
      <div className="sc-head">
        <div>
          <h3>{orgName}</h3>
          <div className="muted">
            {area} · {sc.events} events in 90 days
          </div>
        </div>
        <div className="sc-score">
          {sc.score != null ? (
            <>
              <b>{sc.score}</b>
              <span>/100</span>
              <BandBadge score={sc} showScore={false} />
            </>
          ) : (
            <span className="muted">No score yet ({sc.events}/{MIN_EVENTS} events)</span>
          )}
        </div>
      </div>

      {PROBLEM_ORGS[sc.orgId] && <p className="banner warn">Demo note: this simulated hospital was set up to {PROBLEM_ORGS[sc.orgId]}.</p>}

      {sc.redFlags.length > 0 && (
        <div className="redflags">
          <b>🚩 Red flags — reviewed by a person, whatever the score</b>
          <ul>
            {sc.redFlags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {sc.band === 'review' && <p className="banner warn">Below 50: this hospital would enter the human review queue (notice, 15 days to respond, then SBTC review).</p>}

      {AREAS.map((a) => {
        const ms = sc.metrics.filter((m) => m.area === a);
        const scored = ms.filter((m) => m.points != null);
        const got = scored.reduce((x, m) => x + m.points!, 0);
        const max = ms.reduce((x, m) => x + m.max, 0);
        return (
          <div key={a} className="area">
            <div className="area-head">
              <b>{a}</b>
              <span>{scored.length ? `${got.toFixed(1)} / ${max}` : 'no data'}</span>
            </div>
            {ms.map((m) => (
              <div key={m.key} className="metric-row" title={m.tip}>
                <span className="m-name">{m.label}</span>
                <div className="m-track">{m.points != null && <div style={{ width: `${(m.points / m.max) * 100}%` }} />}</div>
                <span className="m-pts">{m.points != null ? `${m.points}/${m.max}` : '—'}</span>
                <span className="m-val muted">{m.value}</span>
              </div>
            ))}
          </div>
        );
      })}
      <p className="hint">Metrics with no data are left out and the score is rescaled, so a hospital isn’t judged on activity it never had.</p>

      {weakest && weakest.points! < weakest.max * 0.8 && (
        <div className="insight">
          <b>How to improve:</b> {weakest.label} — {weakest.tip}
        </div>
      )}

      <div className="area">
        <div className="area-head">
          <b>As a receiving hospital</b>
          <span>{sc.receiver.score != null ? `${sc.receiver.score}/100` : 'no data'}</span>
        </div>
        <div className="recv">
          <span>Report filed within 1 h: {sc.receiver.reportOnTime != null ? `${Math.round(sc.receiver.reportOnTime * 100)}%` : '—'}</span>
          <span>Cancelled requests: {sc.receiver.cancelRate != null ? `${Math.round(sc.receiver.cancelRate * 100)}%` : '—'}</span>
          <span>“Critical” that proved routine: {sc.receiver.overstated != null ? `${Math.round(sc.receiver.overstated * 100)}%` : '—'}</span>
        </div>
      </div>

      <div className="area">
        <div className="area-head">
          <b>Events that cost points</b>
          <span className="muted">appeal any event — it’s left out until reviewed</span>
        </div>
        {events.length === 0 ? (
          <p className="hint">Nothing in the last 90 days.</p>
        ) : (
          <ul className="events">
            {events.map((e) => (
              <li key={e.id} className={e.appealed ? 'appealed' : ''}>
                <time>
                  {new Date(e.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })} {fmtTime(e.at)}
                </time>
                <span>
                  {describe(e)}
                  {e.appealed && <em> · under appeal</em>}
                </span>
                <button className="btn small" onClick={() => engine.toggleAppeal(e.id)}>
                  {e.appealed ? 'Withdraw appeal' : 'Appeal'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function isNotable(o: Obs): boolean {
  switch (o.k) {
    case 'broadcast':
      return !o.answered;
    case 'selected':
      return o.timedOut;
    case 'approval':
      return o.conflict;
    case 'delivery':
      return (o.lateMin > 10 && !o.excused) || o.incident === 'system';
    case 'report_in':
      return !o.tempOk || !o.bagsOk || o.short;
    default:
      return false;
  }
}

function describe(o: Obs): string {
  if (o.note) return o.note;
  switch (o.k) {
    case 'broadcast':
      return 'Did not answer a request it had stock for';
    case 'selected':
      return 'Did not answer within 5 minutes';
    case 'approval':
      return 'Approved units that were not actually in stock';
    case 'delivery':
      return o.incident === 'system' ? 'Incident detected by the system, not reported by the driver' : `Arrived ${Math.round(o.lateMin)} min late`;
    case 'report_in':
      return [!o.tempOk && 'temperature out of range on arrival', o.short && 'fewer units than offered', !o.bagsOk && 'bag numbers missing'].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase());
    default:
      return o.k;
  }
}
