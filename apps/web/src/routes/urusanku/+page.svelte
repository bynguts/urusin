<script lang="ts">
  import { resolve } from '$app/paths';
  import Icon from '#lib/components/Icon.svelte';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import KartuUrusanku from '#lib/components/urusan/KartuUrusanku.svelte';
  import { DaftarUrusan } from '#lib/components/urusan/daftar.svelte.js';
  import { ambilLokal } from '#lib/stores/app.svelte.js';
  import { infoStatus } from '#lib/urusan-status.js';

  /** Urusanku (App 10, ★8 Lacak): semua urusan di perangkat ini, siapa yang ditunggu, langkah berikutnya. */
  const lokal = ambilLokal();
  const daftar = new DaftarUrusan();
  let filter = $state<'semua' | 'anda' | 'instansi' | 'selesai'>('semua');
  let dimuat = $state(false);

  $effect(() => {
    void daftar.muat(lokal.data.urusan).then(() => (dimuat = true));
  });

  const kelompok = (u: (typeof daftar.isi)[number]) => infoStatus(u.ringkasan?.state).kelompok;
  const jumlah = $derived({
    semua: daftar.isi.length,
    anda: daftar.isi.filter((u) => kelompok(u) === 'anda').length,
    instansi: daftar.isi.filter((u) => kelompok(u) === 'instansi').length,
    selesai: daftar.isi.filter((u) => kelompok(u) === 'selesai').length,
  });
  const tampil = $derived(filter === 'semua' ? daftar.isi : daftar.isi.filter((u) => kelompok(u) === filter));
  const utamaId = $derived(daftar.isi.find((u) => kelompok(u) === 'anda')?.id);

  const FILTER = [
    { nilai: 'semua', label: 'Semua' },
    { nilai: 'anda', label: 'Menunggu Anda' },
    { nilai: 'instansi', label: 'Menunggu instansi' },
    { nilai: 'selesai', label: 'Selesai' },
  ] as const;
</script>

<svelte:head><title>Urusanku · Urusin</title></svelte:head>

<HeaderHalaman judul="Urusanku" />

<div class="flex w-full flex-col gap-6 px-4 py-5 sm:px-10 sm:py-6">
  <div role="group" aria-label="Saring urusan" class="flex flex-wrap items-center gap-2">
    {#each FILTER as f (f.nilai)}
      {@const pilih = filter === f.nilai}
      <button
        type="button"
        aria-pressed={pilih}
        onclick={() => (filter = f.nilai)}
        class="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium {pilih
          ? 'bg-primer font-semibold text-primer-ink shadow-xs'
          : 'border border-line-2 bg-surface text-ink hover:bg-card hover:border-line'}"
      >
        {f.label}
        <span
          class="rounded-full px-2 py-0.5 text-xs font-semibold {pilih
            ? 'bg-white/20 text-primer-ink'
            : 'bg-bg-2 text-card-ink'}">{jumlah[f.nilai]}</span
        >
      </button>
    {/each}
  </div>

  {#if daftar.galat}
    <p role="alert" class="rounded-xl bg-kuning px-4 py-3 text-[0.9375rem] text-kuning-ink">
      Status terbaru belum bisa dimuat. Periksa koneksi, lalu buka lagi halaman ini.
    </p>
  {/if}

  {#if tampil.length}
    <div class="grid gap-4 md:grid-cols-2">
      {#each tampil as u (u.id)}
        <KartuUrusanku urusan={u} utama={u.id === utamaId} />
      {/each}
    </div>
  {:else if dimuat || !lokal.data.urusan.length}
    <div class="mt-3 flex flex-col items-center gap-3 rounded-kartu bg-card px-6 py-10 text-center">
      <span class="grid size-12 place-items-center rounded-full bg-bg-2"
        ><Icon name="urusanku" class="size-6" /></span
      >
      <p class="text-lg font-semibold text-ink">
        {filter === 'semua' ? 'Belum ada urusan di perangkat ini' : 'Tidak ada urusan di kelompok ini'}
      </p>
      <p class="max-w-md text-[0.9375rem] text-body">
        Urusan yang Anda mulai akan muncul di sini beserta statusnya.
      </p>
      <a
        href={resolve('/beranda')}
        class="mt-2 inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink"
      >
        <Icon name="tambah" class="size-4.5" /> Mulai urusan
      </a>
    </div>
  {:else}
    <div class="grid gap-4 md:grid-cols-2" aria-hidden="true">
      {#each [0, 1] as i (i)}<div class="h-56 animate-pulse rounded-kartu bg-card"></div>{/each}
    </div>
  {/if}
</div>
