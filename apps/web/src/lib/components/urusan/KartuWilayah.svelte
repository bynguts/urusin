<script lang="ts">
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';

  /**
   * Kartu wilayah dulu: usulan kab/kota KTP (dari Data Diri akun atau pilihan di perangkat) yang harus dibenarkan
   * warga sebelum rencana disusun. "Ya, betul" = aksi terstruktur; "Bukan" mengisi kolom pesan untuk menyebut
   * kab/kota yang benar. Tombol hanya aktif pada usulan terakhir yang belum dijawab.
   */
  let {
    usulan,
    aktif,
    sibuk = false,
    onbenar,
    onbukan,
  }: {
    usulan: EventOf<'wilayah'>;
    aktif: boolean;
    sibuk?: boolean;
    onbenar: () => void;
    onbukan: () => void;
  } = $props();

  const asal = $derived(
    usulan.sumber === 'data_diri'
      ? 'Data Diri akun Anda'
      : usulan.sumber === 'warga'
        ? 'percakapan ini'
        : usulan.sumber === 'ingatan'
          ? 'yang Urusin ingat dari urusan Anda sebelumnya'
          : 'pilihan wilayah di perangkat ini',
  );
</script>

<section
  aria-label="Konfirmasi wilayah KTP"
  class="overflow-hidden rounded-[18px] border border-line bg-surface shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]"
>
  <div class="flex gap-3 px-4 py-3.5 sm:px-[18px]">
    <Icon name="lokasi" class="mt-1 size-[18px] shrink-0 text-brand" />
    <div class="min-w-0 flex-1">
      <h3 class="text-[17px] leading-[26px] font-semibold text-ink">
        KTP Anda terdaftar di {usulan.ktp.nama}?
      </h3>
      <p class="mt-1 text-sm leading-[21px] text-body">
        Aturan dan situs resmi berbeda di tiap kab/kota. Usulan ini dari {asal}; rencana disusun setelah Anda
        memastikannya.
      </p>
    </div>
  </div>
  {#if aktif}
    <footer class="flex flex-wrap items-center gap-2.5 border-t border-line px-4 pt-3 pb-4 sm:px-[18px]">
      <button
        type="button"
        onclick={onbenar}
        disabled={sibuk}
        aria-busy={sibuk || undefined}
        class="inline-flex h-12 items-center gap-2 rounded-full bg-primer px-[22px] text-base leading-6 font-semibold text-primer-ink hover:opacity-90 disabled:opacity-80"
      >
        <Icon name={sibuk ? 'memuat' : 'centang'} class="size-[18px] {sibuk ? 'animate-spin' : ''}" />
        Ya, betul
      </button>
      <button
        type="button"
        onclick={onbukan}
        disabled={sibuk}
        class="inline-flex h-12 items-center rounded-full border border-line-2 bg-surface px-5 text-base leading-6 text-ink hover:bg-card"
        >Bukan</button
      >
    </footer>
  {/if}
</section>
