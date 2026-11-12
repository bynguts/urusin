<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import ContohPercakapan from '#lib/components/landing/ContohPercakapan.svelte';
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
  import g71ee866 from '#lib/assets/img/pen-landing/rose-34.webp';
  import gb2f0431 from '#lib/assets/img/pen-landing/rose-68.webp';
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
  const targetMulai = $derived(page.data.akun ? resolve('/beranda') : resolve('/daftar'));
  /** Galat tombol "Mulai urus" (/?/mulai), mis. batas laju dengan waktu tunggu nyata. */
  const galatMulai = $derived((page.form as { pesanWarga?: string; kode?: string } | null)?.pesanWarga);
</script>

<svelte:head>
  <title>Urusin: pendamping layanan publik</title>
  <meta
    name="description"
    content="Urusin membantu Anda memahami persyaratan dan menyiapkan langkah pengurusan sesuai wilayah, dengan rujukan yang bisa diperiksa."
  />
</svelte:head>

<main class="lp0 lp" id="konten">
  {#if galatMulai}
    <p
      role="alert"
      data-kode={(page.form as { kode?: string } | null)?.kode}
      class="mx-auto max-w-3xl rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] font-medium text-galat"
    >
      {galatMulai}
    </p>
  {/if}
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
        Bingung urusan administrasi?
        <br />
        Tanyakan ke Urusin.
      </h1>
      <div class="n-hero-intro lp15">
        Tanyakan urusan administrasi Anda. Urusin membantu mencari persyaratan, menjelaskan sumber resmi, dan
        menyusun langkah sesuai wilayah.
      </div>
      <div class="n-aksi lp16">
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a class="lp17" href={targetMulai}>
          <img class="lp18" src="/pen/i-25435a991f.svg" alt="" width="16" height="16" decoding="async" />
          <span class="lp19"> Mulai percakapan </span>
        </a>
        <a class="lp20" href={resolve('/cara-kerja')}>
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
        <ContohPercakapan />
      </div>
    </div>
  </section>

  <section class="n-companions lp105" id="urusan">
    <h2 class="n-companions-title lp106">Mulai dari kebutuhan Anda</h2>
    <div class="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
      {#each [{ slug: 'kelahiran', nama: 'Kelahiran' }, { slug: 'perkawinan', nama: 'Perkawinan' }, { slug: 'pindah', nama: 'Pindah domisili' }, { slug: 'kematian', nama: 'Kehilangan keluarga' }, { slug: 'lainnya', nama: 'KTP & dokumen' }] as topik (topik.slug)}
        <a
          class="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-4 text-lg font-semibold text-ink"
          href={resolve('/peristiwa/[slug]', { slug: topik.slug })}
          >{topik.nama}<span aria-hidden="true">→</span></a
        >
      {/each}
      <a
        class="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-primer px-5 py-4 text-lg font-semibold text-primer-ink"
        href={resolve('/urusan')}>Semua topik<span aria-hidden="true">→</span></a
      >
    </div>
  </section>
  <section class="lp105">
    <h2 class="n-features-title lp106">Bantuan selama menyiapkan urusan</h2>
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
            <div class="lp142">Percakapan tentang Kartu Keluarga</div>
            <div class="lp11">
              <div class="lp143">Lanjutkan</div>
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
        </div>
        <div class="n-feature-text lp145">
          <h3 class="lp146">Lanjutkan percakapan</h3>
          <div class="lp147">Buka kembali pertanyaan, jawaban, dan rencana pengurusan melalui Urusanku.</div>
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
                <div class="lp154">Tersimpan</div>
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
                <div class="lp167">Berkas</div>
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
                <div class="lp169">Kartu Keluarga</div>
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
                <div class="lp169">Berkas dalam akun Anda</div>
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
                <div class="lp170">Dapat diunduh kembali</div>
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
              <div class="lp172">Kelola di menu Dokumen</div>
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
          <h3 class="lp146">Simpan dokumen di brankas</h3>
          <div class="lp147">
            Kelompokkan berkas keluarga dalam akun Anda. Anda dapat mengunduh atau menghapusnya melalui menu
            Dokumen.
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
              <div class="lp136">Rencana pengurusan</div>
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
                <div class="lp179">Pastikan wilayah</div>
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
                <div class="lp179">Siapkan dokumen</div>
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
                <div class="lp179">Buka kanal resmi</div>
              </div>
            </div>
            <div class="lp180">Contoh langkah untuk Anda tinjau</div>
            <div class="lp181">
              <div class="lp11">
                <div class="lp143">Tinjau rencana</div>
              </div>
              <div class="lp182">
                <div class="lp183">Ubah</div>
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
          <h3 class="lp146">Rencana yang bisa ditinjau</h3>
          <div class="lp147">
            Tinjau urutan langkah dan dokumen yang perlu disiapkan. Tanyakan kembali bagian yang belum jelas
            dalam percakapan yang sama.
          </div>
        </div>
      </div>
      <div class="lp131">
        <div class="n-visual lp185" aria-hidden="true">
          <img class="lp68" src={g298eb08} alt="" width="510" height="300" loading="lazy" decoding="async" />
          <div class="n-answer lp186">
            <div class="lp187">
              Untuk pindah antar-kelurahan, Anda perlu surat pengantar RT/RW. Dalam satu kelurahan, tidak
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
            Buka rujukan pada jawaban untuk memeriksa persyaratan dan informasi yang digunakan.
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="n-safety lp251" id="privasi">
    <div class="n-heading lp193">
      <h2 class="n-title lp253">Tentukan data yang Anda simpan</h2>
      <p class="lp254">Pelajari penyimpanan percakapan, brankas dokumen, dan pilihan untuk menghapus data.</p>
      <a class="lp20" href={resolve('/privasi')}>Baca kebijakan privasi</a>
    </div>
  </section>
  <section class="n-faq lp262" id="tanya-jawab">
    <div class="n-heading lp193"><h2 class="n-title lp106">Ingin mengenal Urusin lebih dulu?</h2></div>
    <div class="flex flex-wrap gap-4">
      <a class="lp20" href={resolve('/cara-kerja')}>Pelajari alur penggunaan</a>
      <a class="lp20" href={resolve('/tanya-jawab')}>Baca tanya jawab</a>
    </div>
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
          <div class="lp202">Pendamping layanan publik</div>
        </div>
        <h2 class="n-title lp284">
          Ada yang ingin ditanyakan?
          <br />
          Mulai dari satu pertanyaan.
        </h2>
        <div class="n-sub lp285">Masuk ke akun Anda dan ceritakan kebutuhan pengurusan.</div>
        <div class="n-aksi lp52">
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
            <span class="lp19"> Mulai percakapan </span>
          </a>
          <a class="lp20" href={resolve('/cara-kerja')}>
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
            <div class="lp287">Data tetap milik Anda</div>
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
            <div class="lp287">Pengajuan melalui kanal resmi</div>
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
        <div class="n-balon lp294">
          <div class="lp213">Apa yang ingin Anda tanyakan?</div>
        </div>
      </div>
    </div>
  </section>
  <LandingFooter />
</main>
