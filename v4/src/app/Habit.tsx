import { useState } from 'preact/hooks';
import type { Tx } from '../domain/daily.ts';
import type { HabitStats, WeekSummary, Wish } from '../domain/habit.ts';
import { wishDays, wishReady } from '../domain/habit.ts';
import { Icon, Sq, catIcon } from '../ui/kit.tsx';
import { daysWord, hhmm, signed, tenge } from '../ui/format.ts';

const digits = (v: string) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 9);

// ───────── the card at the top of today's list ─────────

export function HabitCard({ stats, due, sunday, onCheck, onWeek }: { stats: HabitStats; due: boolean; sunday: boolean; onCheck: () => void; onWeek: () => void }) {
  if (due) {
    return (
      <Sq tag="button" r={22} class="habit due" onClick={onCheck}>
        <span class="habit-ic"><Icon name="calendar" size={20} /></span>
        <span class="habit-text"><b>Вечерняя сверка</b><small>30 секунд: всё ли записано за сегодня</small></span>
        <span class="habit-go">Сверить</span>
      </Sq>
    );
  }
  if (sunday && stats.doneToday) {
    return (
      <Sq tag="button" r={22} class="habit" onClick={onWeek}>
        <span class="habit-ic"><Icon name="repeat2" size={20} /></span>
        <span class="habit-text"><b>Недельный обзор</b><small>Три факта и одно решение на следующую неделю</small></span>
        <span class="habit-go">Открыть</span>
      </Sq>
    );
  }
  if (!stats.doneToday && stats.streak === 0) return null;
  return (
    <p class="habit-line">
      {stats.doneToday ? 'Сверка сделана' : 'Сверка вечером'} · серия {stats.streak} · {stats.last30} из 30 дней
    </p>
  );
}

// ───────── evening check-in ─────────

export function CheckinSheet({ today, spent, left, stats, onDone, onAdd, onRest }: { today: Tx[]; spent: number; left: number; stats: HabitStats; onDone: () => void; onAdd: () => void; onRest: (amount: number) => void }) {
  const [rest, setRest] = useState('');
  const r = Number(rest || 0);
  return (
    <div class="setup">
      <h2>Сверка дня</h2>
      <p class="muted">
        {today.length ? `Сегодня записано ${today.length} — расходы ${tenge(spent)} ₸.` : 'Сегодня записей нет.'} {left >= 0 ? `До конца дня остаётся ${tenge(left)} ₸.` : `Сверх цифры дня на ${tenge(-left)} ₸.`}
      </p>
      {today.length > 0 && (
        <ul class="mini-list">
          {today.slice(0, 8).map((t) => (
            <li key={t.id}>
              <Icon name={t.kind === 'transfer' ? 'swap' : catIcon(t.category)} size={18} />
              <span>{t.kind === 'transfer' ? 'Перевод' : t.category}<small>{hhmm(t.at)}{t.note ? ' · ' + t.note : ''}</small></span>
              <b>{t.kind === 'transfer' ? `${tenge(t.amount)} ₸` : signed(t.amount, t.kind)}</b>
            </li>
          ))}
          {today.length > 8 && <li class="more">и ещё {today.length - 8}</li>}
        </ul>
      )}
      <p class="muted">Всё записано?</p>
      <Sq tag="button" r={20} class="primary" onClick={onDone}>Да, всё верно</Sq>
      <div class="entry-actions">
        <Sq tag="button" r={20} class="primary ghost" onClick={onAdd}>Добавить запись</Sq>
      </div>
      <p class="muted small">Не помните мелочи? Запишите их одной суммой — точность важнее идеала.</p>
      <label class="field">
        <span>Прочее за день</span>
        <input inputMode="numeric" autoComplete="off" placeholder="0" value={rest ? tenge(r) : ''} onInput={(e) => setRest(digits(e.currentTarget.value))} />
        <b>₸</b>
      </label>
      {r > 0 && <Sq tag="button" r={20} class="primary ghost" onClick={() => onRest(r)}>Записать {tenge(r)} ₸ и закрыть день</Sq>}
      <p class="muted small center">Серия: {stats.streak} {daysWord(stats.streak)} · {stats.last30} из последних 30. Один пропуск серию не обнуляет.</p>
    </div>
  );
}

// ───────── weekly review ─────────

export function WeeklySheet({ week, decision, onSave }: { week: WeekSummary; decision: string; onSave: (d: string) => void }) {
  const [text, setText] = useState(decision);
  const diff = week.spent - week.prevSpent;
  return (
    <div class="setup">
      <h2>Неделя</h2>
      <ul class="facts">
        <li>
          <b>{tenge(week.spent)} ₸</b>
          <span>{week.prevSpent ? (diff > 0 ? `потрачено, на ${tenge(diff)} ₸ больше прошлой недели` : diff < 0 ? `потрачено, на ${tenge(-diff)} ₸ меньше прошлой недели` : 'потрачено, как и на прошлой неделе') : 'потрачено за неделю'}</span>
        </li>
        <li>
          <b>{week.topCategory || '—'}</b>
          <span>{week.topCategory ? `больше всего: ${tenge(week.topAmount)} ₸ (${week.spent ? Math.round((week.topAmount / week.spent) * 100) : 0} %)` : 'трат пока нет'}</span>
        </li>
        <li>
          <b>{week.checkins} из 7</b>
          <span>вечеров со сверкой · записей за неделю: {week.records}</span>
        </li>
      </ul>
      <label class="field stacked">
        <span>Одно решение на следующую неделю</span>
        <input type="text" maxLength={200} placeholder="Например: кофе только дома по будням" value={text} onInput={(e) => setText(e.currentTarget.value)} />
      </label>
      <p class="muted small">Одно конкретное решение работает лучше списка целей. Начало недели — удобный момент начать заново.</p>
      <Sq tag="button" r={20} class="primary" onClick={() => onSave(text.trim())}>Сохранить</Sq>
    </div>
  );
}

// ───────── wishes: a pause before buying ─────────

export function WishSection({ wishes, allowance, now, onAdd, onBuy, onDrop }: { wishes: Wish[]; allowance: number; now: number; onAdd: () => void; onBuy: (w: Wish) => void; onDrop: (w: Wish) => void }) {
  const waiting = wishes.filter((w) => w.status === 'waiting');
  return (
    <>
      <div class="section-head rise" style="--i:6">
        <h2>Хочу купить</h2>
        <button class="pill pill-main small" onClick={onAdd}>Добавить</button>
      </div>
      {waiting.length === 0 ? (
        <p class="muted-d rise" style="--i:6">Захотелось купить что-то не из плана — запишите сюда и решите через день или неделю. Часть желаний проходит сама.</p>
      ) : (
        <div class="wishes rise" style="--i:6">
          {waiting.map((w) => {
            const ready = wishReady(w, now);
            const left = Math.max(0, Math.ceil((w.decideAt - now) / 86_400_000));
            const days = wishDays(w.price, allowance);
            return (
              <Sq r={22} key={w.id} class={`wish ${ready ? 'ready' : ''}`}>
                <div class="wish-top">
                  <b>{w.title}</b>
                  <span>{tenge(w.price)} ₸</span>
                </div>
                <small>{days ? `≈ ${days} ${daysWord(days)} цифры дня · ` : ''}{ready ? 'пора решить' : `решение через ${left} ${daysWord(left)}`}</small>
                {ready && (
                  <div class="wish-actions">
                    <button class="pill small" onClick={() => onDrop(w)}>Уже не нужно</button>
                    <button class="pill pill-main small" onClick={() => onBuy(w)}>Купить</button>
                  </div>
                )}
              </Sq>
            );
          })}
        </div>
      )}
    </>
  );
}

export function WishSheet({ allowance, onSave }: { allowance: number; onSave: (title: string, price: number, waitDays: number) => void }) {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [wait, setWait] = useState(1);
  const p = Number(price || 0);
  const days = wishDays(p, allowance);
  return (
    <div class="setup">
      <h2>Хочу купить</h2>
      <label class="field">
        <span>Что</span>
        <input type="text" maxLength={80} placeholder="Например, наушники" value={title} onInput={(e) => setTitle(e.currentTarget.value)} style="text-align:right;font-size:17px" />
      </label>
      <label class="field">
        <span>Сколько</span>
        <input inputMode="numeric" autoComplete="off" placeholder="0" value={price ? tenge(p) : ''} onInput={(e) => setPrice(digits(e.currentTarget.value))} />
        <b>₸</b>
      </label>
      {days > 0 && <p class="muted">Это примерно {days} {daysWord(days)} вашей цифры дня.</p>}
      <p class="muted">Решить через:</p>
      <div class="seg" role="radiogroup" aria-label="Решить через">
        {[[1, '1 день'], [7, '7 дней'], [30, '30 дней']].map(([d, l]) => (
          <button key={d} role="radio" aria-checked={wait === d} class={wait === d ? 'on' : ''} onClick={() => setWait(d as number)}>{l}</button>
        ))}
      </div>
      <Sq tag="button" r={20} class="primary" disabled={!title.trim() || !p} onClick={() => onSave(title.trim(), p, wait)}>Отложить решение</Sq>
    </div>
  );
}
