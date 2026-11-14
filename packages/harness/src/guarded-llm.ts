import { generateStructured, type CapabilityFlags, type ChatMessage, type ChatProvider } from '@urusin/llm';
import type { JsonCall } from '@urusin/rag';
import { PiiInterceptor } from './pii.js';

/** Sisa deretan 16+ digit (mis. nomor yang strukturnya tidak lolos validasi NIK) tetap tidak boleh keluar. */
const LONG_DIGITS = /\d{16,}/g;
const DIGITS_PLACEHOLDER = '{{DATA.ANGKA}}';

function scrub(messages: readonly ChatMessage[]): ChatMessage[] {
  const clean = (s: string) => s.replace(LONG_DIGITS, DIGITS_PLACEHOLDER);
  return new PiiInterceptor().redactMessages(messages).map((m): ChatMessage => {
    const base = { ...m } as Record<string, unknown>;
    if (typeof m.content === 'string') base.content = clean(m.content);
    else if (Array.isArray(m.content)) {
      base.content = m.content.map((p) =>
        typeof p === 'object' && p !== null && 'text' in p && typeof p.text === 'string'
          ? { ...p, text: clean(p.text) }
          : p,
      );
    }
    return base as unknown as ChatMessage;
  });
}

/**
 * Pembungkus provider: SETIAP panggilan chat (agen, klasifikasi intent, jawaban bersumber, penulisan ulang kueri
 * RAG, rerank) melewati redaksi PII lebih dulu. Ini lapis terakhir; lapis sebelumnya tetap berjalan.
 */
export function redactingProvider(inner: ChatProvider): ChatProvider {
  return {
    get baseURL() {
      return inner.baseURL;
    },
    create: (params, opts) => inner.create({ ...params, messages: scrub(params.messages) }, opts),
    stream: (params, opts) => inner.stream({ ...params, messages: scrub(params.messages) }, opts),
    transcribe: (input) => inner.transcribe(input),
    embed: (input) =>
      inner.embed({
        ...input,
        texts: input.texts.map((t) =>
          new PiiInterceptor().redact(t).text.replace(LONG_DIGITS, DIGITS_PLACEHOLDER),
        ),
      }),
  };
}

/**
 * `JsonCall` untuk tahap berbantuan LLM di @urusin/rag (penulisan ulang kueri, rerank listwise). Provider yang dipakai
 * sudah dibungkus `redactingProvider`, jadi prompt rewrite/rerank tidak pernah memuat NIK/HP/email/16 digit.
 */
export function createRagJsonCall(opts: {
  provider: ChatProvider;
  model: string;
  caps: Pick<CapabilityFlags, 'json_schema_strict' | 'tools'>;
}): JsonCall {
  const provider = redactingProvider(opts.provider);
  return async (req) =>
    (
      await generateStructured({
        provider,
        model: opts.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        schema: req.schema,
        name: req.name,
        caps: opts.caps,
        maxTokens: 2000,
        signal: req.signal,
      })
    ).data;
}
