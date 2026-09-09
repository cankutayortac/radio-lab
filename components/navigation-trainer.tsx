'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  Compass,
  Flag,
  Focus,
  GraduationCap,
  MapPinned,
  Pause,
  Play,
  RadioTower,
  RotateCcw,
  ShieldCheck,
  Trophy,
  Wind as WindIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrainerHSI, type BearingSource } from './trainer-hsi';
import { TrainerMap } from './trainer-map';
import {
  AngleControl,
  StableSlider,
  Choice,
  Radio,
  Time,
} from './trainer-controls';
import {
  Debrief,
  KnowledgeTest,
  Lesson,
  References,
  type QuizResult,
} from './trainer-learning';
import {
  fmt,
  norm,
  receiver,
  spawn,
  stepAircraft,
  velocity,
  type Aircraft,
  type Point,
  type Wind,
} from '@/lib/navigation';
import {
  evaluate,
  fixRadial2,
  freshMetrics,
  grade,
  measure,
  MISSIONS,
  missionSpawn,
  type FlightResult,
  type Metrics,
  type Setup,
} from '@/lib/training';
import curriculum from '@/lib/curriculum.json';
import {
  captureFrame,
  explainFrame,
  snapshot,
  newRecording,
  finishRecording,
  summarizeRecording,
  validReviewSummary,
  type RecordingBuffer,
  type FlightRecording,
} from '@/lib/flight-review';
import {
  saveRecording,
  RECORDING_LIMIT,
  saveDraft,
  listDrafts,
  retireDraft,
  finalizeDraft,
  savedResults,
} from '@/lib/replay-store';
import { makeDraft, type FlightDraft } from '@/lib/flight-session';

type Flight = Setup & {
  ac: Aircraft;
  bug: number;
  wind: Wind;
  running: boolean;
  rate: number;
  metrics: Metrics;
  missionId: string | null;
  exam: boolean;
  trail: Point[];
};
const initial = (): Flight => ({
  ac: spawn(),
  bug: 345,
  nav1: 112.5,
  nav2: 108.8,
  adf: 396,
  source: 1,
  courses: [335, 90],
  brg1: 'NAV1',
  brg2: 'NAV2',
  wind: { from: 270, speed: 0 },
  running: false,
  rate: 1,
  metrics: freshMetrics(),
  missionId: null,
  exam: false,
  trail: [],
});
const choices = ['NAV1', 'NAV2', 'ADF', 'OFF'].map((value) => ({
  value,
  label: value,
}));
const lessonForMission: Record<string, string> = {
  intercept: 'vor-inbound',
  outbound: 'vor-outbound',
  crosswind: 'crosswind-tracking',
  adf: 'orientation-adf',
  arc: 'dme-arc',
  fix: 'two-vor-fix',
  passage: 'station-passage',
};
const panes = [
  { id: 'flight', label: 'Uçuş', icon: Compass },
  { id: 'learn', label: 'Dersler', icon: BookOpen },
  { id: 'quiz', label: 'Bilgi testi', icon: GraduationCap },
  { id: 'results', label: 'Uçuş defteri', icon: Trophy },
  { id: 'sources', label: 'Kaynaklar', icon: CircleHelp },
];
export default function NavigationTrainer() {
  const [flight, setFlight] = useState<Flight>(initial),
    state = useRef(flight),
    manual = useRef(0);
  const activePointer = useRef<number | null>(null);
  const briefingRequested = useRef(false);
  const recording = useRef<RecordingBuffer | null>(null);
  const sessionInfo = useRef<{
    id: string;
    date: string;
    revision: number;
  } | null>(null);
  const restoring = useRef(false);
  const abandoned = useRef(false);
  const lastCheckpoint = useRef('');
  const [ownershipLost, setOwnershipLost] = useState(false);
  const finishing = useRef(false);
  const [finalizing, setFinalizing] = useState(false);
  const [drafts, setDrafts] = useState<FlightDraft[]>([]);
  const [recovering, setRecovering] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');
  const [sessionRecordings, setSessionRecordings] = useState<
    ReadonlyMap<string, FlightRecording>
  >(new Map());
  const [controlEpoch, setControlEpoch] = useState(0);
  const [mobileView, setMobileView] = useState('cockpit');
  const [pane, setPane] = useState('flight'),
    [selected, setSelected] = useState(MISSIONS[0].id),
    [lesson, setLesson] = useState(curriculum.lessons[0].id),
    [quizTopic, setQuizTopic] = useState('all'),
    [quizKey, setQuizKey] = useState(0);
  const [standby, setStandby] = useState(['108.80', '117.30', '347.0']),
    [follow, setFollow] = useState(true),
    [guide, setGuide] = useState(true),
    [recenter, setRecenter] = useState(0),
    [exam, setExam] = useState(false),
    [notice, setNotice] = useState(''),
    [storageWarning, setStorageWarning] = useState('');
  const [results, setResults] = useState<FlightResult[]>([]),
    [quizzes, setQuizzes] = useState<QuizResult[]>([]),
    [completed, setCompleted] = useState<string[]>([]),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (
      briefingRequested.current &&
      pane === 'flight' &&
      mobileView === 'mission'
    ) {
      briefingRequested.current = false;
      const heading = document.getElementById('mission-briefing');
      heading?.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 900px)').matches)
        heading?.scrollIntoView({ block: 'start' });
    }
  }, [pane, mobileView, lesson, selected]);
  const commit = useCallback((next: Flight) => {
    captureFrame(recording.current, next, manual.current);
    state.current = next;
    setFlight(next);
  }, []);
  const change = useCallback(
    (patch: Partial<Flight>) => commit({ ...state.current, ...patch }),
    [commit],
  );
  const checkpoint = useCallback(() => {
    const f = state.current,
      info = sessionInfo.current,
      buffer = recording.current;
    if (
      !info ||
      !buffer ||
      !f.missionId ||
      f.metrics.elapsed <= 0 ||
      f.metrics.done
    )
      return;
    const fingerprint = JSON.stringify([
      info.id,
      snapshot(f, manual.current),
      standby,
    ]);
    if (lastCheckpoint.current === fingerprint) return;
    captureFrame(
      buffer,
      f,
      manual.current,
      buffer.frames.at(-1)?.t !== f.metrics.elapsed,
    );
    const draft = makeDraft(
      info.id,
      info.date,
      f,
      buffer,
      standby,
      ++info.revision,
    );
    void saveDraft(draft)
      .then((saved) => {
        if (sessionInfo.current?.id !== info.id) return;
        if (saved) {
          if (info.revision === draft.revision)
            lastCheckpoint.current = fingerprint;
          if (info.revision === draft.revision)
            setDraftStatus(
              `Son ara kayıt ${new Date(draft.savedAt).toLocaleTimeString('tr-TR')} · bu tarayıcıda`,
            );
        } else {
          abandoned.current = true;
          setOwnershipLost(true);
          sessionInfo.current = null;
          change({ running: false });
          setDraftStatus(
            'Bu uçuş başka sekmede devralındı veya kaldırıldı; bu kopya duraklatıldı.',
          );
        }
      })
      .catch(() => {
        if (sessionInfo.current?.id === info.id)
          setDraftStatus(
            'Ara kayıt yazılamıyor; sayfayı kapatmadan uçuşu bitir.',
          );
      });
  }, [standby, change]);
  useEffect(() => {
    let cancelled = false;
    void listDrafts()
      .then((items) => {
        if (!cancelled) setDrafts(items);
      })
      .catch(() => {
        if (!cancelled) setDraftStatus('Ara kayıt deposu kullanılamıyor.');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(checkpoint, 2000);
    const flush = () => checkpoint();
    const visibility = () => {
      if (document.hidden) checkpoint();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [checkpoint]);
  useEffect(() => {
    if (flight.missionId && !flight.running && flight.metrics.elapsed > 0)
      checkpoint();
  }, [flight.missionId, flight.running, flight.metrics.elapsed, checkpoint]);
  const finish = useCallback(
    (f: Flight) => {
      const m = MISSIONS.find((x) => x.id === f.missionId);
      if (
        !m ||
        abandoned.current ||
        finishing.current ||
        state.current.missionId !== m.id
      )
        return;
      finishing.current = true;
      setFinalizing(true);
      const result = {
        ...grade(m, f.metrics, f.exam),
        ...(sessionInfo.current ? { id: sessionInfo.current.id } : {}),
      };
      const buffer = recording.current;
      let replay: FlightRecording | null = null;
      if (buffer && buffer.mission === m.id) {
        captureFrame(buffer, { ...f, running: false }, manual.current, true);
        replay = finishRecording(buffer, result);
        result.review = summarizeRecording(replay, result);
      }
      recording.current = null;
      sessionInfo.current = null;
      activePointer.current = null;
      manual.current = 0;
      commit({ ...f, running: false, missionId: null });
      setNotice('Uçuş sona erdi; sonuç kaydediliyor…');
      const publishResult = () => {
        if (replay) {
          const savedReplay = replay;
          setSessionRecordings((previous) => {
            const next = new Map(previous);
            next.set(result.id, savedReplay);
            while (next.size > RECORDING_LIMIT)
              next.delete(next.keys().next().value!);
            return next;
          });
          void saveRecording(savedReplay).catch(() =>
            setStorageWarning((previous) =>
              [
                previous,
                'Ayrıntılı tekrar bu oturumda kullanılabilir, fakat kalıcı kaydı doğrulanamadı.',
              ]
                .filter(Boolean)
                .join(' '),
            ),
          );
        }
        setResults((previous) =>
          [result, ...previous.filter((r) => r.id !== result.id)].slice(0, 50),
        );
        setDrafts((items) => items.filter((d) => d.id !== result.id));
        setDraftStatus('');
        setNotice(
          result.passed
            ? 'Görev kendiliğinden tamamlandı. Uçuş kaydı ve değerlendirmen hazır.'
            : 'Uçuş sona erdi. Kayıt ve değerlendirmen hazır.',
        );
        setPane('results');
      };
      void finalizeDraft(result)
        .then((accepted) => {
          if (accepted) publishResult();
          else
            setNotice(
              'Bu uçuş başka sekmede devralınmış veya sonlandırılmış. Bu sekme önceki kaydı değiştirmedi.',
            );
        })
        .catch(() => {
          setStorageWarning(
            'Kalıcı sonuç kaydı doğrulanamadı; sonucu bu oturumda inceleyebilirsin.',
          );
          publishResult();
        })
        .finally(() => {
          finishing.current = false;
          setFinalizing(false);
        });
    },
    [commit],
  );
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void savedResults()
      .then((items) => {
        if (cancelled) return;
        setResults((previous) =>
          [
            ...previous,
            ...items.filter((item) => !previous.some((r) => r.id === item.id)),
          ]
            .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
            .slice(0, 50)
            .map((r) => ({
              ...r,
              review: validReviewSummary(r.review) ? r.review : undefined,
            })),
        );
      })
      .catch(() => {
        /* The existing local summary log remains available. */
      });
    return () => {
      cancelled = true;
    };
  }, [loaded]);
  useEffect(() => {
    const hydrate = setTimeout(() => {
      try {
        const raw = localStorage.getItem('nav-academy-v7');
        if (raw) {
          const saved = JSON.parse(raw);
          setResults(
            Array.isArray(saved.results)
              ? saved.results
                  .filter(
                    (r: FlightResult) =>
                      r &&
                      typeof r.score === 'number' &&
                      typeof r.elapsed === 'number' &&
                      typeof r.stable === 'number' &&
                      typeof r.max === 'number' &&
                      typeof r.date === 'string' &&
                      typeof r.id === 'string' &&
                      MISSIONS.some((m) => m.id === r.mission),
                  )
                  .map((r: FlightResult) => ({
                    ...r,
                    review: validReviewSummary(r.review) ? r.review : undefined,
                  }))
                  .slice(0, 50)
              : [],
          );
          setQuizzes(
            Array.isArray(saved.quizzes)
              ? saved.quizzes
                  .filter(
                    (q: QuizResult) =>
                      q &&
                      typeof q.correct === 'number' &&
                      typeof q.total === 'number' &&
                      typeof q.date === 'string' &&
                      typeof q.id === 'string',
                  )
                  .slice(0, 50)
              : [],
          );
          setCompleted(
            Array.isArray(saved.completed)
              ? saved.completed.filter((id: string) =>
                  curriculum.lessons.some((l) => l.id === id),
                )
              : [],
          );
        }
      } catch {
        setStorageWarning(
          'Eski çalışma kaydı okunamadı. Yeni bir oturum açıldı.',
        );
      }
      setLoaded(true);
    }, 0);
    return () => clearTimeout(hydrate);
  }, []);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(
          'nav-academy-v7',
          JSON.stringify({ results, quizzes, completed }),
        );
      } catch {
        queueMicrotask(() =>
          setStorageWarning(
            'Tarayıcı kaydı kullanılamıyor; sonuçlar yalnız bu oturumda kalacak.',
          ),
        );
      }
  }, [results, quizzes, completed, loaded]);
  useEffect(() => {
    let last = performance.now();
    const tick = setInterval(() => {
      const now = performance.now(),
        wall = Math.min((now - last) / 1000, 0.5);
      last = now;
      const f = state.current;
      if (!f.running) return;
      const m = MISSIONS.find((x) => x.id === f.missionId);
      const next = { ...f };
      let remaining = wall * f.rate;
      while (remaining > 0.00001) {
        const dt = Math.min(remaining, 0.05);
        next.ac = stepAircraft(
          next.ac,
          next.bug,
          next.wind,
          dt,
          manual.current,
        );
        next.metrics = m
          ? evaluate(m, next.metrics, next.ac, next, dt)
          : { ...next.metrics, elapsed: next.metrics.elapsed + dt };
        captureFrame(recording.current, next, manual.current);
        remaining -= dt;
        if (m && (next.metrics.done || next.metrics.elapsed >= m.limit)) {
          finish(next);
          return;
        }
      }
      if (Math.floor(next.metrics.elapsed) !== Math.floor(f.metrics.elapsed))
        next.trail = [...f.trail, { lat: next.ac.lat, lon: next.ac.lon }].slice(
          -2400,
        );
      commit(next);
    }, 100);
    const suspend = () => {
      activePointer.current = null;
      manual.current = 0;
      if (state.current.running) {
        change({ running: false });
        setNotice(
          'Uçuş duraklatıldı. CRS ve seçili HDG korundu; hazır olduğunda devam et.',
        );
      }
    };
    const visibility = () => {
      if (document.hidden) suspend();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', suspend);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', suspend);
    };
  }, [commit, change, finish]);
  const loadMission = useCallback(
    (id = selected) => {
      if (restoring.current || finishing.current) return;
      const current = state.current;
      if (
        !abandoned.current &&
        current.missionId &&
        (current.running || current.metrics.elapsed > 0)
      ) {
        setNotice('Yeni görevden önce devam eden uçuşu bitir.');
        return;
      }
      if (!abandoned.current && current.missionId === id) return;
      abandoned.current = false;
      setOwnershipLost(false);
      lastCheckpoint.current = '';
      const m = MISSIONS.find((x) => x.id === id) ?? MISSIONS[0];
      manual.current = 0;
      activePointer.current = null;
      setControlEpoch((n) => n + 1);
      const ac = missionSpawn(m);
      const prepared: Flight = {
        ...initial(),
        ac,
        bug: ac.heading,
        wind: m.wind,
        nav1: 110,
        nav2: 110.5,
        courses: [335, 90],
        missionId: m.id,
        exam,
        rate: 1,
        trail: [ac],
      };
      sessionInfo.current = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        revision: 0,
      };
      setDraftStatus('Uçuş başlayınca ara kayıt alınacak.');
      recording.current = newRecording(prepared);
      commit(prepared);
      setSelected(m.id);
      setMobileView('cockpit');
      setStandby(['112.50', '108.80', '396.0']);
      setRecenter((r) => r + 1);
      setPane('flight');
      setNotice(
        'Görev hazır. Frekansları ve course’u ayarla, ardından Görevi başlat. Koşullar sağlandığında kendiliğinden tamamlanır.',
      );
    },
    [selected, exam, commit],
  );
  const toggleFlight = useCallback(() => {
    if (restoring.current || finishing.current) return;
    if (abandoned.current) {
      setNotice(
        'Bu uçuş başka sekmede devralındı. O sekmeyi kullan veya yeni bir görev seç.',
      );
      return;
    }
    if (
      !state.current.missionId &&
      pane === 'flight' &&
      mobileView === 'mission'
    ) {
      loadMission();
      return;
    }
    if (state.current.missionId && !sessionInfo.current)
      sessionInfo.current = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        revision: 0,
      };
    activePointer.current = null;
    manual.current = 0;
    if (pane !== 'flight') setMobileView('cockpit');
    setPane('flight');
    change({ running: !state.current.running });
    setNotice('');
  }, [pane, mobileView, loadMission, change]);
  useEffect(() => {
    const release = () => {
      activePointer.current = null;
      if (manual.current) {
        manual.current = 0;
        change({ bug: state.current.ac.heading });
      }
    };
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || pane !== 'flight') return;
      if (
        (e.target as HTMLElement)?.closest(
          'input,button,select,textarea,summary,a,[role="slider"],[role="tab"],[role="option"],[role="listbox"],[role="combobox"],[data-slot="select-content"],[contenteditable="true"]',
        )
      )
        return;
      if (e.repeat && e.code === 'Space') return;
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        manual.current = e.code === 'ArrowLeft' ? -1 : 1;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        toggleFlight();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') release();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [change, pane, toggleFlight]);
  const mission = MISSIONS.find((m) => m.id === flight.missionId) ?? null,
    preview = MISSIONS.find((m) => m.id === selected) ?? MISSIONS[0],
    brief = mission ?? preview;
  const nav1 = receiver(flight.ac, flight.nav1, 'NAV', flight.courses[0]),
    nav2 = receiver(flight.ac, flight.nav2, 'NAV', flight.courses[1]),
    adf = receiver(flight.ac, flight.adf, 'ADF');
  const receptions = { NAV1: nav1, NAV2: nav2, ADF: adf, OFF: null },
    nav = flight.source === 1 ? nav1 : nav2;
  const sample = mission ? measure(mission, flight.ac, flight) : null;
  const explanation =
    mission && !flight.exam ? explainFrame(mission, snapshot(flight)) : null;
  const missionLocked =
    !!mission &&
    !ownershipLost &&
    (flight.running || flight.metrics.elapsed > 0);
  const recoverableDrafts = drafts.filter(
    (d) => !results.some((r) => r.id === d.id),
  );
  const preparing = !mission && pane === 'flight' && mobileView === 'mission';
  const go = (id: string) => {
    activePointer.current = null;
    if (id !== 'flight') change({ running: false });
    manual.current = 0;
    setPane(id);
  };
  const setCourse = (value: number, source = flight.source) => {
    if (!Number.isFinite(value)) return;
    const courses: [number, number] = [...state.current.courses];
    courses[source - 1] = norm(value);
    change({ courses });
  };
  const setWind = (wind: Wind) => {
    const ac = {
      ...state.current.ac,
      ...velocity(state.current.ac.heading, state.current.ac.tas, wind),
    };
    change({ wind, ac });
  };
  const resetFree = () => {
    if (
      restoring.current ||
      finishing.current ||
      (!abandoned.current &&
        state.current.missionId &&
        state.current.metrics.elapsed > 0)
    )
      return;
    sessionInfo.current = null;
    abandoned.current = false;
    setOwnershipLost(false);
    lastCheckpoint.current = '';
    setDraftStatus('');
    recording.current = null;
    setControlEpoch((n) => n + 1);
    activePointer.current = null;
    setMobileView('cockpit');
    manual.current = 0;
    commit(initial());
    setPane('flight');
    setRecenter((r) => r + 1);
    setNotice(
      'Serbest uçuş sıfırlandı. Duraklatılmış haritaya tıklayarak uçağı yerleştirebilirsin.',
    );
  };
  const recoverDraft = async (id: string) => {
    if (
      restoring.current ||
      finishing.current ||
      state.current.missionId ||
      state.current.running
    )
      return;
    const original = state.current;
    restoring.current = true;
    setRecovering(true);
    try {
      const replacement = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
      };
      const draft = await retireDraft(id, 'resumed', replacement);
      if (!draft) {
        setNotice('Bu ara kayıt başka sekmede devralınmış veya kaldırılmış.');
        return;
      }
      if (state.current !== original) {
        setDrafts(await listDrafts());
        setNotice('Uçuş ayarları değişti; ara kayıt listede korundu.');
        return;
      }
      sessionInfo.current = { ...replacement, revision: 0 };
      recording.current = draft.recording;
      manual.current = 0;
      activePointer.current = null;
      commit({
        ...draft.flight,
        brg1: draft.flight.brg1 as BearingSource,
        brg2: draft.flight.brg2 as BearingSource,
      });
      setStandby(draft.standby);
      setSelected(draft.flight.missionId!);
      setExam(draft.flight.exam);
      setPane('flight');
      setMobileView('cockpit');
      setControlEpoch((n) => n + 1);
      setRecenter((n) => n + 1);
      setDrafts((items) => items.filter((d) => d.id !== id));
      setDraftStatus('Ara kayıt geri yüklendi · uçuş duraklatıldı');
      setNotice(
        'Konum, ayarlar ve görev ilerlemesi korundu. Hazır olduğunda Göreve devam et.',
      );
    } catch {
      setNotice('Ara kayıt açılamadı; mevcut uçuş değiştirilmedi.');
    } finally {
      restoring.current = false;
      setRecovering(false);
    }
  };
  const discardDraft = async (id: string) => {
    try {
      await retireDraft(id, 'discarded');
      setDrafts((items) => items.filter((d) => d.id !== id));
    } catch {
      setNotice('Ara kayıt kaldırılamadı.');
    }
  };
  const showLesson = (id: string) => {
    setLesson(id);
    go('learn');
  };
  const startQuiz = (topic: string) => {
    setQuizTopic(topic);
    setQuizKey((k) => k + 1);
    go('quiz');
  };
  const practiceMission = Object.entries(lessonForMission).find(
    ([, lessonId]) => lessonId === lesson,
  )?.[0];
  const practiceLesson = () => {
    // Opening a briefing never replaces an existing flight or its settings.
    if (!mission && practiceMission) setSelected(practiceMission);
    briefingRequested.current = !mission && !!practiceMission;
    activePointer.current = null;
    manual.current = 0;
    setMobileView(!mission && practiceMission ? 'mission' : 'cockpit');
    go('flight');
  };
  const openBriefing = () => {
    briefingRequested.current = true;
    activePointer.current = null;
    manual.current = 0;
    setMobileView('mission');
  };
  const swap = (index: number) => {
    const keys = ['nav1', 'nav2', 'adf'] as const;
    const key = keys[index],
      old = state.current[key];
    change({ [key]: Number(standby[index]) });
    setStandby((a) =>
      a.map((v, i) => (i === index ? old.toFixed(index === 2 ? 1 : 2) : v)),
    );
  };
  const hold = (direction: number) => {
    manual.current = direction;
  };
  const release = () => {
    const wasTurning = manual.current !== 0;
    activePointer.current = null;
    manual.current = 0;
    if (wasTurning) change({ bug: state.current.ac.heading });
  };
  const controlContext = `${pane}:${mobileView}:${controlEpoch}`;
  return (
    <div className="trainer-app">
      <a className="skip-link" href="#workspace">
        Çalışma alanına geç
      </a>
      <header className="app-header">
        <div className="brand">
          <div className="brand-symbol">
            <Compass size={27} />
          </div>
          <div>
            <strong>
              RADIO<span>LAB</span>
            </strong>
            <small>SEYRÜSEFER ATÖLYESİ</small>
          </div>
        </div>
        <nav className="app-navigation" aria-label="Ana gezinme">
          {panes.map((p) => (
            <Button
              variant="ghost"
              key={p.id}
              aria-current={pane === p.id ? 'page' : undefined}
              onClick={() => go(p.id)}
            >
              <p.icon size={20} />
              <span>{p.label}</span>
            </Button>
          ))}
        </nav>
        <div className="rail-progress">
          <GraduationCap size={19} />
          <div>
            <strong>{completed.length} / 8</strong>
            <span>Ders tamamlandı</span>
          </div>
          <div className="score-bar">
            <span style={{ width: `${(completed.length / 8) * 100}%` }} />
          </div>
        </div>
        <div className="header-status">
          <span className={flight.running ? 'live-dot' : 'paused-dot'} />
          {flight.running ? 'Uçuş devam ediyor' : 'Uçuş duraklatıldı'}
        </div>
        <span className="rail-disclaimer">Yalnız eğitim amaçlıdır.</span>
      </header>
      <div className="session-bar">
        <div className="session-identity">
          <div className="session-title">
            <span className="eyebrow">
              {pane === 'flight' ? 'UÇUŞ MASASI' : 'EĞİTİM MERKEZİ'}
            </span>
            <h1>
              {pane === 'flight'
                ? mission
                  ? mission.title
                  : preparing
                    ? preview.title
                    : 'Serbest uçuş'
                : panes.find((p) => p.id === pane)?.label}
            </h1>
          </div>
          <span className="flight-state">
            <i className={flight.running ? 'live-dot' : 'paused-dot'} />
            {mission
              ? flight.running
                ? 'Görev sürüyor'
                : flight.metrics.elapsed > 0
                  ? 'Görev duraklatıldı'
                  : 'Görev hazır'
              : preparing
                ? 'Görev hazırlığı'
                : 'Serbest uçuş'}
          </span>
          {mission && (
            <span className="mode-chip">
              {flight.exam ? 'SINAV' : 'REHBERLİ'}
            </span>
          )}
          <div className="session-subline">
            <span>
              {mission
                ? `Görev ${mission.level.slice(0, 2)}`
                : 'Serbest uçuşta kayıt / değerlendirme yapılmaz'}
            </span>
            <span
              className="selected-settings"
              aria-label="Seçili seyrüsefer ayarları"
            >
              NAV{flight.source} · CRS{' '}
              <b>{fmt(flight.courses[flight.source - 1])}°</b>
              <span>
                HDG <b>{fmt(flight.bug)}°</b>
              </span>
            </span>
          </div>
        </div>
        <div className="session-actions">
          <span className="clock">
            <Time seconds={flight.metrics.elapsed} />
          </span>
          <Choice
            label="Simülasyon hızı"
            value={String(flight.rate)}
            options={[1, 2, 4].map((v) => ({
              value: String(v),
              label: `${v}×`,
            }))}
            disabled={!!mission && flight.exam}
            onChange={(v) => change({ rate: Number(v) })}
          />
          <Button
            className="flight-toggle"
            variant={flight.running ? 'secondary' : 'default'}
            disabled={recovering || finalizing || ownershipLost}
            onClick={toggleFlight}
          >
            {flight.running ? <Pause /> : <Play />}
            {flight.running
              ? 'Duraklat'
              : mission
                ? flight.metrics.elapsed > 0
                  ? 'Göreve devam et'
                  : 'Görevi başlat'
                : preparing
                  ? 'Görevi hazırla'
                  : 'Serbest uçuşu başlat'}
          </Button>
          {mission ? (
            <Button
              disabled={ownershipLost || finalizing}
              variant="outline"
              onClick={() => finish(state.current)}
            >
              <Flag />
              Bitir ve değerlendir
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={resetFree}
              aria-label="Serbest uçuşu sıfırla"
            >
              <RotateCcw />
            </Button>
          )}
        </div>
      </div>
      {(notice || storageWarning) && (
        <output className="notice">
          <span>{storageWarning || notice}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNotice('');
              setStorageWarning('');
            }}
          >
            Kapat
          </Button>
        </output>
      )}
      {pane === 'flight' && (
        <Tabs
          className="compact-view-switch"
          value={mobileView}
          onValueChange={(v) => {
            activePointer.current = null;
            manual.current = 0;
            setMobileView(String(v));
          }}
          aria-label="Uçuş ekranı"
        >
          <TabsList>
            <TabsTrigger value="cockpit">
              <Compass size={17} />
              Kokpit
            </TabsTrigger>
            <TabsTrigger value="map">
              <MapPinned size={17} />
              Harita
            </TabsTrigger>
            <TabsTrigger value="mission">
              <Flag size={17} />
              Görevler
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {!mission && !finalizing && recoverableDrafts.length > 0 && (
        <section className="recovery-panel" aria-label="Yarım kalan uçuşlar">
          <b>Yarım kalan uçuşların var</b>
          <p>
            Ara kayıt aynı tarayıcıdadır; ani kapanışta son birkaç saniye eksik
            olabilir. Geri yüklenen uçuş duraklatılır. Başka sekmede açık olan
            aynı uçuş devralınır.
          </p>
          {recoverableDrafts.map((d) => (
            <div className="recovery-row" key={d.id}>
              <span>
                {MISSIONS.find((m) => m.id === d.flight.missionId)?.title} ·{' '}
                <Time seconds={d.flight.metrics.elapsed} /> ·{' '}
                {new Date(d.savedAt).toLocaleString('tr-TR')}
              </span>
              <Button
                disabled={recovering || flight.running}
                onClick={() => void recoverDraft(d.id)}
              >
                Duraklatılmış geri yükle
              </Button>
              <Button
                variant="ghost"
                disabled={recovering || flight.running}
                onClick={() => void discardDraft(d.id)}
              >
                Ara kaydı kaldır
              </Button>
            </div>
          ))}
        </section>
      )}
      {pane === 'flight' && mission && (
        <section
          className="mission-progress-strip"
          aria-label="Görev ilerlemesi"
        >
          <div>
            <b>{flight.exam ? 'Sınav uçuşu' : explanation?.title}</b>
            <p>
              {flight.exam
                ? 'Geri bildirim uçuşun sonunda açılacak. Görev koşulları sağlandığında otomatik sonlanır.'
                : explanation?.detail}
            </p>
          </div>
          {!flight.exam && (
            <div>
              <strong>
                {flight.metrics.stable.toFixed(1)} / {mission.duration} sn
              </strong>
              <small>Kesintisiz uygun takip · koşullar birlikte aranır</small>
            </div>
          )}
          <small className="draft-status">
            {draftStatus || 'Görev kaydı hazır'} · Yenilemeden önce ara kayıt
            durumunu kontrol et.
          </small>
        </section>
      )}
      <main
        id="workspace"
        tabIndex={-1}
        className="workspace"
        data-pane={pane}
        data-mobile-view={mobileView}
      >
        <aside className="training-sidebar">
          <div className="sidebar-heading">
            <span className="eyebrow">EĞİTİM ROTAN</span>
            <h2>
              {pane === 'learn'
                ? 'Adım adım öğren.'
                : pane === 'quiz'
                  ? 'Bilgiyi uygulamaya çevir.'
                  : 'Uçuş görevleri'}
            </h2>
            <p>
              {pane === 'learn'
                ? 'Öğren → test et → kokpitte uygula'
                : 'Görevi incele, ayarlarını yap, uç.'}
            </p>
          </div>
          <div className="sidebar-progress">
            <span>Okunan dersler</span>
            <b>{completed.length}/8</b>
            <div className="score-bar">
              <span style={{ width: `${(completed.length / 8) * 100}%` }} />
            </div>
          </div>
          {pane === 'learn' || pane === 'quiz' ? (
            <>
              <div className="lesson-list">
                {curriculum.lessons.map((l) => (
                  <button
                    key={l.id}
                    className={`lesson-link ${lesson === l.id && pane === 'learn' ? 'active' : ''}`}
                    onClick={() => showLesson(l.id)}
                  >
                    <span>
                      {completed.includes(l.id) ? (
                        <CheckCircle2 size={20} />
                      ) : (
                        l.order.toString().padStart(2, '0')
                      )}
                    </span>
                    <div>
                      <b>{l.title}</b>
                      <small>
                        Ders {String(l.order).padStart(2, '0')} ·{' '}
                        {l.durationMinutes} dk
                      </small>
                    </div>
                    <ArrowRight size={15} />
                  </button>
                ))}
              </div>
              <Button variant="outline" onClick={() => startQuiz('all')}>
                24 soruluk genel test <ArrowRight />
              </Button>
            </>
          ) : (
            <>
              <div className="mission-list">
                {MISSIONS.map((m) => (
                  <button
                    disabled={recovering || finalizing || missionLocked}
                    key={m.id}
                    className={`mission-link ${brief.id === m.id ? 'active' : ''}`}
                    onClick={() => {
                      loadMission(m.id);
                      briefingRequested.current = true;
                      setMobileView('mission');
                    }}
                  >
                    <span className="mission-index">
                      {results.some((r) => r.mission === m.id && r.passed) ? (
                        <CheckCircle2 size={20} />
                      ) : (
                        m.level.slice(0, 2)
                      )}
                    </span>
                    <div>
                      <b>{m.title}</b>
                      <small>
                        Görev {m.level.slice(0, 2)} · {Math.ceil(m.limit / 60)}{' '}
                        dk sınırı
                      </small>
                    </div>
                    <ArrowRight size={15} />
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                disabled={recovering || finalizing || missionLocked}
                onClick={resetFree}
              >
                <Compass />
                Serbest uçuş
              </Button>
            </>
          )}
          <div className="sidebar-note">
            <ShieldCheck size={19} />
            <p>
              Yalnız kişisel çalışma içindir. Operasyonel seyrüsefer veya
              sertifikalı uçuş eğitimi için kullanma.
            </p>
          </div>
        </aside>
        <section className="main-stage">
          {pane === 'flight' ? (
            <>
              <div className="flight-focus panel">
                <div className="section-heading">
                  <span className="eyebrow">
                    {mission ? 'SIRADAKİ ADIM' : 'KOKPİTE HOŞ GELDİN'}
                  </span>
                  <span className="tag">
                    {mission ? `Görev ${mission.level.slice(0, 2)}` : 'SERBEST'}
                  </span>
                </div>
                <h2>
                  {mission
                    ? flight.exam
                      ? 'Brifingi izle, göstergelerle uç.'
                      : !sample?.setup
                        ? 'Önce radyo ve CRS ayarları.'
                        : sample.good
                          ? 'Hedefte kal, takibi sürdür.'
                          : 'Hattı yakala, rüzgârı karşıla.'
                    : 'Bir rota seç. Göstergelerle uç.'}
                </h2>
                <p>
                  {mission
                    ? flight.exam
                      ? 'Anlık ipuçları kapalı. Sonuçların uçuş sonunda gösterilecek.'
                      : !sample?.setup
                        ? 'Standby frekansını gir, ↔ ile aktif yap. CDI kaynağını ve course’u brifinge göre ayarla.'
                        : 'CRS istenen yolu gösterir. Uçağın başını HDG ile kumanda et.'
                    : 'HDG uçağın başını, CRS göstergedeki seçili yolu ayarlar. Rehberli çalışmak için bir görev aç.'}
                </p>
                {mission && !flight.exam && (
                  <div className="focus-progress">
                    <div className="score-bar">
                      <span
                        style={{
                          width: `${Math.min(100, (flight.metrics.stable / mission.duration) * 100)}%`,
                        }}
                      />
                    </div>
                    <span>
                      Kararlı takip{' '}
                      <b>
                        {Math.floor(flight.metrics.stable)} / {mission.duration}{' '}
                        sn
                      </b>
                    </span>
                  </div>
                )}
                <Button variant="outline" onClick={openBriefing}>
                  <Flag size={16} />
                  {mission ? 'Görev brifingini aç' : 'Görev seç'}
                  <ArrowRight size={16} />
                </Button>
              </div>
              <div className="map-panel">
                <div className="panel-toolbar">
                  <div>
                    <MapPinned size={17} />
                    <b>
                      {mission && flight.exam
                        ? 'Alet uçuşu · harita kapalı'
                        : 'Seyrüsefer haritası'}
                    </b>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!!mission && flight.exam}
                    onClick={() => setRecenter((r) => r + 1)}
                    aria-label="Uçağa odaklan"
                  >
                    <Focus />
                  </Button>
                </div>
                <div className="map-frame">
                  {mission && flight.exam ? (
                    <div className="exam-map">
                      <ShieldCheck size={42} />
                      <h2>Şimdi göstergelere güven.</h2>
                      <p>
                        Sınav boyunca harita, yardım çizgileri ve anlık hata
                        ölçümleri gizli. Brifing ve radyo ayarları
                        kullanılabilir.
                      </p>
                      <span>
                        Gerçek uçuş verisi arka planda değerlendiriliyor.
                      </span>
                    </div>
                  ) : (
                    <TrainerMap
                      ac={flight.ac}
                      trail={flight.trail}
                      mission={mission ?? preview}
                      guide={guide && !!mission}
                      follow={follow}
                      recenter={recenter}
                      canPlace={!mission && !flight.running}
                      onPlace={(p) => {
                        change({
                          ac: { ...state.current.ac, ...p },
                          trail: [],
                        });
                        setNotice('Uçak yeni konuma yerleştirildi.');
                      }}
                    />
                  )}
                  <div className="map-legend">
                    <span>
                      <i className="legend-line" />
                      Uçuş izi
                    </span>
                    <span>
                      <i className="legend-dash" />
                      Eğitim hattı
                    </span>
                    <span>Kuzey yukarı · gerçek coğrafya</span>
                  </div>
                </div>
                <div className="map-footer">
                  <label htmlFor="map-follow">
                    <Switch
                      id="map-follow"
                      checked={follow}
                      onCheckedChange={setFollow}
                      disabled={!!mission && flight.exam}
                    />
                    Uçağı takip et
                  </label>
                  <label htmlFor="map-guide">
                    <Switch
                      id="map-guide"
                      checked={guide}
                      onCheckedChange={setGuide}
                      disabled={!!mission && flight.exam}
                    />
                    Yardım çizgileri
                  </label>
                </div>
              </div>
              <div className="briefing panel">
                <div className="section-heading">
                  <span className="eyebrow">
                    {mission ? 'AKTİF GÖREV' : 'GÖREV BRİFİNGİ'}
                  </span>
                  <span className="tag">{brief.level}</span>
                </div>
                <h2 id="mission-briefing" tabIndex={-1}>
                  {brief.title}
                </h2>
                <p>{brief.brief}</p>
                {brief.kind === 'fix' && (
                  <p className="fix-coordinates">
                    Hedef: IST R-090 / SBH R-{fmt(fixRadial2)}
                  </p>
                )}
                <ol className="brief-steps">
                  {brief.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <div className="target-box">
                  <Flag size={17} />
                  <div>
                    <b>Başarı koşulu</b>
                    <p>{brief.tolerance}</p>
                    <small>
                      Uygulama eğitim hedefi · resmî sınav standardı değil
                    </small>
                  </div>
                </div>
                <div className="brief-actions">
                  <label htmlFor="prepared-exam-toggle">
                    <Switch
                      id="prepared-exam-toggle"
                      checked={mission ? flight.exam : exam}
                      disabled={missionLocked}
                      onCheckedChange={(value) => {
                        setExam(value);
                        if (mission && !missionLocked) change({ exam: value });
                      }}
                    />
                    Sınav modu <small>Uçuş başladıktan sonra değişmez</small>
                  </label>
                </div>
                <p className="muted">
                  Koşullar kesintisiz sağlandığında görev kendiliğinden biter;
                  Bitir ve değerlendir düğmesi erken sonlandırmak içindir.
                </p>
                {mission && sample ? (
                  <div className="live-evaluation">
                    <div className="section-heading">
                      <b>
                        {flight.exam
                          ? flight.running
                            ? 'Sınav sürüyor'
                            : 'Sınav duraklatıldı'
                          : sample.good
                            ? 'Hedef toleransındasın'
                            : !sample.setup
                              ? 'Önce alıcı / kaynak / course ayarlarını doğrula'
                              : 'Hattı yakala ve kararlı takip et'}
                      </b>
                      <span>
                        <Time
                          seconds={Math.max(
                            0,
                            mission.limit - flight.metrics.elapsed,
                          )}
                        />{' '}
                        kaldı
                      </span>
                    </div>
                    {!flight.exam && (
                      <>
                        <div className="score-bar">
                          <span
                            style={{
                              width: `${Math.min(100, (flight.metrics.stable / mission.duration) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="live-metrics">
                          <span>
                            Kararlı{' '}
                            <b>
                              {Math.floor(flight.metrics.stable)}/
                              {mission.duration} sn
                            </b>
                          </span>
                          <span>
                            Sapma{' '}
                            <b>
                              {sample.error.toFixed(1)}
                              {sample.unit}
                            </b>
                          </span>
                          {mission.kind === 'arc' && (
                            <span>
                              Yay <b>{flight.metrics.arc.toFixed(1)}°/45°</b>
                            </span>
                          )}
                          {mission.kind === 'passage' && (
                            <span>
                              Geçiş{' '}
                              <b>
                                {
                                  ['Bekleniyor', 'TO', 'Üzerinde', 'FROM'][
                                    flight.metrics.phase
                                  ]
                                }
                              </b>
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="brief-actions">
                    <Button
                      disabled={recovering || finalizing}
                      onClick={() => loadMission()}
                    >
                      <Play />
                      Görevi hazırla
                    </Button>
                  </div>
                )}
                <div className="section-heading">
                  <span className="source-line">{brief.source}</span>
                  <Button
                    variant="link"
                    onClick={() => showLesson(lessonForMission[brief.id])}
                  >
                    İlgili ders <ArrowRight />
                  </Button>
                </div>
              </div>
              <details className="panel simulation-settings">
                <summary>
                  <WindIcon size={17} />
                  Rüzgâr ve uçuş ayarları
                </summary>
                <p>
                  HDG SEL seçtiğin manyetik başa yatışla döner; CRS yalnız
                  göstergeyi ayarlar. Sol/sağ tuşlarını basılı tutarak elle
                  dönüş yapabilirsin. Bırakınca mevcut baş seçilir.
                </p>
                <p>
                  Dokunmatik yatış düğmeleri Kokpit görünümünde, HSI’ın
                  altındadır.
                </p>
                <p className="muted">
                  Boşluk: başlat/duraklat · ←/→: yatış. Metin girişinde ve
                  slider kullanımında uçuş kısayolları devreye girmez.
                </p>
                {!mission ? (
                  <>
                    <AngleControl
                      key={`${controlContext}:wind-direction`}
                      label="Rüzgâr yönü (FROM · °M)"
                      value={flight.wind.from}
                      onChange={(v) => setWind({ ...flight.wind, from: v })}
                    />
                    <label className="control-label">
                      Rüzgâr şiddeti <b>{flight.wind.speed} kt</b>
                    </label>
                    <StableSlider
                      key={`${controlContext}:wind-speed`}
                      label="Rüzgâr şiddeti"
                      min={0}
                      max={40}
                      step={1}
                      value={flight.wind.speed}
                      onChange={(v) =>
                        setWind({
                          ...flight.wind,
                          speed: v,
                        })
                      }
                    />
                    <p className="muted">
                      Duraklatılmış haritaya tıklayarak uçağı yerleştir.
                    </p>
                  </>
                ) : (
                  <p className="muted">
                    Görevde rüzgâr ve başlangıç konumu kilitli.
                  </p>
                )}
                <div className="telemetry">
                  TRK {fmt(flight.ac.track)}°M · GS {flight.ac.gs.toFixed(0)} kt
                  · Rüzgâr {fmt(flight.wind.from)}°M / {flight.wind.speed} kt
                </div>
              </details>
            </>
          ) : pane === 'learn' ? (
            <Lesson
              id={lesson}
              completed={completed.includes(lesson)}
              onComplete={() =>
                setCompleted((a) => (a.includes(lesson) ? a : [...a, lesson]))
              }
              onQuiz={() => startQuiz(lesson)}
              onFlight={practiceLesson}
              flightLabel={
                mission
                  ? 'Mevcut uçuşa dön'
                  : practiceMission
                    ? 'İlgili görevi incele'
                    : 'Serbest uçuşa dön'
              }
            />
          ) : pane === 'quiz' ? null : pane === 'results' ? (
            <Debrief
              key={results[0]?.id ?? 'empty'}
              results={results}
              quizzes={quizzes}
              sessionRecordings={sessionRecordings}
              onRetry={(id) => {
                if (mission) {
                  setNotice('Yeni görevden önce mevcut görevi bitir.');
                  return;
                }
                loadMission(id);
              }}
            />
          ) : (
            <References />
          )}
          {/* Keep answers when a learner visits the lesson or cockpit. Only
              starting a new test changes the key and clears this session. */}
          <div hidden={pane !== 'quiz'} className="quiz-stage">
            <KnowledgeTest
              key={`${quizTopic}-${quizKey}`}
              topic={quizTopic}
              onFinish={(r) => setQuizzes((a) => [r, ...a].slice(0, 50))}
              onLesson={showLesson}
            />
          </div>
        </section>
        <aside className="instrument-column">
          <div className="instrument-panel">
            <div className="panel-toolbar">
              <div>
                <RadioTower size={17} />
                <b>HSI · Radyo seyrüsefer</b>
              </div>
              <span className="instrument-badge">
                VOR{flight.source} ·{' '}
                {nav?.valid ? nav.station.id : 'SİNYAL YOK'}
              </span>
            </div>
            <TrainerHSI
              hideGuidance={!!mission && flight.exam}
              ac={flight.ac}
              course={flight.courses[flight.source - 1]}
              bug={flight.bug}
              nav={nav}
              navIndex={flight.source}
              b1={receptions[flight.brg1 as BearingSource]}
              b2={receptions[flight.brg2 as BearingSource]}
              s1={flight.brg1 as BearingSource}
              s2={flight.brg2 as BearingSource}
            />
            <div className="hsi-sources">
              <div className="source-choice">
                BRG 1
                <Choice
                  label="Bearing 1 kaynağı"
                  value={flight.brg1}
                  options={choices}
                  onChange={(v) => change({ brg1: v })}
                />
              </div>
              <div className="source-choice">
                CDI
                <Choice
                  label="CDI kaynağı"
                  value={String(flight.source)}
                  options={[
                    { value: '1', label: 'NAV1' },
                    { value: '2', label: 'NAV2' },
                  ]}
                  onChange={(v) => change({ source: Number(v) })}
                />
              </div>
              <div className="source-choice">
                BRG 2
                <Choice
                  label="Bearing 2 kaynağı"
                  value={flight.brg2}
                  options={choices}
                  onChange={(v) => change({ brg2: v })}
                />
              </div>
            </div>
            <div className="instrument-controls">
              <AngleControl
                key={`${controlContext}:nav${flight.source}`}
                label={`CRS · NAV${flight.source}`}
                value={flight.courses[flight.source - 1]}
                onChange={(v) => setCourse(v, flight.source)}
                onSync={
                  flight.exam && mission
                    ? undefined
                    : () => {
                        if (nav?.valid) setCourse(nav.bearing);
                      }
                }
                syncLabel="TO merkezle"
                hint="İstenen yol. Rüzgâr düzeltmesi için bu değeri değil, HDG’yi değiştir."
              />
              <AngleControl
                key={`${controlContext}:hdg`}
                label="HDG · seçili baş"
                value={flight.bug}
                onChange={(v) => change({ bug: v })}
                onSync={() => change({ bug: flight.ac.heading })}
                syncLabel="Başla eşle"
                hint={`Uçulan baş ${fmt(flight.ac.heading)}° · Seçili başa dönüşü kumanda eder.`}
              />
            </div>
            <div className="touch-flight-controls">
              {[-1, 1].map((d) => (
                <Button
                  key={d}
                  variant="outline"
                  className="bank-button"
                  onPointerDown={(e) => {
                    if (
                      !e.isPrimary ||
                      e.button !== 0 ||
                      activePointer.current !== null
                    )
                      return;
                    activePointer.current = e.pointerId;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    hold(d);
                  }}
                  onPointerUp={(e) => {
                    if (activePointer.current === e.pointerId) release();
                  }}
                  onPointerCancel={(e) => {
                    if (activePointer.current === e.pointerId) {
                      activePointer.current = null;
                      manual.current = 0;
                    }
                  }}
                  onLostPointerCapture={(e) => {
                    if (activePointer.current === e.pointerId) {
                      activePointer.current = null;
                      manual.current = 0;
                    }
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      hold(d);
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') release();
                  }}
                  onBlur={() => {
                    // The other bank button may have received pointerdown
                    // before this button loses focus. Do not cancel its turn.
                    if (activePointer.current === null) manual.current = 0;
                  }}
                >
                  {d < 0 ? <ArrowLeft /> : <ArrowRight />}
                  {d < 0 ? 'Sola yatış' : 'Sağa yatış'}
                </Button>
              ))}
              <span>Basılı tut → dön · Bırak → başı koru</span>
            </div>
          </div>
          <div className="radio-stack">
            <div className="panel-toolbar">
              <b>Radyo ayarları</b>
              <span className="eyebrow">AKTİF ↔ STANDBY</span>
            </div>
            {['NAV1', 'NAV2', 'ADF'].map((name, i) => (
              <Radio
                key={name}
                name={name}
                active={[flight.nav1, flight.nav2, flight.adf][i]}
                standby={standby[i]}
                r={[nav1, nav2, adf][i]}
                onStandby={(v) =>
                  setStandby((a) => a.map((s, j) => (i === j ? v : s)))
                }
                onSwap={() => swap(i)}
              />
            ))}
          </div>
          <details className="instrument-help">
            <summary>İbreleri nasıl okuyacağım?</summary>
            <p>
              <span className="signal">Yeşil:</span> seçili NAV course ve CDI.
              NAV1 tek, NAV2 çift çizgi. Dört nokta course ile döner; merkezden
              her aralık 5° VOR sapmasıdır.
            </p>
            <p>
              <span className="cyan">Turkuaz:</span> BRG1 tek çizgi, BRG2 çift
              çizgi; uç istasyona, kuyruk ters yöne bakar. İbreler merkezdeki
              beyaz halkada kesilir.
            </p>
            <p>
              Manyetik baş üstte, cyan bug seçili başta, magenta elmas yer
              izindedir. Uçak simgesi sabit kalır.
            </p>
            <p>
              DME’ler burada istediğin gibi ilgili bearing altında. Bu,
              Garmin’in ayrı DME penceresinden bilinçli bir eğitim
              uyarlamasıdır.
            </p>
          </details>
        </aside>
      </main>
      <footer className="app-footer">
        <span>RADIO LAB · Görev kaydı ve kurtarma / 13</span>
        <span>Model: 120 KTAS · 4.200 ft sabit · 6°E senaryo varyasyonu</span>
        <button onClick={() => go('sources')}>
          Kaynaklar ve sınırlamalar <ArrowRight size={14} />
        </button>
      </footer>
    </div>
  );
}
