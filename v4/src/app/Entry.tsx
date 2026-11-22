import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { amountOf, describe, evaluate, groupThousands, hasOperator, press, type CalcKey } from '../domain/calc.ts';
import type { Account, Tx } from '../domain/daily.ts';
import { momentOn, ymd } from '../domain/daily.ts';
import { orderedCategories } from '../domain/categories.ts';
import type { Envelope } from '../domain/envelopes.ts';
import { parsePhrase } from '../domain/parse.js';
import { Icon, Sq, catIcon } from '../ui/kit.tsx';
import { tenge } from '../ui/format.ts';
import { useSwipe } from '../ui/motion.ts';

type Kind = 'expense' | 'income';

const KEYS: CalcKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'back'];
const OPS: Array<[CalcKey, string, string]> = [
  ['+', '+', 'Плюс'],
  ['-', '−', 'Минус'],
  ['*', '×', 'Умножить'],
  ['/', '÷', 'Разделить'],
];
const DAY = 86_400_000;

// The category network from the prototype (≈105 KB) loads on the first typed phrase.
type CatMod = typeof import('../domain/cat.js');
let catLoad: Promise<{ mod: CatMod; model: unknown } | null> | null = null;
function loadCat() {
  return (catLoad ??= Promise.all([import('../domain/cat.js'), fetch('./cat-model.json').then((r) => (r.ok ? r.text() : Promise.reject()))])
    .then(([mod, json]) => ({ mod, model: mod.load(json) }))
    .catch(() => null));
}

export interface EntryResult {
  kind: Kind;
  amount: number;
  category: string;
  accountId: string;
  at: number;
  note: string;
  envelopeId?: string;
}

interface Props {
  mode: Kind;
  editing: Tx | null;
  accounts: Account[];
  txs: Tx[];
  envelopes: Envelope[];
  envBalance: (e: Envelope) => number;
  left: number; // what is left of today's figure (with the edited entry taken out)
  prefill?: { amount: number; note: string; category?: string };
  onSave: (e: EntryResult) => void;
  onDelete?: () => void;
}

export function Entry({ mode: initialMode, editing, accounts, txs, envelopes, envBalance, left, prefill, onSave, onDelete }: Props) {
  const now = Date.now();
  const today = ymd(now);
  const [mode, setMode] = useState<Kind>(editing && editing.kind !== 'transfer' ? editing.kind : initialMode);
  const [expr, setExpr] = useState(editing ? String(editing.amount) : prefill ? String(prefill.amount) : '');
  const [cat, setCat] = useState(editing?.category ?? prefill?.category ?? '');
  const [suggested, setSuggested] = useState<string[]>([]);
  const [day, setDay] = useState(editing ? ymd(editing.at) : today);
  const [phrase, setPhrase] = useState(editing?.note ?? prefill?.note ?? '');
  const [envId, setEnvId] = useState(editing?.envelopeId ?? '');
  const [acc, setAcc] = useState(() => {
    if (editing) return editing.accountId;
    try {
      const last = localStorage.getItem('qalta4:lastAccount');
      if (last && accounts.some((a) => a.id === last)) return last;
    } catch { /* first account */ }
    return accounts[0]?.id ?? '';
  });
  // Fields set by hand are not overwritten by the phrase.
  const touched = useRef({ amount: !!editing || !!prefill, cat: !!editing || !!prefill?.category, acc: !!editing, day: !!editing, mode: !!editing || !!prefill });

  const cats = useMemo(() => orderedCategories(mode, txs, suggested), [mode, txs, suggested]);
  useEffect(() => {
    if (!cat || !cats.includes(cat)) setCat(cats[0] ?? 'Прочее');
  }, [cats]);

  const memRef = useRef<object | null>(null);

  async function onPhrase(text: string) {
    setPhrase(text);
    const p = parsePhrase(text, Date.now()) as { amount: number; dir: Kind | null; ymd: string | null; pay: 'cash' | 'card' | null; rest: string };
    if (!touched.current.amount) setExpr(p.amount ? String(p.amount) : '');
    let side = mode;
    if (p.dir && !touched.current.mode) {
      side = p.dir;
      setMode(p.dir);
    }
    if (p.ymd && !touched.current.day && p.ymd <= today) setDay(p.ymd);
    if (p.pay && !touched.current.acc) {
      const a = accounts.find((x) => x.kind === p.pay);
      if (a) setAcc(a.id);
    }
    if (!p.rest || touched.current.cat) return;
    const c = await loadCat();
    if (!c) return;
    memRef.current ??= c.mod.memory(txs.map((t) => ({ cat: t.category, note: t.note, sum: t.kind === 'income' ? t.amount : -t.amount })));
    const lists = { expense: orderedCategories('expense', txs), income: orderedCategories('income', txs) };
    const r = c.mod.suggest({ text: p.rest, dir: side, cats: lists, model: c.model, mem: memRef.current }) as { cat: string | null; dir: Kind; ranked: string[] };
    if (r.cat) {
      if (r.dir !== side && !touched.current.mode) setMode(r.dir);
      setCat(r.cat);
    }
    setSuggested(r.ranked);
  }

  const key = (k: CalcKey) => {
    touched.current.amount = true;
    setExpr((x) => press(x, k));
  };

  // Hardware keyboard: digits, operators, Backspace and Enter (not while typing a phrase).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) {
        if (e.key === 'Enter') save();
        return;
      }
      const k = e.key === 'Backspace' ? 'back' : e.key === 'x' || e.key === 'X' ? '*' : e.key;
      if ((KEYS as string[]).includes(k) || '+-*/'.includes(k)) {
        e.preventDefault();
        key(k as CalcKey);
      } else if (e.key === 'Enter') save();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  // Swipe the amount sideways to erase the last digit, as in the iPhone calculator.
  const [nudge, setNudge] = useState(0);
  const sw = useSwipe({
    axis: 'x',
    onMove: (d) => setNudge(Math.max(-28, Math.min(28, d * 0.35))),
    onEnd: (d) => {
      if (Math.abs(d) > 36) key('back');
      setNudge(0);
    },
    onCancel: () => setNudge(0),
  });

  const amount = amountOf(expr);
  const divZero = evaluate(expr) === null;
  const isToday = day === today;
  const after = left - amount;

  let hint = '';
  let warn = false;
  if (divZero) [hint, warn] = ['На ноль делить нельзя', true];
  else if (mode === 'income') hint = envelopes.length ? 'После записи доход можно сразу разложить по конвертам' : 'Доход прибавится к счёту и поднимет цифру дня';
  else if (envId) {
    const e = envelopes.find((x) => x.id === envId);
    const rest = (e ? envBalance(e) : 0) + (editing?.envelopeId === envId ? editing.amount : 0) - amount;
    [hint, warn] = rest >= 0 ? [`Из конверта «${e?.name}»: в нём останется ${tenge(rest)} ₸`, false] : [`В конверте «${e?.name}» не хватает ${tenge(-rest)} ₸`, true];
  }
  else if (!isToday) hint = 'Запись в прошлый день пересчитает остаток, а не сегодняшнюю цифру';
  else if (after >= 0) hint = `После записи на сегодня останется ${tenge(after)} ₸`;
  else [hint, warn] = [`Больше цифры дня на ${tenge(-after)} ₸`, true];

  function save() {
    if (!amount || !acc) return;
    try {
      localStorage.setItem('qalta4:lastAccount', acc);
    } catch { /* harmless */ }
    // A phrase with an amount leaves its description as the note; plain text is the note itself.
    const p = parsePhrase(phrase, Date.now()) as { amount: number; rest: string };
    const note = (p.amount ? p.rest : phrase).trim().slice(0, 200);
    const keepTime = editing && ymd(editing.at) === day;
    onSave({ kind: mode, amount, category: cat || 'Прочее', accountId: acc, at: keepTime ? editing!.at : momentOn(day, Date.now()), note, envelopeId: mode === 'expense' && envId ? envId : undefined });
  }

  const shown = expr ? groupThousands(amount) : '0';
  const yesterday = ymd(now - DAY);

  return (
    <div class="entry">
      <div class="seg" role="radiogroup" aria-label="Тип операции">
        {(['expense', 'income'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} class={mode === m ? 'on' : ''} onClick={() => { touched.current.mode = true; setMode(m); setSuggested([]); }}>
            {m === 'expense' ? 'Расход' : 'Доход'}
          </button>
        ))}
      </div>

      <div class="entry-amount" {...sw} style={{ transform: nudge ? `translateX(${nudge}px)` : undefined }} aria-live="polite">
        <p class={`entry-num ${expr ? '' : 'empty'} ${mode}`}>
          <span>
            {shown.slice(0, -1)}
            <span class="digit" key={expr.length}>{shown.slice(-1)}</span>
          </span>
          <span class="cur">₸</span>
        </p>
        <p class="entry-expr">{hasOperator(expr) ? describe(expr) : ' '}</p>
        <p class={`entry-hint ${warn ? 'warn' : ''}`}>{hint}</p>
      </div>

      <label class="phrase">
        <span class="sr">Одной фразой</span>
        <input
          type="text"
          enterKeyHint="done"
          autoComplete="off"
          placeholder="Одной фразой: вчера такси 1500 наличными"
          value={phrase}
          maxLength={200}
          onInput={(e) => void onPhrase(e.currentTarget.value)}
        />
      </label>

      <div class="chips" role="radiogroup" aria-label="Категория">
        {cats.map((c) => (
          <button key={c} role="radio" aria-checked={cat === c} class={cat === c ? 'on' : ''} onClick={() => { touched.current.cat = true; setCat(c); }}>
            <Icon name={catIcon(c)} size={16} />
            {c}
          </button>
        ))}
      </div>

      <div class="entry-meta">
        <div class="seg seg-small" role="radiogroup" aria-label="Счёт">
          {accounts.map((a) => (
            <button key={a.id} role="radio" aria-checked={acc === a.id} class={acc === a.id ? 'on' : ''} onClick={() => { touched.current.acc = true; setAcc(a.id); }}>
              {a.name}
            </button>
          ))}
        </div>
        <div class="seg seg-small" role="radiogroup" aria-label="День">
          <button role="radio" aria-checked={day === today} class={day === today ? 'on' : ''} onClick={() => { touched.current.day = true; setDay(today); }}>Сегодня</button>
          <button role="radio" aria-checked={day === yesterday} class={day === yesterday ? 'on' : ''} onClick={() => { touched.current.day = true; setDay(yesterday); }}>Вчера</button>
          <label class={`date-pick ${day !== today && day !== yesterday ? 'on' : ''}`}>
            <Icon name="calendar" size={16} />
            {day !== today && day !== yesterday ? `${Number(day.slice(8))}.${day.slice(5, 7)}` : 'Дата'}
            <input type="date" aria-label="Выбрать день" max={today} value={day} onInput={(e) => { if (e.currentTarget.value) { touched.current.day = true; setDay(e.currentTarget.value); } }} />
          </label>
        </div>
      </div>

      {mode === 'expense' && envelopes.length > 0 && (
        <div class="chips env-chips" role="radiogroup" aria-label="Откуда деньги">
          <button role="radio" aria-checked={!envId} class={!envId ? 'on' : ''} onClick={() => setEnvId('')}>Из свободных</button>
          {envelopes.map((e) => (
            <button key={e.id} role="radio" aria-checked={envId === e.id} class={envId === e.id ? 'on' : ''} onClick={() => setEnvId(e.id)}>
              Из «{e.name}»
            </button>
          ))}
        </div>
      )}

      <div class="ops">
        {OPS.map(([k, label, aria]) => (
          <button key={k} aria-label={aria} onClick={() => key(k)}>
            {label}
          </button>
        ))}
      </div>

      <div class="keys">
        {KEYS.map((k) => (
          <Sq tag="button" r={18} key={k} class="key" aria-label={k === 'back' ? 'Стереть' : k} onClick={() => key(k)}>
            {k === 'back' ? <Icon name="back" size={26} stroke={1.8} /> : k}
          </Sq>
        ))}
      </div>

      <div class="entry-actions">
        {editing && onDelete && (
          <Sq tag="button" r={20} class="secondary" onClick={onDelete} aria-label="Удалить запись">
            <Icon name="trash" size={20} />
          </Sq>
        )}
        <Sq tag="button" r={20} class="primary" disabled={!amount} onClick={save}>
          {!amount ? 'Введите сумму' : `${editing ? 'Сохранить' : mode === 'income' ? 'Записать доход' : 'Записать'} ${tenge(amount)} ₸`}
        </Sq>
      </div>
    </div>
  );
}
