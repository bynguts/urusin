import type { EmailMessage } from './mailer.js';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Kerangka HTML sederhana: satu kolom, teks 18 px, satu tombol, tanpa gambar/pelacak. */
function html(judul: string, paragraf: string[], tombol: { teks: string; href: string }, catatan: string) {
  const p = paragraf
    .map((t) => `<p style="margin:0 0 16px;font-size:18px;line-height:1.6">${esc(t)}</p>`)
    .join('');
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(judul)}</title></head>
<body style="margin:0;padding:24px;background:#ffffff;color:#0f172a;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto">
<h1 style="font-size:24px;margin:0 0 16px">${esc(judul)}</h1>
${p}
<p style="margin:24px 0"><a href="${esc(tombol.href)}" style="display:inline-block;padding:14px 24px;background:#0f766e;color:#ffffff;border-radius:8px;font-size:18px;text-decoration:none">${esc(tombol.teks)}</a></p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.6">Bila tombol tidak bisa ditekan, salin alamat ini ke peramban:<br><span style="word-break:break-all">${esc(tombol.href)}</span></p>
<p style="margin:24px 0 0;font-size:16px;color:#475569">${esc(catatan)}</p>
<p style="margin:16px 0 0;font-size:16px;color:#475569">Urusin tidak pernah meminta kata sandi, kode OTP, atau NIK lewat email.</p>
</div></body></html>`;
}

function text(judul: string, paragraf: string[], tombol: { teks: string; href: string }, catatan: string) {
  return [
    judul,
    '',
    ...paragraf.flatMap((t) => [t, '']),
    `${tombol.teks}: ${tombol.href}`,
    '',
    catatan,
    '',
    'Urusin tidak pernah meminta kata sandi, kode OTP, atau NIK lewat email.',
  ].join('\n');
}

function pesan(
  to: string,
  jenis: EmailMessage['jenis'],
  subject: string,
  paragraf: string[],
  tombol: { teks: string; href: string },
  catatan: string,
): EmailMessage {
  return {
    to,
    jenis,
    subject,
    link: tombol.href,
    html: html(subject, paragraf, tombol, catatan),
    text: text(subject, paragraf, tombol, catatan),
  };
}

export function emailAturUlang(to: string, link: string): EmailMessage {
  return pesan(
    to,
    'atur-ulang',
    'Atur ulang kata sandi Urusin',
    [
      'Ada permintaan untuk mengatur ulang kata sandi akun Urusin Anda.',
      'Tekan tombol di bawah untuk membuat kata sandi baru. Semua perangkat akan dikeluarkan.',
    ],
    { teks: 'Buat kata sandi baru', href: link },
    'Tautan berlaku 30 menit dan hanya bisa dipakai sekali. Bila Anda tidak memintanya, abaikan email ini.',
  );
}

/** Dikirim setiap kali akun Google ditautkan ke akun (bukan saat mendaftar lewat Google). */
export function emailGoogleDitautkan(to: string, linkPengaturan: string): EmailMessage {
  return pesan(
    to,
    'google-ditautkan',
    'Akun Google ditautkan ke Urusin',
    [
      'Sebuah akun Google baru saja ditautkan ke akun Urusin Anda dan kini bisa dipakai untuk masuk.',
      'Bila itu bukan Anda, buka Pengaturan, lepas Google, lalu keluar dari semua perangkat dan ganti kata sandi.',
    ],
    { teks: 'Buka Pengaturan', href: linkPengaturan },
    'Bila Anda sendiri yang menautkannya, abaikan email ini.',
  );
}
