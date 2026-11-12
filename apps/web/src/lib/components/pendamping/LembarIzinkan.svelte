<script lang="ts">
  import Icon from '../Icon.svelte';
  import { fieldDataDiri, labelPlaceholder } from '#lib/pendamping/isi-data.js';
  import type { KolomButuh } from '#lib/pendamping/tipe.js';

  /**
   * Lembar "Izinkan isi": sebelum AI mulai, warga melihat data Data Diri dan berkas yang akan dikirim ke sesi
   * Browser Pendamping (hanya di memori sesi itu). Tolak = warga mengisi sendiri (ambil alih).
   *
   * Navigator generik (`kolom` + `rencanaHash`): lembar per halaman. Setiap data ditampilkan bersama label
   * kolom di situs tempat AI akan mengisinya. Label itu teks dari situs (tidak tepercaya): ditampilkan apa
   * adanya sebagai teks biasa, dan kolom yang tidak lazim untuk data itu diberi peringatan serta tidak dicentang
   * bawaan. Data yang tidak dicentang diisi warga sendiri.
   */
  let {
    buka,
    placeholder,
    berkas,
    sibuk = false,
    pesan,
    kolom,
    rencanaHash,
    onizinkan,
    ontolak,
  }: {
    buka: boolean;
    placeholder: readonly string[];
    berkas: readonly string[];
    sibuk?: boolean;
    pesan?: string | undefined;
    kolom?: readonly KolomButuh[] | undefined;
    rencanaHash?: string | undefined;
    onizinkan: (pilihan?: { placeholder: string[]; berkas: string[] }) => void;
    ontolak: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  const label = $derived([...new Set(placeholder.map(labelPlaceholder))]);

  /** Satu baris per data: persetujuan berlaku per data, untuk semua kolom halaman ini yang memintanya. */
  type Baris = {
    placeholder: string;
    nama: string;
    labelPortal: string[];
    tidakLazim: boolean;
    bisa: boolean;
  };
  const baris = $derived.by((): Baris[] => {
    const m: Record<string, Baris> = {};
    for (const k of kolom ?? []) {
      const b = m[k.placeholder] ?? {
        placeholder: k.placeholder,
        nama: labelPlaceholder(k.placeholder),
        labelPortal: [],
        tidakLazim: false,
        // Hanya data yang ada di Data Diri yang bisa diambil server.
        bisa: fieldDataDiri(k.placeholder) !== undefined,
      };
      const l = k.labelPortal.trim();
      if (l && !b.labelPortal.includes(l)) b.labelPortal.push(l);
      b.tidakLazim ||= k.tidakLazim === true;
      m[k.placeholder] = b;
    }
    return Object.values(m);
  });
  const generik = $derived(kolom !== undefined && rencanaHash !== undefined);

  /** Centang per data + berkas; diatur ulang setiap halaman (rencanaHash) baru. */
  let dicentang: Record<string, boolean> = $state({});
  let untukHash: string | undefined;
  $effect(() => {
    if (rencanaHash === untukHash) return;
    untukHash = rencanaHash;
    dicentang = Object.fromEntries([
      ...baris.map((b) => [b.placeholder, b.bisa && !b.tidakLazim] as const),
      ...berkas.map((b) => [`berkas:${b}`, true] as const),
    ]);
  });
  const pilihan = $derived({
    placeholder: baris.filter((b) => b.bisa && dicentang[b.placeholder]).map((b) => b.placeholder),
    berkas: berkas.filter((b) => dicentang[`berkas:${b}`]),
  });
  const adaPilihan = $derived(pilihan.placeholder.length + pilihan.berkas.length > 0);

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
      {#if generik}
        AI akan mengisi kolom di halaman ini dengan data berikut dari Data Diri dan Dokumen Anda, hanya untuk
        sesi ini. Hapus centang data yang ingin Anda isi sendiri.
      {:else}
        Data berikut diambil dari Data Diri dan Dokumen Anda, hanya untuk sesi ini. Semuanya dihapus saat
        browser ditutup.
      {/if}
    </p>
    {#if generik}
      {#if baris.length}
        <ul class="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto" aria-label="Data yang akan diisi AI">
          {#each baris as b (b.placeholder)}
            <li class="rounded-xl bg-bg-2 px-3 py-2.5">
              <label class="flex items-start gap-3">
                <input
                  type="checkbox"
                  class="mt-1 size-4.5 shrink-0 accent-primer"
                  bind:checked={dicentang[b.placeholder]}
                  disabled={!b.bisa}
                />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-sm font-semibold">{b.nama}</span>
                  {#if b.labelPortal.length}
                    <span class="text-sm break-words text-body"
                      >Kolom di situs: {b.labelPortal.map((l) => `“${l}”`).join(', ')}</span
                    >
                  {/if}
                  {#if !b.bisa}
                    <span class="text-sm text-body">Tidak ada di Data Diri. Isi sendiri di layar.</span>
                  {:else if b.tidakLazim}
                    <span class="inline-flex items-start gap-1.5 text-sm text-kuning-ink">
                      <Icon name="peringatan" class="mt-0.5 size-4 shrink-0" />
                      Kolom ini jarang meminta {b.nama}. Pastikan memang benar sebelum mencentang.
                    </span>
                  {/if}
                </span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
      {#if berkas.length}
        <ul class="flex flex-col gap-2" aria-label="Berkas yang akan diunggah AI">
          {#each berkas as b (b)}
            <li class="rounded-xl bg-bg-2 px-3 py-2.5">
              <label class="flex items-center gap-3">
                <input
                  type="checkbox"
                  class="size-4.5 shrink-0 accent-primer"
                  bind:checked={dicentang[`berkas:${b}`]}
                />
                <span class="inline-flex items-center gap-1.5 text-sm font-semibold"
                  ><Icon name="berkas" class="size-4" />{b.toUpperCase()}</span
                >
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if label.length}
      <div>
        <p class="text-sm font-semibold">Data diri</p>
        <ul class="mt-2 flex flex-wrap gap-2">
          {#each label as l (l)}
            <li class="rounded-full bg-bg-2 px-3 py-1.5 text-sm">{l}</li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if !generik && berkas.length}
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
        onclick={() => onizinkan(generik ? pilihan : undefined)}
        disabled={sibuk || (generik && !adaPilihan)}
        aria-busy={sibuk || undefined}
        class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink disabled:opacity-80"
      >
        <Icon name={sibuk ? 'memuat' : 'centang'} class="size-4.5 {sibuk ? 'animate-spin' : ''}" /> Izinkan isi
      </button>
    </div>
  </div>
</dialog>
