<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import Field from '#lib/components/ui/Field.svelte';
  import Tombol from '#lib/components/ui/Tombol.svelte';
  import InputSandi from '#lib/components/auth/InputSandi.svelte';
  import { ambilLokal } from '#lib/stores/app.svelte.js';

  /**
   * Zona bahaya akun (hak hapus UU PDP): "Keluar dari semua perangkat" dan "Hapus akun". Form action di
   * `/pengaturan` (`?/keluarSemua`, `?/hapusAkun`), jalan tanpa JS; `use:enhance` hanya menambah status sibuk.
   * Hapus akun: ketik HAPUS + sandi (akun bersandi). Akun Google saja diminta masuk ulang dengan Google bila
   * login terakhir lebih dari 15 menit lalu (server mengarahkan ke /masuk?ulang=1, lalu kembali ke sini).
   * Hanya untuk akun (bukan sesi juri, docs/ui/auth.md).
   */
  let {
    punyaSandi,
    galat = null,
  }: {
    punyaSandi: boolean;
    /** `form` dari action `hapusAkun` (kode + pesan warga); null bila tidak ada galat. */
    galat?: { kode: string; pesanWarga: string } | null;
  } = $props();

  const aksi = resolve('/pengaturan');
  const lokal = ambilLokal();
  let sibukKeluar = $state(false);
  let sibukHapus = $state(false);
</script>

<section
  id="zona-bahaya"
  aria-labelledby="h-zona-bahaya"
  data-zona-bahaya
  class="flex max-w-[50rem] scroll-mt-24 flex-col gap-4"
>
  <h2 id="h-zona-bahaya" class="text-[1.375rem] tracking-[-0.02em] text-ink">Zona bahaya</h2>

  <form
    method="POST"
    action="{aksi}?/keluarSemua"
    data-keluar-semua
    class="flex flex-col gap-3 rounded-kartu border border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
    use:enhance={() => {
      sibukKeluar = true;
      return async ({ result, update }) => {
        // Berhasil (redirect): daftar urusan dan pesan di perangkat ini ikut dihapus (perangkat bersama).
        if (result.type === 'redirect') lokal.hapusSemua();
        await update();
        sibukKeluar = false;
      };
    }}
  >
    <div class="min-w-0">
      <p class="font-semibold text-ink">Keluar dari semua perangkat</p>
      <p class="text-[0.9375rem] text-body">
        Semua perangkat yang memakai akun ini akan keluar, termasuk perangkat ini.
      </p>
    </div>
    <Tombol type="submit" varian="sekunder" ikon="log-keluar" sibuk={sibukKeluar} disabled={sibukKeluar}
      >Keluar dari semua perangkat</Tombol
    >
  </form>

  <form
    method="POST"
    action="{aksi}?/hapusAkun"
    data-hapus-akun
    class="flex flex-col gap-4 rounded-kartu border border-galat-garis/60 p-4 sm:p-5"
    use:enhance={() => {
      sibukHapus = true;
      return async ({ result, update }) => {
        // Terhapus (redirect ke /), bukan diminta masuk ulang dulu.
        if (result.type === 'redirect' && result.location === '/') lokal.hapusSemua();
        await update({ reset: false });
        sibukHapus = false;
      };
    }}
  >
    <div>
      <p class="font-semibold text-galat">Hapus akun</p>
      <p class="text-[0.9375rem] text-body">
        Akun, Data Diri, dokumen, dan urusan yang tersimpan di akun dihapus permanen. Kunci enkripsinya ikut
        dihancurkan, jadi data ini tidak bisa dipulihkan, termasuk dari cadangan.
      </p>
    </div>

    <Field
      id="konfirmasi-hapus"
      label="Ketik HAPUS untuk melanjutkan"
      galat={galat?.kode === 'KONFIRMASI_SALAH' ? galat.pesanWarga : undefined}
    >
      {#snippet children({ describedby, invalid })}
        <input
          id="konfirmasi-hapus"
          name="konfirmasi"
          type="text"
          required
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          pattern="HAPUS"
          maxlength="20"
          aria-describedby={describedby}
          aria-invalid={invalid || undefined}
          class="h-12 w-full rounded-xl border border-line-2 bg-surface px-3 text-base text-ink sm:max-w-xs"
        />
      {/snippet}
    </Field>

    {#if punyaSandi}
      <Field
        id="sandi-hapus"
        label="Kata sandi"
        galat={galat && galat.kode !== 'KONFIRMASI_SALAH' ? galat.pesanWarga : undefined}
      >
        {#snippet children({ describedby, invalid })}
          <div class="sm:max-w-xs">
            <InputSandi id="sandi-hapus" autocomplete="current-password" {describedby} {invalid} />
          </div>
        {/snippet}
      </Field>
    {:else}
      <p class="text-sm text-muted">
        Akun ini masuk dengan Google. Bila login terakhir lebih dari 15 menit lalu, Anda diminta masuk ulang
        dengan Google dulu, lalu kembali ke sini.
      </p>
      {#if galat && galat.kode !== 'KONFIRMASI_SALAH'}
        <p role="alert" class="text-sm font-medium text-galat">{galat.pesanWarga}</p>
      {/if}
    {/if}

    <div>
      <Tombol type="submit" varian="bahaya" ikon="hapus" sibuk={sibukHapus} disabled={sibukHapus}
        >Hapus akun permanen</Tombol
      >
    </div>
  </form>
</section>
