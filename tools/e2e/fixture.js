// Realistic sample data for screenshots and e2e runs, relative to "now".
"use strict";
module.exports = function fixture(now) {
  now = now || Date.now();
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const day = n => d0.getTime() - n * 86400000;
  const pad = n => (n < 10 ? "0" : "") + n;
  const ddmm = ts => pad(new Date(ts).getDate()) + "." + pad(new Date(ts).getMonth() + 1);
  const ymd = ts => { const d = new Date(ts); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  let id = 1700000000000000;
  const op = (ago, hh, mm, cat, sum, pay, note) => { const ts = day(ago) + (hh * 60 + mm) * 60000; return { id: id++, date: ddmm(ts), ts: Math.min(ts, now - 60000), cat, note: note || "", sum, pay }; };
  const ops = [
    op(0, 9, 12, "Кафе", -2800, "card", "кофе"), op(0, 8, 5, "Транспорт", -300, "card"), op(1, 19, 40, "Продукты", -14250, "card", "Магнум"),
    op(1, 13, 5, "Кафе", -4600, "cash", "обед"), op(2, 21, 10, "Развлечения", -9000, "card", "кино"), op(3, 11, 30, "Продукты", -8300, "cash", "рынок"),
    op(4, 18, 0, "Спорт", -15000, "card", "абонемент"), op(5, 10, 0, "Зарплата", 420000, "card"), op(6, 17, 20, "Такси", -2100, "card"),
    op(8, 12, 0, "Аптека", -6400, "card"), op(9, 15, 45, "Подарки", -22000, "card", "день рождения"), op(11, 20, 15, "Коммуналка", -38500, "card"),
    op(12, 9, 0, "Интернет", -5900, "card"), op(14, 14, 0, "Продукты", -19800, "card"), op(20, 12, 0, "Одежда", -34900, "card")
  ];
  const debts = [
    { id: id++, who: "Айдос", note: "за билеты", sum: 40000, mine: true, paid: 15000, log: [{ sum: 15000, date: ddmm(day(5)), ts: day(5), id: "a1" }], due: ymd(day(-6)), ts: day(12) },
    { id: id++, who: "Мадина", note: "", sum: 14000, mine: true, paid: 0, log: [], due: ymd(day(2)), ts: day(20) },
    { id: id++, who: "Ержан", note: "за такси", sum: 18500, mine: false, paid: 0, log: [], ts: day(3) }
  ];
  return { ops, debts, closed: [], budget: 300000, openCash: 42000, openCard: 380000, hex: "#007AFF", lang: "ru", catColors: {}, catIcons: {}, skin: 1, set: 1, catSizes: {} };
};
