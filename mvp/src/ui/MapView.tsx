import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { JAIPUR_CENTER } from '../core/city';
import type { EngineState } from '../core/engine';
import { pointAlong } from '../core/geo';
import { addBaseTiles } from './tiles';

type Layer = L.Layer & { __touched?: boolean };

/** Live map: hospitals, search radius, routes and moving vehicles. Plain Leaflet, updated in place. */
export function MapView({ s }: { s: EngineState }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef(new Map<string, Layer>());
  const fitKey = useRef('');

  useEffect(() => {
    const map = L.map(el.current!, { zoomControl: true, attributionControl: true }).setView(JAIPUR_CENTER, 11);
    addBaseTiles(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layers.current.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const store = layers.current;
    store.forEach((l) => (l.__touched = false));

    function upsert<T extends Layer>(key: string, create: () => T, update?: (l: T) => void): T {
      let l = store.get(key) as T | undefined;
      if (!l) {
        l = create();
        l.addTo(map!);
        store.set(key, l);
      } else update?.(l);
      l.__touched = true;
      return l;
    }

    const req = s.request;
    const receiverId = s.receiverOrgId;
    const offerOrgs = new Set(req?.offers.filter((o) => o.status !== 'declined' && o.status !== 'expired').map((o) => o.supplierOrgId));
    const notified = new Set(req?.broadcasts.map((b) => b.orgId));
    // hospitals sending (or planned to send) units for this request
    const senders = new Set([
      ...(req?.parts.filter((p) => !['declined', 'timed_out', 'conflict', 'cancelled'].includes(p.status)).map((p) => p.supplierOrgId) ?? []),
      ...(req?.draft.map((p) => req.offers.find((o) => o.id === p.offerId)!.supplierOrgId) ?? []),
    ]);

    // search radius
    if (req && ['searching', 'planning', 'no_match'].includes(req.status)) {
      const recv = s.orgs.find((o) => o.id === receiverId)!;
      upsert(
        'radius',
        () => L.circle(recv.location, { radius: req.radiusKm * 1000, color: '#c62828', weight: 1, dashArray: '6 6', fillOpacity: 0.04 }),
        (c) => (c as unknown as L.Circle).setRadius(req.radiusKm * 1000).setLatLng(recv.location),
      );
    }

    // hospitals
    for (const o of s.orgs) {
      let style: L.CircleMarkerOptions = { radius: 6, color: '#7a7a7a', fillColor: '#bdbdbd', fillOpacity: 0.9, weight: 1 };
      let label = '';
      if (!o.verified) style = { radius: 6, color: '#9e9e9e', fillColor: '#fff', fillOpacity: 1, weight: 2, dashArray: '2 2' };
      if (notified.has(o.id)) style = { ...style, color: '#5c6bc0', fillColor: '#c5cae9' };
      if (offerOrgs.has(o.id)) style = { radius: 8, color: '#1b5e20', fillColor: '#43a047', fillOpacity: 0.95, weight: 2 };
      if (senders.has(o.id)) {
        style = { radius: 10, color: '#e65100', fillColor: '#ff9800', fillOpacity: 1, weight: 3 };
        label = 'Sender';
      }
      if (o.id === receiverId) {
        style = { radius: 11, color: '#0d47a1', fillColor: '#1e88e5', fillOpacity: 1, weight: 3 };
        label = 'You (receiver)';
      }
      const tip = `<b>${o.name}</b><br>${o.area} · ${o.type === 'blood_bank' ? 'Blood bank' : 'Hospital'}${o.verified ? '' : '<br><i>Pending verification</i>'}`;
      const m = upsert(`org:${o.id}`, () => L.circleMarker(o.location, style).bindTooltip(tip)) as unknown as L.CircleMarker;
      m.setStyle(style);
      m.setRadius(style.radius!);
      const key = `label:${o.id}`;
      if (label) {
        upsert(key, () => L.tooltip({ permanent: true, direction: 'top', offset: [0, -10], className: 'map-label' }).setLatLng(o.location).setContent(label), (t) =>
          (t as unknown as L.Tooltip).setContent(label),
        );
      }
    }

    // routes and vehicles
    for (const d of s.deliveries) {
      const { pos, done, rest } = pointAlong(d.route, d.travelledM);
      const cancelled = d.status === 'cancelled' || d.status === 'handed_off';
      upsert(`rest:${d.id}`, () => L.polyline(rest, {}), (p) => (p as unknown as L.Polyline).setLatLngs(rest));
      (store.get(`rest:${d.id}`) as unknown as L.Polyline).setStyle(
        cancelled ? { color: '#9e9e9e', weight: 3, dashArray: '4 8', opacity: 0.6 } : { color: d.kind === 'main' ? '#e65100' : '#6a1b9a', weight: 5, dashArray: '8 8', opacity: 0.9 },
      );
      upsert(`done:${d.id}`, () => L.polyline(done, { color: '#37474f', weight: 5, opacity: 0.8 }), (p) => (p as unknown as L.Polyline).setLatLngs(done));

      const broken = d.status === 'stopped' || cancelled;
      const html = `<div class="veh ${broken ? 'veh-bad' : d.kind !== 'main' ? 'veh-alt' : ''}">${broken ? '⚠' : '🚑'}</div>`;
      const icon = L.divIcon({ html, className: '', iconSize: [30, 30], iconAnchor: [15, 15] });
      upsert(
        `veh:${d.id}`,
        () => L.marker(pos, { icon, zIndexOffset: 1000 }).bindTooltip(`${d.driver.name}`, { direction: 'right', offset: [14, 0] }),
        (m) => {
          (m as unknown as L.Marker).setLatLng(pos);
          (m as unknown as L.Marker).setIcon(icon);
        },
      );
    }

    // remove stale layers
    store.forEach((l, k) => {
      if (!l.__touched) {
        map.removeLayer(l);
        store.delete(k);
      }
    });

    // auto-fit when the story moves to a new stage
    // active legs = the current delivery of each part
    const active = req ? req.parts.map((p) => s.deliveries.find((d) => d.id === p.deliveryId)).filter((d): d is NonNullable<typeof d> => !!d && d.status !== 'arrived') : [];
    const key = `${req?.id}:${req?.status === 'planning' ? 'plan' : ''}:${active.map((d) => d.id).join(',')}`;
    if (key !== fitKey.current) {
      fitKey.current = key;
      const recv = s.orgs.find((o) => o.id === receiverId)!;
      if (active.length) map.fitBounds(L.latLngBounds(active.flatMap((d) => d.route)).pad(0.25), { animate: true });
      else if (req && req.offers.length) {
        const pts = [recv.location, ...req.offers.map((o) => s.orgs.find((x) => x.id === o.supplierOrgId)!.location)];
        map.fitBounds(L.latLngBounds(pts).pad(0.2), { animate: true });
      } else if (req) {
        const dLat = req.radiusKm / 111.32;
        const dLng = dLat / Math.cos((recv.location[0] * Math.PI) / 180);
        const [lat, lng] = recv.location;
        map.fitBounds([[lat - dLat, lng - dLng], [lat + dLat, lng + dLng]], { animate: true });
      }
      else map.setView(JAIPUR_CENTER, 11);
    }
  }, [s.version]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      <div className="legend">
        <span><i className="dot" style={{ background: '#1e88e5' }} /> You</span>
        <span><i className="dot" style={{ background: '#43a047' }} /> Has stock</span>
        <span><i className="dot" style={{ background: '#ff9800' }} /> Sender</span>
        <span><i className="dot" style={{ background: '#c5cae9' }} /> Alerted</span>
        <span><i className="dot" style={{ background: '#bdbdbd' }} /> Other</span>
      </div>
    </div>
  );
}
