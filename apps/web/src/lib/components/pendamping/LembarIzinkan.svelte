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
  class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-3xl bg-surface p-0 text-ink shadow-lembut backdrop:bg-black/40 max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none"
>
  <div class="flex flex-col gap-4 p-5 sm:p-6">
    <div class="flex items-center gap-3">
      <span class="grid size-10 place-items-center rounded-full bg-nila text-nila-ink"
        ><Icon name="ai" class="size-5" /></span
      >
      <h2 id="judul-izinkan" class="text-xl font-semibold tracking-tight">Izinkan AI mengisi?</h2>
    </div>
    <p class="text-[0.9375rem] text-body">
      Data berikut diambil dari Data Diri dan Dokumen Anda, hanya untuk sesi ini. Semuanya dihapus saat
      browser ditutup.
    </p>
    {#if label.length}
      <div>
        <p class="text-sm font-semibold">Data diri</p>
        <ul class="mt-2 flex flex-wrap gap-2">
          {#each label as l (l)}
            <li class="rounded-full bg-bg-2 px-3 py-1.5 text-sm">{l}</li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if berkas.length}
      <div>
        <p class="text-sm font-semibold">Berkas</p>
        <ul class="mt-2 flex flex-wrap gap-2">
          {#each berkas as b (b)}
            <li class="inline-flex items-center gap-1.5 rounded-full bg-bg-2 px-3 py-1.5 text-sm">
              <Icon name="berkas" class="size-4" />{b.toUpperCase()}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if pesan}
      <p role="alert" class="rounded-xl bg-kuning px-4 py-3 text-[0.9375rem] text-kuning-ink">{pesan}</p>
    {/if}
    <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <button
        type="button"
        onclick={ontolak}
        class="inline-flex min-h-12 items-center justify-center rounded-full border border-line-2 bg-surface px-5 font-medium hover:bg-card"
        >Saya isi sendiri</button
      >
      <button
        type="button"
        onclick={onizinkan}
        disabled={sibuk}
        aria-busy={sibuk || undefined}
        class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink hover:opacity-90 disabled:opacity-80"
      >
        <Icon name={sibuk ? 'memuat' : 'centang'} class="size-4.5 {sibuk ? 'animate-spin' : ''}" /> Izinkan isi
      </button>
    </div>
  </div>
</dialog>
