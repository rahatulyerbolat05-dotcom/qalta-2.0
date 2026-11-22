// Google sign-in and cloud sync. Firebase is loaded only when needed: after the first
// screen is on, for someone who signed in before, or on the "Войти" tap. The first
// screen never waits for it.
//
// Cloud layout (rules: cloud/firestore.rules):
//   users/{uid}/accounts/{id}   users/{uid}/txs/{id}   users/{uid}/envelopes/{id}
//   users/{uid}/allocations/{id}   users/{uid}/meta/q4
// Merge is record by record (domain/merge.ts): the later updatedAt wins, deletions are
// records with deleted: true.
import type { Stamped } from '../domain/daily.ts';
import { pickIncoming, type Synced } from '../domain/merge.ts';
import { COLLECTIONS, store, type Collection } from './store.ts';

// Public by design: access is limited by the Firestore rules, not by this key.
const CONFIG = {
  apiKey: 'AIzaSyCf1M9AEt_3lMOGpkeVtuBLtUDtoXSVkpk',
  authDomain: 'qalta-by-yerbo.firebaseapp.com',
  projectId: 'qalta-by-yerbo',
  storageBucket: 'qalta-by-yerbo.firebasestorage.app',
  messagingSenderId: '50557771129',
  appId: '1:50557771129:web:1b97cbc3e04ac5280123a8',
};

const FLAG = 'qalta4:cloud'; // "this device signed in before": start sync on launch

type Mods = [typeof import('firebase/app'), typeof import('firebase/auth'), typeof import('firebase/firestore')];
let mods: Promise<Mods> | null = null;
const load = () => (mods ??= Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]));

let started: Promise<void> | null = null;
let unsub: Array<() => void> = [];
let push: ((c: Collection, recs: Array<Synced<Stamped>>) => void) | null = null;

const MESSAGES: Record<string, string> = {
  'auth/popup-closed-by-user': 'Вход отменён.',
  'auth/cancelled-popup-request': 'Вход отменён.',
  'auth/network-request-failed': 'Нет сети. Попробуйте ещё раз, когда появится интернет.',
  'auth/unauthorized-domain': 'Вход с этого адреса не разрешён в настройках Firebase.',
  'auth/operation-not-supported-in-this-environment': 'Этот браузер не поддерживает вход. Откройте Qalta в Safari или Chrome.',
  'permission-denied': 'Облако отклонило запись: правила Firestore не опубликованы.',
};
const say = (e: unknown) => MESSAGES[(e as { code?: string })?.code ?? ''] ?? 'Не удалось связаться с облаком.';

function clean<T extends object>(r: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (v !== undefined) out[k] = v;
  return out as T;
}

export function wasSignedIn(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

export function startSync(): Promise<void> {
  return (started ??= run().catch((e) => {
    started = null;
    store.set({ sync: 'error', syncNote: say(e) });
  }));
}

async function run() {
  store.set({ sync: 'connecting', syncNote: '' });
  const [{ initializeApp }, A, F] = await load();
  const host = location.hostname;
  // On Firebase Hosting the sign-in helper lives on the same site, which Safari needs.
  const authDomain = /\.(web\.app|firebaseapp\.com)$/.test(host) ? location.host : CONFIG.authDomain;
  const app = initializeApp({ ...CONFIG, authDomain });
  const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence], popupRedirectResolver: A.browserPopupRedirectResolver });
  const db = F.getFirestore(app);
  await A.getRedirectResult(auth).catch((e) => store.set({ syncNote: say(e) }));

  A.onAuthStateChanged(auth, async (user) => {
    stop();
    if (!user) {
      store.set({ user: null, sync: 'off' });
      return;
    }
    try {
      localStorage.setItem(FLAG, '1');
    } catch { /* sync just will not start by itself next time */ }
    store.set({ user: { uid: user.uid, name: user.displayName ?? '', email: user.email ?? '' }, sync: 'connecting', syncNote: '' });

    const owner = await store.kvGet<string>('owner');
    if (owner && owner !== user.uid) {
      try {
        await store.resetForOtherAccount();
      } catch {
        await A.signOut(auth);
        store.set({ sync: 'error', syncNote: 'Не удалось сохранить копию данных прошлого аккаунта, поэтому вход отменён.' });
        return;
      }
    }
    await store.kvSet('owner', user.uid);

    const base = F.doc(db, 'users', user.uid);
    const ref = (c: Collection, id: string) => (c === 'settings' ? F.doc(base, 'meta', 'q4') : F.doc(base, c, id));
    const write = async (c: Collection, recs: Array<Synced<Stamped>>) => {
      for (let i = 0; i < recs.length; i += 400) {
        const batch = F.writeBatch(db);
        for (const r of recs.slice(i, i + 400)) batch.set(ref(c, r.id), clean(r));
        await batch.commit();
      }
    };
    push = (c, recs) => void write(c, recs).catch((e) => store.set({ sync: 'error', syncNote: say(e) }));

    // First snapshot of each collection: take what the cloud has newer, push what we have newer.
    const first = new Set<Collection>();
    const watch = (c: Collection, q: unknown) =>
      F.onSnapshot(
        q as never,
        { includeMetadataChanges: false },
        (snap: { docs?: Array<{ data(): unknown }>; data?: () => unknown; exists?: () => boolean }) => {
          const incoming = snap.docs ? snap.docs.map((d) => d.data() as Synced<Stamped>) : snap.exists?.() ? [snap.data!() as Synced<Stamped>] : [];
          store.applyRemote(c, incoming);
          if (!first.has(c)) {
            first.add(c);
            const cloud = new Map(incoming.map((r) => [r.id, r]));
            const ours = pickIncoming(cloud, store.all(c)).filter((r) => r.updatedAt > 0);
            if (ours.length) push?.(c, ours);
            if (first.size === COLLECTIONS.length) store.set({ sync: navigator.onLine ? 'on' : 'offline' });
          }
        },
        (e: unknown) => store.set({ sync: 'error', syncNote: say(e) })
      );
    unsub = COLLECTIONS.map((c) => watch(c, c === 'settings' ? F.doc(base, 'meta', 'q4') : F.collection(base, c)));
    store.onLocalChange((c, recs) => push?.(c, recs));
  });

  addEventListener('online', () => store.state.user && store.set({ sync: 'on' }));
  addEventListener('offline', () => store.state.user && store.set({ sync: 'offline' }));

  signInImpl = async () => {
    const provider = new A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    try {
      if (standalone) await A.signInWithRedirect(auth, provider);
      else await A.signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/popup-blocked') return A.signInWithRedirect(auth, provider);
      store.set({ syncNote: say(e), sync: store.state.user ? store.state.sync : 'off' });
    }
  };
  signOutImpl = async () => {
    try {
      localStorage.removeItem(FLAG);
    } catch { /* ignore */ }
    await A.signOut(auth);
  };
}

function stop() {
  for (const u of unsub) u();
  unsub = [];
  push = null;
  store.onLocalChange(null);
}

let signInImpl: (() => Promise<void>) | null = null;
let signOutImpl: (() => Promise<void>) | null = null;

export async function signIn() {
  await startSync();
  await signInImpl?.();
}

export async function signOut() {
  await signOutImpl?.();
}
