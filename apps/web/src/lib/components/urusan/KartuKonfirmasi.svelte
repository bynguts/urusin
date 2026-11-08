<script lang="ts">
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';
  import Chip from '../ui/Chip.svelte';
  import { domain } from '#lib/urusan-status.js';
  import { labelParam, nilaiParam } from './linimasa.js';

  /**
   * Konfirmasi sebelum AI bekerja (App 05): situs + instansi tujuan, ringkasan isian tersamar, peringatan
   * bahwa tombol Kirim tetap milik warga, lalu Batalkan / Setujui dan buka situs.
   */
  let {
    gate,
    permintaan,
    situs,
    aktif,
    status = 'menunggu',
    pesanGalat,
    onsetujui,
    onbatal,
  }: {
    gate: EventOf<'gate'>;
    permintaan: EventOf<'execution_request'> | null;
    /** URL situs resmi tujuan (dari rencana), bila diketahui. */
    situs: string | null;
    aktif: boolean;
    status?: 'menunggu' | 'mengirim' | 'disetujui';
    pesanGalat?: string | undefined;
    onsetujui: () => void;
    onbatal: () => void;
  } = $props();

  const baris = $derived(Object.entries(permintaan?.params ?? {}).slice(0, 12));
</script>

<section
  aria-label="Periksa sebelum AI mengisi"
  class="overflow-hidden rounded-2xl border border-line bg-surface shadow-lembut"
>
  <header class="flex flex-wrap items-center gap-3 border-b border-line-3 bg-card px-4 py-3.5 sm:px-5">
    <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-[#2f6b4f] text-white">
      <Icon name="instansi" class="size-5" />
    </span>
    <div class="min-w-0 flex-1">
      <h3 class="text-base font-semibold text-ink">
        {permintaan?.ringkasan || gate.pesan || 'Formulir resmi'}
      </h3>
      {#if situs}
        <p class="flex items-center gap-1 text-sm text-body">
          <Icon name="gembok" class="size-3.5" />{domain(situs)}
        </p>
      {/if}
    </div>
    <Chip nada="hijau" ikon="perisai-centang">Situs resmi</Chip>
  </header>

  {#if baris.length}
    <dl class="grid sm:grid-cols-2">
      {#each baris as [k, v] (k)}
        <div class="border-b border-line-3 px-4 py-2.5 sm:px-5 sm:odd:border-r">
          <dt class="text-[0.8125rem] text-muted">{labelParam(k)}</dt>
          <dd class="text-base text-ink">{nilaiParam(v)}</dd>
        </div>
      {/each}
    </dl>
  {:else if gate.pesan && permintaan?.ringkasan}
    <p class="border-b border-line-3 px-4 py-3 text-[0.9375rem] text-body sm:px-5">{gate.pesan}</p>
  {/if}

  <p class="flex gap-2.5 bg-kuning px-4 py-3.5 text-[0.9375rem] text-kuning-ink sm:px-5">
    <Icon name="info" class="mt-0.5 size-4.5 shrink-0" />
    <span>
      Anda akan masuk akun di Browser Pendamping. Kata sandi tidak disimpan. AI hanya mengisi kolom dan
      mengunggah berkas; tombol Kirim tetap Anda yang tekan. Persetujuan berlaku 10 menit.
    </span>
  </p>

  {#if pesanGalat}
    <p role="alert" class="px-4 pt-3 text-[0.9375rem] font-medium text-galat sm:px-5">{pesanGalat}</p>
  {/if}

  {#if aktif && status !== 'disetujui'}
    <footer class="flex flex-wrap gap-3 px-4 py-3.5 sm:px-5">
      <button
        type="button"
        onclick={onbatal}
        class="inline-flex min-h-12 items-center rounded-full border border-line-2 bg-surface px-5 text-base text-ink hover:bg-card"
        >Batalkan</button
      >
      <button
        type="button"
        onclick={onsetujui}
        disabled={status === 'mengirim'}
        aria-busy={status === 'mengirim' || undefined}
        class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-5 text-base font-semibold text-primer-ink hover:opacity-90 disabled:opacity-80"
      >
        <Icon
          name={status === 'mengirim' ? 'memuat' : 'centang'}
          class="size-4.5 {status === 'mengirim' ? 'animate-spin' : ''}"
        />
        Setujui dan buka situs
      </button>
    </footer>
  {:else if status === 'disetujui'}
    <p class="flex items-center gap-2 px-4 py-3.5 text-[0.9375rem] font-medium text-hijau-ink sm:px-5">
      <Icon name="centang-bulat" class="size-4.5" /> Anda sudah menyetujui. Browser Pendamping dibuka.
    </p>
  {/if}
</section>
