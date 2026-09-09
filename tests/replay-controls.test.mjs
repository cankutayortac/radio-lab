import test from 'node:test';
import { memoryDatabase } from './helpers/memory-idb.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as navigation from '../lib/navigation.ts';
import * as training from '../lib/training.ts';
import * as review from '../lib/flight-review.ts';
import { saveRecording, readRecording } from '../lib/replay-store.ts';

// Production callbacks, controlled React lifecycle and clock. No browser/DOM.
function harness(read = async () => null) {
  const slots = [],
    pending = [],
    intervals = new Map();
  const windowEvents = new Map(),
    documentEvents = new Map();
  let cursor = 0,
    now = 0,
    serial = 0;
  const events = (map) => ({
    addEventListener: (n, fn) => map.set(n, fn),
    removeEventListener: (n) => map.delete(n),
  });
  const document = { ...events(documentEvents), hidden: false };
  const hooks = {
    useState(value) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof value === 'function' ? value() : value;
      return [
        slots[i],
        (next) => {
          slots[i] = typeof next === 'function' ? next(slots[i]) : next;
        },
      ];
    },
    useRef(value) {
      const i = cursor++;
      return (slots[i] ??= { current: value });
    },
    useMemo(fn) {
      cursor++;
      return fn();
    },
    useEffect(fn, deps) {
      const i = cursor++,
        previous = slots[i];
      if (!previous || deps.some((v, n) => v !== previous.deps[n])) {
        pending.push(() => {
          previous?.cleanup?.();
          slots[i] = { deps, cleanup: fn() };
        });
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const exported = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL('../components/flight-review.tsx', import.meta.url),
        'utf8',
      ),
      {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.CommonJS,
        },
      },
    ).outputText,
    {
      exports: exported,
      window: events(windowEvents),
      document,
      performance: { now: () => now },
      setInterval: (fn) => {
        const id = ++serial;
        intervals.set(id, fn);
        return id;
      },
      clearInterval: (id) => intervals.delete(id),
      require: (name) =>
        name === 'react'
          ? hooks
          : name === 'react/jsx-runtime'
            ? { jsx, jsxs: jsx }
            : name === '@/lib/navigation'
              ? navigation
              : name === '@/lib/training'
                ? training
                : name === '@/lib/flight-review'
                  ? review
                  : name === '@/lib/replay-store'
                    ? { readRecording: read }
                    : new Proxy({}, { get: (_, key) => key }),
    },
  );
  return {
    exported,
    document,
    intervals,
    render(component, props) {
      cursor = 0;
      const tree = exported[component](props);
      pending.splice(0).forEach((fn) => fn());
      return tree;
    },
    advance(ms) {
      now += ms;
      [...intervals.values()].forEach((fn) => fn());
    },
    event(name) {
      windowEvents.get(name)?.();
      documentEvents.get(name)?.();
    },
    cleanup() {
      slots.forEach((s) => s?.cleanup?.());
    },
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
const find = (tree, type) => nodes(tree).find((n) => n.type === type);
const label = (tree, name) =>
  nodes(tree).find((n) => n.props?.['aria-label'] === name);
const copy = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
  const m = training.MISSIONS[2];
  const f = {
    ac: training.missionSpawn(m),
    bug: 350,
    wind: { ...m.wind },
    nav1: 112.5,
    nav2: 108.8,
    adf: 396,
    courses: [0, 90],
    source: 1,
    brg1: 'NAV1',
    brg2: 'NAV2',
    running: false,
    metrics: training.freshMetrics(),
    missionId: m.id,
    exam: true,
  };
  const b = review.newRecording(f);
  f.running = true;
  review.captureFrame(b, f);
  f.metrics.elapsed = 5;
  f.ac = { ...f.ac, heading: 350, track: 0 };
  f.courses = [180, 270];
  f.source = 2;
  f.brg1 = 'ADF';
  f.brg2 = 'OFF';
  review.captureFrame(b, f);
  f.metrics.elapsed = 10;
  f.nav2 = 111.1;
  f.running = false;
  review.captureFrame(b, f, 0, true);
  const result = training.grade(m, f.metrics, true);
  return { result, record: review.finishRecording(b, result) };
}

test('Replay seeks one recorded frame for HSI, both bearings and map without mutating it', () => {
  const { record } = fixture(),
    before = JSON.stringify(record),
    h = harness();
  const render = () => h.render('Replay', { record });
  find(render(), 'StableSlider').props.onChange(5);
  const tree = render(),
    hsi = find(tree, 'TrainerHSI').props,
    map = find(tree, 'TrainerMap').props;
  assert.equal(hsi.navIndex, 2);
  assert.equal(hsi.course, 270);
  assert.equal(hsi.nav.station.id, 'SBH');
  assert.equal(hsi.s1, 'ADF');
  assert.equal(hsi.b1.station.id, 'IS');
  assert.equal(hsi.b2, null);
  assert.equal(hsi.bug, 350);
  assert.deepEqual(copy(hsi.ac), copy(map.ac));
  assert.deepEqual(copy(map.trail.at(-1)), {
    lat: hsi.ac.lat,
    lon: hsi.ac.lon,
  });
  assert.equal(map.trail.length, 3);
  assert.equal(map.canPlace, false);
  map.onPlace({ lat: 0, lon: 0 });
  label(render(), '5 saniye ileri').props.onClick();
  assert.equal(find(render(), 'TrainerHSI').props.nav, null);
  label(render(), '5 saniye geri').props.onClick();
  assert.equal(find(render(), 'TrainerHSI').props.course, 270);
  label(render(), 'İlk kayıt karesi').props.onClick();
  assert.equal(find(render(), 'TrainerHSI').props.course, 0);
  assert.equal(JSON.stringify(record), before);
  h.cleanup();
});
test('Replay timer, speed and background cancellation never advance a hidden flight', () => {
  const { record } = fixture(),
    h = harness(),
    render = () => h.render('Replay', { record });
  label(render(), 'Kaydı oynat').props.onClick();
  render();
  assert.equal(h.intervals.size, 1);
  h.advance(1000);
  render();
  const speed = nodes(render()).find(
    (n) => n.type === 'Choice' && n.props.label === 'Tekrar hızı',
  );
  speed.props.onChange('4');
  render();
  h.advance(1000);
  render();
  assert.equal(find(render(), 'TrainerHSI').props.course, 270);
  h.document.hidden = true;
  h.event('visibilitychange');
  render();
  assert.equal(h.intervals.size, 0);
  const time = find(render(), 'StableSlider').props.value;
  h.advance(20000);
  assert.equal(find(render(), 'StableSlider').props.value, time);
  h.document.hidden = false;
  label(render(), 'Kaydı oynat').props.onClick();
  render();
  h.advance(1000);
  render();
  h.advance(1000);
  render();
  assert.equal(find(render(), 'StableSlider').props.value, 10);
  assert.equal(h.intervals.size, 0);
  label(render(), 'Kaydı oynat').props.onClick();
  render();
  assert.equal(find(render(), 'StableSlider').props.value, 0);
  h.event('blur');
  render();
  assert.equal(h.intervals.size, 0);
  h.cleanup();
});
test('Old recording lookup is canceled on unmount and identity mismatch cannot replay', async () => {
  const { record, result } = fixture();
  let resolve;
  const h = harness(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  h.render('FlightReview', { result });
  h.cleanup();
  resolve(record);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    find(h.render('FlightReview', { result }), h.exported.Replay),
    undefined,
  );
  const wrong = harness(async () => ({ ...record, mission: 'intercept' }));
  wrong.render('FlightReview', { result });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    find(wrong.render('FlightReview', { result }), wrong.exported.Replay),
    undefined,
  );
  wrong.cleanup();
});
test('Completed result keys reset history and replay; no unfinished exam buffer is passed', () => {
  const source = readFileSync(
    new URL('../components/navigation-trainer.tsx', import.meta.url),
    'utf8',
  );
  const learning = readFileSync(
    new URL('../components/trainer-learning.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /<Debrief\s+key=\{results\[0\]\?\.id/);
  assert.match(learning, /<FlightReview\s+key=\{latest.id\}/);
  assert.match(source, /sessionRecordings=\{sessionRecordings\}/);
  assert.doesNotMatch(source, /<Debrief[^>]*recording\.current/s);
  assert.match(source, /captureFrame\(buffer, \{ \.\.\.f, running: false \}/);
});

test('IndexedDB stores only latest 20 by insertion order even if device clock goes backward', async () => {
  const adapter = memoryDatabase();
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = adapter.indexedDB;
  try {
    const { record } = fixture();
    for (let i = 0; i < 22; i++)
      await saveRecording({
        ...record,
        id: `flight-${i}`,
        date: i === 21 ? '2020-01-01T00:00:00Z' : record.date,
      });
    assert.equal(adapter.rows.size, 20);
    assert.equal(await readRecording('flight-0'), null);
    assert.equal(await readRecording('flight-1'), null);
    assert.equal((await readRecording('flight-21')).id, 'flight-21');
    const emptySlots = [];
    emptySlots.length = 2;
    adapter.rows.get('flight-21').frames = emptySlots;
    assert.equal(await readRecording('flight-21'), null);
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
});
