import { OpenAIProvider, generateStructured, loadLlmConfig, probeCapabilities } from '@urusin/llm';
import type { JsonCall } from '../llm-stage.js';
import { newStats, type ProviderStats } from '../providers/http.js';
import { createHttpRerankEndpoint, loadRerankConfig } from '../providers/rerank-endpoint.js';
import type { RerankDeps } from '../rerank.js';

/**
 * Dependensi rerank nyata. Prioritas: endpoint khusus (env RERANK_*, skor relevansi) lalu LLM listwise lewat
 * gateway `@urusin/llm`. Tidak ada keduanya => null (tahap rerank no-op). Sengaja tidak diekspor dari index.ts.
 */
export async function loadRealRerankDeps(
  env: Record<string, string | undefined> = process.env,
  stats?: ProviderStats,
): Promise<RerankDeps | null> {
  const rr = loadRerankConfig(env);
  if (rr)
    return { endpoint: createHttpRerankEndpoint(rr, { stats: stats ?? newStats() }), timeoutMs: 20_000 };
  let config;
  try {
    config = loadLlmConfig(env);
  } catch {
    return null;
  }
  const provider = new OpenAIProvider(config);
  const report = await probeCapabilities({ provider, models: config.models, forcedOff: config.forcedOff });
  if (!report.flags.json_schema_strict && !report.flags.tools) return null;
  const json: JsonCall = async (req) =>
    (
      await generateStructured({
        provider,
        model: config.models.agent,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        schema: req.schema,
        name: req.name,
        caps: report.flags,
        signal: req.signal,
      })
    ).data;
  return { json, timeoutMs: 15_000 };
}
