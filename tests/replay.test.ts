import test from 'node:test';
import assert from 'node:assert/strict';
import { AIDS, spawn, velocity } from '../lib/navigation.ts';
import {
  MISSIONS,
  evaluate,
  freshMetrics,
  grade,
  missionSpawn,
  fixPoint,
} from '../lib/training.ts';
import {
  MAX_FRAMES,
  captureFrame,
  explainFrame,
  finishRecording,
  frameAtTime,
  frameReceivers,
  newRecording,
  recordingEvents,
  snapshot,
  summarizeRecording,
  validRecording,
  validReviewSummary,
  type RecordableFlight,
} from '../lib/flight-review.ts';
import { readRecording, saveRecording } from '../lib/replay-store.ts';

const mission = (id: string) => MISSIONS.find((m) => m.id === id)!;
function flight(id = 'intercept'): RecordableFlight {
  const m = mission(id);
  return {
    ac: missionSpawn(m),
    bug: m.heading,
    wind: { ...m.wind },
    running: false,
    metrics: freshMetrics(),
    missionId: id,
    exam: false,
    nav1: 112.5,
    nav2: 108.8,
    adf: 396,
    source: 1,
    courses: [m.course, 90],
    brg1: m.kind === 'adf' ? 'ADF' : 'NAV1',
    brg2: 'NAV2',
  };
}
function completed(f: RecordableFlight, seconds = 2) {
  const b = newRecording(f);
  f.running = true;
  captureFrame(b, f);
  f.metrics.elapsed = seconds;
  captureFrame(b, f);
  f.running = false;
  captureFrame(b, f, 0, true);
  const result = grade(mission(f.missionId!), f.metrics, f.exam);
  return { record: finishRecording(b, result), result };
}

for (const m of MISSIONS) {
  void test(`${m.id}: full immutable start, running and terminal snapshots`, () => {
    const f = flight(m.id);
    f.exam = true;
    const { record, result } = completed(f, m.limit);
    assert.equal(validRecording(record), true);
    assert.equal(record.mission, result.mission);
    assert.equal(record.id, result.id);
    assert.equal(record.exam, true);
    assert.equal(record.frames[0].t, 0);
    assert.equal(record.frames.at(-1)!.t, result.elapsed);
    assert.equal(record.frames.at(-1)!.running, false);
    const original = JSON.stringify(record);
    f.ac.heading = 123;
    f.wind.speed = 33;
    f.courses[0] = 123;
    assert.equal(JSON.stringify(record), original);
    const summary = summarizeRecording(record, result);
    assert.equal(validReviewSummary(summary), true);
    assert.ok(summary.facts.length >= 3);
  });
  void test(`${m.id}: incorrect station is setup, never piloting failure`, () => {
    const f = flight(m.id);
    f.nav1 = 111.1;
    f.adf = 399;
    const e = explainFrame(m, snapshot(f));
    assert.equal(e.category, 'setup');
    assert.equal(e.assessable, false);
  });
}

void test('Paused edits preserve same-time events and both independent CRS values', () => {
  const f = flight(),
    b = newRecording(f);
  f.source = 2;
  f.courses = [359, 20];
  f.nav2 = 117.3;
  f.brg1 = 'ADF';
  f.brg2 = 'OFF';
  f.bug = 352;
  captureFrame(b, f, -1);
  const record = finishRecording(
    b,
    grade(mission('intercept'), f.metrics, false),
  );
  assert.equal(b.frames.length, 2);
  assert.equal(frameAtTime(b.frames, 0), 1);
  assert.equal(b.frames[0].source, 1);
  assert.deepEqual(b.frames[1].courses, [359, 20]);
  const events = recordingEvents(record);
  for (const part of ['NAV2', 'CRS', 'HDG', 'BRG'])
    assert.ok(
      events.some((e) => (e.title + e.detail).includes(part)),
      part,
    );
  assert.equal(b.frames[1].manual, -1);
});
void test('Sampling interval, mission isolation, and no future interpolation', () => {
  const f = flight(),
    b = newRecording(f);
  f.metrics.elapsed = 0.1;
  captureFrame(b, f);
  assert.equal(b.frames.length, 1);
  f.metrics.elapsed = 0.25;
  captureFrame(b, f);
  f.metrics.elapsed = 0.5;
  f.source = 2;
  captureFrame(b, f);
  assert.equal(frameAtTime(b.frames, -0.1), 0);
  assert.equal(b.frames[frameAtTime(b.frames, 0.49)].source, 1);
  assert.equal(b.frames[frameAtTime(b.frames, 0.5)].source, 2);
  assert.equal(frameAtTime(b.frames, 100), 2);
  f.metrics.elapsed = 0.1;
  captureFrame(b, f, 0, true);
  f.missionId = 'outbound';
  f.metrics.elapsed = 1;
  captureFrame(b, f, 0, true);
  assert.equal(b.frames.length, 3);
});
void test('Capture cap keeps early history and latest terminal frame, marks gap', () => {
  const f = flight('arc'),
    b = newRecording(f);
  for (let n = 1; n <= MAX_FRAMES + 5; n++) {
    f.bug = n % 360;
    f.metrics.elapsed = n / 20;
    captureFrame(b, f);
  }
  assert.equal(b.frames.length, MAX_FRAMES);
  assert.equal(b.truncated, true);
  assert.equal(b.frames[0].t, 0);
  assert.equal(b.frames.at(-1)!.t, f.metrics.elapsed);
});
void test('All receiver calculations use their own recorded frequency/course and sources', () => {
  const f = flight();
  f.courses = [0, 180];
  f.adf = 399;
  const r = frameReceivers(snapshot(f));
  assert.equal(r.NAV1!.station.id, 'IST');
  assert.equal(r.NAV2!.station.id, 'SBH');
  assert.equal(r.ADF, null);
  assert.equal(r.OFF, null);
  const before = r.NAV1!.cdi;
  f.ac.heading = 120;
  assert.equal(frameReceivers(snapshot(f)).NAV1!.cdi, before);
});
void test('Inbound opposite branch can have centered CDI but is not lateral error 180°', () => {
  const f = flight();
  f.ac = spawn(AIDS[0], 0, 10, 0);
  const r = frameReceivers(snapshot(f)).NAV1!;
  assert.ok(Math.abs(r.cdi) < 1e-8);
  assert.equal(r.flag, 'FROM');
  const e = explainFrame(mission('intercept'), snapshot(f));
  assert.equal(e.code, 'branch');
  assert.equal(e.category, 'flight');
  assert.doesNotMatch(e.detail, /CDI.*180/);
});
void test('Crosswind assesses track, not selected heading bug or zero relative bearing', () => {
  const f = flight('crosswind');
  assert.equal(
    explainFrame(mission('crosswind'), snapshot(f)).category,
    'flight',
  );
  f.ac.heading = 360 - (Math.asin(20 / f.ac.tas) * 180) / Math.PI;
  Object.assign(f.ac, velocity(f.ac.heading, f.ac.tas, f.wind));
  f.bug = 20;
  assert.equal(explainFrame(mission('crosswind'), snapshot(f)).within, true);
});
void test('ADF tracking ignores CRS/CDI selectors and accepts crabbed nose', () => {
  const f = flight('adf');
  f.courses = [199, 283];
  f.source = 2;
  f.ac.heading = 90 - (Math.asin(16 / f.ac.tas) * 180) / Math.PI;
  Object.assign(f.ac, velocity(f.ac.heading, f.ac.tas, f.wind));
  assert.equal(explainFrame(mission('adf'), snapshot(f)).within, true);
  assert.ok(frameReceivers(snapshot(f)).ADF!.relative > 1);
  Object.assign(f.ac, { lat: AIDS[3].lat, lon: AIDS[3].lon });
  const e = explainFrame(mission('adf'), snapshot(f));
  assert.equal(e.category, 'signal');
  assert.match(e.detail, /ADF bearing/);
  assert.doesNotMatch(e.detail, /CDI|DME/);
});
void test('Arc time alone is insufficient; direction and course independence explained', () => {
  const m = mission('arc'),
    f = flight('arc');
  f.source = 2;
  f.courses = [123, 240];
  f.metrics = evaluate(m, freshMetrics(), f.ac, f, 50);
  assert.equal(f.metrics.done, false);
  assert.equal(explainFrame(m, snapshot(f)).code, 'arc-progress');
  f.metrics.arc = -10;
  assert.equal(explainFrame(m, snapshot(f)).code, 'arc-reverse');
  f.ac = spawn(AIDS[0], 180, 12, 270);
  assert.equal(explainFrame(m, snapshot(f)).code, 'arc-wide');
});
void test('Fix requires both valid receivers, and invalid NAV2 does not contaminate RMS', () => {
  const m = mission('fix'),
    f = flight('fix');
  Object.assign(f.ac, fixPoint);
  assert.equal(explainFrame(m, snapshot(f)).code, 'fix-hold');
  Object.assign(f.ac, { lat: AIDS[1].lat, lon: AIDS[1].lon });
  assert.equal(frameReceivers(snapshot(f)).NAV1!.valid, true);
  assert.equal(explainFrame(m, snapshot(f)).category, 'signal');
  const metrics = evaluate(m, freshMetrics(), f.ac, f, 5);
  assert.equal(metrics.samples, 0);
  assert.equal(metrics.errorIntegral, 0);
  f.nav2 = 117.3;
  assert.equal(explainFrame(m, snapshot(f)).code, 'receiver2');
});
void test('Passage uses historical sequence AND current FROM branch, overhead is not piloting', () => {
  const f = flight('passage'),
    m = mission('passage');
  f.metrics.phase = 3;
  f.ac = spawn(AIDS[0], 180, 2, 0);
  assert.equal(explainFrame(m, snapshot(f)).code, 'passage-branch');
  Object.assign(f.ac, { lat: AIDS[0].lat, lon: AIDS[0].lon });
  const e = explainFrame(m, snapshot(f));
  assert.equal(e.category, 'signal');
  assert.equal(e.assessable, false);
  assert.ok(frameReceivers(snapshot(f)).NAV1!.dme! > 0.6);
  f.ac = spawn(AIDS[0], 0, 2, 0);
  assert.equal(explainFrame(m, snapshot(f)).code, 'passage-hold');
  f.metrics.phase = 0;
  assert.equal(explainFrame(m, snapshot(f)).code, 'passage-sequence');
});
void test('Paused invalid preflight settings are not dominant errors or flown time', () => {
  const f = flight();
  f.nav1 = 111.1;
  const b = newRecording(f);
  f.nav1 = 112.5;
  f.running = true;
  f.ac = spawn(AIDS[0], 180, 10, 0);
  captureFrame(b, f);
  f.metrics.elapsed = 0.5;
  captureFrame(b, f);
  f.running = false;
  captureFrame(b, f, 0, true);
  const result = grade(mission('intercept'), f.metrics, false);
  const summary = summarizeRecording(finishRecording(b, result), result);
  assert.doesNotMatch(summary.headline, /ayarlı değil|başlamadan/);
  assert.match(
    summary.facts[0],
    /Ayar nedeniyle değerlendirilemeyen yaklaşık 0.0 sn/,
  );
});
void test('Zero-time finish and each task-specific summary are honest', () => {
  const terms = ['TO', 'FROM', 'yer izini', 'ADF', '45°', '0.60', 'faz'];
  MISSIONS.forEach((m, i) => {
    const { record, result } = completed(flight(m.id), 0);
    const s = summarizeRecording(record, result);
    assert.match(s.headline, /başlamadan/);
    assert.ok(
      s.facts.some((f) => f.includes(terms[i])),
      `${m.id}: ${s.facts.join(' ')}`,
    );
  });
});
void test('Recording validation rejects corrupt/future data without rejecting old summaries', () => {
  const { record } = completed(flight());
  const middleHole = record.frames.slice(),
    firstHole = record.frames.slice();
  Reflect.deleteProperty(middleHole, '1');
  Reflect.deleteProperty(firstHole, '0');
  const emptySlots: unknown[] = [];
  emptySlots.length = 1;
  const first = record.frames[0];
  for (const invalid of [
    { ...record, version: 2 },
    { ...record, model: 'future' },
    { ...record, frames: [] },
    { ...record, frames: emptySlots },
    { ...record, frames: middleHole },
    { ...record, frames: firstHole },
    { ...record, mission: 'unknown' },
    { ...record, frames: [{ ...first, ac: { ...first.ac, heading: NaN } }] },
    { ...record, frames: [{ ...first, brg1: 'BOGUS' }] },
    { ...record, frames: [{ ...first, source: 3 }] },
    { ...record, frames: [first, { ...first, t: -1 }] },
    { ...record, frames: [{ ...first, courses: [1] }] },
  ])
    assert.equal(validRecording(invalid), false);
  assert.equal(validReviewSummary(undefined), false);
  assert.equal(
    validReviewSummary({
      version: 1,
      headline: 'Özet',
      nextStep: 'Tekrar',
      facts: ['A'],
    }),
    true,
  );
});
void test('Unavailable IndexedDB rejects explicitly without destroying the in-memory record', async () => {
  const { record } = completed(flight());
  const before = JSON.stringify(record);
  await assert.rejects(readRecording(record.id));
  await assert.rejects(saveRecording(record));
  assert.equal(JSON.stringify(record), before);
});
