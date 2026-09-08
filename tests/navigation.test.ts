import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AIDS,
  NM_FT,
  bearing,
  clamp,
  destination,
  distance,
  fmt,
  norm,
  receiver,
  signed,
  spawn,
  stepAircraft,
  turnRate,
  validFrequency,
  velocity,
  vorSense,
} from '../lib/navigation.ts';
import {
  MISSIONS,
  evaluate,
  fixPoint,
  freshMetrics,
  grade,
  measure,
  missionSpawn,
  type Setup,
} from '../lib/training.ts';
const near = (a: number, b: number, eps = 1e-7) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const config = (course = 0): Setup => ({
  nav1: 112.5,
  nav2: 108.8,
  adf: 396,
  source: 1,
  courses: [course, 90],
  brg1: 'NAV1',
  brg2: 'NAV2',
});

void test('Angle normalization and wrap boundaries', () => {
  near(norm(-1), 359);
  near(norm(721), 1);
  near(signed(359), -1);
  near(signed(-359), 1);
  assert.equal(fmt(359.7), '000');
});
const cases = [
  [0, -10, 0, 'TO', 0],
  [1, -10, 0, 'TO', -5.7105931375],
  [-1, -10, 0, 'TO', 5.7105931375],
  [0, 10, 0, 'FROM', 0],
  [1, 10, 0, 'FROM', -5.7105931375],
  [-1, 10, 0, 'FROM', 5.7105931375],
  [1, -10, 180, 'FROM', 5.7105931375],
  [1, 10, 180, 'TO', 5.7105931375],
  [-10, 1, 90, 'TO', 5.7105931375],
  [10, 1, 90, 'FROM', 5.7105931375],
  [10, 0, 0, 'OFF', -90],
  [-10, 0, 0, 'OFF', 90],
  [2, -10, 0, 'TO', -11.309932474],
] as const;
for (const [east, north, course, flag, error] of cases)
  void test(`VOR E${east} N${north} CRS${course}`, () => {
    const radial = norm((Math.atan2(east, north) * 180) / Math.PI),
      result = vorSense(radial, course);
    assert.equal(result.flag, flag);
    near(result.error, error);
    near(result.cdi, clamp(error / 10, -1, 1));
  });
void test('Spherical radial is computed station-to-aircraft, not shortcut reciprocal', () => {
  const s = { lat: 41, lon: 29 },
    a = destination(s, 90, 100);
  near(a.lat, 40.978961125, 1e-8);
  near(a.lon, 31.206397328, 1e-8);
  near(bearing(s, a), 90);
  near(bearing(a, s), 271.447323067, 1e-8);
  near(distance(s, a), 100);
});
void test('Receiver CDI and TO/FROM invariant under heading changes', () => {
  const ac = spawn(AIDS[0], 185, 10, 0);
  const first = receiver(ac, 112.5, 'NAV', 0)!;
  for (const h of [0, 90, 180, 270]) {
    const r = receiver({ ...ac, heading: h }, 112.5, 'NAV', 0)!;
    near(r.cdi, first.cdi);
    assert.equal(r.flag, first.flag);
    near(r.bearing, norm(r.radial + 180));
  }
});
void test('Reciprocal course reverses scalar CDI and flag but not geographic bar side', () => {
  const a = vorSense(174.2894068625, 0),
    b = vorSense(174.2894068625, 180);
  near(a.cdi, -b.cdi);
  assert.equal(a.flag, 'TO');
  assert.equal(b.flag, 'FROM');
  near(a.cdi * Math.cos(0), b.cdi * Math.cos(Math.PI));
});
void test('6 E variation converts magnetic heading to true north', () => {
  const ac = spawn(AIDS[0], 174, 10, 354),
    r = receiver(ac, 112.5, 'NAV', 354)!;
  near(r.cdi, 0);
  assert.equal(r.flag, 'TO');
  const moved = stepAircraft(ac, 354, { from: 0, speed: 0 }, 1);
  near(moved.lon, ac.lon, 1e-8);
  assert.ok(moved.lat > ac.lat);
});
void test('Unknown/out-of-range/overhead reception does not masquerade as valid', () => {
  const a = spawn();
  assert.equal(receiver(a, 111.1, 'NAV'), null);
  assert.equal(receiver(a, 396, 'NAV'), null);
  assert.equal(receiver(spawn(AIDS[0], 0, 100), 112.5, 'NAV')!.valid, false);
  const overhead = receiver(
    { ...a, lat: AIDS[0].lat, lon: AIDS[0].lon },
    112.5,
    'NAV',
    0,
  )!;
  assert.equal(overhead.valid, false);
  assert.equal(overhead.overhead, true);
  assert.ok(overhead.dme! > 0);
});
void test('DME uses slant range and station elevation; NDB has no DME', () => {
  const s = AIDS[0],
    a = { ...spawn(s, 0, 5), altitude: s.elevation + NM_FT };
  near(receiver(a, s.freq, 'NAV')!.dme!, Math.sqrt(26));
  near(receiver({ ...a, lat: s.lat, lon: s.lon }, s.freq, 'NAV')!.dme!, 1);
  assert.equal(receiver(spawn(AIDS[3], 0, 5), 396, 'ADF')!.dme, null);
});
void test('ADF bearing independent of OBS, relative bearing varies with heading', () => {
  const ac = spawn(AIDS[3], 270, 10);
  const r = receiver(ac, 396, 'ADF', 0)!;
  near(receiver(ac, 396, 'ADF', 199)!.bearing, r.bearing);
  for (const h of [0, 90, 180, 270])
    near(
      receiver({ ...ac, heading: h }, 396, 'ADF')!.relative,
      norm(r.bearing - h),
    );
});
void test('Wind vector sign, ground speed, and coordinated turn rate', () => {
  const v = velocity(0, 120, { from: 90, speed: 20 }, 0);
  near(v.gs, 121.655250606, 1e-7);
  near(v.track, 350.537677792, 1e-7);
  const corrected = velocity(9.594068227, 120, { from: 90, speed: 20 }, 0);
  near(signed(corrected.track), 0, 1e-7);
  near(turnRate(30, 120), 5.254884, 1e-5);
  assert.ok(turnRate(-20, 120) < 0);
});
void test('Frequency channel validation', () => {
  for (const f of ['108.00', '108.80', '112.50', '117.95'])
    assert.ok(validFrequency(f));
  for (const f of ['', 'NaN', '117.99', '107.95', '112.51'])
    assert.equal(validFrequency(f), false);
  assert.ok(validFrequency('396', true));
  assert.ok(validFrequency('396.5', true));
  assert.equal(validFrequency('396.25', true), false);
});
void test('Mission cannot pass from elapsed time or heading selection alone', () => {
  for (const m of MISSIONS) {
    let metrics = freshMetrics();
    for (let i = 0; i < 1000; i++)
      metrics = evaluate(
        m,
        metrics,
        missionSpawn(m),
        { ...config(m.course), nav1: 111.1, adf: 300 },
        1,
      );
    assert.equal(metrics.done, false, m.id);
  }
});
void test('Interrupted stable interval resets instead of summing disjoint moments', () => {
  const m = MISSIONS[0],
    ac = spawn(AIDS[0], 180, 10, 0);
  let metrics = evaluate(m, freshMetrics(), ac, config(), 30);
  near(metrics.stable, 30);
  metrics = evaluate(m, metrics, ac, { ...config(), source: 2 }, 1);
  near(metrics.stable, 0);
  near(metrics.best, 30);
  assert.equal(metrics.done, false);
});
void test('Fix requires both independent radios and correct pointer sources', () => {
  const m = MISSIONS.find((m) => m.kind === 'fix')!,
    ac = { ...spawn(), ...fixPoint };
  assert.ok(measure(m, ac, config()).good);
  assert.equal(measure(m, ac, { ...config(), nav2: 117.3 }).good, false);
  assert.equal(measure(m, ac, { ...config(), brg2: 'NAV1' }).good, false);
});
void test('Passage requires TO -> overhead -> FROM, cannot start after station', () => {
  const m = MISSIONS.find((m) => m.kind === 'passage')!;
  let metrics = freshMetrics();
  metrics = evaluate(m, metrics, spawn(AIDS[0], 0, 1, 0), config(), 20);
  assert.equal(metrics.done, false);
  metrics = evaluate(m, metrics, spawn(AIDS[0], 180, 1, 0), config(), 1);
  assert.equal(metrics.phase, 1);
  metrics = evaluate(
    m,
    metrics,
    { ...spawn(), lat: AIDS[0].lat, lon: AIDS[0].lon },
    config(),
    1,
  );
  assert.equal(metrics.phase, 2);
  metrics = evaluate(m, metrics, spawn(AIDS[0], 0, 1, 0), config(), 6);
  assert.equal(metrics.done, true);
});
void test('Arc requires angular progress, not merely sitting on 10 DME', () => {
  const m = MISSIONS.find((m) => m.kind === 'arc')!;
  let metrics = freshMetrics();
  const ac = missionSpawn(m);
  for (let i = 0; i < 100; i++)
    metrics = evaluate(m, metrics, ac, config(270), 1);
  assert.equal(metrics.done, false);
  near(metrics.arc, 0);
});
void test('Arc directed angle unwrap across north', () => {
  const m = MISSIONS.find((m) => m.kind === 'arc')!;
  let metrics = freshMetrics();
  metrics = evaluate(m, metrics, spawn(AIDS[0], 359, 9.98), config(270), 1);
  metrics = evaluate(m, metrics, spawn(AIDS[0], 1, 9.98), config(270), 1);
  near(metrics.arc, 2, 1e-8);
});
for (const id of [
  'intercept',
  'outbound',
  'crosswind',
  'adf',
  'arc',
  'passage',
])
  void test(`End-to-end physical flight can complete ${id}`, () => {
    const m = MISSIONS.find((x) => x.id === id)!;
    let ac = missionSpawn(m),
      metrics = freshMetrics();
    const setup = {
      ...config(m.course),
      brg1: m.kind === 'adf' ? 'ADF' : 'NAV1',
    };
    while (metrics.elapsed < m.limit && !metrics.done) {
      const r = receiver(
        ac,
        m.kind === 'adf' ? 396 : 112.5,
        m.kind === 'adf' ? 'ADF' : 'NAV',
        m.course,
      )!;
      const wca =
        (Math.asin(
          (m.wind.speed / ac.tas) *
            Math.sin(((m.wind.from - m.course) * Math.PI) / 180),
        ) *
          180) /
        Math.PI;
      let target = m.course + wca;
      if (m.kind === 'arc')
        target = r.radial + 90 + clamp((r.dme! - 10) * 15, -25, 25);
      else if (m.kind === 'adf')
        target += clamp(signed(r.radial - norm(m.course + 180)) * 2, -45, 45);
      else if (m.kind !== 'passage') target += clamp(r.error * 2, -45, 45);
      ac = stepAircraft(ac, target, m.wind, 0.1);
      metrics = evaluate(m, metrics, ac, setup, 0.1);
    }
    assert.equal(
      metrics.done,
      true,
      `${id} incomplete: ${JSON.stringify(metrics)}`,
    );
    assert.ok(grade(m, metrics, false).score >= 70);
  });
void test('Arc cannot earn reversed progress or bypass the bearing setup', () => {
  const m = MISSIONS.find((m) => m.kind === 'arc')!;
  let metrics = freshMetrics();
  for (const radial of [180, 170, 215])
    metrics = evaluate(
      m,
      metrics,
      spawn(AIDS[0], radial, 9.98),
      config(335),
      20,
    );
  near(metrics.arc, 35, 1e-7);
  assert.equal(metrics.done, false);
  assert.equal(
    measure(m, missionSpawn(m), { ...config(), brg1: 'OFF' }).setup,
    false,
  );
  assert.equal(measure(m, missionSpawn(m), config(335)).setup, true);
  metrics = evaluate(m, metrics, spawn(AIDS[0], 220, 12), config(), 1);
  assert.equal(metrics.lastRadial, null);
  near(metrics.arc, 0);
  metrics = evaluate(m, metrics, spawn(AIDS[0], 260, 9.98), config(), 1);
  near(metrics.arc, 0);
});
void test('Physical flight can reach the dual VOR fix', () => {
  const m = MISSIONS.find((m) => m.kind === 'fix')!;
  let ac = missionSpawn(m),
    metrics = freshMetrics();
  while (metrics.elapsed < m.limit && !metrics.done) {
    const target = bearing(ac, fixPoint) - 6;
    ac = stepAircraft(ac, target, m.wind, 0.1);
    metrics = evaluate(m, metrics, ac, config(), 0.1);
  }
  assert.equal(metrics.done, true);
  assert.ok(grade(m, metrics, true).score >= 70);
});
void test('Quiz and lesson integrity', () => {
  const data = JSON.parse(
    readFileSync(new URL('../lib/curriculum.json', import.meta.url), 'utf8'),
  );
  assert.equal(data.lessons.length, 8);
  assert.equal(data.questions.length, 24);
  assert.equal(
    new Set(data.questions.map((q: { id: string }) => q.id)).size,
    24,
  );
  for (const q of data.questions) {
    assert.ok(q.correctIndex >= 0 && q.correctIndex < q.options.length);
    assert.ok(q.explanation.length > 30);
    assert.ok(data.lessons.some((l: { id: string }) => l.id === q.lessonId));
    assert.ok(
      q.citations.every((c: { pdfPages: number[] }) =>
        c.pdfPages.every((p) => p > 0 && p <= 315),
      ),
    );
  }
});
