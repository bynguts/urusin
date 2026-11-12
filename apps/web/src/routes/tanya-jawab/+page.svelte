<script lang="ts">
  import { resolve } from '$app/paths';
  import HalamanInformasi from '#lib/components/landing/HalamanInformasi.svelte';
  const pertanyaan = [
    {
      tanya: 'Apakah Urusin bagian dari pemerintah?',
      jawab:
        'Urusin dikembangkan oleh Tim Urusin untuk membantu warga memahami layanan publik. Urusin tidak mewakili instansi pemerintah dan tidak menerbitkan dokumen resmi.',
    },
    {
      tanya: 'Apa yang bisa saya tanyakan?',
      jawab:
        'Anda bisa bertanya tentang persyaratan, dokumen, urutan pengurusan, dan kanal layanan. Topik yang tersedia mencakup kelahiran, perkawinan, pindah, kematian, serta dokumen kependudukan. Untuk topik lain, ketersediaan jawaban bergantung pada sumber yang ditemukan.',
    },
    {
      tanya: 'Bagaimana jika sumbernya belum cukup atau berbeda?',
      jawab:
        'Periksa wilayah dan tautan sumber pada jawaban. Jika informasi belum terverifikasi atau ada perbedaan, pastikan ke instansi yang disebut. Jawaban AI dapat keliru; ketentuan instansi tetap menjadi acuan pengurusan.',
    },
    {
      tanya: 'Apakah Urusin mengajukan permohonan untuk saya?',
      jawab:
        'Pengajuan Anda lakukan sendiri di kanal resmi. Urusin membantu menjelaskan persyaratan dan menyusun langkah. Browser Pendamping berstatus Coming soon dan belum tersedia untuk membuka atau mengisi situs layanan.',
    },
    {
      tanya: 'Berapa biaya memakai Urusin?',
      jawab:
        'Urusin gratis untuk warga. Jika suatu layanan memiliki biaya resmi, pembayaran dilakukan kepada instansi melalui kanal resminya. Urusin tidak menerima pembayaran untuk mempercepat pengurusan.',
    },
    {
      tanya: 'Apakah saya perlu membuat akun?',
      jawab:
        'Ya, akun diperlukan untuk memulai dan membuka percakapan urusan. Masuk dengan email dan kata sandi, atau gunakan Google jika opsi tersebut tersedia. Pilihan juri membuka salinan demo dengan data contoh.',
    },
    {
      tanya: 'Bisakah saya membantu anggota keluarga?',
      jawab:
        'Anda bisa bertanya tentang urusan anggota keluarga melalui akun sendiri. Gunakan data dan dokumen mereka dengan izin. Setiap akun memiliki brankas sendiri; jangan berbagi kata sandi.',
    },
  ];
</script>

<HalamanInformasi
  aktif="tanya-jawab"
  judul="Pertanyaan tentang Urusin"
  ringkasan="Kenali cakupan bantuan, sumber jawaban, biaya, dan penggunaan akun sebelum memulai."
>
  <section aria-label="Pertanyaan umum">
    {#each pertanyaan as p (p.tanya)}<details>
        <summary>{p.tanya}</summary>
        <p>{p.jawab}</p>
      </details>{/each}
  </section>
  <section aria-labelledby="bantuan-lanjutan">
    <h2 id="bantuan-lanjutan">Cari informasi yang lebih spesifik</h2>
    <ul>
      <li><a href={resolve('/cara-kerja')}>Alur penggunaan Urusin</a></li>
      <li><a href={resolve('/privasi')}>Penyimpanan dan penghapusan data</a></li>
      <li><a href={resolve('/bantuan')}>Panduan dan kendala penggunaan aplikasi</a></li>
    </ul>
  </section>
</HalamanInformasi>
