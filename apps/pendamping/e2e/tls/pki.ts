import {
  createECDH,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';

/**
 * PKI uji e2e TLS (tanpa openssl, tanpa berkas kunci di repo): sertifikat X.509 ECDSA P-256 dibangun dengan
 * pengode DER kecil. Kunci root uji dan intermediate uji DITURUNKAN dari benih publik (`kunciTetap`), jadi
 * sertifikatnya bisa dikomit (dan dimuat ke basis data NSS uji `nssdb/`) tanpa pernah mengomit kunci privat.
 * Root uji dibatasi nameConstraints ke 127.0.0.0/8 dan hanya dipercaya di HOME Chromium e2e, tidak pernah di image.
 */

const len = (n: number) =>
  n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
const tlv = (tag: number, ...isi: Buffer[]) => {
  const b = Buffer.concat(isi);
  return Buffer.concat([Buffer.from([tag]), len(b.length), b]);
};
const seq = (...isi: Buffer[]) => tlv(0x30, ...isi);
const set = (...isi: Buffer[]) => tlv(0x31, ...isi);
const eks = (n: number, ...isi: Buffer[]) => tlv(0xa0 + n, ...isi);
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const oktet = (b: Buffer) => tlv(0x04, b);
const bit = (b: Buffer, sisa = 0) => tlv(0x03, Buffer.from([sisa]), b);
const intBuf = (b: Buffer) => {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const t = b.subarray(i);
  return tlv(0x02, t[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), t]) : t);
};
const int = (n: number) => intBuf(Buffer.from([n]));
function oid(s: string): Buffer {
  const p = s.split('.').map(Number);
  const out = [40 * p[0]! + p[1]!];
  for (const v of p.slice(2)) {
    const b = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) b.unshift((x & 0x7f) | 0x80);
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
}
const waktu = (d: Date) => tlv(0x18, Buffer.from(d.toISOString().replace(/[-:T]|\.\d+/g, ''), 'latin1'));
const nama = (cn: string) =>
  seq(
    set(seq(oid('2.5.4.10'), tlv(0x0c, Buffer.from('Urusin Uji E2E')))),
    set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn)))),
  );
const ext = (id: string, kritis: boolean, isi: Buffer) =>
  seq(oid(id), ...(kritis ? [bool(true)] : []), oktet(isi));

export type Pihak = { cn: string; kunci: KeyObject; publik: KeyObject };

const spki = (k: KeyObject) => k.export({ type: 'spki', format: 'der' });
/** SKI = SHA-1 BIT STRING kunci publik (RFC 5280 4.2.1.2 metode 1). */
const ski = (k: KeyObject) => createHash('sha1').update(spki(k).subarray(-65)).digest();

/** Kunci P-256 yang diturunkan dari benih publik: sertifikat root/intermediate uji bisa dikomit tanpa kunci. */
export function kunciTetap(benih: string): { kunci: KeyObject; publik: KeyObject } {
  const d = createHash('sha256').update(`urusin-e2e-tls:${benih}`).digest();
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey();
  const b64 = (b: Buffer) => b.toString('base64url');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)), d: b64(d) };
  return {
    kunci: createPrivateKey({ key: jwk, format: 'jwk' }),
    publik: createPublicKey({ key: jwk, format: 'jwk' }),
  };
}

export function kunciAcak(): { kunci: KeyObject; publik: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { kunci: privateKey, publik: publicKey };
}

export type JenisSertifikat = 'root' | 'antara' | 'leaf';

/**
 * Sertifikat X.509 v3 ECDSA-SHA256. `penerbit` undefined = self-signed. Leaf: SAN IP 127.0.0.1 + serverAuth.
 * Root: nameConstraints hanya 127.0.0.0/8.
 */
export function terbitkan(p: {
  subjek: Pihak;
  penerbit?: Pihak | undefined;
  jenis: JenisSertifikat;
  mulai: Date;
  akhir: Date;
}): X509Certificate {
  const penerbit = p.penerbit ?? p.subjek;
  const ca = p.jenis !== 'leaf';
  const ekstensi = [
    ext('2.5.29.19', true, seq(...(ca ? [bool(true)] : []), ...(p.jenis === 'antara' ? [int(0)] : []))),
    // keyUsage: CA = keyCertSign|cRLSign, leaf = digitalSignature.
    ext('2.5.29.15', true, ca ? bit(Buffer.from([0x06]), 1) : bit(Buffer.from([0x80]), 7)),
    ext('2.5.29.14', false, oktet(ski(p.subjek.publik))),
    ...(p.penerbit ? [ext('2.5.29.35', false, seq(tlv(0x80, ski(penerbit.publik))))] : []),
    ...(p.jenis === 'leaf'
      ? [
          ext('2.5.29.17', false, seq(tlv(0x87, Buffer.from([127, 0, 0, 1])))),
          ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),
        ]
      : []),
    ...(p.jenis === 'root'
      ? [ext('2.5.29.30', true, seq(eks(0, seq(tlv(0x87, Buffer.from([127, 0, 0, 0, 255, 0, 0, 0]))))))]
      : []),
  ];
  const algo = seq(oid('1.2.840.10045.4.3.2'));
  const serial = randomBytes(16);
  serial[0]! &= 0x7f;
  const tbs = seq(
    eks(0, int(2)),
    intBuf(serial),
    algo,
    nama(penerbit.cn),
    seq(waktu(p.mulai), waktu(p.akhir)),
    nama(p.subjek.cn),
    spki(p.subjek.publik),
    eks(3, seq(...ekstensi)),
  );
  const ttd = sign('sha256', tbs, penerbit.kunci);
  return new X509Certificate(seq(tbs, algo, bit(ttd)));
}

/** Pihak tetap PKI uji: root (dipercaya di NSS uji), intermediate yang ADA di NSS uji, dan yang HILANG. */
export const ROOT_UJI: Pihak = { cn: 'Urusin Uji Root', ...kunciTetap('root') };
export const ANTARA_ADA: Pihak = { cn: 'Urusin Uji Intermediate Terbundel', ...kunciTetap('antara-ada') };
export const ANTARA_HILANG: Pihak = { cn: 'Urusin Uji Intermediate Hilang', ...kunciTetap('antara-hilang') };
