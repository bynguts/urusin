<script lang="ts">
  import Icon from '../Icon.svelte';
  import { labelPlaceholder } from '#lib/pendamping/isi-data.js';

  /**
   * Lembar "Izinkan isi": sebelum AI mulai, warga melihat data Data Diri dan berkas yang akan dikirim ke sesi
   * Browser Pendamping (hanya di memori sesi itu). Tolak = warga mengisi sendiri (ambil alih).
   */
  let {
    buka,
    placeholder,
    berkas,
    sibuk = false,
    pesan,
    onizinkan,
    ontolak,
  }: {
    buka: boolean;
    placeholder: readonly string[];
    berkas: readonly string[];
    sibuk?: boolean;
    pesan?: string | undefined;
    onizinkan: () => void;
    ontolak: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  const label = $derived([...new Set(placeholder.map(labelPlaceholder))]);

  $effect(() => {
    if (!dialog) return;
    if (buka && !dialog.open) dialog.showModal();
    if (!buka && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="judul-izinkan"
  oncancel={(e) => {
    e.preventDefault();
    ontolak();
  }}
  class="m-auto w-[min(27rem,calc(100vw-2rem))] rounded-[1.25rem] bg-bg-2 p-0 text-ink shadow-lembut backdrop:bg-black/40 max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none"
>
  <div class="flex flex-col p-6">
    <Icon name="perisai-centang" class="size-6 text-hijau-ink" />
    <h2 id="judul-izinkan" class="mt-8 text-[1.625rem] leading-[1.15] font-normal tracking-[-0.035em]">
      Periksa sebelum<br />memberi izin.
    </h2>
    <p class="mt-5 text-[0.9375rem] text-muted">Tujuan: formulir pada situs resmi yang didukung.</p>
    {#if label.length || berkas.length}
      <div class="mt-6 rounded-xl bg-surface p-5">
        <p class="text-base font-semibold">Data yang akan dipakai</p>
        <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-[0.875rem]">
          {#each label as l (l)}
            <dt class="text-muted">{l}</dt>
            <dd class="font-semibold">Dari Data Diri</dd>
          {/each}
          {#each berkas as b (b)}
            <dt class="text-muted">Berkas</dt>
            <dd class="font-semibold">{b.toUpperCase()}</dd>
          {/each}
        </dl>
      </div>
    {/if}
    <p class="mt-6 text-[0.9375rem] leading-[1.6] text-muted">
      {berkas.length
        ? 'Hanya mengisi kolom dan mengunggah berkas yang tercantum. Tidak mengirim formulir.'
        : 'Hanya mengisi kolom yang tercantum. Tidak mengirim formulir. Unggah berkas memerlukan izin terpisah.'}
    </p>
    {#if pesan}
      <p role="alert" class="mt-4 rounded-xl bg-kuning px-4 py-3 text-[0.9375rem] text-kuning-ink">{pesan}</p>
    {/if}
    <button
      type="button"
      onclick={onizinkan}
      disabled={sibuk}
      aria-busy={sibuk || undefined}
      class="mt-6 inline-flex h-[3.25rem] items-center justify-center gap-3 rounded-full bg-primer px-6 text-base font-semibold text-primer-ink hover:opacity-90 disabled:opacity-80"
    >
      <Icon name={sibuk ? 'memuat' : 'panah'} class="size-[1.125rem] {sibuk ? 'animate-spin' : ''}" /> Izinkan pengisian
      ini
    </button>
    <button
      type="button"
      onclick={ontolak}
      class="mt-5 inline-flex h-[3.25rem] items-center rounded-full bg-surface px-6 text-base font-semibold shadow-lembut hover:opacity-90"
      >Batal</button
    >
    <p class="mt-6 text-[0.8125rem] text-muted">Izin berlaku untuk langkah ini saja.</p>
  </div>
</dialog>
