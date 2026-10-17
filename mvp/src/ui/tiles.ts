import L from 'leaflet';

/**
 * Base map tiles. Production: set VITE_MAPTILER_KEY (free tier). Without it we fall back to
 * openstreetmap.org tiles, which is fine for a local demo but not allowed for real app traffic.
 */
export function addBaseTiles(map: L.Map) {
  const key = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
  const tiles = key
    ? { url: `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${key}`, attribution: '&copy; MapTiler &copy; OpenStreetMap contributors' }
    : { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors' };
  L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: 18 }).addTo(map);
}
