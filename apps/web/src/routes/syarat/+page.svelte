<script lang="ts">
  import { resolve } from '$app/paths';
  import '#lib/components/landing/landing-dasar.css';
  import '#lib/components/landing/landing-pen.css';
  import '#lib/components/landing/landing-responsif.css';
  import '#lib/components/landing/landing-gerak.css';
  import '../privasi/privasi.css';
  import './syarat.css';
  import LandingFooter from '#lib/components/landing/LandingFooter.svelte';
  import LandingNav from '#lib/components/landing/LandingNav.svelte';
  import hijau1 from '#lib/assets/img/pen-landing/green-membaca-183.webp';
  import hijau2 from '#lib/assets/img/pen-landing/green-membaca-366.webp';

  /*
   * Syarat layanan: kerangka dan gaya halaman /privasi (kelas pvN). Isinya harus sama dengan cara Urusin
   * benar-benar bekerja (docs/privasi.md, ADR 0028): bila sistem berubah, kalimat di sini ikut diubah.
   */
  const KONTAK = 'https://github.com/bynguts/urusin/blob/main/SECURITY.md';
</script>

<svelte:head>
  <title>Syarat layanan · Urusin</title>
  <meta
    name="description"
    content="Aturan memakai Urusin: apa yang dikerjakan Urusin, apa yang tetap Anda kerjakan sendiri, dan batas tanggung jawab kami."
  />
</svelte:head>

<main class="lp0 lp" id="konten">
  <LandingNav />

  <section class="pv1" aria-labelledby="judul-syarat">
    <div class="pv2">
      <h1 class="pv5" id="judul-syarat">Syarat layanan Urusin</h1>
      <p class="pv6">
        Aturan singkat memakai Urusin: apa yang kami kerjakan, apa yang tetap Anda kerjakan sendiri, dan batas
        tanggung jawab kami.
      </p>
      <p class="sy-berlaku">Berlaku sejak 12 November 2026.</p>
    </div>
    <div class="pv7" aria-hidden="true">
      <img
        class="sy-tokoh"
        src={hijau1}
        srcset="{hijau1} 183w, {hijau2} 366w"
        sizes="183px"
        alt=""
        width="183"
        height="200"
        decoding="async"
      />
    </div>
  </section>

  <div class="pv20">
    <section class="pv21" aria-labelledby="judul-bukan-instansi">
      <div class="pv22">
        <h2 class="pv23" id="judul-bukan-instansi">Urusin bukan instansi pemerintah</h2>
        <p class="pv24">
          Urusin membantu menjelaskan persyaratan, mencari rujukan, dan menyusun langkah pengurusan. Kami
          tidak berafiliasi dengan instansi mana pun dan tidak bisa mempercepat, menjamin, atau mengubah hasil
          permohonan.
        </p>
        <p class="pv24">
          <strong>Keputusan tetap di instansi yang berwenang</strong>, misalnya Disdukcapil: permohonan
          diterima, ditolak, atau diminta diperbaiki, semuanya ditentukan instansi itu.
        </p>
      </div>
    </section>

    <section class="pv21" aria-labelledby="judul-kendali">
      <div class="pv22">
        <h2 class="pv23" id="judul-kendali">Langkah penting tetap Anda yang lakukan</h2>
      </div>
      <ul class="sy-daftar">
        <li>
          <strong>Password, kode OTP, dan CAPTCHA</strong> di situs pemerintah selalu Anda ketik sendiri. Urusin
          tidak menyimpannya.
        </li>
        <li>
          Browser Pendamping masih berstatus Coming soon. Pengisian formulir serta <strong
            >tombol Kirim terakhir selalu Anda tekan sendiri</strong
          >. Urusin tidak pernah mengirim permohonan atas nama Anda.
        </li>
        <li>Anda dapat menghentikan percakapan kapan saja.</li>
      </ul>
    </section>

    <section class="pv21" aria-labelledby="judul-ai">
      <div class="pv22">
        <h2 class="pv23" id="judul-ai">AI bisa keliru</h2>
        <p class="pv24">
          Penjelasan, daftar syarat, dan rencana langkah disusun dengan bantuan AI. Hasilnya bisa salah,
          kurang lengkap, atau sudah tidak berlaku. <strong>Selalu periksa ulang</strong> isian dan syaratnya di
          situs resmi atau ke instansi sebelum menekan Kirim. Bila ada perbedaan, yang berlaku adalah ketentuan
          instansi.
        </p>
      </div>
    </section>

    <section class="pv21" aria-labelledby="judul-gratis">
      <div class="pv22">
        <h2 class="pv23" id="judul-gratis">Gratis</h2>
        <p class="pv24">
          Urusin gratis untuk warga: tanpa biaya, tanpa langganan, tanpa iklan. Jangan membayar siapa pun yang
          mengaku dari Urusin. Pengurusan dan penerbitan dokumen kependudukan juga tidak dipungut biaya oleh
          instansi (UU 24/2013 Pasal 79A).
        </p>
      </div>
    </section>

    <section class="pv21" aria-labelledby="judul-larangan">
      <div class="pv22">
        <h2 class="pv23" id="judul-larangan">Yang tidak boleh dilakukan</h2>
      </div>
      <ul class="sy-daftar">
        <li>Memakai data atau dokumen orang lain tanpa izin pemiliknya.</li>
        <li>Mengisi data palsu, memalsukan dokumen, atau mengajukan permohonan yang bukan hak Anda.</li>
        <li>Memakai Urusin untuk menembus pengamanan situs pemerintah atau situs lain.</li>
        <li>
          Mencoba membobol, membebani, atau mengotomasi Urusin di luar pemakaian wajar. Temuan celah keamanan
          silakan dilaporkan lewat kontak di bawah.
        </li>
        <li>Mengunggah konten yang melanggar hukum.</li>
      </ul>
      <p class="pv24">Akun yang melanggar bisa kami batasi atau tutup.</p>
    </section>

    <section class="pv21" aria-labelledby="judul-akun">
      <div class="pv22">
        <h2 class="pv23" id="judul-akun">Akun dan penghapusan data</h2>
        <p class="pv24">
          Untuk memakai Urusin Anda perlu akun; data dan dokumen Anda tersimpan terenkripsi di akun itu. Jaga
          kata sandi Anda dan jangan berbagi akun. Dokumen bisa dihapus satu per satu, dan akun beserta
          seluruh isinya bisa dihapus kapan saja dari Pengaturan. Rinciannya ada di halaman
          <a href={resolve('/privasi')}>Privasi</a>.
        </p>
      </div>
    </section>

    <section class="pv21" aria-labelledby="judul-tanggung-jawab">
      <div class="pv22">
        <h2 class="pv23" id="judul-tanggung-jawab">Batas tanggung jawab</h2>
        <p class="pv24">
          Urusin disediakan apa adanya. Kami berusaha agar layanan selalu tersedia dan benar, tetapi tidak
          bisa menjaminnya: situs pemerintah bisa berubah atau terganggu di luar kendali kami. Sejauh
          diizinkan hukum, kami tidak bertanggung jawab atas kerugian karena isian yang dikirim tanpa
          diperiksa, keputusan instansi, atau gangguan situs pihak lain. Ketentuan ini tidak mengurangi hak
          Anda sebagai konsumen menurut hukum Indonesia.
        </p>
      </div>
    </section>

    <section class="pv21" aria-labelledby="judul-kontak">
      <div class="pv22">
        <h2 class="pv23" id="judul-kontak">Kontak</h2>
        <p class="pv24">
          Urusin dikembangkan dan dioperasikan oleh Tim Urusin (LOGICODIX 2026). Pertanyaan, keberatan, atau
          permintaan soal data Anda bisa dikirim lewat kontak di
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tautan eksternal ke repo publik -->
          <a href={KONTAK} rel="external noopener">kebijakan keamanan Urusin</a>. Bila syarat ini berubah,
          tanggal berlaku di atas ikut diperbarui.
        </p>
      </div>
    </section>
  </div>

  <LandingFooter />
</main>
