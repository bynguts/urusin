<script lang="ts">
  import { resolve } from '$app/paths';
  import blueBerpikir from '#lib/assets/img/blue-berpikir.webp';
  import objBrowser from '#lib/assets/img/obj-browser.webp';
  import objDokumen from '#lib/assets/img/obj-dokumen.webp';
  import objPerisai from '#lib/assets/img/obj-perisai.webp';
  import Icon from '#lib/components/Icon.svelte';
  import type { NamaIkon } from '#lib/components/ikon.js';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import { ambilLokal } from '#lib/stores/app.svelte.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const lokal = ambilLokal();

  type Tanya = { id: string; tanya: string; jawab: string[] };
  const FAQ: Tanya[] = [
    {
      id: 'pemerintah',
      tanya: 'Apakah Urusin bagian dari pemerintah?',
      jawab: [
        'Bukan. Urusin membantu memahami dan menyiapkan urusan. Keputusan tetap di instansi resmi.',
        'Setiap jawaban disertai sumber resmi (situs .go.id atau peraturan) supaya Anda bisa memeriksanya sendiri.',
      ],
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
      id: 'otp',
      tanya: 'Kenapa kode OTP dan kata sandi harus saya ketik sendiri?',
      jawab: [
        'Kode OTP dan kata sandi adalah kunci akun Anda. Saat diminta, layar berganti ke "Giliran Anda": AI berhenti dan tidak melihat yang Anda ketik.',
      ],
    },
    {
      id: 'unggah',
      tanya: 'Bagaimana supaya dokumen yang diunggah lolos pemeriksaan?',
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
    {
      id: 'situs-berubah',
      tanya: 'Bagaimana kalau situs resmi berubah atau bermasalah?',
      jawab: [
        'Urusin berhenti dengan aman dan beralih ke mode dipandu: Anda mendapat langkah demi langkah untuk mengisi sendiri, lengkap dengan sumber resmi.',
      ],
    },
  ];

  const TOPIK: { judul: string; ringkas: string; gambar: string; ke: string }[] = [
    {
      judul: 'Mengunggah dokumen',
      ringkas: 'Supaya foto atau pindaian langsung lolos pemeriksaan.',
      gambar: objDokumen,
      ke: 'unggah',
    },
    {
      judul: 'Browser Pendamping',
      ringkas: 'Situs resmi tampil di layar, AI mengisi dengan izin Anda.',
      gambar: objBrowser,
      ke: 'pendamping',
    },
    {
      judul: 'Kenapa OTP harus Anda?',
      ringkas: 'Data dan keputusan tetap di tangan Anda.',
      gambar: objPerisai,
      ke: 'otp',
    },
  ];

  let cari = $state('');
  let terbuka = $state('pemerintah');
  const kata = $derived(cari.trim().toLowerCase());
  const tampil = $derived(
    kata ? FAQ.filter((f) => (f.tanya + ' ' + f.jawab.join(' ')).toLowerCase().includes(kata)) : FAQ,
  );
  const kota = $derived(data.kota.find((k) => k.kodeKabKota === lokal.data.wilayah.kodeKabKota));

  function buka(id: string) {
    cari = '';
    terbuka = id;
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
      judul: 'Tanya Rose',
      ringkas: 'Jawaban disertai sumber resmi',
      href: resolve('/'),
      gelap: true,
    },
    ...(kota?.situs
      ? [
          {
            ikon: 'instansi' as const,
            judul: `Disdukcapil ${kota.nama.replace(/^Kabupaten /, 'Kab. ')}`,
            ringkas: `Alamat dan jam layanan di situs resmi (${kota.situs.nama})`,
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

<div class="mx-auto w-full max-w-[67rem] px-4 py-6 sm:px-8 lg:py-7">
  <section
    class="pola-titik relative overflow-hidden rounded-[1.5rem] border border-line bg-gradient-to-br from-[#eef0f4] to-bg px-5 py-6 sm:px-7 sm:py-8"
  >
    <h2 class="max-w-[60%] text-[1.625rem] tracking-[-0.03em] text-ink sm:max-w-none sm:text-[1.75rem]">
      Ada yang bisa dibantu?
    </h2>
    <label for="cari-bantuan" class="sr-only">Cari bantuan</label>
    <div class="relative mt-4 max-w-[38rem]">
      <Icon
        name="cari"
        class="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
      />
      <input
        id="cari-bantuan"
        type="search"
        bind:value={cari}
        placeholder="Cari bantuan, misalnya: cara mengunggah dokumen"
        class="h-14 w-full rounded-full border border-line-2 bg-surface pr-4 pl-12 text-base text-ink placeholder:text-muted"
      />
    </div>
    <img
      src={blueBerpikir}
      alt=""
      width="160"
      height="160"
      class="pointer-events-none absolute -right-2 -bottom-2 hidden h-40 w-auto sm:block lg:right-8"
    />
  </section>

  <ul class="mt-5 grid gap-3 md:grid-cols-3">
    {#each TOPIK as t (t.ke)}
      <li>
        <a
          href="#tanya-{t.ke}"
          onclick={() => buka(t.ke)}
          class="flex min-h-24 items-center gap-4 rounded-kartu border border-line bg-surface p-3.5 hover:bg-card"
        >
          <img
            src={t.gambar}
            alt=""
            width="72"
            height="72"
            class="size-18 shrink-0 rounded-xl bg-bg-2 object-cover"
          />
          <span>
            <span class="block text-base font-semibold text-ink">{t.judul}</span>
            <span class="mt-0.5 block text-sm text-body">{t.ringkas}</span>
          </span>
        </a>
      </li>
    {/each}
  </ul>

  <div class="mt-5 grid items-start gap-4 lg:grid-cols-[1fr_23.75rem]">
    <section aria-labelledby="judul-faq" class="overflow-hidden rounded-kartu border border-line">
      <h2 id="judul-faq" class="bg-card px-4 py-3.5 text-base font-semibold text-ink">
        Pertanyaan yang sering ditanya
      </h2>
      {#each tampil as f (f.id)}
        <details
          id="tanya-{f.id}"
          open={terbuka === f.id || !!kata}
          class="group border-t border-line-3"
          ontoggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open) terbuka = f.id;
          }}
        >
          <summary
            class="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base text-ink group-open:font-semibold [&::-webkit-details-marker]:hidden"
          >
            {f.tanya}
            <Icon name="bawah" class="size-5 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div class="flex flex-col gap-2 px-4 pb-4 text-[0.9375rem] text-body">
            {#each f.jawab as p, i (i)}<p>{p}</p>{/each}
          </div>
        </details>
      {:else}
        <p class="border-t border-line-3 px-4 py-5 text-[0.9375rem] text-body">
          Belum ada jawaban untuk "{cari}". Coba kata lain, atau tanyakan langsung ke Rose.
        </p>
      {/each}
    </section>

    <ul class="flex flex-col gap-2.5">
      {#each pintasan as p (p.judul)}
        <li>
          <!-- eslint-disable svelte/no-navigation-without-resolve -- href sudah lewat resolve(), situs resmi, atau anchor -->
          <a
            href={p.href}
            target={p.luar ? '_blank' : undefined}
            rel={p.luar ? 'noopener noreferrer' : undefined}
            class="flex min-h-16 items-center gap-3 rounded-2xl px-3.5 py-3 {p.gelap
              ? 'bg-primer text-primer-ink hover:opacity-90'
              : 'border border-line bg-surface text-ink hover:bg-card'}"
          >
            <span
              class="grid size-10 shrink-0 place-items-center rounded-xl {p.gelap
                ? 'bg-white/10'
                : 'bg-bg-2'}"
            >
              <Icon name={p.ikon} class="size-5" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block font-semibold">{p.judul}</span>
              <span class="block text-sm {p.gelap ? 'opacity-80' : 'text-body'}">{p.ringkas}</span>
            </span>
            <Icon name="kanan" class="size-5 shrink-0" />
            {#if p.luar}<span class="sr-only">(membuka situs resmi di tab baru)</span>{/if}
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
        </li>
      {/each}
    </ul>
  </div>
</div>
