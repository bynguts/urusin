import { crc32, deflateSync } from 'node:zlib';

/** Bitmap 5×7 angka "7" untuk probe vision (gambar kecil, tanpa aset biner di repo). */
const SEVEN = ['11111', '00001', '00010', '00100', '01000', '01000', '01000'];

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** PNG grayscale 64×64: angka 7 hitam besar di latar putih. */
export function digitPng(size = 64): Buffer {
  const scale = Math.floor(size / 8);
  const ox = Math.floor((size - 5 * scale) / 2);
  const oy = Math.floor((size - 7 * scale) / 2);
  const raw = Buffer.alloc(size * (size + 1), 255);
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - ox) / scale);
      const gy = Math.floor((y - oy) / scale);
      const on = x >= ox && y >= oy && SEVEN[gy]?.[gx] === '1';
      raw[y * (size + 1) + 1 + x] = on ? 0 : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** WAV PCM 16-bit mono berisi hening, untuk probe transkripsi. */
export function silentWav(seconds = 1, sampleRate = 16_000): Buffer {
  const dataLen = seconds * sampleRate * 2;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataLen, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataLen, 40);
  return Buffer.concat([h, Buffer.alloc(dataLen)]);
}
