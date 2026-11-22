import { useMemo, useRef, useState } from 'preact/hooks';
import type { Envelope, EnvelopeKind, Plan } from '../domain/envelopes.ts';
import { ruleLabel } from '../domain/envelopes.ts';
import { Icon, Sq } from '../ui/kit.tsx';
import { tenge } from '../ui/format.ts';
import { reduced, useSwipe } from '../ui/motion.ts';

const digits = (v: string) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 9);
export const TONES = ['dew', 'mist', 'deep', 'glint'] as const;
export const toneOf = (i: number) => TONES[i % TONES.length];

// ───────── envelope card (Money screen) ─────────

export function EnvelopeCard({ env, balance, index, onOpen }: { env: Envelope; balance: number; index: number; onOpen: () => void }) {
  const progress = env.kind === 'goal' && env.target > 0 ? Math.min(1, Math.max(0, balance) / env.target) : null;
  return (
    <Sq tag="button" r={24} class={`env ${toneOf(index)}`} onClick={onOpen} aria-label={`Конверт ${env.name}: ${tenge(balance)} ₸`}>
      <span class="env-name">{env.name}</span>
      <span class="env-rule">{env.kind === 'goal' && env.target > 0 ? `цель ${tenge(env.target)} ₸` : ruleLabel(env)}</span>
      <span class="env-sum">{tenge(balance)} ₸</span>
      {progress !== null && (
        <span class="env-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${progress})` }} />
        </span>
      )}
    </Sq>
  );
}

// ───────── create / edit an envelope, put money in or take it out ─────────

interface EnvelopeSheetProps {
  env: Envelope | null;
  balance: number;
  onSave: (e: { name: string; kind: EnvelopeKind; ruleMode: Envelope['ruleMode']; ruleValue: number; target: number }) => void;
  onMove: (amount: number) => void;
  onDelete: () => void;
}

export function EnvelopeSheet({ env, balance, onSave, onMove, onDelete }: EnvelopeSheetProps) {
  const [tab, setTab] = useState<'money' | 'rule'>(env ? 'money' : 'rule');
  const [name, setName] = useState(env?.name ?? '');
  const [kind, setKind] = useState<EnvelopeKind>(env?.kind ?? 'reserve');
  const [mode, setMode] = useState<Envelope['ruleMode']>(env?.ruleMode ?? 'percent');
  const [value, setValue] = useState(env ? String(env.ruleValue || '') : '10');
  const [target, setTarget] = useState(env?.target ? String(env.target) : '');
  const [move, setMove] = useState('');
  const v = Number(value || 0), t = Number(target || 0), m = Number(move || 0);
  const valid = name.trim().length > 0 && (mode === 'none' || (mode === 'percent' ? v > 0 && v <= 100 : v > 0));

  return (
    <div class="setup">
      <h2>{env ? env.name : 'Новый конверт'}</h2>
      {env && (
        <div class="seg" role="radiogroup" aria-label="Раздел">
          <button role="radio" aria-checked={tab === 'money'} class={tab === 'money' ? 'on' : ''} onClick={() => setTab('money')}>Деньги</button>
          <button role="radio" aria-checked={tab === 'rule'} class={tab === 'rule' ? 'on' : ''} onClick={() => setTab('rule')}>Настройки</button>
        </div>
      )}

      {env && tab === 'money' ? (
        <>
          <p class="muted">В конверте {tenge(balance)} ₸. Эти деньги не входят в цифру дня.</p>
          <label class="field">
            <span>Сумма</span>
            <input inputMode="numeric" autoComplete="off" placeholder="0" value={move ? tenge(m) : ''} onInput={(e) => setMove(digits(e.currentTarget.value))} />
            <b>₸</b>
          </label>
          <div class="entry-actions">
            <Sq tag="button" r={20} class="primary ghost" disabled={!m || m > balance} onClick={() => onMove(-m)}>Взять в свободные</Sq>
            <Sq tag="button" r={20} class="primary" disabled={!m} onClick={() => onMove(m)}>Положить</Sq>
          </div>
          <p class="muted small">«Положить» переносит деньги из свободных в конверт, «Взять» — обратно. Расход прямо из конверта отмечается в листе записи.</p>
        </>
      ) : (
        <>
          <label class="field">
            <span>Название</span>
            <input type="text" maxLength={40} placeholder="Например, Подушка" value={name} onInput={(e) => setName(e.currentTarget.value)} style="text-align:right;font-size:17px" />
          </label>
          <div class="seg" role="radiogroup" aria-label="Тип">
            {([['reserve', 'Резерв'], ['goal', 'Цель'], ['obligation', 'Обязательное']] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={kind === k} class={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
          {kind === 'goal' && (
            <label class="field">
              <span>Собрать</span>
              <input inputMode="numeric" autoComplete="off" placeholder="0" value={target ? tenge(t) : ''} onInput={(e) => setTarget(digits(e.currentTarget.value))} />
              <b>₸</b>
            </label>
          )}
          <p class="muted">С каждого дохода:</p>
          <div class="seg" role="radiogroup" aria-label="Правило">
            {([['percent', 'Процент'], ['fixed', 'Сумма'], ['none', 'Вручную']] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={mode === k} class={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>
            ))}
          </div>
          {mode !== 'none' && (
            <label class="field">
              <span>{mode === 'percent' ? 'Процент' : 'Сумма'}</span>
              <input inputMode="numeric" autoComplete="off" placeholder="0" value={value ? (mode === 'percent' ? value : tenge(v)) : ''} onInput={(e) => setValue(digits(e.currentTarget.value).slice(0, mode === 'percent' ? 3 : 9))} />
              <b>{mode === 'percent' ? '%' : '₸'}</b>
            </label>
          )}
          <div class="entry-actions">
            {env && (
              <Sq tag="button" r={20} class="secondary" aria-label="Удалить конверт" onClick={onDelete}>
                <Icon name="trash" size={20} />
              </Sq>
            )}
            <Sq tag="button" r={20} class="primary" disabled={!valid} onClick={() => onSave({ name: name.trim(), kind, ruleMode: mode, ruleValue: mode === 'none' ? 0 : v, target: kind === 'goal' ? t : 0 })}>
              {env ? 'Сохранить' : 'Создать конверт'}
            </Sq>
          </div>
          {env && <p class="muted small">Удаление вернёт {tenge(Math.max(0, balance))} ₸ в свободные деньги.</p>}
        </>
      )}
    </div>
  );
}

// ───────── the income ritual ─────────

interface AllocateProps {
  income: number;
  envelopes: Envelope[];
  plan: Plan;
  perDayAfter: (free: number) => number;
  onConfirm: (lines: Array<{ envelopeId: string; amount: number }>, from: { x: number; y: number }) => void;
  onSkip: () => void;
}

export function Allocate({ income, envelopes, plan, perDayAfter, onConfirm, onSkip }: AllocateProps) {
  const [amounts, setAmounts] = useState<Record<string, number>>(() => Object.fromEntries(plan.lines.map((l) => [l.envelopeId, l.amount])));
  const [editing, setEditing] = useState<string | null>(null);
  const lines = envelopes.filter((e) => e.id in amounts);
  const given = Object.values(amounts).reduce((a, b) => a + b, 0);
  const free = income - given;
  const over = free < 0;
  const segs = useMemo(() => [...lines.map((e, i) => ({ id: e.id, w: amounts[e.id] / Math.max(1, income), tone: toneOf(envelopes.indexOf(e)) || toneOf(i) })), { id: 'free', w: Math.max(0, free) / Math.max(1, income), tone: 'free' }], [amounts, income]);

  return (
    <div class="alloc">
      <p class="muted center">Новый доход</p>
      <p class="alloc-sum">+{tenge(income)} <span>₸</span></p>
      <p class="muted center">Разложите сейчас, пока деньги не разошлись</p>
      <div class="alloc-bar" aria-hidden="true">
        {segs.map((s) => s.w > 0 && <i key={s.id} class={s.tone} style={{ flexGrow: s.w }} />)}
      </div>
      <ul class="alloc-lines">
        {lines.map((e) => (
          <li key={e.id}>
            <span class={`sw ${toneOf(envelopes.indexOf(e))}`} />
            <span class="alloc-name">{e.name}<small>{ruleLabel(e)}</small></span>
            {editing === e.id ? (
              <input
                class="alloc-input"
                inputMode="numeric"
                autoFocus
                aria-label={`Сумма в «${e.name}»`}
                value={amounts[e.id] ? tenge(amounts[e.id]) : ''}
                onInput={(ev) => setAmounts({ ...amounts, [e.id]: Number(digits(ev.currentTarget.value) || 0) })}
                onBlur={() => setEditing(null)}
              />
            ) : (
              <button class="alloc-amt" onClick={() => setEditing(e.id)} aria-label={`Изменить сумму для «${e.name}»`}>{tenge(amounts[e.id])} ₸</button>
            )}
          </li>
        ))}
        <li class="free-line">
          <span class="sw free" />
          <span class="alloc-name">Свободно<small>{over ? 'Разложено больше, чем пришло' : `≈ ${tenge(perDayAfter(Math.max(0, free)))} ₸ в день`}</small></span>
          <b class={over ? 'warn-text' : ''}>{tenge(free)} ₸</b>
        </li>
      </ul>
      <SwipeConfirm label="Проведите, чтобы разложить" disabled={over} onConfirm={(from) => onConfirm(lines.map((e) => ({ envelopeId: e.id, amount: amounts[e.id] })), from)} />
      <button class="link" onClick={onSkip}>Не раскладывать этот доход</button>
    </div>
  );
}

// ───────── swipe to confirm ─────────

export function SwipeConfirm({ label, disabled, onConfirm }: { label: string; disabled?: boolean; onConfirm: (from: { x: number; y: number }) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLButtonElement>(null);
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const max = () => (track.current?.offsetWidth ?? 300) - (thumb.current?.offsetWidth ?? 56) - 12;
  const done = () => {
    const r = thumb.current!.getBoundingClientRect();
    onConfirm({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };
  const sw = useSwipe({
    axis: 'x',
    capture: true,
    onStart: () => setDrag(true),
    onMove: (d) => !disabled && setX(Math.max(0, Math.min(max(), d))),
    onEnd: (d, v) => {
      setDrag(false);
      if (!disabled && (d > max() * 0.8 || (v > 0.8 && d > max() * 0.4))) {
        setX(max());
        setTimeout(done, reduced() ? 0 : 160);
      } else setX(0);
    },
    onCancel: () => { setDrag(false); setX(0); },
  });
  const k = x / Math.max(1, max());
  return (
    <Sq r={24} class={`confirm ${disabled ? 'off' : ''}`}>
      <div ref={track} class="confirm-track" style={{ '--k': String(k) } as never}>
        <span class="confirm-label" style={{ opacity: String(1 - k * 1.4) }}>{label}</span>
        {/* Swipe is the gesture; a tap or Enter on the handle confirms too, for VoiceOver and keyboards. */}
        <button
          ref={thumb}
          class="confirm-thumb"
          aria-label={label.replace('Проведите, чтобы', 'Подтвердить:')}
          disabled={disabled}
          style={{ transform: `translateX(${x}px)`, transition: drag ? 'none' : undefined }}
          onClick={(e) => { if ((e as MouseEvent).detail === 0) done(); }}
          {...sw}
        >
          <Icon name="out" size={22} stroke={2.4} />
        </button>
      </div>
    </Sq>
  );
}

// ───────── full-screen done ─────────

export function Done({ data, onClose }: { data: { amount: number; count: number; perDay: number; from: { x: number; y: number } } | null; onClose: () => void }) {
  if (!data) return null;
  return (
    <button class="done" style={{ '--x': `${data.from.x}px`, '--y': `${data.from.y}px` } as never} onClick={onClose} aria-label="Готово. Закрыть">
      <svg class="done-check" aria-hidden="true" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19.5 7" /></svg>
      <span class="done-sum">{tenge(data.amount)} ₸</span>
      <span class="done-text">Разложено по {data.count} {data.count === 1 ? 'конверту' : 'конвертам'}</span>
      <span class="done-pill">Можно тратить {tenge(data.perDay)} ₸ в день</span>
      <span class="done-close">Коснитесь, чтобы закрыть</span>
    </button>
  );
}
