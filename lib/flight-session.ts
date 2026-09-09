import type { Point } from './navigation.ts';
import { MISSIONS, type FlightResult } from './training.ts';
import {
  captureFrame,
  snapshot,
  validRecording,
  type RecordableFlight,
  type RecordingBuffer,
} from './flight-review.ts';

export type SimulatorFlight = RecordableFlight & {
  rate: number;
  trail: Point[];
};
export type FlightDraft = {
  version: 1;
  id: string;
  date: string;
  savedAt: number;
  revision: number;
  flight: SimulatorFlight;
  recording: RecordingBuffer;
  standby: string[];
};
export function makeDraft(
  id: string,
  date: string,
  flight: SimulatorFlight,
  recording: RecordingBuffer,
  standby: string[],
  revision = 0,
): FlightDraft {
  return structuredClone({
    version: 1,
    id,
    date,
    savedAt: Date.now(),
    revision,
    flight,
    recording,
    standby,
  });
}
export function validDraft(value: unknown): value is FlightDraft {
  try {
    const d = value as FlightDraft;
    if (d && 'closed' in d) return false;
    if (
      !d ||
      d.version !== 1 ||
      !Number.isFinite(d.savedAt) ||
      d.savedAt < 0 ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 0 ||
      !d.flight ||
      !d.recording
    )
      return false;
    const f = d.flight,
      m = f.metrics,
      frames = d.recording.frames;
    if (
      !m ||
      m.done !== false ||
      !MISSIONS.some((x) => x.id === f.missionId) ||
      d.recording.mission !== f.missionId ||
      ![1, 2, 4].includes(f.rate)
    )
      return false;
    if (
      !validRecording({
        version: 1,
        model: 'lateral-v1',
        id: d.id,
        date: d.date,
        mission: f.missionId,
        exam: f.exam,
        truncated: d.recording.truncated,
        frames,
      })
    )
      return false;
    if (
      ![
        m.elapsed,
        m.stable,
        m.best,
        m.good,
        m.errorIntegral,
        m.samples,
        m.maxError,
        m.arc,
        m.phase,
      ].every(Number.isFinite) ||
      m.elapsed <= 0 ||
      m.stable < 0 ||
      m.best < m.stable ||
      m.best > m.elapsed + 1e-6 ||
      m.good < 0 ||
      m.good > m.elapsed + 1e-6 ||
      m.samples < 0 ||
      m.samples > m.elapsed + 1e-6 ||
      m.errorIntegral < 0 ||
      m.maxError < 0
    )
      return false;
    if (
      m.capture !== null &&
      (!Number.isFinite(m.capture) || m.capture < 0 || m.capture > m.elapsed)
    )
      return false;
    if (
      m.lastRadial !== null &&
      (!Number.isFinite(m.lastRadial) ||
        m.lastRadial < 0 ||
        m.lastRadial >= 360)
    )
      return false;
    const last = frames.at(-1)!;
    if (JSON.stringify(snapshot(f, last.manual)) !== JSON.stringify(last))
      return false;
    if (
      !Array.isArray(f.trail) ||
      f.trail.length > 2400 ||
      !Array.from(f.trail).every(
        (p) =>
          p &&
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lon) &&
          Math.abs(p.lat) <= 90 &&
          Math.abs(p.lon) <= 180,
      )
    )
      return false;
    return (
      Array.isArray(d.standby) &&
      d.standby.length === 3 &&
      Array.from(d.standby).every(
        (v) => typeof v === 'string' && v.length <= 20,
      )
    );
  } catch {
    return false;
  }
}
export function resumeDraft(draft: FlightDraft) {
  if (!validDraft(draft)) throw new Error('Yarım uçuş kaydı geçersiz.');
  const copy = structuredClone(draft);
  copy.flight.running = false;
  copy.flight.rate = 1;
  captureFrame(copy.recording, copy.flight, 0, true);
  return copy;
}

export function validSavedResult(value: unknown): value is FlightResult {
  const r = value as FlightResult;
  return (
    !!r &&
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    r.id.length <= 100 &&
    MISSIONS.some((m) => m.id === r.mission) &&
    typeof r.date === 'string' &&
    Number.isFinite(Date.parse(r.date)) &&
    typeof r.passed === 'boolean' &&
    typeof r.exam === 'boolean' &&
    typeof r.reason === 'string' &&
    r.reason.length <= 1200 &&
    [r.score, r.elapsed, r.stable, r.max].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) &&
    r.score <= 100 &&
    r.elapsed <= 901 &&
    (r.rms === null || (Number.isFinite(r.rms) && r.rms >= 0))
  );
}
