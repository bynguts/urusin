import { OpenAIProvider, loadLlmConfig, probeCapabilities } from '@urusin/llm';
import type { Embedder } from './vector/store.js';

/**
 * Embedder nyata lewat gateway `@urusin/llm`, hanya bila env LLM lengkap, `LLM_EMBED_MODEL` diset,
 * dan probe kapabilitas `embeddings` lolos. Selain itu null => pemanggil tetap BM25-saja.
 * Sengaja tidak diekspor dari index.ts agar konsumen pustaka tidak menarik SDK LLM.
 */
export async function loadRealEmbedder(
  env: Record<string, string | undefined> = process.env,
): Promise<{ embed: Embedder; model: string } | null> {
  let config;
  try {
    config = loadLlmConfig(env);
  } catch {
    return null;
  }
  const model = config.models.embed;
  if (!model) return null;
  const provider = new OpenAIProvider(config);
  const report = await probeCapabilities({
    provider,
    models: config.models,
    forcedOff: config.forcedOff,
  });
  if (!report.flags.embeddings) return null;
  const embed: Embedder = async (texts) => {
    const out = await provider.embed({ model, texts });
    return out.map((v) => Float32Array.from(v));
  };
  return { embed, model };
}
