import { describe, expect, it } from 'vitest';
import { builtinTools } from './builtin-tools.js';
import { buildSystemPrompt } from './prompt.js';

describe('mode chatbot', () => {
  it('menawarkan pencarian dan rencana tanpa alat yang membutuhkan browser', () => {
    const names = builtinTools(true).map((t) => t.name);
    expect(names).toContain('rag__cari_pengetahuan');
    expect(names).toContain('urusan__usulkan_rencana');
    for (const name of [
      'dukcapil__ajukan_layanan',
      'dukcapil__klik_selesai',
      'dukcapil__cek_status',
      'samsat__cek_pkb',
      'oss__cari_nib',
    ])
      expect(names).not.toContain(name);
  });
  it('menjelaskan status coming soon dan pengajuan melalui kanal resmi', () => {
    const prompt = buildSystemPrompt(true);
    expect(prompt).toContain('chatbot pendamping layanan publik');
    expect(prompt).toContain('Browser Pendamping Coming soon dan belum tersedia');
    expect(prompt).toContain('warga sendiri membuka kanal resmi');
  });
});
