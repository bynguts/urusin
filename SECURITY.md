# Kebijakan Keamanan / Security Policy

[Bahasa Indonesia](#bahasa-indonesia) | [English](#english)

## Bahasa Indonesia

### Melaporkan kerentanan

Jangan membuka issue publik untuk kerentanan. Laporkan secara privat lewat salah satu cara berikut:

1. Tab **Security** di repositori GitHub ini, tombol **Report a vulnerability** (laporan privat ke pengelola).
2. Email ke `muhammadbibin70@gmail.com` dengan subjek diawali `[urusin-security]`.

Sertakan: komponen yang terdampak (web, ekstensi, fixtures, paket), langkah mereproduksi, dampak yang Anda
perkirakan, dan versi (`v<sha7>` di footer aplikasi atau SHA commit). **Jangan melampirkan data pribadi nyata**
(NIK, KK, nomor HP, alamat, foto dokumen). Gunakan data karangan.

Kami berusaha membalas dalam beberapa hari kerja. Ini proyek tim kecil: kami tidak menjanjikan SLA atau hadiah
(bounty). Kami akan menyebut pelapor di catatan perbaikan bila Anda mau.

### Cakupan

Dalam cakupan:

- Kode di repositori ini: `apps/web`, `apps/extension`, `apps/fixtures`, `packages/*`, dan `deploy/`.
- Instansi yang berjalan dari image yang dibangun repositori ini, misalnya kebocoran data pribadi lewat server
  atau log, pembobolan guard placeholder (`noPlaceholder()`), pelolosan registry domain resmi (origin
  lookalike), pelanggaran gate kedua ekstensi, injeksi prompt yang menyebabkan aksi tulis tanpa persetujuan
  warga, kebocoran rahasia, atau kelemahan CSP/CSRF.

Di luar cakupan:

- Situs pemerintah pihak ketiga yang diotomasi pengguna (laporkan ke instansi terkait).
- Serangan yang butuh perangkat warga yang sudah dikuasai penyerang.
- Pengujian beban, DoS, rekayasa sosial, dan serangan fisik.
- Kerentanan di dependensi tanpa jalur yang bisa dieksploitasi lewat Urusin (laporkan ke proyek hulunya).
- Fixture profil `local` yang memang sengaja berisi halaman phishing/injeksi untuk pengujian (hanya laptop dan CI).

Mohon uji hanya pada instansi milik Anda sendiri atau fixture lokal, dan jangan mengakses data orang lain.

### Yang sengaja TIDAK dilakukan sistem ini

Hal-hal berikut adalah keputusan desain, bukan celah:

- **Tidak ada bypass CAPTCHA.** CAPTCHA, captcha matematika, dan Turnstile selalu dijawab warga sendiri.
  Tidak ada layanan penyelesai CAPTCHA dan tidak ada operasi DSL yang mengisi kolom captcha.
- **Tidak ada teknik anti-deteksi.** Tidak ada penyamaran sidik jari peramban, rotasi IP, atau pemalsuan agen
  pengguna. Urusin berjalan di peramban dan sesi login warga sendiri.
- **Tidak ada pengiriman akhir otomatis.** Tombol kirim terakhir selalu ditekan warga lewat `gate.human`.
- **Tidak ada kredensial warga di server.** Server tidak memegang sesi atau kata sandi situs pemerintah.
- **Tidak ada data pribadi ke model.** Model hanya melihat placeholder seperti `{{PEMOHON.NIK}}`.
- **Tidak ada bebas pilih domain.** Hanya origin `https://` yang terdaftar persis di registry yang dianggap resmi.

Risiko sisa yang kami akui: JavaScript yang dikirim server dapat membaca vault PII di peramban bila server
dibobol. Laporan yang memperkecil risiko ini sangat kami hargai.

## English

### Reporting a vulnerability

Do not open a public issue for a vulnerability. Report it privately through one of these:

1. The **Security** tab of this GitHub repository, **Report a vulnerability** (private report to the maintainers).
2. Email `muhammadbibin70@gmail.com` with a subject starting with `[urusin-security]`.

Include: the affected component (web, extension, fixtures, packages), reproduction steps, your estimate of the
impact, and the version (`v<sha7>` in the app footer, or the commit SHA). **Do not attach real personal data**
(national ID numbers, family card numbers, phone numbers, addresses, document photos). Use made-up data.

We aim to reply within a few working days. This is a small-team project: we do not promise an SLA or a bounty.
We will credit you in the fix notes if you wish.

### Scope

In scope:

- Code in this repository: `apps/web`, `apps/extension`, `apps/fixtures`, `packages/*`, and `deploy/`.
- Instances running images built from this repository, for example personal-data leaks through the server or
  logs, bypassing the placeholder guard (`noPlaceholder()`), getting past the official-domain registry
  (lookalike origins), violating the extension's second gate, prompt injection that causes a write action
  without the citizen's approval, secret leaks, or CSP/CSRF weaknesses.

Out of scope:

- Third-party government sites that users automate (report those to the agency).
- Attacks that require an already attacker-controlled citizen device.
- Load testing, DoS, social engineering, and physical attacks.
- Vulnerabilities in dependencies with no exploitable path through Urusin (report upstream).
- The `local` fixture profile, which intentionally contains phishing/injection pages for testing (laptop and CI only).

Please test only against your own instance or local fixtures, and never access other people's data.

### What this system deliberately does NOT do

The following are design decisions, not vulnerabilities:

- **No CAPTCHA bypass.** CAPTCHAs, math captchas, and Turnstile are always answered by the citizen. There is no
  solver service and no DSL operation that fills a captcha field.
- **No anti-detection.** No browser fingerprint masking, IP rotation, or user-agent spoofing. Urusin runs in the
  citizen's own browser and login session.
- **No automatic final submission.** The last submit button is always pressed by the citizen through `gate.human`.
- **No citizen credentials on the server.** The server holds no government-site sessions or passwords.
- **No personal data to the model.** The model only sees placeholders such as `{{PEMOHON.NIK}}`.
- **No free-form domain choice.** Only `https://` origins that exactly match the registry count as official.

A residual risk we acknowledge: JavaScript served by the server can read the browser PII vault if the server is
compromised. Reports that reduce this risk are especially welcome.
