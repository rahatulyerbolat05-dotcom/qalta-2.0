import { useRef, useState } from 'preact/hooks';
import type { Account, DayFigure, Tx } from '../domain/daily.ts';
import { accountBalance } from '../domain/daily.ts';
import type { State } from '../data/store.ts';
import { Icon, Sq, catIcon } from '../ui/kit.tsx';
import { dayHeader, dayMonth, daysWord, hhmm, signed, tenge } from '../ui/format.ts';
import { SPRING, reduced, useSwipe, useTween } from '../ui/motion.ts';

const TONE: Record<string, string> = { card: 'dew', cash: 'dawn' };

// ───────── one operation row: swipe left to delete, right to repeat, tap to edit ─────────

interface RowProps {
  tx: Tx;
  accounts: Account[];
  onEdit: () => void;
  onDelete: () => void;
  onRepeat: () => void;
}

function Row({ tx, accounts, onEdit, onDelete, onRepeat }: RowProps) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const OPEN = -92;

  const collapse = (then: () => void) => {
    const el = wrap.current;
    if (!el || reduced()) return then();
    const h = el.offsetHeight;
    el.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 260, easing: SPRING.easing, fill: 'forwards' }).finished.then(then, then);
  };

  const sw = useSwipe({
    axis: 'x',
    onStart: () => setDragging(true),
    onMove: (d) => {
      const base = open ? OPEN : 0;
      const x = base + d;
      setDx(x > 0 ? Math.min(x, 110) * 0.8 : x); // resist a little to the right
    },
    onEnd: (d, v) => {
      setDragging(false);
      const w = wrap.current?.offsetWidth ?? 360;
      const x = (open ? OPEN : 0) + d;
      if (x < -w * 0.5 || (v < -0.9 && x < -40)) {
        setDx(-w);
        setTimeout(() => collapse(onDelete), 160);
        return;
      }
      if (x > 72) {
        setDx(0);
        setOpen(false);
        onRepeat();
        return;
      }
      const stay = x < OPEN / 2;
      setOpen(stay);
      setDx(stay ? OPEN : 0);
    },
    onCancel: () => {
      setDragging(false);
      setDx(open ? OPEN : 0);
    },
  });

  const acc = accounts.find((a) => a.id === tx.accountId);
  const to = tx.toAccountId ? accounts.find((a) => a.id === tx.toAccountId) : undefined;
  const title = tx.kind === 'transfer' ? 'Перевод' : tx.category;
  const sub = tx.kind === 'transfer' ? `${acc?.name ?? 'Счёт'} → ${to?.name ?? 'Счёт'}` : `${hhmm(tx.at)} · ${acc?.name ?? 'Счёт'}${tx.note ? ' · ' + tx.note : ''}`;
  const sum = tx.kind === 'transfer' ? `${tenge(tx.amount)} ₸` : signed(tx.amount, tx.kind);

  return (
    <div class="row-wrap" ref={wrap}>
      <div class="row-under" aria-hidden="true">
        <span class={`under-left ${dx > 24 ? 'on' : ''}`}><Icon name="repeat" size={20} /> Повторить</span>
        <span class={`under-right ${dx < -24 ? 'on' : ''}`}><Icon name="trash" size={20} /> Удалить</span>
      </div>
      <div class="row" {...sw} style={{ transform: `translateX(${dx}px)`, transition: dragging ? 'none' : undefined }}>
        <button class="row-main" onClick={() => (open ? (setOpen(false), setDx(0)) : onEdit())}>
          <span class="row-ic">
            <Icon name={tx.kind === 'transfer' ? 'swap' : catIcon(tx.category)} size={20} stroke={1.75} />
            <i class={`dot ${TONE[acc?.kind ?? 'card']}`} />
          </span>
          <span class="row-text">
            {title}
            <small>{sub}</small>
          </span>
          <span class={`row-sum ${tx.kind}`}>{sum}</span>
        </button>
      </div>
      {open && (
        <button class="row-del" style={{ width: `${-OPEN - 8}px` }} onClick={() => { setDx(-(wrap.current?.offsetWidth ?? 360)); setTimeout(() => collapse(onDelete), 160); }}>
          <Icon name="trash" size={20} /> Удалить
        </button>
      )}
    </div>
  );
}

// ───────── Сегодня ─────────

interface TodayProps {
  s: State;
  figure: DayFigure;
  now: number;
  onUntil: (ymd: string) => void;
  onAdd: (kind: 'expense' | 'income') => void;
  onEdit: (tx: Tx) => void;
  onSetup: () => void;
  onRemove: (id: string) => void;
  onRepeat: (tx: Tx) => void;
  onMoney: () => void;
  onProfile: () => void;
}

export function Today(p: TodayProps) {
  const { s, figure } = p;
  const has = s.accounts.length > 0;
  const over = figure.left < 0;
  const shown = useTween(Math.abs(figure.left));
  const spentShown = useTween(figure.spent);

  const groups: Array<{ title: string; items: Tx[] }> = [];
  for (const tx of s.txs.slice(0, 120)) {
    const title = dayHeader(tx.at, p.now);
    const g = groups[groups.length - 1];
    if (g && g.title === title) g.items.push(tx);
    else groups.push({ title, items: [tx] });
  }

  const initial = s.user?.name?.trim()?.[0]?.toUpperCase();

  return (
    <>
      <header class="hero">
        <div class="hero-top rise" style="--i:0">
          {has ? (
            <label class="until">
              <Icon name="calendar" size={16} />
              до {dayMonth(s.settings.until)} · {figure.daysLeft} {daysWord(figure.daysLeft)}
              <input type="date" aria-label="Дотянуть до" value={s.settings.until} onInput={(e) => e.currentTarget.value && p.onUntil(e.currentTarget.value)} />
            </label>
          ) : (
            <span />
          )}
          <button class={`me sync-${s.sync}`} aria-label={s.user ? `Профиль: ${s.user.name || s.user.email}` : 'Войти и синхронизировать'} onClick={p.onProfile}>
            {initial ?? <Icon name="user" size={20} />}
            <i aria-hidden="true" />
          </button>
        </div>

        {has ? (
          <>
            <p class="hero-label rise" style="--i:1">{over ? 'Сверх цифры дня' : 'Можно потратить сегодня'}</p>
            <p class={`hero-figure rise ${over ? 'over' : ''}`} style="--i:1">
              <span class="num">{tenge(shown)}</span>
              <span class="cur">₸</span>
            </p>
            <div class="hero-actions rise" style="--i:2">
              <button class="pill pill-main" onClick={() => p.onAdd('expense')}>
                <span class="pill-ic"><Icon name="out" size={14} stroke={2.5} /></span>
                Расход
              </button>
              <button class="pill" onClick={() => p.onAdd('income')}>Доход</button>
            </div>
            <button class="stack rise" style="--i:2" aria-label="Счета" onClick={p.onMoney}>
              <span class="c1" /><span class="c2" /><span class="c3" />
            </button>
            <Sq r={26} class="spent rise" style="--i:3">
              <div>
                <span class="muted-d">Потрачено сегодня</span>
                <b>
                  {tenge(spentShown)} ₸ <span class="of">из {tenge(figure.allowance)}</span>
                </b>
              </div>
              <div class="bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${Math.min(1, figure.allowance ? figure.spent / figure.allowance : 0)})` }} class={over ? 'over' : ''} />
              </div>
            </Sq>
          </>
        ) : (
          s.ready && (
            <Sq r={28} class="welcome rise" style="--i:1">
              <h1>Сколько можно тратить каждый день</h1>
              <p>Введите, сколько денег у вас сейчас и до какого дня их должно хватить. Qalta посчитает цифру дня и будет пересчитывать её после каждой записи.</p>
              <Sq tag="button" r={20} class="primary light" onClick={p.onSetup}>
                Начать
              </Sq>
            </Sq>
          )
        )}
      </header>

      {has && (
        <section class="list rise" style="--i:4" aria-label="Операции">
          <div class="sheet-grab static"><span /></div>
          <h2 class="list-title">Операции</h2>
          {groups.length === 0 && <p class="empty">Записей пока нет. Первую можно сделать кнопкой «Расход».</p>}
          {groups.length > 0 && <p class="list-tip">Свайп влево — удалить, вправо — повторить, нажатие — изменить</p>}
          {groups.map((g) => (
            <div key={g.title}>
              <h3 class="day">{g.title}</h3>
              {g.items.map((tx) => (
                <Row key={tx.id} tx={tx} accounts={s.accounts} onEdit={() => p.onEdit(tx)} onDelete={() => p.onRemove(tx.id)} onRepeat={() => p.onRepeat(tx)} />
              ))}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

// ───────── Деньги ─────────

export function Money({ s, figure, onAccount }: { s: State; figure: DayFigure; onAccount: (a: Account) => void }) {
  return (
    <div class="page">
      <h1 class="page-title rise" style="--i:0">Деньги</h1>
      {s.accounts.length === 0 && <p class="empty-d">Счета появятся после первого запуска на экране «Сегодня».</p>}
      {s.accounts.map((a, i) => (
        <div class={`glow ${TONE[a.kind]} rise`} style={`--i:${i + 1}`} key={a.id}>
          <Sq tag="button" r={26} class={`card ${TONE[a.kind]}`} onClick={() => onAccount(a)} aria-label={`${a.name}: изменить остаток или перевести`}>
            <span class="card-name">{a.name}</span>
            <span class="card-sum">{tenge(accountBalance(a, s.txs))} ₸</span>
            <span class="card-hint">Остаток · перевод</span>
          </Sq>
        </div>
      ))}
      {s.accounts.length > 0 && (
        <p class="muted-d rise" style="--i:3">
          Всего {tenge(figure.balance)} ₸ · до {dayMonth(s.settings.until)} это {tenge(figure.allowance)} ₸ в день.
        </p>
      )}
      <Sq r={26} class="soon rise" style="--i:4">
        <b>Конверты и распределение дохода</b>
        <span>Следующий этап: «близким», «подушка», обязательные платежи и ритуал гонорара.</span>
      </Sq>
    </div>
  );
}

// ───────── Люди ─────────

export function People() {
  return (
    <div class="page">
      <h1 class="page-title rise" style="--i:0">Люди</h1>
      <Sq r={26} class="soon rise" style="--i:1">
        <b>Долги и помощь близким</b>
        <span>Здесь будут люди, кто кому должен и возвраты.</span>
      </Sq>
    </div>
  );
}

// ───────── account sheet: correct the balance or move money ─────────

const digits = (v: string) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 9);

export function AccountSheet({ account, accounts, txs, onAdjust, onTransfer }: { account: Account; accounts: Account[]; txs: Tx[]; onAdjust: (amount: number) => void; onTransfer: (to: string, amount: number) => void }) {
  const [mode, setMode] = useState<'adjust' | 'transfer'>('adjust');
  const current = accountBalance(account, txs);
  const [value, setValue] = useState(String(Math.max(0, current)));
  const others = accounts.filter((a) => a.id !== account.id);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const n = Number(value || 0), m = Number(amount || 0);
  return (
    <form class="setup" onSubmit={(e) => { e.preventDefault(); mode === 'adjust' ? onAdjust(n) : m > 0 && to && onTransfer(to, m); }}>
      <h2>{account.name}</h2>
      <div class="seg" role="radiogroup" aria-label="Действие">
        <button type="button" role="radio" aria-checked={mode === 'adjust'} class={mode === 'adjust' ? 'on' : ''} onClick={() => setMode('adjust')}>Остаток</button>
        <button type="button" role="radio" aria-checked={mode === 'transfer'} class={mode === 'transfer' ? 'on' : ''} onClick={() => setMode('transfer')} disabled={!others.length}>Перевод</button>
      </div>
      {mode === 'adjust' ? (
        <>
          <p class="muted">Сейчас по записям: {tenge(current)} ₸. Если на самом деле другая сумма, введите её: прошлые записи останутся в истории.</p>
          <label class="field">
            <span>На самом деле</span>
            <input inputMode="numeric" autoComplete="off" value={value ? tenge(n) : ''} placeholder="0" onInput={(e) => setValue(digits(e.currentTarget.value))} />
            <b>₸</b>
          </label>
          <Sq tag="button" r={20} class="primary" type="submit" disabled={n === current}>Сохранить остаток</Sq>
        </>
      ) : (
        <>
          <p class="muted">Перевод между своими счетами не тратит цифру дня.</p>
          <div class="seg seg-small" role="radiogroup" aria-label="Куда">
            {others.map((a) => (
              <button type="button" key={a.id} role="radio" aria-checked={to === a.id} class={to === a.id ? 'on' : ''} onClick={() => setTo(a.id)}>На «{a.name}»</button>
            ))}
          </div>
          <label class="field">
            <span>Сумма</span>
            <input inputMode="numeric" autoComplete="off" value={amount ? tenge(m) : ''} placeholder="0" onInput={(e) => setAmount(digits(e.currentTarget.value))} />
            <b>₸</b>
          </label>
          <Sq tag="button" r={20} class="primary" type="submit" disabled={!m}>Перевести {m ? `${tenge(m)} ₸` : ''}</Sq>
        </>
      )}
    </form>
  );
}

// ───────── profile: Google sign-in and sync ─────────

const SYNC_TEXT: Record<string, string> = {
  off: 'Синхронизация выключена',
  connecting: 'Подключаюсь к облаку…',
  on: 'Синхронизировано',
  offline: 'Нет сети: изменения уйдут в облако, когда она появится',
  error: 'Ошибка синхронизации',
};

export function Profile({ s, onSignIn, onSignOut }: { s: State; onSignIn: () => void; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div class="setup">
      {s.user ? (
        <>
          <h2>{s.user.name || 'Аккаунт Google'}</h2>
          <p class="muted">{s.user.email}</p>
          <p class={`sync-line sync-${s.sync}`}><Icon name="cloud" size={18} /> {SYNC_TEXT[s.sync]}</p>
          {s.syncNote && <p class="muted warn-text">{s.syncNote}</p>}
          <p class="muted small">Данные хранятся на этом телефоне и копируются в облако. После входа на другом устройстве записи появятся и там.</p>
          <Sq tag="button" r={20} class="primary ghost" onClick={onSignOut}>Выйти из аккаунта</Sq>
        </>
      ) : (
        <>
          <h2>Вход через Google</h2>
          <p class="muted">Без входа всё работает, но данные живут только на этом устройстве. После входа они сохраняются в облаке и появляются на других устройствах.</p>
          {s.syncNote && <p class="muted warn-text">{s.syncNote}</p>}
          <Sq tag="button" r={20} class="primary" disabled={busy || s.sync === 'connecting'} onClick={async () => { setBusy(true); try { await onSignIn(); } finally { setBusy(false); } }}>
            {busy || s.sync === 'connecting' ? 'Открываю Google…' : 'Войти через Google'}
          </Sq>
          <p class="muted small">Используются только имя и почта аккаунта. Аналитики и рекламы нет.</p>
        </>
      )}
    </div>
  );
}

