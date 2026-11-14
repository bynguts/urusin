<script lang="ts">
  import { resolve } from '$app/paths';
  import { tick } from 'svelte';
  import blueBerpikir from '#lib/assets/img/blue-berpikir.webp';
  import objBrowser from '#lib/assets/img/obj-browser.webp';
  import objPerisai from '#lib/assets/img/obj-perisai.webp';
  import latar1x from '#lib/assets/img/app/latar-bantuan-1076.webp';
  import latar2x from '#lib/assets/img/app/latar-bantuan-2152.webp';
  import Icon from '#lib/components/Icon.svelte';
  import type { NamaIkon } from '#lib/components/ikon.js';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import TeksBertaut from '#lib/components/ui/TeksBertaut.svelte';
  import { domain } from '#lib/urusan-status.js';
  import { ambilLokal } from '#lib/stores/app.svelte.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const lokal = ambilLokal();

  type Tanya = { id: string; tanya: string; jawab: string[] };
  const FAQ: Tanya[] = [
    {
      id: 'pemerintah',
      tanya: 'Apakah Urusin bagian dari pemerintah?',
      jawab: ['Bukan. Urusin membantu memahami dan menyiapkan urusan. Keputusan tetap di instansi resmi.'],
    },
    {
      id: 'aman',
      tanya: 'Apakah data saya aman?',
      jawab: [
        'Data diri dan dokumen Anda hanya dipakai untuk urusan yang Anda setujui. AI tidak melihat kata sandi atau kode OTP Anda.',
        'Browser Pendamping berjalan di server Urusin dan dihapus saat sesi berakhir: tidak ada cookie, riwayat, atau rekaman layar yang disimpan.',
      ],
    },
    {
      id: 'kirim',
      tanya: 'Kenapa Urusin tidak menekan Kirim?',
      jawab: [
        'Pengajuan ke instansi adalah keputusan Anda. AI berhenti sebelum tombol Kirim, Anda memeriksa isian, lalu Anda sendiri yang menekannya.',
      ],
    },
    {
      id: 'situs-berubah',
      tanya: 'Bagaimana kalau situs resmi berubah?',
      jawab: [
        'Urusin berhenti dengan aman dan beralih ke mode dipandu: Anda mendapat langkah demi langkah untuk mengisi sendiri, lengkap dengan sumber resmi.',
      ],
    },
    {
      id: 'otp',
      tanya: 'Kenapa kode OTP dan kata sandi harus saya ketik sendiri?',
      jawab: [
        'Kode OTP dan kata sandi adalah kunci akun Anda. Saat diminta, layar berganti ke "Giliran Anda": AI berhenti dan tidak melihat yang Anda ketik.',
      ],
    },
    {
      id: 'unggah',
      tanya: 'Bagaimana supaya dokumen yang diunggah tidak ditolak?',
      jawab: [
        'Foto di tempat terang, seluruh halaman masuk bingkai, tidak terpotong, dan tulisan terbaca. Simpan dulu di menu Dokumen supaya bisa dipakai ulang.',
        'Format yang diterima: JPG, PNG, atau PDF.',
      ],
    },
    {
      id: 'pendamping',
      tanya: 'Apa itu Browser Pendamping?',
      jawab: [
        'Situs resmi dibuka di server Urusin dan tampil di layar Anda. AI mengisi formulir dengan data yang Anda izinkan, dan Anda bisa mengambil alih kapan saja.',
      ],
    },
  ];

  const TOPIK: { judul: string; ringkas: string; gambar?: string; latar: string; ke: string }[] = [
    {
      judul: 'Mengunggah dokumen',
      ringkas: 'Supaya foto atau pindaian jelas dan tidak ditolak petugas.',
      latar: 'bg-[#f4efe4]',
      ke: 'unggah',
    },
    {
      judul: 'Browser Pendamping',
      ringkas: 'Situs resmi tampil di layar, AI mengisi dengan izin Anda.',
      gambar: objBrowser,
      latar: 'bg-[#f6ece6]',
      ke: 'pendamping',
    },
    {
      judul: 'Kenapa OTP harus Anda?',
      ringkas: 'Data dan keputusan tetap di tangan Anda.',
      gambar: objPerisai,
      latar: 'bg-hijau',
      ke: 'otp',
    },
  ];

  let cari = $state('');
  let terbuka = $state('pemerintah');
  const kata = $derived(cari.trim().toLowerCase());
  const tampil = $derived(
    kata ? FAQ.filter((f) => (f.tanya + ' ' + f.jawab.join(' ')).toLowerCase().includes(kata)) : FAQ,
  );
  const kota = $derived(data.kota.find((k) => k.kodeKabKota === lokal.data.wilayah?.kodeKabKota));

  async function buka(id: string) {
    cari = '';
    terbuka = id;
    await tick();
    document.getElementById(`tanya-${id}`)?.scrollIntoView({ block: 'start' });
  }

  type Pintasan = {
    ikon: NamaIkon;
    judul: string;
    ringkas: string;
    href: string;
    luar?: boolean;
    gelap?: boolean;
  };
  const pintasan = $derived<Pintasan[]>([
    {
      ikon: 'obrolan',
      judul: 'Tanya Ana',
      ringkas: 'Jawaban disertai sumber resmi',
      href: resolve('/beranda'),
      gelap: true,
    },
    ...(kota?.situs
      ? [
          {
            ikon: 'instansi' as const,
            judul: `Disdukcapil ${kota.nama.replace(/^Kabupaten /, 'Kab. ')}`,
            ringkas: 'Alamat dan jam layanan dari situs resmi',
            href: kota.situs.url,
            luar: true,
          },
        ]
      : []),
    {
      ikon: 'rencana',
      judul: 'Situs resmi bermasalah?',
      ringkas: 'Urusin memandu langkah demi langkah.',
      href: '#tanya-situs-berubah',
    },
  ]);
</script>

<svelte:head><title>Bantuan · Urusin</title></svelte:head>

<HeaderHalaman judul="Bantuan" />

<div class="flex w-full flex-col gap-[22px] px-4 py-6 sm:px-10 sm:py-7">
  <section
    class="latar-bantuan relative isolate overflow-hidden rounded-[20px] border border-line lg:h-[180px]"
    style:--latar-1x="url({latar1x})"
    style:--latar-2x="url({latar2x})"
  >
    <div class="flex flex-col gap-3.5 p-5 sm:p-7 lg:absolute lg:top-7 lg:left-7 lg:w-[620px] lg:p-0">
      <h2 class="text-[26px] leading-8 font-semibold tracking-[-0.7px] text-ink sm:text-[28px]">
        Ada yang bisa dibantu?
      </h2>
      <label for="cari-bantuan" class="sr-only">Cari bantuan</label>
      <div
        class="flex h-14 w-full items-center gap-2.5 rounded-full border border-line-2 bg-surface px-[18px] shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a] focus-within:ring-2 focus-within:ring-ink focus-within:outline-none"
      >
        <Icon name="cari" class="pointer-events-none size-[18px] shrink-0 text-ink" />
        <input
          id="cari-bantuan"
          type="search"
          bind:value={cari}
          placeholder="Cari bantuan, misalnya: cara mengunggah dokumen"
          class="h-full min-w-0 flex-1 border-none bg-transparent text-base leading-[25px] text-ink shadow-none outline-none placeholder:text-muted focus:border-none focus:shadow-none focus:outline-none sm:text-[17px]"
        />
      </div>
    </div>
    <img
      src={blueBerpikir}
      alt=""
      width="158"
      height="172"
      class="pointer-events-none absolute top-2 right-[38px] z-[1] hidden h-[172px] w-[158px] object-contain xl:block"
    />
  </section>

  <ul class="grid gap-4 md:grid-cols-3">
    {#each TOPIK as t (t.ke)}
      <li class="flex">
        <a
          href="#tanya-{t.ke}"
          onclick={() => buka(t.ke)}
          class="flex flex-1 items-center gap-3.5 rounded-2xl border border-line bg-surface p-3.5 shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a] hover:bg-card"
        >
          <span
            class="grid size-[72px] shrink-0 place-items-center rounded-[14px] {t.latar} dark:bg-bg-2"
            aria-hidden="true"
          >
            {#if t.gambar}
              <img src={t.gambar} alt="" width="60" height="60" class="size-[60px] object-contain" />
            {:else}
              <Icon name="berkas-unggah" class="size-[30px] text-brand" />
            {/if}
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-[17px] leading-[25px] font-semibold text-ink">{t.judul}</span>
            <span class="text-sm leading-5 text-muted">{t.ringkas}</span>
          </span>
        </a>
      </li>
    {/each}
  </ul>

  <div class="grid items-start gap-4 lg:grid-cols-[1fr_380px]">
    <section aria-labelledby="judul-faq" class="overflow-hidden rounded-[18px] border border-line">
      <h2
        id="judul-faq"
        class="border-b border-line bg-card px-[18px] py-3.5 text-base leading-[23px] font-semibold text-ink"
      >
        Pertanyaan yang sering ditanya
      </h2>
      {#each tampil as f (f.id)}
        <details
          id="tanya-{f.id}"
          open={terbuka === f.id || !!kata}
          class="group scroll-mt-36 border-t border-line first-of-type:border-t-0 lg:scroll-mt-24"
          ontoggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open) terbuka = f.id;
          }}
        >
          <summary
            class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-[18px] py-3.5 text-base leading-[23px] text-ink transition-colors duration-150 hover:bg-card/50 group-open:pb-1.5 group-open:font-semibold [&::-webkit-details-marker]:hidden"
          >
            {f.tanya}
            <Icon
              name="bawah"
              class="size-[18px] shrink-0 transition-transform duration-200 ease-out group-open:rotate-180"
            />
          </summary>
          <div class="flex flex-col gap-1.5 px-[18px] pb-3.5 text-[15px] leading-[22px] text-card-ink">
            {#each f.jawab as p, i (i)}<p><TeksBertaut teks={p} /></p>{/each}
          </div>
        </details>
      {:else}
        <p class="px-[18px] py-5 text-[15px] leading-[22px] text-card-ink">
          Belum ada jawaban untuk "{cari}". Coba kata lain, atau tanyakan langsung ke Ana.
        </p>
      {/each}
    </section>

    <ul class="flex flex-col gap-2.5">
      {#each pintasan as p (p.judul)}
        <li>
          <!-- eslint-disable svelte/no-navigation-without-resolve -- href sudah lewat resolve(), situs resmi, atau anchor -->
          <a
            href={p.href}
            onclick={() => {
              if (p.href.startsWith('#tanya-')) void buka(p.href.slice('#tanya-'.length));
            }}
            target={p.luar ? '_blank' : undefined}
            rel={p.luar ? 'noopener noreferrer' : undefined}
            class="flex items-center gap-3 rounded-[14px] px-3.5 py-3 {p.gelap
              ? 'bg-primer text-primer-ink'
              : 'border border-line bg-surface text-ink hover:bg-card'}"
          >
            <span
              class="grid size-10 shrink-0 place-items-center rounded-xl {p.gelap
                ? 'bg-white/[0.12]'
                : 'bg-bg-2'}"
            >
              <Icon name={p.ikon} class="size-[18px]" />
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-px">
              <span class="text-base leading-[23px] font-semibold">{p.judul}</span>
              <span class="text-sm leading-5 {p.gelap ? 'text-primer-ink/70' : 'text-muted'}"
                >{p.ringkas}</span
              >
              {#if p.luar}<span class="tautan truncate text-sm leading-5">{domain(p.href)}</span>{/if}
            </span>
            <Icon name="kanan" class="size-[17px] shrink-0" />
            {#if p.luar}<span class="sr-only">(membuka situs resmi di tab baru)</span>{/if}
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .latar-bantuan {
    background: linear-gradient(#eef2f5, #fcf8f5);
  }
  :global([data-theme='dark']) .latar-bantuan {
    background: var(--color-card);
  }
  @media (min-width: 1024px) {
    :global(:root:not([data-theme='dark'])) .latar-bantuan {
      background: image-set(var(--latar-1x) 1x, var(--latar-2x) 2x) center / 100% 100% no-repeat;
    }
  }
</style>
