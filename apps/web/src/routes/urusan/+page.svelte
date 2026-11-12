<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import '#lib/components/landing/landing-dasar.css';
  import '#lib/components/landing/landing-pen.css';
  import '#lib/components/landing/landing-responsif.css';
  import '#lib/components/landing/landing-gerak.css';
  import './urusan.css';
  import LandingFooter from '#lib/components/landing/LandingFooter.svelte';
  import LandingNav from '#lib/components/landing/LandingNav.svelte';
  import g9c7d838 from '#lib/assets/img/pen-web/amber-jempol-170.webp';
  import gb35d8ef from '#lib/assets/img/pen-web/amber-jempol-340.webp';
  import g6edb672 from '#lib/assets/img/pen-web/green-membaca-190.webp';
  import g507f956 from '#lib/assets/img/pen-web/green-membaca-380.webp';

  /*
   * Urusan = frame Web "Urusan" dari pen Rafi, dikonversi dari ekspor HTML/CSS apa adanya (kelas urN di
   * urusan.css). Header dan footer memakai komponen landing. Tombol "Tanyakan urusan ini" di kartu adalah formulir
   * POST ke aksi landing (jalan tanpa JavaScript), judul kartu menuju halaman peristiwanya.
   */
  const targetMulai = $derived(page.data.akun ? resolve('/beranda') : resolve('/daftar'));
</script>

<svelte:head>
  <title>Urusan · Urusin</title>
  <meta
    name="description"
    content="Topik yang tersedia: kelahiran, perkawinan, pindah domisili, kehilangan keluarga, KTP, dan urusan lain."
  />
</svelte:head>

<main class="lp0 lp" id="konten">
  <LandingNav aktif="urusan" />
  <!-- Page hero -->
  <section class="ur1">
    <div class="ur2">
      <h1 class="ur5">Urusan yang bisa dibantu Urusin</h1>
      <p class="ur6">
        Pilih topik untuk melihat gambaran pengurusan, lalu tanyakan kebutuhan Anda melalui percakapan.
      </p>
    </div>
    <div class="ur7">
      <img
        class="ur8"
        src={g6edb672}
        srcset="{g6edb672} 190w, {g507f956} 380w"
        sizes="190px"
        alt=""
        width="190"
        height="250"
        decoding="async"
      />
      <img
        class="ur9"
        src={g9c7d838}
        srcset="{g9c7d838} 170w, {gb35d8ef} 340w"
        sizes="170px"
        alt=""
        width="170"
        height="220"
        decoding="async"
      />
    </div>
  </section>
  <!-- Content -->
  <section class="ur10">
    <div class="ur11">
      <div class="ur12">
        <h2 class="ur13">Topik yang tersedia</h2>
      </div>
      <div class="ur15">
        <div class="ur16">
          <div class="ur20">
            <h3 class="ur21"><a href={resolve('/peristiwa/[slug]', { slug: 'kelahiran' })}>Kelahiran</a></h3>
            <p class="ur22">Anak baru lahir dan perlu dicatat resmi.</p>
          </div>
          <div class="ur23">
            <p class="ur24">Contoh kebutuhan</p>
            <p class="ur25">Akta kelahiran · KK baru · KIA</p>
          </div>
          <div class="ur26">
            <img
              class="ur27"
              src="/pen/i-d91171f66d.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur28">Disdukcapil · BPJS Kesehatan</p>
          </div>
          <div class="ur29"></div>
          <form class="ur-form" method="POST" action="/?/mulai">
            <input type="hidden" name="peristiwa" value="kelahiran" />
            <button class="ur-tombol ur30" type="submit">
              <span class="ur31">Tanyakan urusan ini</span>
              <img
                class="ur32"
                src="/pen/i-89f7f9953c.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </button>
          </form>
        </div>
        <div class="ur33">
          <div class="ur37">
            <h3 class="ur38">
              <a href={resolve('/peristiwa/[slug]', { slug: 'perkawinan' })}>Perkawinan</a>
            </h3>
            <p class="ur39">Mencatatkan pernikahan dan memperbarui data keluarga.</p>
          </div>
          <div class="ur40">
            <p class="ur41">Contoh kebutuhan</p>
            <p class="ur42">Buku nikah · KK baru · KTP status kawin</p>
          </div>
          <div class="ur43">
            <img
              class="ur44"
              src="/pen/i-d91171f66d.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur45">KUA · Disdukcapil</p>
          </div>
          <div class="ur46"></div>
          <form class="ur-form" method="POST" action="/?/mulai">
            <input type="hidden" name="peristiwa" value="perkawinan" />
            <button class="ur-tombol ur47" type="submit">
              <span class="ur48">Tanyakan urusan ini</span>
              <img
                class="ur49"
                src="/pen/i-89f7f9953c.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </button>
          </form>
        </div>
        <div class="ur50">
          <div class="ur54">
            <h3 class="ur55">
              <a href={resolve('/peristiwa/[slug]', { slug: 'pindah' })}>Pindah domisili</a>
            </h3>
            <p class="ur56">Pindah rumah ke kota atau kabupaten lain.</p>
          </div>
          <div class="ur57">
            <p class="ur58">Contoh kebutuhan</p>
            <p class="ur59">Surat pindah · KK di alamat baru · KTP alamat baru</p>
          </div>
          <div class="ur60">
            <img
              class="ur61"
              src="/pen/i-d91171f66d.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur62">Disdukcapil asal dan tujuan</p>
          </div>
          <div class="ur63"></div>
          <form class="ur-form" method="POST" action="/?/mulai">
            <input type="hidden" name="peristiwa" value="pindah" />
            <button class="ur-tombol ur64" type="submit">
              <span class="ur65">Tanyakan urusan ini</span>
              <img
                class="ur66"
                src="/pen/i-89f7f9953c.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </button>
          </form>
        </div>
      </div>
      <div class="ur67">
        <div class="ur68">
          <div class="ur72">
            <h3 class="ur73">
              <a href={resolve('/peristiwa/[slug]', { slug: 'kematian' })}>Kehilangan keluarga</a>
            </h3>
            <p class="ur74">Mengurus dokumen setelah anggota keluarga meninggal.</p>
          </div>
          <div class="ur75">
            <p class="ur76">Contoh kebutuhan</p>
            <p class="ur77">Akta kematian · Perubahan KK · Klaim BPJS</p>
          </div>
          <div class="ur78">
            <img
              class="ur79"
              src="/pen/i-d91171f66d.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur80">Disdukcapil · BPJS · Taspen</p>
          </div>
          <div class="ur81"></div>
          <form class="ur-form" method="POST" action="/?/mulai">
            <input type="hidden" name="peristiwa" value="kematian" />
            <button class="ur-tombol ur82" type="submit">
              <span class="ur83">Tanyakan urusan ini</span>
              <img
                class="ur84"
                src="/pen/i-89f7f9953c.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </button>
          </form>
        </div>
        <div class="ur85">
          <div class="ur89">
            <h3 class="ur90">
              <a href={resolve('/peristiwa/[slug]', { slug: 'lainnya' })}>KTP &amp; dokumen</a>
            </h3>
            <p class="ur91">Menanyakan pembuatan, perubahan, atau penggantian dokumen.</p>
          </div>
          <div class="ur92">
            <p class="ur93">Contoh kebutuhan</p>
            <p class="ur94">KTP-el · Paspor · SIM</p>
          </div>
          <div class="ur95">
            <img
              class="ur96"
              src="/pen/i-d91171f66d.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur97">Disdukcapil · Imigrasi · Polri</p>
          </div>
          <div class="ur98"></div>
          <form class="ur-form" method="POST" action="/?/mulai">
            <input type="hidden" name="peristiwa" value="lainnya" />
            <button class="ur-tombol ur99" type="submit">
              <span class="ur100">Tanyakan urusan ini</span>
              <img
                class="ur101"
                src="/pen/i-89f7f9953c.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </button>
          </form>
        </div>
        <div class="ur102">
          <div class="ur106">
            <h3 class="ur107">Urusan lain</h3>
            <p class="ur108">Belum ada di daftar? Ceritakan saja kebutuhan Anda.</p>
          </div>
          <div class="ur109">
            <p class="ur110">Contoh kebutuhan</p>
            <p class="ur111">Pajak kendaraan · Izin usaha · Bantuan sosial</p>
          </div>
          <div class="ur112">
            <img
              class="ur113"
              src="/pen/i-d91171f66d.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur114">Sesuai urusan Anda</p>
          </div>
          <div class="ur115"></div>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a class="ur116" href={targetMulai}>
            <span class="ur117">Tanyakan urusan ini</span>
            <img
              class="ur118"
              src="/pen/i-89f7f9953c.svg"
              alt=""
              width="16"
              height="16"
              loading="lazy"
              decoding="async"
            />
          </a>
        </div>
      </div>
      <div class="ur119">
        <img
          class="ur120"
          src="/pen/i-bdf55e7bac.svg"
          alt=""
          width="20"
          height="20"
          loading="lazy"
          decoding="async"
        />
        <p class="ur121">
          Daftar ini adalah gambaran awal. Periksa persyaratan yang berlaku melalui sumber pada jawaban
          Urusin.
        </p>
      </div>
    </div>
  </section>
  <LandingFooter />
</main>
