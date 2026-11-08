// Custom light map style for OpenStreetMap data (OpenMapTiles schema, served by OpenFreeMap).
// Goal: a fresh, colorful base in the Sanctuary's greens and golds, with clear parks, water and main roads.
import { outsideRegionMask } from './region.js';

const C = {
  land: '#f4f6ec',
  landShade: '#e9eddb',
  park: '#b9dc9c',
  parkLabel: '#2a6534',
  wood: '#a2d085',
  water: '#8cc8ea',
  waterLabel: '#1d5e8e',
  building: '#e3e5d5',
  buildingLine: '#cdd1bc',
  road: '#ffffff',
  roadCase: '#d5d9c6',
  major: '#fdf2cc',
  majorCase: '#e2c364',
  primary: '#fbe39a',
  primaryCase: '#d6ab36',
  highway: '#f4c843',
  highwayCase: '#b88d21',
  hood: '#2f6b3a',
  rail: '#b3b6a4',
  path: '#b6b38f',
  label: '#525a4a',
  labelStrong: '#2c3428',
  halo: '#f4f6ec',
};

const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_ITALIC = ['Noto Sans Italic'];
const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name']];

const width = (stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.flat()];

function road(id, classes, color, caseColor, w, minzoom = 5) {
  const filter = ['all', ['match', ['get', 'class'], classes, true, false], ['!=', ['get', 'brunnel'], 'tunnel']];
  return [
    {
      id: `${id}-case`,
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom,
      filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': caseColor, 'line-width': width(w.map(([z, v]) => [z, v + (z >= 14 ? 2 : 1)])) },
    },
    {
      id,
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom,
      filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': width(w) },
    },
  ];
}

export const mapStyle = {
  version: 8,
  name: 'Third Space Light',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution:
        '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    },
    'region-mask': { type: 'geojson', data: outsideRegionMask },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': C.land } },

    {
      id: 'landuse-shade',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landuse',
      filter: ['match', ['get', 'class'], ['hospital', 'school', 'university', 'college', 'stadium', 'cemetery'], true, false],
      paint: { 'fill-color': C.landShade },
    },
    {
      id: 'landcover-wood',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landcover',
      filter: ['match', ['get', 'class'], ['wood', 'forest'], true, false],
      paint: { 'fill-color': C.wood },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landcover',
      filter: ['match', ['get', 'class'], ['grass', 'farmland', 'wetland'], true, false],
      paint: { 'fill-color': C.park, 'fill-opacity': 0.85 },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'osm',
      'source-layer': 'park',
      paint: { 'fill-color': C.park },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'osm',
      'source-layer': 'water',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: { 'fill-color': C.water },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'osm',
      'source-layer': 'waterway',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: { 'line-color': C.water, 'line-width': width([[10, 0.5], [18, 4]]) },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'osm',
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-color': C.building,
        'fill-outline-color': C.buildingLine,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1],
      },
    },

    {
      id: 'path',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 14,
      filter: ['match', ['get', 'class'], ['path', 'track'], true, false],
      paint: {
        'line-color': C.path,
        'line-width': width([[14, 0.6], [18, 2]]),
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: 'rail',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 11,
      filter: ['all', ['==', ['get', 'class'], 'rail'], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': C.rail, 'line-width': width([[11, 0.6], [18, 2.5]]) },
    },
    ...road('road-service', ['service'], C.road, C.roadCase, [[15, 0.5], [18, 5]], 15),
    ...road('road-minor', ['minor'], C.road, C.roadCase, [[12, 0.4], [14, 1.6], [18, 12]], 12),
    ...road('road-tertiary', ['tertiary'], C.major, C.majorCase, [[10, 0.5], [14, 3], [18, 16]], 10),
    ...road('road-secondary', ['secondary'], C.major, C.majorCase, [[8, 0.5], [14, 4], [18, 20]], 8),
    ...road('road-primary', ['primary', 'trunk'], C.primary, C.primaryCase, [[6, 0.6], [14, 5], [18, 24]], 6),
    ...road('road-motorway', ['motorway'], C.highway, C.highwayCase, [[5, 0.6], [14, 5], [18, 26]], 5),

    {
      id: 'boundary-state',
      type: 'line',
      source: 'osm',
      'source-layer': 'boundary',
      filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': '#cfc9bd', 'line-width': 1, 'line-dasharray': [3, 2] },
    },

    // Fade everything outside West Philadelphia.
    {
      id: 'outside-region',
      type: 'fill',
      source: 'region-mask',
      paint: { 'fill-color': C.land, 'fill-opacity': 0.45 },
    },
    {
      id: 'region-edge',
      type: 'line',
      source: 'region-mask',
      paint: { 'line-color': '#2f6b3a', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 2.5], 'line-blur': 1 },
    },

    // ---------- labels ----------
    ...['point', 'line'].map((placement) => ({
      id: `water-label-${placement}`,
      type: 'symbol',
      source: 'osm',
      'source-layer': 'water_name',
      filter: ['==', ['geometry-type'], placement === 'line' ? 'LineString' : 'Point'],
      layout: {
        'text-field': NAME,
        'text-font': FONT_ITALIC,
        'text-size': 13,
        'text-letter-spacing': 0.1,
        'symbol-placement': placement,
      },
      paint: { 'text-color': C.waterLabel, 'text-halo-color': C.water, 'text-halo-width': 1 },
    })),
    {
      id: 'waterway-label',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'waterway',
      minzoom: 12,
      filter: ['==', ['get', 'class'], 'river'],
      layout: { 'text-field': NAME, 'text-font': FONT_ITALIC, 'text-size': 12, 'symbol-placement': 'line', 'text-letter-spacing': 0.1 },
      paint: { 'text-color': C.waterLabel, 'text-halo-color': C.water, 'text-halo-width': 1 },
    },
    {
      id: 'road-label',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'transportation_name',
      minzoom: 13,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], true, false],
      layout: {
        'text-field': NAME,
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13],
        'symbol-placement': 'line',
        'text-max-angle': 30,
      },
      paint: { 'text-color': '#776f63', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    },
    {
      id: 'park-label',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'poi',
      minzoom: 14,
      filter: ['match', ['get', 'class'], ['park', 'garden'], true, false],
      layout: { 'text-field': NAME, 'text-font': FONT_ITALIC, 'text-size': 11.5, 'text-max-width': 8 },
      paint: { 'text-color': C.parkLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
    },
    {
      id: 'place-neighbourhood',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      minzoom: 12,
      maxzoom: 16.5,
      filter: ['match', ['get', 'class'], ['neighbourhood', 'quarter', 'suburb'], true, false],
      layout: {
        'text-field': ['upcase', NAME],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9.5, 16, 12],
        'text-letter-spacing': 0.18,
        'text-max-width': 7,
      },
      paint: { 'text-color': C.hood, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
    },
    {
      id: 'place-town',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      maxzoom: 13,
      filter: ['match', ['get', 'class'], ['town', 'village'], true, false],
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 12 },
      paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
    },
    {
      id: 'place-city',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      maxzoom: 12,
      filter: ['==', ['get', 'class'], 'city'],
      layout: { 'text-field': NAME, 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 11, 18] },
      paint: { 'text-color': C.labelStrong, 'text-halo-color': C.halo, 'text-halo-width': 2 },
    },
  ],
};
