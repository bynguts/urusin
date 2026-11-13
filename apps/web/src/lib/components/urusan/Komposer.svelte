<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../Icon.svelte';
  import { LABEL_JENIS, periksaBerkas } from '#lib/akun/klien.js';
  import {
    aksiEnter,
    LAMPIRAN_MAKS,
    labelLampiran,
    siapkanBerkas,
    tebakJenis,
    type Lampiran,
  } from './komposer.js';

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

  onMount(() => {
    sentuh = matchMedia('(pointer: coarse)').matches;
  });

  const bisaKirim = $derived(!sibuk && !nonaktif && (teks.trim().length > 0 || lampiran.length > 0));
  const keterangan = $derived(
    [pesan ? 'komposer-pesan' : '', galatLampiran ? 'komposer-galat-lampiran' : '']
      .filter(Boolean)
      .join(' ') || undefined,
  );

  function kirim(e: SubmitEvent) {
    e.preventDefault();
    if (!bisaKirim) return;
    onkirim(teks.trim());
  }

  function tekan(e: KeyboardEvent) {
    if (aksiEnter(e, sentuh) !== 'kirim') return;
    e.preventDefault();
    (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }

  async function tambah(berkas: File[]) {
    galatLampiran = null;
    for (const asli of berkas) {
      if (lampiran.length >= LAMPIRAN_MAKS) {
        galatLampiran = `Maksimal ${LAMPIRAN_MAKS} lampiran per pesan.`;
        break;
      }
      const f = await siapkanBerkas(asli);
      if (typeof f === 'string') {
        galatLampiran = f;
        continue;
      }
      const cek = periksaBerkas(f);
      if (cek) {
        galatLampiran = cek;
        continue;
      }
      lampiran = [
        ...lampiran,
        {
          kunci: `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
          berkas: f,
          jenis: tebakJenis(asli.name),
          pratinjau: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
        },
      ];
    }
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
    <div class="flex flex-col gap-1.5">
      <ul aria-label="Lampiran" class="flex flex-wrap gap-2">
        {#each lampiran as l (l.kunci)}
          <li
            data-lampiran
            class="flex items-center gap-2 rounded-2xl border border-line-2 bg-surface p-1.5 shadow-[0_0_0.5px_#0000000f,0_1px_0.5px_#0000000f]"
          >
            {#if l.pratinjau}
              <img src={l.pratinjau} alt="" class="size-10 shrink-0 rounded-lg bg-bg-2 object-cover" />
            {:else}
              <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-bg-2 text-ink">
                <Icon name="berkas-teks" class="size-5" />
              </span>
            {/if}
            <label for="jenis-{l.kunci}" class="sr-only"
              >Jenis dokumen lampiran ({l.pratinjau ? 'gambar' : 'PDF'})</label
            >
            <select
              id="jenis-{l.kunci}"
              bind:value={l.jenis}
              disabled={l.docId !== undefined}
              class="h-10 min-w-0 rounded-lg border border-line-2 bg-surface px-2 text-sm text-ink"
            >
              {#each Object.keys(LABEL_JENIS) as k (k)}
                <option value={k}>{labelLampiran(k as Lampiran['jenis'])}</option>
              {/each}
            </select>
            <button
              type="button"
              onclick={() => hapus(l.kunci)}
              aria-label="Hapus lampiran {labelLampiran(l.jenis)}"
              class="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-card hover:text-ink"
            >
              <Icon name="tutup" class="size-4" />
            </button>
          </li>
        {/each}
      </ul>
      <p class="px-2 text-sm text-muted">
        Lampiran disimpan terenkripsi di Dokumen Anda. Gambar dikirim ke AI untuk dibaca; PDF belum bisa
        dibaca AI.
      </p>
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
      onkeydown={tekan}
      onpaste={tempel}
      rows="1"
      maxlength={2000 - 60 * lampiran.length}
      disabled={nonaktif}
      enterkeyhint={sentuh ? 'enter' : 'send'}
      aria-describedby={keterangan}
      placeholder="Tulis jawaban atau pertanyaan lain…"
      class="max-h-40 min-h-[42px] flex-1 resize-none bg-transparent py-2 pl-1 text-base text-ink [field-sizing:content] placeholder:text-muted focus:outline-none sm:text-[17px] sm:leading-[26px]"
    ></textarea>
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
