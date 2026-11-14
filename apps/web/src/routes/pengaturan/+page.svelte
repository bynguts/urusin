<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import type { Prefs } from '#lib/contracts.js';
  import Icon from '#lib/components/Icon.svelte';
  import type { NamaIkon } from '#lib/components/ikon.js';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import PilihWilayah from '#lib/components/ui/PilihWilayah.svelte';
  import ZonaBahaya from '#lib/components/akun/ZonaBahaya.svelte';
  import { ambilLokal, ambilPrefs, ambilTts } from '#lib/stores/app.svelte.js';
  import { tanggal } from '#lib/urusan-status.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const prefs = ambilPrefs();
  const lokal = ambilLokal();
  const tts = ambilTts();
  const akun = $derived(page.data.akun as { email: string | null } | null | undefined);

  type Bagian = { id: string; label: string; ikon: NamaIkon };
  /** Urutan sama dengan urutan bagian di halaman; Keluar dan hapus akun (hanya akun warga) selalu paling akhir. */
  const BAGIAN = $derived<Bagian[]>([
    { id: 'tampilan', label: 'Tampilan & suara', ikon: 'huruf' },
    { id: 'wilayah', label: 'Wilayah layanan', ikon: 'lokasi' },
    { id: 'akun', label: 'Akun & keluarga', ikon: 'keluarga' },
    { id: 'ingatan', label: 'Yang Urusin ingat', ikon: 'riwayat' },
    { id: 'privasi', label: 'Privasi & data', ikon: 'perisai-centang' },
    ...(data.zonaBahaya
      ? [{ id: 'zona-bahaya', label: 'Keluar dan hapus akun', ikon: 'peringatan' as const }]
      : []),
  ]);

  /** Ikon per jenis butir ingatan (ikon yang sudah ada di set). */
  const IKON_INGATAN: Record<string, NamaIkon> = {
    ktp: 'lokasi',
    domisili: 'lokasi',
    tujuan: 'pindah',
    bahasa_sederhana: 'huruf',
    lansia: 'orang',
    kanal: 'rute',
    aksesibilitas: 'tangan',
    catatan: 'berkas-teks',
  };
  let aktif = $state('tampilan');

  const UKURAN: { nilai: Prefs['ukuranHuruf']; label: string; aa: string }[] = [
    { nilai: 1, label: 'Normal', aa: 'text-base leading-4' },
    { nilai: 1.25, label: 'Besar', aa: 'text-xl leading-5' },
    { nilai: 1.5, label: 'Sangat besar', aa: 'text-2xl leading-6' },
  ];

  // Kelas bersama: satu kartu per bagian, baris di dalamnya dipisah garis tipis.
  const KARTU = 'overflow-hidden rounded-[18px] border border-line bg-surface';
  const BARIS = 'flex gap-3.5 border-t border-line px-[16px] py-4 first:border-t-0 sm:px-[22px] sm:py-[18px]';
  const TOMBOL =
    'inline-flex min-h-12 max-w-full shrink-0 items-center justify-center gap-2 rounded-full py-2 text-center text-[0.9375rem] font-semibold transition-colors duration-150 disabled:opacity-60';
  const SEKUNDER = `${TOMBOL} border border-line-2 bg-surface px-5 text-ink hover:bg-card`;
  const PRIMER = `${TOMBOL} bg-primer px-6 text-primer-ink hover:opacity-90`;
  const BAHAYA = `${TOMBOL} border border-galat-garis bg-surface px-5 text-galat hover:bg-mawar`;
  /** Ubin ikon 40px di awal baris; warna bisa diganti tanpa bentrok kelas. */
  const ubin = (warna = 'bg-bg-2 text-ink') => `grid size-10 shrink-0 place-items-center rounded-xl ${warna}`;
  const UBIN = ubin();

  let kodeWilayah = $state(lokal.data.wilayah?.kodeKabKota ?? '');
  let wilayahTersimpan = $state(false);
  function simpanWilayah() {
    const k = data.kota.find((x) => x.kodeKabKota === kodeWilayah);
    lokal.aturWilayah(k ? { kodeKabKota: k.kodeKabKota, nama: k.nama } : null);
    wilayahTersimpan = true;
  }

  let dataDihapus = $state(false);
  function hapusLokal() {
    if (!confirm('Hapus daftar urusan, pesan, dan pengaturan dari perangkat ini?')) return;
    lokal.hapusSemua();
    prefs.reset();
    tts.berhenti();
    kodeWilayah = '';
    wilayahTersimpan = false;
    dataDihapus = true;
  }

  // Google: tautkan (butuh masuk <= 15 menit; server mengarahkan ke masuk ulang) atau lepas.
  let google = $state<{ aktif: boolean; tertaut: boolean } | null>(null);
  let pesanGoogle = $state('');
  $effect(() => {
    if (!akun?.email) return;
    void fetch('/api/akun', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { metode?: { google: boolean }; akun?: { terhubungGoogle: boolean } } | null) => {
        if (s?.akun) google = { aktif: s.metode?.google ?? false, tertaut: s.akun.terhubungGoogle };
      });
  });
  async function lepasGoogle() {
    if (!confirm('Lepas akun Google? Setelah ini masuk memakai email dan kata sandi.')) return;
    const r = await fetch('/api/akun/google/lepas', { method: 'POST' });
    const j = (await r.json().catch(() => null)) as { pesanWarga?: string } | null;
    if (r.ok && google) google = { ...google, tertaut: false };
    pesanGoogle = r.ok ? 'Google sudah dilepas.' : (j?.pesanWarga ?? 'Gagal melepas Google. Coba lagi.');
  }

  let keluarSibuk = $state(false);
  async function keluar() {
    keluarSibuk = true;
    try {
      await fetch('/api/akun/keluar', { method: 'POST' });
    } finally {
      // Perangkat bersama: daftar urusan dan pesan di perangkat ini ikut dihapus sebelum pindah halaman.
      lokal.hapusSemua();
      location.assign(resolve('/'));
    }
  }

  const coba = () =>
    tts.baca('Untuk akta kelahiran, siapkan surat keterangan lahir dari bidan atau rumah sakit.');

  function scrollKeBagian(id: string, e: MouseEvent) {
    e.preventDefault();
    aktif = id;
    const el = document.getElementById(id);
    const panel = document.getElementById('panel-utama');
    if (el && panel && window.innerWidth >= 1024) {
      const panelRect = panel.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetScrollTop = panel.scrollTop + (elRect.top - panelRect.top) - 67.5 - 12;
      panel.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
      history.replaceState(null, '', `#${id}`);
    } else if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', `#${id}`);
    }
  }

  $effect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            aktif = entry.target.id;
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 },
    );
    for (const b of BAGIAN) {
      const el = document.getElementById(b.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  });
</script>

<svelte:head><title>Pengaturan · Urusin</title></svelte:head>

<HeaderHalaman judul="Pengaturan" />

<div class="flex flex-1 items-start">
  <nav
    aria-label="Bagian pengaturan"
    class="hidden w-[259.5px] shrink-0 border-r border-line bg-card px-4 py-5 lg:sticky lg:top-[67.5px] lg:block lg:h-[calc(100dvh-67.5px-24px)] lg:self-start lg:overflow-y-auto"
  >
    <ul class="flex flex-col gap-1">
      {#each BAGIAN as b (b.id)}
        <li>
          <a
            href="#{b.id}"
            onclick={(e) => scrollKeBagian(b.id, e)}
            aria-current={aktif === b.id ? 'true' : undefined}
            class="flex h-12 items-center gap-2.5 rounded-xl px-3 text-base leading-[23px] transition-all duration-150 {aktif ===
            b.id
              ? 'bg-surface font-semibold text-ink shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]'
              : 'text-card-ink hover:bg-surface/60'}"
          >
            <Icon
              name={b.ikon}
              class="size-[18px] shrink-0 {b.id === 'zona-bahaya' ? 'text-galat' : 'text-ink'}"
            />{b.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <div
    class="@container flex min-w-0 flex-1 flex-col gap-10 px-4 pt-6 pb-10 sm:gap-12 sm:px-8 lg:px-12 lg:pt-8 lg:pb-16"
  >
    <!-- Tampilan & suara -->
    <section
      id="tampilan"
      aria-labelledby="h-tampilan"
      class="flex max-w-[50rem] scroll-mt-24 flex-col gap-4"
    >
      {@render kepala('tampilan', 'Tampilan & suara', 'Atur supaya Urusin nyaman dibaca dan didengar.')}

      <div class={KARTU}>
        <fieldset class="flex flex-col gap-4 p-[16px] sm:px-[22px] sm:py-5">
          <legend class="sr-only">Ukuran huruf</legend>
          <div class="flex items-center gap-3.5">
            <span aria-hidden="true" class={UBIN}><Icon name="huruf" class="size-[18px]" /></span>
            <div class="flex min-w-0 flex-col gap-0.5">
              <p aria-hidden="true" class="text-[1.0625rem] leading-[1.5625rem] font-semibold text-ink">
                Ukuran huruf
              </p>
              <p class="text-[0.9375rem] leading-[1.375rem] text-muted">Berlaku di semua halaman Urusin.</p>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-1.5 rounded-2xl bg-bg-2 p-[5px]">
            {#each UKURAN as u (u.nilai)}
              {@const pilih = prefs.nilai.ukuranHuruf === u.nilai}
              <label
                class="relative flex min-h-16 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition-all duration-150 ease-out has-focus-visible:outline-2 has-focus-visible:outline-ink active:scale-[0.98] @sm:flex-row @sm:gap-2.5 @sm:px-2 {pilih
                  ? 'bg-surface shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]'
                  : 'hover:bg-surface/60'}"
              >
                <input
                  type="radio"
                  name="ukuran"
                  class="sr-only"
                  checked={pilih}
                  onchange={() => prefs.atur('ukuranHuruf', u.nilai)}
                />
                <span aria-hidden="true" class="font-semibold text-ink {u.aa}">Aa</span>
                <span
                  class="text-sm sm:text-[0.9375rem] sm:leading-[1.375rem] {pilih
                    ? 'font-semibold text-ink'
                    : 'text-card-ink'}">{u.label}</span
                >
                {#if pilih}<Icon name="centang" class="hidden size-4 sm:block" />{/if}
              </label>
            {/each}
          </div>
          <div class="flex flex-col gap-1 rounded-xl bg-card px-4 py-3.5 sm:px-[18px]">
            <p class="text-sm leading-5 text-muted">Contoh</p>
            <p class="text-lg text-ink sm:text-xl sm:leading-[1.875rem]">
              Untuk akta kelahiran, siapkan surat keterangan lahir dari bidan atau rumah sakit.
            </p>
          </div>
        </fieldset>

        <ul class="border-t border-line">
          {@render saklar(
            'kontras',
            'kontras',
            'Kontras tinggi',
            'Teks dan garis lebih tegas.',
            lokal.data.kontrasTinggi,
            (v) => lokal.atur('kontrasTinggi', v),
          )}
          {@render saklar(
            'gerak',
            'gerak',
            'Kurangi gerakan',
            'Matikan animasi yang tidak perlu.',
            lokal.data.kurangiGerak,
            (v) => lokal.atur('kurangiGerak', v),
          )}
          {#if tts.tersedia}
            {@render saklar(
              'bacakan',
              'bacakan',
              'Bacakan jawaban otomatis',
              'Ana membacakan setiap jawaban dengan suara Bahasa Indonesia.',
              prefs.nilai.bacakanOtomatis,
              (v) => prefs.atur('bacakanOtomatis', v),
              true,
            )}
          {:else}
            <li class="{BARIS} items-start">
              <span aria-hidden="true" class={UBIN}><Icon name="bacakan" class="size-[18px]" /></span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-[1.0625rem] leading-[1.5625rem] font-semibold text-ink"
                  >Bacakan jawaban</span
                >
                <span class="text-[0.9375rem] leading-[1.375rem] text-muted"
                  >Perangkat ini belum punya suara Bahasa Indonesia untuk membacakan.</span
                >
              </span>
            </li>
          {/if}
        </ul>
      </div>
    </section>

    <!-- Wilayah layanan (ditautkan dari Beranda: #wilayah) -->
    <section id="wilayah" aria-labelledby="h-wilayah" class="flex max-w-[50rem] scroll-mt-24 flex-col gap-4">
      {@render kepala(
        'wilayah',
        'Wilayah layanan',
        'Opsional. Kab/kota tempat KTP Anda terdaftar, disimpan di perangkat ini sebagai usulan: Urusin menanyakannya sekali bila jawabannya bergantung pada wilayah. Wilayah yang sudah pernah Anda pastikan langsung dipakai, dan bisa diubah kapan saja lewat "Ubah" di urusan.',
        'd-wilayah',
      )}
      <form
        class="flex flex-col gap-3 rounded-[18px] border border-line bg-surface px-[16px] py-4 @lg:flex-row @lg:items-end sm:px-[22px] sm:py-5"
        onsubmit={(e) => {
          e.preventDefault();
          simpanWilayah();
        }}
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <label for="pilih-wilayah" class="text-[0.9375rem] font-semibold text-ink">Kab/kota</label>
          <PilihWilayah
            id="pilih-wilayah"
            kota={data.kota}
            bind:value={kodeWilayah}
            onchange={() => (wilayahTersimpan = false)}
            describedby="d-wilayah"
            bolehKosong
            placeholder="Belum dipilih"
          />
        </div>
        <button type="submit" class={PRIMER}>Simpan wilayah</button>
      </form>
      <p role="status" class="-mt-1 flex items-center gap-1.5 text-[0.9375rem] text-hijau-ink">
        {#if wilayahTersimpan}<Icon name="centang-bulat" class="size-4 shrink-0" />{lokal.data.wilayah
            ? `Wilayah disimpan: ${lokal.data.wilayah.nama}.`
            : 'Pilihan wilayah dihapus.'}{/if}
      </p>
    </section>

    <!-- Akun & keluarga -->
    <section id="akun" aria-labelledby="h-akun" class="flex max-w-[50rem] scroll-mt-24 flex-col gap-4">
      {@render kepala(
        'akun',
        'Akun & keluarga',
        akun ? 'Akun yang sedang dipakai di perangkat ini.' : 'Masuk untuk menyimpan data diri dan dokumen.',
      )}
      <div class={KARTU}>
        {#if akun}
          <div class="{BARIS} flex-col @lg:flex-row @lg:items-center">
            <div class="flex min-w-0 flex-1 items-center gap-3.5">
              <span aria-hidden="true" class={UBIN}><Icon name="orang" class="size-[18px]" /></span>
              <p class="flex min-w-0 flex-col gap-0.5">
                <span class="text-[0.9375rem] leading-[1.375rem] text-muted">Masuk sebagai</span>
                <span class="text-[1.0625rem] leading-[1.5625rem] font-semibold break-all text-ink"
                  >{akun.email ?? 'Salinan demo juri (terhapus dalam 24 jam)'}</span
                >
              </p>
            </div>
            <button type="button" onclick={keluar} disabled={keluarSibuk} class={SEKUNDER}>
              <Icon name="log-keluar" class="size-4.5" /> Keluar
            </button>
          </div>

          <div class="{BARIS} flex-col @lg:flex-row @lg:items-center">
            <div class="flex min-w-0 flex-1 items-center gap-3.5">
              <span aria-hidden="true" class={UBIN}><Icon name="keluarga" class="size-[18px]" /></span>
              <p class="flex min-w-0 flex-col gap-0.5">
                <span class="text-[1.0625rem] leading-[1.5625rem] font-semibold text-ink"
                  >Data diri keluarga</span
                >
                <span class="text-[0.9375rem] leading-[1.375rem] text-muted"
                  >Isi sekali, dipakai untuk mengisi formulir urusan.</span
                >
              </p>
            </div>
            <a href={resolve('/data-diri')} class={SEKUNDER}>
              Buka<span class="sr-only"> data diri keluarga</span>
              <Icon name="panah" class="size-4" />
            </a>
          </div>

          {#if google && (google.tertaut || google.aktif)}
            <div data-google class="{BARIS} flex-col @lg:flex-row @lg:items-center">
              <div class="flex min-w-0 flex-1 items-center gap-3.5">
                <span aria-hidden="true" class={UBIN}><Icon name="perisai" class="size-[18px]" /></span>
                <div class="flex min-w-0 flex-col gap-0.5">
                  <p class="text-[1.0625rem] leading-[1.5625rem] font-semibold text-ink">Akun Google</p>
                  <p class="text-[0.9375rem] leading-[1.375rem] text-muted">
                    {google.tertaut
                      ? 'Tertaut. Anda bisa masuk dengan Google.'
                      : 'Belum tertaut. Tautkan supaya bisa masuk dengan Google.'}
                  </p>
                  {#if pesanGoogle}
                    <p role="status" class="text-[0.9375rem] leading-[1.375rem] font-medium text-ink">
                      {pesanGoogle}
                    </p>
                  {/if}
                </div>
              </div>
              {#if google.tertaut}
                <button type="button" onclick={lepasGoogle} class={SEKUNDER}>Lepas Google</button>
              {:else}
                <form method="GET" action="/auth/google" data-sveltekit-reload class="flex flex-col">
                  <input type="hidden" name="next" value="/pengaturan" />
                  <button type="submit" class={SEKUNDER}>Tautkan Google</button>
                </form>
              {/if}
            </div>
          {/if}
        {:else}
          <div class="{BARIS} flex-col @lg:flex-row @lg:items-center">
            <div class="flex min-w-0 flex-1 items-center gap-3.5">
              <span aria-hidden="true" class={UBIN}><Icon name="orang" class="size-[18px]" /></span>
              <p class="text-[0.9375rem] leading-[1.375rem] text-body">
                Masuk supaya data diri dan dokumen tersimpan aman dan bisa dipakai di urusan berikutnya.
              </p>
            </div>
            <a href={resolve('/masuk')} class={PRIMER}>Masuk</a>
          </div>
        {/if}
      </div>
    </section>

    <!-- Yang Urusin ingat -->
    <section id="ingatan" aria-labelledby="h-ingatan" class="flex max-w-[50rem] scroll-mt-24 flex-col gap-4">
      {@render kepala(
        'ingatan',
        'Yang Urusin ingat',
        'Hal yang Anda sebut sendiri di urusan sebelumnya, supaya tidak perlu bercerita ulang. Tanpa data pribadi seperti NIK atau alamat. Wilayah yang sudah pernah Anda pastikan langsung dipakai di urusan baru, dan bisa diubah kapan saja lewat "Ubah".',
      )}
      {#if data.ingatanTamu.length > 0}
        <div
          role="group"
          aria-label="Ingatan dari perangkat ini"
          class="flex flex-col gap-3 rounded-[18px] border border-line bg-card px-[16px] py-4 sm:px-[22px] sm:py-5"
        >
          <div class="flex items-start gap-3.5">
            <span aria-hidden="true" class={ubin('bg-surface text-ink')}
              ><Icon name="info" class="size-[18px]" /></span
            >
            <div class="flex min-w-0 flex-col gap-2">
              <p class="text-[0.9375rem] leading-[1.375rem] text-body">
                Ada {data.ingatanTamu.length} hal yang diingat di perangkat ini sebelum Anda masuk:
              </p>
              <ul
                aria-label="Diingat di perangkat ini"
                class="flex list-disc flex-col gap-1 pl-5 text-[0.9375rem] leading-[1.375rem] text-ink marker:text-muted"
              >
                {#each data.ingatanTamu as b (b.id)}<li>{b.label}</li>{/each}
              </ul>
            </div>
          </div>
          <div class="flex flex-wrap gap-2 sm:pl-[3.375rem]">
            <form method="POST" action="?/bawaIngatanTamu">
              <button type="submit" class={PRIMER}>Bawa ke akun</button>
            </form>
            <form method="POST" action="?/buangIngatanTamu">
              <button type="submit" class={SEKUNDER}>Buang</button>
            </form>
          </div>
        </div>
      {/if}
      {#if data.ingatanRusak}
        <div class="{KARTU} {BARIS} flex-col @lg:flex-row @lg:items-center">
          <div class="flex min-w-0 flex-1 items-center gap-3.5">
            <span aria-hidden="true" class={ubin('bg-mawar text-galat')}
              ><Icon name="peringatan" class="size-[18px]" /></span
            >
            <p role="status" class="text-[0.9375rem] leading-[1.375rem] text-body">
              Ingatan tidak bisa dibaca saat ini. Anda tetap bisa menghapus semuanya.
            </p>
          </div>
          <form method="POST" action="?/hapusSemuaIngatan" class="flex flex-col">
            <button type="submit" class={BAHAYA}>
              <Icon name="hapus" class="size-4.5 shrink-0" /> Hapus semua ingatan
            </button>
          </form>
        </div>
      {:else if data.ingatan.length > 0}
        <div class={KARTU}>
          <ul aria-label="Butir yang diingat">
            {#each data.ingatan as b (b.id)}
              <li class="{BARIS} items-center">
                <span aria-hidden="true" class={UBIN}
                  ><Icon name={IKON_INGATAN[b.jenis] ?? 'riwayat'} class="size-[18px]" /></span
                >
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="text-[1.0625rem] leading-[1.5625rem] font-semibold break-words text-ink"
                    >{b.label}</span
                  >
                  <span class="text-[0.9375rem] leading-[1.375rem] text-muted">Diingat {tanggal(b.at)}</span>
                </span>
                <form method="POST" action="?/hapusIngatan">
                  <input type="hidden" name="id" value={b.id} />
                  <button
                    type="submit"
                    class="-mr-3 inline-flex h-11 shrink-0 items-center rounded-full px-3 text-[0.9375rem] font-semibold text-galat transition-colors duration-150 hover:bg-mawar"
                    >Hapus<span class="sr-only"> {b.label}</span></button
                  >
                </form>
              </li>
            {/each}
          </ul>
          <div
            class="flex flex-col gap-3 border-t border-line bg-card px-[16px] py-4 @lg:flex-row @lg:items-center @lg:justify-between sm:px-[22px]"
          >
            <p class="text-[0.9375rem] leading-[1.375rem] text-body">
              {data.ingatan.length} hal diingat. Menghapus tidak mengubah urusan yang sedang berjalan.
            </p>
            <form method="POST" action="?/hapusSemuaIngatan" class="flex flex-col">
              <button type="submit" class={BAHAYA}>
                <Icon name="hapus" class="size-4.5 shrink-0" /> Hapus semua ingatan
              </button>
            </form>
          </div>
        </div>
      {:else}
        <div class="{KARTU} {BARIS} items-center">
          <span aria-hidden="true" class={UBIN}><Icon name="riwayat" class="size-[18px]" /></span>
          <p role="status" class="text-[0.9375rem] leading-[1.375rem] text-body">Belum ada yang diingat.</p>
        </div>
      {/if}
    </section>

    <!-- Privasi & data -->
    <section id="privasi" aria-labelledby="h-privasi" class="flex max-w-[50rem] scroll-mt-24 flex-col gap-4">
      {@render kepala(
        'privasi',
        'Privasi & data',
        'Daftar urusan dan pengaturan ini disimpan di perangkat ini. Data Diri dan dokumen disimpan terenkripsi di server dan ikut akun Anda sampai Anda menghapusnya.',
      )}
      <div class="{KARTU} {BARIS} flex-col @lg:flex-row @lg:items-center">
        <div class="flex min-w-0 flex-1 items-center gap-3.5">
          <span aria-hidden="true" class={UBIN}><Icon name="map" class="size-[18px]" /></span>
          <p class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[1.0625rem] leading-[1.5625rem] font-semibold text-ink"
              >Data di perangkat ini</span
            >
            <span class="text-[0.9375rem] leading-[1.375rem] text-muted">
              {dataDihapus
                ? 'Data di perangkat ini sudah dihapus.'
                : `${lokal.data.urusan.length} urusan tersimpan di perangkat ini.`}
            </span>
          </p>
        </div>
        <button type="button" onclick={hapusLokal} class={BAHAYA}>
          <Icon name="hapus" class="size-4.5 shrink-0" />
          <span class="min-w-0">Hapus data di perangkat ini</span>
        </button>
      </div>
      {#if page.data.versi}
        <p class="sr-only" data-versi>
          {#if page.data.versi.commit}
            <a
              href={page.data.versi.commit}
              rel="external noopener"
              class="underline underline-offset-2 hover:text-ink">v{page.data.versi.sha7}</a
            >
          {:else}
            v{page.data.versi.sha7}
          {/if}
        </p>
      {/if}
    </section>

    {#if data.zonaBahaya}
      <ZonaBahaya punyaSandi={data.zonaBahaya.punyaSandi} galat={form ?? null} />
    {/if}
  </div>
</div>

{#snippet kepala(id: string, judul: string, ket: string, ketId?: string)}
  <div class="flex flex-col gap-1">
    <h2
      id="h-{id}"
      class="text-[1.25rem] leading-[1.75rem] font-semibold tracking-[-0.4px] text-ink sm:text-[1.375rem] sm:leading-[1.875rem]"
    >
      {judul}
    </h2>
    <p
      id={ketId}
      class="max-w-[42rem] text-[0.9375rem] leading-[1.375rem] text-body sm:text-base sm:leading-[1.5625rem]"
    >
      {ket}
    </p>
  </div>
{/snippet}

{#snippet saklar(
  id: string,
  ikon: NamaIkon,
  judul: string,
  ket: string,
  nyala: boolean,
  ubah: (v: boolean) => void,
  denganCoba = false,
)}
  <li class="{BARIS} items-center">
    <span aria-hidden="true" class={UBIN}><Icon name={ikon} class="size-[18px]" /></span>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span id="s-{id}" class="text-[1.0625rem] leading-[1.5625rem] font-semibold text-ink">{judul}</span>
      <span id="k-{id}" class="text-[0.9375rem] leading-[1.375rem] text-muted">{ket}</span>
      {#if denganCoba}
        <button
          type="button"
          onclick={coba}
          class="-mb-2 -ml-2.5 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full px-2.5 text-[0.9375rem] font-semibold text-ink transition-colors duration-150 hover:bg-bg-2"
        >
          <Icon name="putar" class="size-3.5" /> Coba dengar
        </button>
      {/if}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={nyala}
      aria-labelledby="s-{id}"
      aria-describedby="k-{id}"
      onclick={() => ubah(!nyala)}
      class="relative -my-2 grid h-12 w-14 shrink-0 place-items-center transition-transform duration-150 active:scale-95"
    >
      <span
        class="h-8 w-14 rounded-full transition-colors duration-200 ease-out {nyala
          ? 'bg-primer'
          : 'bg-line-2'}"
      ></span>
      <span
        class="absolute top-1/2 left-1/2 -ml-[13px] size-[26px] -translate-y-1/2 rounded-full bg-surface transition-transform duration-200 ease-out {nyala
          ? 'translate-x-3'
          : '-translate-x-3'}"
      ></span>
    </button>
  </li>
{/snippet}
