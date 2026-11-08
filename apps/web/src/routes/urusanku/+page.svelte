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

<div class="mx-auto w-full max-w-[67rem] px-4 py-6 sm:px-8 lg:py-8">
  <h2 class="text-[1.75rem] tracking-[-0.03em] text-ink sm:text-[2rem]">Urusan keluarga Anda</h2>
  <p class="mt-1 text-base text-body">Lihat siapa yang sedang ditunggu dan apa langkah berikutnya.</p>

  <div role="group" aria-label="Saring urusan" class="mt-6 flex gap-2 overflow-x-auto pb-1">
    {#each FILTER as f (f.nilai)}
      {@const pilih = filter === f.nilai}
      <button
        type="button"
        aria-pressed={pilih}
        onclick={() => (filter = f.nilai)}
        class="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full px-4 text-[0.9375rem] {pilih
          ? 'bg-primer font-semibold text-primer-ink'
          : 'border border-line-2 bg-surface text-ink hover:bg-card'}"
      >
        {f.label}
        <span
          class="grid min-w-6 place-items-center rounded-full px-1.5 text-[0.75rem] font-semibold {pilih
            ? 'bg-white/20'
            : 'bg-bg-2'}">{jumlah[f.nilai]}</span
        >
      </button>
    {/each}
  </div>

  {#if daftar.galat}
    <p role="alert" class="mt-4 rounded-xl bg-kuning px-4 py-3 text-[0.9375rem] text-kuning-ink">
      Status terbaru belum bisa dimuat. Periksa koneksi, lalu buka lagi halaman ini.
    </p>
  {/if}

  {#if tampil.length}
    <div class="mt-5 grid gap-4 md:grid-cols-2">
      {#each tampil as u (u.id)}
        <KartuUrusanku urusan={u} utama={u.id === utamaId} />
      {/each}
    </div>
  {:else if dimuat || !lokal.data.urusan.length}
    <div class="mt-8 flex flex-col items-center gap-3 rounded-kartu bg-card px-6 py-10 text-center">
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
        href={resolve('/')}
        class="mt-2 inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink hover:opacity-90"
      >
        <Icon name="tambah" class="size-4.5" /> Mulai urusan
      </a>
    </div>
  {:else}
    <div class="mt-5 grid gap-4 md:grid-cols-2" aria-hidden="true">
      {#each [0, 1] as i (i)}<div class="h-56 animate-pulse rounded-kartu bg-card"></div>{/each}
    </div>
  {/if}
</div>
