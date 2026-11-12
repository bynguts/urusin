<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import BrankasTertutup from '#lib/components/akun/BrankasTertutup.svelte';
  import TabBrankas from '#lib/components/akun/TabBrankas.svelte';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import Field from '#lib/components/ui/Field.svelte';
  import { ambilDataDiri, samarkan, simpanDataDiri, type DataDiri, type Hasil } from '#lib/akun/klien.js';
  import { tanggal } from '#lib/urusan-status.js';
  import { resolve } from '$app/paths';
  import { ambilLokal } from '#lib/stores/app.svelte.js';

  /** Dokumen · Data diri (App 12): isi sekali, dipakai mengisi formulir yang warga setujui. */
  type Kolom = {
    k: keyof DataDiri;
    label: string;
    auto?: string;
    mode?: 'numeric' | 'tel' | 'email';
    tipe?: 'text' | 'date' | 'email' | 'tel';
    pola?: string;
    petunjuk?: string;
    rahasia?: boolean;
    lebar?: 'penuh' | 'sepertiga';
  };
  const KOLOM: Kolom[] = [
    { k: 'namaLengkap', label: 'Nama lengkap', auto: 'name', petunjuk: 'Sesuai KTP.', lebar: 'penuh' },
    { k: 'nik', label: 'NIK', mode: 'numeric', pola: '\\d{16}', petunjuk: '16 angka di KTP.', rahasia: true },
    {
      k: 'noKk',
      label: 'Nomor KK',
      mode: 'numeric',
      pola: '\\d{16}',
      petunjuk: '16 angka di Kartu Keluarga.',
      rahasia: true,
    },
    { k: 'tempatLahir', label: 'Tempat lahir' },
    { k: 'tanggalLahir', label: 'Tanggal lahir', tipe: 'date', auto: 'bday' },
    {
      k: 'alamat',
      label: 'Alamat',
      auto: 'street-address',
      petunjuk: 'Nama jalan dan nomor rumah.',
      lebar: 'penuh',
    },
    { k: 'rt', label: 'RT', mode: 'numeric', pola: '\\d{1,3}', lebar: 'sepertiga' },
    { k: 'rw', label: 'RW', mode: 'numeric', pola: '\\d{1,3}', lebar: 'sepertiga' },
    {
      k: 'kodePos',
      label: 'Kode pos',
      mode: 'numeric',
      pola: '\\d{5}',
      auto: 'postal-code',
      lebar: 'sepertiga',
    },
    { k: 'kelurahan', label: 'Kelurahan/desa' },
    { k: 'kecamatan', label: 'Kecamatan' },
    {
      k: 'hp',
      label: 'Nomor HP',
      mode: 'tel',
      tipe: 'tel',
      pola: '\\+?\\d{9,15}',
      auto: 'tel',
      petunjuk: 'Contoh: 0812xxxxxxxx',
    },
    { k: 'email', label: 'Email', mode: 'email', tipe: 'email', auto: 'email' },
  ];
  const RINGKAS: (keyof DataDiri)[] = ['namaLengkap', 'nik', 'noKk', 'tanggalLahir', 'alamat', 'email'];

  const lokal = ambilLokal();
  // Jejak pemakaian data: jejak urusan terakhir di perangkat ini.
  const terakhir = $derived(lokal.data.urusan[0]?.id);

  let hasil = $state<Hasil<{ dataDiri: DataDiri; diubahPada: string | null }> | null>(null);
  let ubah = $state(false);
  let draf = $state<DataDiri>({});
  let lihat = $state<Record<string, boolean>>({});
  let galat = $state<Partial<Record<keyof DataDiri, string>>>({});
  let galatSimpan = $state('');
  let menyimpan = $state(false);
  let pesanStatus = $state('');

  $effect(() => {
    void ambilDataDiri().then((r) => (hasil = r));
  });

  const data = $derived(hasil?.ok ? hasil.data.dataDiri : {});
  const kosong = $derived(!Object.values(data).some(Boolean));

  function tampilNilai(k: keyof DataDiri, v: string | undefined): string {
    if (!v) return '';
    if ((k === 'nik' || k === 'noKk') && !lihat[k]) return samarkan(v);
    if (k === 'tanggalLahir') {
      const d = new Date(`${v}T00:00:00`);
      return Number.isNaN(d.getTime())
        ? v
        : new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(d);
    }
    if (k === 'alamat')
      return [v, data.rt && `RT ${data.rt}`, data.rw && `RW ${data.rw}`, data.kelurahan, data.kecamatan]
        .filter(Boolean)
        .join(', ');
    return v;
  }

  async function mulaiUbah(fokus?: keyof DataDiri) {
    draf = { ...data };
    galat = {};
    galatSimpan = '';
    pesanStatus = '';
    ubah = true;
    await tick();
    document.getElementById(`dd-${fokus ?? 'namaLengkap'}`)?.focus();
  }

  async function simpan(e: SubmitEvent) {
    e.preventDefault();
    const bersih: DataDiri = {};
    const g: typeof galat = {};
    for (const c of KOLOM) {
      let v = (draf[c.k] ?? '').toString().trim();
      if (c.mode === 'numeric') v = v.replace(/\s+/g, '');
      if (!v) continue;
      if (c.pola && !new RegExp(`^${c.pola}$`).test(v))
        g[c.k] = `${c.label} belum sesuai. ${c.petunjuk ?? ''}`.trim();
      (bersih as Record<string, string>)[c.k] = v;
    }
    galat = g;
    const pertama = KOLOM.find((c) => g[c.k]);
    if (pertama) return document.getElementById(`dd-${pertama.k}`)?.focus();
    if (data.kodeKabKota) bersih.kodeKabKota = data.kodeKabKota;
    if (data.jenisKelamin) bersih.jenisKelamin = data.jenisKelamin;
    menyimpan = true;
    const r = await simpanDataDiri(bersih);
    menyimpan = false;
    if (!r.ok) return void (galatSimpan = r.pesan);
    hasil = { ok: true, data: r.data };
    ubah = false;
    pesanStatus = 'Data diri tersimpan.';
  }
</script>

<svelte:head><title>Data diri · Urusin</title></svelte:head>

<HeaderHalaman judul="Data diri" />

<div class="flex w-full flex-col gap-6 px-4 py-5 sm:px-10 sm:py-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <TabBrankas aktif="data-diri" />
    {#if hasil?.ok && !ubah}
      <button
        type="button"
        onclick={() => mulaiUbah()}
        class="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-primer px-5 text-sm font-semibold text-primer-ink"
      >
        <Icon name="tambah-orang" class="size-4" />
        {kosong ? 'Isi data diri' : 'Ubah data diri'}
      </button>
    {/if}
  </div>

  {#if hasil === null}
    <div class="h-96 animate-pulse rounded-2xl bg-card" aria-hidden="true"></div>
  {:else if !hasil.ok}
    <BrankasTertutup alasan={hasil.alasan} pesan={hasil.pesan} />
  {:else}
    <div class="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
      {#if ubah}
        <form
          onsubmit={simpan}
          novalidate
          class="grid gap-4 rounded-kartu border border-line p-4 sm:grid-cols-6 sm:p-5"
        >
          {#each KOLOM as c (c.k)}
            <div
              class={c.lebar === 'penuh'
                ? 'sm:col-span-6'
                : c.lebar === 'sepertiga'
                  ? 'sm:col-span-2'
                  : 'sm:col-span-3'}
            >
              <Field id="dd-{c.k}" label={c.label} petunjuk={c.petunjuk} galat={galat[c.k]}>
                {#snippet children({ describedby, invalid })}
                  <input
                    id="dd-{c.k}"
                    name={c.k}
                    type={c.tipe ?? 'text'}
                    inputmode={c.mode === 'numeric' ? 'numeric' : c.mode}
                    autocomplete={(c.auto ?? 'off') as HTMLInputElement['autocomplete']}
                    pattern={c.pola}
                    bind:value={draf[c.k]}
                    aria-describedby={describedby}
                    aria-invalid={invalid}
                    class="h-12 w-full rounded-xl border bg-surface px-3 text-base text-ink {invalid
                      ? 'border-galat-garis'
                      : 'border-line-2'}"
                  />
                {/snippet}
              </Field>
            </div>
          {/each}
          {#if galatSimpan}
            <p role="alert" class="rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat sm:col-span-6">
              {galatSimpan}
            </p>
          {/if}
          <div class="flex flex-wrap justify-end gap-2 sm:col-span-6">
            <button
              type="button"
              onclick={() => (ubah = false)}
              class="inline-flex min-h-12 items-center rounded-full border border-line-2 px-5 font-semibold text-ink hover:bg-card"
              >Batal</button
            >
            <button
              type="submit"
              disabled={menyimpan}
              class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink disabled:opacity-60"
            >
              {menyimpan ? 'Menyimpan…' : 'Simpan data diri'}
            </button>
          </div>
        </form>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (Area gulir perlu fokus agar kolom tabel bisa dijangkau dengan tombol panah.) -->
        <div
          role="region"
          aria-label="Tabel data diri"
          tabindex="0"
          class="min-w-0 overflow-x-auto rounded-2xl border border-line bg-surface"
        >
          <table class="w-full border-collapse text-left">
            <caption class="sr-only">Data diri tersimpan</caption>
            <thead class="border-b border-line bg-card text-[13px] font-semibold text-card-ink">
              <tr>
                <th scope="col" class="w-[36%] py-2.5 pr-2 pl-5 font-semibold sm:w-[206px]">Data</th>
                <th scope="col" class="px-2 py-2.5 font-semibold">Isi</th>
                <th scope="col" class="w-[96px] py-2.5 pr-5 pl-2"><span class="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody>
              {#each RINGKAS as k (k)}
                {@const c = KOLOM.find((x) => x.k === k)!}
                {@const v = data[k] as string | undefined}
                <tr class="h-[57.5px] border-t border-line first:border-t-0">
                  <th scope="row" class="py-2 pr-2 pl-5 text-[15px] font-normal text-card-ink">{c.label}</th>
                  <td class="px-2 py-2 text-[17px] font-medium break-words text-ink">
                    {#if v}
                      <span class="inline-flex flex-wrap items-center gap-2">
                        {tampilNilai(k, v)}
                        {#if c.rahasia}
                          <button
                            type="button"
                            onclick={() => (lihat[k] = !lihat[k])}
                            aria-pressed={!!lihat[k]}
                            class="-my-3 grid size-11 place-items-center rounded-full font-normal text-ink hover:bg-bg-2"
                          >
                            <Icon name={lihat[k] ? 'mata-tutup' : 'mata'} class="size-4" />
                            <span class="sr-only">{lihat[k] ? 'Sembunyikan' : 'Tampilkan'} {c.label}</span>
                          </button>
                        {/if}
                      </span>
                    {:else}
                      <span class="font-normal text-muted">Belum diisi</span>
                    {/if}
                  </td>
                  <td class="py-1 pr-5 pl-2 text-right">
                    <button
                      type="button"
                      onclick={() => mulaiUbah(k)}
                      class="-mr-3 inline-flex h-11 items-center rounded-full px-3 text-[15px] font-semibold text-ink hover:bg-bg-2"
                      >Ubah<span class="sr-only"> {c.label}</span></button
                    >
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <aside class="flex flex-col items-start gap-3.5 rounded-2xl border border-line bg-card p-6">
        <span class="grid size-11 place-items-center rounded-xl border border-line bg-surface"
          ><Icon name="gembok" class="size-5" /></span
        >
        <h3 class="text-[19px] font-semibold text-ink">Disimpan di brankas Urusin</h3>
        <p class="text-base leading-[25px] text-muted">
          Disimpan terenkripsi dan hanya dipakai untuk formulir yang Anda setujui. Anda bisa melihat kapan dan
          di mana data dipakai.
        </p>
        {#if terakhir}
          <a
            href={resolve('/jejak/[id]', { id: terakhir })}
            class="-my-2 inline-flex items-center gap-1.5 py-2 text-[15px] font-semibold text-ink hover:underline"
          >
            Lihat jejak pemakaian <Icon name="panah" class="size-4" />
          </a>
        {/if}
        {#if hasil.data.diubahPada}
          <p class="text-sm text-muted">Terakhir diubah {tanggal(hasil.data.diubahPada)}</p>
        {/if}
        <a
          href="{resolve('/pengaturan')}#zona-bahaya"
          class="-my-2 inline-flex items-center gap-1.5 py-2 text-[15px] font-semibold text-galat hover:underline"
        >
          Hapus data saya <Icon name="panah" class="size-4" />
        </a>
      </aside>
    </div>
    <p role="status" class="text-[15px] text-hijau-ink empty:hidden">{pesanStatus}</p>
  {/if}
</div>
