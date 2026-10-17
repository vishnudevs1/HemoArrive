import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPONENTS, COMPONENT_CODES } from '../core/blood';
import { JAIPUR_CENTER } from '../core/city';
import { CONDITIONS, conditionOf } from '../core/conditions';
import { engine, type EngineState } from '../core/engine';
import {
  byCondition,
  byLocality,
  byZone,
  filterRequests,
  reportCsv,
  suggestions,
  suppress,
  SUPPRESS_BELOW,
  unmetByGroup,
  warnings,
  weekly,
  type AreaRow,
  type Filters,
  type Suggestion,
} from '../core/planning';
import { downloadBlob } from './download';
import { addBaseTiles } from './tiles';

/** Sequential single-hue ramp for "share of requests unmet" (light = few, dark = many). */
const RAMP = [
  { at: 0, color: '#cde2fb', label: '0%' },
  { at: 0.05, color: '#86b6ef', label: '5%' },
  { at: 0.1, color: '#3987e5', label: '10%' },
  { at: 0.2, color: '#1c5cab', label: '20%' },
  { at: 0.3, color: '#0d366b', label: '30%+' },
];
const rampColor = (x: number) => [...RAMP].reverse().find((r) => x >= r.at)!.color;

const SUGGESTION_ICON: Record<Suggestion['kind'], string> = { storage: '🏥', camp: '🩸', apheresis: '🧪', daycare: '🛏' };

export function Planning({ s }: { s: EngineState }) {
  const [f, setF] = useState<Filters>({ days: 90, condition: 'all', component: 'all' });
  const hv = engine.historyVersion;
  const day = Math.floor(s.now / (24 * 3600_000));

  const data = useMemo(() => {
    const rs = filterRequests(s.history.requests, f, s.now);
    const done = rs.filter((r) => r.outcome !== 'cancelled');
    const fulfilled = done.filter((r) => r.outcome === 'fulfilled');
    const mins = fulfilled.map((r) => r.minutesToDelivery!).sort((a, b) => a - b);
    return {
      rs,
      total: rs.length,
      units: rs.reduce((a, r) => a + r.units, 0),
      fulfilledPct: done.length ? fulfilled.length / done.length : 0,
      unmet: done.length - fulfilled.length,
      medianMin: mins.length ? mins[Math.floor(mins.length / 2)] : null,
      zones: byZone(rs, s.orgs),
      localities: byLocality(rs, s.orgs),
      conditions: byCondition(rs),
      weeks: weekly(rs, s.now),
      groups: unmetByGroup(rs),
      suggestions: suggestions(rs, s.orgs),
      // warnings always look at all conditions, last 5 weeks
      warnings: warnings(s.history.requests, s.orgs, s.now),
    };
  }, [hv, day, f.days, f.condition, f.component]);

  function download() {
    downloadBlob(new Blob([reportCsv(data.rs, s.orgs, f)], { type: 'text/csv' }), `hemoarrive-district-report-${f.days}d.csv`);
  }

  const maxCond = Math.max(1, ...data.conditions.map((c) => c.requests));
  const maxWeek = Math.max(1, ...data.weeks.map((w) => w.requests));
  const maxGroup = Math.max(1, ...data.groups.map((g) => g.units));

  return (
    <div className="page wide">
      <div className="toolbar">
        <div>
          <h2>Data for planning</h2>
          <p className="hint">
            Where blood is needed, for which conditions, and where requests go unmet — for health officials planning storage centres, donation camps, apheresis machines
            and thalassaemia day-care. Aggregated only: no patient data, and counts under {SUPPRESS_BELOW} are shown as “&lt;{SUPPRESS_BELOW}”.
          </p>
        </div>
      </div>

      <div className="filters">
        <label className="field inline">
          <span>Period</span>
          <select value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })}>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <label className="field inline">
          <span>Condition</span>
          <select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value as Filters['condition'] })}>
            <option value="all">All conditions</option>
            {CONDITIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Component</span>
          <select value={f.component} onChange={(e) => setF({ ...f, component: e.target.value as Filters['component'] })}>
            <option value="all">All components</option>
            {COMPONENT_CODES.map((c) => (
              <option key={c} value={c}>
                {COMPONENTS[c].label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={download}>
          ⬇ Download area report (CSV)
        </button>
      </div>

      {data.warnings.length > 0 && (
        <div className="warnings">
          {data.warnings.slice(0, 3).map((w) => (
            <div key={`${w.zone}-${w.condition}`} className="warning-card">
              <b>
                ⚠ Early warning: {conditionOf(w.condition).label} in the {w.zone} zone
              </b>
              <span>
                {w.last7} requests in the last 7 days — {w.ratio.toFixed(1)}× the usual {w.weeklyAvg.toFixed(1)} a week. Alert sent to the district health officer and
                SBTC (simulated).
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="tiles">
        <div className="tile">
          <span>Requests</span>
          <b>{data.total}</b>
          <small>{data.units} units</small>
        </div>
        <div className="tile">
          <span>Fulfilled</span>
          <b>{Math.round(data.fulfilledPct * 100)}%</b>
          <small>of non-cancelled requests</small>
        </div>
        <div className="tile warn">
          <span>Unmet</span>
          <b>{suppress(data.unmet)}</b>
          <small>no usable blood found in time</small>
        </div>
        <div className="tile">
          <span>Median time to blood</span>
          <b>{data.medianMin != null ? `${Math.round(data.medianMin)} min` : '—'}</b>
          <small>request → arrival</small>
        </div>
      </div>

      <div className="plan-grid">
        <div className="card">
          <h3>Where requests go unmet</h3>
          <AreaMap rows={data.localities} />
          <div className="ramp-legend">
            <span>Share of requests unmet:</span>
            {RAMP.map((r) => (
              <span key={r.at}>
                <i style={{ background: r.color }} /> {r.label}
              </span>
            ))}
            <span className="muted">· circle size = number of requests</span>
          </div>
        </div>

        <div className="card">
          <h3>By zone</h3>
          <div className="table-wrap">
            <table className="net">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Requests</th>
                  <th>Unmet</th>
                  <th>Unmet %</th>
                  <th>Median time</th>
                  <th>Median distance</th>
                </tr>
              </thead>
              <tbody>
                {data.zones.map((z) => (
                  <tr key={z.zone}>
                    <td>
                      <b>{z.zone}</b>
                    </td>
                    <td>{suppress(z.requests)}</td>
                    <td>{suppress(z.unmet)}</td>
                    <td>{z.requests >= SUPPRESS_BELOW ? `${Math.round(z.unmetRate * 100)}%` : '—'}</td>
                    <td>{z.medianMinutes != null ? `${Math.round(z.medianMinutes)} min` : '—'}</td>
                    <td>{z.medianKm != null ? `${z.medianKm.toFixed(1)} km` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="sub-h">Unmet units by blood group</h3>
          {data.groups.length === 0 ? (
            <p className="hint">None in this period.</p>
          ) : (
            data.groups.map((g) => (
              <div key={g.group} className="hbar" title={`${g.group}: ${g.units} unmet unit(s)`}>
                <span className="hb-label">{g.group}</span>
                <div className="hb-track">
                  <div style={{ width: `${(g.units / maxGroup) * 100}%` }} />
                </div>
                <span className="hb-val">{suppress(g.units)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="plan-grid">
        <div className="card">
          <h3>Which conditions need blood</h3>
          {data.conditions.map((c) => (
            <div key={c.condition.code} className="hbar" title={`${c.condition.label} (ICD-10 ${c.condition.icd}): ${c.requests} requests, ${c.unmet} unmet`}>
              <span className="hb-label">
                {c.condition.label}
                <small> {c.condition.icd}</small>
              </span>
              <div className="hb-track">
                <div style={{ width: `${(c.requests / maxCond) * 100}%` }} />
              </div>
              <span className="hb-val">
                {suppress(c.requests)}
                {c.requests > 0 && <small> · {suppress(c.unmet)} unmet</small>}
              </span>
            </div>
          ))}
        </div>

        <div className="card">
          <h3>Requests per week (last 13 weeks)</h3>
          <div className="legend-inline small">
            <span>
              <i className="sw" style={{ background: 'var(--s-smart)' }} /> Met
            </span>
            <span>
              <i className="sw" style={{ background: 'var(--s-nearest)' }} /> Unmet
            </span>
          </div>
          <div className="columns">
            {data.weeks.map((w) => {
              const met = w.requests - w.unmet;
              const label = new Date(w.end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
              return (
                <div key={w.end} className="col" title={`Week to ${label}: ${w.requests} requests (${met} met, ${w.unmet} unmet)`}>
                  <div className="col-stack" style={{ height: `${(w.requests / maxWeek) * 100}%` }}>
                    <div className="seg unmet" style={{ flexGrow: w.unmet }} />
                    <div className="seg met" style={{ flexGrow: met }} />
                  </div>
                  <span className="col-x">{label}</span>
                </div>
              );
            })}
          </div>
          <p className="hint">Hover a bar for exact numbers. Dengue rises from August and peaks in October.</p>
        </div>
      </div>

      <div className="card">
        <h3>What the data suggests</h3>
        <p className="hint">Rule-based suggestions with the evidence behind them, for the health department and SBTC to consider. HemoArrive does not make these decisions.</p>
        {data.suggestions.length === 0 ? (
          <p className="hint">No suggestions for this filter.</p>
        ) : (
          <div className="suggestions">
            {data.suggestions.map((sg, i) => (
              <div key={i} className="suggestion">
                <span className="sg-icon">{SUGGESTION_ICON[sg.kind]}</span>
                <div>
                  <b>{sg.title}</b>
                  <div className="sg-where">{sg.where}</div>
                  <p>{sg.evidence}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="hint">Simulated data: 90 days of synthetic requests across 30 fictional Jaipur hospitals, plus any requests you run in “Live request”.</p>
    </div>
  );
}

function AreaMap({ rows }: { rows: (AreaRow & { org: { location: [number, number]; name: string } })[] }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = L.map(el.current!).setView(JAIPUR_CENTER, 10);
    addBaseTiles(map);
    layer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    const max = Math.max(1, ...rows.map((r) => r.requests));
    for (const r of rows) {
      L.circleMarker(r.org.location, {
        radius: 6 + 18 * Math.sqrt(r.requests / max),
        color: '#ffffff',
        weight: 2,
        fillColor: rampColor(r.unmetRate),
        fillOpacity: 0.9,
      })
        .bindTooltip(
          `<b>${r.key}</b> (${r.zone})<br>${suppress(r.requests)} requests · ${suppress(r.unmet)} unmet (${r.requests >= SUPPRESS_BELOW ? Math.round(r.unmetRate * 100) + '%' : '—'})` +
            (r.medianMinutes != null ? `<br>median ${Math.round(r.medianMinutes)} min to blood` : ''),
        )
        .addTo(g);
    }
  }, [rows]);

  return <div ref={el} className="plan-map" />;
}
