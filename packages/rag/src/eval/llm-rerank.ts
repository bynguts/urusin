import { OpenAIProvider, generateStructured, loadLlmConfig, probeCapabilities } from '@urusin/llm';
import type { JsonCall } from '../llm-stage.js';
import type { RerankDeps } from '../rerank.js';

/**
 * Rerank listwise nyata lewat gateway `@urusin/llm`, hanya bila env LLM lengkap. Selain itu null
 * (tahap rerank no-op). Sengaja tidak diekspor dari index.ts, sama seperti embedder.ts.
 */
export async function loadRealRerankDeps(
  env: Record<string, string | undefined> = process.env,
): Promise<RerankDeps | null> {
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
