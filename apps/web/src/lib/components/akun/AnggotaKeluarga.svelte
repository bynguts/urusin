<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Field from '#lib/components/ui/Field.svelte';
  import {
    ambilKeluarga,
    ANGGOTA_KELUARGA_MAKS,
    hapusAnggota,
    LABEL_HUBUNGAN,
    samarkan,
    simpanAnggota,
    type AnggotaKeluarga,
    type AnggotaKeluargaInput,
    type HubunganKeluarga,
  } from '#lib/akun/klien.js';

  /**
   * Anggota keluarga di tab Data diri: akta kelahiran, KK, KIA, dan pindah hampir selalu melibatkan anggota
   * keluarga. Nomor KK dan alamat dipakai bersama dari bagian "Saya". Nilai hanya dipakai untuk formulir yang
   * warga setujui ("Izinkan isi"); AI tidak pernah melihatnya.
   */
  let { onsimpan }: { onsimpan?: (pesan: string) => void } = $props();

  type Draf = {
    hubungan: HubunganKeluarga | '';
    namaLengkap: string;
    nik: string;
    tanggalLahir: string;
    jenisKelamin: '' | 'laki-laki' | 'perempuan';
    tempatLahir: string;
  };
  const kosong = (): Draf => ({
    hubungan: '',
    namaLengkap: '',
    nik: '',
    tanggalLahir: '',
    jenisKelamin: '',
    tempatLahir: '',
  });
  const URUTAN: HubunganKeluarga[] = ['pasangan', 'suami', 'istri', 'anak', 'ayah', 'ibu', 'lainnya'];

  let anggota = $state<AnggotaKeluarga[] | null>(null);
  let galatMuat = $state('');
  /** null = form tertutup; '' = tambah baru; id = ubah anggota itu. */
  let edit = $state<string | null>(null);
  let draf = $state<Draf>(kosong());
  let galat = $state<Partial<Record<keyof Draf, string>>>({});
  let galatSimpan = $state('');
  let menyimpan = $state(false);
  let konfirmasiHapus = $state<string | null>(null);
  let lihat = $state<Record<string, boolean>>({});

  $effect(() => {
    void ambilKeluarga().then((r) => {
      if (r.ok) anggota = r.data.anggota;
      else galatMuat = r.pesan;
    });
  });

  const penuh = $derived((anggota?.length ?? 0) >= ANGGOTA_KELUARGA_MAKS);

  function tanggalPanjang(v: string | undefined): string {
    if (!v) return '';
    const d = new Date(`${v}T00:00:00`);
    return Number.isNaN(d.getTime()) ? v : new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(d);
  }

  async function buka(a?: AnggotaKeluarga) {
    draf = a
      ? {
          hubungan: a.hubungan,
          namaLengkap: a.namaLengkap,
          nik: a.nik ?? '',
          tanggalLahir: a.tanggalLahir ?? '',
          jenisKelamin: a.jenisKelamin ?? '',
          tempatLahir: a.tempatLahir ?? '',
        }
      : kosong();
    galat = {};
    galatSimpan = '';
    konfirmasiHapus = null;
    edit = a?.id ?? '';
    await tick();
    document.getElementById('kel-hubungan')?.focus();
  }

  /** Tanggal ISO yang benar-benar ada (2026-02-30 ditolak) dan tidak di masa depan. */
  function tanggalSah(v: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getTime() <= Date.now();
  }

  async function simpan(e: SubmitEvent) {
    e.preventDefault();
    const g: typeof galat = {};
    const nama = draf.namaLengkap.trim();
    const nik = draf.nik.replace(/\s+/g, '');
    const tgl = draf.tanggalLahir.trim();
    if (!draf.hubungan) g.hubungan = 'Pilih hubungan dengan Anda.';
    if (!nama) g.namaLengkap = 'Isi nama lengkap sesuai KK.';
    if (nik && !/^\d{16}$/.test(nik)) g.nik = 'NIK harus 16 angka.';
    if (tgl && !tanggalSah(tgl)) g.tanggalLahir = 'Tanggal lahir belum benar.';
    galat = g;
    const pertama = (Object.keys(g) as (keyof Draf)[])[0];
    if (pertama) return document.getElementById(`kel-${pertama}`)?.focus();
    const data: AnggotaKeluargaInput = {
      hubungan: draf.hubungan as HubunganKeluarga,
      namaLengkap: nama,
      ...(nik ? { nik } : {}),
      ...(tgl ? { tanggalLahir: tgl } : {}),
      ...(draf.jenisKelamin ? { jenisKelamin: draf.jenisKelamin } : {}),
      ...(draf.tempatLahir.trim() ? { tempatLahir: draf.tempatLahir.trim() } : {}),
    };
    menyimpan = true;
    const r = await simpanAnggota(data, edit || undefined);
    menyimpan = false;
    if (!r.ok) return void (galatSimpan = r.pesan);
    const a = r.data.anggota;
    anggota = edit ? (anggota ?? []).map((x) => (x.id === a.id ? a : x)) : [...(anggota ?? []), a];
    const baru = !edit;
    edit = null;
    onsimpan?.(baru ? `${a.namaLengkap} ditambahkan.` : `Data ${a.namaLengkap} tersimpan.`);
    await tick();
    document.getElementById(`kel-ubah-${a.id}`)?.focus();
  }

  async function hapus(a: AnggotaKeluarga) {
    const r = await hapusAnggota(a.id);
    if (!r.ok) return void (galatMuat = r.pesan);
    anggota = (anggota ?? []).filter((x) => x.id !== a.id);
    konfirmasiHapus = null;
    onsimpan?.(`${a.namaLengkap} dihapus dari anggota keluarga.`);
    await tick();
    document.getElementById('kel-tambah')?.focus();
  }

  const kelasInput = (invalid: boolean) =>
    `h-12 w-full rounded-xl border bg-surface px-3 text-base text-ink ${invalid ? 'border-galat-garis' : 'border-line-2'}`;
</script>

<section aria-labelledby="judul-keluarga" class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-col gap-1">
      <h2 id="judul-keluarga" class="text-[19px] font-semibold text-ink">Anggota keluarga</h2>
      <p class="text-[15px] text-muted">
        Untuk akta kelahiran, KK, KIA, atau pindah. Nomor KK dan alamat memakai data Anda di atas.
      </p>
    </div>
    {#if anggota && edit === null}
      <button
        id="kel-tambah"
        type="button"
        onclick={() => buka()}
        disabled={penuh}
        class="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-line-2 bg-surface px-4 text-sm font-semibold text-ink hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon name="tambah" class="size-4" /> Tambah anggota
      </button>
    {/if}
  </div>

  {#if galatMuat}
    <p role="alert" class="rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat">{galatMuat}</p>
  {/if}

  {#if anggota === null && !galatMuat}
    <div class="h-24 animate-pulse rounded-2xl bg-card" aria-hidden="true"></div>
  {/if}

  {#if edit !== null}
    <form
      onsubmit={simpan}
      novalidate
      aria-label={edit ? 'Ubah anggota keluarga' : 'Tambah anggota keluarga'}
      class="grid gap-4 rounded-kartu border border-line p-4 sm:grid-cols-6 sm:p-5"
    >
      <div class="sm:col-span-2">
        <Field id="kel-hubungan" label="Hubungan" galat={galat.hubungan}>
          {#snippet children({ describedby, invalid })}
            <select
              id="kel-hubungan"
              bind:value={draf.hubungan}
              aria-describedby={describedby}
              aria-invalid={invalid}
              class={kelasInput(invalid)}
            >
              <option value="" disabled>Pilih</option>
              {#each URUTAN as h (h)}
                <option value={h}>{LABEL_HUBUNGAN[h]}</option>
              {/each}
            </select>
          {/snippet}
        </Field>
      </div>
      <div class="sm:col-span-4">
        <Field
          id="kel-namaLengkap"
          label="Nama lengkap"
          petunjuk="Sesuai KK atau akta."
          galat={galat.namaLengkap}
        >
          {#snippet children({ describedby, invalid })}
            <input
              id="kel-namaLengkap"
              autocomplete="off"
              bind:value={draf.namaLengkap}
              aria-describedby={describedby}
              aria-invalid={invalid}
              class={kelasInput(invalid)}
            />
          {/snippet}
        </Field>
      </div>
      <div class="sm:col-span-3">
        <Field
          id="kel-nik"
          label="NIK"
          petunjuk="16 angka. Boleh dikosongkan bila belum ada."
          galat={galat.nik}
        >
          {#snippet children({ describedby, invalid })}
            <input
              id="kel-nik"
              inputmode="numeric"
              autocomplete="off"
              pattern={'\\d{16}'}
              bind:value={draf.nik}
              aria-describedby={describedby}
              aria-invalid={invalid}
              class={kelasInput(invalid)}
            />
          {/snippet}
        </Field>
      </div>
      <div class="sm:col-span-3">
        <Field id="kel-tanggalLahir" label="Tanggal lahir" galat={galat.tanggalLahir}>
          {#snippet children({ describedby, invalid })}
            <input
              id="kel-tanggalLahir"
              type="date"
              autocomplete="off"
              bind:value={draf.tanggalLahir}
              aria-describedby={describedby}
              aria-invalid={invalid}
              class={kelasInput(invalid)}
            />
          {/snippet}
        </Field>
      </div>
      <div class="sm:col-span-3">
        <Field id="kel-jenisKelamin" label="Jenis kelamin">
          {#snippet children({ describedby, invalid })}
            <select
              id="kel-jenisKelamin"
              bind:value={draf.jenisKelamin}
              aria-describedby={describedby}
              class={kelasInput(invalid)}
            >
              <option value="">Belum diisi</option>
              <option value="laki-laki">Laki-laki</option>
              <option value="perempuan">Perempuan</option>
            </select>
          {/snippet}
        </Field>
      </div>
      <div class="sm:col-span-3">
        <Field id="kel-tempatLahir" label="Tempat lahir" petunjuk="Isi bila formulir memintanya.">
          {#snippet children({ describedby, invalid })}
            <input
              id="kel-tempatLahir"
              autocomplete="off"
              bind:value={draf.tempatLahir}
              aria-describedby={describedby}
              class={kelasInput(invalid)}
            />
          {/snippet}
        </Field>
      </div>
      {#if galatSimpan}
        <p role="alert" class="rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat sm:col-span-6">
          {galatSimpan}
        </p>
      {/if}
      <div class="flex flex-wrap justify-end gap-2 sm:col-span-6">
        <button
          type="button"
          onclick={() => (edit = null)}
          class="inline-flex min-h-12 items-center rounded-full border border-line-2 px-5 font-semibold text-ink hover:bg-card"
          >Batal</button
        >
        <button
          type="submit"
          disabled={menyimpan}
          class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink disabled:opacity-60"
        >
          {menyimpan ? 'Menyimpan…' : 'Simpan anggota'}
        </button>
      </div>
    </form>
  {/if}

  {#if anggota && anggota.length === 0 && edit === null}
    <p class="rounded-2xl border border-dashed border-line-2 px-5 py-4 text-[15px] text-muted">
      Belum ada anggota keluarga. Tambahkan pasangan, anak, ayah, atau ibu agar formulir yang menyebut mereka
      bisa diisi tanpa mengetik ulang.
    </p>
  {/if}

  {#if anggota?.length}
    <ul class="grid gap-3 sm:grid-cols-2" aria-label="Daftar anggota keluarga">
      {#each anggota as a (a.id)}
        <li class="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="w-fit rounded-full bg-bg-2 px-2.5 py-0.5 text-[13px] font-semibold text-card-ink"
                >{LABEL_HUBUNGAN[a.hubungan]}</span
              >
              <p class="text-[17px] font-medium break-words text-ink">{a.namaLengkap}</p>
            </div>
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[15px]">
            <dt class="text-card-ink">NIK</dt>
            <dd class="flex flex-wrap items-center gap-1 break-words text-ink">
              {#if a.nik}
                {lihat[a.id] ? a.nik : samarkan(a.nik)}
                <button
                  type="button"
                  onclick={() => (lihat[a.id] = !lihat[a.id])}
                  aria-pressed={!!lihat[a.id]}
                  class="-my-2 grid size-9 place-items-center rounded-full text-ink hover:bg-bg-2"
                >
                  <Icon name={lihat[a.id] ? 'mata-tutup' : 'mata'} class="size-4" />
                  <span class="sr-only">{lihat[a.id] ? 'Sembunyikan' : 'Tampilkan'} NIK {a.namaLengkap}</span>
                </button>
              {:else}
                <span class="text-muted">Belum diisi</span>
              {/if}
            </dd>
            <dt class="text-card-ink">Lahir</dt>
            <dd class="break-words text-ink">
              {#if a.tanggalLahir || a.tempatLahir}
                {[a.tempatLahir, tanggalPanjang(a.tanggalLahir)].filter(Boolean).join(', ')}
              {:else}
                <span class="text-muted">Belum diisi</span>
              {/if}
            </dd>
          </dl>
          {#if konfirmasiHapus === a.id}
            <div role="group" aria-label="Konfirmasi hapus {a.namaLengkap}" class="flex flex-col gap-2">
              <p class="text-[15px] text-ink">Hapus {a.namaLengkap} dari brankas?</p>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  onclick={() => void hapus(a)}
                  class="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-galat-garis/60 bg-surface px-4 text-[15px] font-semibold text-galat hover:bg-mawar"
                  >Ya, hapus</button
                >
                <button
                  type="button"
                  onclick={() => (konfirmasiHapus = null)}
                  class="inline-flex min-h-11 items-center rounded-full border border-line-2 px-4 text-[15px] font-semibold text-ink hover:bg-card"
                  >Batal</button
                >
              </div>
            </div>
          {:else}
            <div class="flex gap-2">
              <button
                id="kel-ubah-{a.id}"
                type="button"
                onclick={() => buka(a)}
                disabled={edit !== null}
                class="inline-flex min-h-11 items-center rounded-full border border-line-2 px-4 text-[15px] font-semibold text-ink hover:bg-card disabled:opacity-60"
                >Ubah<span class="sr-only"> {a.namaLengkap}</span></button
              >
              <button
                type="button"
                onclick={() => (konfirmasiHapus = a.id)}
                disabled={edit !== null}
                class="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold text-galat hover:bg-mawar disabled:opacity-60"
                ><Icon name="hapus" class="size-4" />Hapus<span class="sr-only">
                  {a.namaLengkap}</span
                ></button
              >
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if penuh}
    <p class="text-sm text-muted">Paling banyak {ANGGOTA_KELUARGA_MAKS} anggota keluarga.</p>
  {/if}
</section>
