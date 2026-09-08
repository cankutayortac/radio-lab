import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeftRight, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  fmt,
  morse,
  norm,
  validFrequency,
  type Reception,
} from '@/lib/navigation';

// Hidden panels have zero dimensions. Center alignment keeps the thumb based on
// its value, not a cached measurement, and canceling remounts any pending drag.
export function StableSlider({
  label,
  value,
  min = 0,
  max = 359,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const active = useRef(false);
  const [session, setSession] = useState(0);
  useEffect(() => {
    const cancel = () => {
      active.current = false;
      setSession((n) => n + 1);
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    const end = () => {
      active.current = false;
    };
    const resize = () => {
      if (active.current) cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('touchcancel', cancel);
    document.addEventListener('pointerup', end);
    document.addEventListener('touchend', end);
    return () => {
      active.current = false;
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchcancel', cancel);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('touchend', end);
    };
  }, []);
  return (
    <div className="stable-slider">
      <Slider
        key={session}
        aria-label={label}
        thumbAlignment="center"
        value={[Math.max(min, Math.min(max, value))]}
        min={min}
        max={max}
        step={step}
        onPointerDownCapture={(e) => {
          active.current = e.isPrimary && e.button === 0;
        }}
        onTouchStartCapture={() => {
          active.current = true;
        }}
        onValueChange={(next, details) => {
          const n = Array.isArray(next) ? next[0] : next;
          if (
            !Number.isFinite(n) ||
            ((details.reason === 'drag' || details.reason === 'track-press') &&
              !active.current)
          ) {
            details.cancel();
            return;
          }
          onChange(n);
        }}
      />
    </div>
  );
}

export function Choice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue>
          {options.find((o) => o.value === value)?.label ?? value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="trainer-choice-menu">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function AngleControl({
  label,
  value,
  onChange,
  onSync,
  syncLabel,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onSync?: () => void;
  syncLabel?: string;
  hint?: string;
}) {
  const id = useId();
  const selected = norm(Math.round(value));
  const pending = useRef<{ text: string; base: number; label: string } | null>(
    null,
  );
  const [draft, setDraft] = useState<{
    text: string;
    base: number;
    label: string;
  } | null>(null);
  const clearDraft = () => {
    pending.current = null;
    setDraft(null);
  };
  const validDraft = draft?.base === selected && draft.label === label;
  const applyValue = (next: number) => {
    clearDraft();
    if (Number.isFinite(next)) onChange(norm(Math.round(next)));
  };
  const commitDraft = () => {
    const edit = pending.current;
    clearDraft();
    if (
      edit &&
      edit.base === selected &&
      edit.label === label &&
      edit.text.trim() !== '' &&
      Number.isFinite(Number(edit.text))
    ) {
      onChange(norm(Math.round(Number(edit.text))));
    }
  };
  return (
    <div className="angle-control">
      <div className="control-label">
        <label className="angle-title" htmlFor={id}>
          {label}
        </label>
        <Input
          id={id}
          aria-label={`${label} derece`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          type="text"
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          spellCheck={false}
          value={validDraft ? draft.text : fmt(selected)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const edit = { text: e.target.value, base: selected, label };
            pending.current = edit;
            setDraft(edit);
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              clearDraft();
            }
          }}
        />
        <span>°</span>
        {onSync && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearDraft();
              onSync();
            }}
          >
            {syncLabel}
          </Button>
        )}
      </div>
      <StableSlider label={label} value={selected} onChange={applyValue} />
      <div className="slider-scale">
        <span>000°</span>
        <span>180°</span>
        <span>359°</span>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="angle-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
export function Radio({
  name,
  active,
  standby,
  r,
  onStandby,
  onSwap,
}: {
  name: string;
  active: number;
  standby: string;
  r: Reception;
  onStandby: (v: string) => void;
  onSwap: () => void;
}) {
  const adf = name === 'ADF',
    valid = validFrequency(standby, adf);
  const [playing, setPlaying] = useState(false),
    [audioError, setAudioError] = useState('');
  const context = useRef<AudioContext | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      void context.current?.close();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function identify() {
    if (!r?.inRange || playing) return;
    try {
      const audio = new AudioContext();
      context.current = audio;
      await audio.resume();
      setPlaying(true);
      setAudioError('');
      let t = audio.currentTime + 0.05;
      for (const c of morse(r.station.id)) {
        if (c === ' ') {
          t += 0.24;
          continue;
        }
        const duration = c === '.' ? 0.09 : 0.27,
          osc = audio.createOscillator(),
          gain = audio.createGain();
        osc.frequency.value = 1020;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 0.005);
        gain.gain.setValueAtTime(0.08, t + duration - 0.005);
        gain.gain.linearRampToValueAtTime(0, t + duration);
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start(t);
        osc.stop(t + duration);
        t += duration + 0.09;
      }
      timer.current = setTimeout(
        () => {
          setPlaying(false);
          void audio.close();
          context.current = null;
        },
        (t - audio.currentTime + 0.1) * 1000,
      );
    } catch {
      setPlaying(false);
      setAudioError('Ses başlatılamadı. Tarayıcının ses iznini kontrol et.');
    }
  }
  return (
    <div className="radio">
      <div className="radio-name">
        <b>{name}</b>
        <span className={r?.inRange ? 'signal' : 'muted'}>
          {r?.inRange ? r.station.id : 'NO IDENT'}
        </span>
      </div>
      <div className="radio-tune">
        <div>
          <span className="eyebrow">AKTİF</span>
          <strong className="frequency">
            {adf ? active.toFixed(1) : active.toFixed(2)}
          </strong>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={`${name} aktif ve standby frekanslarını değiştir`}
          disabled={!valid}
          onClick={onSwap}
        >
          <ArrowLeftRight />
        </Button>
        <label>
          <span className="eyebrow">STANDBY · {adf ? 'kHz' : 'MHz'}</span>
          <Input
            aria-label={`${name} standby frekansı`}
            inputMode="decimal"
            value={standby}
            aria-invalid={!valid}
            onChange={(e) => onStandby(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) onSwap();
            }}
          />
        </label>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${name} mors kimliğini dinle`}
          disabled={!r?.inRange || playing}
          onClick={() => void identify()}
        >
          <Volume2 />
        </Button>
      </div>
      <div className="radio-foot">
        <span>
          {!valid
            ? adf
              ? '190–1799.5 kHz, 0.5 adım'
              : '108.00–117.95 MHz, 0.05 adım'
            : r?.inRange
              ? morse(r.station.id)
              : 'Frekansı gir, ↔ ile aktif yap.'}
        </span>
        <span>{playing ? 'IDENT çalıyor' : r?.inRange ? 'IDENT' : ''}</span>
      </div>
      {audioError && <output className="error-text">{audioError}</output>}
    </div>
  );
}
export function Time({ seconds }: { seconds: number }) {
  return (
    <>
      {Math.floor(seconds / 60)
        .toString()
        .padStart(2, '0')}
      :
      {Math.floor(seconds % 60)
        .toString()
        .padStart(2, '0')}
    </>
  );
}
export function HeadingText({ value }: { value: number }) {
  return <>{fmt(value)}°</>;
}
