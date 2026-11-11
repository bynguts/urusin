<script lang="ts" module>
  /** Status butir menurut GET /api/ingatan: `undefined` = belum dimuat, `null` = sudah tidak diingat. */
  export type IngatanLive = { status: 'butir' | 'usulan'; label: string } | null | undefined;
  /** Hasil Batalkan/Tidak: dihapus sekarang, sudah tidak ada sebelumnya (404, dicek ulang), atau gagal. */
  export type HasilBatal = 'dihapus' | 'tidak_ada' | 'gagal';
</script>

<script lang="ts">
  import { resolve } from '$app/paths';
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';

  /**
   * Kartu "Urusin mengingat: ..." (ADR 0031): satu baris sistem untuk butir Ingatan warga, dengan tombol Batalkan.
   * Event hanya membawa label generik untuk catatan/aksesibilitas; isinya diambil live dari GET /api/ingatan
   * (`live`), sehingga kartu yang dibatalkan tidak menampilkan isi. Aksi `usulan` (butir sensitif) = kartu
   * persetujuan "Ingat bahwa Anda …? [Ya, ingat] [Tidak]". Pola visual = baris sistem linimasa + tombol teks;
   * tidak ada gaya baru.
   */
  let {
    ingatan,
    dibatalkan = false,
    live,
    onbatalkan,
    onsetujui,
  }: {
    ingatan: EventOf<'ingatan'>;
    dibatalkan?: boolean;
    live: IngatanLive;
    onbatalkan: () => Promise<HasilBatal>;
    onsetujui: () => Promise<boolean>;
  } = $props();

  let sibuk = $state(false);
  let gagal = $state<string | null>(null);
  let batal = $state(false);
  const usulan = $derived(live?.status === 'usulan' || (live === undefined && ingatan.aksi === 'usulan'));
  const label = $derived(ingatan.butir.label);
  const tombol =
    '-my-3 inline-flex h-11 items-center rounded-full px-3 text-sm font-semibold text-ink hover:bg-bg-2 disabled:opacity-60';

  async function setujui() {
    sibuk = true;
    gagal = null;
    if (!(await onsetujui())) gagal = 'Gagal menyimpan. Coba lagi.';
    sibuk = false;
  }

  /** 404 bukan "Dibatalkan": status sebenarnya diambil dari daftar yang dimuat ulang (`live`). */
  async function batalkan() {
    sibuk = true;
    gagal = null;
    const h = await onbatalkan();
    if (h === 'dihapus') batal = true;
    else if (h === 'gagal') gagal = 'Gagal membatalkan. Coba lagi.';
    sibuk = false;
  }
</script>

<p
  data-ingatan
  class="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-sm leading-[21px] text-muted"
>
  <Icon
    name={ingatan.aksi === 'hapus' || dibatalkan || batal || live === null ? 'hapus' : 'riwayat'}
    class="size-4 shrink-0"
  />
  {#if ingatan.aksi === 'hapus'}
    Urusin melupakan: {label}
  {:else if dibatalkan || batal}
    Dibatalkan, Urusin tidak mengingat: {label}
  {:else if live === null}
    Urusin tidak mengingat: {label}
    <a href="{resolve('/pengaturan')}#ingatan" class={tombol}>Lihat yang diingat</a>
  {:else if usulan}
    {live?.label ?? 'Ingat kebutuhan aksesibilitas yang Anda sebut tadi?'}
    <button type="button" onclick={setujui} disabled={sibuk} aria-busy={sibuk || undefined} class={tombol}
      >Ya, ingat</button
    >
    <button type="button" onclick={batalkan} disabled={sibuk} class={tombol}>Tidak</button>
  {:else}
    Urusin mengingat: {live?.label ?? label}
    <button type="button" onclick={batalkan} disabled={sibuk} aria-busy={sibuk || undefined} class={tombol}
      >Batalkan<span class="sr-only"> ingatan {label}</span></button
    >
  {/if}
  {#if gagal}<span role="status" class="w-full text-galat">{gagal}</span>{/if}
</p>
