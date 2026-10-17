import { useState } from 'react';
import { runTwin, summarise, TWIN_SCENARIOS, type PlannerKpi, type TwinScenario, type TwinSummary } from '../core/twin';

type Metric = { key: keyof PlannerKpi; label: string; help: string; better: 'higher' | 'lower' | 'zero'; unit?: string; digits?: number };

const METRICS: Metric[] = [
  { key: 'p1OnTime', label: 'Emergency (P1) units on time', help: 'Delivered before the doctor’s deadline', better: 'higher', unit: '%', digits: 1 },
  { key: 'fillRate', label: 'All units delivered on time', help: 'Across routine, urgent and emergency', better: 'higher', unit: '%', digits: 1 },
  { key: 'expiredInTransit', label: 'Units that arrived (almost) expired', help: 'Sent without checking life left on arrival', better: 'lower', digits: 1 },
  { key: 'oNegMisuse', label: 'O− used for non-O− patients', help: 'O− is rare — keep it for those who need it', better: 'lower', digits: 1 },
  { key: 'expired', label: 'Units expired on the shelf', help: 'Wasted stock over 3 days (mostly platelets)', better: 'lower', digits: 1 },
  { key: 'km', label: 'Kilometres driven', help: 'Transport effort', better: 'lower', unit: ' km', digits: 0 },
  { key: 'doubleAllocations', label: 'Same unit promised twice', help: 'Must always be zero', better: 'zero', digits: 0 },
  { key: 'incompatible', label: 'Wrong-group matches', help: 'Must always be zero', better: 'zero', digits: 0 },
];

/** Runs seeds one by one so the page stays responsive. */
function runAsync(seeds: number, scenario: TwinScenario, onProgress: (n: number) => void): Promise<TwinSummary> {
  return new Promise((resolve) => {
    const nearest: PlannerKpi[] = [];
    const smart: PlannerKpi[] = [];
    let requests = 0;
    let i = 1;
    const step = () => {
      const r = runTwin(i, scenario);
      nearest.push(r.nearest);
      smart.push(r.smart);
      requests += r.requests;
      onProgress(i);
      if (i++ < seeds) setTimeout(step, 0);
      else resolve({ runs: seeds, requests: requests / seeds, nearest: summarise(nearest), smart: summarise(smart) });
    };
    setTimeout(step, 0);
  });
}

export function Compare() {
  const [scenario, setScenario] = useState<TwinScenario>('normal');
  const [seeds, setSeeds] = useState(30);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<(TwinSummary & { scenario: TwinScenario }) | null>(null);
  const [table, setTable] = useState(false);

  async function go() {
    setRunning(true);
    setProgress(0);
    const r = await runAsync(seeds, scenario, setProgress);
    setResult({ ...r, scenario });
    setRunning(false);
  }

  return (
    <div className="page">
      <h2>Smart vs Nearest — simulation</h2>
      <p>
        The same 3 days of simulated stock, donations, requests and traffic are played <b>twice</b> on the 30-hospital Jaipur network:
      </p>
      <div className="two-col">
        <div className="card">
          <h3>
            <i className="sw" style={{ background: 'var(--s-nearest)' }} /> Nearest available
          </h3>
          <p>How phone calls work today: take the closest hospital that has the group, send its oldest unit. No check whether it survives the trip.</p>
        </div>
        <div className="card">
          <h3>
            <i className="sw" style={{ background: 'var(--s-smart)' }} /> HemoArrive
          </h3>
          <p>Only sends units with enough life left on arrival, uses short-dated stock first across the network, plans with a pessimistic travel time and keeps rare O− for O− patients.</p>
        </div>
      </div>

      <div className="toolbar">
        <label className="field inline">
          <span>Scenario</span>
          <select value={scenario} onChange={(e) => setScenario(e.target.value as TwinScenario)}>
            {(Object.keys(TWIN_SCENARIOS) as TwinScenario[]).map((k) => (
              <option key={k} value={k}>
                {TWIN_SCENARIOS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Runs (seeds)</span>
          <select value={seeds} onChange={(e) => setSeeds(Number(e.target.value))}>
            {[1, 10, 30].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button className="btn primary" disabled={running} onClick={go}>
          {running ? `Running ${progress}/${seeds}…` : 'Run simulation'}
        </button>
      </div>

      {result && (
        <div className="card">
          <div className="res-head">
            <div>
              <b>{TWIN_SCENARIOS[result.scenario]}</b> · {result.runs} run(s) · about {Math.round(result.requests)} requests per run
            </div>
            <div className="legend-inline">
              <span>
                <i className="sw" style={{ background: 'var(--s-nearest)' }} /> Nearest available
              </span>
              <span>
                <i className="sw" style={{ background: 'var(--s-smart)' }} /> HemoArrive
              </span>
              <button className="btn small" onClick={() => setTable(!table)}>
                {table ? 'Show bars' : 'Show table'}
              </button>
            </div>
          </div>
          {table ? <ResultTable r={result} /> : METRICS.map((m) => <MetricRow key={m.key} m={m} r={result} />)}
          <p className="hint">
            Simulated with synthetic data calibrated to published Indian figures (ABO mix, shelf lives). Values are averages{result.runs > 1 ? ' with a 95% interval (±)' : ''}. HemoArrive drives somewhat more because
            it skips units that would expire on the way and keeps O− stock for O− patients — that trade-off is shown, not hidden.
          </p>
        </div>
      )}
    </div>
  );
}

const fmt = (v: number, m: Metric) => `${v.toFixed(m.digits ?? 1)}${m.unit ?? ''}`;

function verdict(m: Metric, r: TwinSummary) {
  const n = r.nearest[m.key];
  const s = r.smart[m.key];
  if (m.better === 'zero') return s === 0 && n === 0 ? '✓ zero for both' : s === 0 ? '✓ HemoArrive zero' : '✗ not zero';
  const better = m.better === 'higher' ? s > n : s < n;
  const noise = r.runs > 1 ? Math.max(r.nearest.ci[m.key] ?? 0, r.smart.ci[m.key] ?? 0) : 0;
  if (Math.abs(s - n) <= Math.max(noise, 1e-9)) return '≈ about the same';
  return better ? '▲ HemoArrive better' : '▼ Nearest better';
}

function MetricRow({ m, r }: { m: Metric; r: TwinSummary }) {
  const n = r.nearest[m.key];
  const s = r.smart[m.key];
  const max = m.unit === '%' ? 100 : Math.max(n, s, 1);
  const multi = r.runs > 1;
  return (
    <div className="metric">
      <div className="m-label">
        <b>{m.label}</b>
        <small>{m.help}</small>
        <em>{verdict(m, r)}</em>
      </div>
      <div className="m-bars">
        {[
          { v: n, ci: r.nearest.ci[m.key], color: 'var(--s-nearest)', who: 'Nearest available' },
          { v: s, ci: r.smart.ci[m.key], color: 'var(--s-smart)', who: 'HemoArrive' },
        ].map((b) => (
          <div className="bar-row" key={b.who} title={`${b.who}: ${fmt(b.v, m)}${multi && b.ci ? ` ± ${b.ci.toFixed(m.digits ?? 1)}` : ''}`}>
            <div className="bar-track">
              <div className="bar" style={{ width: `${Math.max((b.v / max) * 100, b.v > 0 ? 1 : 0)}%`, background: b.color }} />
            </div>
            <span className="bar-val">
              {fmt(b.v, m)}
              {multi && b.ci ? <small> ±{b.ci.toFixed(m.digits ?? 1)}</small> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultTable({ r }: { r: TwinSummary }) {
  return (
    <div className="table-wrap">
      <table className="net">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Nearest available</th>
            <th>HemoArrive</th>
            <th>Better</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => (
            <tr key={m.key}>
              <td>{m.label}</td>
              <td>{fmt(r.nearest[m.key], m)}</td>
              <td>{fmt(r.smart[m.key], m)}</td>
              <td>{verdict(m, r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
