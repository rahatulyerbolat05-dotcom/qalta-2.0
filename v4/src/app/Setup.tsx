import { useState } from 'preact/hooks';
import { defaultUntil } from '../data/store.ts';
import { ymd } from '../domain/daily.ts';
import { Sq } from '../ui/kit.tsx';
import { tenge } from '../ui/format.ts';

const digits = (s: string) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 9);

export function Setup({ onDone }: { onDone: (card: number, cash: number, until: string) => void }) {
  const [card, setCard] = useState('');
  const [cash, setCash] = useState('');
  const [until, setUntil] = useState(defaultUntil());
  const today = ymd(Date.now());

  return (
    <form
      class="setup"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(Number(card || 0), Number(cash || 0), until < today ? today : until);
      }}
    >
      <h2>Сколько у вас сейчас денег?</h2>
      <p class="muted">Только реальные остатки. Их можно поправить позже.</p>
      <label class="field">
        <span>На карте</span>
        <input inputMode="numeric" autoComplete="off" placeholder="0" value={card ? tenge(Number(card)) : ''} onInput={(e) => setCard(digits(e.currentTarget.value))} />
        <b>₸</b>
      </label>
      <label class="field">
        <span>Наличными</span>
        <input inputMode="numeric" autoComplete="off" placeholder="0" value={cash ? tenge(Number(cash)) : ''} onInput={(e) => setCash(digits(e.currentTarget.value))} />
        <b>₸</b>
      </label>
      <label class="field">
        <span>Дотянуть до</span>
        <input type="date" min={today} value={until} onInput={(e) => setUntil(e.currentTarget.value || defaultUntil())} />
      </label>
      <p class="muted small">Обычно это день следующего дохода. Если он неизвестен, оставьте две недели.</p>
      <Sq tag="button" r={20} class="primary" type="submit" disabled={!card && !cash}>
        Начать
      </Sq>
    </form>
  );
}
