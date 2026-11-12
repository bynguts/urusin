<script lang="ts">
  import { resolve } from '$app/paths';
  import HalamanInformasi from '#lib/components/landing/HalamanInformasi.svelte';
</script>

<HalamanInformasi
  aktif="cara-kerja"
  judul="Dari pertanyaan menjadi langkah pengurusan"
  ringkasan="Mulai percakapan, pastikan wilayah, lalu gunakan jawaban dan rencana Urusin untuk menyiapkan urusan Anda."
>
  <section aria-labelledby="alur-chatbot">
    <h2 id="alur-chatbot">Memulai urusan di Urusin</h2>
    <ol>
      <li>
        <h3>Ceritakan kebutuhan Anda</h3>
        <p>
          Setelah masuk, tulis pertanyaan di Beranda. Misalnya, “KK saya hilang, mulai dari mana?” Anda juga
          bisa memilih topik urusan. Tidak perlu menuliskan NIK atau nomor KK di chat.
        </p>
      </li>
      <li>
        <h3>Pastikan daerah yang dimaksud</h3>
        <p>
          Sebutkan kabupaten atau kota sesuai pertanyaan Urusin. Jika ada usulan dari pengaturan akun, periksa
          dulu apakah wilayahnya benar. Persyaratan dan kanal layanan bisa berbeda antardaerah.
        </p>
      </li>
      <li>
        <h3>Baca jawaban dan periksa sumbernya</h3>
        <p>
          Urusin mencari rujukan dan menjelaskan persyaratan dengan bahasa sehari-hari. Buka tautan sumber
          untuk melihat ketentuan aslinya. Jika informasinya belum cukup, lanjutkan bertanya di percakapan
          yang sama.
        </p>
      </li>
      <li>
        <h3>Gunakan rencana untuk melanjutkan pengurusan</h3>
        <p>
          Tinjau daftar langkah dan dokumen yang perlu disiapkan. Pengajuan dilakukan sendiri melalui kanal
          resmi atau kantor layanan yang ditunjuk. Percakapan dapat dibuka kembali dari Urusanku.
        </p>
      </li>
    </ol>
  </section>
  <section aria-labelledby="alat-percakapan">
    <h2 id="alat-percakapan">Yang tersedia saat berbincang</h2>
    <p>
      Panel Rencana merangkum langkah pengurusan, Dokumen menampilkan daftar berkas, dan Sumber membantu Anda
      memeriksa rujukan jawaban. Tanyakan bagian yang belum jelas tanpa memulai percakapan baru.
    </p>
    <p>
      Gunakan tombol Bacakan bila suara tersedia di perangkat. Ukuran huruf dan kontras bisa diatur di
      Pengaturan.
    </p>
    <p id="browser-pendamping">
      <strong>Browser Pendamping: Coming soon.</strong> Bantuan berinteraksi dengan situs resmi masih dikembangkan.
      Saat ini Anda membuka dan mengisi layanan resmi sendiri.
    </p>
  </section>

  <section aria-labelledby="lanjut-belajar">
    <h2 id="lanjut-belajar">Butuh bantuan saat menggunakan aplikasi?</h2>
    <p>
      <a href={resolve('/bantuan')}>Buka panduan penggunaan</a> untuk mengatur wilayah, menyimpan dokumen, atau
      melanjutkan percakapan.
    </p>
  </section>
</HalamanInformasi>
