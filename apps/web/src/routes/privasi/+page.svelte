<script lang="ts">
  import { resolve } from '$app/paths';
  import '#lib/components/landing/landing-dasar.css';
  import '#lib/components/landing/landing-pen.css';
  import '#lib/components/landing/landing-responsif.css';
  import '#lib/components/landing/landing-gerak.css';
  import './privasi.css';
  import LandingFooter from '#lib/components/landing/LandingFooter.svelte';
  import LandingNav from '#lib/components/landing/LandingNav.svelte';
  import birul from '#lib/assets/img/pen-landing/blue-memeriksa-202.webp';
  import biru2 from '#lib/assets/img/pen-landing/blue-memeriksa-403.webp';
  import perisai from '#lib/assets/img/pen-landing/perisai-360.webp';
  import ungu1 from '#lib/assets/img/pen-landing/purple-berpikir-190.webp';
  import ungu2 from '#lib/assets/img/pen-landing/purple-berpikir-380.webp';

  /*
   * Privasi = frame F6RSq "Urusin • Web · Privasi" dari pen Rafi, dikonversi dari ekspor HTML/CSS apa adanya
   * (kelas pvN di privasi.css). Tata letak milik Rafi; isinya mengikuti docs/privasi.md dan sistem yang
   * berjalan. Bila teks contoh di frame tidak sesuai kenyataan, kalimatnya diganti fakta di struktur yang sama.
   */
  const KEBIJAKAN = 'https://github.com/bynguts/urusin/blob/main/docs/privasi.md';
</script>

<svelte:head>
  <title>Privasi · Urusin</title>
  <meta
    name="description"
    content="Data apa yang disimpan Urusin, di mana, berapa lama, dan cara menghapusnya."
  />
</svelte:head>

<main class="lp0 lp" id="konten">
  <LandingNav aktif="privasi" />

  <section class="pv1" aria-labelledby="judul-privasi">
    <div class="pv2">
      <h1 class="pv5" id="judul-privasi">Data keluargamu tetap milikmu</h1>
      <p class="pv6">
        Urusin hanya memakai data yang kamu setujui, untuk urusan yang kamu pilih.<br />
        Login dan kode OTP situs pemerintah tidak pernah kami simpan.
      </p>
    </div>
    <div class="pv7" aria-hidden="true">
      <img
        class="pv8"
        src={ungu1}
        srcset="{ungu1} 190w, {ungu2} 380w"
        sizes="190px"
        alt=""
        width="190"
        height="250"
        decoding="async"
      />
      <img
        class="pv9"
        src={birul}
        srcset="{birul} 202w, {biru2} 403w"
        sizes="170px"
        alt=""
        width="170"
        height="220"
        decoding="async"
      />
    </div>
  </section>

  <section class="pv10" aria-labelledby="judul-kendali">
    <div class="pv11">
      <h2 class="pv12" id="judul-kendali">Kamu tetap pegang kendali atas datamu</h2>
      <img class="pv13" src={perisai} alt="" width="180" height="180" loading="lazy" decoding="async" />
    </div>
    <div class="pv14">
      <div class="pv15">
        <div class="pv16">
          <div class="pv17"><img src="/pen/i-5719b4b3db.svg" alt="" width="17" height="17" /></div>
          <h3 class="pv18">Kamu yang memutuskan</h3>
          <p class="pv19">AI baru mengisi formulir setelah kamu setuju. Login dan Kirim selalu kamu.</p>
        </div>
        <div class="pv16">
          <div class="pv17"><img src="/pen/i-2b05f4f519.svg" alt="" width="17" height="17" /></div>
          <h3 class="pv18">Data diri di brankas</h3>
          <p class="pv19">
            NIK dan data pribadi disimpan terenkripsi. AI tidak melihat angka aslinya, kecuali yang tampak di
            foto yang kamu lampirkan di chat atau simpan di Dokumen.
          </p>
        </div>
      </div>
      <div class="pv15">
        <div class="pv16">
          <div class="pv17"><img src="/pen/i-ec0f9015d8.svg" alt="" width="17" height="17" /></div>
          <h3 class="pv18">Jejak bisa ditelusuri</h3>
          <p class="pv19">
            Setiap langkah tercatat dengan rantai hash, jadi perubahan diam-diam akan ketahuan.
          </p>
        </div>
        <div class="pv16">
          <div class="pv17"><img src="/pen/i-03dd2490d3.svg" alt="" width="17" height="17" /></div>
          <h3 class="pv18">Hapus kapan saja</h3>
          <p class="pv19">Hapus dokumen satu per satu, atau akun beserta semua isinya dari Pengaturan.</p>
        </div>
      </div>
    </div>
  </section>

  <div class="pv20">
    <section class="pv21" aria-labelledby="judul-data">
      <div class="pv22">
        <h2 class="pv23" id="judul-data">Data apa saja yang disimpan</h2>
        <p class="pv24">
          Hanya yang dibutuhkan untuk urusanmu. Brankas ada di server kami di Singapura, yang memegang
          kuncinya. Kunci enkripsinya khusus untuk tiap pemilik.
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tautan eksternal ke repo publik -->
          <a href={KEBIJAKAN} rel="external noopener">Kebijakan lengkap</a>.
        </p>
      </div>
      <div class="pv25" role="table" aria-label="Data yang disimpan Urusin">
        <div class="pv26" role="row">
          <div class="pv27 pv-c0" role="columnheader">Data</div>
          <div class="pv27 pv-c1" role="columnheader">Disimpan di</div>
          <div class="pv27 pv-c2" role="columnheader">Berapa lama</div>
          <div class="pv27 pv-c3" role="columnheader">Bisa dihapus</div>
        </div>
        <div class="pv28" role="row">
          <div class="pv29 pv-c0" role="rowheader">Data diri dan berkas</div>
          <div class="pv30 pv-c1" role="cell" data-label="Disimpan di">Brankas Urusin, terenkripsi</div>
          <div class="pv30 pv-c2" role="cell" data-label="Berapa lama">Sampai kamu menghapusnya</div>
          <div class="pv30 pv-c3" role="cell" data-label="Bisa dihapus">Ya, kapan saja</div>
        </div>
        <div class="pv28" role="row">
          <div class="pv29 pv-c0" role="rowheader">Percakapan urusan</div>
          <div class="pv30 pv-c1" role="cell" data-label="Disimpan di">Server Urusin, disamarkan</div>
          <div class="pv30 pv-c2" role="cell" data-label="Berapa lama">Sampai akun dihapus</div>
          <div class="pv30 pv-c3" role="cell" data-label="Bisa dihapus">Ya, bersama akun</div>
        </div>
        <div class="pv28" role="row">
          <div class="pv29 pv-c0" role="rowheader">Jejak urusan</div>
          <div class="pv30 pv-c1" role="cell" data-label="Disimpan di">
            Server Urusin, dikunci rantai hash
          </div>
          <div class="pv30 pv-c2" role="cell" data-label="Berapa lama">Sampai akun dihapus</div>
          <div class="pv30 pv-c3" role="cell" data-label="Bisa dihapus">Ya, bersama akun</div>
        </div>
        <div class="pv28" role="row">
          <div class="pv29 pv-c0" role="rowheader">Cadangan basis data</div>
          <div class="pv30 pv-c1" role="cell" data-label="Disimpan di">
            Server Urusin di Singapura; Data Diri dan dokumen tetap terenkripsi
          </div>
          <div class="pv30 pv-c2" role="cell" data-label="Berapa lama">
            Dibuat tiap 6 jam, disimpan 3 hari
          </div>
          <div class="pv30 pv-c3" role="cell" data-label="Bisa dihapus">Terhapus sendiri setelah 3 hari</div>
        </div>
        <div class="pv28" role="row">
          <div class="pv29 pv-c0" role="rowheader">Password, OTP, dan cookie situs pemerintah</div>
          <div class="pv31 pv-c1" role="cell">
            <img src="/pen/i-363eb3c9d6.svg" alt="" width="18" height="18" />
            <span class="pv32">Tidak pernah disimpan</span>
          </div>
          <div class="pv30 pv-c2 pv-kosong" role="cell"><span aria-hidden="true">—</span></div>
          <div class="pv30 pv-c3 pv-kosong" role="cell"><span aria-hidden="true">—</span></div>
        </div>
      </div>
    </section>

    <section class="pv21" aria-labelledby="judul-pihak">
      <div class="pv22">
        <h2 class="pv23" id="judul-pihak">Pihak lain yang memproses data</h2>
        <p class="pv24">
          Kami tidak menjual data, tidak memasang iklan, dan tidak memakai pelacak pihak ketiga. Pencarian
          sumber resmi berjalan di server kami sendiri, jadi pertanyaanmu tidak dikirim ke mesin pencari pihak
          lain. Pengiriman ke pihak di luar Indonesia adalah transfer data lintas negara (UU PDP Pasal 56)
          atas persetujuanmu.
        </p>
      </div>
      <div class="pv25" role="table" aria-label="Pihak lain yang memproses data">
        <div class="pv26" role="row">
          <div class="pv27 pv-c0" role="columnheader">Pihak</div>
          <div class="pv27 pv-c1" role="columnheader">Data yang diterima</div>
          <div class="pv27 pv-c2" role="columnheader">Peran</div>
          <div class="pv27 pv-c3" role="columnheader">Lokasi</div>
        </div>
        <div class="pv28" role="row">
          <div class="pv29 pv-c0" role="rowheader">Oracle Cloud (hosting)</div>
          <div class="pv30 pv-c1" role="cell" data-label="Data yang diterima">
            Semua data di atas. Data Diri dan dokumen dalam bentuk terenkripsi
          </div>
          <div class="pv30 pv-c2" role="cell" data-label="Peran">
            Server, basis data, mesin pencari sumber resmi, dan Browser Pendamping Urusin
          </div>
          <div class="pv30 pv-c3" role="cell" data-label="Lokasi">Singapura</div>
        </div>
        <div class="pv28" role="row">
          <div class="pv29 pv-c0" role="rowheader">OpenAI (model GPT, lewat proxy model tim)</div>
          <div class="pv30 pv-c1" role="cell" data-label="Data yang diterima">
            Teks percakapan, termasuk nama dan teks bebas yang kamu ketik. NIK, KK, HP, dan email diganti
            penanda sebelum dikirim. Gambar yang kamu lampirkan di chat atau foto yang kamu simpan di Dokumen
            (salinan diperkecil) untuk dibaca isinya dan diperiksa kejelasannya
          </div>
          <div class="pv30 pv-c2" role="cell" data-label="Peran">
            Model AI yang menjawab dan menyusun rencana
          </div>
          <div class="pv30 pv-c3" role="cell" data-label="Lokasi">Di luar Indonesia</div>
        </div>
        <div class="pv28" role="row">
          <div class="pv29 pv-c0" role="rowheader">Google (bila kamu memilihnya)</div>
          <div class="pv30 pv-c1" role="cell" data-label="Data yang diterima">
            Proses masuk dengan akun Google kamu
          </div>
          <div class="pv30 pv-c2" role="cell" data-label="Peran">Masuk dengan Google</div>
          <div class="pv30 pv-c3" role="cell" data-label="Lokasi">Global</div>
        </div>
      </div>
    </section>

    <section class="pv21" aria-labelledby="judul-hak">
      <div class="pv22">
        <h2 class="pv23" id="judul-hak">Hak kamu atas data</h2>
      </div>
      <div class="pv33">
        <div class="pv34">
          <div class="pv35"><img src="/pen/i-c7556fee16.svg" alt="" width="20" height="20" /></div>
          <h3 class="pv36">Unduh datamu</h3>
          <p class="pv37">Lihat Data Diri dan unduh setiap dokumen kapan saja.</p>
          <a class="pv38" href={resolve('/dokumen')}>
            Unduh data <img src="/pen/i-104b85f31d.svg" alt="" width="16" height="16" />
          </a>
        </div>
        <div class="pv34">
          <div class="pv35"><img src="/pen/i-4018b025a6.svg" alt="" width="20" height="20" /></div>
          <h3 class="pv36">Lihat jejak pengisian</h3>
          <p class="pv37">Periksa setiap langkah urusan: siapa yang bertindak, kapan, dan apa hasilnya.</p>
          <a class="pv38" href={resolve('/urusanku')}>
            Buka jejak <img src="/pen/i-104b85f31d.svg" alt="" width="16" height="16" />
          </a>
        </div>
        <div class="pv34">
          <div class="pv35"><img src="/pen/i-35fa876f12.svg" alt="" width="20" height="20" /></div>
          <h3 class="pv36">Hapus semua data</h3>
          <p class="pv37">Akun dan isinya langsung dihapus; kunci enkripsinya dihancurkan.</p>
          <a class="pv38 pv-bahaya" href="{resolve('/pengaturan')}#zona-bahaya">
            Hapus data saya <img src="/pen/i-57ecd55050.svg" alt="" width="16" height="16" />
          </a>
        </div>
      </div>
    </section>

    <section class="pv21" aria-labelledby="judul-sumber">
      <div class="pv22">
        <h2 class="pv23" id="judul-sumber">Sumber informasi resmi</h2>
        <p class="pv24">
          Urusin bukan situs pemerintah; logo instansi ditampilkan untuk merujuk sumber informasi resmi.
        </p>
        <p class="pv24 pv-atribusi">
          Logo instansi dari <a href="https://commons.wikimedia.org/">Wikimedia Commons</a>; logo Jasa Raharja
          oleh PT Jasa Raharja (Persero),
          <a href="https://commons.wikimedia.org/wiki/File:PT_Jasa_Raharja_(Persero).svg">berkas di Commons</a
          >,
          <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.
        </p>
      </div>
    </section>
  </div>

  <LandingFooter />
</main>
