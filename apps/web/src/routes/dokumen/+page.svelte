<script lang="ts">
  import { goto, replaceState } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import BrankasTertutup from '#lib/components/akun/BrankasTertutup.svelte';
  import TabBrankas from '#lib/components/akun/TabBrankas.svelte';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import {
    LABEL_JENIS,
    daftarDokumen,
    hapusDokumen,
    ukuranBerkas,
    unduhDokumen,
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
    // Kembali dari masuk ulang (`/dokumen?unduh=<id>`): lanjutkan unduhan yang tadi diminta.
    const unduh = page.url.searchParams.get('unduh');
    if (!unduh || !hasil.ok) return;
    replaceState(resolve('/dokumen'), {});
    const d = hasil.data.dokumen.find((x) => x.id === unduh);
    if (d) await lihat(d);
  }

  /** Buka dokumen. Perangkat baru → masuk ulang dulu (401 PERLU_MASUK_ULANG), lalu kembali ke sini. */
  async function lihat(d: DokumenAkun) {
    const r = await unduhDokumen(d.id);
    if (!r.ok) {
      if (r.lanjut) {
        const masuk = `${resolve('/masuk')}?ulang=1&lanjut=${encodeURIComponent(r.lanjut)}`;
        // eslint-disable-next-line svelte/no-navigation-without-resolve -- path lewat resolve(), hanya ditambah query
        return void (await goto(masuk));
      }
      return void (pesanStatus = r.pesan);
    }
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = d.judul;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  $effect(() => {
    void muat();
  });

  const dokumen = $derived(hasil?.ok ? hasil.data.dokumen : []);
  const jenisAda = $derived([...new Set(dokumen.map((d) => d.jenis))]);
  const tampil = $derived(filter === 'semua' ? dokumen : dokumen.filter((d) => d.jenis === filter));
  const dapatDihapus = $derived(dokumen.filter((d) => !d.bacaSaja));

  $effect(() => {
    if (filter !== 'semua' && !jenisAda.includes(filter)) filter = 'semua';
  });

  // --- Tambah dokumen ---
  // Dialog tertutup tidak terlihat saat load: modulnya dimuat terpisah (dipanaskan saat idle setelah brankas
  // terbuka) dan baru di-mount saat warga menekan Tambah dokumen, jadi formulirnya tidak ikut di-hydrate.
  let TambahDokumen = $state<typeof import('#lib/components/akun/TambahDokumen.svelte').default>();
  let tambah = $state<{ buka(): void }>();
  let modulTambah: Promise<typeof import('#lib/components/akun/TambahDokumen.svelte')> | undefined;
  const muatTambah = () =>
    (modulTambah ??= import('#lib/components/akun/TambahDokumen.svelte').catch((e: unknown) => {
      modulTambah = undefined; // gagal unduh (sinyal putus): coba lagi pada klik berikutnya
      throw e;
    }));

  $effect(() => {
    if (!hasil?.ok) return;
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(() => void muatTambah().catch(() => {}), { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(() => void muatTambah().catch(() => {}), 1000);
    return () => clearTimeout(id);
  });

  async function bukaTambah() {
    try {
      TambahDokumen ??= (await muatTambah()).default;
    } catch {
      return void (pesanStatus = 'Koneksi terputus. Periksa internet, lalu coba lagi.');
    }
    await tick();
    tambah?.buka();
  }

  async function tersimpan(d: DokumenAkun) {
    if (hasil?.ok) hasil = { ok: true, data: { dokumen: [d, ...hasil.data.dokumen] } };
    else await muat();
    // Hasil periksa foto diumumkan juga lewat region status (pembaca layar).
    if (d.periksa?.status === 'perlu_ulang')
      pesanStatus = `${d.judul} perlu difoto ulang: ${d.periksa.ringkasan || 'foto belum jelas'}.`;
    else if (d.periksa?.status === 'jelas') pesanStatus = `${d.judul} tersimpan. Fotonya jelas.`;
  }

  let pesanStatus = $state('');
  async function hapus(d: DokumenAkun) {
    if (!confirm(`Hapus ${d.judul} dari brankas?`)) return;
    const r = await hapusDokumen(d.id);
    if (!r.ok) return void (pesanStatus = r.pesan);
    pesanStatus = `${d.judul} dihapus.`;
    if (hasil?.ok) hasil = { ok: true, data: { dokumen: hasil.data.dokumen.filter((x) => x.id !== d.id) } };
  }

  // Latar sampul per jenis (App 11): KTP biru, KK/akta/surat krem, foto ungu.
  async function hapusSemua() {
    if (
      !confirm(`Hapus semua ${dapatDihapus.length} dokumen dari brankas? Tindakan ini tidak bisa dibatalkan.`)
    )
      return;
    const gagal: string[] = [];
    for (const d of [...dapatDihapus]) {
      const r = await hapusDokumen(d.id);
      if (!r.ok) gagal.push(d.judul);
      else if (hasil?.ok)
        hasil = { ok: true, data: { dokumen: hasil.data.dokumen.filter((x) => x.id !== d.id) } };
    }
    pesanStatus = gagal.length ? `Belum terhapus: ${gagal.join(', ')}.` : 'Semua dokumen dihapus.';
  }

  const LATAR: Record<JenisDokumen, string> = {
    ktp: 'bg-biru',
    kk: 'bg-[#f4efe4] dark:bg-bg-2',
    akta: 'bg-[#f4efe4] dark:bg-bg-2',
    surat: 'bg-[#f4efe4] dark:bg-bg-2',
    foto: 'bg-ungu',
    lainnya: 'bg-bg-2',
  };
</script>

<svelte:head><title>Dokumen · Urusin</title></svelte:head>

<HeaderHalaman judul="Dokumen" />

<div class="flex w-full flex-col gap-6 px-4 py-5 sm:px-10 sm:py-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <TabBrankas aktif="berkas" />
    {#if hasil?.ok}
      <button
        type="button"
        onclick={bukaTambah}
        class="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-primer px-5 text-sm font-semibold text-primer-ink"
      >
        <Icon name="tambah" class="size-4" /> Tambah dokumen
      </button>
    {/if}
  </div>

  {#if hasil === null}
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {#each [0, 1, 2] as i (i)}<div class="h-52 animate-pulse rounded-kartu bg-card"></div>{/each}
    </div>
  {:else if !hasil.ok}
    <BrankasTertutup alasan={hasil.alasan} pesan={hasil.pesan} />
  {:else}
    {#if jenisAda.length > 1}
      <div role="group" aria-label="Saring dokumen" class="-mb-1 flex gap-2 overflow-x-auto pb-1">
        {#each ['semua', ...jenisAda] as j (j)}
          {@const pilih = filter === j}
          <button
            type="button"
            aria-pressed={pilih}
            onclick={() => (filter = j as typeof filter)}
            class="inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-[15px] leading-[22px] {pilih
              ? 'bg-primer font-semibold text-primer-ink shadow-xs'
              : 'border border-line-2 bg-surface text-ink hover:bg-card hover:border-line'}"
          >
            {j === 'semua' ? 'Semua' : LABEL_JENIS[j as JenisDokumen]}
            <span class="text-sm leading-5 {pilih ? 'text-primer-ink/70' : 'text-muted'}">
              {j === 'semua' ? dokumen.length : dokumen.filter((d) => d.jenis === j).length}
            </span>
          </button>
        {/each}
      </div>
    {/if}

    {#if tampil.length}
      <ul class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each tampil as d (d.id)}
          <li
            class="relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a] focus-within:outline-2 focus-within:outline-ink"
          >
            <div class="flex h-[104px] items-center justify-center {LATAR[d.jenis]}" aria-hidden="true">
              {#if d.jenis === 'ktp'}
                <div
                  class="flex h-[74px] w-[120px] gap-2 rounded-lg bg-white p-2.5 shadow-[0_2px_6px_#25252214]"
                >
                  <span class="h-10 w-[30px] rounded bg-[#d9e3ec]"></span>
                  <span class="flex flex-1 flex-col gap-1.5">
                    {#each [60, 48, 54, 36] as w (w)}<span
                        class="h-1 rounded-sm bg-[#2525221f]"
                        style:width="{w}px"
                      ></span>{/each}
                  </span>
                </div>
              {:else}
                <div
                  class="flex h-[88px] w-[70px] flex-col gap-1.5 rounded bg-white px-[9px] py-2.5 shadow-[0_2px_6px_#25252214]"
                >
                  <span class="h-[5px] w-[34px] rounded-sm bg-[#25252240]"></span>
                  {#each [48, 52, 40, 50, 36] as w (w)}<span
                      class="h-[3px] rounded-sm bg-[#2525221f]"
                      style:width="{w}px"
                    ></span>{/each}
                </div>
              {/if}
            </div>
            <div class="flex flex-1 flex-col gap-1.5 px-4 pt-3.5 pb-4">
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-[17px] leading-[25px] font-semibold text-ink">
                  <a
                    href="/api/vault/{encodeURIComponent(d.id)}"
                    target="_blank"
                    rel="external noopener"
                    data-lihat
                    onclick={(e) => {
                      e.preventDefault();
                      void lihat(d);
                    }}
                    class="outline-none after:absolute after:inset-0"
                    >{d.judul}<span class="sr-only"> (lihat berkas)</span></a
                  >
                </h2>
                {#if d.periksa?.status === 'perlu_ulang'}
                  <span
                    class="inline-flex shrink-0 items-center gap-[5px] rounded-full bg-kuning px-2.5 py-1 text-[12.5px] leading-[15px] text-kuning-ink"
                    ><Icon name="peringatan" class="size-3.5" />Perlu difoto ulang</span
                  >
                {:else}
                  <span
                    class="inline-flex shrink-0 items-center gap-[5px] rounded-full bg-hijau px-2.5 py-1 text-[12.5px] leading-[15px] text-hijau-ink"
                    ><Icon name="centang-bulat" class="size-3.5" />{d.periksa?.status === 'jelas'
                      ? 'Jelas'
                      : 'Siap'}</span
                  >
                {/if}
              </div>
              {#if d.periksa?.status === 'perlu_ulang' && d.periksa.ringkasan}
                <p class="text-sm leading-5 text-kuning-ink">{d.periksa.ringkasan}</p>
              {/if}
              <p class="text-[15px] leading-[22px] text-card-ink">
                {LABEL_JENIS[d.jenis]} · {ukuranBerkas(d.ukuran)}
              </p>
              <p class="text-sm leading-5 text-muted">Tersimpan {tanggal(d.disimpanPada)}</p>
              {#if d.bacaSaja}<p class="text-sm leading-5 text-muted">Contoh bawaan · hanya baca</p>{/if}
            </div>
            {#if !d.bacaSaja}<button
                type="button"
                onclick={() => hapus(d)}
                class="absolute top-2 right-2 z-10 grid size-11 place-items-center rounded-full bg-surface/90 text-galat shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a] hover:bg-mawar"
              >
                <Icon name="hapus" class="size-[18px]" /><span class="sr-only">Hapus {d.judul}</span>
              </button>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="flex flex-col items-center gap-3 rounded-kartu bg-card px-6 py-10 text-center">
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

    <p role="status" class="text-[15px] text-ink empty:hidden">{pesanStatus}</p>

    <div class="flex flex-wrap items-center gap-3 rounded-[14px] bg-bg-2 px-[18px] py-3.5">
      <Icon name="gembok" class="size-[18px] shrink-0 text-ink" />
      <p class="flex-1 text-[15px] leading-[22px] text-card-ink">
        Dokumen tidak dikirim ke situs mana pun sampai Anda menyetujui pemakaiannya di sebuah urusan. Foto
        hanya dibaca AI untuk memeriksa kejelasannya.
      </p>
      {#if dapatDihapus.length}
        <button
          type="button"
          onclick={hapusSemua}
          class="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[15px] leading-[22px] font-semibold text-galat hover:bg-mawar"
        >
          <Icon name="hapus" class="size-4" /> Hapus semua dokumen
        </button>
      {/if}
    </div>
  {/if}
</div>

{#if TambahDokumen}<TambahDokumen bind:this={tambah} ontersimpan={tersimpan} />{/if}
