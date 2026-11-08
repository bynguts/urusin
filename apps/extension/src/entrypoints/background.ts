import { defineBackground } from 'wxt/utils/define-background';
import { checkUrl } from '../lib/allowlist';
import { chromeDriver, localKV, sessionKV } from '../lib/chrome-adapters';
import { Interpreter, type Cursor } from '../lib/interpreter';
import { fromMatchPattern } from '../lib/origins';
import { authorize, completePairing, getPaired, startPairing, unpair } from '../lib/pairing';
import { err, parseWebMessage, PROTOCOL_VERSION } from '../lib/protocol';

const TEST_MODE_KEY = 'testMode';

/** Tampilan cursor untuk web app: tanpa `steps` (berisi nilai isian ter-resolve). */
function view(c: Cursor | undefined) {
  if (!c) return null;
  const { executionId, stepIndex, status, message, error, results, seq } = c;
  return { executionId, stepIndex, total: c.steps.length, status, message, error, results, seq };
}

export default defineBackground(() => {
  const session = sessionKV();
  const local = localKV();
  const ports = new Set<chrome.runtime.Port>();

  const appOrigins = () =>
    (chrome.runtime.getManifest().externally_connectable?.matches ?? [])
      .map(fromMatchPattern)
      .filter((o): o is string => o !== null);

  const policy = async (url: string) =>
    checkUrl(url, {
      testMode: (await local.get<boolean>(TEST_MODE_KEY)) === true,
      fixtureOrigins: __URUSIN_FIXTURE_ORIGINS__,
    });

  const interp = new Interpreter(session, chromeDriver, policy, (cursor) => {
    for (const p of ports) p.postMessage({ type: 'state', cursor: view(cursor) });
  });

  // Listener didaftarkan top-level (sinkron) agar event membangunkan SW yang dimatikan.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    void interp.onTabUpdated(tabId, changeInfo);
  });

  chrome.runtime.onMessageExternal.addListener((raw, sender, sendResponse) => {
    void (async () => {
      // Hanya halaman web ber-origin; ekstensi lain (sender.id tanpa origin) ditolak.
      const origin = sender.origin;
      const msg = parseWebMessage(raw);
      if (!origin) return err('NO_ORIGIN', 'pengirim tanpa origin');
      if (!msg) return err('BAD_MESSAGE', 'pesan tidak dikenali');
      if (msg.type === 'pair') return completePairing(session, origin, appOrigins(), msg.nonce, Date.now());

      const auth = await authorize(session, origin, msg.nonce);
      if (!auth.ok) return auth;
      switch (msg.type) {
        case 'ping':
          return {
            ok: true,
            type: 'pong',
            protocol: PROTOCOL_VERSION,
            version: chrome.runtime.getManifest().version,
            origin,
          };
        case 'status':
          return { ok: true, cursor: view(await interp.getCursor()) };
        case 'execute': {
          const started = await interp.start(msg.request);
          return 'ok' in started ? started : { ok: true, cursor: view(started) };
        }
      }
    })().then(sendResponse);
    return true; // respons asinkron
  });

  // Protokol port (rencana §3.5 butir 4): hello {nonce} -> state terkini, lalu event state.
  chrome.runtime.onConnectExternal.addListener((port) => {
    const origin = port.sender?.origin;
    if (!origin || !appOrigins().includes(origin)) return port.disconnect();
    port.onMessage.addListener((raw) => {
      void (async () => {
        const hello = raw as { type?: unknown; nonce?: unknown };
        if (hello?.type !== 'hello' || typeof hello.nonce !== 'string') return port.disconnect();
        const auth = await authorize(session, origin, hello.nonce);
        if (!auth.ok) {
          port.postMessage({ type: 'error', code: auth.code });
          return port.disconnect();
        }
        ports.add(port);
        port.postMessage({ type: 'state', cursor: view(await interp.getCursor()) });
      })();
    });
    port.onDisconnect.addListener(() => ports.delete(port));
  });

  // Pesan internal dari popup (user gesture). Halaman web tidak bisa mencapai handler ini.
  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
    void (async () => {
      const m = raw as { type?: string; origin?: string };
      switch (m.type) {
        case 'popup:state':
          return {
            ok: true,
            paired: (await getPaired(session))?.origin ?? null,
            origins: appOrigins(),
            testMode: (await local.get<boolean>(TEST_MODE_KEY)) === true,
            cursor: view(await interp.getCursor()),
          };
        case 'popup:pair': {
          if (!m.origin || !appOrigins().includes(m.origin)) {
            return err('ORIGIN_NOT_ALLOWED', 'origin tidak diizinkan');
          }
          const nonce = await startPairing(session, Date.now());
          // Nonce di FRAGMENT: tidak terkirim ke server, log, atau Referer.
          await chrome.tabs.create({ url: `${m.origin}/pair#nonce=${nonce}` });
          return { ok: true };
        }
        case 'popup:unpair':
          await unpair(session);
          return { ok: true };
        case 'popup:recheck':
          await interp.recheckGate();
          return { ok: true };
        case 'popup:cancel':
          await interp.cancel();
          return { ok: true };
        default:
          return err('BAD_MESSAGE', 'pesan popup tidak dikenali');
      }
    })().then(sendResponse);
    return true;
  });

  void interp.resume(); // SW bangun: lanjutkan dari cursor bila mati di tengah op
});
