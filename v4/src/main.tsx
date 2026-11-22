import { render } from 'preact';
import { App } from './app/App.tsx';
import { store } from './data/store.ts';
import { startSync, wasSignedIn } from './data/sync.ts';
import { installMotion } from './ui/motion.ts';
import './ui/app.css';

const html = document.documentElement;
installMotion();

// Phase 1 ends when the app has its data: the launch colour fades straight onto the real
// screen. If that takes longer than 1.2 s the cached skeleton rises first, and the app
// then replaces it without animating again.
void store.open().then(() => {
  const late = html.classList.contains('late');
  if (late) html.classList.add('static');
  render(<App />, document.getElementById('app')!);
  requestAnimationFrame(() => {
    if (!late) html.classList.add('go');
    document.getElementById('boot')?.remove();
    setTimeout(() => html.classList.remove('launching'), 800);
  });
  // Cloud sync only after the screen is up, and only for someone who signed in before.
  if (wasSignedIn()) setTimeout(() => void startSync(), 900);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* hosting without a service worker (sandboxed preview): the app still runs */
    });
  });
}
