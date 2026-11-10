// Data uji dibangun dari potongan agar file ini sendiri tidak memicu pii-scan.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedEmail,
  isEntriBersumber,
  isNikLike,
  isSkippedPath,
  mask,
  scanKontakJson,
  scanText,
} from '../pii-scan.mjs';

const join = (...parts) => parts.join('');
// 33 12 01 | 15 08 90 | 0001 → Jawa Tengah, tgl 15, bln 08
const NIK_MALE = join('331201', '150890', '0001');
// tanggal + 40 untuk perempuan
const NIK_FEMALE = join('331201', '550890', '0002');
const kinds = (text, opts) => scanText(text, opts).map((f) => f.kind);

describe('isNikLike', () => {
  it('menerima NIK laki-laki dan perempuan dengan kode provinsi valid', () => {
    assert.equal(isNikLike(NIK_MALE), true);
    assert.equal(isNikLike(NIK_FEMALE), true);
  });
  it('menolak kode provinsi tidak valid', () => {
    assert.equal(isNikLike(join('991201', '150890', '0001')), false);
    assert.equal(isNikLike(join('101201', '150890', '0001')), false);
  });
  it('menolak tanggal/bulan mustahil', () => {
    assert.equal(isNikLike(join('331201', '350890', '0001')), false);
    assert.equal(isNikLike(join('331201', '151390', '0001')), false);
    assert.equal(isNikLike(join('331201', '000890', '0001')), false);
  });
  it('menolak panjang selain 16 digit', () => {
    assert.equal(isNikLike(NIK_MALE.slice(0, 15)), false);
  });
});

describe('scanText', () => {
  it('mendeteksi NIK berdiri sendiri', () => {
    assert.deepEqual(kinds(`nik: ${NIK_MALE}`), ['nik']);
  });
  it('mengabaikan 16 digit yang bagian dari angka lebih panjang', () => {
    assert.deepEqual(kinds(`id=${NIK_MALE}99`), []);
  });
  it('mendeteksi nomor HP berbagai format', () => {
    assert.deepEqual(kinds(join('hp ', '0812', '34567890')), ['phone']);
    assert.deepEqual(kinds(join('hp ', '+62', '812', '3456', '7890')), ['phone']);
    assert.deepEqual(kinds(join('hp ', '0812', '-3456', '-7890')), ['phone']);
    assert.deepEqual(kinds(join('wa ', '62', '81234567890')), ['phone']);
  });
  it('tidak menganggap angka biasa sebagai HP', () => {
    assert.deepEqual(kinds('versi 0.8.1 dan port 8080'), []);
    assert.deepEqual(kinds(join('kode ', '0712', '34567890')), []);
  });
  it('mendeteksi email selain allowlist', () => {
    assert.deepEqual(kinds(join('kontak budi', '@', 'gmail.com')), ['email']);
    assert.deepEqual(kinds(join('kontak demo', '@', 'example.com')), []);
    assert.deepEqual(kinds(join('noreply', '@', 'urusin.id')), []);
  });
  it('menghormati email tim yang diizinkan', () => {
    const team = [join('tim', '@', 'contoh.id')];
    assert.deepEqual(kinds(join('author tim', '@', 'contoh.id'), { teamEmails: team }), []);
  });
  it('mendeteksi private key', () => {
    assert.deepEqual(kinds(join('-----BEGIN ', 'RSA ', 'PRIVATE KEY-----')), ['private-key']);
    assert.deepEqual(kinds(join('-----BEGIN ', 'OPENSSH ', 'PRIVATE KEY-----')), ['private-key']);
    assert.deepEqual(kinds(join('-----BEGIN ', 'PRIVATE KEY-----')), ['private-key']);
    assert.deepEqual(kinds(join('-----BEGIN ', 'PUBLIC KEY-----')), []);
  });
  it('melaporkan nomor baris dan menyamarkan nilai', () => {
    const [f] = scanText(`baris satu\nnik ${NIK_MALE}`);
    assert.equal(f?.line, 2);
    assert.ok(!f?.match.includes(NIK_MALE.slice(2, 14)));
  });
  it('melewati baris bertanda pii-scan:allow', () => {
    assert.deepEqual(kinds(`contoh ${NIK_MALE} // ${'pii-scan'}:allow`), []);
  });
});

describe('isAllowedEmail', () => {
  it('mengizinkan subdomain example.com dan git@github.com', () => {
    assert.equal(isAllowedEmail(join('a', '@', 'mail.example.com')), true);
    assert.equal(isAllowedEmail(join('git', '@', 'github.com')), true);
    assert.equal(isAllowedEmail(join('a', '@', 'example.com.evil.id')), false);
  });
});

describe('mask', () => {
  it('menyamarkan bagian tengah', () => {
    assert.equal(mask('abcdefgh'), 'ab****gh');
    assert.equal(mask('abc'), '****');
  });
});

describe('isSkippedPath', () => {
  it('melewati lockfile, biner, dan hanya berkas hasil generator wilayah-data.ts', () => {
    assert.equal(isSkippedPath('pnpm-lock.yaml'), true);
    assert.equal(isSkippedPath('apps/web/static/logo.png'), true);
    assert.equal(isSkippedPath('packages/registry/src/wilayah-data.ts'), true);
  });
  it('JSON kontak resmi, tetangga, dan salinan di folder lain tetap dipindai', () => {
    assert.equal(isSkippedPath('data/wilayah/kanal-layanan.json'), false);
    assert.equal(isSkippedPath('data/wilayah/sumber-kanal.json'), false);
    assert.equal(isSkippedPath('data/wilayah/kontak-dukcapil.json'), false);
    assert.equal(isSkippedPath('packages/registry/src/kanal-layanan.ts'), false);
    assert.equal(isSkippedPath('fixtures/packages/registry/src/wilayah-data.ts'), false);
  });
});

describe('scanKontakJson', () => {
  const WA = join('0811', '-8355', '-599');
  const EMAIL = join('dukcapil', '@', 'contohkab.go.id');
  const entri = (o) => ({
    kode: '3404',
    layanan: 'adminduk',
    jenis: 'whatsapp',
    nilai: WA,
    sumberUrl: 'https://dukcapil.contohkab.go.id/',
    dicekPada: '2026-11-10',
    ...o,
  });
  const scan = (data) => scanKontakJson(JSON.stringify(data, null, 2));

  it('entri bersumber https .go.id / .polri.go.id bertanggal cek lolos', () => {
    const data = {
      entri: [
        entri(),
        entri({ jenis: 'email', nilai: EMAIL }),
        entri({ layanan: 'skck', sumberUrl: 'https://polres.contoh.polri.go.id/kontak' }),
      ],
    };
    assert.deepEqual(scan(data), []);
  });

  it('entri tanpa sumber, sumber bukan https .go.id, atau tanpa dicekPada ditolak', () => {
    const tolak = [
      entri({ sumberUrl: undefined }),
      entri({ sumberUrl: 'http://dukcapil.contohkab.go.id/' }),
      entri({ sumberUrl: 'https://dukcapil-contohkab.blogspot.com/' }),
      entri({ sumberUrl: 'https://go.id.penipu.com/' }),
      entri({ dicekPada: undefined }),
      entri({ dicekPada: 'kemarin' }),
    ];
    for (const e of tolak)
      assert.deepEqual(
        scan({ entri: [e] }).map((f) => f.kind),
        ['phone'],
        JSON.stringify(e),
      );
  });

  it('nomor/email di luar nilai langsung entri bersumber ditolak walau sama dengan nomor resmi', () => {
    const f = scan({ catatan: `hubungi ${WA}`, entri: [entri({ instansi: { kontak: EMAIL } })] });
    assert.deepEqual(
      f.map((x) => [x.kind, x.line]),
      [
        ['phone', '$.catatan'],
        ['email', '$.entri[0].instansi.kontak'],
      ],
    );
  });

  it('NIK di berkas kanal ditolak, juga di dalam entri bersumber dan dengan penanda allow', () => {
    const allow = `// ${'pii-scan'}:allow`;
    assert.deepEqual(
      scan({ entri: [entri({ nilai: `${WA} NIK ${NIK_MALE} ${allow}` })] }).map((f) => f.kind),
      ['nik'],
    );
    assert.deepEqual(
      scan({ entri: [entri({ catatan: Number(NIK_FEMALE) })] }).map((f) => f.kind),
      ['nik'],
    );
  });

  it('JSON rusak dipindai sebagai teks biasa', () => {
    assert.deepEqual(
      scanKontakJson(`{"nilai": "${WA}"`).map((f) => f.kind),
      ['phone'],
    );
  });

  it('isEntriBersumber menolak bukan-objek', () => {
    assert.equal(isEntriBersumber(null), false);
    assert.equal(isEntriBersumber([entri()]), false);
    assert.equal(isEntriBersumber(entri()), true);
  });
});
