// Lateral training model, not a certified navigation receiver.
export const NM_FT = 6076.115486;
export const VARIATION = 6; // Deliberate fixed training-world variation, east positive.
export const norm = (v: number) => ((v % 360) + 360) % 360;
export const signed = (v: number) => norm(v + 180) - 180;
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const rad = (v: number) => (v * Math.PI) / 180;
const deg = (v: number) => (v * 180) / Math.PI;
export const fmt = (v: number) =>
  norm(Math.round(v)).toString().padStart(3, '0');
export type Point = { lat: number; lon: number };
export type Navaid = Point & {
  id: string;
  name: string;
  type: 'VOR/DME' | 'NDB';
  freq: number;
  elevation: number;
  range: number;
  declination: number;
};
// Frozen scenario database. Do not use as an operational frequency directory.
export const AIDS: Navaid[] = [
  {
    id: 'IST',
    name: 'İstanbul',
    type: 'VOR/DME',
    freq: 112.5,
    lat: 40.962502,
    lon: 28.8097,
    elevation: 150,
    range: 80,
    declination: 6,
  },
  {
    id: 'SBH',
    name: 'Sabiha',
    type: 'VOR/DME',
    freq: 108.8,
    lat: 40.8997,
    lon: 29.3204,
    elevation: 300,
    range: 80,
    declination: 6,
  },
  {
    id: 'BKZ',
    name: 'Beykoz',
    type: 'VOR/DME',
    freq: 117.3,
    lat: 41.1397,
    lon: 29.135,
    elevation: 600,
    range: 80,
    declination: 6,
  },
  {
    id: 'IS',
    name: 'İstanbul NDB',
    type: 'NDB',
    freq: 396,
    lat: 41.057201,
    lon: 28.8064,
    elevation: 150,
    range: 40,
    declination: 6,
  },
  {
    id: 'SAB',
    name: 'Sabiha NDB',
    type: 'NDB',
    freq: 347,
    lat: 40.8995,
    lon: 29.3202,
    elevation: 300,
    range: 40,
    declination: 6,
  },
  {
    id: 'CEK',
    name: 'Çekmece NDB',
    type: 'NDB',
    freq: 328,
    lat: 41.0064,
    lon: 28.5286,
    elevation: 150,
    range: 40,
    declination: 6,
  },
];
export function distance(a: Point, b: Point) {
  const dlat = rad(b.lat - a.lat),
    dlon = rad(b.lon - a.lon);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2;
  return (
    3440.065 *
    2 *
    Math.atan2(Math.sqrt(clamp(h, 0, 1)), Math.sqrt(clamp(1 - h, 0, 1)))
  );
}
export function bearing(a: Point, b: Point) {
  const p = rad(a.lat),
    q = rad(b.lat),
    dl = rad(b.lon - a.lon);
  return norm(
    deg(
      Math.atan2(
        Math.sin(dl) * Math.cos(q),
        Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(dl),
      ),
    ),
  );
}
export function destination(
  a: Point,
  directionTrue: number,
  nm: number,
): Point {
  const d = nm / 3440.065,
    t = rad(directionTrue),
    p = rad(a.lat),
    l = rad(a.lon);
  const p2 = Math.asin(
    Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(t),
  );
  return {
    lat: deg(p2),
    lon: signed(
      deg(
        l +
          Math.atan2(
            Math.sin(t) * Math.sin(d) * Math.cos(p),
            Math.cos(d) - Math.sin(p) * Math.sin(p2),
          ),
      ),
    ),
  };
}
export function vorSense(radial: number, course: number) {
  const d = rad(signed(radial - course));
  const error = -deg(Math.atan2(Math.sin(d), Math.abs(Math.cos(d))));
  const flag: 'TO' | 'FROM' | 'OFF' =
    Math.abs(Math.cos(d)) < 0.001 ? 'OFF' : Math.cos(d) > 0 ? 'FROM' : 'TO';
  return { error, cdi: clamp(error / 10, -1, 1), flag };
}
export type Aircraft = Point & {
  heading: number;
  bank: number;
  altitude: number;
  tas: number;
  track: number;
  gs: number;
};
export type Wind = { from: number; speed: number }; // Magnetic FROM, like the UI.
export function velocity(
  heading: number,
  tas: number,
  wind: Wind,
  variation = VARIATION,
) {
  const h = rad(heading + variation),
    w = rad(wind.from + variation + 180);
  const east = tas * Math.sin(h) + wind.speed * Math.sin(w),
    north = tas * Math.cos(h) + wind.speed * Math.cos(w);
  return {
    gs: Math.hypot(east, north),
    track: norm(deg(Math.atan2(east, north)) - variation),
  };
}
export const turnRate = (bank: number, tas: number) =>
  deg((9.80665 * Math.tan(rad(bank))) / (tas * 0.514444));
export function stepAircraft(
  a: Aircraft,
  targetHeading: number,
  wind: Wind,
  dt: number,
  manual = 0,
): Aircraft {
  const error = signed(targetHeading - a.heading);
  const desiredBank = manual ? manual * 20 : clamp(error * 0.9, -20, 20);
  const bank = a.bank + clamp(desiredBank - a.bank, -12 * dt, 12 * dt);
  const heading = norm(a.heading + turnRate(bank, a.tas) * dt);
  const v = velocity(heading, a.tas, wind);
  return {
    ...a,
    ...destination(a, v.track + VARIATION, (v.gs * dt) / 3600),
    heading,
    bank,
    ...v,
  };
}
export function receiver(
  ac: Aircraft,
  frequency: number,
  kind: 'NAV' | 'ADF',
  course = 0,
) {
  const station = AIDS.find(
    (s) =>
      (kind === 'NAV' ? s.type === 'VOR/DME' : s.type === 'NDB') &&
      Math.abs(s.freq - frequency) < 0.004,
  );
  if (!station) return null;
  const range = distance(ac, station),
    inRange = range <= station.range;
  const radial = norm(bearing(station, ac) - station.declination);
  const overhead = range < 0.25; // Explicit 0.25 NM educational cone approximation.
  const valid = inRange && !overhead;
  const b =
    kind === 'NAV'
      ? norm(radial + 180)
      : norm(bearing(ac, station) - VARIATION);
  return {
    station,
    range,
    inRange,
    valid,
    overhead,
    bearing: b,
    relative: norm(b - ac.heading),
    radial,
    dme:
      kind === 'NAV' && inRange
        ? Math.hypot(range, (ac.altitude - station.elevation) / NM_FT)
        : null,
    ...vorSense(radial, course),
  };
}
export type Reception = ReturnType<typeof receiver>;
export const MORSE: Record<string, string> = {
  I: '..',
  S: '...',
  T: '-',
  B: '-...',
  H: '....',
  K: '-.-',
  Z: '--..',
  A: '.-',
  C: '-.-.',
  E: '.',
};
export const morse = (id: string) =>
  id.split('').map((c) => MORSE[c] ?? '').join(' ');
export function validFrequency(value: string, adf = false) {
  const f = Number(value);
  return (
    Number.isFinite(f) &&
    (adf
      ? f >= 190 && f <= 1799.5 && Math.abs(f * 2 - Math.round(f * 2)) < 0.001
      : f >= 108 &&
        f <= 117.95 &&
        Math.abs(f * 20 - Math.round(f * 20)) < 0.001)
  );
}
export function spawn(
  station = AIDS[0],
  radial = 165,
  nm = 13,
  heading = 345,
): Aircraft {
  return {
    ...destination(station, radial + station.declination, nm),
    heading,
    bank: 0,
    altitude: 4200,
    tas: 120,
    track: heading,
    gs: 120,
  };
}
