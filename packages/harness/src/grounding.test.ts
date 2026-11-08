import { ALL_ON, FakeProvider, fakeCompletion } from '@urusin/llm';
import { describe, expect, it } from 'vitest';
import {
  GroundedAnswerSchema,
  generateGroundedAnswer,
  handoffChannels,
  locateQuote,
  normalizeForMatch,
  verifyGrounded,
} from './grounding.js';
import { DATAMARK, spotlight } from './spotlight.js';
import type { ChunkRecord } from './store.js';
import { appendTextFragment, buildDirective, encodeTerm, textFragmentUrl } from './textfragment.js';

const URL1 = 'https://telunjuksakti.wonogirikab.go.id/layanan/akta-kelahiran';
const chunk = (over: Partial<ChunkRecord> = {}): ChunkRecord => ({
  refId: 'c1',
  text: 'Persyaratan akta kelahiran: surat keterangan lahir dari bidan, KK orang tua, dan KTP-el kedua orang tua. Layanan ini gratis.',
  url: URL1,
  judul: 'Akta Kelahiran',
  instansi: 'Disdukcapil Kabupaten Wonogiri',
  verifiedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});
const NOW = new Date('2026-11-08T00:00:00.000Z');

describe('normalisasi kutipan', () => {
  it('spasi, huruf besar-kecil, tanda baca, dan datamark tidak menggagalkan pencocokan', () => {
    expect(normalizeForMatch('  KK   orang-tua,  dan KTP-el! ')).toBe('kk orang tua dan ktp el');
    expect(normalizeForMatch(`surat${DATAMARK}keterangan${DATAMARK}lahir`)).toBe('surat keterangan lahir');
  });

  it('locateQuote mengembalikan potongan asli dari teks sumber', () => {
    const c = chunk();
    expect(locateQuote(c.text, 'SURAT KETERANGAN LAHIR dari bidan')).toBe(
      'surat keterangan lahir dari bidan',
    );
  });

  it('kutipan terlalu pendek ditolak (mencegah kecocokan sepele)', () => {
    expect(locateQuote(chunk().text, 'dan')).toBeNull();
  });
});

describe('verifyGrounded (klaim-level)', () => {
  const real = { refId: 'c1', kutipanPersis: 'surat keterangan lahir dari bidan, KK orang tua' };

  it('klaim dengan kutipan asli lolos dan membawa sumber + Text Fragment', () => {
    const r = verifyGrounded(
      { klaim: [{ teks: 'Siapkan surat keterangan lahir dan KK.', kutipan: [real] }] },
      [chunk()],
      {},
      NOW,
    );
    expect(r.handoff).toBeUndefined();
    expect(r.klaimDibuang).toBe(0);
    const cit = r.klaim[0]!.kutipan[0]!;
    expect(cit.url).toBe(URL1);
    expect(cit.textFragmentUrl.startsWith(`${URL1}#:~:text=`)).toBe(true);
    expect(cit.perluDicekUlang).toBe(false);
  });

  it('kutipan karangan dibuang; klaim asli tetap', () => {
    const r = verifyGrounded(
      {
        klaim: [
          {
            teks: 'Wajib membayar Rp 500.000.',
            kutipan: [{ refId: 'c1', kutipanPersis: 'biaya pembuatan sebesar lima ratus ribu rupiah' }],
          },
          { teks: 'Siapkan surat keterangan lahir.', kutipan: [real] },
        ],
      },
      [chunk()],
      {},
      NOW,
    );
    expect(r.klaim).toHaveLength(1);
    expect(r.klaim[0]!.teks).toContain('surat keterangan lahir');
    expect(r.klaimDibuang).toBe(1);
  });

  it('klaim dengan satu kutipan asli + satu karangan dibuang seluruhnya', () => {
    const r = verifyGrounded(
      {
        klaim: [
          {
            teks: 'campuran',
            kutipan: [real, { refId: 'c1', kutipanPersis: 'harus datang membawa kambing hitam' }],
          },
        ],
      },
      [chunk()],
      {},
      NOW,
    );
    expect(r.klaim).toHaveLength(0);
    expect(r.handoff?.sebab).toBe('kutipan_tidak_terverifikasi');
  });

  it('refId yang tidak pernah diambil (halusinasi) dibuang', () => {
    const r = verifyGrounded(
      { klaim: [{ teks: 'x', kutipan: [{ refId: 'c99', kutipanPersis: real.kutipanPersis }] }] },
      [chunk()],
      {},
      NOW,
    );
    expect(r.klaim).toHaveLength(0);
  });

  it('klaim tanpa kutipan dibuang', () => {
    const r = verifyGrounded({ klaim: [{ teks: 'tanpa sumber', kutipan: [] }] }, [chunk()], {}, NOW);
    expect(r.klaim).toHaveLength(0);
    expect(r.klaimDibuang).toBe(1);
  });

  it('SEMUA karangan → hand-off ke kanal resmi dari registry (bukan jawaban)', () => {
    const r = verifyGrounded(
      {
        klaim: [
          { teks: 'a', kutipan: [{ refId: 'c1', kutipanPersis: 'karangan pertama yang panjang sekali' }] },
          { teks: 'b', kutipan: [{ refId: 'c1', kutipanPersis: 'karangan kedua yang juga panjang' }] },
        ],
      },
      [chunk()],
      { kodeKabKota: '3312' },
      NOW,
    );
    expect(r.klaim).toEqual([]);
    expect(r.klaimDibuang).toBe(2);
    expect(r.handoff?.alasan).toContain('Saya belum menemukan sumber resmi');
    expect(r.handoff?.kanal.length).toBeGreaterThan(0);
    expect(r.handoff?.kanal.every((k) => k.url?.startsWith('https://'))).toBe(true);
  });

  it('tanpa chunk sama sekali → hand-off tanpa_sumber', () => {
    const r = verifyGrounded({ klaim: [{ teks: 'x', kutipan: [real] }] }, [], {}, NOW);
    expect(r.handoff?.sebab).toBe('tanpa_sumber');
    expect(r.handoff?.kanal[0]?.url).toMatch(/^https:\/\//);
  });

  it('verifiedAt > 30 hari atau null → perluDicekUlang', () => {
    const old = verifyGrounded(
      { klaim: [{ teks: 'x', kutipan: [real] }] },
      [chunk({ verifiedAt: '2026-08-01T00:00:00.000Z' })],
      {},
      NOW,
    );
    expect(old.klaim[0]!.kutipan[0]!.perluDicekUlang).toBe(true);
    const nul = verifyGrounded(
      { klaim: [{ teks: 'x', kutipan: [real] }] },
      [chunk({ verifiedAt: null })],
      {},
      NOW,
    );
    expect(nul.klaim[0]!.kutipan[0]!.perluDicekUlang).toBe(true);
  });

  it('kutipan yang disalin model dari teks ber-datamark tetap cocok', () => {
    const marked = spotlight('rag', chunk().text, { nonce: 'n1' });
    const copied = marked.match(/surat.*?bidan/)?.[0] ?? '';
    expect(copied).toContain(DATAMARK);
    const r = verifyGrounded(
      { klaim: [{ teks: 'x', kutipan: [{ refId: 'c1', kutipanPersis: copied }] }] },
      [chunk()],
      {},
      NOW,
    );
    expect(r.klaim).toHaveLength(1);
    expect(r.klaim[0]!.kutipan[0]!.kutipanPersis).toBe('surat keterangan lahir dari bidan');
  });

  it('handoffChannels: kota terdaftar memakai registry; kode tak terdaftar jatuh ke sumber chunk', () => {
    expect(handoffChannels({ kodeKabKota: '3312', chunks: [] }).length).toBeGreaterThan(0);
    expect(handoffChannels({ kodeKabKota: '9999', chunks: [chunk()] })[0]?.url).toBe(URL1);
  });
});

describe('Text Fragment (WICG)', () => {
  it('encodeTerm meng-encode spasi, koma, ampersand, dan tanda hubung', () => {
    expect(encodeTerm('KTP-el, KK & akta')).toBe('KTP%2Del%2C%20KK%20%26%20akta');
    expect(encodeTerm('biaya (gratis)')).toBe('biaya%20%28gratis%29');
    expect(encodeTerm('Rp 50.000')).toBe('Rp%2050.000');
    expect(encodeTerm('perkawinan — pasutri')).toBe('perkawinan%20%E2%80%94%20pasutri');
  });

  it('bentuk dasar: url#:~:text=<kutipan ter-encode>', () => {
    expect(textFragmentUrl(URL1, chunk().text, 'surat keterangan lahir dari bidan')).toBe(
      `${URL1}#:~:text=surat%20keterangan%20lahir%20dari%20bidan`,
    );
  });

  it('kutipan panjang memakai bentuk rentang start,end', () => {
    const q =
      'surat keterangan lahir dari bidan, KK orang tua, dan KTP-el kedua orang tua. Layanan ini gratis';
    const u = textFragmentUrl(URL1, chunk().text, q);
    expect(u).toBe(`${URL1}#:~:text=surat%20keterangan%20lahir%20dari,tua.%20Layanan%20ini%20gratis`);
    expect(u).toContain(',');
    expect(u.split('text=')[1]!.split(',')).toHaveLength(2);
  });

  it('bagian awal ambigu → prefix- (bila ada konteks sebelum) atau ,-suffix (bila di awal teks)', () => {
    const mid = 'Isi A b c. Syarat KK wajib dibawa. Isi D e f. Syarat KK wajib dibawa. Isi G';
    const u1 = textFragmentUrl('https://x.go.id/a', mid, 'Syarat KK wajib dibawa');
    expect(decodeURIComponent(u1.split('text=')[1]!)).toBe('A b c.-,Syarat KK wajib dibawa');
    const head = 'Biaya pengurusan gratis untuk warga. Biaya pengurusan gratis untuk pelajar.';
    const u2 = textFragmentUrl('https://x.go.id/a', head, 'Biaya pengurusan gratis untuk');
    expect(decodeURIComponent(u2.split('text=')[1]!)).toBe(
      'Biaya pengurusan gratis untuk,-warga. Biaya pengurusan',
    );
  });

  it('mempertahankan fragmen yang sudah ada dan mengganti directive lama', () => {
    expect(appendTextFragment('https://x.go.id/a#syarat', 'text=abc')).toBe(
      'https://x.go.id/a#syarat:~:text=abc',
    );
    expect(appendTextFragment('https://x.go.id/a#:~:text=lama', 'text=baru')).toBe(
      'https://x.go.id/a#:~:text=baru',
    );
  });

  it('buildDirective: prefix-,start,end,-suffix', () => {
    expect(buildDirective({ prefix: 'a b', start: 'c', end: 'd', suffix: 'e-f' })).toBe(
      'text=a%20b-,c,d,-e%2Df',
    );
  });
});

describe('generateGroundedAnswer', () => {
  it('mengirim sumber ber-spotlight + skema strict, dan hasil lolos verifikasi', async () => {
    const answer = {
      klaim: [
        {
          teks: 'Siapkan surat keterangan lahir.',
          kutipan: [{ refId: 'c1', kutipanPersis: 'surat keterangan lahir dari bidan' }],
        },
      ],
      handoff: null,
    };
    const provider = new FakeProvider({ replies: [fakeCompletion({ content: JSON.stringify(answer) })] });
    const r = await generateGroundedAnswer({
      provider,
      model: 'm',
      caps: ALL_ON,
      pertanyaan: 'syarat akta lahir?',
      chunks: [chunk()],
    });
    expect(GroundedAnswerSchema.safeParse(r.data).success).toBe(true);
    const call = provider.calls[0];
    const prompt = call?.kind === 'create' ? JSON.stringify(call.params.messages) : '';
    expect(prompt).toContain('DATA_TAK_TEPERCAYA');
    expect(prompt).toContain(DATAMARK);
    const v = verifyGrounded(r.data, [chunk()], {}, NOW);
    expect(v.klaim).toHaveLength(1);
  });
});
