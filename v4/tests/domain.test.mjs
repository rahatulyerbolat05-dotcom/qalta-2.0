import test from 'node:test';
import assert from 'node:assert/strict';
import { press, evaluate, amountOf, describe, hasOperator } from '../src/domain/calc.ts';
import { dayFigure, daysUntil, accountBalance, ymd, momentOn, categoryUsage } from '../src/domain/daily.ts';
import { newer, pickIncoming, pending } from '../src/domain/merge.ts';

const type = (keys) => keys.reduce((e, k) => press(e, k), '');

test('keypad builds whole numbers and drops leading zeros', () => {
  assert.equal(type(['0', '0', '5']), '5');
  assert.equal(type(['1', '2', '000']), '12000');
  assert.equal(type(['000']), '', '000 needs a number first');
  assert.equal(type(['0', '000']), '0', '000 after a zero does nothing');
  assert.equal(type(['9', '9', '9', '9', '9', '9', '9', '9', '9', '9']), '999999999', 'at most 9 digits');
  assert.equal(type(['1', '2', 'back']), '1');
});

test('operators: no leading operator, a second one replaces the first', () => {
  assert.equal(type(['+']), '');
  assert.equal(type(['5', '+', '-']), '5-');
  assert.equal(type(['5', '+', '0', '7']), '5+7');
});

test('evaluation follows the usual precedence and refuses division by zero', () => {
  assert.equal(evaluate('1200+900'), 2100);
  assert.equal(evaluate('100+2*3'), 106);
  assert.equal(evaluate('2800/2'), 1400);
  assert.equal(evaluate('10-'), 10, 'a trailing operator is ignored');
  assert.equal(evaluate('5/0'), null);
  assert.equal(amountOf('5/0'), 0);
  assert.equal(amountOf('100-300'), 0, 'a negative result cannot be saved');
  assert.equal(amountOf('1000/3'), 333);
  assert.equal(amountOf(''), 0);
});

test('the expression line reads like the keypad', () => {
  assert.equal(describe('1200+900*2'), '1 200 + 900 × 2');
  assert.equal(hasOperator('1200'), false);
  assert.equal(hasOperator('1200+'), true);
});

const NOW = new Date(2026, 10, 22, 18, 0).getTime(); // 22 Nov 2026, 18:00
const H = 3_600_000;
const card = { id: 'card', name: 'Карта', kind: 'card', openingAmount: 140_000, openingAt: NOW - 48 * H, order: 0, updatedAt: 1 };
const cash = { id: 'cash', name: 'Наличные', kind: 'cash', openingAmount: 0, openingAt: NOW - 48 * H, order: 1, updatedAt: 1 };
const tx = (o) => ({ id: Math.random().toString(36), note: '', category: 'Кафе', createdAt: o.at, updatedAt: o.at, ...o });

test('days until the chosen date include today and never drop below one', () => {
  assert.equal(daysUntil(NOW, '2026-11-22'), 1);
  assert.equal(daysUntil(NOW, '2026-12-05'), 14);
  assert.equal(daysUntil(NOW, '2026-11-01'), 1, 'a date in the past still divides by one');
});

test('balance counts only operations after the moment the amount was entered', () => {
  const ops = [tx({ kind: 'expense', amount: 500, accountId: 'card', at: NOW - 72 * H }), tx({ kind: 'expense', amount: 700, accountId: 'card', at: NOW - H })];
  assert.equal(accountBalance(card, ops), 139_300);
});

test('day figure: start-of-day money split over the days left, minus what was spent today', () => {
  const ops = [
    tx({ kind: 'expense', amount: 2000, accountId: 'card', at: NOW - 30 * H }), // yesterday
    tx({ kind: 'expense', amount: 1200, accountId: 'card', at: NOW - 2 * H }),
    tx({ kind: 'expense', amount: 900, accountId: 'cash', at: NOW - H }),
  ];
  const f = dayFigure([card, cash], ops, NOW, '2026-12-05');
  assert.equal(f.daysLeft, 14);
  assert.equal(f.balance, 140_000 - 2000 - 1200 - 900);
  assert.equal(f.allowance, Math.floor((140_000 - 2000) / 14)); // 9857
  assert.equal(f.spent, 2100);
  assert.equal(f.left, f.allowance - 2100);
});

test('income today raises today\'s figure; overspending shows as a negative remainder', () => {
  const ops = [tx({ kind: 'income', amount: 14_000, accountId: 'card', at: NOW - H }), tx({ kind: 'expense', amount: 20_000, accountId: 'card', at: NOW })];
  const f = dayFigure([card], ops, NOW, '2026-12-05');
  assert.equal(f.allowance, Math.floor((140_000 + 14_000) / 14));
  assert.ok(f.left < 0);
});

test('no accounts means a zero figure, not a made-up one', () => {
  const f = dayFigure([], [], NOW, '2026-12-05');
  assert.deepEqual([f.allowance, f.spent, f.left, f.balance], [0, 0, 0, 0]);
  assert.equal(ymd(NOW), '2026-11-22');
});

import { squirclePath } from '../src/ui/squircle.ts';

test('squircle path: closed, within the box, smoothing stretches the corner along the edge', () => {
  const p = squirclePath(200, 100, 20, 0.6);
  assert.ok(p.startsWith('M168 0'), 'corner starts (1 + 0.6) × 20 = 32 px from the edge: ' + p.slice(0, 12));
  assert.ok(p.endsWith('Z'));
  assert.equal(squirclePath(200, 100, 20, 0).slice(0, 6), 'M180 0', 'no smoothing = a plain radius');
  const tight = squirclePath(40, 40, 18, 0.6);
  assert.ok(tight.startsWith('M20 0'), 'smoothing gives way when the corner has no room');
  assert.equal(squirclePath(50, 50, 0), 'M0 0H50V50H0Z');
});

test('transfers move money between accounts without counting as spending', () => {
  const ops = [tx({ kind: 'transfer', amount: 5000, accountId: 'card', toAccountId: 'cash', category: '', at: NOW - H })];
  assert.equal(accountBalance(card, ops), 135_000);
  assert.equal(accountBalance(cash, ops), 5000);
  const f = dayFigure([card, cash], ops, NOW, '2026-12-05');
  assert.equal(f.spent, 0);
  assert.equal(f.balance, 140_000);
});

test('deleted records are ignored everywhere; a correction moves the anchor', () => {
  const gone = tx({ kind: 'expense', amount: 9000, accountId: 'card', at: NOW - H, deleted: true });
  assert.equal(accountBalance(card, [gone]), 140_000);
  assert.equal(dayFigure([card], [gone], NOW, '2026-12-05').spent, 0);
  const corrected = { ...card, openingAmount: 100_000, openingAt: NOW };
  const before = tx({ kind: 'expense', amount: 700, accountId: 'card', at: NOW - H });
  assert.equal(accountBalance(corrected, [before]), 100_000, 'the corrected amount already includes earlier spending');
  assert.equal(dayFigure([{ ...card, deleted: true }], [], NOW, '2026-12-05').balance, 0);
});

test('a past day keeps the current time of day and never lands in the future', () => {
  const t = momentOn('2026-11-21', NOW);
  assert.equal(new Date(t).getDate(), 21);
  assert.equal(new Date(t).getHours(), 18);
  assert.ok(momentOn('2026-11-30', NOW) <= NOW);
  assert.equal(momentOn('2026-11-22', NOW + 42_123), NOW + 42_123, 'today is the exact moment, not rounded to the minute');
});

test('an expense recorded seconds after setup counts toward today', () => {
  const opened = { ...card, openingAt: NOW + 30_000 };
  const later = NOW + 50_000;
  const e = tx({ kind: 'expense', amount: 2500, accountId: 'card', at: momentOn(ymd(later), later) });
  const f = dayFigure([opened], [e], later, '2026-12-05');
  assert.equal(f.spent, 2500);
  assert.equal(f.balance, 137_500);
});

test('category usage counts live operations of one side', () => {
  const ops = [tx({ kind: 'expense', amount: 1, accountId: 'card', at: 1, category: 'Такси' }), tx({ kind: 'expense', amount: 1, accountId: 'card', at: 2, category: 'Такси' }), tx({ kind: 'expense', amount: 1, accountId: 'card', at: 3, category: 'Кафе', deleted: true }), tx({ kind: 'income', amount: 1, accountId: 'card', at: 4, category: 'Гонорар' })];
  assert.deepEqual([...categoryUsage(ops, 'expense')], [['Такси', 2]]);
});

test('merge: the later update wins, ties go to the larger device id, deletions win over older copies', () => {
  const a = { id: 'x', updatedAt: 10, deviceId: 'a' };
  assert.equal(newer({ id: 'x', updatedAt: 11 }, a), true);
  assert.equal(newer({ id: 'x', updatedAt: 9 }, a), false);
  assert.equal(newer({ id: 'x', updatedAt: 10, deviceId: 'b' }, a), true);
  assert.equal(newer({ id: 'x', updatedAt: 10, deviceId: 'a' }, a), false, 'the same copy is not applied twice');
  const local = new Map([['x', { id: 'x', updatedAt: 20, deleted: true }]]);
  assert.deepEqual(pickIncoming(local, [{ id: 'x', updatedAt: 15 }, { id: 'y', updatedAt: 1 }]).map((r) => r.id), ['y']);
  assert.deepEqual(pending([{ id: 'p', updatedAt: 5 }, { id: 'q', updatedAt: 9 }], 5).map((r) => r.id), ['q']);
});

test('merge converges: two devices exchanging in any order end with the same records', () => {
  const dev1 = new Map([['a', { id: 'a', updatedAt: 5, v: 1, deviceId: 'd1' }], ['b', { id: 'b', updatedAt: 7, v: 1, deviceId: 'd1' }]]);
  const dev2 = new Map([['a', { id: 'a', updatedAt: 6, v: 2, deviceId: 'd2' }], ['c', { id: 'c', updatedAt: 1, v: 2, deviceId: 'd2' }], ['b', { id: 'b', updatedAt: 7, v: 2, deviceId: 'd2', deleted: true }]]);
  const apply = (into, from) => { for (const r of pickIncoming(into, [...from.values()])) into.set(r.id, r); };
  const x = new Map(dev1), y = new Map(dev2);
  apply(x, dev2); apply(y, dev1);
  const norm = (m) => JSON.stringify([...m.values()].sort((p, q) => p.id.localeCompare(q.id)));
  assert.equal(norm(x), norm(y));
  assert.equal(x.get('a').v, 2);
  assert.equal(x.get('b').deleted, true);
});

import { envelopeBalance, reservedTotal, planIncome } from '../src/domain/envelopes.ts';

const env = (o) => ({ updatedAt: 1, kind: 'reserve', ruleMode: 'percent', ruleValue: 0, target: 0, order: 0, name: o.id, ...o });
const alloc = (o) => ({ id: Math.random().toString(36), updatedAt: 1, at: NOW, incomeTxId: '', note: '', ...o });

test('income is split: fixed amounts first, then percents; rounded to hundreds; the rest is free', () => {
  const envs = [env({ id: 'close', ruleValue: 20, order: 0 }), env({ id: 'cushion', ruleValue: 10, order: 1 }), env({ id: 'bills', ruleMode: 'fixed', ruleValue: 45_000, kind: 'obligation', order: 2 })];
  const p = planIncome(286_000, envs, new Map());
  assert.deepEqual(p.lines, [{ envelopeId: 'close', amount: 57_200 }, { envelopeId: 'cushion', amount: 28_600 }, { envelopeId: 'bills', amount: 45_000 }]);
  assert.equal(p.free, 286_000 - 57_200 - 28_600 - 45_000);
  const small = planIncome(30_000, envs, new Map());
  assert.equal(small.lines.find((l) => l.envelopeId === 'bills').amount, 30_000, 'a fixed amount takes what there is');
  assert.equal(small.free, 0);
  assert.equal(small.lines.length, 1, 'percents get nothing once the income is used up');
});

test('a goal takes no more than it still needs; envelopes without a rule are skipped', () => {
  const envs = [env({ id: 'goal', kind: 'goal', ruleValue: 50, target: 100_000 }), env({ id: 'manual', ruleMode: 'none', ruleValue: 0 }), env({ id: 'gone', ruleValue: 10, deleted: true })];
  const p = planIncome(100_000, envs, new Map([['goal', 80_000]]));
  assert.deepEqual(p.lines, [{ envelopeId: 'goal', amount: 20_000 }]);
  assert.equal(p.free, 80_000);
});

test('envelope money is not free money; spending from an envelope does not touch the day figure', () => {
  const cushion = env({ id: 'cushion' });
  const allocs = [alloc({ envelopeId: 'cushion', amount: 28_000 }), alloc({ envelopeId: 'cushion', amount: -3000 })];
  const fromEnv = tx({ kind: 'expense', amount: 5000, accountId: 'card', at: NOW, envelopeId: 'cushion' });
  assert.equal(envelopeBalance(cushion, allocs, [fromEnv]), 20_000);
  const reserved = reservedTotal([cushion], allocs, [fromEnv]);
  const f = dayFigure([card], [fromEnv], NOW, '2026-12-05', reserved);
  assert.equal(f.spent, 0, 'paid from the envelope, not from today');
  assert.equal(f.allowance, Math.floor((135_000 - 20_000) / 14));
  const before = dayFigure([card], [], NOW, '2026-12-05', reservedTotal([cushion], allocs, []));
  assert.equal(before.allowance, f.allowance, 'the free money is the same before and after paying from the envelope');
});

import { habitStats, checkinDue, weekSummary, weekStart, wishDays, wishReady } from '../src/domain/habit.ts';

const DAYMS = 86_400_000;
const ck = (daysAgo, extra = {}) => { const t = NOW - daysAgo * DAYMS; return { id: ymd(t), day: ymd(t), done: true, at: t, decision: '', updatedAt: t, ...extra }; };

test('streak forgives one missed day, two in a row end it; today still open does not break it', () => {
  assert.deepEqual(habitStats([ck(0), ck(1), ck(2)], NOW), { doneToday: true, streak: 3, last30: 3 });
  assert.equal(habitStats([ck(1), ck(2)], NOW).streak, 2, 'evening not done yet: the run continues from yesterday');
  assert.equal(habitStats([ck(0), ck(2), ck(3)], NOW).streak, 3, 'one gap forgiven');
  assert.equal(habitStats([ck(0), ck(3), ck(4)], NOW).streak, 1, 'two missed days end the run');
  assert.equal(habitStats([ck(0, { deleted: true })], NOW).doneToday, false);
  assert.equal(habitStats([ck(0), ck(40)], NOW).last30, 1);
});

test('the evening card appears from the reminder time until the check-in is done', () => {
  assert.equal(checkinDue('21:00', NOW, false), false, '18:00 is before 21:00');
  assert.equal(checkinDue('17:30', NOW, false), true);
  assert.equal(checkinDue('17:30', NOW, true), false);
  assert.equal(checkinDue('', NOW, false), false, 'reminder switched off');
});

test('weekly summary: this week from Monday against the previous week, the top category, evenings checked', () => {
  const mon = weekStart(NOW); // 22 Nov 2026 is a Sunday, so Monday is 16 Nov
  assert.equal(new Date(mon).getDay(), 1);
  assert.equal(new Date(mon).getDate(), 16);
  const ops = [
    tx({ kind: 'expense', amount: 3000, accountId: 'card', at: mon + DAYMS, category: 'Кафе' }),
    tx({ kind: 'expense', amount: 5000, accountId: 'card', at: mon + 2 * DAYMS, category: 'Продукты' }),
    tx({ kind: 'expense', amount: 1000, accountId: 'card', at: mon + 3 * DAYMS, category: 'Кафе', envelopeId: 'x' }),
    tx({ kind: 'expense', amount: 7000, accountId: 'card', at: mon - DAYMS, category: 'Кафе' }),
    tx({ kind: 'income', amount: 99000, accountId: 'card', at: mon + DAYMS, category: 'Гонорар' }),
  ];
  const w = weekSummary(ops, [ck(0), ck(1), ck(9)], NOW);
  assert.deepEqual([w.spent, w.prevSpent, w.records, w.topCategory, w.topAmount, w.checkins], [9000, 7000, 3, 'Продукты', 5000, 2]);
});

test('a wish costs days of the figure and is ready once its waiting time has passed', () => {
  assert.equal(wishDays(25_000, 9000), 3);
  assert.equal(wishDays(25_000, 0), 0);
  const w = { id: 'w', title: 'Наушники', price: 25_000, createdAt: NOW, decideAt: NOW + DAYMS, status: 'waiting', updatedAt: NOW };
  assert.equal(wishReady(w, NOW), false);
  assert.equal(wishReady(w, NOW + DAYMS), true);
  assert.equal(wishReady({ ...w, status: 'dropped' }, NOW + 2 * DAYMS), false);
});

test('the weekly summary counts an entry made after the screen was opened', () => {
  const opened = NOW - 3_600_000;
  const later = tx({ kind: 'expense', amount: 2500, accountId: 'card', at: NOW, category: 'Кафе' });
  assert.equal(weekSummary([later], [], opened).spent, 2500);
});
