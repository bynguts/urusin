<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import BrankasTertutup from '#lib/components/akun/BrankasTertutup.svelte';
  import TabBrankas from '#lib/components/akun/TabBrankas.svelte';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import Field from '#lib/components/ui/Field.svelte';
  import { ambilDataDiri, samarkan, simpanDataDiri, type DataDiri, type Hasil } from '#lib/akun/klien.js';
  import { tanggal } from '#lib/urusan-status.js';

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
  const RINGKAS: (keyof DataDiri)[] = ['namaLengkap', 'nik', 'noKk', 'tanggalLahir', 'alamat', 'hp', 'email'];

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

<HeaderHalaman judul="Dokumen" />

<div class="mx-auto w-full max-w-[67rem] px-4 py-6 sm:px-8 lg:py-8">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h2 class="text-[1.75rem] tracking-[-0.03em] text-ink sm:text-[2rem]">Data diri</h2>
      <p class="mt-1 text-base text-body">
        Isi sekali saja. Urusin memakainya untuk mengisi formulir yang Anda setujui.
      </p>
    </div>
    {#if hasil?.ok && !ubah}
      <button
        type="button"
        onclick={() => mulaiUbah()}
        class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink hover:opacity-90"
      >
        <Icon name="orang" class="size-4.5" />
        {kosong ? 'Isi data diri' : 'Ubah data diri'}
      </button>
    {/if}
  </div>

  <div class="mt-5"><TabBrankas aktif="data-diri" /></div>

  {#if hasil === null}
    <div class="mt-6 h-96 animate-pulse rounded-kartu bg-card" aria-hidden="true"></div>
  {:else if !hasil.ok}
    <BrankasTertutup alasan={hasil.alasan} pesan={hasil.pesan} />
  {:else}
    <div class="mt-5 grid items-start gap-4 lg:grid-cols-[1fr_21.25rem]">
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
              class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-6 font-semibold text-primer-ink hover:opacity-90 disabled:opacity-60"
            >
              {menyimpan ? 'Menyimpan…' : 'Simpan data diri'}
            </button>
          </div>
        </form>
      {:else}
        <div class="overflow-hidden rounded-kartu border border-line">
          <table class="w-full border-collapse text-left">
            <caption class="sr-only">Data diri tersimpan</caption>
            <thead class="bg-card text-sm text-ink">
              <tr>
                <th scope="col" class="w-[36%] px-4 py-3 font-semibold sm:w-[30%]">Data</th>
                <th scope="col" class="px-2 py-3 font-semibold">Isi</th>
                <th scope="col" class="px-4 py-3"><span class="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody>
              {#each RINGKAS as k (k)}
                {@const c = KOLOM.find((x) => x.k === k)!}
                {@const v = data[k] as string | undefined}
                <tr class="border-t border-line-3">
                  <th scope="row" class="px-4 py-3 text-[0.9375rem] font-normal text-body">{c.label}</th>
                  <td class="px-2 py-3 text-base font-semibold break-words text-ink">
                    {#if v}
                      <span class="inline-flex flex-wrap items-center gap-2">
                        {tampilNilai(k, v)}
                        {#if c.rahasia}
                          <button
                            type="button"
                            onclick={() => (lihat[k] = !lihat[k])}
                            aria-pressed={!!lihat[k]}
                            class="grid size-12 place-items-center rounded-full font-normal text-muted hover:bg-bg-2"
                          >
                            <Icon name={lihat[k] ? 'mata-tutup' : 'mata'} class="size-5" />
                            <span class="sr-only">{lihat[k] ? 'Sembunyikan' : 'Tampilkan'} {c.label}</span>
                          </button>
                        {/if}
                      </span>
                    {:else}
                      <span class="font-normal text-muted">Belum diisi</span>
                    {/if}
                  </td>
                  <td class="px-4 py-1 text-right">
                    <button
                      type="button"
                      onclick={() => mulaiUbah(k)}
                      class="inline-flex min-h-12 items-center rounded-full px-3 text-[0.9375rem] font-semibold text-ink hover:bg-bg-2"
                      >Ubah<span class="sr-only"> {c.label}</span></button
                    >
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <aside class="flex flex-col gap-3 rounded-kartu border border-line bg-card p-5">
        <span class="grid size-11 place-items-center rounded-xl border border-line bg-surface"
          ><Icon name="gembok" class="size-5" /></span
        >
        <h3 class="text-lg font-semibold text-ink">Disimpan di brankas Urusin</h3>
        <p class="text-[0.9375rem] text-body">
          Disimpan terenkripsi dan hanya dipakai untuk formulir yang Anda setujui. AI hanya melihat penanda
          seperti "NIK pemohon", bukan angkanya.
        </p>
        {#if hasil.data.diubahPada}
          <p class="text-sm text-muted">Terakhir diubah {tanggal(hasil.data.diubahPada)}</p>
        {/if}
      </aside>
    </div>
    <p role="status" class="mt-3 text-[0.9375rem] text-hijau-ink">{pesanStatus}</p>
  {/if}
</div>
