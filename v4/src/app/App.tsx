import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { store } from '../data/store.ts';
import { connectTelegram, signIn, signOut } from '../data/sync.ts';
import { reminderOf } from '../data/store.ts';
import { checkinDue, habitStats, isSunday, weekSummary, type Wish } from '../domain/habit.ts';
import { CheckinSheet, WeeklySheet, WishSheet } from './Habit.tsx';
import { dayFigure, startOfDay, ymd, type Account, type Tx } from '../domain/daily.ts';
import { Sheet, Tabs, Toast, type ToastData } from '../ui/kit.tsx';
import { signed, tenge } from '../ui/format.ts';
import { animate, useSwipe } from '../ui/motion.ts';
import { useStore, useToday } from './useStore.ts';
import { Entry } from './Entry.tsx';
import { Setup } from './Setup.tsx';
import { AccountSheet, Money, People, Profile, Today } from './Screens.tsx';
import { Allocate, Done, EnvelopeSheet } from './Envelopes.tsx';
import { envelopeBalance, planIncome, reservedTotal, type Envelope } from '../domain/envelopes.ts';

type Tab = 'people' | 'today' | 'money';
const ORDER: Tab[] = ['people', 'today', 'money'];
const TABS = [
  { id: 'people' as const, label: 'Люди', icon: 'people' },
  { id: 'today' as const, label: 'Сегодня', icon: 'home' },
  { id: 'money' as const, label: 'Деньги', icon: 'wallet' },
];

type Open =
  | { kind: 'entry'; mode: 'expense' | 'income'; editing: Tx | null; prefill?: { amount: number; note: string; category?: string }; wish?: Wish }
  | { kind: 'checkin' }
  | { kind: 'weekly' }
  | { kind: 'wish' }
  | { kind: 'setup' }
  | { kind: 'account'; account: Account }
  | { kind: 'profile' }
  | { kind: 'envelope'; env: Envelope | null }
  | { kind: 'allocate'; tx: Tx }
  | null;

export function App() {
  const s = useStore();
  const now = useToday();
  const [tab, setTab] = useState<Tab>('today');
  const [sheet, setSheet] = useState<Open>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const reserved = reservedTotal(s.envelopes, s.allocations, s.txs);
  const figure = dayFigure(s.accounts, s.txs, now, s.settings.until, reserved);
  const envBalance = (e: Envelope) => envelopeBalance(e, s.allocations, s.txs);
  const perDayWith = (extraReserved: number) => dayFigure(s.accounts, s.txs, Date.now(), s.settings.until, reserved + extraReserved).allowance;
  const stats = habitStats(s.checkins, now);
  const habit = { stats, due: s.accounts.length > 0 && checkinDue(reminderOf(s.settings), now, stats.doneToday), sunday: isSunday(now) };
  const todayTxs = s.txs.filter((t) => t.at >= startOfDay(now));
  const [done, setDone] = useState<{ amount: number; count: number; perDay: number; from: { x: number; y: number } } | null>(null);
  const say = (text: string, action?: ToastData['action']) => setToast({ id: Date.now(), text, action });
  const page = useRef<HTMLDivElement>(null);
  const prevTab = useRef(tab);

  // Pages slide in from the side they come from.
  useLayoutEffect(() => {
    const from = ORDER.indexOf(prevTab.current), to = ORDER.indexOf(tab);
    prevTab.current = tab;
    if (from === to) return;
    const dir = to > from ? 1 : -1;
    animate(page.current, [{ transform: `translateX(${dir * 36}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }]);
  }, [tab]);

  // Swipe sideways across a page to move between tabs (rows claim their own swipes first).
  const pageSwipe = useSwipe({
    axis: 'x',
    onMove: () => {},
    onEnd: (d, v) => {
      if (Math.abs(d) < 70 && Math.abs(v) < 0.5) return;
      const i = ORDER.indexOf(tab) + (d < 0 ? 1 : -1);
      if (i >= 0 && i < ORDER.length) setTab(ORDER[i]);
    },
  });

  // A toast would cover the sheet's buttons: it goes away when a sheet opens.
  useEffect(() => {
    if (sheet) setToast(null);
  }, [sheet]);

  // Phone back gesture closes the open sheet instead of leaving the app.
  useEffect(() => {
    if (!sheet) return;
    try {
      history.pushState({ sheet: true }, '');
    } catch {
      return; // sandboxed frame: the sheet still closes by swipe, tap outside and Escape
    }
    const onPop = () => setSheet(null);
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('popstate', onPop);
      try {
        if (history.state?.sheet) history.back();
      } catch { /* ignore */ }
    };
  }, [sheet !== null]);

  const remove = (id: string) => {
    const tx = store.removeTx(id);
    if (tx) say(`Удалено: ${tx.kind === 'transfer' ? 'перевод' : tx.category} ${tx.kind === 'transfer' ? tenge(tx.amount) + ' ₸' : signed(tx.amount, tx.kind)}`, { label: 'Отменить', run: () => store.restoreTx(tx) });
  };

  const editing = sheet?.kind === 'entry' ? sheet.editing : null;
  // While editing today's expense, the hint shows the figure as if that entry were not there.
  const leftForEntry = figure.left + (editing && editing.kind === 'expense' && editing.at >= startOfDay(now) ? editing.amount : 0);

  return (
    <div class={`app ${sheet ? 'behind' : ''}`}>
      <main class="screen" inert={sheet ? true : undefined}>
        {!s.persistent && (
          <p class="banner" role="alert">
            Этот браузер не даёт сохранять данные. Записи пропадут после закрытия.
          </p>
        )}
        <div class="page-host" ref={page} {...pageSwipe}>
          {tab === 'today' && (
            <Today
              s={s}
              figure={figure}
              now={now}
              onUntil={(u) => store.setUntil(u)}
              onAdd={(mode) => setSheet({ kind: 'entry', mode, editing: null })}
              onEdit={(tx) => (tx.kind === 'transfer' ? undefined : setSheet({ kind: 'entry', mode: tx.kind, editing: tx }))}
              onSetup={() => setSheet({ kind: 'setup' })}
              onMoney={() => setTab('money')}
              onProfile={() => setSheet({ kind: 'profile' })}
              habit={habit}
              onCheck={() => setSheet({ kind: 'checkin' })}
              onWeek={() => setSheet({ kind: 'weekly' })}
              onRemove={remove}
              onRepeat={(tx) => {
                const copy = store.addTx({ kind: tx.kind, amount: tx.amount, accountId: tx.accountId, toAccountId: tx.toAccountId, category: tx.category, note: tx.note, at: Date.now() });
                say(`Повторено: ${copy.kind === 'transfer' ? 'перевод' : copy.category} ${tenge(copy.amount)} ₸`, { label: 'Отменить', run: () => store.removeTx(copy.id) });
              }}
            />
          )}
          {tab === 'money' && (
            <Money
              s={s}
              figure={figure}
              reserved={reserved}
              envBalance={envBalance}
              onAccount={(account) => setSheet({ kind: 'account', account })}
              onEnvelope={(env) => setSheet({ kind: 'envelope', env })}
              now={now}
              onWish={() => setSheet({ kind: 'wish' })}
              onBuyWish={(w) => setSheet({ kind: 'entry', mode: 'expense', editing: null, prefill: { amount: w.price, note: w.title, category: 'Прочее' }, wish: w })}
              onDropWish={(w) => {
                store.setWish(w.id, { status: 'dropped' });
                say(`«${w.title}» не куплено: ${tenge(w.price)} ₸ остались у вас`, { label: 'Отменить', run: () => store.setWish(w.id, { status: 'waiting' }) });
              }}
              onPresets={() => {
                store.saveEnvelope({ name: 'Близким', kind: 'reserve', ruleMode: 'percent', ruleValue: 20, target: 0 });
                store.saveEnvelope({ name: 'Подушка', kind: 'goal', ruleMode: 'percent', ruleValue: 10, target: 100_000 });
                say('Конверты созданы. Проценты и цель можно поменять');
              }}
            />
          )}
          {tab === 'people' && <People />}
        </div>
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </main>

      <Sheet open={sheet?.kind === 'entry'} label={editing ? 'Изменить запись' : 'Новая запись'} onClose={() => setSheet(null)}>
        {sheet?.kind === 'entry' && (
          <Entry
            key={editing?.id ?? 'new-' + sheet.mode + (sheet.wish?.id ?? '')}
            prefill={sheet.prefill}
            mode={sheet.mode}
            editing={editing}
            accounts={s.accounts}
            txs={s.txs}
            envelopes={s.envelopes}
            envBalance={envBalance}
            left={leftForEntry}
            onDelete={editing ? () => { setSheet(null); remove(editing.id); } : undefined}
            onSave={(e) => {
              setSheet(null);
              if (editing) {
                store.updateTx(editing.id, e);
                say('Изменения сохранены', { label: 'Отменить', run: () => store.updateTx(editing.id, { kind: editing.kind, amount: editing.amount, category: editing.category, accountId: editing.accountId, at: editing.at, note: editing.note, envelopeId: editing.envelopeId }) });
              } else {
                const tx = store.addTx({ ...e });
                if (sheet.wish) store.setWish(sheet.wish.id, { status: 'bought' });
                // A new income opens the split right away, while the money is still whole.
                const plan = tx.kind === 'income' ? planIncome(tx.amount, s.envelopes, new Map(s.envelopes.map((x) => [x.id, envBalance(x)]))) : null;
                if (plan && plan.lines.length) setTimeout(() => setSheet({ kind: 'allocate', tx }), 380);
                else say(`Записано: ${tx.category} ${signed(tx.amount, tx.kind as 'expense' | 'income')}`, { label: 'Отменить', run: () => store.removeTx(tx.id) });
              }
            }}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.kind === 'setup'} label="Начало" onClose={() => setSheet(null)}>
        <Setup
          onDone={(card, cash, until) => {
            store.setup(card, cash, until);
            setSheet(null);
          }}
        />
      </Sheet>

      <Sheet open={sheet?.kind === 'account'} label="Счёт" onClose={() => setSheet(null)}>
        {sheet?.kind === 'account' && (
          <AccountSheet
            account={sheet.account}
            accounts={s.accounts}
            txs={s.txs}
            onAdjust={(amount) => {
              const before = sheet.account;
              store.adjustAccount(before.id, amount);
              setSheet(null);
              say(`Остаток «${before.name}»: ${tenge(amount)} ₸`);
            }}
            onTransfer={(to, amount) => {
              const tx = store.addTx({ kind: 'transfer', amount, accountId: sheet.account.id, toAccountId: to, category: '', note: '', at: Date.now() });
              setSheet(null);
              say(`Переведено ${tenge(amount)} ₸`, { label: 'Отменить', run: () => store.removeTx(tx.id) });
            }}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.kind === 'envelope'} label="Конверт" onClose={() => setSheet(null)}>
        {sheet?.kind === 'envelope' && (
          <EnvelopeSheet
            key={sheet.env?.id ?? 'new'}
            env={sheet.env}
            balance={sheet.env ? envBalance(sheet.env) : 0}
            onSave={(e) => {
              store.saveEnvelope({ ...e, id: sheet.env?.id });
              setSheet(null);
            }}
            onMove={(amount) => {
              const env = sheet.env!;
              const a = store.moveEnvelope(env.id, amount);
              setSheet(null);
              say(amount > 0 ? `В «${env.name}» +${tenge(amount)} ₸` : `Из «${env.name}» ${tenge(-amount)} ₸ в свободные`, { label: 'Отменить', run: () => store.undoAllocations([a.id]) });
            }}
            onDelete={() => {
              const env = sheet.env!;
              store.removeEnvelope(env.id);
              setSheet(null);
              say(`Конверт «${env.name}» удалён, деньги вернулись в свободные`);
            }}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.kind === 'allocate'} label="Разложить доход" onClose={() => setSheet(null)}>
        {sheet?.kind === 'allocate' && (
          <Allocate
            income={sheet.tx.amount}
            envelopes={s.envelopes}
            plan={planIncome(sheet.tx.amount, s.envelopes, new Map(s.envelopes.map((x) => [x.id, envBalance(x)])))}
            perDayAfter={(free) => perDayWith(sheet.tx.amount - free)}
            onSkip={() => setSheet(null)}
            onConfirm={(lines, from) => {
              const given = lines.reduce((a, l) => a + l.amount, 0);
              const recs = store.allocate(sheet.tx.id, lines);
              const perDay = perDayWith(given);
              setSheet(null);
              setDone({ amount: given, count: recs.length, perDay, from });
              setTimeout(() => say(`Разложено ${tenge(given)} ₸`, { label: 'Отменить', run: () => store.undoAllocations(recs.map((r) => r.id)) }), 900);
            }}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.kind === 'profile'} label="Аккаунт" onClose={() => setSheet(null)}>
        <Profile s={s} onSignIn={() => signIn()} onSignOut={() => { void signOut(); setSheet(null); }} onReminder={(r) => store.setReminder(r)} onTelegram={() => connectTelegram()} />
      </Sheet>

      <Sheet open={sheet?.kind === 'checkin'} label="Сверка дня" onClose={() => setSheet(null)}>
        {sheet?.kind === 'checkin' && (
          <CheckinSheet
            today={todayTxs}
            spent={figure.spent}
            left={figure.left}
            stats={stats}
            onAdd={() => setSheet({ kind: 'entry', mode: 'expense', editing: null })}
            onDone={() => {
              const day = ymd(Date.now());
              store.checkIn(day);
              setSheet(null);
              say(`День сверен · серия ${habitStats([...s.checkins, { id: day, day, done: true, at: Date.now(), decision: '', updatedAt: 1 }], Date.now()).streak}`, { label: 'Отменить', run: () => store.undoCheckIn(day) });
            }}
            onRest={(amount) => {
              const tx = store.addTx({ kind: 'expense', amount, accountId: s.accounts.find((a) => a.kind === 'cash')?.id ?? s.accounts[0].id, category: 'Прочее', note: 'прочее за день', at: Date.now() });
              const day = ymd(Date.now());
              store.checkIn(day);
              setSheet(null);
              say(`Записано ${tenge(amount)} ₸, день сверен`, { label: 'Отменить', run: () => { store.removeTx(tx.id); store.undoCheckIn(day); } });
            }}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.kind === 'weekly'} label="Недельный обзор" onClose={() => setSheet(null)}>
        {sheet?.kind === 'weekly' && (
          <WeeklySheet
            week={weekSummary(s.txs, s.checkins, Date.now())}
            decision={s.checkins.find((c) => c.day === ymd(now))?.decision ?? ''}
            onSave={(d) => {
              store.checkIn(ymd(Date.now()), d);
              setSheet(null);
              say(d ? 'Решение на неделю сохранено' : 'Обзор закрыт');
            }}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.kind === 'wish'} label="Хочу купить" onClose={() => setSheet(null)}>
        {sheet?.kind === 'wish' && (
          <WishSheet
            allowance={figure.allowance}
            onSave={(title, price, wait) => {
              const w = store.addWish(title, price, wait);
              setSheet(null);
              say(`«${title}» подождёт ${wait === 1 ? 'до завтра' : wait + ' дней'}`, { label: 'Отменить', run: () => store.setWish(w.id, { deleted: true }) });
            }}
          />
        )}
      </Sheet>

      <Toast toast={toast} onDone={() => setToast(null)} />
      <Done data={done} onClose={() => setDone(null)} />
    </div>
  );
}
