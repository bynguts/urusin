<script lang="ts">
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';
  import { domain } from '#lib/urusan-status.js';
  import { barisKonfirmasi } from './linimasa.js';

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

  const baris = $derived(barisKonfirmasi(permintaan?.params ?? {}));
</script>

<section
  aria-label="Periksa sebelum AI mengisi"
  class="overflow-hidden rounded-[18px] border border-line bg-surface shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]"
>
  <header class="flex min-h-[64.5px] flex-wrap items-center gap-3 border-b border-line bg-card px-4 py-3">
    <span class="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#2f6b4f] text-white">
      <Icon name="instansi" class="size-[18px]" />
    </span>
    <div class="min-w-0 flex-1">
      <h2 class="text-base leading-[22px] font-semibold text-ink">
        {permintaan?.ringkasan || gate.pesan || 'Formulir resmi'}
      </h2>
      {#if situs}
        <p class="flex items-center gap-[5px] text-sm leading-[19px] text-card-ink">
          <Icon name="gembok" class="size-3" />{domain(situs)}
        </p>
      {/if}
    </div>
    <span
      class="inline-flex items-center gap-[5px] rounded-full bg-hijau px-2.5 py-1 text-[13px] leading-5 font-semibold text-hijau-ink"
      ><Icon name="perisai-centang" class="size-[13px]" />Situs resmi</span
    >
  </header>

  {#if baris.length}
    <dl class="grid sm:grid-cols-2">
      {#each baris as [label, nilai], i (i)}
        <div
          class="flex min-h-[53.5px] flex-col justify-center border-b border-line px-4 py-1.5 sm:odd:border-r"
        >
          <dt class="text-[13px] leading-[17px] text-muted">{label}</dt>
          <dd class="text-base leading-[22px] text-ink">{nilai}</dd>
        </div>
      {/each}
    </dl>
  {:else if gate.pesan && permintaan?.ringkasan}
    <p class="border-b border-line px-4 py-3 text-[15px] text-body">{gate.pesan}</p>
  {/if}

  <p class="flex items-center gap-2.5 bg-kuning px-4 py-3 text-sm leading-5 text-kuning-ink">
    <Icon name="info" class="size-4 shrink-0" />
    <span>
      Anda akan masuk akun di Browser Pendamping. Kata sandi tidak disimpan. AI hanya mengisi kolom dan
      mengunggah berkas; tombol Kirim tetap Anda yang tekan. Persetujuan berlaku 10 menit.
    </span>
  </p>

  {#if pesanGalat}
    <p role="alert" class="px-4 pt-3 text-[15px] font-medium text-galat">{pesanGalat}</p>
  {/if}

  {#if aktif && status !== 'disetujui'}
    <footer class="flex flex-wrap items-center gap-2.5 px-4 pt-3 pb-3.5">
      <button
        type="button"
        onclick={onbatal}
        class="inline-flex h-[46px] items-center rounded-full border border-line-2 bg-surface px-5 text-base leading-6 text-ink hover:bg-card"
        >Batalkan</button
      >
      <button
        type="button"
        onclick={onsetujui}
        disabled={status === 'mengirim'}
        aria-busy={status === 'mengirim' || undefined}
        class="inline-flex h-[52px] items-center gap-2 rounded-full bg-primer px-[22px] text-base leading-6 font-semibold text-primer-ink hover:opacity-90 disabled:opacity-80"
      >
        <Icon
          name={status === 'mengirim' ? 'memuat' : 'centang'}
          class="size-[18px] {status === 'mengirim' ? 'animate-spin' : ''}"
        />
        Setujui dan buka situs
      </button>
    </footer>
  {:else if status === 'disetujui'}
    <p class="flex items-center gap-2 px-4 py-3.5 text-[15px] font-medium text-hijau-ink">
      <Icon name="centang-bulat" class="size-4.5" /> Anda sudah menyetujui. Browser Pendamping dibuka.
    </p>
  {/if}
</section>
