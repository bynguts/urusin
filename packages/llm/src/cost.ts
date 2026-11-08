import type { LlmConfig } from './config.js';
import type { Usage } from './types.js';

export type Prices = LlmConfig['prices'];

export type CostTotals = {
  promptTokens: number;
  completionTokens: number;
  audioMinutes: number;
  usd: number;
  requests: number;
};

/** Biaya USD satu respons dari `usage` × harga per juta token (dari env LLM_PRICE_*). */
export function usageCostUsd(
  usage: Pick<Usage, 'prompt_tokens' | 'completion_tokens'>,
  prices: Prices,
): number {
  return (
    (usage.prompt_tokens * prices.inputPerMTok) / 1_000_000 +
    (usage.completion_tokens * prices.outputPerMTok) / 1_000_000
  );
}

/** Meter biaya kumulatif (per urusan / per hari dikelola pemanggil dengan instance terpisah). */
export class CostMeter {
  private totals: CostTotals = { promptTokens: 0, completionTokens: 0, audioMinutes: 0, usd: 0, requests: 0 };

  constructor(private readonly prices: Prices) {}

  addUsage(usage: Pick<Usage, 'prompt_tokens' | 'completion_tokens'> | null | undefined): number {
    if (!usage) return 0;
    const usd = usageCostUsd(usage, this.prices);
    this.totals.promptTokens += usage.prompt_tokens;
    this.totals.completionTokens += usage.completion_tokens;
    this.totals.usd += usd;
    this.totals.requests += 1;
    return usd;
  }

  addAudio(seconds: number): number {
    const minutes = seconds / 60;
    const usd = minutes * this.prices.audioPerMin;
    this.totals.audioMinutes += minutes;
    this.totals.usd += usd;
    this.totals.requests += 1;
    return usd;
  }

  snapshot(): CostTotals {
    return { ...this.totals };
  }

  /** True bila total biaya melewati batas (mis. URUSIN_DAILY_USD_CAP). */
  exceeds(capUsd: number): boolean {
    return capUsd > 0 && this.totals.usd >= capUsd;
  }
}
