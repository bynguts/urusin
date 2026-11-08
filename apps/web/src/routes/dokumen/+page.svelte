<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import BrankasTertutup from '#lib/components/akun/BrankasTertutup.svelte';
  import TabBrankas from '#lib/components/akun/TabBrankas.svelte';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import Chip from '#lib/components/ui/Chip.svelte';
  import Field from '#lib/components/ui/Field.svelte';
  import {
    LABEL_JENIS,
    daftarDokumen,
    hapusDokumen,
    periksaBerkas,
    ukuranBerkas,
    unggahDokumen,
    type DokumenAkun,
    type Hasil,
    type JenisDokumen,
  } from '#lib/akun/klien.js';
  import { tanggal } from '#lib/urusan-status.js';

  /** Dokumen · Berkas (App 11): brankas dokumen akun, unggah sekali dan dipakai ulang di urusan berikutnya. */
  let hasil = $state<Hasil<{ dokumen: DokumenAkun[] }> | null>(null);
  let filter = $state<'semua' | JenisDokumen>('semua');

  async function muat() {
    hasil = await daftarDokumen();
  }
  $effect(() => {
    void muat();
  });

  const dokumen = $derived(hasil?.ok ? hasil.data.dokumen : []);
  const jenisAda = $derived([...new Set(dokumen.map((d) => d.jenis))]);
  const tampil = $derived(filter === 'semua' ? dokumen : dokumen.filter((d) => d.jenis === filter));

  // --- Tambah dokumen ---
  let dialog = $state<HTMLDialogElement>();
  let jenis = $state<JenisDokumen>('ktp');
  let judul = $state('');
  let berkas = $state<File | null>(null);
  let galatUnggah = $state('');
  let mengunggah = $state(false);

  function bukaTambah() {
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
    if (hasil?.ok) hasil = { ok: true, data: { dokumen: [r.data, ...hasil.data.dokumen] } };
    else await muat();
  }

  let pesanStatus = $state('');
  async function hapus(d: DokumenAkun) {
    if (!confirm(`Hapus ${d.judul} dari brankas?`)) return;
    const r = await hapusDokumen(d.id);
    if (!r.ok) return void (pesanStatus = r.pesan);
    pesanStatus = `${d.judul} dihapus.`;
    if (hasil?.ok) hasil = { ok: true, data: { dokumen: hasil.data.dokumen.filter((x) => x.id !== d.id) } };
  }

  const LATAR: Record<JenisDokumen, string> = {
    ktp: 'bg-biru',
    kk: 'bg-kuning',
    akta: 'bg-kuning',
    surat: 'bg-kuning',
    foto: 'bg-ungu',
    lainnya: 'bg-bg-2',
  };
</script>

<svelte:head><title>Dokumen · Urusin</title></svelte:head>

<HeaderHalaman judul="Dokumen" />

<div class="mx-auto w-full max-w-[67rem] px-4 py-6 sm:px-8 lg:py-8">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h2 class="text-[1.75rem] tracking-[-0.03em] text-ink sm:text-[2rem]">Dokumen Anda</h2>
      <p class="mt-1 text-base text-body">
        Disimpan terenkripsi di brankas Urusin dan dipakai ulang untuk urusan berikutnya.
      </p>
    </div>
    {#if hasil?.ok}
      <button
        type="button"
        onclick={bukaTambah}
        class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink hover:opacity-90"
      >
        <Icon name="tambah" class="size-4.5" /> Tambah dokumen
      </button>
    {/if}
  </div>

  <div class="mt-5"><TabBrankas aktif="berkas" /></div>

  {#if hasil === null}
    <div class="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {#each [0, 1, 2] as i (i)}<div class="h-52 animate-pulse rounded-kartu bg-card"></div>{/each}
    </div>
  {:else if !hasil.ok}
    <BrankasTertutup alasan={hasil.alasan} pesan={hasil.pesan} />
  {:else}
    {#if jenisAda.length > 1}
      <div role="group" aria-label="Saring dokumen" class="mt-5 flex gap-2 overflow-x-auto pb-1">
        {#each ['semua', ...jenisAda] as j (j)}
          {@const pilih = filter === j}
          <button
            type="button"
            aria-pressed={pilih}
            onclick={() => (filter = j as typeof filter)}
            class="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full px-4 text-[0.9375rem] {pilih
              ? 'bg-primer font-semibold text-primer-ink'
              : 'border border-line-2 bg-surface text-ink hover:bg-card'}"
          >
            {j === 'semua' ? 'Semua' : LABEL_JENIS[j as JenisDokumen]}
            <span class="text-sm opacity-70">
              {j === 'semua' ? dokumen.length : dokumen.filter((d) => d.jenis === j).length}
            </span>
          </button>
        {/each}
      </div>
    {/if}

    {#if tampil.length}
      <ul class="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each tampil as d (d.id)}
          <li class="flex flex-col overflow-hidden rounded-kartu border border-line bg-surface">
            <div class="grid h-26 place-items-end justify-center {LATAR[d.jenis]}" aria-hidden="true">
              <div class="flex h-20 w-28 flex-col gap-1.5 rounded-t-lg bg-surface p-3">
                <span class="h-1 w-10 rounded-full bg-line-2"></span>
                <span class="h-1 w-16 rounded-full bg-line"></span>
                <span class="h-1 w-14 rounded-full bg-line"></span>
                <span class="h-1 w-12 rounded-full bg-line"></span>
              </div>
            </div>
            <div class="flex flex-1 flex-col gap-1 p-4">
              <div class="flex items-start justify-between gap-2">
                <h3 class="text-lg font-semibold text-ink">{d.judul}</h3>
                <Chip nada="hijau" ikon="centang-bulat">Siap</Chip>
              </div>
              <p class="text-[0.9375rem] text-body">{LABEL_JENIS[d.jenis]} · {ukuranBerkas(d.ukuran)}</p>
              <p class="text-sm text-muted">Tersimpan {tanggal(d.disimpanPada)}</p>
              <div class="mt-2 flex gap-2">
                <a
                  href="/api/akun/dokumen/{encodeURIComponent(d.id)}"
                  target="_blank"
                  rel="external noopener"
                  class="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-line-2 px-4 text-[0.9375rem] text-ink hover:bg-card"
                >
                  <Icon name="mata" class="size-4.5" /> Lihat<span class="sr-only">: {d.judul}</span>
                </a>
                <button
                  type="button"
                  onclick={() => hapus(d)}
                  class="inline-flex min-h-12 items-center gap-1.5 rounded-full px-4 text-[0.9375rem] text-galat hover:bg-mawar"
                >
                  <Icon name="hapus" class="size-4.5" /> Hapus<span class="sr-only">: {d.judul}</span>
                </button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="mt-6 flex flex-col items-center gap-3 rounded-kartu bg-card px-6 py-10 text-center">
        <span class="grid size-12 place-items-center rounded-full bg-bg-2"
          ><Icon name="dokumen" class="size-6" /></span
        >
        <p class="text-lg font-semibold text-ink">Belum ada dokumen</p>
        <p class="max-w-md text-[0.9375rem] text-body">
          Simpan KTP, Kartu Keluarga, atau surat keterangan sekali. Urusin memakainya lagi saat Anda
          menyetujui urusan.
        </p>
      </div>
    {/if}

    <p role="status" class="mt-3 text-[0.9375rem] text-ink">{pesanStatus}</p>

    <div class="mt-3 flex items-center gap-3 rounded-2xl bg-card px-4 py-4 text-[0.9375rem] text-body">
      <Icon name="gembok" class="size-5 shrink-0 text-ink" />
      Dokumen tidak dikirim ke mana pun sampai Anda menyetujui pemakaiannya di sebuah urusan.
    </div>
  {/if}
</div>

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
      petunjuk="JPG, PNG, WebP, atau PDF. Maksimal 5 MB."
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
