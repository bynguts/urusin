import { createLlmRewriter, rerankHits, safeRewrite, type Hit } from '@urusin/rag';
import { ALL_ON, FakeProvider, fakeCompletion } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import { createRagJsonCall, redactingProvider } from './guarded-llm.js';
import { FAKE_EMAIL, FAKE_HP, FAKE_NIK, SIXTEEN_DIGIT_RUN } from './testing.js';

const LONG = ['9999', '8888', '7777', '6666'].join(''); // 16 digit yang bukan NIK valid

const allPrompts = (p: FakeProvider) =>
  JSON.stringify(p.calls.map((c) => (c.kind === 'create' ? c.params.messages : [])));

function hit(id: string, text: string): Hit {
  return {
    id,
    skor: 1,
    text,
    kutipan: { url: 'https://x.example/a', judul: 'J', instansi: 'I' },
    verifiedAt: null,
  } as unknown as Hit;
}

describe('N8: tidak ada PII/16 digit ke LLM, termasuk rewrite dan rerank RAG', () => {
  it('redactingProvider membersihkan NIK, HP, email, dan 16 digit sisa di semua pesan', async () => {
    const fake = new FakeProvider({ replies: [fakeCompletion({ content: '{}' })] });
    await redactingProvider(fake).create({
      model: 'm',
      messages: [
        { role: 'system', content: `sistem ${FAKE_NIK}` },
        { role: 'user', content: `hubungi ${FAKE_HP} atau ${FAKE_EMAIL}; no ${LONG}` },
      ],
    });
    const p = allPrompts(fake);
    expect(p).not.toMatch(SIXTEEN_DIGIT_RUN);
    expect(p).not.toContain(FAKE_HP);
    expect(p).not.toContain(FAKE_EMAIL);
    expect(p).not.toMatch(/\d{16}/);
  });

  it('prompt penulisan ulang kueri tidak memuat 16 digit walau penjaga hulu dilewati', async () => {
    const fake = new FakeProvider({
      replies: [fakeCompletion({ content: '{"istilah":["akta","kelahiran"]}' })],
    });
    const rewrite = createLlmRewriter(createRagJsonCall({ provider: fake, model: 'm', caps: ALL_ON }));
    // memanggil rewriter langsung (melewati penjaga containsSensitive milik rag)
    await rewrite(`syarat akta anak nomor ${LONG} tolong`);
    expect(allPrompts(fake)).not.toMatch(/\d{16}/);
    expect(fake.calls.length).toBe(1);
    // jalur normal: kueri sensitif dilewati sama sekali (tidak ada panggilan)
    const fake2 = new FakeProvider({ replies: [] });
    const r = await safeRewrite(
      `nik ${FAKE_NIK}`,
      createLlmRewriter(createRagJsonCall({ provider: fake2, model: 'm', caps: ALL_ON })),
    );
    expect(r.status).toBe('skipped');
    expect(fake2.calls.length).toBe(0);
  });

  it('prompt rerank tidak memuat 16 digit walau teks dokumen memuatnya', async () => {
    const fake = new FakeProvider({ replies: [fakeCompletion({ content: '{"urutan":["d2","d1"]}' })] });
    const json = createRagJsonCall({ provider: fake, model: 'm', caps: ALL_ON });
    const r = await rerankHits(
      'syarat akta kelahiran',
      [hit('a', `lampirkan KK nomor ${LONG} dan ${FAKE_NIK}`), hit('b', `hubungi ${FAKE_HP} ${FAKE_EMAIL}`)],
      2,
      { json },
    );
    expect(['llm', 'fallback']).toContain(r.status);
    expect(fake.calls.length).toBeGreaterThan(0);
    const p = allPrompts(fake);
    expect(p).not.toMatch(/\d{16}/);
    expect(p).not.toContain(FAKE_EMAIL);
    expect(p).not.toContain(FAKE_HP);
  });
});
