import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { runOp, type RunnerOp } from '@urusin/executor/runner-ops';
import { showConsentOverlay } from '../lib/overlay';

/**
 * Step-runner tipis: di-inject service worker (chrome.scripting) ke tab yang dilacak pada setiap
 * `tabs.onUpdated: complete`. Hanya mendaftarkan satu fungsi; SW memanggilnya untuk SATU op per pemanggilan.
 */
export default defineUnlistedScript(() => {
  (globalThis as { __urusinRunOp?: (op: RunnerOp) => ReturnType<typeof runOp> }).__urusinRunOp = (op) =>
    runOp(op, document, { consent: showConsentOverlay });
});
