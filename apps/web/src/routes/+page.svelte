<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import '#lib/components/landing/landing-dasar.css';
  import '#lib/components/landing/landing-pen.css';
  import '#lib/components/landing/landing-responsif.css';
  import '#lib/components/landing/landing-gerak.css';
  import LandingFooter from '#lib/components/landing/LandingFooter.svelte';
  import LandingNav from '#lib/components/landing/LandingNav.svelte';
  import av_rose_melambai_140_avif from '#lib/assets/img/pen-landing/rose-melambai-140.avif';
  import av_rose_melambai_179_avif from '#lib/assets/img/pen-landing/rose-melambai-179.avif';
  import av_rose_melambai_230_avif from '#lib/assets/img/pen-landing/rose-melambai-230.avif';
  import av_rose_melambai_281_avif from '#lib/assets/img/pen-landing/rose-melambai-281.avif';
  import av_rose_melambai_375_avif from '#lib/assets/img/pen-landing/rose-melambai-375.avif';
  import av_purple_melambai_140_avif from '#lib/assets/img/pen-landing/purple-melambai-140.avif';
  import av_purple_melambai_179_avif from '#lib/assets/img/pen-landing/purple-melambai-179.avif';
  import av_purple_melambai_230_avif from '#lib/assets/img/pen-landing/purple-melambai-230.avif';
  import av_purple_melambai_281_avif from '#lib/assets/img/pen-landing/purple-melambai-281.avif';
  import av_purple_melambai_375_avif from '#lib/assets/img/pen-landing/purple-melambai-375.avif';
  import av_green_melambai_140_avif from '#lib/assets/img/pen-landing/green-melambai-140.avif';
  import av_green_melambai_179_avif from '#lib/assets/img/pen-landing/green-melambai-179.avif';
  import av_green_melambai_230_avif from '#lib/assets/img/pen-landing/green-melambai-230.avif';
  import av_green_melambai_281_avif from '#lib/assets/img/pen-landing/green-melambai-281.avif';
  import av_green_melambai_375_avif from '#lib/assets/img/pen-landing/green-melambai-375.avif';
  import av_amber_jempol_140_avif from '#lib/assets/img/pen-landing/amber-jempol-140.avif';
  import av_amber_jempol_179_avif from '#lib/assets/img/pen-landing/amber-jempol-179.avif';
  import av_amber_jempol_230_avif from '#lib/assets/img/pen-landing/amber-jempol-230.avif';
  import av_amber_jempol_281_avif from '#lib/assets/img/pen-landing/amber-jempol-281.avif';
  import av_amber_jempol_375_avif from '#lib/assets/img/pen-landing/amber-jempol-375.avif';
  import av_purple_laptop_340_avif from '#lib/assets/img/pen-landing/purple-laptop-340.avif';
  import av_purple_laptop_401_avif from '#lib/assets/img/pen-landing/purple-laptop-401.avif';
  import av_purple_laptop_680_avif from '#lib/assets/img/pen-landing/purple-laptop-680.avif';
  import av_rose_berdiri_350_avif from '#lib/assets/img/pen-landing/rose-berdiri-350.avif';
  import av_rose_berdiri_413_avif from '#lib/assets/img/pen-landing/rose-berdiri-413.avif';
  import av_rose_berdiri_700_avif from '#lib/assets/img/pen-landing/rose-berdiri-700.avif';
  import av_blue_melambai_350_avif from '#lib/assets/img/pen-landing/blue-melambai-350.avif';
  import av_blue_melambai_413_avif from '#lib/assets/img/pen-landing/blue-melambai-413.avif';
  import av_blue_melambai_700_avif from '#lib/assets/img/pen-landing/blue-melambai-700.avif';
  import av_rose_berdiri_455_avif from '#lib/assets/img/pen-landing/rose-berdiri-455.avif';
  import av_rose_berdiri_520_avif from '#lib/assets/img/pen-landing/rose-berdiri-520.avif';
  import av_purple_berdiri_455_avif from '#lib/assets/img/pen-landing/purple-berdiri-455.avif';
  import av_purple_berdiri_520_avif from '#lib/assets/img/pen-landing/purple-berdiri-520.avif';
  import av_blue_berdiri_455_avif from '#lib/assets/img/pen-landing/blue-berdiri-455.avif';
  import av_blue_berdiri_520_avif from '#lib/assets/img/pen-landing/blue-berdiri-520.avif';
  import av_green_membaca_455_avif from '#lib/assets/img/pen-landing/green-membaca-455.avif';
  import av_green_membaca_520_avif from '#lib/assets/img/pen-landing/green-membaca-520.avif';
  import av_amber_berdiri_455_avif from '#lib/assets/img/pen-landing/amber-berdiri-455.avif';
  import av_amber_berdiri_520_avif from '#lib/assets/img/pen-landing/amber-berdiri-520.avif';
  import g58006f1 from '#lib/assets/img/pen-landing/hero-pattern-fcb3-1440.webp';
  import g7318dfb from '#lib/assets/img/pen-landing/rose-melambai-140.webp';
  import g53b40cd from '#lib/assets/img/pen-landing/rose-melambai-179.webp';
  import gda9322b from '#lib/assets/img/pen-landing/rose-melambai-230.webp';
  import g6c98ad9 from '#lib/assets/img/pen-landing/rose-melambai-281.webp';
  import g348ca12 from '#lib/assets/img/pen-landing/rose-melambai-375.webp';
  import g35b8475 from '#lib/assets/img/pen-landing/rose-melambai-460.webp';
  import gc83c329 from '#lib/assets/img/pen-landing/purple-melambai-140.webp';
  import g1a1d7d2 from '#lib/assets/img/pen-landing/purple-melambai-179.webp';
  import ged2300f from '#lib/assets/img/pen-landing/purple-melambai-230.webp';
  import g7c6689e from '#lib/assets/img/pen-landing/purple-melambai-281.webp';
  import ge9bb049 from '#lib/assets/img/pen-landing/purple-melambai-375.webp';
  import g6e70f38 from '#lib/assets/img/pen-landing/purple-melambai-460.webp';
  import g5942763 from '#lib/assets/img/pen-landing/green-melambai-140.webp';
  import g9c84e2a from '#lib/assets/img/pen-landing/green-melambai-179.webp';
  import gbad712d from '#lib/assets/img/pen-landing/green-melambai-230.webp';
  import g8fa0aa2 from '#lib/assets/img/pen-landing/green-melambai-281.webp';
  import gd1df53c from '#lib/assets/img/pen-landing/green-melambai-375.webp';
  import g5ce0fbb from '#lib/assets/img/pen-landing/green-melambai-460.webp';
  import gadfb3bd from '#lib/assets/img/pen-landing/amber-jempol-140.webp';
  import gb41429a from '#lib/assets/img/pen-landing/amber-jempol-179.webp';
  import g9944d5b from '#lib/assets/img/pen-landing/amber-jempol-230.webp';
  import g9930c13 from '#lib/assets/img/pen-landing/amber-jempol-281.webp';
  import g9a60797 from '#lib/assets/img/pen-landing/amber-jempol-375.webp';
  import gfe3505c from '#lib/assets/img/pen-landing/amber-jempol-460.webp';
  import g7a2696b from '#lib/assets/img/pen-landing/urusin-mark-9.webp';
  import g7ba78fc from '#lib/assets/img/pen-landing/urusin-mark-11.webp';
  import g4c19890 from '#lib/assets/img/pen-landing/urusin-mark-14.webp';
  import gdb08653 from '#lib/assets/img/pen-landing/urusin-mark-17.webp';
  import g4157769 from '#lib/assets/img/pen-landing/urusin-mark-23.webp';
  import g72821e9 from '#lib/assets/img/pen-landing/urusin-mark-28.webp';
  import g71d3e1c from '#lib/assets/img/pen-landing/state-2-ai-mengisi-659.webp';
  import gd364869 from '#lib/assets/img/pen-landing/state-2-ai-mengisi-842.webp';
  import g06f3705 from '#lib/assets/img/pen-landing/state-2-ai-mengisi-1080.webp';
  import g9d9bb51 from '#lib/assets/img/pen-landing/state-2-ai-mengisi-1318.webp';
  import g776a2c9 from '#lib/assets/img/pen-landing/state-2-ai-mengisi-1760.webp';
  import g4d3be26 from '#lib/assets/img/pen-landing/state-2-ai-mengisi-2160.webp';
  import s1_659 from '#lib/assets/img/pen-landing/state-1-konfirmasi-659.webp';
  import s1_842 from '#lib/assets/img/pen-landing/state-1-konfirmasi-842.webp';
  import s1_1080 from '#lib/assets/img/pen-landing/state-1-konfirmasi-1080.webp';
  import s1_1318 from '#lib/assets/img/pen-landing/state-1-konfirmasi-1318.webp';
  import s1_1760 from '#lib/assets/img/pen-landing/state-1-konfirmasi-1760.webp';
  import s1_2160 from '#lib/assets/img/pen-landing/state-1-konfirmasi-2160.webp';
  import s3_659 from '#lib/assets/img/pen-landing/state-3-giliran-anda-659.webp';
  import s3_842 from '#lib/assets/img/pen-landing/state-3-giliran-anda-842.webp';
  import s3_1080 from '#lib/assets/img/pen-landing/state-3-giliran-anda-1080.webp';
  import s3_1318 from '#lib/assets/img/pen-landing/state-3-giliran-anda-1318.webp';
  import s3_1760 from '#lib/assets/img/pen-landing/state-3-giliran-anda-1760.webp';
  import s3_2160 from '#lib/assets/img/pen-landing/state-3-giliran-anda-2160.webp';
  import g71ee866 from '#lib/assets/img/pen-landing/rose-34.webp';
  import gb2f0431 from '#lib/assets/img/pen-landing/rose-68.webp';
  import gc859988 from '#lib/assets/img/pen-landing/purple-68.webp';
  import g1b19b54 from '#lib/assets/img/pen-landing/blue-68.webp';
  import g6593c25 from '#lib/assets/img/pen-landing/green-68.webp';
  import g482c1c6 from '#lib/assets/img/pen-landing/amber-68.webp';
  import g88b7527 from '#lib/assets/img/pen-landing/intro-characters-cd62-560.webp';
  import g5b02458 from '#lib/assets/img/pen-landing/purple-laptop-340.webp';
  import g2148074 from '#lib/assets/img/pen-landing/purple-laptop-401.webp';
  import g5030df1 from '#lib/assets/img/pen-landing/purple-laptop-680.webp';
  import ge2ac5d7 from '#lib/assets/img/pen-landing/rose-berdiri-350.webp';
  import ga87fdfd from '#lib/assets/img/pen-landing/rose-berdiri-413.webp';
  import g7c2ee55 from '#lib/assets/img/pen-landing/rose-berdiri-700.webp';
  import gd9fb205 from '#lib/assets/img/pen-landing/blue-melambai-350.webp';
  import gaf896aa from '#lib/assets/img/pen-landing/blue-melambai-413.webp';
  import gd5b045e from '#lib/assets/img/pen-landing/blue-melambai-700.webp';
  import g705570e from '#lib/assets/img/pen-landing/purple-26.webp';
  import g38cab09 from '#lib/assets/img/pen-landing/purple-31.webp';
  import gffb2410 from '#lib/assets/img/pen-landing/purple-52.webp';
  import g6d8800d from '#lib/assets/img/pen-landing/rose-26.webp';
  import ge3be622 from '#lib/assets/img/pen-landing/rose-31.webp';
  import gf45dd60 from '#lib/assets/img/pen-landing/rose-52.webp';
  import g3b949a3 from '#lib/assets/img/pen-landing/blue-26.webp';
  import g8d938bb from '#lib/assets/img/pen-landing/blue-31.webp';
  import g77d48ce from '#lib/assets/img/pen-landing/blue-52.webp';
  import g5c7b0aa from '#lib/assets/img/pen-landing/stage-4948-334.webp';
  import gbd4cf91 from '#lib/assets/img/pen-landing/rose-berdiri-520.webp';
  import g870d35b from '#lib/assets/img/pen-landing/stage-73bc-334.webp';
  import g4dc73ea from '#lib/assets/img/pen-landing/purple-berdiri-520.webp';
  import g8836483 from '#lib/assets/img/pen-landing/stage-5ea6-334.webp';
  import g6518f7f from '#lib/assets/img/pen-landing/blue-berdiri-520.webp';
  import g30dc911 from '#lib/assets/img/pen-landing/stage-04ee-334.webp';
  import g160b36a from '#lib/assets/img/pen-landing/green-membaca-520.webp';
  import g6714886 from '#lib/assets/img/pen-landing/stage-b832-334.webp';
  import g60d4976 from '#lib/assets/img/pen-landing/amber-berdiri-520.webp';
  import g34c86fd from '#lib/assets/img/pen-landing/stage-e79e-334.webp';
  import gce73af8 from '#lib/assets/img/pen-landing/blue-berdiri-480.webp';
  import g17d724d from '#lib/assets/img/pen-landing/visual-bef2-510.webp';
  import g8430cc2 from '#lib/assets/img/pen-landing/rose-44.webp';
  import g5535a9a from '#lib/assets/img/pen-landing/amber-duduk-120.webp';
  import ge675d89 from '#lib/assets/img/pen-landing/amber-duduk-155.webp';
  import g1a6f689 from '#lib/assets/img/pen-landing/amber-duduk-240.webp';
  import gc6bba96 from '#lib/assets/img/pen-landing/visual-6493-510.webp';
  import gb318a68 from '#lib/assets/img/pen-landing/kamera-86.webp';
  import gbb409f7 from '#lib/assets/img/pen-landing/kamera-111.webp';
  import g864458f from '#lib/assets/img/pen-landing/kamera-172.webp';
  import g913cf8d from '#lib/assets/img/pen-landing/rose-memotret-196.webp';
  import gfa97bc8 from '#lib/assets/img/pen-landing/rose-memotret-253.webp';
  import gdb2c70e from '#lib/assets/img/pen-landing/rose-memotret-392.webp';
  import g8f42574 from '#lib/assets/img/pen-landing/visual-ce6a-510.webp';
  import g55819b7 from '#lib/assets/img/pen-landing/urusin-mark-18.webp';
  import g2244bcf from '#lib/assets/img/pen-landing/urusin-mark-36.webp';
  import g2daaa24 from '#lib/assets/img/pen-landing/purple-laptop-150.webp';
  import g562edfa from '#lib/assets/img/pen-landing/purple-laptop-194.webp';
  import gc740f3c from '#lib/assets/img/pen-landing/purple-laptop-300.webp';
  import g298eb08 from '#lib/assets/img/pen-landing/visual-4db6-510.webp';
  import g7d656cd from '#lib/assets/img/pen-landing/blue-memeriksa-132.webp';
  import gfa81d5b from '#lib/assets/img/pen-landing/blue-memeriksa-170.webp';
  import g8eb5f6d from '#lib/assets/img/pen-landing/blue-memeriksa-264.webp';
  import g49a4260 from '#lib/assets/img/pen-landing/visual-8342-334.webp';
  import g206ec4b from '#lib/assets/img/pen-landing/rose-56.webp';
  import g9ab00c1 from '#lib/assets/img/pen-landing/visual-20b9-334.webp';
  import g40ad979 from '#lib/assets/img/pen-landing/visual-debe-380.webp';
  import ga0cfe92 from '#lib/assets/img/pen-landing/amber-jempol-224.webp';
  import g1a14d28 from '#lib/assets/img/pen-landing/blue-melambai-280.webp';
  import gef0380a from '#lib/assets/img/pen-landing/purple-laptop-224.webp';
  import gdd90def from '#lib/assets/img/pen-landing/comparison-2824-1440.webp';
  import gb11bdb2 from '#lib/assets/img/pen-landing/blue-berpikir-150.webp';
  import g5314d32 from '#lib/assets/img/pen-landing/blue-berpikir-194.webp';
  import gf217c61 from '#lib/assets/img/pen-landing/blue-berpikir-300.webp';
  import g4e6702c from '#lib/assets/img/pen-landing/urusin-mark-44.webp';
  import g1ab60a9 from '#lib/assets/img/pen-landing/green-duduk-130.webp';
  import g153fc93 from '#lib/assets/img/pen-landing/green-duduk-168.webp';
  import g4405d37 from '#lib/assets/img/pen-landing/green-duduk-260.webp';
  import g74850df from '#lib/assets/img/pen-landing/perisai-360.webp';
  import ge4af363 from '#lib/assets/img/pen-landing/faq-cbf9-1457.webp';
  import gd65804a from '#lib/assets/img/pen-landing/green-berpikir-380.webp';
  import g327a44d from '#lib/assets/img/pen-landing/amber-berpikir-339.webp';
  import g749e4e0 from '#lib/assets/img/pen-landing/cta-panel-51bc-1040.webp';
  import g2c85a08 from '#lib/assets/img/pen-landing/rose-40.webp';
  import g04267bc from '#lib/assets/img/pen-landing/purple-40.webp';
  import g226f431 from '#lib/assets/img/pen-landing/blue-40.webp';
  import g4ee3cad from '#lib/assets/img/pen-landing/green-40.webp';
  import gb908ec2 from '#lib/assets/img/pen-landing/amber-40.webp';
  import g5df4311 from '#lib/assets/img/pen-landing/purple-laptop-183.webp';
  import gc3800a9 from '#lib/assets/img/pen-landing/purple-laptop-210.webp';
  import g1e40549 from '#lib/assets/img/pen-landing/purple-laptop-366.webp';
  import g319aa42 from '#lib/assets/img/pen-landing/green-membaca-183.webp';
  import g6471807 from '#lib/assets/img/pen-landing/green-membaca-210.webp';
  import g1b1d18c from '#lib/assets/img/pen-landing/green-membaca-366.webp';
  import ga314e66 from '#lib/assets/img/pen-landing/rose-melambai-202.webp';
  import g862a916 from '#lib/assets/img/pen-landing/rose-melambai-232.webp';
  import g06c0f97 from '#lib/assets/img/pen-landing/rose-melambai-403.webp';
  import gb1fc54d from '#lib/assets/img/pen-landing/amber-jempol-202.webp';
  import g85cbc60 from '#lib/assets/img/pen-landing/amber-jempol-232.webp';
  import gfeb950a from '#lib/assets/img/pen-landing/amber-jempol-403.webp';
  import g9a245f0 from '#lib/assets/img/pen-landing/blue-memeriksa-202.webp';
  import g1e18890 from '#lib/assets/img/pen-landing/blue-memeriksa-232.webp';
  import g1d1b55c from '#lib/assets/img/pen-landing/blue-memeriksa-403.webp';

  /*
   * Landing = frame n2rpg "Urusin • Landing / Desktop" dari pen Rafi (urusin.pen), dikonversi dari ekspor
   * HTML/CSS apa adanya. Gaya per elemen ada di landing-pen.css (kelas lpN), aturan ponsel di
   * landing-responsif.css. Ajakan masuk ke alur urusan yang sudah ada (/beranda, /?/mulai).
   * Gerak (CSS saja, nol JS) ada di landing-gerak.css.
   */

  /*
   * Demo jendela hero (frame VAN7K "Hero demo / Animation states"): langkah 1 dan 3 ditumpuk di atas
   * gambar langkah 2 (LCP). Lebar kandidat dan sizes sama dengan .lp42 supaya peramban memilih berkas
   * yang sejajar; tanpa gerak lapisan ini display:none sehingga berkasnya tidak diunduh.
   */
  const demoSizes =
    '(max-width: 479px) 356px, (max-width: 767px) 454px, (max-width: 1023px) 713px, (max-width: 1111px) 950px, 1080px';
  const demo2 = `${g71d3e1c} 659w, ${gd364869} 842w, ${g06f3705} 1080w, ${g9d9bb51} 1318w, ${g776a2c9} 1760w, ${g4d3be26} 2160w`;
  const demo1 = `${s1_659} 659w, ${s1_842} 842w, ${s1_1080} 1080w, ${s1_1318} 1318w, ${s1_1760} 1760w, ${s1_2160} 2160w`;
  const demo3 = `${s3_659} 659w, ${s3_842} 842w, ${s3_1080} 1080w, ${s3_1318} 1318w, ${s3_1760} 1760w, ${s3_2160} 2160w`;
  const targetMulai = $derived(page.data.akun ? resolve('/beranda') : resolve('/daftar'));
</script>

<svelte:head>
  <title>Urusin: urusan administrasi, kini ada yang menemani</title>
  <meta
    name="description"
    content="Urusin adalah pendamping yang mengubah ceritamu jadi langkah yang jelas, dari dokumen sampai situs resmi."
  />
</svelte:head>

<main class="lp0 lp" id="konten">
  <section class="lp1" id="atas">
    <img
      class="n-hero-pattern lp2"
      src={g58006f1}
      alt=""
      width="1440"
      height="660"
      loading="lazy"
      decoding="async"
      aria-hidden="true"
    />
    <span class="n-hero-gelombang" style="--lp-pola: url({g58006f1})" aria-hidden="true"></span>
    <LandingNav />
    <div class="n-hero-copy lp13">
      <h1 class="lp14">
        Urusan administrasi,
        <br />
        kini ada yang menemani
      </h1>
      <div class="n-hero-intro lp15">
        Urusin adalah pendamping yang mengubah ceritamu jadi langkah yang jelas, dari dokumen sampai situs
        resmi.
      </div>
      <div class="lp16">
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a class="lp17" href={targetMulai}>
          <img class="lp18" src="/pen/i-25435a991f.svg" alt="" width="16" height="16" decoding="async" />
          <span class="lp19"> Mulai urusan </span>
        </a>
        <a class="lp20" href="#cara-kerja">
          <span class="lp21"> Lihat cara kerja </span>
        </a>
      </div>
    </div>
    <div class="n-preview-stage lp22" aria-hidden="true">
      <picture class="lp-pic">
        <source
          media="(max-width: 767px)"
          type="image/avif"
          srcset="{av_rose_melambai_140_avif} 140w, {av_rose_melambai_179_avif} 179w, {av_rose_melambai_230_avif} 230w, {av_rose_melambai_281_avif} 281w, {av_rose_melambai_375_avif} 375w"
          sizes="(max-width: 479px) 76px, 97px"
        />
        <img
          class="lp23"
          src={gda9322b}
          srcset="{g7318dfb} 140w, {g53b40cd} 179w, {gda9322b} 230w, {g6c98ad9} 281w, {g348ca12} 375w, {g35b8475} 460w"
          sizes="(max-width: 479px) 76px, (max-width: 767px) 97px, (max-width: 1023px) 152px, (max-width: 1111px) 202px, 230px"
          alt=""
          width="230"
          height="251"
          decoding="async"
          aria-hidden="true"
        />
      </picture>
      <picture class="lp-pic">
        <source
          media="(max-width: 767px)"
          type="image/avif"
          srcset="{av_purple_melambai_140_avif} 140w, {av_purple_melambai_179_avif} 179w, {av_purple_melambai_230_avif} 230w, {av_purple_melambai_281_avif} 281w, {av_purple_melambai_375_avif} 375w"
          sizes="(max-width: 479px) 76px, 97px"
        />
        <img
          class="lp24"
          src={ged2300f}
          srcset="{gc83c329} 140w, {g1a1d7d2} 179w, {ged2300f} 230w, {g7c6689e} 281w, {ge9bb049} 375w, {g6e70f38} 460w"
          sizes="(max-width: 479px) 76px, (max-width: 767px) 97px, (max-width: 1023px) 152px, (max-width: 1111px) 202px, 230px"
          alt=""
          width="230"
          height="251"
          decoding="async"
          aria-hidden="true"
        />
      </picture>
      <picture class="lp-pic">
        <source
          media="(max-width: 767px)"
          type="image/avif"
          srcset="{av_green_melambai_140_avif} 140w, {av_green_melambai_179_avif} 179w, {av_green_melambai_230_avif} 230w, {av_green_melambai_281_avif} 281w, {av_green_melambai_375_avif} 375w"
          sizes="(max-width: 479px) 76px, 97px"
        />
        <img
          class="lp25"
          src={gbad712d}
          srcset="{g5942763} 140w, {g9c84e2a} 179w, {gbad712d} 230w, {g8fa0aa2} 281w, {gd1df53c} 375w, {g5ce0fbb} 460w"
          sizes="(max-width: 479px) 76px, (max-width: 767px) 97px, (max-width: 1023px) 152px, (max-width: 1111px) 202px, 230px"
          alt=""
          width="230"
          height="251"
          decoding="async"
          aria-hidden="true"
        />
      </picture>
      <picture class="lp-pic">
        <source
          media="(max-width: 767px)"
          type="image/avif"
          srcset="{av_amber_jempol_140_avif} 140w, {av_amber_jempol_179_avif} 179w, {av_amber_jempol_230_avif} 230w, {av_amber_jempol_281_avif} 281w, {av_amber_jempol_375_avif} 375w"
          sizes="(max-width: 479px) 76px, 97px"
        />
        <img
          class="lp26"
          src={g9944d5b}
          srcset="{gadfb3bd} 140w, {gb41429a} 179w, {g9944d5b} 230w, {g9930c13} 281w, {g9a60797} 375w, {gfe3505c} 460w"
          sizes="(max-width: 479px) 76px, (max-width: 767px) 97px, (max-width: 1023px) 152px, (max-width: 1111px) 202px, 230px"
          alt=""
          width="230"
          height="251"
          decoding="async"
          aria-hidden="true"
        />
      </picture>
      <div class="lp27">
        <div class="lp28">
          <div class="lp29">
            <div class="lp30"></div>
            <div class="lp31"></div>
            <div class="lp32"></div>
          </div>
          <div class="lp33">
            <div class="lp34">
              <img class="lp35" src="/pen/i-04bc14830d.svg" alt="" width="13" height="13" decoding="async" />
            </div>
            <div class="lp34">
              <img class="lp35" src="/pen/i-70f9e7a1ce.svg" alt="" width="13" height="13" decoding="async" />
            </div>
            <div class="lp34">
              <img class="lp35" src="/pen/i-ea3d930031.svg" alt="" width="13" height="13" decoding="async" />
            </div>
            <div class="lp34">
              <img class="lp35" src="/pen/i-4588c244d9.svg" alt="" width="13" height="13" decoding="async" />
            </div>
            <div class="lp34">
              <img class="lp35" src="/pen/i-c267d0860e.svg" alt="" width="13" height="13" decoding="async" />
            </div>
          </div>
          <div class="lp36">
            <div class="lp37">
              <img
                class="lp38"
                src={g4c19890}
                srcset="{g7a2696b} 9w, {g7ba78fc} 11w, {g4c19890} 14w, {gdb08653} 17w, {g4157769} 23w, {g72821e9} 28w"
                sizes="(max-width: 479px) 5px, (max-width: 767px) 6px, (max-width: 1023px) 9px, (max-width: 1111px) 12px, 14px"
                alt=""
                width="14"
                height="14"
                decoding="async"
              />
              <div class="lp39">Urusin · Akta kelahiran</div>
            </div>
            <div class="lp40">
              <img class="lp41" src="/pen/i-690f2f58b2.svg" alt="" width="14" height="14" decoding="async" />
            </div>
          </div>
        </div>
        <img
          class="lp42"
          src={g06f3705}
          srcset="{g71d3e1c} 659w, {gd364869} 842w, {g06f3705} 1080w, {g9d9bb51} 1318w, {g776a2c9} 1760w, {g4d3be26} 2160w"
          sizes="(max-width: 479px) 356px, (max-width: 767px) 454px, (max-width: 1023px) 713px, (max-width: 1111px) 950px, 1080px"
          alt=""
          width="1080"
          height="556"
          decoding="async"
          fetchpriority="high"
        />
        <span class="n-demo" aria-hidden="true">
          <span class="n-demo-2">
            <span class="n-demo-kosong"></span>
            <span class="n-demo-panel">
              <img
                class="n-demo-img"
                src={g06f3705}
                srcset={demo2}
                sizes={demoSizes}
                alt=""
                width="1080"
                height="556"
                loading="lazy"
                decoding="async"
                fetchpriority="low"
              />
              <i class="n-demo-kolom n-k1"></i>
              <i class="n-demo-kolom n-k2"></i>
              <i class="n-demo-kolom n-k3"></i>
              <i class="n-demo-kolom n-k4"></i>
              <i class="n-demo-kolom n-k5"></i>
              <i class="n-demo-kolom n-k6"></i>
              <i class="n-demo-sorot"></i>
              <i class="n-demo-progres"></i>
            </span>
          </span>
          <span class="n-demo-3">
            <img
              class="n-demo-img"
              src={s3_1080}
              srcset={demo3}
              sizes={demoSizes}
              alt=""
              width="1080"
              height="556"
              loading="lazy"
              decoding="async"
              fetchpriority="low"
            />
            <span class="n-demo-situs">
              <span class="n-demo-banner"
                ><img
                  class="n-demo-img"
                  src={s3_1080}
                  srcset={demo3}
                  sizes={demoSizes}
                  alt=""
                  width="1080"
                  height="556"
                  loading="lazy"
                  decoding="async"
                  fetchpriority="low"
                /></span
              >
              <i class="n-demo-cincin"></i>
            </span>
          </span>
          <span class="n-demo-1">
            <img
              class="n-demo-img"
              src={s1_1080}
              srcset={demo1}
              sizes={demoSizes}
              alt=""
              width="1080"
              height="556"
              loading="lazy"
              decoding="async"
              fetchpriority="low"
            />
            <i class="n-demo-tekan"></i>
          </span>
        </span>
      </div>
    </div>
  </section>
  <section class="n-trust-strip lp43">
    <div class="lp44">Merujuk informasi resmi dari</div>
    <div class="n-marquee-wrapper lp45-marquee" aria-label="Instansi resmi yang dirujuk">
      <div class="n-marquee-track">
        <!-- Set 1 (Unit utama) -->
        <div class="n-wordmarks lp45">
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-3438e81725.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Dukcapil</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-533e38ff50.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">BPJS Kesehatan</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-63d80529c0.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Kemenag</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-53c23c4d87.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Imigrasi</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-c49f4545a4.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Samsat</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-3438e81725.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Dukcapil</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-533e38ff50.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">BPJS Kesehatan</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-63d80529c0.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Kemenag</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-53c23c4d87.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Imigrasi</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-c49f4545a4.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Samsat</div>
          </div>
        </div>
        <!-- Set 2 (Duplikat untuk infinite loop) -->
        <div class="n-wordmarks lp45" aria-hidden="true">
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-3438e81725.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Dukcapil</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-533e38ff50.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">BPJS Kesehatan</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-63d80529c0.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Kemenag</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-53c23c4d87.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Imigrasi</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-c49f4545a4.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Samsat</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-3438e81725.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Dukcapil</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-533e38ff50.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">BPJS Kesehatan</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-63d80529c0.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Kemenag</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-53c23c4d87.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Imigrasi</div>
          </div>
          <div class="lp46">
            <img
              class="lp47"
              src="/pen/i-c49f4545a4.svg"
              alt=""
              width="22"
              height="22"
              loading="lazy"
              decoding="async"
            />
            <div class="lp48">Samsat</div>
          </div>
        </div>
      </div>
    </div>
  </section>
  <section class="n-intro-split lp49">
    <div class="n-intro-copy lp50">
      <h2 class="lp51">
        <span class="lp52">
          <span class="lp53"> Mulai dari </span>
          <span class="lp54 n-pil">
            <span class="lp55"> cerita </span>
            <span class="lp55 n-pil-kata" aria-hidden="true">
              <span><span>k</span><span>a</span><span>b</span><span>a</span><span>r</span></span>
              <span><span>k</span><span>i</span><span>s</span><span>a</span><span>h</span></span>
              <span><span>c</span><span>e</span><span>r</span><span>i</span><span>t</span><span>a</span></span
              >
            </span>
          </span>
        </span>
        <span class="lp53"> bukan istilah </span>
      </h2>
      <div class="n-intro-p1 lp56">
        Di Urusin kamu cukup bilang “baru punya anak” atau “mau pindah rumah”.
      </div>
      <div class="n-intro-p2 lp56">
        Pendampingmu menyusun dokumen, instansi, dan urutan langkah sesuai daerahmu, lalu menemanimu sampai
        selesai.
      </div>
      <div class="lp57">
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a class="lp58" href={targetMulai}>
          <span class="lp59"> Mulai urusan </span>
        </a>
        <a class="lp20" href="#cara-kerja">
          <span class="lp21"> Lihat cara kerja </span>
        </a>
      </div>
      <div class="n-companion-proof lp60">
        <div class="lp61" aria-hidden="true">
          <img class="lp62" src={gb2f0431} alt="" width="34" height="34" loading="lazy" decoding="async" />
          <img class="lp63" src={gc859988} alt="" width="34" height="34" loading="lazy" decoding="async" />
          <img class="lp64" src={g1b19b54} alt="" width="34" height="34" loading="lazy" decoding="async" />
          <img class="lp65" src={g6593c25} alt="" width="34" height="34" loading="lazy" decoding="async" />
          <img class="lp66" src={g482c1c6} alt="" width="34" height="34" loading="lazy" decoding="async" />
        </div>
        <div class="lp67">Lima pendamping, satu untuk tiap peristiwa hidup</div>
      </div>
    </div>
    <div class="n-intro-characters lp69" aria-hidden="true">
      <img class="lp68" src={g88b7527} alt="" width="560" height="540" loading="lazy" decoding="async" />
      <div class="lp70"></div>
      <div class="lp71"></div>
      <div class="lp72"></div>
      <picture class="lp-pic">
        <source
          media="(max-width: 767px)"
          type="image/avif"
          srcset="{av_purple_laptop_340_avif} 340w, {av_purple_laptop_401_avif} 401w, {av_purple_laptop_680_avif} 680w"
          sizes="218px"
        />
        <img
          class="lp73"
          src={g5b02458}
          srcset="{g5b02458} 340w, {g2148074} 401w, {g5030df1} 680w"
          sizes="(max-width: 767px) 218px, 340px"
          alt=""
          width="340"
          height="371"
          loading="lazy"
          decoding="async"
        />
      </picture>
      <picture class="lp-pic">
        <source
          media="(max-width: 767px)"
          type="image/avif"
          srcset="{av_rose_berdiri_350_avif} 350w, {av_rose_berdiri_413_avif} 413w, {av_rose_berdiri_700_avif} 700w"
          sizes="224px"
        />
        <img
          class="lp74"
          src={ge2ac5d7}
          srcset="{ge2ac5d7} 350w, {ga87fdfd} 413w, {g7c2ee55} 700w"
          sizes="(max-width: 767px) 224px, 350px"
          alt=""
          width="350"
          height="382"
          loading="lazy"
          decoding="async"
        />
      </picture>
      <picture class="lp-pic">
        <source
          media="(max-width: 767px)"
          type="image/avif"
          srcset="{av_blue_melambai_350_avif} 350w, {av_blue_melambai_413_avif} 413w, {av_blue_melambai_700_avif} 700w"
          sizes="224px"
        />
        <img
          class="lp75"
          src={gd9fb205}
          srcset="{gd9fb205} 350w, {gaf896aa} 413w, {gd5b045e} 700w"
          sizes="(max-width: 767px) 224px, 350px"
          alt=""
          width="350"
          height="382"
          loading="lazy"
          decoding="async"
        />
      </picture>
      <div class="lp76">
        <img
          class="lp77"
          src={g705570e}
          srcset="{g705570e} 26w, {g38cab09} 31w, {gffb2410} 52w"
          sizes="(max-width: 767px) 17px, 26px"
          alt=""
          width="26"
          height="26"
          loading="lazy"
          decoding="async"
        />
        <div class="lp78">“Bulan depan saya menikah”</div>
      </div>
      <div class="lp79">
        <img
          class="lp80"
          src={g6d8800d}
          srcset="{g6d8800d} 26w, {ge3be622} 31w, {gf45dd60} 52w"
          sizes="(max-width: 767px) 17px, 26px"
          alt=""
          width="26"
          height="26"
          loading="lazy"
          decoding="async"
        />
        <div class="lp78">“Anak saya baru lahir”</div>
      </div>
      <div class="lp81">
        <img
          class="lp82"
          src={g3b949a3}
          srcset="{g3b949a3} 26w, {g8d938bb} 31w, {g77d48ce} 52w"
          sizes="(max-width: 767px) 17px, 26px"
          alt=""
          width="26"
          height="26"
          loading="lazy"
          decoding="async"
        />
        <div class="lp78">“Mau pindah ke Solo”</div>
      </div>
    </div>
    <div class="lp83"></div>
  </section>
  <section class="lp84">
    <div class="n-services-heading lp85">
      <h2 class="n-services-title lp86">
        Banyak instansi, banyak situs.
        <br />
        Urusin paham jalannya.
      </h2>
      <div class="n-services-intro lp87">
        Persyaratan tersebar di banyak situs dan berbeda antarwilayah. Urusin membaca sumber resmi, lalu
        menjelaskannya dengan bahasa sehari-hari.
      </div>
    </div>
    <div class="lp88" aria-hidden="true">
      <div class="lp89">
        {#each { length: 16 }, i (i)}<i></i>{/each}
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-95c2220383.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-864bab7921.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-a6a3008acd.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-32c8923562.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-fa94228208.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-61026f0797.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-622991afbb.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-81414dc20e.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-e795588273.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-e87b88ff2b.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-3da007ab49.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-941a068b12.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-2ec80010b1.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-ec2f9348f0.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-5212f25c3d.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-62fa004883.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        {#each { length: 16 }, i (i)}<i></i>{/each}
      </div>
      <div class="lp92">
        {#each { length: 16 }, i (i)}<i></i>{/each}
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-81414dc20e.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-e795588273.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-e87b88ff2b.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-3da007ab49.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-941a068b12.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-2ec80010b1.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-ec2f9348f0.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-5212f25c3d.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-62fa004883.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-95c2220383.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-864bab7921.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-a6a3008acd.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-32c8923562.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-fa94228208.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-61026f0797.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-622991afbb.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        {#each { length: 16 }, i (i)}<i></i>{/each}
      </div>
      <div class="lp93">
        {#each { length: 16 }, i (i)}<i></i>{/each}
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-5212f25c3d.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-62fa004883.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-95c2220383.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-864bab7921.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-a6a3008acd.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-32c8923562.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-fa94228208.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-61026f0797.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-622991afbb.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-81414dc20e.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-e795588273.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-e87b88ff2b.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-3da007ab49.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-941a068b12.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-2ec80010b1.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="lp90">
          <img
            class="lp91"
            src="/pen/i-ec2f9348f0.svg"
            alt=""
            width="30"
            height="30"
            loading="lazy"
            decoding="async"
          />
        </div>
        {#each { length: 16 }, i (i)}<i></i>{/each}
      </div>
      <div class="lp94" aria-hidden="true"></div>
      <div class="lp95" aria-hidden="true"></div>
    </div>
    <div class="n-prompt-box lp96" aria-hidden="true">
      <p class="n-prompt-text lp97">
        <span class="n-prompt-typewriter">
          <span class="lp98"> Urus </span>
          <span class="lp99"> akta kelahiran </span>
          <span class="lp98"> di </span>
          <span class="lp100"> Dukcapil</span><span class="lp98">, lalu daftarkan ke </span>
          <span class="lp101"> BPJS Kesehatan </span>
        </span>
      </p>
      <div class="n-prompt-row lp102">
        <img
          class="lp103"
          src="/pen/i-ce12e05cee.svg"
          alt=""
          width="18"
          height="18"
          loading="lazy"
          decoding="async"
        />
        <div class="lp104">
          <img
            class="lp18"
            src="/pen/i-1f5b289855.svg"
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
  <section class="n-companions lp105" id="urusan">
    <h2 class="n-companions-title lp106">Pilih urusanmu, ada yang menemani</h2>
    <div class="n-card-row lp107">
      <div class="lp108">
        <div class="lp109" aria-hidden="true">
          <img class="lp68" src={g5c7b0aa} alt="" width="333" height="196" loading="lazy" decoding="async" />
          <picture class="lp-pic">
            <source
              media="(max-width: 767px)"
              type="image/avif"
              srcset="{av_rose_berdiri_455_avif} 455w, {av_rose_berdiri_520_avif} 520w"
              sizes="260px"
            />
            <img
              class="lp110"
              src={gbd4cf91}
              alt=""
              width="260"
              height="284"
              loading="lazy"
              decoding="async"
            />
          </picture>
          <div class="lp111">
            <img
              class="lp112"
              src="/pen/i-61a9287917.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <div class="lp113">Kelahiran</div>
          </div>
        </div>
        <div class="n-card-body lp114">
          <div class="lp115">Akta kelahiran, Kartu Keluarga baru, dan BPJS anak dalam satu urutan.</div>
          <form class="lp52" method="POST" action="/?/mulai">
            <input type="hidden" name="peristiwa" value="kelahiran" />
            <button class="lp116" type="submit">
              <span class="lp59"> Mulai urus </span>
            </button>
            <a class="lp117" href={resolve('/peristiwa/[slug]', { slug: 'kelahiran' })}>
              <span class="lp118"> Pelajari </span>
              <img
                class="lp18"
                src="/pen/i-31c9beecd6.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </a>
          </form>
        </div>
      </div>
      <div class="lp108">
        <div class="lp109" aria-hidden="true">
          <img class="lp68" src={g870d35b} alt="" width="333" height="196" loading="lazy" decoding="async" />
          <picture class="lp-pic">
            <source
              media="(max-width: 767px)"
              type="image/avif"
              srcset="{av_purple_berdiri_455_avif} 455w, {av_purple_berdiri_520_avif} 520w"
              sizes="260px"
            />
            <img
              class="lp110"
              src={g4dc73ea}
              alt=""
              width="260"
              height="284"
              loading="lazy"
              decoding="async"
            />
          </picture>
          <div class="lp119">
            <img
              class="lp112"
              src="/pen/i-3af80c08fb.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <div class="lp120">Menikah</div>
          </div>
        </div>
        <div class="n-card-body lp114">
          <div class="lp115">Dari surat pengantar RT sampai buku nikah dan KTP dengan status baru.</div>
          <form class="lp52" method="POST" action="/?/mulai">
            <input type="hidden" name="peristiwa" value="perkawinan" />
            <button class="lp116" type="submit">
              <span class="lp59"> Mulai urus </span>
            </button>
            <a class="lp117" href={resolve('/peristiwa/[slug]', { slug: 'perkawinan' })}>
              <span class="lp118"> Pelajari </span>
              <img
                class="lp18"
                src="/pen/i-31c9beecd6.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </a>
          </form>
        </div>
      </div>
      <div class="lp108">
        <div class="lp109" aria-hidden="true">
          <img class="lp68" src={g8836483} alt="" width="333" height="196" loading="lazy" decoding="async" />
          <picture class="lp-pic">
            <source
              media="(max-width: 767px)"
              type="image/avif"
              srcset="{av_blue_berdiri_455_avif} 455w, {av_blue_berdiri_520_avif} 520w"
              sizes="260px"
            />
            <img
              class="lp110"
              src={g6518f7f}
              alt=""
              width="260"
              height="284"
              loading="lazy"
              decoding="async"
            />
          </picture>
          <div class="lp121">
            <img
              class="lp112"
              src="/pen/i-b5882f40fd.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <div class="lp122">Pindah rumah</div>
          </div>
        </div>
        <div class="n-card-body lp114">
          <div class="lp115">Surat pindah, KK, dan KTP alamat baru, termasuk yang bisa online.</div>
          <form class="lp52" method="POST" action="/?/mulai">
            <input type="hidden" name="peristiwa" value="pindah" />
            <button class="lp116" type="submit">
              <span class="lp59"> Mulai urus </span>
            </button>
            <a class="lp117" href={resolve('/peristiwa/[slug]', { slug: 'pindah' })}>
              <span class="lp118"> Pelajari </span>
              <img
                class="lp18"
                src="/pen/i-31c9beecd6.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </a>
          </form>
        </div>
      </div>
    </div>
    <div class="n-card-row lp107">
      <div class="lp108">
        <div class="lp109" aria-hidden="true">
          <img class="lp68" src={g30dc911} alt="" width="333" height="196" loading="lazy" decoding="async" />
          <picture class="lp-pic">
            <source
              media="(max-width: 767px)"
              type="image/avif"
              srcset="{av_green_membaca_455_avif} 455w, {av_green_membaca_520_avif} 520w"
              sizes="260px"
            />
            <img
              class="lp110"
              src={g160b36a}
              alt=""
              width="260"
              height="284"
              loading="lazy"
              decoding="async"
            />
          </picture>
          <div class="lp123">
            <img
              class="lp112"
              src="/pen/i-98854d62d2.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <div class="lp124">Kehilangan keluarga</div>
          </div>
        </div>
        <div class="n-card-body lp114">
          <div class="lp115">Akta kematian, pembaruan KK, hingga klaim dan ahli waris, pelan-pelan.</div>
          <form class="lp52" method="POST" action="/?/mulai">
            <input type="hidden" name="peristiwa" value="kematian" />
            <button class="lp116" type="submit">
              <span class="lp59"> Mulai urus </span>
            </button>
            <a class="lp117" href={resolve('/peristiwa/[slug]', { slug: 'kematian' })}>
              <span class="lp118"> Pelajari </span>
              <img
                class="lp18"
                src="/pen/i-31c9beecd6.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </a>
          </form>
        </div>
      </div>
      <div class="lp108">
        <div class="lp109" aria-hidden="true">
          <img class="lp68" src={g6714886} alt="" width="333" height="196" loading="lazy" decoding="async" />
          <picture class="lp-pic">
            <source
              media="(max-width: 767px)"
              type="image/avif"
              srcset="{av_amber_berdiri_455_avif} 455w, {av_amber_berdiri_520_avif} 520w"
              sizes="260px"
            />
            <img
              class="lp110"
              src={g60d4976}
              alt=""
              width="260"
              height="284"
              loading="lazy"
              decoding="async"
            />
          </picture>
          <div class="lp125">
            <img
              class="lp112"
              src="/pen/i-67114316b9.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <div class="lp126">KTP &amp; dokumen</div>
          </div>
        </div>
        <div class="n-card-body lp114">
          <div class="lp115">KTP hilang, rusak, atau salah data. Tahu harus ke mana dan bawa apa.</div>
          <form class="lp52" method="POST" action="/?/mulai">
            <input type="hidden" name="peristiwa" value="lainnya" />
            <button class="lp116" type="submit">
              <span class="lp59"> Mulai urus </span>
            </button>
            <a class="lp117" href={resolve('/peristiwa/[slug]', { slug: 'lainnya' })}>
              <span class="lp118"> Pelajari </span>
              <img
                class="lp18"
                src="/pen/i-31c9beecd6.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </a>
          </form>
        </div>
      </div>
      <div class="lp108">
        <div class="lp109" aria-hidden="true">
          <img class="lp68" src={g34c86fd} alt="" width="333" height="196" loading="lazy" decoding="async" />
          <img
            class="lp127"
            src={gce73af8}
            alt=""
            width="240"
            height="262"
            loading="lazy"
            decoding="async"
            aria-hidden="true"
          />
          <div class="lp128">
            <img
              class="lp112"
              src="/pen/i-a567a46a1b.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <div class="lp129">Urusan lain</div>
          </div>
        </div>
        <div class="n-card-body lp114">
          <div class="lp115">Ceritakan kebutuhanmu, Urusin cari layanan yang sesuai.</div>
          <div class="lp52">
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
            <a class="lp130" href={targetMulai}>
              <span class="lp59"> Ceritakan </span>
            </a>
            <a class="lp117" href={resolve('/peristiwa/[slug]', { slug: 'lainnya' })}>
              <span class="lp118"> Pelajari </span>
              <img
                class="lp18"
                src="/pen/i-31c9beecd6.svg"
                alt=""
                width="16"
                height="16"
                loading="lazy"
                decoding="async"
              />
            </a>
          </div>
        </div>
      </div>
    </div>
    <a class="lp20" href={resolve('/urusan')}>
      <span class="lp21"> Lihat semua urusan › </span>
    </a>
  </section>
  <section class="lp105">
    <h2 class="n-features-title lp106">Semua yang kamu butuhkan, di satu tempat</h2>
    <div class="n-feature-row lp107">
      <div class="lp131">
        <div class="n-visual lp132" aria-hidden="true">
          <img class="lp68" src={g17d724d} alt="" width="510" height="300" loading="lazy" decoding="async" />
          <div class="lp133">
            <div class="lp52">
              <img
                class="lp134"
                src={g71ee866}
                srcset="{g71ee866} 34w, {g8430cc2} 44w, {gb2f0431} 68w"
                sizes="(max-width: 767px) 24px, 34px"
                alt=""
                width="34"
                height="34"
                loading="lazy"
                decoding="async"
              />
              <div class="lp135">
                <div class="lp136">Selamat datang lagi, Sari</div>
                <div class="lp137">Kelahiran anak · kemarin 19.40</div>
              </div>
            </div>
            <div class="lp138">
              <div class="lp139"></div>
              <div class="lp139"></div>
              <div class="lp140"></div>
              <div class="lp141"></div>
            </div>
            <div class="lp142">Berikutnya: foto ulang Kartu Keluarga</div>
            <div class="lp11">
              <div class="lp143">Lanjutkan</div>
            </div>
          </div>
          <img
            class="lp144"
            src={g5535a9a}
            srcset="{g5535a9a} 120w, {ge675d89} 155w, {g1a6f689} 240w"
            sizes="(max-width: 767px) 84px, 120px"
            alt=""
            width="120"
            height="131"
            loading="lazy"
            decoding="async"
            aria-hidden="true"
          />
        </div>
        <div class="n-feature-text lp145">
          <h3 class="lp146">Ingat posisi terakhir</h3>
          <div class="lp147">
            Berhenti kapan saja. Saat kembali, Urusin langsung tahu kamu sampai di langkah mana.
          </div>
        </div>
      </div>
      <div class="lp131">
        <div class="n-visual lp148" aria-hidden="true">
          <img class="lp68" src={gc6bba96} alt="" width="510" height="300" loading="lazy" decoding="async" />
          <img
            class="lp149"
            src={gb318a68}
            srcset="{gb318a68} 86w, {gbb409f7} 111w, {g864458f} 172w"
            sizes="(max-width: 767px) 60px, 86px"
            alt=""
            width="86"
            height="86"
            loading="lazy"
            decoding="async"
          />
          <div class="lp150">
            <div class="lp102">
              <div class="lp151">
                <img
                  class="lp112"
                  src="/pen/i-0bdb1cf630.svg"
                  alt=""
                  width="15"
                  height="15"
                  loading="lazy"
                  decoding="async"
                />
                <div class="n-title lp152">Kartu Keluarga</div>
              </div>
              <div class="lp153">
                <img
                  class="lp35"
                  src="/pen/i-bda2d7dc68.svg"
                  alt=""
                  width="13"
                  height="13"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp154">Perlu diulang</div>
              </div>
            </div>
            <div class="lp155">
              <div class="lp156">
                <div class="lp157"></div>
                <div class="lp158"></div>
                <div class="lp159"></div>
                <div class="lp160"></div>
                <div class="lp161"></div>
                <div class="lp162"></div>
              </div>
              <div class="lp163"></div>
              <div class="lp164"></div>
              <div class="lp165">
                <img
                  class="lp166"
                  src="/pen/i-4482951e1d.svg"
                  alt=""
                  width="10"
                  height="10"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp167">Buram</div>
              </div>
            </div>
            <div class="lp168">
              <div class="lp151">
                <img
                  class="lp41"
                  src="/pen/i-ef5f2be286.svg"
                  alt=""
                  width="14"
                  height="14"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp169">Teks terbaca jelas</div>
              </div>
              <div class="lp151">
                <img
                  class="lp41"
                  src="/pen/i-ef5f2be286.svg"
                  alt=""
                  width="14"
                  height="14"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp169">Tidak ada pantulan cahaya</div>
              </div>
              <div class="lp151">
                <img
                  class="lp41"
                  src="/pen/i-44a20d02a6.svg"
                  alt=""
                  width="14"
                  height="14"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp170">Sudut kanan bawah buram</div>
              </div>
            </div>
            <div class="lp171">
              <img
                class="lp35"
                src="/pen/i-dd83f24a8d.svg"
                alt=""
                width="13"
                height="13"
                loading="lazy"
                decoding="async"
              />
              <div class="lp172">Foto ulang di tempat terang</div>
            </div>
          </div>
          <img
            class="lp173"
            src={g913cf8d}
            srcset="{g913cf8d} 196w, {gfa97bc8} 253w, {gdb2c70e} 392w"
            sizes="(max-width: 767px) 137px, 196px"
            alt=""
            width="196"
            height="214"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="n-feature-text lp145">
          <h3 class="lp146">Periksa foto dokumen</h3>
          <div class="lp147">
            Foto atau pindaian yang kamu unggah diperiksa dulu. Kalau buram, Urusin bilang bagian mana yang
            perlu diulang.
          </div>
        </div>
      </div>
    </div>
    <div class="n-feature-row lp107">
      <div class="lp131">
        <div class="n-visual lp174" aria-hidden="true">
          <img class="lp68" src={g8f42574} alt="" width="510" height="300" loading="lazy" decoding="async" />
          <div class="lp175">
            <div class="lp4">
              <img
                class="lp176"
                src={g55819b7}
                srcset="{g55819b7} 18w, {g4157769} 23w, {g2244bcf} 36w"
                sizes="(max-width: 767px) 13px, 18px"
                alt=""
                width="18"
                height="18"
                loading="lazy"
                decoding="async"
              />
              <div class="lp136">Izinkan Urusin mengisi 3 kolom?</div>
            </div>
            <div class="lp177">
              <div class="n-row lp178">
                <img
                  class="lp35"
                  src="/pen/i-8e8d6fd3ef.svg"
                  alt=""
                  width="13"
                  height="13"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp179">Nama ayah</div>
              </div>
              <div class="n-row lp178">
                <img
                  class="lp35"
                  src="/pen/i-8e8d6fd3ef.svg"
                  alt=""
                  width="13"
                  height="13"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp179">Nama ibu</div>
              </div>
              <div class="n-row lp178">
                <img
                  class="lp35"
                  src="/pen/i-8e8d6fd3ef.svg"
                  alt=""
                  width="13"
                  height="13"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp179">Alamat</div>
              </div>
            </div>
            <div class="lp180">OTP dan tombol Kirim tetap kamu yang tekan.</div>
            <div class="lp181">
              <div class="lp11">
                <div class="lp143">Izinkan</div>
              </div>
              <div class="lp182">
                <div class="lp183">Nanti</div>
              </div>
            </div>
          </div>
          <img
            class="lp184"
            src={g2daaa24}
            srcset="{g2daaa24} 150w, {g562edfa} 194w, {gc740f3c} 300w"
            sizes="(max-width: 767px) 105px, 150px"
            alt=""
            width="150"
            height="164"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="n-feature-text lp145">
          <h3 class="lp146">Bantu isi formulir</h3>
          <div class="lp147">
            Situs resmi dibuka di Browser Pendamping, lalu AI mengisi dengan izinmu. Login, OTP, dan Kirim
            tetap kamu. Kini aktif di {page.data.jumlahDaerahPendamping} kota/kabupaten; daerah lain dipandu langkah
            demi langkah.
          </div>
        </div>
      </div>
      <div class="lp131">
        <div class="n-visual lp185" aria-hidden="true">
          <img class="lp68" src={g298eb08} alt="" width="510" height="300" loading="lazy" decoding="async" />
          <div class="n-answer lp186">
            <div class="lp187">
              Untuk pindah antar-kelurahan, kamu perlu surat pengantar RT/RW. Dalam satu kelurahan, tidak
              perlu.
            </div>
            <div class="lp188">
              <img
                class="lp112"
                src="/pen/i-373acc4372.svg"
                alt=""
                width="15"
                height="15"
                loading="lazy"
                decoding="async"
              />
              <div class="lp189">
                <div class="lp152">Syarat pindah datang</div>
                <div class="lp190">telunjuksakti.wonogirikab.go.id</div>
              </div>
              <img
                class="lp35"
                src="/pen/i-0f426471fc.svg"
                alt=""
                width="13"
                height="13"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div class="lp188">
              <img
                class="lp112"
                src="/pen/i-373acc4372.svg"
                alt=""
                width="15"
                height="15"
                loading="lazy"
                decoding="async"
              />
              <div class="lp189">
                <div class="lp152">Peraturan Bupati Wonogiri</div>
                <div class="lp190">jdih.wonogirikab.go.id</div>
              </div>
              <img
                class="lp35"
                src="/pen/i-0f426471fc.svg"
                alt=""
                width="13"
                height="13"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
          <img
            class="lp191"
            src={g7d656cd}
            srcset="{g7d656cd} 132w, {gfa81d5b} 170w, {g8eb5f6d} 264w"
            sizes="(max-width: 767px) 92px, 132px"
            alt=""
            width="132"
            height="144"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="n-feature-text lp145">
          <h3 class="lp146">Selalu ada rujukan</h3>
          <div class="lp147">
            Setiap penjelasan penting punya sumber resmi yang bisa kamu periksa sendiri.
          </div>
        </div>
      </div>
    </div>
  </section>
  <section class="n-get-started lp192" id="cara-kerja">
    <div class="n-heading lp193">
      <h2 class="n-title lp106">Mulai dalam hitungan menit</h2>
      <div class="n-sub lp194">Gratis, tanpa daftar panjang, dan tidak perlu paham istilah dulu.</div>
    </div>
    <div class="n-columns lp107">
      <div class="lp195">
        <div class="n-visual lp196" aria-hidden="true">
          <img class="lp68" src={g49a4260} alt="" width="310" height="228" loading="lazy" decoding="async" />
          <div class="lp197">
            <div class="lp198">
              <img
                class="lp199"
                src={g206ec4b}
                alt=""
                width="28"
                height="28"
                loading="lazy"
                decoding="async"
              />
              <div class="lp200">“Bulan depan saya pindah ke Solo”</div>
            </div>
            <div class="n-row lp102">
              <div class="lp201">
                <img
                  class="lp35"
                  src="/pen/i-da41230a3f.svg"
                  alt=""
                  width="13"
                  height="13"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp202">Bicara saja</div>
              </div>
              <div class="lp203">
                <img
                  class="lp41"
                  src="/pen/i-da462863e2.svg"
                  alt=""
                  width="14"
                  height="14"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
        <div class="n-text lp204">
          <div class="lp4">
            <div class="lp205">
              <div class="lp206">1</div>
            </div>
            <div class="lp207">Langkah 1</div>
          </div>
          <h3 class="n-title lp208">Ceritakan kebutuhan</h3>
          <div class="lp209">Tulis atau ucapkan apa yang terjadi dengan bahasa sehari-hari.</div>
        </div>
      </div>
      <div class="lp195">
        <div class="n-visual lp210" aria-hidden="true">
          <img class="lp68" src={g9ab00c1} alt="" width="310" height="228" loading="lazy" decoding="async" />
          <div class="lp211">
            <div class="lp52">
              <div class="lp212">
                <img
                  class="lp112"
                  src="/pen/i-6aabcf9217.svg"
                  alt=""
                  width="15"
                  height="15"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div class="lp213">KTP</div>
            </div>
            <div class="lp214">
              <img
                class="lp35"
                src="/pen/i-bb8e016b9b.svg"
                alt=""
                width="13"
                height="13"
                loading="lazy"
                decoding="async"
              />
              <div class="lp215">Siap</div>
            </div>
          </div>
          <div class="lp211">
            <div class="lp52">
              <div class="lp212">
                <img
                  class="lp112"
                  src="/pen/i-03c61b7ca6.svg"
                  alt=""
                  width="15"
                  height="15"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div class="lp213">Kartu Keluarga</div>
            </div>
            <div class="lp214">
              <img
                class="lp35"
                src="/pen/i-bb8e016b9b.svg"
                alt=""
                width="13"
                height="13"
                loading="lazy"
                decoding="async"
              />
              <div class="lp215">Siap</div>
            </div>
          </div>
          <div class="lp211">
            <div class="lp52">
              <div class="lp212">
                <img
                  class="lp112"
                  src="/pen/i-a094298814.svg"
                  alt=""
                  width="15"
                  height="15"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div class="lp213">Surat lahir RS</div>
            </div>
            <div class="lp153">
              <img
                class="lp35"
                src="/pen/i-bda2d7dc68.svg"
                alt=""
                width="13"
                height="13"
                loading="lazy"
                decoding="async"
              />
              <div class="lp154">Perlu diulang</div>
            </div>
          </div>
        </div>
        <div class="n-text lp204">
          <div class="lp4">
            <div class="lp205">
              <div class="lp206">2</div>
            </div>
            <div class="lp207">Langkah 2</div>
          </div>
          <h3 class="n-title lp208">Siapkan dokumen</h3>
          <div class="lp209">Urusin menyusun daftarnya dan memeriksa fotomu sebelum dikirim.</div>
        </div>
      </div>
      <div class="lp195">
        <div class="n-visual lp216" aria-hidden="true">
          <img class="lp68" src={g40ad979} alt="" width="380" height="228" loading="lazy" decoding="async" />
          <img class="lp217" src={ga0cfe92} alt="" width="112" height="122" loading="lazy" decoding="async" />
          <img class="lp218" src={g1a14d28} alt="" width="140" height="153" loading="lazy" decoding="async" />
          <img class="lp217" src={gef0380a} alt="" width="112" height="122" loading="lazy" decoding="async" />
        </div>
        <div class="n-text lp204">
          <div class="lp4">
            <div class="lp205">
              <div class="lp206">3</div>
            </div>
            <div class="lp207">Langkah 3</div>
          </div>
          <h3 class="n-title lp208">Temui pendampingmu</h3>
          <div class="lp209">Pilih teman yang paling cocok. Semua bisa kamu ganti kapan saja.</div>
        </div>
      </div>
    </div>
  </section>
  <section class="n-comparison lp219">
    <img class="lp68" src={gdd90def} alt="" width="1440" height="827" loading="lazy" decoding="async" />
    <div class="lp220" aria-hidden="true"></div>
    <h2 class="n-title lp221">Mengurus sendiri vs. bersama Urusin</h2>
    <div class="n-columns lp222">
      <div class="lp223">
        <div class="lp224">
          <div class="lp7" aria-hidden="true">
            <div class="lp225">
              <img
                class="lp103"
                src="/pen/i-5387bdd3af.svg"
                alt=""
                width="18"
                height="18"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div class="lp225">
              <img
                class="lp103"
                src="/pen/i-4287bddda1.svg"
                alt=""
                width="18"
                height="18"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div class="lp225">
              <img
                class="lp103"
                src="/pen/i-cf459ed524.svg"
                alt=""
                width="18"
                height="18"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
          <div class="lp226">Mengurus sendiri</div>
        </div>
        <div class="n-visual lp227" aria-hidden="true">
          <div class="lp228">
            <div class="lp229">
              <div class="lp230"></div>
              <div class="lp231"></div>
              <div class="lp232"></div>
              <div class="lp233">Syarat akta kelahiran</div>
            </div>
            <div class="lp234">
              <div class="lp235"></div>
              <div class="lp236"></div>
              <div class="lp237"></div>
            </div>
          </div>
          <div class="lp238">
            <div class="lp229">
              <div class="lp230"></div>
              <div class="lp231"></div>
              <div class="lp232"></div>
              <div class="lp233">Grup WA keluarga</div>
            </div>
            <div class="lp234">
              <div class="lp235"></div>
              <div class="lp236"></div>
              <div class="lp237"></div>
            </div>
          </div>
          <div class="lp239">
            <div class="lp229">
              <div class="lp230"></div>
              <div class="lp231"></div>
              <div class="lp232"></div>
              <div class="lp233">Form error 404</div>
            </div>
            <div class="lp234">
              <div class="lp235"></div>
              <div class="lp236"></div>
              <div class="lp237"></div>
            </div>
          </div>
          <img
            class="lp240"
            src={gb11bdb2}
            srcset="{gb11bdb2} 150w, {g5314d32} 194w, {gf217c61} 300w"
            sizes="(max-width: 767px) 105px, 150px"
            alt=""
            width="150"
            height="164"
            loading="lazy"
            decoding="async"
            aria-hidden="true"
          />
        </div>
        <div class="n-list lp241">
          <div class="lp52">
            <img
              class="lp103"
              src="/pen/i-59e9570f8c.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <div class="lp242">Cari syarat di banyak situs</div>
          </div>
          <div class="lp52">
            <img
              class="lp103"
              src="/pen/i-59e9570f8c.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <div class="lp242">Istilah yang membingungkan</div>
          </div>
          <div class="lp52">
            <img
              class="lp103"
              src="/pen/i-59e9570f8c.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <div class="lp242">Bolak-balik karena berkas ditolak</div>
          </div>
        </div>
      </div>
      <div class="lp223">
        <div class="lp224">
          <div class="lp225">
            <img class="lp243" src={g4e6702c} alt="" width="22" height="22" loading="lazy" decoding="async" />
          </div>
          <div class="lp226">Bersama Urusin</div>
        </div>
        <div class="n-visual lp227" aria-hidden="true">
          <div class="lp244" aria-hidden="true">
            <div class="lp245">Langkahmu · Kelahiran anak</div>
            <div class="n-row lp246">
              <div class="lp4">
                <img
                  class="lp41"
                  src="/pen/i-857b9f9488.svg"
                  alt=""
                  width="14"
                  height="14"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp247">Akta kelahiran</div>
              </div>
              <div class="lp248">Siap diajukan</div>
            </div>
            <div class="n-row lp246">
              <div class="lp4">
                <img
                  class="lp41"
                  src="/pen/i-26cdb7e810.svg"
                  alt=""
                  width="14"
                  height="14"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp247">Perbarui KK</div>
              </div>
              <div class="lp249">Menyusul</div>
            </div>
            <div class="n-row lp246">
              <div class="lp4">
                <img
                  class="lp41"
                  src="/pen/i-26cdb7e810.svg"
                  alt=""
                  width="14"
                  height="14"
                  loading="lazy"
                  decoding="async"
                />
                <div class="lp247">BPJS anak</div>
              </div>
              <div class="lp249">Menyusul</div>
            </div>
          </div>
          <img
            class="lp250"
            src={g1ab60a9}
            srcset="{g1ab60a9} 130w, {g153fc93} 168w, {g4405d37} 260w"
            sizes="(max-width: 767px) 91px, 130px"
            alt=""
            width="130"
            height="142"
            loading="lazy"
            decoding="async"
            aria-hidden="true"
          />
        </div>
        <div class="n-list lp241">
          <div class="lp52">
            <img
              class="lp103"
              src="/pen/i-c42212c9bd.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <div class="lp242">Satu daftar langkah dari sumber resmi</div>
          </div>
          <div class="lp52">
            <img
              class="lp103"
              src="/pen/i-c42212c9bd.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <div class="lp242">Dijelaskan dengan bahasa sehari-hari</div>
          </div>
          <div class="lp52">
            <img
              class="lp103"
              src="/pen/i-c42212c9bd.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <div class="lp242">Dokumen diperiksa sebelum dikirim</div>
          </div>
        </div>
      </div>
    </div>
  </section>
  <section class="n-safety lp251" id="privasi">
    <div class="n-safety-intro lp252">
      <h2 class="n-title lp253">Kamu tetap pegang kendali atas datamu</h2>
      <a class="lp17" href="#privasi">
        <img
          class="lp18"
          src="/pen/i-ba534aa545.svg"
          alt=""
          width="16"
          height="16"
          loading="lazy"
          decoding="async"
        />
        <span class="lp19"> Pelajari privasi </span>
      </a>
      <img
        class="lp254"
        src={g74850df}
        alt=""
        width="180"
        height="180"
        loading="lazy"
        decoding="async"
        aria-hidden="true"
      />
    </div>
    <div class="n-safety-grid lp255">
      <div class="n-row lp256">
        <div class="lp257">
          <div class="lp258">
            <img
              class="lp259"
              src="/pen/i-7231871866.svg"
              alt=""
              width="17"
              height="17"
              loading="lazy"
              decoding="async"
            />
          </div>
          <h3 class="lp260">Kamu yang memutuskan</h3>
          <div class="lp261">AI baru bekerja setelah kamu setuju. Login dan Kirim selalu kamu.</div>
        </div>
        <div class="lp257">
          <div class="lp258">
            <img
              class="lp259"
              src="/pen/i-ebf0afb648.svg"
              alt=""
              width="17"
              height="17"
              loading="lazy"
              decoding="async"
            />
          </div>
          <h3 class="lp260">Data diri di brankas</h3>
          <div class="lp261">
            NIK dan data pribadi disimpan terenkripsi. AI tidak pernah melihat angka aslinya.
          </div>
        </div>
      </div>
      <div class="n-row lp256">
        <div class="lp257">
          <div class="lp258">
            <img
              class="lp259"
              src="/pen/i-f27c7dfd64.svg"
              alt=""
              width="17"
              height="17"
              loading="lazy"
              decoding="async"
            />
          </div>
          <h3 class="lp260">Jejak bisa ditelusuri</h3>
          <div class="lp261">
            Setiap langkah tercatat dengan rantai hash, jadi tidak bisa diubah diam-diam.
          </div>
        </div>
        <div class="lp257">
          <div class="lp258">
            <img
              class="lp259"
              src="/pen/i-8f53350b7c.svg"
              alt=""
              width="17"
              height="17"
              loading="lazy"
              decoding="async"
            />
          </div>
          <h3 class="lp260">Hapus kapan saja</h3>
          <div class="lp261">Datamu milikmu. Hapus semuanya dengan satu tombol.</div>
        </div>
      </div>
    </div>
  </section>
  <section class="n-faq lp262" id="tanya-jawab">
    <img class="lp68" src={ge4af363} alt="" width="1440" height="1004" loading="lazy" decoding="async" />
    <div class="n-heading lp263">
      <h2 class="n-title lp106">Pertanyaan yang sering diajukan</h2>
      <div class="n-sub lp194">Masih ragu? Tanya saja, kami senang mendengarnya.</div>
      <div class="lp57">
        <a class="lp58" href={resolve('/bantuan')}>
          <span class="lp59"> Hubungi kami </span>
        </a>
        <a class="lp20" href="#cara-kerja">
          <span class="lp21"> Lihat cara kerja </span>
        </a>
      </div>
    </div>
    <div class="n-bubbles lp264">
      <details class="n-faq-item" name="faq" open>
        <summary class="lp265">
          <div class="lp266">
            <span class="lp267">Apakah Urusin bagian dari pemerintah?</span>
          </div>
          <img
            class="lp268"
            src="/pen/i-6c52db901b.svg"
            alt=""
            width="18"
            height="14"
            loading="lazy"
            decoding="async"
          />
        </summary>
        <div class="n-answer-row lp269">
          <div class="n-answer lp270">
            <div class="lp271">
              Bukan. Urusin membantumu memahami dan menyiapkan urusan. Keputusan layanan tetap di instansi
              terkait.
            </div>
          </div>
        </div>
      </details>
      <details class="n-faq-item" name="faq">
        <summary class="lp265">
          <div class="lp266">
            <span class="lp267">Apakah data saya aman?</span>
          </div>
          <img
            class="lp268"
            src="/pen/i-6c52db901b.svg"
            alt=""
            width="18"
            height="14"
            loading="lazy"
            decoding="async"
          />
        </summary>
        <div class="n-answer-row lp269">
          <div class="n-answer lp270">
            <div class="lp271">
              Aman. Data dan berkasmu disimpan terenkripsi di server per akun. Model AI tidak pernah menerima
              data identitas asli (NIK, KK, nama), dan data tamu terhapus otomatis setelah 72 jam.
            </div>
          </div>
        </div>
      </details>
      <details class="n-faq-item" name="faq">
        <summary class="lp265">
          <div class="lp266">
            <span class="lp267">Bisa dipakai untuk mengurus orang tua saya?</span>
          </div>
          <img
            class="lp268"
            src="/pen/i-6c52db901b.svg"
            alt=""
            width="18"
            height="14"
            loading="lazy"
            decoding="async"
          />
        </summary>
        <div class="n-answer-row lp269">
          <div class="n-answer lp270">
            <div class="lp271">
              Bisa. Kamu bisa mendampingi orang tua atau anggota keluarga lain untuk menyiapkan syarat,
              mengunggah berkas, dan memandu pengisian di situs resmi.
            </div>
          </div>
        </div>
      </details>
      <details class="n-faq-item" name="faq">
        <summary class="lp265">
          <div class="lp266">
            <span class="lp267">Apakah AI bisa mengirim formulir sendiri?</span>
          </div>
          <img
            class="lp268"
            src="/pen/i-6c52db901b.svg"
            alt=""
            width="18"
            height="14"
            loading="lazy"
            decoding="async"
          />
        </summary>
        <div class="n-answer-row lp269">
          <div class="n-answer lp270">
            <div class="lp271">
              Tidak. AI hanya mengisi kolom yang sudah kamu setujui di Browser Pendamping. Login, CAPTCHA,
              OTP, dan tombol Kirim akhir selalu dikerjakan oleh kamu sendiri.
            </div>
          </div>
        </div>
      </details>
      <details class="n-faq-item" name="faq">
        <summary class="lp265">
          <div class="lp266">
            <span class="lp267">Bagaimana kalau informasinya sudah berubah?</span>
          </div>
          <img
            class="lp268"
            src="/pen/i-6c52db901b.svg"
            alt=""
            width="18"
            height="14"
            loading="lazy"
            decoding="async"
          />
        </summary>
        <div class="n-answer-row lp269">
          <div class="n-answer lp270">
            <div class="lp271">
              Urusin membaca syarat langsung dari regulasi dan portal resmi daerah yang dilengkapi tanggal
              verifikasi. Bila ada perubahan atau situs belum didukung, Urusin akan memberi tahu dan beralih
              ke mode dipandu.
            </div>
          </div>
        </div>
      </details>
      <details class="n-faq-item" name="faq">
        <summary class="lp265">
          <div class="lp266">
            <span class="lp267">Berapa biayanya?</span>
          </div>
          <img
            class="lp268"
            src="/pen/i-6c52db901b.svg"
            alt=""
            width="18"
            height="14"
            loading="lazy"
            decoding="async"
          />
        </summary>
        <div class="n-answer-row lp269">
          <div class="n-answer lp270">
            <div class="lp271">
              Gratis. Seluruh layanan Urusin tidak dipungut biaya. Layanan adminduk di Disdukcapil menurut
              Undang-Undang juga gratis; jika ada biaya resmi (mis. leges/materai), dibayarkan langsung ke
              instansi.
            </div>
          </div>
        </div>
      </details>
    </div>
    <img
      class="n-faq-companion lp272"
      src={gd65804a}
      alt=""
      width="190"
      height="207"
      loading="lazy"
      decoding="async"
      aria-hidden="true"
    />
    <img
      class="n-faq-companion lp273"
      src={g327a44d}
      alt=""
      width="170"
      height="185"
      loading="lazy"
      decoding="async"
      aria-hidden="true"
    />
  </section>
  <section class="lp274">
    <div class="n-cta-panel lp275">
      <img class="lp68" src={g749e4e0} alt="" width="1040" height="432" loading="lazy" decoding="async" />
      <div class="n-copy lp276">
        <div class="lp277">
          <div class="lp278" aria-hidden="true">
            <img class="lp279" src={g2c85a08} alt="" width="20" height="20" loading="lazy" decoding="async" />
            <img class="lp280" src={g04267bc} alt="" width="20" height="20" loading="lazy" decoding="async" />
            <img class="lp281" src={g226f431} alt="" width="20" height="20" loading="lazy" decoding="async" />
            <img class="lp282" src={g4ee3cad} alt="" width="20" height="20" loading="lazy" decoding="async" />
            <img class="lp283" src={gb908ec2} alt="" width="20" height="20" loading="lazy" decoding="async" />
          </div>
          <div class="lp202">5 pendamping siap menemani</div>
        </div>
        <h2 class="n-title lp284">
          Urusan berikutnya,
          <br />
          kita kerjakan bareng
        </h2>
        <div class="n-sub lp285">
          Gratis dan langsung dari browser. Ceritakan apa yang terjadi, Urusin yang menyusun langkahnya.
        </div>
        <div class="lp52">
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a class="lp17" href={targetMulai}>
            <img
              class="lp18"
              src="/pen/i-25435a991f.svg"
              alt=""
              width="16"
              height="16"
              loading="lazy"
              decoding="async"
            />
            <span class="lp19"> Mulai urusan </span>
          </a>
          <a class="lp20" href="#cara-kerja">
            <span class="lp21"> Lihat cara kerja </span>
          </a>
        </div>
        <div class="lp286">
          <div class="lp33">
            <img
              class="lp41"
              src="/pen/i-31ecdd3e32.svg"
              alt=""
              width="14"
              height="14"
              loading="lazy"
              decoding="async"
            />
            <div class="lp287">Gratis</div>
          </div>
          <div class="lp33">
            <img
              class="lp41"
              src="/pen/i-f41375c716.svg"
              alt=""
              width="14"
              height="14"
              loading="lazy"
              decoding="async"
            />
            <div class="lp287">Data tetap milikmu</div>
          </div>
          <div class="lp33">
            <img
              class="lp41"
              src="/pen/i-625ab0b340.svg"
              alt=""
              width="14"
              height="14"
              loading="lazy"
              decoding="async"
            />
            <div class="lp287">Kamu yang kirim</div>
          </div>
        </div>
      </div>
      <div class="n-companions lp288" aria-hidden="true">
        <img
          class="lp289"
          src={g5df4311}
          srcset="{g5df4311} 183w, {gc3800a9} 210w, {g1e40549} 366w"
          sizes="(max-width: 767px) 113px, 183px"
          alt=""
          width="183"
          height="200"
          loading="lazy"
          decoding="async"
        />
        <img
          class="lp290"
          src={g319aa42}
          srcset="{g319aa42} 183w, {g6471807} 210w, {g1b1d18c} 366w"
          sizes="(max-width: 767px) 113px, 183px"
          alt=""
          width="183"
          height="200"
          loading="lazy"
          decoding="async"
        />
        <img
          class="lp291"
          src={ga314e66}
          srcset="{ga314e66} 202w, {g862a916} 232w, {g06c0f97} 403w"
          sizes="(max-width: 767px) 125px, 202px"
          alt=""
          width="202"
          height="220"
          loading="lazy"
          decoding="async"
        />
        <img
          class="lp292"
          src={gb1fc54d}
          srcset="{gb1fc54d} 202w, {g85cbc60} 232w, {gfeb950a} 403w"
          sizes="(max-width: 767px) 125px, 202px"
          alt=""
          width="202"
          height="220"
          loading="lazy"
          decoding="async"
        />
        <img
          class="lp293"
          src={g9a245f0}
          srcset="{g9a245f0} 202w, {g1e18890} 232w, {g1d1b55c} 403w"
          sizes="(max-width: 767px) 125px, 202px"
          alt=""
          width="202"
          height="220"
          loading="lazy"
          decoding="async"
        />
        <div class="lp294">
          <div class="lp213">Mau urus apa hari ini?</div>
        </div>
      </div>
    </div>
  </section>
  <LandingFooter diLanding />
</main>
