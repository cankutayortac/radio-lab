import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as nav from '../lib/navigation.ts';
import * as training from '../lib/training.ts';
import * as review from '../lib/flight-review.ts';
import * as session from '../lib/flight-session.ts';

// Run the actual parent component, its controls, simulation timer and finish path.
// The test hook exposes existing callbacks; it replaces neither physics nor scoring.
const source = readFileSync(
  new URL('../components/navigation-trainer.tsx', import.meta.url),
  'utf8',
).replace(
  '  const controlContext =',
  '  globalThis.__controls = {change, loadMission, toggleFlight, finish, checkpoint, recoverDraft, openBriefing, resetFree};\n  const controlContext =',
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const jsx = (type, props, key) => ({ type, props, key });
const walk = (n) =>
  !n || typeof n !== 'object'
    ? []
    : [n, ...[n.props?.children].flat(Infinity).flatMap(walk)];
const copy = (x) => JSON.parse(JSON.stringify(x));
function harness(options = {}) {
  const slots = [],
    pending = [],
    timeouts = [],
    timers = new Map(),
    windowEvents = new Map(),
    documentEvents = new Map();
  const records = [],
    drafts = [];
  let cursor = 0,
    now = 0,
    serial = 0;
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(v) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof v === 'function' ? v() : v;
      return [
        slots[i],
        (n) => {
          slots[i] = typeof n === 'function' ? n(slots[i]) : n;
        },
      ];
    },
    useRef(v) {
      const i = cursor++;
      return (slots[i] ??= { current: v });
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++,
        prev = slots[i];
      if (!same(prev?.deps, deps))
        pending.push(() => {
          prev?.cleanup?.();
          slots[i] = { deps, cleanup: fn() };
        });
    },
  };
  const events = (map) => ({
    addEventListener(n, f) {
      if (!map.has(n)) map.set(n, new Set());
      map.get(n).add(f);
    },
    removeEventListener(n, f) {
      map.get(n)?.delete(f);
    },
  });
  const store = {
    RECORDING_LIMIT: 20,
    async saveRecording(r) {
      if (options.replayFailure) throw Error('Storage unavailable');
      records.push(structuredClone(r));
    },
    async finalizeDraft() {
      if (options.finalizeFailure) throw Error('Storage unavailable');
      return !options.finalizeDenied;
    },
    async saveDraft(d) {
      drafts.push(structuredClone(d));
      return !options.ownershipLost;
    },
    listDrafts: options.listDrafts ?? (async () => options.drafts ?? []),
    savedResults: async () => options.savedResults ?? [],
    retireDraft:
      options.retireDraft ??
      (async (id, _reason, replacement) => {
        const d = options.drafts?.find((d) => d.id === id);
        return d
          ? { ...session.resumeDraft(d), ...replacement, revision: 0 }
          : null;
      }),
  };
  const local = new Map(options.local ?? []),
    exports = {};
  const context = {
    exports,
    crypto,
    performance: { now: () => now },
    structuredClone,
    queueMicrotask,
    setTimeout: (fn) => {
      timeouts.push(fn);
      return 1;
    },
    clearTimeout() {},
    setInterval: (fn, ms) => {
      const id = ++serial;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    localStorage: {
      getItem: (key) => local.get(key) ?? null,
      setItem: (key, v) => local.set(key, v),
    },
    window: {
      ...events(windowEvents),
      scrollTo() {},
      matchMedia: () => ({ matches: false }),
    },
    document: {
      ...events(documentEvents),
      hidden: false,
      getElementById: () => null,
    },
    require: (name) =>
      name === 'react'
        ? hooks
        : name === 'react/jsx-runtime'
          ? { jsx, jsxs: jsx }
          : name === '@/lib/navigation'
            ? nav
            : name === '@/lib/training'
              ? training
              : name === '@/lib/flight-review'
                ? review
                : name === '@/lib/flight-session'
                  ? session
                  : name === '@/lib/replay-store'
                    ? store
                    : name === '@/lib/curriculum.json'
                      ? {
                          default: JSON.parse(
                            readFileSync(
                              new URL(
                                '../lib/curriculum.json',
                                import.meta.url,
                              ),
                              'utf8',
                            ),
                          ),
                        }
                      : new Proxy({}, { get: (_, key) => key }),
  };
  vm.runInNewContext(code, context);
  const render = () => {
    cursor = 0;
    const tree = exports.default();
    pending.splice(0).forEach((fn) => fn());
    timeouts.splice(0).forEach((fn) => fn());
    return tree;
  };
  const h = {
    render,
    records,
    drafts,
    local,
    context,
    get state() {
      return slots[0];
    },
    get actions() {
      return context.__controls;
    },
    card(id) {
      const card = walk(render()).find(
        (n) =>
          n.type === 'button' &&
          n.key === id &&
          String(n.props.className).startsWith('mission-link'),
      );
      assert.equal(card.props.disabled, false);
      card.props.onClick();
      render();
    },
    toggle() {
      walk(render())
        .find((n) => n.props?.className === 'flight-toggle')
        .props.onClick();
      render();
    },
    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        now += 100;
        [...timers.values()].filter((t) => t.ms === 100).forEach((t) => t.fn());
      }
    },
    event(name, event = {}) {
      windowEvents.get(name)?.forEach((fn) => fn(event));
      documentEvents.get(name)?.forEach((fn) => fn(event));
    },
    async flush() {
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
        render();
      }
    },
    result() {
      return walk(render()).find((n) => n.type === 'Debrief')?.props.results[0];
    },
    cleanup() {
      slots.forEach((s) => s?.cleanup?.());
    },
  };
  render();
  return h;
}
function tune(h, m, rate = 1) {
  h.actions.change({
    nav1: 112.5,
    nav2: 108.8,
    adf: 396,
    source: 1,
    courses: [m.course, 90],
    brg1: m.kind === 'adf' ? 'ADF' : 'NAV1',
    brg2: 'NAV2',
    rate,
  });
  h.render();
}
function fly(h, m) {
  const a = h.state.ac;
  let target;
  if (m.kind === 'fix') target = nav.bearing(a, training.fixPoint) - 6;
  else {
    const r = nav.receiver(
      a,
      m.kind === 'adf' ? 396 : 112.5,
      m.kind === 'adf' ? 'ADF' : 'NAV',
      m.course,
    );
    const wca =
      (Math.asin(
        (m.wind.speed / a.tas) *
          Math.sin(((m.wind.from - m.course) * Math.PI) / 180),
      ) *
        180) /
      Math.PI;
    target = m.course + wca;
    if (m.kind === 'arc')
      target = r.radial + 90 + nav.clamp((r.dme - 10) * 15, -25, 25);
    else if (m.kind === 'adf')
      target += nav.clamp(
        nav.signed(r.radial - nav.norm(m.course + 180)) * 2,
        -45,
        45,
      );
    else if (m.kind !== 'passage') target += nav.clamp(r.error * 2, -45, 45);
  }
  h.actions.change({ bug: nav.norm(Math.round(target)) });
  h.tick();
}
for (const rate of [1, 4])
  for (const m of training.MISSIONS)
    test(`${m.id} ${rate}x: card -> start -> physical flight -> automatic saved result`, async () => {
      const h = harness();
      h.card(m.id);
      assert.equal(h.state.missionId, m.id);
      assert.equal(h.state.running, false);
      tune(h, m, rate);
      h.toggle();
      for (let i = 0; h.state.missionId && i < m.limit * 10 + 10; i++)
        fly(h, m);
      await h.flush();
      const result = h.result();
      assert.equal(result?.passed, true, JSON.stringify(result));
      assert.ok(result.elapsed > m.duration);
      assert.equal(h.records.length, 1);
      assert.equal(review.validRecording(h.records[0]), true);
      assert.ok(result.review);
      assert.equal(h.records[0].frames.at(-1).t, result.elapsed);
      h.tick(5);
      await h.flush();
      assert.equal(h.records.length, 1);
      h.cleanup();
    });
test('Space uses the same prepared mission instead of starting free flight', async () => {
  const h = harness();
  h.card('crosswind');
  h.event('keydown', {
    code: 'Space',
    defaultPrevented: false,
    repeat: false,
    target: { closest: () => null },
    preventDefault() {},
  });
  assert.equal(h.state.missionId, 'crosswind');
  assert.equal(h.state.running, true);
  h.tick(5);
  h.actions.finish(h.state);
  await h.flush();
  assert.equal(h.result().mission, 'crosswind');
  assert.ok(h.result().elapsed > 0);
  h.cleanup();
});
test('Unloaded briefing primary action prepares a mission; free start is explicitly labelled', () => {
  const h = harness();
  const start = walk(h.render()).find(
    (n) => n.props?.className === 'flight-toggle',
  );
  assert.ok([start.props.children].flat().includes('Serbest uçuşu başlat'));
  h.actions.openBriefing();
  h.render();
  h.toggle();
  assert.equal(h.state.missionId, 'intercept');
  assert.equal(h.state.running, false);
  h.cleanup();
});
test('Pause/resume preserves elapsed time and does not create idle checkpoint frames', async () => {
  const h = harness();
  h.card('crosswind');
  tune(h, training.MISSIONS[2]);
  h.toggle();
  h.tick(50);
  h.toggle();
  await h.flush();
  const elapsed = h.state.metrics.elapsed,
    frames = h.drafts.at(-1).recording.frames.length,
    count = h.drafts.length;
  for (let i = 0; i < 20; i++) {
    h.actions.checkpoint();
    await h.flush();
    h.tick();
  }
  assert.equal(h.state.metrics.elapsed, elapsed);
  assert.equal(h.drafts.length, count);
  assert.equal(h.drafts.at(-1).recording.frames.length, frames);
  h.toggle();
  h.tick();
  assert.ok(h.state.metrics.elapsed > elapsed);
  h.cleanup();
});
test('Storage failure still opens an in-session result; ownership denial does not', async () => {
  for (const denied of [false, true]) {
    const h = harness({
      finalizeFailure: !denied,
      finalizeDenied: denied,
      replayFailure: !denied,
    });
    h.card('crosswind');
    h.toggle();
    h.tick(5);
    h.actions.finish(h.state);
    await h.flush();
    assert.equal(!!h.result(), !denied);
    h.cleanup();
  }
});
test('A full local log recovers the newest IDB-only result before applying its 50-result limit', async () => {
  const result = (i) => ({
    id: 'result-' + i,
    mission: 'crosswind',
    date: new Date(1700000000000 + i * 1000).toISOString(),
    score: 80,
    elapsed: 90,
    stable: 60,
    max: 2,
    rms: 1,
    passed: true,
    exam: false,
    reason: 'Completed',
  });
  const previous = Array.from({ length: 50 }, (_, i) => result(49 - i));
  const h = harness({
    local: [['nav-academy-v7', JSON.stringify({ results: previous })]],
    savedResults: [result(50), result(49)],
  });
  await h.flush();
  const saved = JSON.parse(h.local.get('nav-academy-v7')).results;
  assert.equal(saved.length, 50);
  assert.equal(saved[0].id, 'result-50');
  assert.equal(saved.at(-1).id, 'result-1');
  assert.equal(new Set(saved.map((r) => r.id)).size, 50);
  h.cleanup();
});
test('Recovery restores full progress paused at normal speed and cannot show exam hints', async () => {
  const before = harness();
  before.card('crosswind');
  tune(before, training.MISSIONS[2], 4);
  before.actions.change({ exam: true });
  before.toggle();
  before.tick(20);
  before.actions.checkpoint();
  await before.flush();
  const draft = before.drafts.at(-1),
    h = harness({ drafts: [draft] });
  await h.flush();
  await h.actions.recoverDraft(draft.id);
  await h.flush();
  assert.equal(h.state.running, false);
  assert.equal(h.state.rate, 1);
  assert.deepEqual(copy(h.state.metrics), copy(draft.flight.metrics));
  assert.deepEqual(copy(h.state.courses), copy(draft.flight.courses));
  assert.equal(h.state.exam, true);
  const strip = walk(h.render()).find(
    (n) => n.props?.className === 'mission-progress-strip',
  );
  assert.ok(JSON.stringify(strip).includes('Sınav uçuşu'));
  assert.equal(JSON.stringify(strip).includes('Kesintisiz uygun takip'), false);
  h.cleanup();
  before.cleanup();
});
test('Late recovery response never overwrites new control changes', async () => {
  const before = harness();
  before.card('crosswind');
  before.toggle();
  before.tick(10);
  before.actions.checkpoint();
  await before.flush();
  const d = before.drafts.at(-1);
  let resolve;
  const h = harness({
    drafts: [d],
    retireDraft: (_id, _reason, replacement) =>
      new Promise((r) => {
        resolve = () => r({ ...session.resumeDraft(d), ...replacement });
      }),
  });
  await h.flush();
  const pending = h.actions.recoverDraft(d.id);
  h.actions.change({ bug: 123 });
  resolve();
  await pending;
  await h.flush();
  assert.equal(h.state.missionId, null);
  assert.equal(h.state.bug, 123);
  h.cleanup();
  before.cleanup();
});
test('Losing a checkpoint claim pauses and blocks both resume and finish until a new mission', async () => {
  const h = harness({ ownershipLost: true });
  h.card('crosswind');
  h.toggle();
  h.tick(10);
  h.actions.checkpoint();
  await h.flush();
  assert.equal(h.state.running, false);
  h.actions.toggleFlight();
  assert.equal(h.state.running, false);
  h.actions.finish(h.state);
  await h.flush();
  assert.equal(h.result(), undefined);
  h.card('outbound');
  assert.equal(h.state.missionId, 'outbound');
  assert.equal(h.state.metrics.elapsed, 0);
  h.cleanup();
});
