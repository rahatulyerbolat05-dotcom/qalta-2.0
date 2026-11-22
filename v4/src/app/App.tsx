import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { store } from '../data/store.ts';
import { signIn, signOut } from '../data/sync.ts';
import { dayFigure, startOfDay, type Account, type Tx } from '../domain/daily.ts';
import { Sheet, Tabs, Toast, type ToastData } from '../ui/kit.tsx';
import { signed, tenge } from '../ui/format.ts';
import { animate, useSwipe } from '../ui/motion.ts';
import { useStore, useToday } from './useStore.ts';
import { Entry } from './Entry.tsx';
import { Setup } from './Setup.tsx';
import { AccountSheet, Money, People, Profile, Today } from './Screens.tsx';

type Tab = 'people' | 'today' | 'money';
const ORDER: Tab[] = ['people', 'today', 'money'];
const TABS = [
  { id: 'people' as const, label: 'Люди', icon: 'people' },
  { id: 'today' as const, label: 'Сегодня', icon: 'home' },
  { id: 'money' as const, label: 'Деньги', icon: 'wallet' },
];

type Open =
  | { kind: 'entry'; mode: 'expense' | 'income'; editing: Tx | null }
  | { kind: 'setup' }
  | { kind: 'account'; account: Account }
  | { kind: 'profile' }
  | null;

export function App() {
  const s = useStore();
  const now = useToday();
  const [tab, setTab] = useState<Tab>('today');
  const [sheet, setSheet] = useState<Open>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const figure = dayFigure(s.accounts, s.txs, now, s.settings.until);
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
              onRemove={remove}
              onRepeat={(tx) => {
                const copy = store.addTx({ kind: tx.kind, amount: tx.amount, accountId: tx.accountId, toAccountId: tx.toAccountId, category: tx.category, note: tx.note, at: Date.now() });
                say(`Повторено: ${copy.kind === 'transfer' ? 'перевод' : copy.category} ${tenge(copy.amount)} ₸`, { label: 'Отменить', run: () => store.removeTx(copy.id) });
              }}
            />
          )}
          {tab === 'money' && <Money s={s} figure={figure} onAccount={(account) => setSheet({ kind: 'account', account })} />}
          {tab === 'people' && <People />}
        </div>
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </main>

      <Sheet open={sheet?.kind === 'entry'} label={editing ? 'Изменить запись' : 'Новая запись'} onClose={() => setSheet(null)}>
        {sheet?.kind === 'entry' && (
          <Entry
            key={editing?.id ?? 'new-' + sheet.mode}
            mode={sheet.mode}
            editing={editing}
            accounts={s.accounts}
            txs={s.txs}
            left={leftForEntry}
            onDelete={editing ? () => { setSheet(null); remove(editing.id); } : undefined}
            onSave={(e) => {
              setSheet(null);
              if (editing) {
                store.updateTx(editing.id, e);
                say('Изменения сохранены', { label: 'Отменить', run: () => store.updateTx(editing.id, { kind: editing.kind, amount: editing.amount, category: editing.category, accountId: editing.accountId, at: editing.at, note: editing.note }) });
              } else {
                const tx = store.addTx({ ...e });
                say(`Записано: ${tx.category} ${signed(tx.amount, tx.kind as 'expense' | 'income')}`, { label: 'Отменить', run: () => store.removeTx(tx.id) });
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

      <Sheet open={sheet?.kind === 'profile'} label="Аккаунт" onClose={() => setSheet(null)}>
        <Profile s={s} onSignIn={() => signIn()} onSignOut={() => { void signOut(); setSheet(null); }} />
      </Sheet>

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
