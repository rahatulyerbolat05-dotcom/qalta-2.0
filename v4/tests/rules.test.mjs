// The cloud rules accept exactly the fields the app writes (otherwise every sync write
// after a deploy would be refused, as the prototype once learned).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const fieldsOf = (fn) => {
  const m = new RegExp(`function ${fn}\\([^)]*\\) \\{\\s*return d\\.keys\\(\\)\\.hasOnly\\(\\[([^\\]]+)\\]`).exec(rules);
  assert.ok(m, fn + ' is in the rules');
  return new Set(m[1].split(',').map((s) => s.trim().replace(/'/g, '')));
};
const STAMP = ['id', 'updatedAt', 'deviceId', 'deleted'];
const WRITES = {
  q4account: ['name', 'kind', 'openingAmount', 'openingAt', 'order'],
  q4tx: ['kind', 'amount', 'accountId', 'toAccountId', 'envelopeId', 'category', 'note', 'at', 'createdAt'],
  q4envelope: ['name', 'kind', 'ruleMode', 'ruleValue', 'target', 'order'],
  q4allocation: ['envelopeId', 'amount', 'at', 'incomeTxId', 'note'],
};

for (const [fn, keys] of Object.entries(WRITES)) {
  test(`rules for ${fn} allow every field the app writes`, () => {
    const allowed = fieldsOf(fn);
    for (const k of [...keys, ...STAMP]) assert.ok(allowed.has(k), `${fn} lacks ${k}`);
  });
}

test('every Qalta 4 collection the sync uses has a rule; nothing is world-readable', () => {
  for (const c of ['accounts', 'txs', 'envelopes', 'allocations']) assert.ok(rules.includes(`match /${c}/{id} {`), c);
  assert.ok(/docId == 'q4' && q4settings/.test(rules));
  assert.ok(!/allow [^;]*:\s*if\s+true/.test(rules));
  const src = fs.readFileSync(new URL('../src/data/store.ts', import.meta.url), 'utf8');
  assert.match(src, /COLLECTIONS: Collection\[\] = \['accounts', 'txs', 'envelopes', 'allocations', 'settings'\]/);
});
