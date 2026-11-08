// The area this map covers. Shared by the browser and the server.
// The outline is approximate: Schuylkill River to the east, Cobbs Creek and
// City Line Ave to the west, down to the airport edge in the south.

export const REGION = {
  name: 'West Philadelphia',
  shortName: 'West Philly',
  center: [-75.2075, 39.9555],
  zoom: 13.4,
  maxBounds: [[-75.36, 39.86], [-75.1, 40.05]],
  campus: { name: 'Penn', coords: [-75.1932, 39.9512] }, // College Hall
  outline: [
    [-75.283, 39.977],
    [-75.256, 39.996],
    [-75.23, 40.008],
    [-75.196, 40.008],
    [-75.195, 39.995],
    [-75.1915, 39.98],
    [-75.188, 39.97],
    [-75.1835, 39.964],
    [-75.179, 39.958],
    [-75.1785, 39.95],
    [-75.1815, 39.944],
    [-75.188, 39.939],
    [-75.199, 39.938],
    [-75.206, 39.931],
    [-75.205, 39.92],
    [-75.206, 39.905],
    [-75.215, 39.89],
    [-75.235, 39.882],
    [-75.26, 39.895],
    [-75.264, 39.91],
    [-75.27, 39.93],
    [-75.278, 39.95],
    [-75.283, 39.965],
    [-75.283, 39.977],
  ],
};

// Bounding box of the outline: [[west, south], [east, north]].
export const REGION_BBOX = REGION.outline.reduce(
  ([[w, s], [e, n]], [x, y]) => [[Math.min(w, x), Math.min(s, y)], [Math.max(e, x), Math.max(n, y)]],
  [[Infinity, Infinity], [-Infinity, -Infinity]],
);

// Ray-casting point-in-polygon test.
export function inRegion(lng, lat) {
  const poly = REGION.outline;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A polygon covering everything except the region, used to fade the map outside it.
export const outsideRegionMask = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [[-77, 39], [-73.5, 39], [-73.5, 41], [-77, 41], [-77, 39]],
      [...REGION.outline].reverse(),
    ],
  },
};
