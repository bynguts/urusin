<script lang="ts">
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';

  /**
   * Kartu "Urusin mengingat: ..." (ADR 0031): satu baris sistem untuk butir Ingatan warga yang baru disimpan, dengan
   * tombol Batalkan (hapus butir itu dari ingatan). Pola visual = baris sistem linimasa + tombol teks "Ubah" Data
   * Diri; tidak ada gaya baru.
   */
  let {
    ingatan,
    dibatalkan = false,
    onbatalkan,
  }: {
    ingatan: EventOf<'ingatan'>;
    dibatalkan?: boolean;
    onbatalkan: () => Promise<boolean>;
  } = $props();

  let sibuk = $state(false);
  let gagal = $state(false);
  let batal = $state(false);
  const selesai = $derived(dibatalkan || batal);

  async function batalkan() {
    sibuk = true;
    gagal = false;
    const ok = await onbatalkan();
    sibuk = false;
    if (ok) batal = true;
    else gagal = true;
  }
</script>

<p
  data-ingatan
  class="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-sm leading-[21px] text-muted"
>
  <Icon name={ingatan.aksi === 'hapus' || selesai ? 'hapus' : 'riwayat'} class="size-4 shrink-0" />
  {#if ingatan.aksi === 'hapus'}
    Urusin melupakan: {ingatan.butir.label}
  {:else if selesai}
    Dibatalkan, Urusin tidak mengingat: {ingatan.butir.label}
  {:else}
    Urusin mengingat: {ingatan.butir.label}
    <button
      type="button"
      onclick={batalkan}
      disabled={sibuk}
      aria-busy={sibuk || undefined}
      class="-my-3 inline-flex h-11 items-center rounded-full px-3 text-sm font-semibold text-ink hover:bg-bg-2 disabled:opacity-60"
      >Batalkan<span class="sr-only"> ingatan {ingatan.butir.label}</span></button
    >
  {/if}
  {#if gagal}<span role="status" class="w-full text-galat">Gagal membatalkan. Coba lagi.</span>{/if}
</p>
