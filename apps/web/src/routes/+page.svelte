<script lang="ts">
  import { resolve } from '$app/paths';
  import Icon from '#lib/components/Icon.svelte';
  import type { NamaIkon } from '#lib/components/ikon.js';
  import trio380 from '#lib/assets/img/landing/trio-380.webp';
  import trio760 from '#lib/assets/img/landing/trio-760.webp';
  import anak640 from '#lib/assets/img/landing/anak-640.webp';
  import anak1000 from '#lib/assets/img/landing/anak-1000.webp';
  import pindah640 from '#lib/assets/img/landing/pindah-640.webp';
  import pindah1000 from '#lib/assets/img/landing/pindah-1000.webp';
  import menikah640 from '#lib/assets/img/landing/menikah-640.webp';
  import menikah1000 from '#lib/assets/img/landing/menikah-1000.webp';
  import kehilangan640 from '#lib/assets/img/landing/kehilangan-640.webp';
  import kehilangan1000 from '#lib/assets/img/landing/kehilangan-1000.webp';

  /** Landing Urusin (frame zTE2p/hYJzT, dark dP5NC/Qq8tK). Semua ajakan masuk ke alur urusan yang sudah ada. */

  let menuBuka = $state(false);

  const DAERAH = [
    { nama: 'Bandung', kode: '3273' },
    { nama: 'Jakarta', kode: '3171' },
    { nama: 'Surabaya', kode: '3578' },
    { nama: 'Daerah lainnya', kode: '' },
  ] as const;
  let daerah = $state(0);
  const tujuan = $derived(DAERAH[daerah]?.kode ? `ke ${DAERAH[daerah].nama}` : 'ke kota lain');
  const kalimat = $derived(`Saya mau pindah ${tujuan} bersama keluarga.`);
  const cerita = $derived(`${kalimat} Apa yang harus disiapkan?`);

  const LANGKAH_CONTOH = [
    { judul: 'Kenali kebutuhan', ket: 'Tentukan layanan yang sesuai' },
    { judul: 'Siapkan dokumen', ket: 'Cek kelengkapan dan kualitas foto' },
    { judul: 'Lanjut ke situs resmi', ket: 'Tinjau langkah sebelum memberi izin' },
  ];
  const PERSIAPAN = [
    { judul: 'Surat kelahiran', status: 'Foto siap' },
    { judul: 'Kartu Keluarga', status: 'Perlu foto ulang' },
    { judul: 'Identitas orang tua', status: 'Belum ditambahkan' },
  ];
  const CERITA = [
    {
      slug: 'kelahiran',
      judul: 'Baru punya anak',
      ket: 'Mulai kebutuhan keluarga',
      tint: 'bg-mawar',
      kecil: anak640,
      besar: anak1000,
    },
    {
      slug: 'pindah',
      judul: 'Pindah tempat tinggal',
      ket: 'Siapkan perpindahan',
      tint: 'bg-daun',
      kecil: pindah640,
      besar: pindah1000,
    },
    {
      slug: 'perkawinan',
      judul: 'Menikah',
      ket: 'Urus perubahan data',
      tint: 'bg-biru',
      kecil: menikah640,
      besar: menikah1000,
    },
    {
      slug: 'kematian',
      judul: 'Kehilangan keluarga',
      ket: 'Dampingi urusan berikutnya',
      tint: 'bg-ungu',
      kecil: kehilangan640,
      besar: kehilangan1000,
    },
  ] as const;
  const CARA = [
    {
      judul: 'Ceritakan, dengan cara Anda',
      ket: 'Ketik atau gunakan suara. Sebutkan daerah dan siapa yang sedang Anda bantu.',
    },
    {
      judul: 'Ikuti rencana yang bisa diperiksa',
      ket: 'Lihat urutan, kebutuhan dokumen, dan rujukan resmi di balik setiap penjelasan.',
    },
    {
      judul: 'Lanjutkan saat Anda siap',
      ket: 'Posisi terakhir tetap jelas. Anda bisa berhenti, bertanya, lalu kembali melanjutkan.',
    },
  ];
  const PRIVASI = [
    {
      judul: 'Dokumen di perangkat Anda',
      ket: 'Dirancang agar berkas sensitif dikelola di perangkat, dengan informasi minimum untuk AI.',
    },
    {
      judul: 'Izin yang bisa dipahami',
      ket: 'Tahu data apa yang dipakai, untuk tujuan apa, dan kapan Anda perlu menyetujuinya.',
    },
    {
      judul: 'Bisa ditinjau dan dihapus',
      ket: 'Rancangan menyediakan riwayat bantuan serta pilihan menghapus data Anda.',
    },
  ];
  const FAQ = [
    {
      t: 'Apakah Urusin bagian dari pemerintah?',
      j: 'Urusin adalah pendamping independen. Pengajuan dan keputusan layanan tetap berada pada instansi terkait.',
    },
    {
      t: 'Bisa membantu mengurus untuk orang tua?',
      j: 'Bisa. Sebutkan siapa yang Anda bantu dan daerahnya. Urusin menyusun langkah serta dokumennya, lalu Anda yang memeriksa dan mengirim.',
    },
    {
      t: 'Apakah bantuan browser bisa dipakai di HP?',
      j: 'Bisa. Browser Pendamping berjalan dari server Urusin, jadi cukup dibuka lewat peramban HP. Login, CAPTCHA, OTP, dan tombol kirim tetap Anda kerjakan sendiri.',
    },
    {
      t: 'Bagaimana jika informasi layanan berubah?',
      j: 'Setiap langkah menyertakan rujukan resminya. Bila aturan berubah atau belum pasti, Urusin menandainya dan menyarankan Anda memastikan ke instansi terkait.',
    },
  ];
  const MENU: { href: string; label: string }[] = [
    { href: '#cara-kerja', label: 'Cara kerja' },
    { href: '#privasi', label: 'Privasi' },
    { href: '#pertanyaan', label: 'Pertanyaan umum' },
  ];
  const IKON_RAIL: { ikon: NamaIkon; label: string }[] = [
    { ikon: 'obrolan', label: 'Percakapan' },
    { ikon: 'folder', label: 'Dokumen' },
    { ikon: 'jam', label: 'Aktivitas' },
  ];
</script>

<svelte:head>
  <title>Urusin: teman AI untuk urus administrasi</title>
  <meta
    name="description"
    content="Dari “harus mulai dari mana?” hingga langkah berikutnya. Urusin menemani, Anda tetap pegang kendali."
  />
</svelte:head>

<div class="bg-bg tracking-normal text-ink">
  <header class="relative z-30">
    <div class="mx-auto flex h-20 max-w-[67.5rem] items-center justify-between px-6 lg:h-20 lg:px-0">
      <a href={resolve('/')} class="wordmark text-[1.625rem] lg:text-[1.75rem]">urusin<span>.</span></a>
      <nav aria-label="Bagian halaman" class="hidden items-center gap-8 lg:flex">
        {#each MENU as m (m.href)}
          <a href={m.href} class="text-base font-medium text-ink hover:opacity-70">{m.label}</a>
        {/each}
      </nav>
      <div class="hidden items-center gap-5 lg:flex">
        <a href={resolve('/masuk')} class="text-base font-medium text-ink hover:opacity-70">Masuk</a>
        <a
          href={resolve('/beranda')}
          class="inline-flex h-[3.25rem] items-center gap-3 rounded-full bg-primer px-6 text-base font-semibold text-primer-ink hover:opacity-90"
        >
          <Icon name="panah" class="size-[1.125rem]" /> Mulai urusan
        </a>
      </div>
      <button
        type="button"
        class="inline-flex h-11 items-center rounded-full border border-line bg-surface px-4 text-[0.9375rem] font-semibold text-ink lg:hidden"
        aria-expanded={menuBuka}
        aria-controls="menu-hp"
        onclick={() => (menuBuka = !menuBuka)}
      >
        {menuBuka ? 'Tutup' : 'Menu'}
      </button>
    </div>
    {#if menuBuka}
      <nav
        id="menu-hp"
        aria-label="Menu"
        class="absolute inset-x-4 top-[4.5rem] rounded-[1.25rem] border border-line bg-surface p-3 shadow-lembut lg:hidden"
      >
        {#each MENU as m (m.href)}
          <a
            href={m.href}
            onclick={() => (menuBuka = false)}
            class="flex min-h-12 items-center rounded-xl px-4 text-base font-medium hover:bg-bg-2"
            >{m.label}</a
          >
        {/each}
        <a
          href={resolve('/masuk')}
          class="flex min-h-12 items-center rounded-xl px-4 text-base font-medium hover:bg-bg-2">Masuk</a
        >
        <a
          href={resolve('/beranda')}
          class="mt-2 flex h-12 items-center justify-center gap-3 rounded-full bg-primer px-6 text-base font-semibold text-primer-ink"
        >
          <Icon name="panah" class="size-[1.125rem]" /> Mulai urusan
        </a>
      </nav>
    {/if}
  </header>

  <main id="konten" tabindex="-1" class="outline-none">
    <!-- Hero -->
    <section aria-labelledby="judul-hero" class="px-6 pt-10 lg:px-0 lg:pt-[5.5rem]">
      <div class="mx-auto max-w-[67.5rem] text-center">
        <h1
          id="judul-hero"
          class="text-[2.5rem] leading-[1.1] font-normal tracking-[-0.035em] lg:text-[3.5rem] lg:leading-[1.07]"
        >
          Teman AI untuk<br /> urus administrasi Anda
        </h1>
        <p
          class="mx-auto mt-5 max-w-[19.5rem] text-[1.0625rem] lg:max-w-[36rem] leading-[1.5] text-muted lg:mt-6 lg:text-[1.34rem] lg:leading-[1.4]"
        >
          Dari “harus mulai dari mana?” hingga langkah berikutnya. Urusin menemani, Anda tetap pegang kendali.
        </p>
        <div class="mt-6 flex flex-col items-center gap-4 lg:mt-7 lg:flex-row lg:justify-center lg:gap-4">
          <a
            href={resolve('/beranda')}
            class="inline-flex h-[3.25rem] items-center gap-3 rounded-full bg-primer px-6 text-base font-semibold text-primer-ink hover:opacity-90"
          >
            <Icon name="panah" class="size-[1.125rem]" /> Ceritakan kebutuhan
          </a>
          <a
            href="#cara-kerja"
            class="inline-flex h-12 items-center gap-2.5 px-1 text-base font-semibold text-ink hover:opacity-70"
          >
            <Icon name="putar" class="size-[1.125rem]" /> Lihat cara kerjanya
          </a>
        </div>
      </div>

      <div class="relative mx-auto mt-8 max-w-[67.5rem] lg:mt-0">
        <p class="hidden items-center gap-2.5 pt-[1.25rem] pl-[13.5rem] text-[0.9375rem] text-muted lg:flex">
          <Icon name="obrolan" class="size-[1.125rem] text-ink" /> Tidak perlu tahu nama layanan atau istilah resminya.
        </p>
        <div class="relative lg:mt-16">
          <img
            src={trio380}
            srcset="{trio380} 380w, {trio760} 760w"
            sizes="170px"
            alt=""
            width="380"
            height="315"
            loading="lazy"
            decoding="async"
            class="absolute -top-[7.5625rem] right-[4rem] z-10 hidden w-[10.625rem] lg:block"
          />

          <!-- Contoh ruang urusan (ilustrasi, bukan data pengguna) -->
          <div
            class="mock relative overflow-hidden rounded-[1.25rem] border border-bg-2 bg-bg-2 lg:rounded-b-none lg:border-b-0"
            role="img"
            aria-label="Contoh ruang urusan Urusin: percakapan tentang kelahiran anak dengan tiga langkah dan daftar persiapan dokumen."
          >
            <div class="relative flex h-9 items-center px-4 lg:h-11 lg:px-5" aria-hidden="true">
              <span class="flex gap-[0.875rem] lg:gap-4">
                <span class="size-2 rounded-full bg-[#e0a493]"></span>
                <span class="size-2 rounded-full bg-[#dbca92]"></span>
                <span class="size-2 rounded-full bg-[#a9b99a]"></span>
              </span>
              <span class="absolute inset-x-0 text-center text-[0.8125rem] text-muted"
                >urusin · Ruang urusan Anda</span
              >
            </div>
            <div class="flex lg:h-[35.625rem]" aria-hidden="true">
              <div class="hidden w-[11.25rem] shrink-0 flex-col px-5 pt-7 lg:flex">
                <span class="wordmark text-[1.5rem]">urusin<span>.</span></span>
                <span
                  class="mt-[1.375rem] inline-flex h-12 w-[8.75rem] items-center justify-center gap-1.5 rounded-full bg-primer text-[0.9375rem] font-semibold text-primer-ink"
                >
                  <Icon name="tambah" class="size-4" /> Urusan baru
                </span>
                <ul class="mt-5 flex flex-col gap-[1.3rem] text-[0.875rem]">
                  {#each IKON_RAIL as r (r.label)}
                    <li class="flex items-center gap-2.5"><Icon name={r.ikon} class="size-4" />{r.label}</li>
                  {/each}
                </ul>
              </div>
              <div class="min-w-0 flex-1 bg-surface px-4 pt-4 pb-5 lg:px-7 lg:pt-7 lg:pb-[2.375rem]">
                <div class="flex items-center justify-between">
                  <span class="flex items-center gap-3 text-base font-semibold lg:text-[1.0625rem]">
                    <Icon name="ai" class="size-5 text-brand" /> Kelahiran anak
                  </span>
                  <span class="rounded-full bg-bg-2 px-2.5 py-1.5 text-[0.8125rem] text-muted">Contoh</span>
                </div>
                <p
                  class="mt-4 rounded-2xl bg-bg-2 px-4 py-4 text-[0.9375rem] leading-[1.6] lg:mt-6 lg:text-base"
                >
                  Anak saya baru lahir. Dokumen apa yang perlu saya urus?
                </p>
                <p class="mt-5 text-[0.9375rem] leading-[1.6] lg:mt-6 lg:text-base lg:leading-[1.65]">
                  Selamat atas kelahiran si kecil! Kita mulai dari kebutuhan keluarga Anda di Kota Bandung.
                </p>
                <ol class="mt-4 lg:mt-5">
                  {#each LANGKAH_CONTOH as l, i (l.judul)}
                    <li class="flex items-center gap-3 border-b border-line py-3 lg:py-3.5">
                      <span
                        class="grid size-[1.875rem] shrink-0 place-items-center rounded-full bg-bg-2 text-[0.8125rem] text-muted"
                        >{i + 1}</span
                      >
                      <span class="min-w-0 flex-1">
                        <span class="block text-[0.9375rem] font-semibold">{l.judul}</span>
                        <span class="mt-0.5 block text-[0.8125rem] text-muted">{l.ket}</span>
                      </span>
                      <Icon name="kanan" class="size-4" />
                    </li>
                  {/each}
                </ol>
                <div
                  class="mt-4 flex h-12 items-center justify-between rounded-2xl border border-line px-4 text-[0.875rem] text-muted lg:mt-6"
                >
                  Tanya apa saja...
                  <Icon name="mikrofon" class="size-[1.125rem] text-ink" />
                </div>
              </div>
              <div class="hidden w-[15.625rem] shrink-0 bg-card px-5 pt-7 lg:block">
                <span class="block text-[1.0625rem] font-semibold">Persiapan Anda</span>
                <span class="mt-4 block text-[0.8125rem] leading-[1.6] text-muted"
                  >Contoh dokumen · bukan daftar persyaratan resmi</span
                >
                <ul class="mt-2">
                  {#each PERSIAPAN as p (p.judul)}
                    <li class="border-b border-line pt-8 pb-8">
                      <Icon name="berkas-teks" class="size-[1.375rem]" />
                      <span class="mt-3 block text-[0.875rem] font-semibold">{p.judul}</span>
                      <span class="mt-3 block text-[0.8125rem] text-muted">{p.status}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Kenalan -->
    <section
      aria-labelledby="judul-kenalan"
      class="mx-auto grid max-w-[67.5rem] items-center gap-[3.75rem] px-6 pt-16 text-center lg:grid-cols-2 lg:gap-0 lg:px-0 lg:pt-[9.125rem] lg:text-left"
    >
      <div>
        <h2
          id="judul-kenalan"
          class="text-[2.25rem] leading-[1.12] font-normal tracking-[-0.04em] lg:text-[2.75rem] lg:leading-[1.09]"
        >
          <span class="lg:hidden">Birokrasi rumit.<br />Ada yang menemani.</span>
          <span class="hidden lg:inline">Birokrasi rumit.<br />Sekarang ada<br />yang menemani.</span>
        </h2>
        <p
          class="mx-auto mt-5 max-w-[30rem] text-[1.0625rem] leading-[1.6] text-muted lg:mx-0 lg:mt-6 lg:max-w-none lg:text-lg"
        >
          Tidak perlu tahu nama layanan atau istilah pemerintah.<br class="hidden lg:inline" /> Mulai dari cerita
          Anda, lalu kita urai satu per satu.
        </p>
        <a
          href="#cara-kerja"
          class="mt-6 inline-flex h-12 items-center rounded-full bg-primer px-5 text-[0.9375rem] font-semibold text-primer-ink hover:opacity-90 lg:mt-7"
          >Kenalan dengan Urusin</a
        >
      </div>
      <img
        src={trio760}
        srcset="{trio380} 380w, {trio760} 760w"
        sizes="(min-width: 1024px) 375px, 264px"
        alt=""
        width="760"
        height="629"
        loading="lazy"
        decoding="async"
        class="mx-auto w-[16.5rem] lg:mr-[2.75rem] lg:w-[23.4375rem]"
      />
    </section>

    <!-- Daerah -->
    <section aria-labelledby="judul-daerah" class="px-6 pt-[8.75rem] text-center lg:px-0 lg:pt-[11.8rem]">
      <h2
        id="judul-daerah"
        class="text-[2rem] leading-[1.15] font-normal tracking-[-0.04em] lg:text-[2.5rem] lg:leading-[1.12]"
      >
        Beda daerah, beda proses.<br class="hidden lg:inline" /> Panduan ikut menyesuaikan.
      </h2>
      <p
        class="mx-auto mt-5 max-w-[19rem] text-[1.0625rem] leading-[1.6] text-muted lg:mt-8 lg:max-w-[32rem] lg:text-lg"
      >
        Urusin membantu mencari rujukan resmi sesuai lokasi Anda.<br /> Informasi yang belum pasti akan ditandai
        dengan jelas.
      </p>
      <div
        class="mt-8 flex flex-col items-center gap-2.5 lg:mt-12 lg:flex-row lg:justify-center lg:gap-3"
        role="group"
        aria-label="Pilih daerah"
      >
        {#each DAERAH as d, i (d.nama)}
          <button
            type="button"
            aria-pressed={daerah === i}
            onclick={() => (daerah = i)}
            class="h-[1.875rem] rounded-full bg-bg-2 px-2.5 text-[0.875rem] hover:text-ink {daerah === i
              ? 'font-medium text-ink'
              : 'text-muted'}">{d.nama}</button
          >
        {/each}
      </div>
      <form
        method="POST"
        action="/?/mulai"
        class="mx-auto mt-8 max-w-[48.75rem] rounded-3xl bg-surface p-5 text-left shadow-lembut lg:mt-[2.3rem] lg:px-6 lg:pt-6 lg:pb-6"
      >
        <input type="hidden" name="pesan" value={cerita} />
        <input type="hidden" name="kodeKabKota" value={DAERAH[daerah]?.kode ?? ''} />
        <p class="text-[1.0625rem] leading-[1.5] lg:text-xl lg:leading-[1.45]">
          “{kalimat}<br /> Apa yang harus disiapkan?”
        </p>
        <div class="mt-6 flex items-center gap-4 lg:mt-6">
          <Icon name="tambah" class="size-5 shrink-0" />
          <Icon name="mikrofon" class="size-5 shrink-0" />
          <span class="hidden text-[0.8125rem] text-muted lg:inline">Sesuaikan daerah Anda</span>
          <button
            type="submit"
            class="inline-flex h-12 shrink-0 items-center rounded-full bg-primer px-5 lg:ml-auto text-[0.9375rem] font-semibold text-primer-ink hover:opacity-90"
            >Mulai cerita</button
          >
        </div>
      </form>
    </section>

    <!-- Cerita -->
    <section aria-labelledby="judul-cerita" class="px-6 pt-32 lg:px-0 lg:pt-[7.4rem]">
      <div class="text-center">
        <h2
          id="judul-cerita"
          class="text-[2rem] leading-[1.15] font-normal tracking-[-0.04em] lg:text-[2.5rem] lg:leading-[1.12]"
        >
          Mulai dari cerita Anda.
        </h2>
        <p class="mt-4 text-[1.0625rem] leading-[1.6] text-muted lg:mt-6 lg:text-lg">
          Ada banyak urusan. Kita temukan langkah pertama Anda.
        </p>
      </div>
      <ul
        class="mx-auto mt-8 grid max-w-[67.5rem] gap-6 lg:mt-12 lg:grid-cols-2 lg:gap-x-6 lg:gap-y-[1.5625rem]"
      >
        {#each CERITA as c (c.slug)}
          <li class="overflow-hidden rounded-3xl bg-card">
            <div class="rounded-3xl p-3 lg:p-4 {c.tint}">
              <img
                src={c.kecil}
                srcset="{c.kecil} 640w, {c.besar} 1000w"
                sizes="(min-width: 1024px) 496px, calc(100vw - 72px)"
                alt=""
                width="1000"
                height="495"
                loading="lazy"
                decoding="async"
                class="aspect-[10/7] w-full rounded-2xl object-cover lg:aspect-[496/220]"
              />
            </div>
            <div class="px-6 pt-8 pb-6 lg:px-6 lg:pt-7 lg:pb-6">
              <h3 class="text-[1.3125rem] font-semibold tracking-[-0.02em] lg:text-[1.375rem]">{c.judul}</h3>
              <p class="mt-3 text-[1.0625rem] text-muted lg:mt-2.5 lg:text-base">{c.ket}</p>
              <a
                href={resolve('/peristiwa/[slug]', { slug: c.slug })}
                class="mt-4 inline-flex h-12 items-center rounded-full bg-primer px-5 text-[0.9375rem] font-semibold text-primer-ink hover:opacity-90"
                >Mulai cerita<span class="sr-only">: {c.judul}</span></a
              >
            </div>
          </li>
        {/each}
      </ul>
      <p class="mt-10 text-center text-[0.9375rem] text-muted lg:mt-[2.75rem]">
        Punya kebutuhan lain? Ceritakan saja kepada Urusin.
      </p>
    </section>

    <!-- Cara kerja -->
    <section
      id="cara-kerja"
      aria-labelledby="judul-cara"
      class="mx-auto grid max-w-[67.5rem] gap-10 px-6 pt-24 pb-14 lg:grid-cols-[1fr_31.25rem] lg:gap-20 lg:px-0 lg:pt-[9.375rem] lg:pb-[5.5625rem]"
    >
      <div class="lg:pt-4">
        <h2
          id="judul-cara"
          class="text-[2.25rem] leading-[1.12] font-normal tracking-[-0.04em] lg:text-[2.75rem] lg:leading-[1.11]"
        >
          Tidak harus paham<br class="hidden lg:inline" /> semuanya sekaligus.
        </h2>
        <p class="mt-5 max-w-[30rem] text-[1.0625rem] leading-[1.6] text-muted lg:mt-7 lg:text-lg">
          Kita pecah urusan besar menjadi langkah kecil yang bisa Anda kerjakan.
        </p>
        <ol class="mt-8 flex flex-col gap-7 lg:mt-8 lg:gap-[1.75rem]">
          {#each CARA as c, i (c.judul)}
            <li class="grid grid-cols-[11.25rem_1fr] lg:grid-cols-[3rem_1fr]">
              <span class="text-lg font-semibold text-hijau-ink">{i + 1}</span>
              <span>
                <span class="block text-xl leading-[1.4] font-semibold tracking-[-0.02em]">{c.judul}</span>
                <span
                  class="mt-2.5 block max-w-[28rem] text-[1.0625rem] leading-[1.55] text-muted lg:text-base lg:leading-[1.6]"
                  >{c.ket}</span
                >
              </span>
            </li>
          {/each}
        </ol>
      </div>
      <div class="rounded-3xl border border-line bg-card p-5 lg:p-7">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold tracking-[-0.02em] lg:text-[1.1875rem]">
            Kita periksa fotonya dulu.
          </h3>
          <Icon name="pindai" class="size-6" />
        </div>
        <div
          class="mt-6 grid h-40 place-items-center content-center gap-3 rounded-2xl bg-bg-2 text-[0.875rem] text-muted"
        >
          <Icon name="berkas-gambar" class="size-[2.125rem] text-ink opacity-70" />
          Pratinjau dokumen disamarkan
        </div>
        <span
          class="mt-5 inline-flex h-8 items-center rounded-full bg-kuning px-3 text-[0.8125rem] font-semibold text-kuning-ink"
          >Perlu foto ulang</span
        >
        <p class="mt-5 text-xl font-semibold tracking-[-0.02em]">Bagian kanan dokumen terpotong.</p>
        <p class="mt-4 text-base leading-[1.6] text-muted">
          Ambil ulang di tempat terang. Pastikan keempat sudut dokumen terlihat dan tulisan tidak buram.
        </p>
        <a
          href={resolve('/dokumen')}
          class="mt-5 flex h-[3.25rem] items-center rounded-full bg-surface px-6 text-[0.9375rem] font-semibold shadow-lembut hover:opacity-90"
          >Ambil foto ulang</a
        >
        <p class="mt-5 text-[0.8125rem] text-muted">Contoh pemeriksaan, bukan dokumen pribadi.</p>
      </div>
    </section>

    <!-- Bantuan browser + privasi -->
    <div class="bg-bg-2 px-6 pt-14 pb-20 lg:px-0 lg:pt-[6.9rem] lg:pb-[8.125rem]">
      <section
        aria-labelledby="judul-situs"
        class="mx-auto grid max-w-[67.5rem] gap-10 lg:grid-cols-[31.25rem_1fr] lg:gap-16"
      >
        <div class="overflow-hidden rounded-[1.25rem] border border-line bg-surface lg:order-none">
          <div
            class="flex h-14 items-center justify-between border-b border-line px-6 text-[0.875rem] text-muted"
          >
            <span class="flex items-center gap-3"
              ><Icon name="gembok" class="size-4 text-ink" />Situs layanan resmi</span
            >
            <Icon name="panel" class="size-[1.125rem] text-ink" />
          </div>
          <div class="p-6 lg:p-7">
            <span
              class="inline-flex h-8 items-center rounded-full bg-kuning px-3 text-[0.8125rem] font-semibold text-kuning-ink"
              >Menunggu izin Anda</span
            >
            <p class="mt-5 text-[1.875rem] leading-[1.2] font-normal tracking-[-0.04em]">
              Bantu isi,<br />setelah Anda setuju.
            </p>
            <p class="mt-7 text-base text-muted lg:mt-8">Urusin meminta izin untuk langkah berikut:</p>
            <ul class="mt-4 flex flex-col gap-5 border-b border-line pb-5 text-[0.9375rem]">
              <li class="flex gap-4">
                <Icon name="centang" class="size-[1.125rem] shrink-0 text-hijau-ink" />Mengisi data yang Anda
                pilih
              </li>
              <li class="flex gap-4">
                <Icon name="centang" class="size-[1.125rem] shrink-0 text-hijau-ink" />Mengunggah berkas yang
                Anda setujui
              </li>
            </ul>
            <p class="mt-6 text-base leading-[1.6] font-semibold">
              Login, CAPTCHA, OTP, dan tombol kirim tetap Anda kerjakan sendiri.
            </p>
            <a
              href={resolve('/bantuan')}
              class="mt-5 flex h-[3.25rem] items-center justify-center gap-3 rounded-full bg-primer text-base font-semibold text-primer-ink hover:opacity-90"
            >
              <Icon name="panah" class="size-[1.125rem]" /> Tinjau izin
            </a>
          </div>
        </div>
        <div class="lg:pt-[6.25rem]">
          <h2
            id="judul-situs"
            class="text-[2.25rem] leading-[1.12] font-normal tracking-[-0.04em] lg:text-[2.75rem] lg:leading-[1.14]"
          >
            Dibantu sampai<br />situs resminya.
          </h2>
          <p class="mt-5 max-w-[32rem] text-[1.0625rem] leading-[1.6] text-muted lg:mt-9 lg:text-lg">
            Browser Pendamping Urusin dirancang membantu mengisi formulir di situs resmi, dari HP maupun
            laptop. Tujuannya jelas, izin ditinjau, dan kendali tetap di tangan Anda.
          </p>
          <p class="mt-6 flex gap-3 text-base leading-[1.6] text-muted lg:mt-7">
            <Icon name="rute" class="mt-0.5 size-[1.375rem] shrink-0 text-hijau-ink" />
            Situs belum didukung? Urusin tetap menuntun Anda lewat langkah manual.
          </p>
          <p class="mt-6 pl-3 text-[0.8125rem] font-semibold text-muted lg:mt-8">
            Browser Pendamping dalam pengembangan
          </p>
        </div>
      </section>

      <section
        id="privasi"
        aria-labelledby="judul-privasi"
        class="mx-auto mt-40 max-w-[67.5rem] text-hijau-ink lg:mt-[8.7rem]"
      >
        <h2
          id="judul-privasi"
          class="flex flex-col gap-6 text-[2rem] leading-[1.15] font-normal tracking-[-0.04em] lg:flex-row lg:items-center lg:gap-8 lg:text-[2.25rem]"
        >
          <Icon name="perisai-centang" class="size-10 shrink-0 self-center lg:self-auto" />
          Urusan pribadi, tetap dalam kendali Anda.
        </h2>
        <ul class="mt-8 grid gap-7 lg:mt-12 lg:grid-cols-3 lg:gap-10">
          {#each PRIVASI as p (p.judul)}
            <li>
              <h3 class="text-[1.1875rem] font-semibold tracking-[-0.02em]">{p.judul}</h3>
              <p class="mt-3 max-w-[21rem] text-base leading-[1.7] lg:mt-4 lg:text-base lg:leading-[1.65]">
                {p.ket}
              </p>
            </li>
          {/each}
        </ul>
      </section>
    </div>

    <!-- FAQ -->
    <section
      id="pertanyaan"
      aria-labelledby="judul-faq"
      class="mx-auto grid max-w-[67.5rem] gap-8 px-6 pt-16 pb-12 lg:grid-cols-[23.75rem_1fr] lg:gap-[3.125rem] lg:px-0 lg:pt-[6.875rem] lg:pb-[7.2rem]"
    >
      <div>
        <h2
          id="judul-faq"
          class="text-[2rem] leading-[1.15] font-normal tracking-[-0.04em] lg:text-[2.25rem] lg:leading-[1.12]"
        >
          Masih ingin<br />tahu lebih jauh?
        </h2>
        <p class="mt-5 text-base text-muted lg:mt-7 lg:text-[1.0625rem]">
          Wajar kalau Anda ingin memastikan dulu.
        </p>
        <a
          href={resolve('/beranda')}
          class="mt-4 inline-flex min-h-12 items-center gap-2.5 text-[0.9375rem] font-semibold hover:opacity-70 lg:mt-6"
        >
          <Icon name="obrolan" class="size-[1.125rem]" /> Tanya Urusin
        </a>
      </div>
      <div class="flex flex-col gap-5">
        {#each FAQ as f, i (f.t)}
          <details class="faq group" open={i === 0}>
            <summary
              class="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl bg-surface px-6 py-5 text-[1.0625rem] leading-[1.5] font-semibold lg:py-4 shadow-[0_6px_24px_rgb(37_37_34/0.06)] lg:px-6 lg:text-[1.0625rem]"
            >
              {f.t}
              <Icon name="tambah" class="size-5 shrink-0 group-open:hidden" />
              <Icon name="kurang" class="hidden size-5 shrink-0 group-open:block" />
            </summary>
            <p
              class="mt-5 rounded-2xl bg-primer px-6 py-6 text-[1.0625rem] leading-[1.6] lg:py-5 text-primer-ink lg:px-6 lg:text-base"
            >
              {f.j}
            </p>
          </details>
        {/each}
      </div>
    </section>

    <!-- Ajakan -->
    <section aria-labelledby="judul-ajakan" class="bg-bg-2 px-6 pt-20 text-center lg:pt-[5.875rem]">
      <h2
        id="judul-ajakan"
        class="text-[1.875rem] leading-[1.15] font-normal tracking-[-0.04em] lg:text-[2.75rem] lg:leading-[1.1]"
      >
        Mulai dari satu cerita.
      </h2>
      <p
        class="mx-auto mt-4 max-w-[17rem] text-[1.1875rem] leading-[1.55] text-muted lg:mt-6 lg:max-w-none lg:text-xl"
      >
        Anda tidak harus tahu semua jawabannya sekarang.
      </p>
      <a
        href={resolve('/beranda')}
        class="mt-7 inline-flex h-[3.25rem] items-center gap-3 rounded-full bg-primer px-6 text-[0.9375rem] font-semibold text-primer-ink hover:opacity-90 lg:mt-8"
      >
        <Icon name="panah" class="size-[1.125rem]" /> Mulai urusan saya
      </a>
    </section>
  </main>

  <footer class="bg-bg-2 px-6 pt-[8.5rem] pb-10 lg:px-0 lg:pt-[7.6rem] lg:pb-[2.75rem]">
    <div
      class="mx-auto flex max-w-[67.5rem] flex-col items-center gap-6 text-center lg:flex-row lg:justify-between lg:gap-0 lg:text-left"
    >
      <a href={resolve('/')} class="wordmark text-[1.75rem]">urusin<span>.</span></a>
      <p class="text-[0.875rem] text-muted lg:pl-[8.5rem] lg:text-[0.8125rem]">
        Prototipe hackathon · Fitur dikembangkan bertahap
      </p>
      <nav aria-label="Kaki halaman" class="flex flex-col items-center gap-7 lg:flex-row lg:gap-8">
        <a
          href="{resolve('/pengaturan')}#privasi"
          class="inline-flex min-h-12 items-center text-[0.9375rem] font-semibold">Privasi</a
        >
        <a
          href="{resolve('/pengaturan')}#tampilan"
          class="inline-flex min-h-12 items-center text-[0.9375rem] font-semibold">Aksesibilitas</a
        >
      </nav>
    </div>
  </footer>
</div>

<style>
  .wordmark {
    font-weight: 700;
    letter-spacing: -0.05em;
    line-height: 1;
    color: var(--sb-text-primary);
  }
  .mock {
    box-shadow:
      0 30px 80px -20px rgb(37 37 34 / 0.12),
      0 0 0 1px var(--sb-bg-secondary);
  }
  .faq summary::-webkit-details-marker {
    display: none;
  }
</style>
