import type { Driver, TabInfo } from './interpreter';
import type { KV } from './pairing';
import type { RunnerOp, RunnerResult } from './runner-ops';

/** Adapter tipis ke API chrome.* (tidak diuji unit; dicakup e2e). */

const area = (storage: chrome.storage.StorageArea): KV => ({
  async get<T>(key: string) {
    return (await storage.get(key))[key] as T | undefined;
  },
  set: (key, value) => storage.set({ [key]: value }),
  remove: (key) => storage.remove(key),
});

export const sessionKV = (): KV => area(chrome.storage.session);
export const localKV = (): KV => area(chrome.storage.local);

async function tabInfo(tabId: number): Promise<TabInfo | null> {
  try {
    const t = await chrome.tabs.get(tabId);
    const status = t.status === 'loading' ? 'loading' : t.status === 'complete' ? 'complete' : 'unknown';
    return { url: t.url ?? '', status };
  } catch {
    return null;
  }
}

export const chromeDriver: Driver = {
  async openTab() {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    if (tab.id === undefined) throw new Error('tab tidak punya id');
    return tab.id;
  },
  tab: tabInfo,
  async navigate(tabId, url) {
    await chrome.tabs.update(tabId, { url });
  },
  async run(tabId, op: RunnerOp): Promise<RunnerResult | 'interrupted'> {
    try {
      // Runner di-inject ulang tiap pemanggilan (idempoten); halaman reload membuang runner lama.
      await chrome.scripting.executeScript({ target: { tabId }, files: ['/step-runner.js'] });
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (o: RunnerOp) =>
          (globalThis as unknown as { __urusinRunOp: (op: RunnerOp) => Promise<unknown> }).__urusinRunOp(o),
        args: [op],
      });
      if (res?.result !== undefined) return res.result as RunnerResult;
    } catch (e) {
      if ((await tabInfo(tabId))?.status !== 'loading') {
        return { ok: false, code: 'INJECT_FAILED', message: e instanceof Error ? e.message : String(e) };
      }
      return 'interrupted';
    }
    // Hasil kosong: frame berpindah di tengah op.
    return (await tabInfo(tabId))?.status === 'loading'
      ? 'interrupted'
      : { ok: false, code: 'INJECT_FAILED', message: 'runner tidak mengembalikan hasil' };
  },
};
