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
    <!-- Frame rFa2b: "Belum ada urusan" -->
    <div class="mt-8 max-w-[27rem] rounded-[1.25rem] border border-line bg-bg p-6">
      <Icon name="obrolan" class="size-6 text-hijau-ink" />
      <p class="mt-4 text-[1.3125rem] leading-[1.25] font-normal tracking-[-0.02em] text-ink">
        {filter === 'semua' ? 'Belum ada urusan' : 'Tidak ada urusan di kelompok ini'}
      </p>
      <p class="mt-3 text-[0.9375rem] leading-[1.6] text-muted">
        Mulai dengan cerita singkat. Anda belum perlu menyiapkan dokumen.
      </p>
      <a
        href={resolve('/beranda')}
        class="mt-4 inline-flex min-h-12 items-center gap-3 font-semibold text-ink hover:opacity-70"
      >
        <Icon name="panah" class="size-[1.125rem]" /> Ceritakan kebutuhan
      </a>
    </div>
  {:else}
    <div class="mt-5 grid gap-4 md:grid-cols-2" aria-hidden="true">
      {#each [0, 1] as i (i)}<div class="h-56 animate-pulse rounded-kartu bg-card"></div>{/each}
    </div>
  {/if}
</div>
