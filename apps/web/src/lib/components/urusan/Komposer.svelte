<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../Icon.svelte';
  import LampiranKecil from './LampiranKecil.svelte';
  import { aksiEnter, buatLampiran, LAMPIRAN_MAKS, type Lampiran } from './komposer.js';

  /**
   * Kotak tulis di bawah percakapan: teks tidak hilang bila pengiriman gagal (WCAG 3.3.7, sesi habis).
   * Lampiran (klip atau tempel gambar) hanya disimpan sebagai chip di sini; halaman mengunggahnya ke brankas
   * terenkripsi saat pesan dikirim. Isi berkas tidak pernah ikut pesan ke AI.
   */
  let {
    teks = $bindable(''),
    lampiran = $bindable([]),
    sibuk = false,
    nonaktif = false,
    pesan,
    elemen = $bindable(null),
    onkirim,
  }: {
    teks?: string;
    lampiran?: Lampiran[];
    sibuk?: boolean;
    nonaktif?: boolean;
    pesan?: string | null | undefined;
    elemen?: HTMLTextAreaElement | null;
    onkirim: (teks: string) => void;
  } = $props();

  let inputBerkas = $state<HTMLInputElement>();
  let galatLampiran = $state<string | null>(null);
  let sentuh = $state(false);
  // Kotak tulis kosong = satu baris rapi: placeholder panjang hanya bila muat satu baris (laptop); di HP dan di
  // panel sempit yang ringkas. SSR (lebar belum diketahui) memakai yang ringkas. Ambang dalam rem (teks panjang
  // ±17 rem di 17 px) agar ukuran huruf dari Pengaturan tidak membuatnya terlipat.
  let lebarTulis = $state(0);
  let rem = $state(16);
  const placeholder = $derived(
    lebarTulis >= 19 * rem ? 'Tulis jawaban atau pertanyaan lain…' : 'Tulis pesan…',
  );

  // Dikte sama dengan Beranda: modul suara dimuat saat mikrofon ditekan; hasil mengganti isi kotak tulis.
  let bisaDikte = $state(false);
  let mendikte = $state(false);
  let hentikanDikte: (() => void) | undefined;

  onMount(() => {
    sentuh = matchMedia('(pointer: coarse)').matches;
    rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    bisaDikte = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    return () => hentikanDikte?.();
  });

  async function bicara() {
    if (mendikte) {
      hentikanDikte?.();
      return;
    }
    mendikte = true;
    const { mulaiDikte } = await import('#lib/suara.js');
    hentikanDikte = mulaiDikte(
      (t) => (teks = t),
      () => (mendikte = false),
    );
  }

  const bisaKirim = $derived(!sibuk && !nonaktif && (teks.trim().length > 0 || lampiran.length > 0));
  const keterangan = $derived(
    [pesan ? 'komposer-pesan' : '', galatLampiran ? 'komposer-galat-lampiran' : '']
      .filter(Boolean)
      .join(' ') || undefined,
  );

  function kirim(e: SubmitEvent) {
    e.preventDefault();
    if (!bisaKirim) return;
    hentikanDikte?.();
    onkirim(teks.trim());
  }

  function tekan(e: KeyboardEvent) {
    if (aksiEnter(e, sentuh) !== 'kirim') return;
    e.preventDefault();
    (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }

  async function tambah(berkas: File[]) {
    const { baru, galat } = await buatLampiran(berkas, lampiran.length);
    galatLampiran = galat;
    if (baru.length) lampiran = [...lampiran, ...baru];
  }

  function pilih(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    void tambah([...(input.files ?? [])]);
    input.value = '';
  }

  /** Ctrl+V tangkapan layar/foto: berkas jadi lampiran; teks yang ikut ditempel tetap masuk kotak tulis. */
  function tempel(e: ClipboardEvent) {
    const berkas = [...(e.clipboardData?.files ?? [])];
    if (!berkas.length) return;
    if (!e.clipboardData?.types.includes('text/plain')) e.preventDefault();
    void tambah(berkas);
  }

  function hapus(kunci: string) {
    lampiran = lampiran.filter((l) => l.kunci !== kunci);
    galatLampiran = null;
    elemen?.focus();
  }

  // Pratinjau yang tidak lagi dipakai (dihapus atau sudah terkirim) dilepas dari memori.
  let pratinjauAktif = new Set<string>();
  $effect(() => {
    const kini = new Set(lampiran.flatMap((l) => (l.pratinjau ? [l.pratinjau] : [])));
    for (const u of pratinjauAktif) if (!kini.has(u)) URL.revokeObjectURL(u);
    pratinjauAktif = kini;
  });
</script>

<form onsubmit={kirim} class="flex flex-col gap-2">
  {#if pesan}
    <p id="komposer-pesan" role="status" class="px-2 text-sm font-medium text-kuning-ink">{pesan}</p>
  {/if}
  {#if galatLampiran}
    <p id="komposer-galat-lampiran" role="alert" class="px-2 text-sm font-medium text-galat">
      {galatLampiran}
    </p>
  {/if}
  {#if lampiran.length}
    <!-- Lampiran = ubin kecil bernomor (#1, #2, ...) sesuai urutan yang dibaca AI; tanpa pilihan jenis
         (keputusan pemilik 2026-11-14). -->
    <div class="flex flex-col gap-1.5 px-1">
      <LampiranKecil {lampiran} onhapus={hapus} />
      <p class="text-xs text-muted">Foto dibaca AI dan disimpan terenkripsi di Dokumen Anda.</p>
    </div>
  {/if}
  <div
    class="flex min-h-14 items-end gap-1 rounded-[28px] border border-line-2 bg-surface py-[6px] pr-[7px] pl-[7px] shadow-[0_0_0.5px_#0000000f,0_1px_0.5px_#0000000f,0_2px_2px_#0000000a]"
  >
    <input
      bind:this={inputBerkas}
      type="file"
      multiple
      accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
      onchange={pilih}
      class="hidden"
      tabindex="-1"
      aria-hidden="true"
    />
    <button
      type="button"
      onclick={() => inputBerkas?.click()}
      disabled={nonaktif || lampiran.length >= LAMPIRAN_MAKS}
      class="grid size-[42px] shrink-0 place-items-center rounded-full text-ink hover:bg-card disabled:opacity-50"
    >
      <Icon name="klip" class="size-5" label="Lampirkan foto atau PDF" />
    </button>
    <label for="komposer" class="sr-only">Tulis jawaban atau pertanyaan</label>
    <textarea
      id="komposer"
      bind:this={elemen}
      bind:value={teks}
      bind:clientWidth={lebarTulis}
      onkeydown={tekan}
      onpaste={tempel}
      rows="1"
      maxlength={2000 - 60 * lampiran.length}
      disabled={nonaktif}
      enterkeyhint={sentuh ? 'enter' : 'send'}
      aria-describedby={keterangan}
      {placeholder}
      class="max-h-40 min-h-[42px] min-w-0 flex-1 resize-none bg-transparent py-[9px] pl-1 text-base sm:py-2 text-ink [field-sizing:content] placeholder:text-muted focus:outline-none sm:text-[17px] sm:leading-[26px]"
    ></textarea>
    {#if bisaDikte}
      <button
        type="button"
        onclick={bicara}
        disabled={nonaktif}
        aria-pressed={mendikte}
        aria-label={mendikte ? 'Berhenti mendengarkan' : 'Bicara'}
        class="grid size-[42px] shrink-0 place-items-center rounded-full text-ink hover:bg-card disabled:opacity-50 {mendikte
          ? 'bg-card ring-2 ring-brand'
          : ''}"
      >
        <Icon name="mikrofon" class="size-5" />
      </button>
    {/if}
    <button
      type="submit"
      disabled={!bisaKirim}
      aria-busy={sibuk || undefined}
      class="grid size-[42px] shrink-0 place-items-center rounded-full bg-primer text-primer-ink disabled:opacity-50"
    >
      <Icon
        name={sibuk ? 'memuat' : 'panah-atas'}
        class="size-5 {sibuk ? 'animate-spin' : ''}"
        label="Kirim"
      />
    </button>
  </div>
</form>
