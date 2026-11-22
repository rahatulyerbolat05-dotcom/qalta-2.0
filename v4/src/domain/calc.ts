// Amount entry with a calculator: the expression is a string of whole numbers joined by
// + - * /. Pure functions only, so the keypad's behaviour is tested without a browser.

export type CalcKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '000' | '+' | '-' | '*' | '/' | 'back';

const OPS = '+-*/';
const MAX_DIGITS = 9; // 999 999 999 ₸, the same ceiling as the prototype
const MAX_LEN = 40;

export function isOp(ch: string): boolean {
  return ch.length === 1 && OPS.includes(ch);
}

function lastNumber(expr: string): string {
  const m = /(\d*)$/.exec(expr);
  return m ? m[1] : '';
}

export function press(expr: string, key: CalcKey): string {
  if (key === 'back') return expr.slice(0, -1);
  if (isOp(key)) {
    if (!expr) return expr;
    const body = isOp(expr.slice(-1)) ? expr.slice(0, -1) : expr;
    return body + key;
  }
  if (expr.length >= MAX_LEN) return expr;
  const last = lastNumber(expr);
  if (key === '000') {
    if (!last || last === '0' || last.length + 3 > MAX_DIGITS) return expr;
    return expr + '000';
  }
  if (last.length >= MAX_DIGITS) return expr;
  if (last === '0') return expr.slice(0, -1) + key;
  return expr + key;
}

// Multiplication and division before addition and subtraction, left to right.
// Returns null when the expression divides by zero.
export function evaluate(expr: string): number | null {
  const parts = expr.split(/([+\-*/])/).filter((p) => p !== '');
  if (parts.length && isOp(parts[parts.length - 1])) parts.pop();
  if (!parts.length) return 0;
  const terms: number[] = [Number(parts[0])];
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i];
    const n = Number(parts[i + 1]);
    const top = terms.length - 1;
    if (op === '*') terms[top] = terms[top] * n;
    else if (op === '/') {
      if (n === 0) return null;
      terms[top] = terms[top] / n;
    } else terms.push(op === '-' ? -n : n);
  }
  return terms.reduce((a, b) => a + b, 0);
}

export function hasOperator(expr: string): boolean {
  return /\d[+\-*/]/.test(expr);
}

const OP_TEXT: Record<string, string> = { '+': ' + ', '-': ' − ', '*': ' × ', '/': ' ÷ ' };

export function groupThousands(n: number): string {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function describe(expr: string): string {
  return expr.replace(/\d+/g, (d) => groupThousands(Number(d))).replace(/[+\-*/]/g, (o) => OP_TEXT[o]);
}

// The amount the keypad will save: a positive whole number of tenge, or 0 when there is
// nothing valid to save (empty, negative result, division by zero, over the ceiling).
export function amountOf(expr: string): number {
  const v = evaluate(expr);
  if (v === null || !isFinite(v)) return 0;
  const r = Math.round(v);
  return r > 0 && r <= 999_999_999 ? r : 0;
}
