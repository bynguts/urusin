import { usageCostUsd, type Prices, type Usage } from '@urusin/llm';
import type { UrusanRow } from './store.js';
import type { HarnessStore } from './store.js';

/**
 * Kuota + meter biaya (rencana §3.2). Biaya dihitung dari `usage` × harga (USD/juta token) × kurs IDR.
 * Per-sesi: batas turn dan token. Global harian: batas IDR; pada 70% masuk mode hemat (token lebih kecil),
 * pada 100% AI berhenti (hand-off ramah) sementara jalur dipandu statis tetap jalan.
 * (Batas per-IP dan Turnstile ada di lapisan HTTP.)
 */
export type QuotaConfig = {
  sessionTurnCap: number;
  /** Total token masuk+keluar per urusan; 0 = tanpa batas. */
  sessionTokenCap: number;
  /** Batas biaya harian global dalam IDR; 0 = tanpa batas. */
  dailyIdrCap: number;
  hematAtFraction: number;
  idrPerUsd: number;
  maxTokens: number;
  maxTokensHemat: number;
};

export const DEFAULT_QUOTA: QuotaConfig = {
  sessionTurnCap: 40,
  sessionTokenCap: 200_000,
  dailyIdrCap: 0,
  hematAtFraction: 0.7,
  idrPerUsd: 16_500,
  maxTokens: 1024,
  maxTokensHemat: 512,
};

export type QuotaMode = 'normal' | 'hemat' | 'habis';
export type QuotaStatus = {
  mode: QuotaMode;
  reason?: 'sesi_turn' | 'sesi_token' | 'harian';
  maxTokens: number;
};

export class QuotaMeter {
  constructor(
    private readonly store: HarnessStore,
    private readonly prices: Prices,
    readonly config: QuotaConfig = DEFAULT_QUOTA,
  ) {}

  costIdr(usage: Pick<Usage, 'prompt_tokens' | 'completion_tokens'> | null | undefined): number {
    return usage ? usageCostUsd(usage, this.prices) * this.config.idrPerUsd : 0;
  }

  /** Status saat ini untuk satu urusan (dipanggil sebelum setiap panggilan LLM). */
  check(urusan: UrusanRow, opts: { countThisTurn?: boolean } = {}): QuotaStatus {
    const c = this.config;
    // turnCount sudah menghitung turn yang sedang diklaim; batas berlaku pada turn berikutnya.
    const turns = urusan.turnCount - (opts.countThisTurn === false ? 0 : 1);
    if (c.sessionTurnCap > 0 && turns >= c.sessionTurnCap) {
      return { mode: 'habis', reason: 'sesi_turn', maxTokens: c.maxTokensHemat };
    }
    if (c.sessionTokenCap > 0 && urusan.tokensIn + urusan.tokensOut >= c.sessionTokenCap) {
      return { mode: 'habis', reason: 'sesi_token', maxTokens: c.maxTokensHemat };
    }
    if (c.dailyIdrCap > 0) {
      const spent = this.store.dailyCostIdr();
      if (spent >= c.dailyIdrCap) return { mode: 'habis', reason: 'harian', maxTokens: c.maxTokensHemat };
      if (spent >= c.dailyIdrCap * c.hematAtFraction) {
        return { mode: 'hemat', reason: 'harian', maxTokens: c.maxTokensHemat };
      }
    }
    return { mode: 'normal', maxTokens: c.maxTokens };
  }
}
