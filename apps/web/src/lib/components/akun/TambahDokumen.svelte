<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import Field from '#lib/components/ui/Field.svelte';
  import {
    LABEL_JENIS,
    periksaBerkas,
    unggahDokumen,
    type DokumenAkun,
    type JenisDokumen,
  } from '#lib/akun/klien.js';

  /**
   * Dialog Tambah dokumen (App 11). Dimuat terpisah oleh /dokumen (import dinamis, dipanaskan saat idle):
   * dialog tertutup tidak terlihat saat load, jadi formulirnya tidak ikut di-hydrate di HP murah.
   */
  let { ontersimpan }: { ontersimpan: (d: DokumenAkun) => void | Promise<void> } = $props();

  let dialog = $state<HTMLDialogElement>();
  let jenis = $state<JenisDokumen>('ktp');
  let judul = $state('');
  let berkas = $state<File | null>(null);
  let galatUnggah = $state('');
  let mengunggah = $state(false);

  export function buka() {
    jenis = 'ktp';
    judul = '';
    berkas = null;
    galatUnggah = '';
    dialog?.showModal();
  }

  function pilihBerkas(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
    berkas = f;
    galatUnggah = f ? (periksaBerkas(f) ?? '') : '';
    if (f && !judul) judul = LABEL_JENIS[jenis];
  }

  async function kirim(e: SubmitEvent) {
    e.preventDefault();
    if (!berkas) return void (galatUnggah = 'Pilih foto atau PDF dokumen.');
    const cek = periksaBerkas(berkas);
    if (cek) return void (galatUnggah = cek);
    mengunggah = true;
    const r = await unggahDokumen(berkas, jenis, judul.trim() || LABEL_JENIS[jenis]);
    mengunggah = false;
    if (!r.ok) return void (galatUnggah = r.pesan);
    dialog?.close();
    await ontersimpan(r.data);
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="judul-tambah"
  class="m-auto w-[min(32rem,calc(100%-2rem))] rounded-kartu bg-surface p-0 text-ink shadow-lembut backdrop:bg-ink/40"
>
  <form onsubmit={kirim} class="flex flex-col gap-4 p-5 sm:p-6">
    <h2 id="judul-tambah" class="text-xl font-semibold">Tambah dokumen</h2>
    <Field id="jenis-dok" label="Jenis dokumen">
      {#snippet children({ describedby })}
        <select
          id="jenis-dok"
          bind:value={jenis}
          aria-describedby={describedby}
          class="h-12 rounded-xl border border-line-2 bg-surface px-3 text-base"
        >
          {#each Object.entries(LABEL_JENIS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
        </select>
      {/snippet}
    </Field>
    <Field id="judul-dok" label="Nama dokumen" petunjuk="Misalnya: KTP Ibu, KK terbaru.">
      {#snippet children({ describedby })}
        <input
          id="judul-dok"
          bind:value={judul}
          maxlength="200"
          aria-describedby={describedby}
          class="h-12 rounded-xl border border-line-2 bg-surface px-3 text-base"
        />
      {/snippet}
    </Field>
    <Field
      id="berkas-dok"
      label="Foto atau PDF"
      petunjuk="JPG, PNG, WebP, atau PDF. Maksimal 9 MB."
      galat={galatUnggah || undefined}
    >
      {#snippet children({ describedby, invalid })}
        <input
          id="berkas-dok"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment"
          onchange={pilihBerkas}
          aria-describedby={describedby}
          aria-invalid={invalid}
          class="min-h-12 rounded-xl border border-dashed border-line-2 bg-card px-3 py-2.5 text-base file:mr-3 file:min-h-10 file:rounded-full file:border-0 file:bg-primer file:px-4 file:font-semibold file:text-primer-ink"
        />
      {/snippet}
    </Field>
    <div class="mt-1 flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onclick={() => dialog?.close()}
        class="inline-flex min-h-12 items-center rounded-full border border-line-2 px-5 font-semibold hover:bg-card"
        >Batal</button
      >
      <button
        type="submit"
        disabled={mengunggah}
        class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink hover:opacity-90 disabled:opacity-60"
      >
        <Icon name={mengunggah ? 'memuat' : 'unggah'} class="size-4.5 {mengunggah ? 'animate-spin' : ''}" />
        {mengunggah ? 'Mengunggah…' : 'Simpan'}
      </button>
    </div>
  </form>
</dialog>
