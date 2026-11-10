<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import '#lib/components/landing/landing-dasar.css';
  import '#lib/components/landing/landing-pen.css';
  import '#lib/components/landing/landing-responsif.css';
  import './tanya-jawab.css';
  import LandingFooter from '#lib/components/landing/LandingFooter.svelte';
  import LandingNav from '#lib/components/landing/LandingNav.svelte';
  import gf34ca30 from '#lib/assets/img/pen-web/amber-berpikir-190.webp';
  import g3741282 from '#lib/assets/img/pen-web/amber-berpikir-380.webp';
  import g7775df8 from '#lib/assets/img/pen-web/blue-berpikir-170.webp';
  import g17423a0 from '#lib/assets/img/pen-web/blue-berpikir-340.webp';
  import g3aa985d from '#lib/assets/img/pen-web/rose-melambai-170.webp';
  import gb232d0c from '#lib/assets/img/pen-web/rose-melambai-340.webp';

  /*
   * Tanya jawab = frame Web "Tanya jawab" dari pen Rafi, dikonversi dari ekspor HTML/CSS apa adanya (kelas tjN
   * di tanya-jawab.css). Header dan footer memakai komponen landing. Tiap pertanyaan adalah <details> (jalan
   * tanpa JavaScript); yang terbuka di frame terbuka di sini. Frame hanya memuat jawaban untuk pertanyaan yang
   * terbuka; jawaban lain ditulis dari docs/privasi.md dan perilaku sistem yang berjalan.
   */
  const targetMulai = $derived(page.data.akun ? resolve('/beranda') : resolve('/daftar'));
</script>

<svelte:head>
  <title>Tanya jawab · Urusin</title>
  <meta
    name="description"
    content="Jawaban untuk pertanyaan yang sering diajukan tentang Urusin, keamanan data, Browser Pendamping, dan biaya."
  />
</svelte:head>

<main class="lp0 lp" id="konten">
  <LandingNav aktif="tanya-jawab" />
  <!-- Page hero -->
  <section class="tj1">
    <div class="tj2">
      <div class="tj3">
        <p class="tj4">Tanya jawab</p>
      </div>
      <h1 class="tj5">Pertanyaan yang sering diajukan</h1>
      <p class="tj6">
        Jawaban singkat soal cara kerja, keamanan, Browser Pendamping, dan biaya. Belum ketemu? Tanyakan
        langsung ke Rose.
      </p>
    </div>
    <div class="tj7">
      <img
        class="tj8"
        src={gf34ca30}
        srcset="{gf34ca30} 190w, {g3741282} 380w"
        sizes="190px"
        alt=""
        width="190"
        height="250"
        decoding="async"
      />
      <img
        class="tj9"
        src={g7775df8}
        srcset="{g7775df8} 170w, {g17423a0} 340w"
        sizes="170px"
        alt=""
        width="170"
        height="220"
        decoding="async"
      />
    </div>
  </section>
  <!-- Content -->
  <section class="tj10">
    <div class="tj11">
      <nav class="tj12" aria-label="Kategori pertanyaan">
        <a class="tj13" href="#umum"><span class="tj14">Umum</span></a>
        <a class="tj15" href="#keamanan"><span class="tj16">Keamanan &amp; privasi</span></a>
        <a class="tj17" href="#pendamping"><span class="tj18">Browser Pendamping</span></a>
        <a class="tj19" href="#biaya"><span class="tj20">Biaya &amp; akun</span></a>
      </nav>
      <div class="tj21">
        <div class="tj22" id="umum">
          <h2 class="tj23">Umum</h2>
          <div class="tj24">
            <details class="tj-q tj25" open>
              <summary class="tj26">
                <h3 class="tj27">Apakah Urusin bagian dari pemerintah?</h3>
                <img
                  class="tj28 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj28 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj29">
                Bukan. Urusin membantu memahami dan menyiapkan urusan. Keputusan tetap di instansi resmi, dan
                pengajuan dikirim lewat situs resmi.
              </p>
            </details>
            <details class="tj-q tj30">
              <summary class="tj31">
                <h3 class="tj32">Urusan apa saja yang bisa dibantu?</h3>
                <img
                  class="tj33 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj33 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj29">
                Kelahiran, perkawinan, pindah domisili, kehilangan anggota keluarga, serta KTP dan dokumen
                kependudukan lain. Untuk urusan lain, ceritakan saja: Urusin mencari layanan dan sumber resmi
                yang sesuai.
              </p>
            </details>
            <details class="tj-q tj34">
              <summary class="tj35">
                <h3 class="tj36">Bagaimana kalau aturan di wilayah saya berbeda?</h3>
                <img
                  class="tj37 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj37 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj29">
                Urusin memakai aturan dari situs resmi wilayah yang kamu pilih dan menyebut tanggal terakhir
                diperiksa. Kalau sumber resmi wilayahmu belum ditemukan, Urusin mengatakannya dan menunjukkan
                instansi yang bisa ditanya.
              </p>
            </details>
            <details class="tj-q tj38">
              <summary class="tj39">
                <h3 class="tj40">Apakah pengajuan saya pasti diterima?</h3>
                <img
                  class="tj41 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj41 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj29">
                Tidak ada jaminan, karena keputusan ada di instansi resmi. Urusin membantu menyiapkan isian
                dan memeriksa foto berkas sebelum dikirim supaya kemungkinan ditolak lebih kecil.
              </p>
            </details>
          </div>
        </div>
        <div class="tj42" id="keamanan">
          <h2 class="tj43">Keamanan &amp; privasi</h2>
          <div class="tj44">
            <details class="tj-q tj45">
              <summary class="tj46">
                <h3 class="tj47">Apakah password saya aman?</h3>
                <img
                  class="tj48 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj48 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj29">
                Kata sandi situs pemerintah dan kode OTP kamu ketik sendiri di Browser Pendamping. Yang kamu
                ketik tidak dicatat, tidak disimpan, dan tidak dikirim ke AI. Kata sandi akun Urusin hanya
                disimpan sebagai hash.
              </p>
            </details>
            <details class="tj-q tj49" open>
              <summary class="tj50">
                <h3 class="tj51">Kenapa Urusin tidak menekan Kirim?</h3>
                <img
                  class="tj52 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj52 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj53">
                Supaya keputusan tetap di tanganmu. Login, CAPTCHA, kode OTP, dan tombol Kirim selalu kamu
                sendiri yang lakukan.
              </p>
            </details>
            <details class="tj-q tj54">
              <summary class="tj55">
                <h3 class="tj56">Bisakah saya menghapus semua data?</h3>
                <img
                  class="tj57 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj57 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj29">
                Bisa. Dokumen bisa dihapus satu per satu di halaman Dokumen, dan seluruh akun beserta isinya
                di Pengaturan, bagian Zona bahaya. Tanpa akun, data terhapus sendiri 72 jam setelah dibuat.
              </p>
            </details>
          </div>
        </div>
        <div class="tj58" id="pendamping">
          <h2 class="tj59">Browser Pendamping</h2>
          <div class="tj60">
            <details class="tj-q tj61" open>
              <summary class="tj62">
                <h3 class="tj63">Perlu pasang aplikasi?</h3>
                <img
                  class="tj64 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj64 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj65">
                Tidak. Cukup buka web Urusin di browser. Situs resmi tampil di Browser Pendamping, jadi tidak
                ada yang perlu dipasang.
              </p>
            </details>
            <details class="tj-q tj66" open>
              <summary class="tj67">
                <h3 class="tj68">Kenapa harus login lagi di situs resmi?</h3>
                <img
                  class="tj69 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj69 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj70">
                Browser Pendamping adalah browser terpisah di server. Login di browsermu tidak ikut, dan
                memang sengaja tidak disalin demi keamanan. Cukup sekali untuk satu urusan.
              </p>
            </details>
            <details class="tj-q tj71">
              <summary class="tj72">
                <h3 class="tj73">Bagaimana kalau situs pemerintah menolak atau sedang down?</h3>
                <img
                  class="tj74 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj74 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj29">
                Urusin berhenti dengan aman dan beralih ke mode dipandu: kamu mendapat langkah demi langkah
                untuk mengisi sendiri, lengkap dengan sumber resmi.
              </p>
            </details>
          </div>
        </div>
        <div class="tj75" id="biaya">
          <h2 class="tj76">Biaya &amp; akun</h2>
          <div class="tj77">
            <details class="tj-q tj78" open>
              <summary class="tj79">
                <h3 class="tj80">Berapa biayanya?</h3>
                <img
                  class="tj81 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj81 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj82">
                Gratis untuk keluarga. Biaya resmi dari instansi, kalau ada, tetap dibayar langsung di situs
                atau loket resmi.
              </p>
            </details>
            <details class="tj-q tj83">
              <summary class="tj84">
                <h3 class="tj85">Bisakah satu akun untuk satu keluarga?</h3>
                <img
                  class="tj86 tj-ikon-buka"
                  src="/pen/i-636fe4fb78.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
                <img
                  class="tj86 tj-ikon-tutup"
                  src="/pen/i-eafd39ec66.svg"
                  alt=""
                  width="20"
                  height="20"
                  decoding="async"
                />
              </summary>
              <p class="tj29">
                Satu akun dipakai satu orang untuk masuk. Dari akun itu kamu bisa mengurus urusan untuk
                anggota keluarga, misalnya akta kelahiran anak. Jangan berbagi kata sandi; anggota keluarga
                dewasa sebaiknya punya akun sendiri.
              </p>
            </details>
          </div>
        </div>
      </div>
    </div>
    <div class="tj87">
      <div class="tj88">
        <h2 class="tj89">Belum ketemu jawabannya?</h2>
        <p class="tj90">Tanyakan ke Rose. Jawabannya disertai sumber resmi dan tanggal diperiksa.</p>
        <div class="tj91">
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a class="tj92" href={targetMulai}>
            <img
              class="tj93"
              src="/pen/i-744984ade4.svg"
              alt=""
              width="17"
              height="17"
              loading="lazy"
              decoding="async"
            />
            <span class="tj94">Tanya Rose</span>
          </a>
          <a class="tj95" href={resolve('/bantuan')}>
            <span class="tj96">Hubungi kami</span>
          </a>
        </div>
      </div>
      <img
        class="tj97"
        src={g3aa985d}
        srcset="{g3aa985d} 170w, {gb232d0c} 340w"
        sizes="170px"
        alt=""
        width="170"
        height="220"
        loading="lazy"
        decoding="async"
      />
    </div>
  </section>
  <LandingFooter />
</main>
