'use client';
import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  RotateCcw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import curriculum from '@/lib/curriculum.json';
import { MISSIONS, type FlightResult } from '@/lib/training';
import { Time } from './trainer-controls';

export function Citations({
  citations,
}: {
  citations: { source: string; pdfPages: number[] }[];
}) {
  return (
    <p className="source-line">
      {citations
        .map(
          (c) =>
            `${c.source === 'EFE' ? 'Efe' : 'IFR.PDF'} · PDF s.${c.pdfPages.join(', ')}`,
        )
        .join(' / ')}
    </p>
  );
}
export function Lesson({
  id,
  completed,
  onComplete,
  onQuiz,
  onFlight,
  flightLabel = 'Uçuşa geç',
}: {
  id: string;
  completed: boolean;
  onComplete: () => void;
  onQuiz: () => void;
  onFlight: () => void;
  flightLabel?: string;
}) {
  const lesson =
    curriculum.lessons.find((l) => l.id === id) ?? curriculum.lessons[0];
  return (
    <article className="learning-article">
      <div className="eyebrow">
        DERS {lesson.order.toString().padStart(2, '0')} / 08 ·{' '}
        {lesson.difficulty} · {lesson.durationMinutes} DK
      </div>
      <h1>{lesson.title}</h1>
      <p className="lead">{lesson.summary}</p>
      <div className="learning-objectives">
        <h3>Bu dersten sonra</h3>
        {lesson.objectives.map((x) => (
          <p key={x}>
            <Check size={15} />
            {x}
          </p>
        ))}
      </div>
      <h2>Kokpitte neye bakmalısın?</h2>
      {lesson.concepts.map((c, i) => (
        <div className="concept" key={c}>
          <span>{i + 1}</span>
          <p>{c}</p>
        </div>
      ))}
      <div className="worked-example">
        <div className="eyebrow">BİRLİKTE ÇÖZELİM</div>
        <p>{lesson.workedExample}</p>
      </div>
      <div className="caution">
        <b>Sık karıştırılan nokta</b>
        <p>{lesson.misconception}</p>
      </div>
      <h2>Uygulama akışı</h2>
      <ol className="flow-list">
        {lesson.cockpitFlow.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <p>{lesson.practice}</p>
      <Citations citations={lesson.citations} />
      <div className="action-row">
        <Button
          onClick={onComplete}
          variant={completed ? 'secondary' : 'default'}
        >
          <CheckCircle2 />
          {completed ? 'Okundu olarak işaretli' : 'Okudum, anladım'}
        </Button>
        <Button variant="outline" onClick={onQuiz}>
          Bilgimi sına <ArrowRight />
        </Button>
        <Button variant="ghost" onClick={onFlight}>
          {flightLabel}
        </Button>
      </div>
      {lesson.id === 'holding-entry' && (
        <p className="muted">
          Bu sürümde bekleme girişi ders ve bilgi sorularıyla çalışılır;
          otomatik puanlanan holding uçuş görevi yoktur.
        </p>
      )}
    </article>
  );
}
export type QuizResult = {
  id: string;
  date: string;
  correct: number;
  total: number;
  topic: string;
};
export function KnowledgeTest({
  topic,
  onFinish,
  onLesson,
}: {
  topic: string;
  onFinish: (r: QuizResult) => void;
  onLesson: (id: string) => void;
}) {
  const questions =
    topic === 'all'
      ? curriculum.questions
      : curriculum.questions.filter((q) => q.lessonId === topic);
  const [index, setIndex] = useState(0),
    [choice, setChoice] = useState<number | null>(null),
    [answers, setAnswers] = useState<number[]>([]),
    [submitted, setSubmitted] = useState(false),
    [done, setDone] = useState(false);
  const q = questions[index],
    correct = answers.filter((a, i) => a === questions[i].correctIndex).length;
  function next() {
    if (index === questions.length - 1) {
      setDone(true);
      onFinish({
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        correct,
        total: questions.length,
        topic,
      });
    } else {
      setIndex((i) => i + 1);
      setChoice(null);
      setSubmitted(false);
    }
  }
  if (done)
    return (
      <article className="learning-article">
        <div className="eyebrow">BİLGİ TESTİ · TAMAMLANDI</div>
        <h1>
          {correct} / {questions.length} doğru
        </h1>
        <p className="lead">
          {correct === questions.length
            ? 'Bu konulardaki bilgilerin sağlam. Şimdi göstergelerle uygulama zamanı.'
            : 'Yanlış yanıtları açıklamalarıyla tekrar gözden geçir.'}
        </p>
        <div className="score-bar">
          <span style={{ width: `${(100 * correct) / questions.length}%` }} />
        </div>
        {questions.map((question, i) => (
          <div className="answer-review" key={question.id}>
            <span
              className={
                answers[i] === question.correctIndex ? 'signal' : 'error-text'
              }
            >
              {answers[i] === question.correctIndex ? (
                <CheckCircle2 size={19} />
              ) : (
                <X size={19} />
              )}
            </span>
            <div>
              <b>{question.prompt}</b>
              <p>{question.explanation}</p>
              <Button
                variant="link"
                onClick={() => onLesson(question.lessonId)}
              >
                İlgili dersi aç
              </Button>
            </div>
          </div>
        ))}
        <Button
          onClick={() => {
            setIndex(0);
            setChoice(null);
            setAnswers([]);
            setSubmitted(false);
            setDone(false);
          }}
        >
          <RotateCcw /> Yeniden çöz
        </Button>
      </article>
    );
  return (
    <article className="learning-article quiz">
      <div className="section-heading">
        <span className="eyebrow">BİLGİ TESTİ</span>
        <span>
          {index + 1} / {questions.length}
        </span>
      </div>
      <div className="score-bar">
        <span style={{ width: `${(100 * index) / questions.length}%` }} />
      </div>
      <p className="muted">
        Her yanıttan sonra gerekçeyi incele. İlk yanıtın puanlanır.
      </p>
      <h1>{q.prompt}</h1>
      <div className="quiz-choices">
        {q.options.map((option, i) => (
          <Button
            variant="outline"
            key={option}
            disabled={submitted}
            className={`quiz-choice ${choice === i ? 'selected' : ''} ${submitted && i === q.correctIndex ? 'correct' : ''} ${submitted && choice === i && choice !== q.correctIndex ? 'wrong' : ''}`}
            onClick={() => setChoice(i)}
          >
            <span>{String.fromCharCode(65 + i)}</span>
            {option}
          </Button>
        ))}
      </div>
      {submitted ? (
        <>
          <output
            className={`feedback ${choice === q.correctIndex ? 'positive' : ''}`}
          >
            <b>{choice === q.correctIndex ? 'Doğru.' : 'Bu kez olmadı.'}</b>
            <p>{q.explanation}</p>
            <Citations citations={q.citations} />
          </output>
          <Button onClick={next}>
            {index === questions.length - 1
              ? 'Sonuçları göster'
              : 'Sonraki soru'}
            <ArrowRight />
          </Button>
        </>
      ) : (
        <Button
          disabled={choice === null}
          onClick={() => {
            if (choice !== null) {
              setAnswers((a) => [...a, choice]);
              setSubmitted(true);
            }
          }}
        >
          Yanıtı kontrol et
        </Button>
      )}
    </article>
  );
}
export function Debrief({
  results,
  quizzes,
  onRetry,
}: {
  results: FlightResult[];
  quizzes: QuizResult[];
  onRetry: (id: string) => void;
}) {
  const latest = results[0];
  return (
    <article className="learning-article">
      <div className="eyebrow">UÇUŞ DEFTERİ · BU TARAYICIDA SAKLANIR</div>
      <h1>Her uçuş, bir sonraki için.</h1>
      {latest ? (
        <>
          <div className="debrief-score">
            <strong>
              {latest.score}
              <small>/100</small>
            </strong>
            <div>
              <span className={latest.passed ? 'signal' : 'amber'}>
                {latest.passed ? 'GÖREV TAMAMLANDI' : 'TEKRAR ÇALIŞ'}
              </span>
              <h2>{MISSIONS.find((m) => m.id === latest.mission)?.title}</h2>
              <p>{latest.reason}</p>
            </div>
          </div>
          <div className="metric-grid">
            <div>
              <span>Uçuş süresi</span>
              <b>
                <Time seconds={latest.elapsed} />
              </b>
            </div>
            <div>
              <span>En uzun kararlı takip</span>
              <b>{Math.floor(latest.stable)} sn</b>
            </div>
            <div>
              <span>RMS sapma</span>
              <b>
                {latest.rms?.toFixed(2) ?? '—'}{' '}
                {['arc', 'fix'].includes(
                  MISSIONS.find((m) => m.id === latest.mission)?.kind ?? '',
                )
                  ? 'NM'
                  : '°'}
              </b>
            </div>
            <div>
              <span>En büyük sapma</span>
              <b>
                {latest.max.toFixed(2)}{' '}
                {['arc', 'fix'].includes(
                  MISSIONS.find((m) => m.id === latest.mission)?.kind ?? '',
                )
                  ? 'NM'
                  : '°'}
              </b>
            </div>
          </div>
          <p className="muted">
            Sapmalar, doğru alıcı/course ayarında ve sinyal geçerliyken tüm uçuş
            boyunca ölçülür; önleme bölümü dahildir. RMS, karesel ortalama
            sapmadır. Puan uygulamaya aittir, lisans sınavı sonucu değildir.
          </p>
          <Button onClick={() => onRetry(latest.mission)}>
            <RotateCcw />
            Görevi yeniden hazırla
          </Button>
        </>
      ) : (
        <div className="empty-state">
          <BookOpen size={36} />
          <h2>İlk uçuşun seni bekliyor.</h2>
          <p>
            Bir görevi bitirdiğinde tolerans takibi ve sapma ölçümleri burada
            görünecek.
          </p>
          <Button onClick={() => onRetry(MISSIONS[0].id)}>İlk görevi aç</Button>
        </div>
      )}
      <h2>Önceki uçuşlar</h2>
      {results.length === 0 ? (
        <p className="muted">Henüz kayıt yok.</p>
      ) : (
        results.map((r) => (
          <div className="history-row" key={r.id}>
            <div>
              <b>
                {MISSIONS.find((m) => m.id === r.mission)?.title ?? r.mission}
              </b>
              <small>
                {new Date(r.date).toLocaleString('tr-TR')} ·{' '}
                {r.exam ? 'Sınav' : 'Rehberli'}
              </small>
            </div>
            <span className={r.passed ? 'signal' : 'amber'}>{r.score}/100</span>
            <Button
              variant="ghost"
              onClick={() => onRetry(r.mission)}
              aria-label="Görevi tekrar aç"
            >
              <RotateCcw />
            </Button>
          </div>
        ))
      )}
      <h2>Bilgi testleri</h2>
      {quizzes.length === 0 ? (
        <p className="muted">Henüz test kaydı yok.</p>
      ) : (
        quizzes.map((q) => (
          <div key={q.id} className="history-row">
            <div>
              <b>
                {q.topic === 'all'
                  ? 'Tüm konular'
                  : curriculum.lessons.find((l) => l.id === q.topic)?.title}
              </b>
              <small>{new Date(q.date).toLocaleString('tr-TR')}</small>
            </div>
            <span>
              {q.correct}/{q.total}
            </span>
          </div>
        ))
      )}
    </article>
  );
}
export function References() {
  return (
    <article className="learning-article">
      <div className="eyebrow">KAYNAKLAR & MODEL SINIRLARI</div>
      <h1>Neyi simüle ediyoruz?</h1>
      <p className="lead">
        Gerçek coğrafyada, idealize edilmiş bir yatay radyo seyrüsefer eğitmeni.
        Sertifikalı bir Garmin ürünü veya uçuş eğitim cihazı değildir.
      </p>
      <h2>Senin dokümanların</h2>
      <p>
        Efe Can Birinci — Brifing Notlarım ve Derlemelerim, v2 Rev01
        (07.12.2025). Aletli (IR) Uçuş Hareketleri Eğitim Dokümanı —
        ED.10.30.156 Rev03 (IFR.PDF).
      </p>
      <p>
        Dersler özgün olarak özetlendi; PDF dosyaları ve içlerindeki chartlar
        siteye yüklenmedi. Ders altındaki numaralar PDF sayfalarıdır; IFR
        belgesindeki basılı B2 numaralarından farklıdır.
      </p>
      <h2>Gösterge referansı</h2>
      <p>
        <a
          href="https://static.garmin.com/pumac/190-00498-08_0A_Web.pdf"
          target="_blank"
          rel="noreferrer"
        >
          Garmin G1000 Cessna NAV III Pilot’s Guide
        </a>{' '}
        — basılı s.57–62: HSI, course, bearing ve DME.{' '}
        <a
          href="https://static.garmin.com/pumac/190-02100-00_C.pdf"
          target="_blank"
          rel="noreferrer"
        >
          Garmin G1000 NXi Kodiak Pilot’s Guide
        </a>{' '}
        — s.58–59: tek/çift ibre geometrisi.
      </p>
      <div className="caution">
        <b>DME yerleşimindeki bilinçli fark</b>
        <p>
          Gerçek G1000 bearing penceresindeki mesafe GPS kaynaklı olabilir; DME
          ayrı pencerededir. İsteğin doğrultusunda burada ilgili VOR’un simüle
          DME mesafesi her bearing’in altında gösterilir. NDB’nin DME’si yoktur.
          Bu yerleşim birebir Garmin arayüzü değildir.
        </p>
      </div>
      <h2>Modelin çalışma kuralları</h2>
      <ul className="readable-list">
        <li>
          Yatay küresel geometri; manyetik baş ve kerteriz için senaryoya sabit
          6° doğu varyasyon uygulanır. Güncel manyetik model iddiası yoktur.
        </li>
        <li>
          120 KTAS, 4.200 ft MSL sabit. Koordineli dönüş, yatışa bağlı dönüş
          oranı ve rüzgâr vektörü hesaplanır. Dikey profil, güç, stall,
          attitude, altimetre ve airspeed göstergesi yoktur.
        </li>
        <li>
          HDG SEL, başı takip eden eğitim yardımıdır. Course’u veya CDI’ı
          otomatik takip etmez. Sol/sağ kumanda geçici ±20° yatış komutudur.
        </li>
        <li>
          VOR tam ölçek ±10°. İstasyona 0.25 NM’den yakın belirsizlik alanı; VOR
          80 NM, NDB 40 NM alım sınırı, senaryoya ait basitleştirmelerdir. DME,
          yatay mesafe ve istasyon yüksekliği farkından eğik mesafe hesaplar.
        </li>
        <li>
          İdeal alıcı: arazi maskelemesi, parazit, ADF dip/night/coastal
          etkileri, gerçek cihaz gecikmeleri ve arızalar modellenmez. ADF sinyal
          uyarısı eğitmen katmanıdır.
        </li>
        <li>
          İstasyon/frekans/yükseklik verileri dondurulmuş senaryolardır; güncel
          AIP/Navaid veritabanı değildir. Harita OpenStreetMap’tir; kesikli
          hatlar eğitim çizimidir, resmî yaklaşma chartı değildir.
        </li>
        <li>
          Görev eşikleri ve puanlar uygulama alıştırması içindir. Bekleme
          teorisi var; otomatik değerlendirilen tam holding, ILS, GPS,
          glideslope ve dikey yaklaşma prosedürü yoktur.
        </li>
      </ul>
      <p>
        <a
          href="https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap1_section_1.html"
          target="_blank"
          rel="noreferrer"
        >
          FAA AIM — Navigation Aids
        </a>{' '}
        ·{' '}
        <a
          href="https://www.faa.gov/about/office_org/headquarters_offices/ato/service_units/techops/navservices/gbng/lpdme"
          target="_blank"
          rel="noreferrer"
        >
          FAA — DME eğik mesafesi
        </a>
      </p>
      <h2>Kaynaklardaki dikkat noktaları</h2>
      {curriculum.sourceCautions
        .filter((c) => ['c02', 'c03', 'c06', 'c07', 'c08'].includes(c.id))
        .map((c) => (
          <details key={c.id}>
            <summary>{c.topic}</summary>
            <p>{c.issue}</p>
            <p>{c.treatment}</p>
            <Citations citations={c.citations} />
          </details>
        ))}
      <p className="caution">
        Gerçek uçuşta güncel resmî kartlar, uçak el kitabı, işletme usulleri ve
        yetkili eğitmenin esas alınmalıdır.
      </p>
    </article>
  );
}
