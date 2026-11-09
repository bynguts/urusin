<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import Icon from '#lib/components/Icon.svelte';
  import Ringkasan from '#lib/components/ringkasan/Ringkasan.svelte';
  import KartuBerjalan from '#lib/components/urusan/KartuBerjalan.svelte';
  import { DaftarUrusan } from '#lib/components/urusan/daftar.svelte.js';
  import { PERISTIWA } from '#lib/peristiwa.js';
  import { ambilLokal } from '#lib/stores/app.svelte.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const lokal = ambilLokal();
  const daftar = new DaftarUrusan();
  // svelte-ignore state_referenced_locally
  let pesan = $state(form?.pesan ?? '');
  let mengirim = $state(false);
  let bisaDikte = $state(false);
  let mendikte = $state(false);
  let hentikanDikte: (() => void) | undefined;

  const wilayah = $derived(lokal.data.wilayah);
  const berjalan = $derived(daftar.isi.slice(0, 3));
  const utamaId = $derived(
    berjalan.find((u) => u.ringkasan && /MENUNGGU|RENCANA_DIUSULKAN/.test(u.ringkasan.state))?.id,
  );

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

{#if data.urusan}
  <Ringkasan urusan={data.urusan} demo={data.demo} />
{:else}
  <div class="relative flex flex-1 flex-col">
    <div
      class="pola-titik pointer-events-none absolute inset-x-0 top-0 h-80 [mask-image:linear-gradient(to_bottom,black,transparent)] lg:rounded-t-2xl"
      aria-hidden="true"
    ></div>

    <section
      aria-labelledby="judul-beranda"
      class="relative mx-auto flex w-full max-w-[47.5rem] flex-col items-center px-4 pt-10 text-center sm:pt-14 lg:pt-18"
    >
      <h1
        id="judul-beranda"
        class="text-[2rem] leading-[1.1] font-[480] tracking-[-0.04em] text-ink sm:text-[2.5rem] lg:text-[2.75rem]"
      >
        Apa yang ingin Anda urus?
      </h1>
      <p class="mt-4 max-w-[36rem] text-base text-body sm:text-[1.0625rem]">
        Ceritakan dengan bahasa sehari-hari. Urusin mencari aturan resmi untuk {wilayah.nama}, lalu menyusun
        langkahnya.
      </p>

      <form
        method="POST"
        action="?/mulai"
        class="mt-8 w-full rounded-[1.25rem] border border-line bg-surface p-4 text-left shadow-lembut sm:p-5"
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
          rows="2"
          maxlength="2000"
          required
          bind:value={pesan}
          aria-describedby={form?.pesanWarga ? 'galat-pesan' : undefined}
          placeholder="Contoh: Anak saya baru lahir, saya harus mengurus apa?"
          class="block w-full resize-none bg-transparent px-1 text-[1.0625rem] text-ink placeholder:text-muted focus:outline-none"
        ></textarea>
        <input type="hidden" name="kodeKabKota" value={wilayah.kodeKabKota} />
        {#if form?.pesanWarga}
          <p id="galat-pesan" role="alert" class="mt-2 px-1 text-sm font-medium text-galat">
            {form.pesanWarga}
          </p>
        {/if}
        <div class="mt-3 flex flex-wrap items-center gap-2">
          {#if bisaDikte}
            <button
              type="button"
              onclick={bicara}
              aria-pressed={mendikte}
              class="inline-flex min-h-12 items-center gap-2 rounded-full bg-bg-2 px-4 text-[0.9375rem] text-ink hover:bg-line-3"
            >
              <Icon name="mikrofon" class="size-4.5" />
              {mendikte ? 'Mendengarkan…' : 'Bicara'}
            </button>
          {/if}
          <a
            href="{resolve('/pengaturan')}#wilayah"
            class="inline-flex min-h-12 items-center gap-2 rounded-full border border-line-2 px-4 text-[0.9375rem] text-ink hover:bg-card"
          >
            <Icon name="lokasi" class="size-4.5 text-brand" />
            {wilayah.nama}
            <span class="sr-only">(ubah wilayah)</span>
          </a>
          <button
            type="submit"
            disabled={mengirim}
            aria-busy={mengirim || undefined}
            class="ml-auto inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 text-base font-semibold text-primer-ink hover:opacity-90 disabled:opacity-80"
          >
            Kirim
            <Icon name={mengirim ? 'memuat' : 'panah'} class="size-4.5 {mengirim ? 'animate-spin' : ''}" />
          </button>
        </div>
      </form>
    </section>

    <section
      aria-labelledby="judul-peristiwa"
      class="relative mx-auto w-full max-w-[64rem] px-4 pt-12 sm:px-8 lg:pt-14"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="judul-peristiwa" class="text-lg font-semibold tracking-tight text-ink sm:text-xl">
          Atau mulai dari peristiwa hidup
        </h2>
        <p class="text-[0.9375rem] text-muted">Tersedia panduan untuk {PERISTIWA.length} peristiwa</p>
      </div>
      <ul class="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {#each PERISTIWA as p (p.slug)}
          <li>
            <a
              href={resolve('/peristiwa/[slug]', { slug: p.slug })}
              class="group flex h-full flex-col overflow-hidden rounded-[1.125rem] border border-line bg-surface shadow-lembut transition-shadow hover:shadow-md"
            >
              <span
                class="kartu-{p.warna} relative flex h-28 items-end justify-center overflow-hidden sm:h-36"
              >
                <span class="pola-titik absolute inset-0 opacity-60" aria-hidden="true"></span>
                <img
                  src={p.gambar}
                  alt=""
                  width="176"
                  height="192"
                  class="relative h-[92%] w-auto object-contain"
                />
              </span>
              <span class="flex flex-1 flex-col gap-1 border-t border-line-3 p-4">
                <span
                  class="flex items-center justify-between gap-2 text-base font-semibold text-ink sm:text-lg"
                >
                  {p.judul}
                  <Icon
                    name="panah"
                    class="size-4.5 shrink-0 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
                <span class="text-sm text-muted sm:text-[0.9375rem]">{p.ringkas}</span>
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </section>

    {#if berjalan.length}
      <section
        aria-labelledby="judul-berjalan"
        class="relative mx-auto w-full max-w-[64rem] px-4 pt-12 pb-10 sm:px-8 lg:pb-12"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="judul-berjalan" class="text-lg font-semibold tracking-tight text-ink sm:text-xl">
            Urusan berjalan
          </h2>
          <a
            href={resolve('/urusanku')}
            class="inline-flex min-h-12 items-center gap-1.5 text-[0.9375rem] font-semibold text-ink hover:underline"
          >
            Lihat semua di Urusanku <Icon name="panah" class="size-4" />
          </a>
        </div>
        <div class="mt-3 grid gap-3 md:grid-cols-3">
          {#each berjalan as u (u.id)}
            <KartuBerjalan urusan={u} utama={u.id === utamaId} />
          {/each}
        </div>
      </section>
    {:else}
      <div class="pb-10"></div>
    {/if}
  </div>
{/if}

<style>
  .kartu-mawar {
    background: linear-gradient(180deg, var(--sb-badge-rose-bg), var(--sb-bg-white));
  }
  .kartu-daun {
    background: linear-gradient(180deg, var(--sb-badge-green-bg), var(--sb-bg-white));
  }
  .kartu-ungu {
    background: linear-gradient(180deg, var(--sb-badge-purple-bg), var(--sb-bg-white));
  }
  .kartu-biru {
    background: linear-gradient(180deg, var(--sb-badge-blue-bg), var(--sb-bg-white));
  }
  .kartu-kuning {
    background: linear-gradient(180deg, var(--ur-amber-bg), var(--sb-bg-white));
  }
</style>
