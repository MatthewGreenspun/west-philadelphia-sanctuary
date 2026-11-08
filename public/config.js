// Shared definitions: icons (24px stroke paths), categories, amenities.

const c = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const ICONS = {
  // categories
  cafe: 'M10 2v2 M14 2v2 M6 2v2 M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1',
  library: 'M12 7v14 M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
  park: 'M17 14l3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17z M12 22v-3',
  bookstore: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1 0-5H20',
  community: `M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 ${c(9, 7, 4)} M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75`,
  market: 'M2 7l2.5-4h15L22 7 M4 7v13h16V7 M2 7h20 M2 7a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 M10 20v-5h4v5',
  bar: 'M8 22h8 M7 10h10 M12 15v7 M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5z',
  museum: 'M3 22h18 M6 18v-7 M10 18v-7 M14 18v-7 M18 18v-7 M4 18h16 M12 2l9 5H3z',
  plaza: `${c(12, 12, 4)} M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M6.34 17.66l-1.41 1.41 M19.07 4.93l-1.41 1.41`,
  coworking: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10H4z M2 19h20 M4 15l-2 4 M20 15l2 4',
  other: `M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z ${c(12, 10, 3)}`,

  // amenities
  wifi: 'M12 20h.01 M2 8.82a15 15 0 0 1 20 0 M5 12.86a10 10 0 0 1 14 0 M8.5 16.43a5 5 0 0 1 7 0',
  outlets: 'M12 22v-5 M9 8V2 M15 8V2 M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z',
  restrooms: 'M13 4h3a2 2 0 0 1 2 2v14 M2 20h3 M13 20h9 M10 12v.01 M13 4.56v16.16a1 1 0 0 1-1.24.97L5 20V5.56a2 2 0 0 1 1.52-1.94l4-1A2 2 0 0 1 13 4.56z',
  accessible: `${c(16, 4, 1)} M18 19l1-7-6 1 M5 8l3-3 5.5 3-2.36 3.5 M4.24 14.5a5 5 0 0 0 6.88 6 M13.76 17.5a5 5 0 0 0-6.88-6`,
  free: 'M3 8h18v4H3z M12 8v13 M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7 M7.5 8a2.5 2.5 0 0 1 0-5C9 3 12 8 12 8s3-5 4.5-5a2.5 2.5 0 0 1 0 5',
  outdoor: 'M22 12a10.06 10.06 0 0 0-20 0z M12 12v8a2 2 0 0 0 4 0 M12 2v1',
  food: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2 M7 2v20 M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3z M21 15v7',
  kids: `${c(12, 12, 10)} M8 14s1.5 2 4 2 4-2 4-2 M9 9h.01 M15 9h.01`,
  dogs: `${c(11, 4, 2)} ${c(18, 8, 2)} ${c(20, 16, 2)} M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.05Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10z`,
  groups: `M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 ${c(9, 7, 4)} M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75`,
  laptops: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10H4z M2 19h20 M4 15l-2 4 M20 15l2 4',

  // ui
  search: `${c(11, 11, 8)} M21 21l-4.3-4.3`,
  x: 'M18 6L6 18 M6 6l12 12',
  plus: 'M12 5v14 M5 12h14',
  locate: `M2 12h3 M19 12h3 M12 2v3 M12 19v3 ${c(12, 12, 7)} ${c(12, 12, 3)}`,
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M2 14h4 M10 8h4 M18 16h4',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  map: 'M14.1 5.55a2 2 0 0 0 1.8 0l3.65-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.55 2.27a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.65 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9l4.55-2.27a2 2 0 0 1 1.8 0z M15 5.76v15 M9 3.24v15',
  heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z',
  share: `${c(18, 5, 3)} ${c(6, 12, 3)} ${c(18, 19, 3)} M8.59 13.51l6.83 3.98 M15.41 6.51l-6.82 3.98`,
  directions: 'M3 11l19-9-9 19-2-8-8-2z',
  edit: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  back: 'M19 12H5 M12 19l-7-7 7-7',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  clock: `${c(12, 12, 10)} M12 6v6l4 2`,
  pin: `M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z ${c(12, 10, 3)}`,
  globe: `${c(12, 12, 10)} M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z`,
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7',
  camera: `M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z ${c(12, 13, 3)}`,
  volume: 'M11 5L6 9H2v6h4l5 4z M15.54 8.46a5 5 0 0 1 0 7.07',
  wallet: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1 M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  users: `M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 ${c(9, 7, 4)} M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75`,
  check: 'M20 6L9 17l-5-5',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z M9 12l2 2 4-4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',

  // club site
  arch: 'M5 21V11a7 7 0 0 1 14 0v10 M3 21h18 M9.5 21v-5a2.5 2.5 0 0 1 5 0v5',
  calendar: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  image: `M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M21 15l-5-5L5 21 ${c(9, 9, 2)}`,
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  instagram: `M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z ${c(12, 12, 4)} M17.5 6.5h.01`,
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  external: 'M15 3h6v6 M10 14L21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  arrowRight: 'M5 12h14 M12 5l7 7-7 7',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  hand: 'M11 14h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16 M7 20l1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9 M2 15l6 6',
  info: `${c(12, 12, 10)} M12 16v-4 M12 8h.01`,
};

export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;
}

export const CATEGORIES = {
  cafe: { label: 'Café', color: '#b8693a' },
  library: { label: 'Library', color: '#3b6ea8' },
  park: { label: 'Park', color: '#3f8a57' },
  bookstore: { label: 'Bookstore', color: '#8657a0' },
  community: { label: 'Community space', color: '#e0573f' },
  market: { label: 'Market & food hall', color: '#c58f22' },
  bar: { label: 'Bar & pub', color: '#a8435a' },
  museum: { label: 'Museum & arts', color: '#4d59a8' },
  plaza: { label: 'Plaza & waterfront', color: '#258896' },
  coworking: { label: 'Coworking', color: '#5a6472' },
  other: { label: 'Other', color: '#7a746b' },
};

export const AMENITIES = {
  wifi: 'Free Wi‑Fi',
  outlets: 'Power outlets',
  laptops: 'Laptop friendly',
  restrooms: 'Restrooms',
  accessible: 'Wheelchair accessible',
  free: 'No purchase needed',
  outdoor: 'Outdoor seating',
  food: 'Food & drink',
  groups: 'Good for groups',
  kids: 'Kid friendly',
  dogs: 'Dog friendly',
};

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export const NOISE = { quiet: 'Quiet', moderate: 'Moderate', lively: 'Lively' };
export const COST = ['Free', '$', '$$', '$$$'];
export const BUSY = {
  1: { label: 'Plenty of room', short: 'Not busy' },
  2: { label: 'Some people', short: 'Moderately busy' },
  3: { label: 'Packed', short: 'Very busy' },
};


// ---------- club site ----------
export const VOLUNTEER = {
  affiliation: {
    'penn-undergrad': 'Penn undergrad',
    'penn-grad': 'Penn grad / professional student',
    'penn-staff': 'Penn staff or faculty',
    'other-student': 'Student at another school',
    neighbor: 'West Philly neighbor',
    other: 'Other',
  },
  interests: {
    events: 'Planning & hosting events',
    outreach: 'Community outreach',
    mapping: 'Mapping third spaces',
    welcome: 'Welcoming new members',
    social: 'Social media & design',
    photo: 'Photography',
    fundraising: 'Fundraising',
    other: 'Something else',
  },
  availability: {
    'weekday-morning': 'Weekday mornings',
    'weekday-afternoon': 'Weekday afternoons',
    'weekday-evening': 'Weekday evenings',
    'weekend-morning': 'Weekend mornings',
    'weekend-afternoon': 'Weekend afternoons',
    'weekend-evening': 'Weekend evenings',
  },
  status: { new: 'New', contacted: 'Contacted', active: 'Active', archived: 'Archived' },
};
