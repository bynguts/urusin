---
name: Urusin
description: Agen AI pendamping layanan kependudukan dan administrasi publik warga
colors:
  primary: '#252522'
  neutral-bg: '#FFFCFA'
  warm-bg: '#F7F2ED'
  card-bg: '#FCF8F5'
  stroke: '#EFE6DC'
  stroke-strong: '#E6DBD1'
  brand-orange: '#ED5A31'
  brand-leaf: '#D6C530'
  accent-orange: '#F2805D'
  accent-green: '#AD9D25'
  accent-gold: '#C8B828'
  error: '#EF4343'
  valid: '#50AD25'
  a11y-error: '#A92727'
typography:
  display:
    fontFamily: 'Strawberry Sans, sans-serif'
    fontSize: '47.8px'
    fontWeight: 480
    lineHeight: 1.1
    letterSpacing: '-1.912px'
  heading-large:
    fontFamily: 'Strawberry Sans, sans-serif'
    fontSize: '40px'
    fontWeight: 480
    lineHeight: 1.2
    letterSpacing: '-1.6px'
  heading-card:
    fontFamily: 'Strawberry Sans, sans-serif'
    fontSize: '24px'
    fontWeight: 480
    lineHeight: 1.2
    letterSpacing: '-0.96px'
  body:
    fontFamily: 'Strawberry Sans, sans-serif'
    fontSize: '17px'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: '-0.17px'
  card-body:
    fontFamily: 'Strawberry Sans, sans-serif'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: '-0.16px'
rounded:
  base: '10px'
  card: '20px'
  pill: '100px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
  xxl: '48px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.neutral-bg}'
    rounded: '{rounded.pill}'
    padding: '10px 24px'
  button-primary-hover:
    backgroundColor: '{colors.primary}'
    opacity: 0.9
  card-urusan:
    backgroundColor: '{colors.card-bg}'
    rounded: '{rounded.card}'
    padding: '24px'
---

# Urusin design system

Design system Urusin untuk landing dan web app desktop (diperbarui 9 November 2026). Bahasa visual awalnya diturunkan dari homepage Strawberry Browser, lalu disesuaikan penuh untuk produk pendamping layanan publik Urusin.

Deliverable utama berada dalam `urusin.pen`: **1 frame utama, 24 section (12 Light + 12 Dark), 105 reusable components (termasuk karakter, objek, dan pola), 77 canvas variables**. Frame utama `NVcu7` (Urusin • Design System / Light + Dark). Aset brand Urusin ada di frame `Ergbs` (Urusin • Brand assets). Light dan Dark disusun berdampingan dalam satu kanvas. Frame sumber tidak diubah.

## Navigasi section Light

- **Actions & states** — node `rUrt2`.
- **Navigation & controls** — node `uaLHF`.
- **Content & conversation** — node `C5EQ8`.
- **Urusin design system** — node `wUS0d`.
- **Type, rhythm & surfaces** — node `BIIiC`.
- **Layout desktop** — node `ADX3m`.
- **Page patterns & imagery** — node `jQ0Wn`.
- **Motion & accessibility** — node `omgLx`.
- **Implementation & handoff** — node `jUdEA`.
- **App shell & status** — node `LAR97` (sidebar, status urusan, langkah rencana, label pelaku).
- **Browser Pendamping** — node `Uto8t` (anatomi, chip mode, banner giliran).
- **Auth & data diri** — node `f1vxk` (formulir Google + email, tabel data diri, token status).

## Foundation

| Role                             | Nilai                       |
| -------------------------------- | --------------------------- |
| Canvas / background              | #FFFCFA                     |
| Warm section                     | #F7F2ED                     |
| Primary text / CTA               | #252522                     |
| Muted text                       | #252522 pada 56%            |
| Body mix                         | #252522 pada sekitar 70.08% |
| Card text                        | #252522 pada 82%            |
| Stroke                           | #EFE6DC                     |
| Stronger stroke                  | #E6DBD1                     |
| Logo orange / leaf               | #ED5A31 / #D6C530           |
| CSS accent orange / green / gold | #F2805D / #AD9D25 / #C8B828 |
| Source error / valid             | #EF4343 / #50AD25           |

CSS brand accents berbeda dengan warna logo. Dark mode adalah perluasan yang dirancang untuk permintaan pengguna, bukan theme resmi website.

### Typography

Font utama: **Strawberry Sans**, custom variable font weight 100–900. Strawberry Serif 500 dideklarasikan di sumber tetapi bukan font heading homepage yang diukur.

| Role                  | Font size / line height px | Weight | Tracking  |
| --------------------- | -------------------------- | ------ | --------- |
| Hero desktop          | 47.8 / 52.58               | 480    | -1.912 px |
| Heading large desktop | 40 / 48                    | 480    | -1.6 px   |
| FAQ desktop           | 36 / 39.6                  | 480    | -1.44 px  |
| Card heading          | 24 / 28.8                  | 480    | -0.96 px  |
| Lead                  | 21.6 / 29.808              | 400    | -0.216 px |
| Editorial body        | 17 / 27.2                  | 400    | -0.17 px  |
| Card body             | 16 / 24                    | 400    | -0.16 px  |
| Action medium         | 14 / 21                    | 500    | normal    |

Heading utility pada desktop ≥1024: 22, 24, 40, 44, 56, 72 px. Hero punya override, sehingga jangan menggantinya otomatis dengan utility terbesar.

### Spacing dan geometry

Spacing library: 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 64, 72, 96, 128 px. Ada nilai optik khusus seperti 9.6, 12.6, 22.4, dan 79.2 pada sumber.

Radius: 4, 8, 10 (base), 12, 16, 20 (kartu urusan), 24, 28 (FAQ bubble), 100 (pill).
Container max 1080 px; header 64 px.

Shadow soft sumber:

```css
box-shadow:
  0 0 0 1px rgb(0 0 0 / 0.06),
  0 1px 2px -1px rgb(0 0 0 / 0.06),
  0 2px 4px rgb(0 0 0 / 0.04);
```

## Komponen dan kontrak

- `Button/Primary/sm` — `zswc6`
- `Button/Primary/md` — `k3p6h`
- `Button/Primary/lg` — `iG9UD`
- `Button/Secondary` — `dEOys`
- `Button/Text` — `soCDd`
- `Button/Focus wrapper` — `sHJjQ`
- `Brand/Wordmark` — `Ob71Z` (lockup Urusin: mark + Lora 500)
- `Navigation/Desktop` — `rCufc`
- `Navigation/Link` — `o3m6K`
- `Button/Icon` — `QjC4b`
- `Input/Default` — `RnKJq`
- `Input/Focus` — `vjU9u`
- `Input/Error` — `urBk4`
- `Card/Urusan` — `A34wi`
- `FAQ/Question` — `ZbXxP`
- `FAQ/Answer` — `Xt7Wp`
- `Feedback/Loading` — `DhlMV`
- `Feedback/Empty` — `BUycr`
- `App/Sidebar` — `XNGdB`
- `Label/Pelaku/Anda` `Ds7Jk` · `/AI` `X5Asl` · `/Instansi` `xPI1j` · `/Urusin` `tz7aw`
- `Chip/Mode/AI sedang mengisi` `dCQZn` · `/Giliran Anda` `TvIBT` · `/Dijeda` `jRWBh`
- `Chip/AI mengisi kolom` — `kUcYz` (label di atas kolom yang sedang diisi)
- `Status/Giliran Anda` — `G1sZ8`
- `Icon/Google` — `cuO5i` (artwork belum diisi)
- `Feedback/Error` — `KYImE`

Gunakan ref/instance untuk reuse. Override Label/Icon/content per instance; edit master untuk perubahan visual lintas instance. Namespace `sb.*` adalah penamaan library ini.

Button primary:

| Size           | Type           | Padding vertical / horizontal | Height sumber |
| -------------- | -------------- | ----------------------------- | ------------- |
| SM             | 13 / 19.5, 500 | 8 / 20                        | 35.5          |
| MD             | 14 / 21, 500   | 10 / 24                       | 41            |
| LG hero        | 15 / 22.5, 500 | 12 / 28                       | 46.5          |
| LG generic CSS | 15 / 22.5, 500 | 12 / 32                       | 46.5          |

Gap ikon 6 px, radius 100. Hover opacity .9; busy opacity .8. Button/Secondary ("Lihat cara kerja") memakai white background dan soft shadow. Text action memakai padding 8 × 4 dan trailing arrow.

Untuk komponen form: label → control → helper/error. Rekomendasi hit area 44 × 44 px minimum, meskipun SM/MD sumber lebih kecil. Status error harus menyampaikan pesan yang bisa ditindaklanjuti.

## Aset Urusin

Semua aset berikut adalah reusable component di frame `Ergbs` dan dipakai oleh landing `n2rpg`, halaman web `Urusin • Web · Cara kerja / Urusan / Privasi / Tanya jawab`, serta layar aplikasi `Urusin • App 01–15` (sidebar: komponen `App/Sidebar` `XNGdB`).

Urusin tidak memakai ekstensi browser. Pengisian formulir terjadi di **Browser Pendamping**: browser di server Urusin yang disiarkan ke layar warga (App 06–07, papan keadaan `Urusin • Browser Pendamping · Keadaan`). Bilah atas memuat gembok + domain resmi + chip mode; chip `AI sedang mengisi` memakai `ur.indigo.*`, chip `Giliran Anda` memakai `ur.amber.*` (selalu ikon + teks). Bilah bawah memuat progres, Ambil alih, dan Hentikan (≥ 48 px).

| Kelompok       | Isi                                                                                       | Catatan                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand          | `Brand/Mark` `ik5Sc`, `Brand/Lockup` `ZpyFD`, lockup dark, app icon terang/gelap, favicon | Mark piksel oranye #ED5A31 + daun olive #D6C530; wordmark Lora 500.                                                                                                    |
| Karakter       | 5 pendamping × 5 pose (`Character/<Warna>/<Pose>`)                                        | Rose = kelahiran, Purple = menikah, Blue = pindah rumah, Green = kehilangan keluarga, Amber = KTP & dokumen. Pose: berdiri, duduk, melambai, berpikir, satu aksi khas. |
| Avatar         | `Avatar/<Warna>`                                                                          | Potret kepala khusus, latar badge.* per warna.                                                                                                                         |
| Objek 3D       | `Object/Browser`, `Dokumen`, `KTP`, `Kamera`, `Perisai`, `Rumah`, `Stempel`               | Clay putih isometrik dengan aksen orange/olive.                                                                                                                        |
| Badge & status | `Badge/<Peristiwa>`, `Status/<Keadaan>`, `Chip/Agen mengisi`                              | Status memakai ur.green / ur.amber.                                                                                                                                    |
| Pola           | `Pattern/Hero`, `Pattern/Card/<Warna>`, `Pattern/Band`                                    | Shader `../shaders/ambient-grid.glsl`, meniru ambient grid homepage referensi.                                                                                         |
| Tile           | 16 `Tile/<Layanan>`                                                                       | Untuk dinding ikon layanan publik.                                                                                                                                     |

Aturan pemakaian:

- Satu warna per pendamping; jangan mencampur warna karakter dan badge.
- Pilih pose sesuai konteks: melambai untuk sambutan, berpikir untuk FAQ, duduk di tepi kartu untuk fitur, berdiri di belakang jendela demo pada hero.
- Karakter tidak boleh menutupi konten UI; letakkan di belakang atau di tepi.
- Pola grid hanya di hero (di belakang header), stage kartu, band perbandingan/FAQ, dan CTA penutup.
- Bahasa Indonesia sederhana dan hangat, sapa dengan "kamu". Jangan mengklaim integrasi atau testimoni yang belum ada.

Sumber gambar: `../assets/characters`, `../assets/avatars`, `../assets/objects` (dibuat dengan gpt-image-2.5 memakai karakter berdiri sebagai referensi), serta `../brand/urusin-mark.png` (latar transparan).

## Layout desktop

Urusin difokuskan untuk desktop. Tidak ada varian mobile atau navigasi hamburger.

| Area               | Aturan                                                             |
| ------------------ | ------------------------------------------------------------------ |
| Landing            | Container 1080 px, header 64 px, section padding vertikal 64–96 px |
| Web app            | Viewport 1440 × 960; sidebar 248 px + panel utama (radius 16)      |
| Halaman urusan     | Percakapan (fill) + panel konteks 400 px                           |
| Browser Pendamping | Siaran (fill) + panel langkah & chat 400 px                        |
| Auth               | Panel brand 640 px + panel formulir, lebar form 440 px             |

## Motion

- CTA opacity: 150 ms.
- Logo / icon controls: 200 ms.
- Nav color: 300 ms.
- Hero title entrance: 400 ms.
- Balanced easing: cubic-bezier(.45, 0, .55, 1).
- Hero entrance: cubic-bezier(.16, 1, .3, 1).
- Source reduced-motion menonaktifkan hero animation dan carousel transition; konten tetap opacity 1.

## Kontras dan aksesibilitas

Perhitungan relative luminance sRGB pada #FFFCFA, alpha dikompositkan terlebih dahulu:

| Pair                       | Ratio   | Normal text 4.5:1 |
| -------------------------- | ------- | ----------------- |
| Primary (#252522)          | 15.04:1 | Lulus             |
| Secondary 56% (#858481)    | 3.66:1  | Tidak lulus       |
| Body 70.08% (#666563)      | 5.70:1  | Lulus             |
| Orange (#ED5A31)           | 3.37:1  | Tidak lulus       |
| Error (#EF4343)            | 3.70:1  | Tidak lulus       |
| Accessible error (#A92727) | 6.84:1  | Lulus             |

Nilai sumber tetap tersedia. Untuk teks sekunder kecil, rekomendasi body mix yang lebih gelap. Error text #A92727 merupakan tambahan, bukan token sumber.

Keyboard: urutan Tab mengikuti visual; focus ring terlihat; menu memakai aria-expanded; Escape menutup modal/menu; focus kembali ke pemicu. Form memakai label dan aria-describedby; operasi async memakai aria-busy dan status live. Aturan ini adalah kontrak implementasi, belum diuji pada aplikasi hasil kode.

## Catatan implementasi

- Ikon memakai Lucide.
- Shadow spread CSS tidak sepenuhnya dapat direpresentasikan dalam .pen.
- Font Strawberry Sans perlu tersedia pada renderer implementasi; sediakan fallback sans-serif.
- Satu chip mode per layar. Status di panel memakai titik + teks, bukan pill.
- Jangan tampilkan penanda teknis (misalnya {{NIK}}) atau label uji coba di UI warga.

## Verifikasi

- Seluruh 24 section dirender dan ditinjau per bagian, lalu diverifikasi dalam satu frame utama.
- Audit bounds akhir pada node aktif: **0 masalah clipping**.
- Komponen card dan portrait diperiksa dengan screenshot terpisah.
- Satu root frame memuat Light dan Dark berdampingan; setiap mode memakai grid tiga kolom. Semua placeholder telah dimatikan.
- Canvas bukan bukti screen reader, keyboard, atau browser parity implementasi.
- File tokens JSON dan CSS adalah hasil ekstraksi; tidak membuat website baru.

## Berkas

- `strawberry.tokens.json`: variables canvas, component IDs, board IDs, dan provenance.
- `strawberry.tokens.css`: CSS custom properties dengan satuan px/ms yang sesuai.
- `export.pdf`: satu halaman berisi seluruh kanvas Light + Dark.

## Dark mode dan unified canvas

Light dan Dark kini berada pada satu root frame **NVcu7**. Dark adalah perluasan desain yang mempertahankan typography, spacing, radius, aset brand, serta hirarki dari Light. Contoh dark memakai instance dari 25 master yang sama; tidak menduplikasi master.

Theme pen.dev: `mode: light | dark`. Implementasi CSS memakai `data-theme="light"` atau `data-theme="dark"` pada container/root. Tidak ada auto-detection sistem yang ditambahkan.

| Semantic token      | Light     | Dark      |
| ------------------- | --------- | --------- |
| sb.bg.primary       | #FFFCFA   | #191A18   |
| sb.bg.secondary     | #F7F2ED   | #22231F   |
| sb.bg.white         | #FFFFFF   | #2C2D28   |
| sb.bg.card          | #FCF8F5   | #24251F   |
| sb.text.primary     | #252522   | #F7F3ED   |
| sb.text.secondary   | #2525228F | #B9B7AF   |
| sb.text.body        | #252522B3 | #CDCAC2   |
| sb.text.card        | #252522D1 | #DDD9D1   |
| sb.stroke           | #EFE6DC   | #3A3C34   |
| sb.stroke.secondary | #E6DBD1   | #54564B   |
| sb.stroke.tertiary  | #EFEBE7   | #30322B   |
| sb.accent.orange    | #F2805D   | #FFA184   |
| sb.focus            | #2525224D | #F7F3ED80 |
| sb.error            | #EF4343   | #FF8D8D   |
| sb.valid            | #50AD25   | #A8D881   |
| sb.accent.green     | #AD9D25   | #C3BE70   |
| sb.accent.gold      | #C8B828   | #DFCF65   |
| sb.a11y.error.text  | #A92727   | #FFB0AA   |
| sb.stage            | #FCF5EF   | #292720   |
| sb.badge.rose.bg    | #F1E8E5   | #42312E   |
| sb.badge.rose.end   | #F7F1EE   | #372B28   |
| sb.badge.rose.ink   | #8E544F   | #F1B7AF   |
| sb.badge.green.bg   | #EBF0E7   | #2D382B   |
| sb.badge.green.ink  | #567C4D   | #B7D7A7   |
| sb.badge.blue.bg    | #EAF0F5   | #293641   |
| sb.badge.blue.ink   | #4B6889   | #B5D2EF   |
| sb.badge.purple.bg  | #F3EAF4   | #3B2D3D   |
| sb.badge.purple.ink | #894F8E   | #DBB3E4   |
| sb.swatch.outline   | #25252210 | #F7F3ED20 |

Dark memakai charcoal hangat, teks cream, raised secondary surface, serta tint badge yang lebih terang. Warna logo tetap dipertahankan. Primary action memakai cream background dan dark label. Body/secondary dark memakai warna opaque agar kontras stabil, bukan menyalin alpha light.

### Kontras dark

Semua pasangan berikut dihitung terhadap #191A18:

| Role         | Color   | Ratio   |
| ------------ | ------- | ------- |
| Primary      | #F7F3ED | 15.80:1 |
| Body         | #CDCAC2 | 10.67:1 |
| Secondary    | #B9B7AF | 8.70:1  |
| Brand orange | #ED5A31 | 5.08:1  |
| Error        | #FF8D8D | 7.86:1  |

Kelima pasangan memenuhi 4.5:1 untuk teks normal pada background yang diuji. Status disabled tetap ditampilkan sebagai inactive, bukan sebagai body copy. Audit layout aktif dengan expanded instances menghasilkan 0 masalah clipping.

### Navigasi section Dark

- **Actions & states / Dark** — `kxcpM`.
- **Navigation & controls / Dark** — `Co662`.
- **Content & conversation / Dark** — `UxdHU`.
- **Urusin design system / Dark** — `Ogvhl`.
- **Type, rhythm & surfaces / Dark** — `QKiea`.
- **Layout desktop / Dark** — `Q6w9Oj`.
- **Page patterns & imagery / Dark** — `OKcDr`.
- **Motion & accessibility / Dark** — `t7JeM4`.
- **Implementation & handoff / Dark** — `l01oil`.
- **App shell & status / Dark** — `rqtu0`.
- **Browser Pendamping / Dark** — `H5vrp`.
- **Auth & data / Dark** — `x6OxII`.
