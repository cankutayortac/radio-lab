import {
  AIDS,
  fmt,
  receiver,
  signed,
  type Aircraft,
  type Wind,
} from './navigation.ts';
import {
  measure,
  MISSIONS,
  type FlightResult,
  type Metrics,
  type Mission,
  type Setup,
} from './training.ts';

export type RecordableFlight = Setup & {
  ac: Aircraft;
  bug: number;
  wind: Wind;
  running: boolean;
  metrics: Metrics;
  missionId: string | null;
  exam: boolean;
};
export type ReplayFrame = Setup & {
  t: number;
  ac: Aircraft;
  bug: number;
  wind: Wind;
  running: boolean;
  stable: number;
  arc: number;
  phase: number;
  manual: number;
};
export type FlightRecording = {
  version: 1;
  model: 'lateral-v1';
  id: string;
  mission: string;
  date: string;
  exam: boolean;
  frames: ReplayFrame[];
  truncated: boolean;
};
export type RecordingBuffer = {
  mission: string;
  frames: ReplayFrame[];
  truncated: boolean;
};
export type ReviewSummary = {
  version: 1;
  headline: string;
  nextStep: string;
  facts: string[];
};
export type Explanation = {
  code: string;
  category: 'setup' | 'signal' | 'flight' | 'success' | 'information';
  title: string;
  detail: string;
  advice: string;
  assessable: boolean;
  within: boolean;
};
export type ReviewEvent = {
  frame: number;
  t: number;
  code: string;
  kind: 'control' | 'flight';
  title: string;
  detail: string;
};
export const FRAME_INTERVAL = 0.25;
export const MAX_FRAMES = 12000;

export function snapshot(f: RecordableFlight, manual = 0): ReplayFrame {
  return {
    t: f.metrics.elapsed,
    ac: { ...f.ac },
    bug: f.bug,
    wind: { ...f.wind },
    nav1: f.nav1,
    nav2: f.nav2,
    adf: f.adf,
    source: f.source,
    courses: [...f.courses],
    brg1: f.brg1,
    brg2: f.brg2,
    running: f.running,
    stable: f.metrics.stable,
    arc: f.metrics.arc,
    phase: f.metrics.phase,
    manual,
  };
}
export function newRecording(f: RecordableFlight): RecordingBuffer {
  return {
    mission: f.missionId ?? '',
    frames: [snapshot(f)],
    truncated: false,
  };
}
function controlsChanged(a: ReplayFrame, f: RecordableFlight, manual: number) {
  return (
    a.bug !== f.bug ||
    a.nav1 !== f.nav1 ||
    a.nav2 !== f.nav2 ||
    a.adf !== f.adf ||
    a.source !== f.source ||
    a.courses[0] !== f.courses[0] ||
    a.courses[1] !== f.courses[1] ||
    a.brg1 !== f.brg1 ||
    a.brg2 !== f.brg2 ||
    a.running !== f.running ||
    a.wind.from !== f.wind.from ||
    a.wind.speed !== f.wind.speed ||
    a.manual !== manual
  );
}
export function captureFrame(
  buffer: RecordingBuffer | null,
  f: RecordableFlight,
  manual = 0,
  force = false,
) {
  if (!buffer || buffer.mission !== f.missionId) return;
  const last = buffer.frames.at(-1);
  if (last && f.metrics.elapsed < last.t) return;
  const changed =
    !last || controlsChanged(last, f, manual) || last.phase !== f.metrics.phase;
  if (
    !force &&
    !changed &&
    last &&
    f.metrics.elapsed - last.t < FRAME_INTERVAL - 1e-8
  )
    return;
  const frame = snapshot(f, manual);
  if (buffer.frames.length >= MAX_FRAMES) {
    // Preserve the early history and the exact terminal state, explicitly mark the gap.
    buffer.frames[MAX_FRAMES - 1] = frame;
    buffer.truncated = true;
  } else buffer.frames.push(frame);
}
export function finishRecording(
  buffer: RecordingBuffer,
  result: FlightResult,
): FlightRecording {
  return {
    version: 1,
    model: 'lateral-v1',
    id: result.id,
    mission: result.mission,
    date: result.date,
    exam: result.exam,
    truncated: buffer.truncated,
    frames: buffer.frames.map((f) => ({
      ...f,
      ac: { ...f.ac },
      wind: { ...f.wind },
      courses: [...f.courses],
    })),
  };
}
// Discrete snapshots: never interpolate receiver/source settings into the past.
export function frameAtTime(frames: ReplayFrame[], time: number) {
  let low = 0,
    high = frames.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (frames[mid].t <= time) low = mid;
    else high = mid - 1;
  }
  return low;
}
export function frameReceivers(f: ReplayFrame) {
  return {
    NAV1: receiver(f.ac, f.nav1, 'NAV', f.courses[0]),
    NAV2: receiver(f.ac, f.nav2, 'NAV', f.courses[1]),
    ADF: receiver(f.ac, f.adf, 'ADF'),
    OFF: null,
  };
}
export function explainFrame(m: Mission, f: ReplayFrame): Explanation {
  const s = measure(m, f.ac, f),
    all = frameReceivers(f);
  const r = m.kind === 'adf' ? all.ADF : all.NAV1;
  const expected = AIDS[m.station];
  const answer = (
    code: string,
    category: Explanation['category'],
    title: string,
    detail: string,
    advice: string,
    assessable = false,
    within = false,
  ): Explanation => ({
    code,
    category,
    title,
    detail,
    advice,
    assessable,
    within,
  });
  if (r?.station.id !== expected.id)
    return answer(
      'receiver',
      'setup',
      'Görev istasyonu ayarlı değil',
      `${m.kind === 'adf' ? 'ADF' : 'NAV1'} ${m.kind === 'adf' ? f.adf.toFixed(1) : f.nav1.toFixed(2)}: ${r?.station.id ?? 'eşleşen eğitim istasyonu yok'}. Beklenen istasyon ${expected.id}.`,
      `Önce ${expected.freq} ${m.kind === 'adf' ? 'kHz' : 'MHz'} frekansını aktif yap ve ${expected.id} kimliğini doğrula.`,
    );
  if (m.kind === 'fix' && all.NAV2?.station.id !== 'SBH')
    return answer(
      'receiver2',
      'setup',
      'İkinci VOR ayarı eksik',
      `NAV2 ${f.nav2.toFixed(2)} MHz; SBH seçili değil. Tek alıcı bu görevin koşulunu tamamlamaz.`,
      'NAV2’ye 108.80 MHz aktar; SBH kimliğini ve BRG2 kaynağını doğrula.',
    );
  if (!s.setup) {
    if (m.kind === 'adf')
      return answer(
        'bearing-adf',
        'setup',
        'ADF ibresi seçili değil',
        `BRG1 kaynağı ${f.brg1}. Bu görev BRG1 üzerinde ADF ister; CRS veya CDI seçimi NDB ibresini yönetmez.`,
        'BRG1 kaynağını ADF yap.',
      );
    if (m.kind === 'arc' || m.kind === 'fix')
      return answer(
        'bearing-nav',
        'setup',
        'Bearing kaynaklarını doğrula',
        `BRG1 ${f.brg1}, BRG2 ${f.brg2}. ${m.kind === 'fix' ? 'İki bağımsız VOR ibresi gerekli.' : 'Yay görevi istasyonu BRG1 ile takip eder.'}`,
        m.kind === 'fix'
          ? 'BRG1 NAV1 ve BRG2 NAV2 olmalı.'
          : 'BRG1 kaynağını NAV1 yap.',
      );
    if (f.source !== 1)
      return answer(
        'cdi-source',
        'setup',
        'CDI farklı alıcıyı gösteriyor',
        `HSI’da NAV${f.source} seçili; bu görev NAV1 üzerinden değerlendirilir.`,
        'CDI kaynağını NAV1 seç.',
      );
    return answer(
      'course',
      'setup',
      'Seçili course görevle eşleşmiyor',
      `NAV1 CRS ${fmt(f.courses[0])}°; istenen yol ${fmt(m.course)}°. ${Math.abs(Math.abs(signed(f.courses[0] - m.course)) - 180) < 0.5 ? 'Karşılıklı course aynı çizgi üzerinde farklı TO/FROM ve CDI işareti verebilir.' : 'CRS değişikliği uçağı döndürmez.'}`,
      `CRS’yi ${fmt(m.course)}° ayarla; baş düzeltmesini HDG ile yap.`,
    );
  }
  const invalid = !r.valid
    ? r
    : m.kind === 'fix' && !all.NAV2?.valid
      ? all.NAV2
      : null;
  if (invalid) {
    const overhead = invalid.overhead;
    return answer(
      overhead ? 'overhead' : 'signal',
      'signal',
      overhead
        ? 'İstasyon üzeri: yön bilgisi belirsiz'
        : 'Sinyal kullanılamıyor',
      `${invalid.station.id}: ${overhead ? `Senaryonun istasyon üzeri belirsizlik alanındasın; ${m.kind === 'adf' ? 'ADF bearing' : 'ilgili VOR’un CDI/bearing bilgisi'} bu yüzden gizlenir.` : 'İstasyon menzilinin dışındasın.'} Bu aralık takip hatası diye yorumlanmaz.${m.kind === 'passage' && overhead ? ` Geçiş fazı ${f.phase}/3; DME ${invalid.dme?.toFixed(2) ?? '—'} NM.` : ''}`,
      overhead
        ? 'İbrenin kaybolmasını hattı kaçırmakla karıştırma; geçişten sonraki bilgiyi birlikte incele.'
        : 'Önce alım koşullarını doğrula; geçerli sinyal olmadan ibreye dayalı karar verme.',
    );
  }
  if (
    m.kind !== 'adf' &&
    ['inbound', 'outbound', 'wind', 'passage'].includes(m.kind) &&
    r.flag === 'OFF'
  )
    return answer(
      'flag-off',
      'signal',
      'TO/FROM sınırındasın',
      'Alıcı sinyali var; bu geometride TO/FROM yön bilgisi OFF. Bu an için yön yorumu yapılmaz.',
      'İstasyon, seçili course ve uçağın konumunu birlikte incele.',
    );
  if (m.kind === 'arc') {
    const dme = r.dme!;
    if (!s.good)
      return answer(
        dme > 10.5 ? 'arc-wide' : 'arc-tight',
        'flight',
        'DME yayı toleransının dışındasın',
        `DME ${dme.toFixed(2)} NM; hedef 9.5–10.5 NM. Bu aralık kararlı süreyi ve geçerli yay ilerlemesini keser.`,
        'Bearing ve mesafeyi birlikte izle; 10 DME çevresinde küçük baş düzeltmeleriyle yeniden bir yay kur.',
        true,
      );
    if (f.arc < -0.5)
      return answer(
        'arc-reverse',
        'flight',
        'Yay ilerlemesi ters yönde',
        `Mesafe uygun; net radyal ilerlemesi ${f.arc.toFixed(1)}°. Görev artan radyal yönünde +45° ister.`,
        'R-180’den R-225 yönüne ilerleme koşulunu kontrol et; yalnız mesafede kalmak yetmez.',
        true,
        true,
      );
    return answer(
      'arc-progress',
      'success',
      'Yay mesafesi uygun',
      `DME ${dme.toFixed(2)} NM; kesintisiz ${f.stable.toFixed(1)}/45 sn ve ${f.arc.toFixed(1)}/45° net radyal ilerlemesi. İki koşul birlikte gerekir.`,
      'Mesafeyi korurken artan radyal yönündeki ilerlemeyi sürdür.',
      true,
      true,
    );
  }
  if (m.kind === 'fix') {
    return answer(
      s.good ? 'fix-hold' : 'fix-range',
      s.good ? 'success' : 'flight',
      s.good ? 'Fiks toleransındasın' : 'Kesişime henüz ulaşmadın',
      `İki alıcı geçerli. Fikse yatay uzaklık ${s.error.toFixed(2)} NM; hedef ≤0.60 NM, 10 sn. IST R-${fmt(r.radial)}, SBH R-${fmt(all.NAV2!.radial)}. DME ile yatay mesafe aynı ölçü değildir.`,
      'İki bearing/radyali birlikte doğrula; yalnız tek VOR’un DME değerine göre fiksi tamamlanmış sayma.',
      true,
      s.good,
    );
  }
  if (m.kind === 'passage') {
    if (f.phase < 3)
      return answer(
        'passage-sequence',
        'information',
        'İstasyon geçiş sırasını izle',
        `Kayıtlı faz ${f.phase}/3; NAV1 ${r.flag}. Görev doğru ayarlarla TO → istasyon üzeri → FROM sırasını ister. Başlangıçta FROM görmek, geçiş yapıldığı anlamına gelmez.`,
        'Geçişi tek bir ibre karesiyle değil, önceki ve sonraki karelerle değerlendir.',
        true,
      );
    if (r.flag !== 'FROM')
      return answer(
        'passage-branch',
        'flight',
        'Çıkış tarafında değilsin',
        `Önceki geçiş kaydedilmiş olsa da bu karede NAV1 ${r.flag} gösteriyor. CDI merkezde olabilir; görev artık FROM tarafındaki çıkış hattını ister.`,
        'Geçmiş geçiş fazını güncel TO/FROM bilgisiyle birlikte kontrol et.',
        true,
      );
    return answer(
      s.good ? 'passage-hold' : 'passage-line',
      s.good ? 'success' : 'flight',
      s.good
        ? 'Geçiş doğrulandı; çıkış hattını koru'
        : 'Geçiş sonrası hattın dışındasın',
      `TO → üzeri → FROM sırası kaydedildi. Hat sapması ${s.error.toFixed(1)}°; çıkışta ±2.5° içinde ${f.stable.toFixed(1)}/5 sn.`,
      'FROM bilgisini ve çıkış hattını birlikte izle; geçiş anındaki kayıp yön bilgisini takip hatası sayma.',
      true,
      s.good,
    );
  }
  if (m.kind !== 'adf' && r.flag !== (m.kind === 'outbound' ? 'FROM' : 'TO'))
    return answer(
      'branch',
      'flight',
      'İstenen TO/FROM kolunda değilsin',
      `CRS ${fmt(f.courses[0])}° doğru ayarlı; alıcı ${r.flag} gösteriyor. Görev ${m.kind === 'outbound' ? 'FROM' : 'TO'} ister. CDI merkezde olsa bile doğru istasyon kolunda olmayabilirsin.`,
      'Haritada istasyonun hangi tarafında olduğunu seçili course ve TO/FROM ile eşleştir; yalnız CDI merkezine bakma.',
      true,
    );
  const drift = signed(f.ac.track - f.ac.heading);
  const windText = `Baş ${fmt(f.ac.heading)}°, yer izi ${fmt(f.ac.track)}°; aralarındaki fark ${drift.toFixed(1)}°. Rüzgâr ${fmt(f.wind.from)}° / ${f.wind.speed} kt.`;
  if (s.error > 2.5)
    return answer(
      m.kind === 'adf' ? 'adf-line' : 'radial-line',
      'flight',
      'Hedef radyal hattının dışındasın',
      `Hedef hat sapması ${s.error.toFixed(1)}°; tolerans ±2.5°. ${m.kind === 'adf' ? `ADF manyetik bearing ${fmt(r.bearing)}°. NDB için CDI veya TO/FROM değerlendirmesi yok.` : `NAV1 CDI ${r.error.toFixed(1)}° (${r.flag}); CDI işareti course eksenine göredir, doğrudan ekranın solu/sağı değildir.`}`,
      m.kind === 'adf'
        ? 'İbreyi sürekli buruna getirmek yerine hedef yol ve rüzgâr düzeltmesini birlikte takip et.'
        : 'Önleme başı ile hattı yakala; merkezine yaklaşırken baş düzeltmesini küçült. CRS istenen yol olarak kalmalı.',
      true,
    );
  if (!s.good)
    return answer(
      m.kind === 'adf'
        ? 'adf-track'
        : m.kind === 'wind'
          ? 'wind-track'
          : 'track',
      'flight',
      'Hattın içindesin; yer izi henüz uygun değil',
      `${windText} Hedef yer izi ${fmt(m.course)}° ±${m.kind === 'wind' || m.kind === 'adf' ? 4 : 8}°. Seçili HDG ile gerçek başın dönüş sırasında farklı olması normaldir.`,
      m.kind === 'adf'
        ? 'Homing yerine rüzgâr düzeltilmiş yol takibi kur; ADF ibresinin burundan farklı yerde kalması normal olabilir.'
        : 'Rüzgâr düzeltmesini HDG ile kur; CRS’yi değiştirerek baş–yer izi farkını düzeltmeye çalışma.',
      true,
    );
  return answer(
    m.kind === 'adf' ? 'adf-stable' : 'stable',
    'success',
    'Görev toleransları içinde takip',
    `${windText} Hedef hat ve yer izi koşulları sağlanıyor; kesintisiz ${f.stable.toFixed(1)}/${m.duration} sn.${m.kind === 'outbound' ? ' Bearing okunun geriyi göstermesi outbound uçuşta normaldir.' : ''}`,
    'Kararlı takibi sürdür; gereksiz büyük düzeltmelerle yeni bir sapma oluşturma.',
    true,
    true,
  );
}

export function recordingEvents(record: FlightRecording): ReviewEvent[] {
  const m = MISSIONS.find((m) => m.id === record.mission)!;
  const events: ReviewEvent[] = [];
  let lastCode = '';
  const add = (
    f: ReplayFrame,
    frame: number,
    code: string,
    kind: ReviewEvent['kind'],
    title: string,
    detail: string,
  ) => {
    events.push({ frame, t: f.t, code, kind, title, detail });
  };
  record.frames.forEach((f, i) => {
    const prev = record.frames[i - 1];
    if (prev) {
      const changes: [string, string, string, string][] = [
        [
          'nav1',
          'NAV1 aktif frekansı',
          prev.nav1.toFixed(2),
          f.nav1.toFixed(2),
        ],
        [
          'nav2',
          'NAV2 aktif frekansı',
          prev.nav2.toFixed(2),
          f.nav2.toFixed(2),
        ],
        ['adf', 'ADF aktif frekansı', prev.adf.toFixed(1), f.adf.toFixed(1)],
        ['source', 'CDI kaynağı', `NAV${prev.source}`, `NAV${f.source}`],
        ['brg1', 'BRG1 kaynağı', prev.brg1, f.brg1],
        ['brg2', 'BRG2 kaynağı', prev.brg2, f.brg2],
        [
          'crs1',
          'NAV1 CRS',
          `${fmt(prev.courses[0])}°`,
          `${fmt(f.courses[0])}°`,
        ],
        [
          'crs2',
          'NAV2 CRS',
          `${fmt(prev.courses[1])}°`,
          `${fmt(f.courses[1])}°`,
        ],
        ['hdg', 'Seçili HDG', `${fmt(prev.bug)}°`, `${fmt(f.bug)}°`],
        [
          'run',
          'Uçuş durumu',
          prev.running ? 'Uçuşta' : 'Duraklatıldı',
          f.running ? 'Uçuşta' : 'Duraklatıldı',
        ],
        ['manual', 'Elle yatış', String(prev.manual), String(f.manual)],
      ];
      for (const [code, title, before, after] of changes)
        if (before !== after) {
          const suffix = code.startsWith('crs')
            ? ' CRS uçağı döndürmez; seçili yolu değiştirir.'
            : '';
          add(f, i, code, 'control', title, `${before} → ${after}.${suffix}`);
        }
    }
    const e = explainFrame(m, f);
    if (e.code !== lastCode) {
      add(f, i, e.code, 'flight', e.title, e.detail);
      lastCode = e.code;
    }
    if (prev && prev.phase !== f.phase)
      add(
        f,
        i,
        'phase',
        'flight',
        'Geçiş fazı değişti',
        `Faz ${prev.phase} → ${f.phase}: ${['Bekleniyor', 'TO görüldü', 'İstasyon üzeri', 'FROM görüldü'][f.phase]}.`,
      );
  });
  return events;
}
export function summarizeRecording(
  record: FlightRecording,
  result: FlightResult,
): ReviewSummary {
  const m = MISSIONS.find((m) => m.id === record.mission)!;
  const durations = new Map<
    string,
    { seconds: number; explanation: Explanation }
  >();
  let setupSeconds = 0,
    signalSeconds = 0,
    assessed = 0,
    worst: { f: ReplayFrame; e: Explanation } | null = null;
  for (let i = 0; i < record.frames.length; i++) {
    const f = record.frames[i],
      e = explainFrame(m, f);
    const span = Math.max(0, (record.frames[i + 1]?.t ?? f.t) - f.t);
    const dt = f.running && !(record.truncated && span > 1) ? span : 0;
    if (e.category === 'setup') setupSeconds += dt;
    if (e.category === 'signal') signalSeconds += dt;
    if (e.assessable) assessed += dt;
    if (dt > 0 && (e.category === 'flight' || e.category === 'setup')) {
      const d = durations.get(e.code) ?? { seconds: 0, explanation: e };
      d.seconds += dt;
      durations.set(e.code, d);
    }
    if (
      dt > 0 &&
      e.assessable &&
      (!worst ||
        measure(m, f.ac, f).error > measure(m, worst.f.ac, worst.f).error)
    )
      worst = { f, e };
  }
  const dominant = [...durations.values()].sort(
    (a, b) => b.seconds - a.seconds,
  )[0];
  const final = record.frames.at(-1)!;
  const taskFact: Record<Mission['kind'], string> = {
    inbound:
      'Bu görevde doğru kol TO ve hedef yol 000°; merkezlenmiş CDI tek başına yeterli değildir.',
    outbound:
      'Bu görevde doğru kol FROM ve hedef radyal R-090; bearing ibresinin geriye bakması normaldir.',
    wind: 'Rüzgâr görevi başı değil yer izini değerlendirir. CRS 000° kalırken HDG ile rüzgâr düzeltmesi yapılır.',
    adf: 'ADF görevinde BRG1 ve NDB yolu değerlendirilir; CRS/CDI, TO/FROM veya DME NDB başarı ölçütü değildir.',
    arc: `Son geçerli yay bölümünde ${final.arc.toFixed(1)}° net ilerleme kaydedildi; hedef +45° ve kesintisiz 45 sn birlikte aranır.`,
    fix: 'Fiks değerlendirmesi iki doğru/geçerli alıcıya ve fiksin 0.60 NM çevresinde 10 sn kalmaya dayanır.',
    passage: `Geçiş sırası ${final.phase}/3 faza ulaştı. İstasyon üzerindeki sinyal belirsizliği takip hatası sayılmaz.`,
  };
  return {
    version: 1,
    headline: result.passed
      ? 'Görev koşullarını tamamladın.'
      : final.t <= 0
        ? 'Uçuş henüz başlamadan sonlandırıldı.'
        : dominant
          ? dominant.explanation.title
          : 'Görevin süre veya ilerleme koşulu tamamlanmadı.',
    nextStep: result.passed
      ? `En uzun kararlı bölüm ${result.stable.toFixed(1)} sn. Tekrarda bu bölümün öncesindeki ayar ve baş değişikliklerini inceleyerek aynı takibi yeniden kur.`
      : (dominant?.explanation.advice ?? explainFrame(m, final).advice),
    facts: [
      `Ayar nedeniyle değerlendirilemeyen yaklaşık ${setupSeconds.toFixed(1)} sn; sinyal/yön belirsizliği ${signalSeconds.toFixed(1)} sn. Geçerli değerlendirme aralığı ${assessed.toFixed(1)} sn.`,
      taskFact[m.kind],
      ...(worst
        ? [
            `İncelenecek an: ${Math.floor(worst.f.t / 60)
              .toString()
              .padStart(2, '0')}:${Math.floor(worst.f.t % 60)
              .toString()
              .padStart(2, '0')} — ${worst.e.title}.`,
          ]
        : [
            'Doğru ayar ve geçerli sinyalle değerlendirme yapılabilecek takip kaydı yok.',
          ]),
      ...(record.truncated
        ? [
            'Kayıt sınırına ulaşıldı; son kareye kadar olan kayıt aralığında boşluk var. Süre analizi yaklaşık kabul edilmelidir.',
          ]
        : []),
    ],
  };
}

export function validReviewSummary(value: unknown): value is ReviewSummary {
  const x = value as ReviewSummary | undefined;
  return (
    !!x &&
    x.version === 1 &&
    typeof x.headline === 'string' &&
    x.headline.length <= 800 &&
    typeof x.nextStep === 'string' &&
    x.nextStep.length <= 1200 &&
    Array.isArray(x.facts) &&
    x.facts.length <= 8 &&
    x.facts.every((f) => typeof f === 'string' && f.length <= 1200)
  );
}
export function validRecording(value: unknown): value is FlightRecording {
  const r = value as FlightRecording | undefined;
  if (
    !r ||
    r.version !== 1 ||
    r.model !== 'lateral-v1' ||
    !MISSIONS.some((m) => m.id === r.mission) ||
    typeof r.id !== 'string' ||
    r.id.length > 100 ||
    typeof r.date !== 'string' ||
    !Number.isFinite(Date.parse(r.date)) ||
    typeof r.exam !== 'boolean' ||
    typeof r.truncated !== 'boolean' ||
    !Array.isArray(r.frames) ||
    !r.frames.length ||
    r.frames.length > MAX_FRAMES
  )
    return false;
  const sources = ['NAV1', 'NAV2', 'ADF', 'OFF'];
  return Array.from(r.frames).every(
    (f, i) =>
      f &&
      f.ac &&
      f.wind &&
      Array.isArray(f.courses) &&
      f.courses.length === 2 &&
      [
        f.t,
        f.bug,
        f.nav1,
        f.nav2,
        f.adf,
        ...f.courses,
        f.ac.lat,
        f.ac.lon,
        f.ac.heading,
        f.ac.track,
        f.ac.bank,
        f.ac.tas,
        f.ac.gs,
        f.ac.altitude,
        f.wind.from,
        f.wind.speed,
        f.stable,
        f.arc,
        f.phase,
        f.manual,
      ].every(Number.isFinite) &&
      f.t >= 0 &&
      f.t <= 901 &&
      (i === 0 ? f.t === 0 : f.t >= r.frames[i - 1].t) &&
      Math.abs(f.ac.lat) <= 90 &&
      Math.abs(f.ac.lon) <= 180 &&
      [f.bug, f.ac.heading, f.ac.track, f.wind.from, ...f.courses].every(
        (n) => n >= 0 && n < 360,
      ) &&
      f.ac.tas > 0 &&
      f.ac.tas <= 1000 &&
      f.ac.gs >= 0 &&
      f.ac.gs <= 1500 &&
      Math.abs(f.ac.bank) < 90 &&
      f.wind.speed >= 0 &&
      f.wind.speed <= 200 &&
      f.stable >= 0 &&
      [1, 2].includes(f.source) &&
      sources.includes(f.brg1) &&
      sources.includes(f.brg2) &&
      [0, 1, 2, 3].includes(f.phase) &&
      [-1, 0, 1].includes(f.manual) &&
      typeof f.running === 'boolean',
  );
}
