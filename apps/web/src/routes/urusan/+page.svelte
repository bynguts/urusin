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
  import g6a41666 from '#lib/assets/img/pen-landing/amber-40.webp';
  import g1f3c995 from '#lib/assets/img/pen-landing/amber-jempol-202.webp';
  import g6fb359f from '#lib/assets/img/pen-landing/blue-40.webp';
  import g19932a8 from '#lib/assets/img/pen-landing/blue-memeriksa-202.webp';
  import ge3aff08 from '#lib/assets/img/pen-landing/cta-panel-51bc-1040.webp';
  import g0dc5ab3 from '#lib/assets/img/pen-landing/green-40.webp';
  import gcb5b056 from '#lib/assets/img/pen-landing/green-membaca-183.webp';
  import gabb844a from '#lib/assets/img/pen-landing/green-membaca-366.webp';
  import g969c6d7 from '#lib/assets/img/pen-landing/purple-40.webp';
  import gd74aa1e from '#lib/assets/img/pen-landing/purple-laptop-183.webp';
  import g0e63181 from '#lib/assets/img/pen-landing/purple-laptop-366.webp';
  import gf294e85 from '#lib/assets/img/pen-landing/rose-40.webp';
  import g822e46b from '#lib/assets/img/pen-landing/rose-melambai-202.webp';
  import gb9287ba from '#lib/assets/img/pen-web/amber-20.webp';
  import g9c7d838 from '#lib/assets/img/pen-web/amber-jempol-170.webp';
  import gb35d8ef from '#lib/assets/img/pen-web/amber-jempol-340.webp';
  import g7439031 from '#lib/assets/img/pen-web/amber-jempol-404.webp';
  import g87da289 from '#lib/assets/img/pen-web/blue-20.webp';
  import g0c757cc from '#lib/assets/img/pen-web/blue-memeriksa-404.webp';
  import g8b5f70f from '#lib/assets/img/pen-web/green-20.webp';
  import g6edb672 from '#lib/assets/img/pen-web/green-membaca-190.webp';
  import g507f956 from '#lib/assets/img/pen-web/green-membaca-380.webp';
  import g07107c8 from '#lib/assets/img/pen-web/purple-20.webp';
  import g4f9f209 from '#lib/assets/img/pen-web/rose-20.webp';
  import ga73a4d3 from '#lib/assets/img/pen-web/rose-melambai-404.webp';

  /*
   * Urusan = frame Web "Urusan" dari pen Rafi, dikonversi dari ekspor HTML/CSS apa adanya (kelas urN di
   * urusan.css). Header dan footer memakai komponen landing. Tombol "Mulai urusan" di kartu adalah formulir
   * POST ke aksi landing (jalan tanpa JavaScript), judul kartu menuju halaman peristiwanya.
   */
  const targetMulai = $derived(page.data.akun ? resolve('/beranda') : resolve('/daftar'));
</script>

<svelte:head>
  <title>Urusan · Urusin</title>
  <meta
    name="description"
    content="Pilih dari peristiwa hidup: kelahiran, perkawinan, pindah domisili, kehilangan keluarga, KTP, dan urusan lain."
  />
</svelte:head>

<main class="lp0 lp" id="konten">
  <LandingNav aktif="urusan" />
  <!-- Page hero -->
  <section class="ur1">
    <div class="ur2">
      <div class="ur3">
        <p class="ur4">Urusan</p>
      </div>
      <h1 class="ur5">Urusan yang bisa dibantu Urusin</h1>
      <p class="ur6">
        Mulai dari peristiwa hidup yang sedang kamu alami. Urusin tahu dokumen dan instansi mana yang
        terlibat, sesuai wilayahmu.
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
        <h2 class="ur13">Pilih dari peristiwa hidup</h2>
        <p class="ur14">
          Satu peristiwa sering melibatkan beberapa dokumen dan instansi. Urusin merangkainya jadi satu
          rencana.
        </p>
      </div>
      <div class="ur15">
        <div class="ur16">
          <div class="ur17">
            <img
              class="ur18"
              src="/pen/i-b7de71eeaa.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur19">Kelahiran</p>
          </div>
          <div class="ur20">
            <h3 class="ur21"><a href={resolve('/peristiwa/[slug]', { slug: 'kelahiran' })}>Kelahiran</a></h3>
            <p class="ur22">Anak baru lahir dan perlu dicatat resmi.</p>
          </div>
          <div class="ur23">
            <p class="ur24">Yang diurus</p>
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
              <span class="ur31">Mulai urusan</span>
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
          <div class="ur34">
            <img
              class="ur35"
              src="/pen/i-70cecbf815.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur36">Menikah</p>
          </div>
          <div class="ur37">
            <h3 class="ur38">
              <a href={resolve('/peristiwa/[slug]', { slug: 'perkawinan' })}>Perkawinan</a>
            </h3>
            <p class="ur39">Mencatatkan pernikahan dan memperbarui data keluarga.</p>
          </div>
          <div class="ur40">
            <p class="ur41">Yang diurus</p>
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
              <span class="ur48">Mulai urusan</span>
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
          <div class="ur51">
            <img
              class="ur52"
              src="/pen/i-8bacda7cbf.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur53">Pindah rumah</p>
          </div>
          <div class="ur54">
            <h3 class="ur55">
              <a href={resolve('/peristiwa/[slug]', { slug: 'pindah' })}>Pindah domisili</a>
            </h3>
            <p class="ur56">Pindah rumah ke kota atau kabupaten lain.</p>
          </div>
          <div class="ur57">
            <p class="ur58">Yang diurus</p>
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
              <span class="ur65">Mulai urusan</span>
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
          <div class="ur69">
            <img
              class="ur70"
              src="/pen/i-725a8e827e.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur71">Kehilangan keluarga</p>
          </div>
          <div class="ur72">
            <h3 class="ur73">
              <a href={resolve('/peristiwa/[slug]', { slug: 'kematian' })}>Kehilangan keluarga</a>
            </h3>
            <p class="ur74">Mengurus dokumen setelah anggota keluarga meninggal.</p>
          </div>
          <div class="ur75">
            <p class="ur76">Yang diurus</p>
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
              <span class="ur83">Mulai urusan</span>
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
          <div class="ur86">
            <img
              class="ur87"
              src="/pen/i-55331106e9.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur88">KTP &amp; dokumen</p>
          </div>
          <div class="ur89">
            <h3 class="ur90">
              <a href={resolve('/peristiwa/[slug]', { slug: 'lainnya' })}>KTP &amp; dokumen</a>
            </h3>
            <p class="ur91">Membuat, memperpanjang, atau mengganti dokumen yang hilang.</p>
          </div>
          <div class="ur92">
            <p class="ur93">Yang diurus</p>
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
              <span class="ur100">Mulai urusan</span>
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
          <div class="ur103">
            <img
              class="ur104"
              src="/pen/i-58b014e534.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ur105">Urusan lain</p>
          </div>
          <div class="ur106">
            <h3 class="ur107">Urusan lain</h3>
            <p class="ur108">Belum ada di daftar? Ceritakan saja kebutuhanmu.</p>
          </div>
          <div class="ur109">
            <p class="ur110">Yang diurus</p>
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
            <p class="ur114">Sesuai urusanmu</p>
          </div>
          <div class="ur115"></div>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a class="ur116" href={targetMulai}>
            <span class="ur117">Mulai urusan</span>
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
          Syarat bisa berbeda di tiap kabupaten/kota. Urusin selalu memakai aturan dari situs resmi wilayah
          yang kamu pilih, dan menyebut tanggal terakhir diperiksa.
        </p>
      </div>
    </div>
  </section>
  <!-- Services -->
  <section class="ur122">
    <div class="n-services-heading ur123">
      <h2 class="n-services-title ur124">
        Banyak instansi, banyak situs.
        <br />
        Urusin paham jalannya.
      </h2>
      <p class="n-services-intro ur125">
        Persyaratan tersebar di banyak situs dan berbeda antarwilayah. Urusin membaca sumber resmi, lalu
        menjelaskannya dengan bahasa sehari-hari.
      </p>
    </div>
    <div class="ur126" aria-hidden="true">
      <div class="ur127">
        <div class="ur128">
          <img
            class="ur129"
            src="/pen/i-2b7a14517e.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur130">
          <img
            class="ur131"
            src="/pen/i-1ab4210633.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur132">
          <img
            class="ur133"
            src="/pen/i-0b45b6fb49.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur134">
          <img
            class="ur135"
            src="/pen/i-4deeeab727.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur136">
          <img
            class="ur137"
            src="/pen/i-70c6dc0063.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur138">
          <img
            class="ur139"
            src="/pen/i-55428b36c1.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur140">
          <img
            class="ur141"
            src="/pen/i-8dfedbef7b.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur142">
          <img
            class="ur143"
            src="/pen/i-53f22ee788.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur144">
          <img
            class="ur145"
            src="/pen/i-34fb80dae2.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur146">
          <img
            class="ur147"
            src="/pen/i-b8d12505a2.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur148">
          <img
            class="ur149"
            src="/pen/i-5b62b7b32c.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur150">
          <img
            class="ur151"
            src="/pen/i-a3b416bd95.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur152">
          <img
            class="ur153"
            src="/pen/i-f1fc7cb750.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur154">
          <img
            class="ur155"
            src="/pen/i-e0a32df40b.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur156">
          <img
            class="ur157"
            src="/pen/i-507edfd881.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur158">
          <img
            class="ur159"
            src="/pen/i-3337eba6d9.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
      <div class="ur160">
        <div class="ur161">
          <img
            class="ur162"
            src="/pen/i-53f22ee788.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur163">
          <img
            class="ur164"
            src="/pen/i-34fb80dae2.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur165">
          <img
            class="ur166"
            src="/pen/i-b8d12505a2.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur167">
          <img
            class="ur168"
            src="/pen/i-5b62b7b32c.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur169">
          <img
            class="ur170"
            src="/pen/i-a3b416bd95.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur171">
          <img
            class="ur172"
            src="/pen/i-f1fc7cb750.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur173">
          <img
            class="ur174"
            src="/pen/i-e0a32df40b.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur175">
          <img
            class="ur176"
            src="/pen/i-507edfd881.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur177">
          <img
            class="ur178"
            src="/pen/i-3337eba6d9.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur179">
          <img
            class="ur180"
            src="/pen/i-2b7a14517e.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur181">
          <img
            class="ur182"
            src="/pen/i-1ab4210633.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur183">
          <img
            class="ur184"
            src="/pen/i-0b45b6fb49.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur185">
          <img
            class="ur186"
            src="/pen/i-4deeeab727.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur187">
          <img
            class="ur188"
            src="/pen/i-70c6dc0063.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur189">
          <img
            class="ur190"
            src="/pen/i-55428b36c1.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur191">
          <img
            class="ur192"
            src="/pen/i-8dfedbef7b.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
      <div class="ur193">
        <div class="ur194">
          <img
            class="ur195"
            src="/pen/i-507edfd881.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur196">
          <img
            class="ur197"
            src="/pen/i-3337eba6d9.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur198">
          <img
            class="ur199"
            src="/pen/i-2b7a14517e.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur200">
          <img
            class="ur201"
            src="/pen/i-1ab4210633.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur202">
          <img
            class="ur203"
            src="/pen/i-0b45b6fb49.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur204">
          <img
            class="ur205"
            src="/pen/i-4deeeab727.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur206">
          <img
            class="ur207"
            src="/pen/i-70c6dc0063.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur208">
          <img
            class="ur209"
            src="/pen/i-55428b36c1.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur210">
          <img
            class="ur211"
            src="/pen/i-8dfedbef7b.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur212">
          <img
            class="ur213"
            src="/pen/i-53f22ee788.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur214">
          <img
            class="ur215"
            src="/pen/i-34fb80dae2.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur216">
          <img
            class="ur217"
            src="/pen/i-b8d12505a2.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur218">
          <img
            class="ur219"
            src="/pen/i-5b62b7b32c.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur220">
          <img
            class="ur221"
            src="/pen/i-a3b416bd95.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur222">
          <img
            class="ur223"
            src="/pen/i-f1fc7cb750.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="ur224">
          <img
            class="ur225"
            src="/pen/i-e0a32df40b.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
      <div class="ur226"></div>
      <div class="ur227"></div>
    </div>
    <div class="n-prompt-box ur228" aria-hidden="true">
      <div class="n-prompt-text ur229">
        <p class="ur230">Urus&#160;</p>
        <p class="ur231">akta kelahiran&#160;</p>
        <p class="ur232">di&#160;</p>
        <p class="ur233">Dukcapil</p>
        <p class="ur234">, lalu daftarkan ke&#160;</p>
        <p class="ur235">BPJS Kesehatan</p>
      </div>
      <div class="n-prompt-row ur236">
        <img
          class="ur237"
          src="/pen/i-b4cb3f7cf4.svg"
          alt=""
          width="18"
          height="18"
          loading="lazy"
          decoding="async"
        />
        <div class="ur238">
          <img
            class="ur239"
            src="/pen/i-f0698b7391.svg"
            alt=""
            width="16"
            height="16"
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </div>
  </section>
  <!-- Final CTA -->
  <section class="ur240">
    <div class="n-cta-panel ur241" style:background-image="url({ge3aff08})">
      <div class="n-copy ur242">
        <div class="ur243">
          <div class="ur244" aria-hidden="true">
            <img
              class="ur245"
              src={g4f9f209}
              srcset="{g4f9f209} 20w, {gf294e85} 40w"
              sizes="20px"
              alt=""
              width="20"
              height="20"
              loading="lazy"
              decoding="async"
            />
            <img
              class="ur246"
              src={g07107c8}
              srcset="{g07107c8} 20w, {g969c6d7} 40w"
              sizes="20px"
              alt=""
              width="20"
              height="20"
              loading="lazy"
              decoding="async"
            />
            <img
              class="ur247"
              src={g87da289}
              srcset="{g87da289} 20w, {g6fb359f} 40w"
              sizes="20px"
              alt=""
              width="20"
              height="20"
              loading="lazy"
              decoding="async"
            />
            <img
              class="ur248"
              src={g8b5f70f}
              srcset="{g8b5f70f} 20w, {g0dc5ab3} 40w"
              sizes="20px"
              alt=""
              width="20"
              height="20"
              loading="lazy"
              decoding="async"
            />
            <img
              class="ur249"
              src={gb9287ba}
              srcset="{gb9287ba} 20w, {g6a41666} 40w"
              sizes="20px"
              alt=""
              width="20"
              height="20"
              loading="lazy"
              decoding="async"
            />
          </div>
          <p class="ur250">5 pendamping siap menemani</p>
        </div>
        <h2 class="ur251">
          Urusan berikutnya,
          <br />
          kita kerjakan bareng
        </h2>
        <p class="n-sub ur252">
          Gratis dan langsung dari browser. Ceritakan apa yang terjadi, Urusin yang menyusun langkahnya.
        </p>
        <div class="ur253">
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a class="ur254" href={targetMulai}>
            <img
              class="ur255"
              src="/pen/i-f8e6f89678.svg"
              alt=""
              width="16"
              height="16"
              loading="lazy"
              decoding="async"
            />
            <span class="ur256">Mulai urusan</span>
          </a>
          <a class="ur257" href={resolve('/cara-kerja')}>
            <span class="ur258">Lihat cara kerja</span>
          </a>
        </div>
        <div class="ur259">
          <div class="ur260">
            <img
              class="ur261"
              src="/pen/i-0066e04d08.svg"
              alt=""
              width="14"
              height="14"
              loading="lazy"
              decoding="async"
            />
            <p class="ur262">Gratis</p>
          </div>
          <div class="ur263">
            <img
              class="ur264"
              src="/pen/i-c9f5ddfae9.svg"
              alt=""
              width="14"
              height="14"
              loading="lazy"
              decoding="async"
            />
            <p class="ur265">Data tetap milikmu</p>
          </div>
          <div class="ur266">
            <img
              class="ur267"
              src="/pen/i-f6cec391af.svg"
              alt=""
              width="14"
              height="14"
              loading="lazy"
              decoding="async"
            />
            <p class="ur268">Kamu yang kirim</p>
          </div>
        </div>
      </div>
      <div class="n-companions ur269" aria-hidden="true">
        <img
          class="ur270"
          src={gd74aa1e}
          srcset="{gd74aa1e} 183w, {g0e63181} 366w"
          sizes="183px"
          alt=""
          width="183"
          height="200"
          loading="lazy"
          decoding="async"
        />
        <img
          class="ur271"
          src={gcb5b056}
          srcset="{gcb5b056} 183w, {gabb844a} 366w"
          sizes="183px"
          alt=""
          width="183"
          height="200"
          loading="lazy"
          decoding="async"
        />
        <img
          class="ur272"
          src={g822e46b}
          srcset="{g822e46b} 202w, {ga73a4d3} 404w"
          sizes="202px"
          alt=""
          width="202"
          height="220"
          loading="lazy"
          decoding="async"
        />
        <img
          class="ur273"
          src={g1f3c995}
          srcset="{g1f3c995} 202w, {g7439031} 404w"
          sizes="202px"
          alt=""
          width="202"
          height="220"
          loading="lazy"
          decoding="async"
        />
        <img
          class="ur274"
          src={g19932a8}
          srcset="{g19932a8} 202w, {g0c757cc} 404w"
          sizes="202px"
          alt=""
          width="202"
          height="220"
          loading="lazy"
          decoding="async"
        />
        <div class="ur275">
          <p class="ur276">Mau urus apa hari ini?</p>
        </div>
      </div>
    </div>
  </section>
  <LandingFooter />
</main>
