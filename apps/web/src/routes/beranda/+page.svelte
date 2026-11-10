<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import latarUtama1x from '#lib/assets/img/app/latar-utama-1156.webp';
  import latarUtama2x from '#lib/assets/img/app/latar-utama-2312.webp';
  import panggungMawar from '#lib/assets/img/app/panggung-mawar.webp';
  import panggungDaun from '#lib/assets/img/app/panggung-daun.webp';
  import panggungUngu from '#lib/assets/img/app/panggung-ungu.webp';
  import panggungBiru from '#lib/assets/img/app/panggung-biru.webp';
  import Icon from '#lib/components/Icon.svelte';
  import KartuBerjalan from '#lib/components/urusan/KartuBerjalan.svelte';
  import { DaftarUrusan } from '#lib/components/urusan/daftar.svelte.js';
  import { PERISTIWA, type Warna } from '#lib/peristiwa.js';
  import { ambilLokal } from '#lib/stores/app.svelte.js';
  import type { PageProps } from './$types';

  /** Beranda = App 01 (y9I9Jw) dari pen Rafi: kotak cerita, empat peristiwa hidup, urusan berjalan. */
  let { form }: PageProps = $props();

  const PANGGUNG: Partial<Record<Warna, string>> = {
    mawar: panggungMawar,
    daun: panggungDaun,
    ungu: panggungUngu,
    biru: panggungBiru,
  };

  const lokal = ambilLokal();
  const daftar = new DaftarUrusan();
  // svelte-ignore state_referenced_locally
  let pesan = $state(form?.pesan ?? '');
  let mengirim = $state(false);
  let bisaDikte = $state(false);
  let mendikte = $state(false);
  let hentikanDikte: (() => void) | undefined;

  const wilayah = $derived(lokal.data.wilayah);
  // Urusan yang menunggu warga tampil paling depan dan jadi kartu utama (App 01: "Tinjau rencana").
  const menungguWarga = (u: (typeof daftar.isi)[number]) =>
    !!u.ringkasan && /MENUNGGU|RENCANA_DIUSULKAN/.test(u.ringkasan.state);
  const berjalan = $derived(
    [...daftar.isi].sort((a, b) => Number(menungguWarga(b)) - Number(menungguWarga(a))).slice(0, 3),
  );
  const utamaId = $derived(berjalan.find(menungguWarga)?.id);

  $effect(() => {
    // Modul dikte dimuat saat tombol Bicara ditekan supaya JS awal Beranda tetap di bawah anggaran.
    bisaDikte = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    void daftar.muat(lokal.data.urusan);
  });

  async function bicara() {
    if (mendikte) {
      hentikanDikte?.();
      return;
    }
    mendikte = true;
    const { mulaiDikte } = await import('#lib/suara.js');
    hentikanDikte = mulaiDikte(
      (t) => (pesan = t),
      () => (mendikte = false),
    );
  }
</script>

<svelte:head>
  <title>Urusin: urus layanan publik bersama</title>
</svelte:head>

<div
  class="relative isolate flex flex-1 flex-col gap-12 overflow-x-clip px-4 pt-10 pb-10 sm:px-8 lg:px-16 lg:pt-[68px] lg:pb-12"
>
  <div
    class="latar-beranda pointer-events-none absolute top-0 left-1/2 -z-10 hidden h-[300px] w-[1156px] -translate-x-1/2 lg:block dark:hidden"
    style:--latar-1x="url({latarUtama1x})"
    style:--latar-2x="url({latarUtama2x})"
    aria-hidden="true"
  ></div>

  <section aria-labelledby="judul-beranda" class="flex w-full flex-col items-center gap-5 text-center">
    <h1
      id="judul-beranda"
      class="text-[32px] leading-[1.1] font-medium tracking-[-1.3px] text-ink sm:text-[40px] sm:leading-[44px]"
    >
      Apa yang ingin Anda urus?
    </h1>
    <p class="w-full max-w-[640px] text-base text-body sm:text-[17px] sm:leading-[25px]">
      Ceritakan dengan bahasa sehari-hari. Urusin mencari aturan resmi untuk {wilayah.nama}, lalu menyusun
      langkahnya.
    </p>

    <form
      method="POST"
      action="?/mulai"
      class="flex w-full max-w-[760px] flex-col gap-3.5 rounded-[22px] border border-line-2 bg-surface pt-[18px] pr-[18px] pb-3.5 pl-[22px] text-left shadow-[0_10px_30px_#2525220d,0_0_1px_#0000000f,0_1px_1px_#0000000f,0_2px_4px_#0000000a]"
      use:enhance={() => {
        mengirim = true;
        lokal.simpanTertunda(pesan);
        return async ({ update }) => {
          await update({ reset: false });
          mengirim = false;
        };
      }}
    >
      <label for="pesan" class="sr-only">Ceritakan urusan Anda</label>
      <textarea
        id="pesan"
        name="pesan"
        rows="1"
        maxlength="2000"
        required
        bind:value={pesan}
        aria-describedby={form?.pesanWarga ? 'galat-pesan' : undefined}
        placeholder="Contoh: Anak saya baru lahir, saya harus mengurus apa?"
        class="block max-h-60 min-h-[26px] w-full resize-none bg-transparent text-[18px] leading-[26px] text-ink [field-sizing:content] placeholder:text-muted focus:outline-none"
      ></textarea>
      <input type="hidden" name="kodeKabKota" value={wilayah.kodeKabKota} />
      {#if form?.pesanWarga}
        <p id="galat-pesan" role="alert" class="text-sm font-medium text-galat">{form.pesanWarga}</p>
      {/if}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          {#if bisaDikte}
            <button
              type="button"
              onclick={bicara}
              aria-pressed={mendikte}
              class="inline-flex h-10 items-center gap-2 rounded-full bg-bg-2 px-3.5 text-[15px] leading-[22px] text-card-ink transition-all duration-150 ease-out hover:bg-line-3 active:scale-95"
            >
              <Icon name="mikrofon" class="size-4 text-ink" />
              {mendikte ? 'Mendengarkan…' : 'Bicara'}
            </button>
          {/if}
          <a
            href="{resolve('/pengaturan')}#wilayah"
            class="inline-flex h-10 items-center gap-2 rounded-full border border-line-2 px-3.5 text-[15px] leading-[22px] text-ink transition-all duration-150 ease-out hover:bg-card active:scale-95"
          >
            <Icon name="lokasi" class="size-4 text-brand" />
            {wilayah.nama}
            <span class="sr-only">(ubah wilayah)</span>
          </a>
        </div>
        <button
          type="submit"
          disabled={mengirim}
          aria-busy={mengirim || undefined}
          class="inline-flex h-12 items-center gap-2 rounded-full bg-primer px-[22px] text-base leading-[23px] font-semibold text-primer-ink transition-all duration-150 ease-out hover:opacity-90 active:scale-[0.98] disabled:opacity-80"
        >
          Kirim
          <Icon name={mengirim ? 'memuat' : 'panah'} class="size-[17px] {mengirim ? 'animate-spin' : ''}" />
        </button>
      </div>
    </form>
  </section>

  <section aria-labelledby="judul-peristiwa" class="flex w-full flex-col gap-4">
    <div class="flex items-center justify-between">
      <h2 id="judul-peristiwa" class="text-[20px] leading-[29px] font-semibold tracking-[-0.3px] text-ink">
        Atau mulai dari peristiwa hidup
      </h2>
    </div>
    <ul class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {#each PERISTIWA as p (p.slug)}
        <li class="min-w-0">
          <a
            href={resolve('/peristiwa/[slug]', { slug: p.slug })}
            class="group flex h-full flex-col overflow-hidden rounded-[18px] border border-line bg-surface shadow-[0_0_1px_#0000000f,0_1px_1px_#0000000f,0_2px_4px_#0000000a] transition-all duration-200 hover:-translate-y-1 hover:shadow-md active:translate-y-0"
          >
            <span
              class="panggung panggung-{p.warna} relative block h-[140px] w-full overflow-hidden"
              style:--panggung="url({PANGGUNG[p.warna]})"
            >
              <img
                src={p.gambar}
                alt=""
                width="118"
                height="128"
                class="absolute top-3 left-1/2 h-32 w-[118px] -translate-x-1/2 object-contain transition-transform duration-250 ease-out group-hover:scale-105"
              />
            </span>
            <span class="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-4">
              <span
                class="flex items-center justify-between gap-2 text-[18px] leading-[26px] font-semibold text-ink"
              >
                {p.judul}
                <Icon
                  name="panah"
                  class="size-[18px] shrink-0 transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span class="text-[15px] leading-[21px] text-muted">{p.ringkas}</span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </section>

  {#if berjalan.length}
    <section aria-labelledby="judul-berjalan" class="flex w-full flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-x-4">
        <h2 id="judul-berjalan" class="text-[20px] leading-[29px] font-semibold tracking-[-0.3px] text-ink">
          Urusan berjalan
        </h2>
        <a
          href={resolve('/urusanku')}
          class="-my-2 inline-flex items-center gap-1 py-2 text-[15px] font-semibold text-ink hover:underline"
        >
          Lihat semua di Urusanku <Icon name="panah" class="size-4" />
        </a>
      </div>
      <div class="flex flex-col gap-3 md:flex-row">
        {#each berjalan as u (u.id)}
          <KartuBerjalan urusan={u} utama={u.id === utamaId} />
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  /*
   * Panggung kartu peristiwa: gambar gradasi bertitik dari pen mulai 640 px; di ponsel gradasi CSS dengan
   * warna yang sama (lebih ringan, dan gambar panggung tidak jadi elemen LCP).
   */
  .panggung-mawar {
    background: linear-gradient(#f3e3e2, #fcf8f5);
  }
  .panggung-daun {
    background: linear-gradient(#eaede5, #fcf8f5);
  }
  .panggung-ungu {
    background: linear-gradient(#f1e9f2, #fcf8f5);
  }
  .panggung-biru {
    background: linear-gradient(#e6eef4, #fcf8f5);
  }
  @media (min-width: 640px) {
    .panggung {
      background: var(--panggung) center / 100% 100% no-repeat;
    }
  }
  :global([data-theme='dark']) .panggung {
    background: var(--color-bg-2);
  }

  /* Titik halo di puncak panel (App 01 Main); CSS agar tidak diunduh di ponsel. */
  @media (min-width: 1024px) {
    .latar-beranda {
      background: image-set(var(--latar-1x) 1x, var(--latar-2x) 2x) top center / 1156px 300px no-repeat;
    }
  }
</style>
