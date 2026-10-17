import { hashString, mulberry32 } from './rng';

export type LatLng = [number, number];

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Straight-line distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function routeLength(route: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += haversine(route[i - 1], route[i]);
  return total;
}

/**
 * Fake road route between two points: a wiggly line about 15–30% longer than straight.
 * Stands in for OpenRouteService directions so the demo never depends on a live API.
 */
export function makeRoute(from: LatLng, to: LatLng, key: string): LatLng[] {
  const rng = mulberry32(hashString(key));
  const segments = 7;
  const dLat = to[0] - from[0];
  const dLng = to[1] - from[1];
  const pts: LatLng[] = [from];
  const bend = (rng() - 0.5) * 0.35;
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const curve = Math.sin(Math.PI * t) * bend;
    const jitter = (rng() - 0.5) * 0.08;
    const off = curve + jitter;
    // perpendicular offset
    pts.push([from[0] + dLat * t - dLng * off, from[1] + dLng * t + dLat * off]);
  }
  pts.push(to);
  return pts;
}

/** Position along a route after travelling `dist` metres, plus the route split at that point. */
export function pointAlong(route: LatLng[], dist: number): { pos: LatLng; done: LatLng[]; rest: LatLng[] } {
  if (dist <= 0) return { pos: route[0], done: [route[0]], rest: route.slice() };
  let acc = 0;
  for (let i = 1; i < route.length; i++) {
    const seg = haversine(route[i - 1], route[i]);
    if (acc + seg >= dist) {
      const t = seg === 0 ? 0 : (dist - acc) / seg;
      const pos: LatLng = [
        route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t,
        route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t,
      ];
      return { pos, done: [...route.slice(0, i), pos], rest: [pos, ...route.slice(i)] };
    }
    acc += seg;
  }
  const last = route[route.length - 1];
  return { pos: last, done: route.slice(), rest: [last] };
}
