import { Fragment, useState } from 'react';
import { BLOOD_GROUPS, COMPONENTS, COMPONENT_CODES, type ComponentCode } from '../core/blood';
import { engine, type EngineState } from '../core/engine';
import { haversine } from '../core/geo';
import { fmtExpiry } from './format';

const H72 = 72 * 3600_000;

/** Dashboard summary + inventory per hospital + admin verification. */
export function Network({ s }: { s: EngineState }) {
  const [component, setComponent] = useState<ComponentCode | 'all'>('PRBC');
  const [open, setOpen] = useState<string | null>(null);
  const receiver = engine.receiver;
  const avail = s.lots.filter((l) => l.status === 'available' && l.expiresAt > s.now && (component === 'all' || l.component === component));
  const byGroup = (g: string) => avail.filter((l) => l.group === g).reduce((a, l) => a + l.units, 0);
  const expiring = avail.filter((l) => l.expiresAt - s.now < H72).reduce((a, l) => a + l.units, 0);
  const verified = s.orgs.filter((o) => o.verified).length;

  const rows = [...s.orgs].sort((a, b) => haversine(a.location, receiver.location) - haversine(b.location, receiver.location));

  return (
    <div className="page">
      <div className="toolbar">
        <h2>Hospitals &amp; stock in the network</h2>
        <div className="choice inline">
          {(['all', ...COMPONENT_CODES] as const).map((c) => (
            <button key={c} className={component === c ? 'on' : ''} onClick={() => setComponent(c)}>
              {c === 'all' ? 'All' : COMPONENTS[c].short}
            </button>
          ))}
        </div>
      </div>

      <div className="tiles">
        {BLOOD_GROUPS.map((g) => (
          <div key={g} className="tile">
            <span>{g}</span>
            <b>{byGroup(g)}</b>
            <small>units</small>
          </div>
        ))}
        <div className="tile warn">
          <span>Expiring in 72 h</span>
          <b>{expiring}</b>
          <small>units — move or use first</small>
        </div>
        <div className="tile">
          <span>Verified</span>
          <b>
            {verified}/{s.orgs.length}
          </b>
          <small>organisations</small>
        </div>
      </div>

      <div className="table-wrap">
        <table className="net">
          <thead>
            <tr>
              <th>Hospital / blood bank</th>
              <th>Area</th>
              <th>From {receiver.area}</th>
              <th>Units available</th>
              <th>Expiring 72 h</th>
              <th>Drivers</th>
              <th>Status (admin)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const lots = avail.filter((l) => l.orgId === o.id);
              const units = lots.reduce((a, l) => a + l.units, 0);
              const exp = lots.filter((l) => l.expiresAt - s.now < H72).reduce((a, l) => a + l.units, 0);
              return (
                <Fragment key={o.id}>
                  <tr className="click" onClick={() => setOpen(open === o.id ? null : o.id)}>
                    <td>
                      <b>{o.name}</b> <span className="muted">{o.type === 'blood_bank' ? 'Blood bank' : 'Hospital'}</span>
                    </td>
                    <td>{o.area}</td>
                    <td>{(haversine(o.location, receiver.location) / 1000).toFixed(1)} km</td>
                    <td>{units}</td>
                    <td className={exp ? 'warn-t' : ''}>{exp}</td>
                    <td>{o.drivers.length}</td>
                    <td>
                      {o.verified ? (
                        <span className="verified">✔ Verified</span>
                      ) : (
                        <button
                          className="btn small"
                          onClick={(e) => {
                            e.stopPropagation();
                            engine.verifyOrg(o.id);
                          }}
                        >
                          Verify licence
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === o.id && (
                    <tr className="sub">
                      <td colSpan={7}>
                        {lots.length === 0 ? (
                          <span className="muted">No available stock for this filter.</span>
                        ) : (
                          <div className="lot-chips">
                            {lots
                              .sort((a, b) => a.expiresAt - b.expiresAt)
                              .map((l) => (
                                <span key={l.id} className={l.expiresAt - s.now < H72 ? 'warn' : ''}>
                                  {l.group} {COMPONENTS[l.component].short} × {l.units} · expires in {fmtExpiry(l.expiresAt, s.now)}
                                </span>
                              ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Click a row to see its stock lots. All hospitals, people and stock are fictional.</p>
    </div>
  );
}
