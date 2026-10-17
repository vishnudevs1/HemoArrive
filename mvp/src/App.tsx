import { useEffect, useState } from 'react';
import { engine } from './core/engine';
import { Compare } from './ui/Compare';
import { fmtClock, useEngine } from './ui/format';
import { LiveRequest } from './ui/LiveRequest';
import { Network } from './ui/Network';
import { Performance } from './ui/Performance';
import { Planning } from './ui/Planning';

const TABS = [
  { key: 'live', label: 'Live request' },
  { key: 'network', label: 'Hospitals & stock' },
  { key: 'performance', label: 'Performance' },
  { key: 'planning', label: 'Planning' },
  { key: 'compare', label: 'Smart vs Nearest' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const SPEEDS = [0, 1, 10, 30, 60];
const TICK_MS = 200;

export function App() {
  const s = useEngine();
  const [tab, setTab] = useState<Tab>('live');

  useEffect(() => {
    const t = setInterval(() => engine.tick(TICK_MS), TICK_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="drop">🩸</span>
          <div>
            <b>HemoArrive</b>
            <small>Find blood nearby. Track it until it arrives.</small>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="clock">
          <div>
            <small>Simulated time (IST)</small>
            <b>{fmtClock(s.now)}</b>
          </div>
          <div className="speed" title="How fast simulated time runs">
            {SPEEDS.map((sp) => (
              <button key={sp} className={s.speed === sp ? 'on' : ''} onClick={() => engine.setSpeed(sp)}>
                {sp === 0 ? '⏸' : `${sp}×`}
              </button>
            ))}
          </div>
          <button className="btn small ghost" onClick={() => engine.reset()} title="Restore the simulated city to its starting stock">
            Reset city
          </button>
        </div>
      </header>
      <div className="disclaimer">Demo with fictional hospitals and synthetic stock · coordination tool only · clinical decisions stay with the treating team</div>
      <main>
        {tab === 'live' && <LiveRequest s={s} />}
        {tab === 'network' && <Network s={s} />}
        {tab === 'performance' && <Performance s={s} />}
        {tab === 'planning' && <Planning s={s} />}
        {tab === 'compare' && <Compare />}
      </main>
    </div>
  );
}
