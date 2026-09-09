import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryDatabase } from './helpers/memory-idb.mjs';
import {
  MISSIONS,
  freshMetrics,
  missionSpawn,
  evaluate,
  grade,
} from '../lib/training.ts';
import {
  captureFrame,
  newRecording,
  finishRecording,
  validRecording,
} from '../lib/flight-review.ts';
import { makeDraft, resumeDraft, validDraft } from '../lib/flight-session.ts';
import {
  saveDraft,
  listDrafts,
  retireDraft,
  finalizeDraft,
  savedResults,
  saveRecording,
  readRecording,
} from '../lib/replay-store.ts';

function fixture(id = 'checkpoint') {
  const m = MISSIONS[2];
  const f = {
    ac: missionSpawn(m),
    bug: m.heading,
    wind: { ...m.wind },
    running: false,
    metrics: freshMetrics(),
    missionId: m.id,
    exam: true,
    nav1: 112.5,
    nav2: 108.8,
    adf: 396,
    source: 1,
    courses: [0, 90],
    brg1: 'NAV1',
    brg2: 'NAV2',
    rate: 4,
    trail: [],
  };
  const recording = newRecording(f);
  f.running = true;
  captureFrame(recording, f);
  f.metrics = evaluate(m, f.metrics, f.ac, f, 12);
  captureFrame(recording, f, 1, true);
  const d = makeDraft(
    id,
    new Date().toISOString(),
    f,
    recording,
    ['110.50', '117.30', '347.0'],
    1,
  );
  const result = { ...grade(m, f.metrics, f.exam), id };
  return { draft: d, result, record: finishRecording(recording, result) };
}
async function withDB(fn, version = 0) {
  const adapter = memoryDatabase(version),
    previous = globalThis.indexedDB;
  globalThis.indexedDB = adapter.indexedDB;
  try {
    await fn(adapter);
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
}
test('Checkpoint contains full grading state, settings and immutable replay history', () => {
  const { draft } = fixture();
  assert.equal(validDraft(draft), true);
  const original = structuredClone(draft),
    resumed = resumeDraft(draft);
  assert.equal(resumed.flight.running, false);
  assert.equal(resumed.flight.rate, 1);
  assert.deepEqual(resumed.flight.metrics, original.flight.metrics);
  assert.deepEqual(resumed.standby, original.standby);
  assert.equal(resumed.recording.frames.at(-1).manual, 0);
  assert.equal(resumed.recording.frames.at(-1).t, 12);
  assert.deepEqual(draft, original);
  resumed.flight.ac.heading = 99;
  assert.notEqual(draft.flight.ac.heading, 99);
});
test('Corrupt and terminal checkpoints cannot be recovered', () => {
  const { draft } = fixture();
  for (const bad of [
    null,
    { ...draft, closed: 'finished' },
    { ...draft, revision: -1 },
    {
      ...draft,
      flight: {
        ...draft.flight,
        metrics: { ...draft.flight.metrics, done: true },
      },
    },
    {
      ...draft,
      flight: {
        ...draft.flight,
        metrics: { ...draft.flight.metrics, elapsed: NaN },
      },
    },
    {
      ...draft,
      flight: {
        ...draft.flight,
        metrics: { ...draft.flight.metrics, best: 100 },
      },
    },
    { ...draft, recording: { ...draft.recording, frames: [] } },
    { ...draft, standby: ['only one'] },
  ])
    assert.equal(validDraft(bad), false);
});
test('V1 upgrade preserves existing replays and adds the draft store', async () =>
  withDB(async (db) => {
    const { draft, record } = fixture();
    db.rows.set(record.id, { ...record, savedOrder: 1 });
    assert.equal(await saveDraft(draft), true);
    assert.equal(db.version, 2);
    assert.equal(validRecording(await readRecording(record.id)), true);
    assert.equal((await listDrafts()).length, 1);
  }, 1));
test('Late older revision never overwrites newer settings', async () =>
  withDB(async () => {
    const { draft } = fixture();
    const newer = { ...structuredClone(draft), revision: 2 };
    newer.standby[0] = '117.30';
    await saveDraft(newer);
    await saveDraft(draft);
    assert.equal((await listDrafts())[0].standby[0], '117.30');
  }));
test('Atomic takeover keeps a new paused copy and rejects old writes or old finish', async () =>
  withDB(async () => {
    const { draft, result } = fixture();
    await saveDraft(draft);
    const resumed = await retireDraft(draft.id, 'resumed', {
      id: 'resumed-flight',
      date: new Date().toISOString(),
    });
    assert.equal(resumed.id, 'resumed-flight');
    assert.equal(resumed.flight.running, false);
    assert.equal(resumed.flight.rate, 1);
    assert.deepEqual(resumed.flight.metrics, draft.flight.metrics);
    assert.equal(await saveDraft(draft), false);
    assert.equal(await finalizeDraft(result), false);
    assert.equal((await listDrafts()).length, 1);
    assert.equal((await savedResults()).length, 0);
  }));
test('Two tabs racing for the same draft produce exactly one new owner', async () =>
  withDB(async () => {
    const { draft } = fixture();
    await saveDraft(draft);
    const results = await Promise.all(
      ['tab-a', 'tab-b'].map((id) =>
        retireDraft(draft.id, 'resumed', {
          id,
          date: new Date().toISOString(),
        }),
      ),
    );
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await listDrafts()).length, 1);
  }));
test('Finalization wins over stale checkpoint and claim; repeated finish is idempotent', async () =>
  withDB(async () => {
    const { draft, result, record } = fixture();
    await saveDraft(draft);
    assert.equal(await finalizeDraft(result), true);
    assert.equal(await finalizeDraft(result), false);
    assert.equal(await saveDraft(draft), false);
    assert.equal(
      await retireDraft(draft.id, 'resumed', {
        id: 'too-late',
        date: new Date().toISOString(),
      }),
      null,
    );
    await saveRecording(record);
    assert.equal((await listDrafts()).length, 0);
    assert.equal((await savedResults())[0].id, result.id);
    assert.equal((await readRecording(record.id)).id, record.id);
  }));
test('Replay quota failure retains final summary and never resurrects an active draft', async () =>
  withDB(async (db) => {
    const { draft, result, record } = fixture();
    await saveDraft(draft);
    await finalizeDraft(result);
    db.failWritesTo('recordings');
    await assert.rejects(saveRecording(record));
    assert.equal((await listDrafts()).length, 0);
    assert.equal((await savedResults())[0].id, result.id);
    assert.equal(await saveDraft(draft), false);
  }));
test('Explicit removal retires only the selected draft and rejects delayed writes', async () =>
  withDB(async () => {
    const a = fixture('a'),
      b = fixture('b');
    await saveDraft(a.draft);
    await saveDraft(b.draft);
    await retireDraft('a', 'discarded');
    assert.equal(await saveDraft(a.draft), false);
    assert.deepEqual(
      (await listDrafts()).map((d) => d.id),
      ['b'],
    );
  }));
test('Invalid summaries are excluded and cannot finalize a checkpoint', async () =>
  withDB(async (db) => {
    db.drafts.set('bad', {
      id: 'bad',
      closed: 'finished',
      result: { id: 'bad', score: NaN },
    });
    assert.deepEqual(await savedResults(), []);
    await assert.rejects(finalizeDraft({ id: 'bad' }));
  }));
