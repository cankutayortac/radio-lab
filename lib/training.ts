import {
  AIDS,
  bearing,
  destination,
  distance,
  norm,
  receiver,
  signed,
  spawn,
  velocity,
  type Aircraft,
  type Point,
  type Wind,
} from './navigation.ts';
import type { ReviewSummary } from './flight-review.ts';

export type Mission = {
  id: string;
  title: string;
  level: string;
  kind: 'inbound' | 'outbound' | 'wind' | 'adf' | 'arc' | 'fix' | 'passage';
  brief: string;
  steps: string[];
  tolerance: string;
  source: string;
  station: number;
  course: number;
  initialRadial: number;
  initialDistance: number;
  heading: number;
  wind: Wind;
  duration: number;
  limit: number;
  lesson: string;
};
export const MISSIONS: Mission[] = [
  {
    id: 'intercept',
    title: 'Radiali yakala',
    level: '01 · Temel',
    kind: 'inbound',
    brief:
      'IST R-180 hattına katıl ve 360° manyetik course ile istasyona inbound uç.',
    steps: [
      'NAV1 → 112.50 MHz. Aktif frekansı ve IST kimliğini doğrula.',
      'CDI kaynağı NAV1, CRS 000°. Önleme başını seç.',
      'CDI merkezine yaklaşırken dönüşü azalt; TO ile hattı koru.',
    ],
    tolerance: '±2.5° CDI ve ±8° track içinde kesintisiz 60 sn.',
    source: 'Efe PDF s.52–59 · IFR PDF s.63–65',
    station: 0,
    course: 0,
    initialRadial: 168,
    initialDistance: 15,
    heading: 335,
    wind: { from: 270, speed: 0 },
    duration: 60,
    limit: 720,
    lesson: 'vor-intercept',
  },
  {
    id: 'outbound',
    title: 'İstasyondan uzaklaş',
    level: '02 · Temel',
    kind: 'outbound',
    brief: 'IST R-090 üzerinde, 090° course ile outbound yol takibi yap.',
    steps: [
      'NAV1 112.50 MHz, CDI NAV1 ve CRS 090°.',
      'FROM bilgisini kontrol et. BRG oku arkaya bakabilir; bu normaldir.',
      'R-090 hattını yakala ve rüzgârsız ortamda takip et.',
    ],
    tolerance: '±2.5° CDI ve ±8° track içinde kesintisiz 60 sn.',
    source: 'Efe PDF s.49–51, 56–59 · IFR PDF s.63–65',
    station: 0,
    course: 90,
    initialRadial: 82,
    initialDistance: 7,
    heading: 110,
    wind: { from: 0, speed: 0 },
    duration: 60,
    limit: 720,
    lesson: 'vor-intercept',
  },
  {
    id: 'crosswind',
    title: 'Rüzgârı karşıla',
    level: '03 · Orta',
    kind: 'wind',
    brief:
      'Batıdan 20 kt rüzgâr altında IST R-180 hattını inbound takip et. Baş ile track aynı olmayacak.',
    steps: [
      'NAV1 112.50, CRS 000°, TO.',
      'Rüzgâra doğru baş düzeltmesi uygula. HDG baş seçer, course takip etmez.',
      'Yalnız ibreyi kovalamak yerine kararlı bir baş düzeltmesi bul.',
    ],
    tolerance: '±2.5° CDI ve ±4° track içinde kesintisiz 90 sn.',
    source: 'Efe PDF s.43–47, 58 · IFR PDF s.49–50, 66',
    station: 0,
    course: 0,
    initialRadial: 180,
    initialDistance: 15,
    heading: 0,
    wind: { from: 270, speed: 20 },
    duration: 90,
    limit: 720,
    lesson: 'ndb-wind',
  },
  {
    id: 'adf',
    title: 'ADF ile yol takibi',
    level: '04 · Orta',
    kind: 'adf',
    brief:
      'IS NDB’ye 090° manyetik yol üzerinde yaklaş. Homing yerine rüzgâr düzeltilmiş tracking uygula.',
    steps: [
      'ADF → 396 kHz, BRG1 → ADF. NDB kimliği IS.',
      'Kuzeyden 16 kt rüzgârı karşıla. İbreyi sürekli saat 12’de tutmak zorunda değilsin.',
      'Hedef QDM yaklaşık 090°; CRS ayarı ADF ibresini değiştirmez.',
    ],
    tolerance: 'Hedef hatta ±2.5°, track 090° ±4°; kesintisiz 60 sn.',
    source: 'Efe PDF s.39–42, 47–49 · IFR PDF s.45–47',
    station: 3,
    course: 90,
    initialRadial: 270,
    initialDistance: 12,
    heading: 90,
    wind: { from: 0, speed: 16 },
    duration: 60,
    limit: 720,
    lesson: 'ndb-wind',
  },
  {
    id: 'arc',
    title: '10 DME arkı',
    level: '05 · İleri',
    kind: 'arc',
    brief:
      'IST çevresinde R-180’den R-225 yönüne, artan radial yönünde 10 DME arkını uç.',
    steps: [
      'NAV1 112.50, CDI NAV1, CRS 270°, BRG1 NAV1. DME 10.0 NM civarında.',
      'Başlangıç başı 270°. İstasyon sağında, yaklaşık abeam kalır.',
      'Küçük baş değişiklikleri yap. 45° radial ilerlemesi boyunca mesafeyi koru.',
    ],
    tolerance: '9.5–10.5 DME içinde en az 45 sn ve 45° net radial ilerlemesi.',
    source: 'Efe PDF s.69–76 · IFR PDF s.103–108',
    station: 0,
    course: 270,
    initialRadial: 180,
    initialDistance: 9.98,
    heading: 270,
    wind: { from: 0, speed: 0 },
    duration: 45,
    limit: 900,
    lesson: 'dme-arc',
  },
  {
    id: 'fix',
    title: 'İki VOR ile fiks',
    level: '06 · İleri',
    kind: 'fix',
    brief:
      'IST R-090 / SBH kesişimini bul. Hedef IST’den 12 NM yatay uzaklıktaki eğitim fiksi.',
    steps: [
      'NAV1 → IST 112.50; NAV2 → SBH 108.80.',
      'BRG1 NAV1, BRG2 NAV2. Fiksin iki radialini brifing haritasında kontrol et.',
      'IST R-090 hattında hedef kesişime ulaş; harita kapalı sınavda yalnız göstergeleri kullan.',
    ],
    tolerance: 'Fiksin 0.6 NM çevresinde, iki alıcı doğru ayarlıyken 10 sn.',
    source: 'Efe PDF s.59–61 · IFR PDF s.67–70',
    station: 0,
    course: 90,
    initialRadial: 85,
    initialDistance: 6,
    heading: 100,
    wind: { from: 270, speed: 8 },
    duration: 10,
    limit: 720,
    lesson: 'dual-fix',
  },
  {
    id: 'passage',
    title: 'İstasyon geçişi',
    level: '07 · Temel',
    kind: 'passage',
    brief:
      'IST’ye güneyden yaklaş. İstasyon üzerinde sinyal belirsizliğini ve ardından FROM geçişini tanı.',
    steps: [
      'NAV1 112.50, CRS 000°; baş 000°.',
      'Geçişte CDI/BRG gizlenebilir; ibrenin ani hareketini kovalamadan başı koru.',
      'TO → istasyon üzeri → FROM sırasını tamamla. DME sıfıra düşmez.',
    ],
    tolerance: 'Doğru ayarla gerçek geçiş ve ardından ±2.5° hattı 5 sn koruma.',
    source: 'Efe PDF s.54, 63, 241–243 · IFR PDF s.46–47',
    station: 0,
    course: 0,
    initialRadial: 180,
    initialDistance: 1.8,
    heading: 0,
    wind: { from: 0, speed: 0 },
    duration: 5,
    limit: 300,
    lesson: 'dme',
  },
];
export const fixPoint = destination(AIDS[0], 96, 12);
export const fixRadial2 = norm(
  bearing(AIDS[1], fixPoint) - AIDS[1].declination,
);
export type Setup = {
  nav1: number;
  nav2: number;
  adf: number;
  source: number;
  courses: [number, number];
  brg1: string;
  brg2: string;
};
export type Metrics = {
  elapsed: number;
  stable: number;
  best: number;
  good: number;
  errorIntegral: number;
  samples: number;
  maxError: number;
  capture: number | null;
  arc: number;
  lastRadial: number | null;
  phase: number;
  done: boolean;
};
export const freshMetrics = (): Metrics => ({
  elapsed: 0,
  stable: 0,
  best: 0,
  good: 0,
  errorIntegral: 0,
  samples: 0,
  maxError: 0,
  capture: null,
  arc: 0,
  lastRadial: null,
  phase: 0,
  done: false,
});
export function missionSpawn(m: Mission) {
  const ac = spawn(
    AIDS[m.station],
    m.initialRadial,
    m.initialDistance,
    m.heading,
  );
  return { ...ac, ...velocity(ac.heading, ac.tas, m.wind) };
}
export function measure(m: Mission, ac: Aircraft, s: Setup) {
  const r = receiver(
    ac,
    m.kind === 'adf' ? s.adf : s.nav1,
    m.kind === 'adf' ? 'ADF' : 'NAV',
    s.courses[0],
  );
  const r2 = receiver(ac, s.nav2, 'NAV', s.courses[1]);
  const rightStation = r?.station.id === AIDS[m.station].id;
  const setup =
    !!rightStation &&
    (m.kind === 'adf'
      ? s.brg1 === 'ADF'
      : m.kind === 'arc'
        ? s.brg1 === 'NAV1'
        : m.kind === 'fix'
          ? r2?.station.id === 'SBH' && s.brg1 === 'NAV1' && s.brg2 === 'NAV2'
          : s.source === 1 && Math.abs(signed(s.courses[0] - m.course)) < 0.5);
  const radial = norm(
    bearing(AIDS[m.station], ac) - AIDS[m.station].declination,
  );
  const radialError = Math.abs(
    signed(radial - (m.kind === 'outbound' ? m.course : norm(m.course + 180))),
  );
  const trackError = Math.abs(signed(ac.track - m.course));
  let error = radialError,
    unit = '°',
    good = false;
  if (m.kind === 'arc') {
    error = Math.abs((r?.dme ?? 100) - 10);
    unit = 'NM';
    good = setup && !!r?.valid && error <= 0.5;
  } else if (m.kind === 'fix') {
    error = distance(ac, fixPoint);
    unit = 'NM';
    good = setup && !!r?.valid && !!r2?.valid && error <= 0.6;
  } else if (m.kind === 'passage') {
    error = Math.min(radialError, Math.abs(180 - radialError));
    good = setup && !!r?.valid && r.flag === 'FROM' && error <= 2.5;
  } else
    good =
      setup &&
      !!r?.valid &&
      radialError <= 2.5 &&
      trackError <= (m.kind === 'wind' || m.kind === 'adf' ? 4 : 8) &&
      (m.kind === 'adf' || r.flag === (m.kind === 'outbound' ? 'FROM' : 'TO'));
  return { r, setup, good, error, unit, trackError, radial };
}
export function evaluate(
  m: Mission,
  previous: Metrics,
  ac: Aircraft,
  s: Setup,
  dt: number,
): Metrics {
  if (previous.done) return previous;
  const sample = measure(m, ac, s),
    next = { ...previous, elapsed: previous.elapsed + dt };
  next.stable = sample.good ? previous.stable + dt : 0;
  next.best = Math.max(previous.best, next.stable);
  next.good += sample.good ? dt : 0;
  if (
    sample.setup &&
    sample.r?.valid &&
    (m.kind !== 'fix' || receiver(ac, s.nav2, 'NAV', s.courses[1])?.valid)
  ) {
    next.errorIntegral += sample.error * sample.error * dt;
    next.samples += dt;
    next.maxError = Math.max(next.maxError, sample.error);
  }
  if (sample.good && next.capture === null) next.capture = next.elapsed;
  if (m.kind === 'arc') {
    if (!sample.good) {
      next.arc = 0;
      next.lastRadial = null;
    } else {
      if (previous.lastRadial !== null)
        next.arc += signed(sample.radial - previous.lastRadial);
      next.lastRadial = sample.radial;
    }
  }
  if (m.kind === 'passage' && sample.setup) {
    if (next.phase === 0 && sample.r?.valid && sample.r.flag === 'TO')
      next.phase = 1;
    if (next.phase === 1 && sample.r?.overhead) next.phase = 2;
    if (next.phase === 2 && sample.r?.valid && sample.r.flag === 'FROM')
      next.phase = 3;
  }
  next.done =
    next.stable >= m.duration &&
    (m.kind !== 'arc' || next.arc >= 45) &&
    (m.kind !== 'passage' || next.phase === 3);
  return next;
}
export type FlightResult = {
  id: string;
  mission: string;
  date: string;
  passed: boolean;
  score: number;
  elapsed: number;
  rms: number | null;
  max: number;
  stable: number;
  exam: boolean;
  reason: string;
  review?: ReviewSummary;
};
export function grade(
  m: Mission,
  metrics: Metrics,
  exam: boolean,
): FlightResult {
  const rms =
    metrics.samples > 0
      ? Math.sqrt(metrics.errorIntegral / metrics.samples)
      : null;
  const normalized =
    (rms ?? 99) / (m.kind === 'arc' ? 0.5 : m.kind === 'fix' ? 0.6 : 2.5);
  const score = Math.round(
    Math.min(
      metrics.done ? 100 : 69,
      Math.max(
        0,
        (metrics.done ? 70 : 0) +
          20 * Math.min(1, metrics.best / m.duration) +
          10 * Math.max(0, 1 - normalized / 4),
      ),
    ),
  );
  return {
    id: crypto.randomUUID(),
    mission: m.id,
    date: new Date().toISOString(),
    passed: metrics.done,
    score,
    elapsed: metrics.elapsed,
    rms,
    max: metrics.maxError,
    stable: metrics.best,
    exam,
    reason: metrics.done
      ? 'Hedef toleransı ve süre koşulu tamamlandı.'
      : metrics.elapsed >= m.limit
        ? 'Süre doldu; görev koşulları tamamlanmadı.'
        : 'Uçuş erken bitirildi; görev koşulları tamamlanmadı.',
  };
}
export type FlightSample = Point & { t: number; error: number };
