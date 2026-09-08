'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Focus,
  ListChecks,
  Pause,
  Play,
  RadioTower,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Choice, StableSlider, Time } from './trainer-controls';
import { TrainerHSI, type BearingSource } from './trainer-hsi';
import { TrainerMap } from './trainer-map';
import { fmt, signed } from '@/lib/navigation';
import { MISSIONS, type FlightResult } from '@/lib/training';
import {
  explainFrame,
  frameAtTime,
  frameReceivers,
  recordingEvents,
  validReviewSummary,
  type FlightRecording,
} from '@/lib/flight-review';
import { readRecording } from '@/lib/replay-store';

export function FlightReview({
  result,
  sessionRecording,
}: {
  result: FlightResult;
  sessionRecording?: FlightRecording;
}) {
  const [record, setRecord] = useState<FlightRecording | null | undefined>(
    sessionRecording,
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    if (sessionRecording) return;
    let cancelled = false;
    void readRecording(result.id)
      .then((r) => {
        if (!cancelled)
          setRecord(
            r?.mission === result.mission &&
              r.exam === result.exam &&
              r.date === result.date
              ? r
              : null,
          );
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setRecord(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionRecording, result.id, result.mission, result.exam, result.date]);
  const summary = validReviewSummary(result.review) ? result.review : null;
  return (
    <section className="flight-review" aria-label="Açıklamalı uçuş analizi">
      {summary && (
        <div className="review-summary">
          <div className="eyebrow">GÖREVE ÖZEL GERİ BİLDİRİM</div>
          <h3>{summary.headline}</h3>
          <ul>
            {summary.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <div className="review-next">
            <b>Bir sonraki denemede</b>
            <p>{summary.nextStep}</p>
          </div>
        </div>
      )}
      {record === undefined ? (
        <output className="review-empty">Uçuş kaydı açılıyor…</output>
      ) : record ? (
        <Replay record={record} />
      ) : (
        <output className="review-empty">
          {error
            ? 'Tarayıcının ayrıntılı kayıt deposuna erişilemiyor. Özet sonuçların korunuyor.'
            : summary
              ? 'Bu uçuşun ayrıntılı tekrarı bu tarayıcıda bulunamadı. En son 20 tekrar saklanır; yukarıdaki açıklamalı özet korunur.'
              : 'Bu eski uçuşta ayrıntılı kayıt yok. Yeni görev uçuşlarında HSI, harita ve ayar değişiklikleri birlikte kaydedilecek.'}
        </output>
      )}
      <p className="review-disclaimer">
        Kayıtlar yalnız bu cihaz ve tarayıcıdadır; iki site adresi arasında
        eşitlenmez. Son 20 ayrıntılı tekrar saklanır. Açıklamalar senaryo
        kurallarına dayanır; sertifikalı eğitim değerlendirmesi değildir.
      </p>
    </section>
  );
}

export function Replay({ record }: { record: FlightRecording }) {
  const [cursor, setCursor] = useState(0),
    [playing, setPlaying] = useState(false),
    [rate, setRate] = useState(1);
  const [filter, setFilter] = useState('all'),
    [shown, setShown] = useState(40),
    [recenter, setRecenter] = useState(0);
  const playhead = useRef(0);
  const frames = record.frames,
    end = frames.at(-1)!.t;
  const f = frames[cursor],
    mission = MISSIONS.find((m) => m.id === record.mission)!;
  const e = explainFrame(mission, f),
    rx = frameReceivers(f);
  const nav = rx[f.source === 1 ? 'NAV1' : 'NAV2'];
  const events = useMemo(() => recordingEvents(record), [record]);
  const filtered = events.filter((e) => filter === 'all' || e.kind === filter);
  const trail = useMemo(
    () =>
      frames
        .slice(0, cursor + 1)
        .map((f) => ({ lat: f.ac.lat, lon: f.ac.lon })),
    [frames, cursor],
  );
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      playhead.current = Math.min(
        end,
        playhead.current + Math.min(1, (now - last) / 1000) * rate,
      );
      last = now;
      setCursor(frameAtTime(frames, playhead.current));
      if (playhead.current >= end) setPlaying(false);
    }, 50);
    const stop = () => setPlaying(false);
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [playing, rate, end, frames]);
  const seekFrame = (index: number) => {
    const next = Math.max(0, Math.min(frames.length - 1, index));
    setPlaying(false);
    playhead.current = frames[next].t;
    setCursor(next);
  };
  const seekTime = (t: number) =>
    seekFrame(frameAtTime(frames, Math.max(0, Math.min(end, t))));
  return (
    <div className="replay-workspace">
      <div className="section-heading">
        <div>
          <span className="eyebrow">UÇUŞ TEKRARI · CANLI KUMANDA DEĞİL</span>
          <h3>Aynı anı harita ve HSI’da incele</h3>
        </div>
        <span className="tag">
          {record.exam ? 'TAMAMLANMIŞ SINAV' : 'REHBERLİ UÇUŞ'}
        </span>
      </div>
      {record.truncated && (
        <p className="caution">
          Kayıt sınırına ulaşıldı; son kare öncesinde zaman boşluğu bulunabilir.
        </p>
      )}
      <div className="replay-transport">
        <Button
          onClick={() => {
            if (cursor === frames.length - 1) {
              playhead.current = 0;
              setCursor(0);
            }
            setPlaying((p) => !p);
          }}
          disabled={end <= 0}
          aria-label={playing ? 'Tekrarı duraklat' : 'Kaydı oynat'}
        >
          {playing ? <Pause /> : <Play />}
          {playing ? 'Duraklat' : 'Oynat'}
        </Button>
        <Button
          variant="outline"
          onClick={() => seekFrame(0)}
          aria-label="İlk kayıt karesi"
        >
          <RotateCcw />
        </Button>
        <Button
          variant="outline"
          onClick={() => seekTime(f.t - 5)}
          aria-label="5 saniye geri"
        >
          <ArrowLeft />5 sn
        </Button>
        <Button
          variant="outline"
          onClick={() => seekTime(f.t + 5)}
          aria-label="5 saniye ileri"
        >
          5 sn
          <ArrowRight />
        </Button>
        <Choice
          label="Tekrar hızı"
          value={String(rate)}
          options={[0.5, 1, 2, 4].map((n) => ({
            value: String(n),
            label: `${n}×`,
          }))}
          onChange={(v) => setRate(Number(v))}
        />
        <span className="replay-clock">
          <Time seconds={f.t} /> / <Time seconds={end} />
        </span>
        <Button variant="ghost" onClick={() => seekFrame(frames.length - 1)}>
          Son kare
        </Button>
      </div>
      {end > 0 && (
        <div className="replay-seek">
          <span>Uçuş zamanı</span>
          <StableSlider
            label="Uçuş kaydında zaman seç"
            min={0}
            max={end}
            step={0.1}
            value={f.t}
            onChange={seekTime}
          />
          <span>
            {f.t.toFixed(2)} sn · kare {cursor + 1}/{frames.length}
          </span>
        </div>
      )}
      <div className="replay-instruments">
        <div className="replay-hsi">
          <div className="panel-toolbar">
            <div>
              <RadioTower size={17} />
              <b>Kaydedilmiş HSI</b>
            </div>
            <span className="tag">CDI NAV{f.source}</span>
          </div>
          <TrainerHSI
            ac={f.ac}
            course={f.courses[f.source - 1]}
            bug={f.bug}
            nav={nav}
            navIndex={f.source}
            b1={rx[f.brg1 as BearingSource]}
            b2={rx[f.brg2 as BearingSource]}
            s1={f.brg1 as BearingSource}
            s2={f.brg2 as BearingSource}
          />
        </div>
        <div className="map-panel replay-map">
          <div className="panel-toolbar">
            <b>O ana kadarki uçuş izi</b>
            <Button
              variant="ghost"
              aria-label="Tekrar uçağına odaklan"
              onClick={() => setRecenter((n) => n + 1)}
            >
              <Focus />
            </Button>
          </div>
          <div className="map-frame">
            <TrainerMap
              ac={f.ac}
              trail={trail}
              mission={mission}
              guide
              follow
              recenter={recenter}
              canPlace={false}
              onPlace={() => undefined}
            />
          </div>
        </div>
      </div>
      <dl className="replay-readouts">
        <div>
          <dt>Seçili HDG / uçulan baş</dt>
          <dd>
            {fmt(f.bug)}° / {fmt(f.ac.heading)}°
          </dd>
        </div>
        <div>
          <dt>Yer izi / baş farkı</dt>
          <dd>
            {fmt(f.ac.track)}° / {signed(f.ac.track - f.ac.heading).toFixed(1)}°
          </dd>
        </div>
        <div>
          <dt>NAV1 · aktif / CRS</dt>
          <dd>
            {f.nav1.toFixed(2)} / {fmt(f.courses[0])}°
          </dd>
        </div>
        <div>
          <dt>NAV2 · aktif / CRS</dt>
          <dd>
            {f.nav2.toFixed(2)} / {fmt(f.courses[1])}°
          </dd>
        </div>
        <div>
          <dt>ADF / BRG1 / BRG2</dt>
          <dd>
            {f.adf.toFixed(1)} / {f.brg1} / {f.brg2}
          </dd>
        </div>
        <div>
          <dt>Rüzgâr · FROM</dt>
          <dd>
            {fmt(f.wind.from)}° / {f.wind.speed} kt
          </dd>
        </div>
      </dl>
      <div className={`replay-explanation review-${e.category}`}>
        <span className="eyebrow">
          BU ANDA NE OLUYOR? · {f.t.toFixed(2)} SN
        </span>
        <h3>{e.title}</h3>
        <p>{e.detail}</p>
        <p>
          <b>Çalışma önerisi: </b>
          {e.advice}
        </p>
        <small>
          {e.assessable
            ? 'Görevin kayıtlı koşullarına göre açıklanıyor.'
            : 'Bu an pilotaj hatası olarak değerlendirilmez.'}{' '}
          {f.running ? '' : 'Uçuş bu karede duraklatılmış.'}
        </small>
      </div>
      <div className="review-timeline-heading">
        <div>
          <ListChecks size={20} />
          <h3>Ayarlar ve önemli anlar</h3>
        </div>
        <Choice
          label="Zaman çizelgesi filtresi"
          value={filter}
          options={[
            { value: 'all', label: 'Tüm olaylar' },
            { value: 'flight', label: 'Görev / sinyal' },
            { value: 'control', label: 'Ayar değişiklikleri' },
          ]}
          onChange={(v) => {
            setFilter(v);
            setShown(40);
          }}
        />
      </div>
      <p className="muted replay-timeline-hint">
        Bir olaya dokunarak o kareye dön. Aynı saniyedeki ayarlar ayrı olaylar
        olarak görünür; zaman kaydırıcısı o andaki son ayarı seçer.
      </p>
      <ol className="review-events">
        {filtered.slice(0, shown).map((event, i) => (
          <li key={`${event.frame}-${event.code}-${i}`}>
            <button
              className={cursor === event.frame ? 'active' : ''}
              onClick={() => seekFrame(event.frame)}
              aria-label={`${event.t.toFixed(2)} saniye: ${event.title}`}
            >
              <time>
                <Time seconds={event.t} />
              </time>
              <span>
                <b>{event.title}</b>
                <span>{event.detail}</span>
              </span>
              <ArrowRight size={16} />
            </button>
          </li>
        ))}
      </ol>
      {filtered.length === 0 && (
        <p className="muted">Bu filtrede kayıtlı olay yok.</p>
      )}
      {shown < filtered.length && (
        <Button variant="outline" onClick={() => setShown((n) => n + 40)}>
          Daha fazla olay ({Math.min(shown, filtered.length)}/{filtered.length})
        </Button>
      )}
      <p className="review-disclaimer">
        Tekrar, yaklaşık 0.25 sn aralıklarla ve ayar/geçiş anlarında alınan
        gerçek simülasyon karelerini gösterir. Kareler arasında yapay ibre veya
        alıcı değeri üretilmez. Orijinal puan değişmez.
      </p>
    </div>
  );
}
