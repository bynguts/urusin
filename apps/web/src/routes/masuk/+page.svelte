<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import Icon from '#lib/components/Icon.svelte';
  import InputSandi from '#lib/components/auth/InputSandi.svelte';
  import KerangkaAuth from '#lib/components/auth/KerangkaAuth.svelte';
  import { dataAuth, formAuth, galatAuth } from '#lib/components/auth/form.js';

  /**
   * App 15 Masuk. Aksi `?/masuk` (email + sandi; `turnstile` diisi widget setelah 3 gagal) dan `?/juri`
   * (salinan demo terisolasi, Turnstile). `tautkan` = Google menunggu bukti sandi. Jalan tanpa JS.
   */
  const data =
    $derived(
      dataAuth<{
        next: string;
        googleAktif: boolean;
        juri: boolean;
        turnstileSiteKey: string;
        tautkan: boolean;
        ulang: { email: string } | null;
      }>(),
    );
  const form = $derived(formAuth());
  const galat = $derived(galatAuth());
  const next = $derived(data.next ?? '/');
  let sibuk = $state(false);
</script>

<svelte:head><title>Masuk · Urusin</title></svelte:head>

<KerangkaAuth
  judul="Urusan administrasi, kini ada yang menemani"
  sub="Lanjutkan urusan keluarga Anda dari HP, laptop, atau komputer mana saja."
>
  <h1 class="text-[1.875rem] tracking-[-0.03em] text-ink">Masuk ke Urusin</h1>
  <p class="mt-2 text-base text-body">Lanjutkan urusan keluarga Anda.</p>

  {#if galat}
    <div
      role="alert"
      data-kode={galat.kode}
      class="mt-5 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat"
    >
      <p>{galat.pesanWarga}</p>
      {#if galat.kode === 'EMAIL_BELUM_TERVERIFIKASI'}
        <a
          href={resolve('/verifikasi-email')}
          class="mt-1 inline-flex min-h-12 items-center font-semibold underline">Kirim ulang tautan</a
        >
      {/if}
    </div>
  {/if}

  {#if data.ulang}
    <p data-ulang role="status" class="mt-5 rounded-xl bg-bg-2 px-4 py-3 text-[0.9375rem] text-ink">
      Demi keamanan, masuk sekali lagi sebelum membuka dokumen di perangkat ini. Setelah itu dokumen langsung
      terbuka.
    </p>
  {/if}

  {#if data.tautkan}
    <p data-tautkan role="status" class="mt-5 rounded-xl bg-bg-2 px-4 py-3 text-[0.9375rem] text-ink">
      Email ini sudah punya akun Urusin. Masuk dengan kata sandi untuk menautkan akun Google Anda.
    </p>
  {/if}

  {#if data.googleAktif}
    <form method="GET" action="/auth/google" data-sveltekit-reload class="mt-6">
      <input type="hidden" name="next" value={next} />
      {#if data.ulang}<input type="hidden" name="ulang" value="1" />{/if}
      <button
        type="submit"
        class="flex min-h-14 w-full items-center justify-center rounded-full border border-line-2 bg-surface font-semibold text-ink hover:bg-card"
        >Lanjutkan dengan Google</button
      >
    </form>
    <p class="my-5 flex items-center gap-3 text-sm text-muted">
      <span class="h-px flex-1 bg-line"></span>atau pakai email<span class="h-px flex-1 bg-line"></span>
    </p>
  {/if}

  <form
    method="POST"
    action="?/masuk"
    class="flex flex-col gap-4 {data.googleAktif ? '' : 'mt-6'}"
    use:enhance={() => {
      sibuk = true;
      return async ({ update }) => {
        await update({ reset: false });
        sibuk = false;
      };
    }}
  >
    <input type="hidden" name="next" value={next} />
    <!-- Widget Turnstile (site key data.turnstileSiteKey) mengisi cf-turnstile-response; field ini untuk uji. -->
    <input type="hidden" name="turnstile" value="" />
    <div class="flex flex-col gap-2">
      <label for="email" class="text-[0.9375rem] font-semibold text-ink">Email</label>
      <div class="relative">
        <Icon
          name="surel"
          class="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
        />
        <input
          id="email"
          name="email"
          type="email"
          inputmode="email"
          autocomplete="email"
          required
          value={form?.email ?? data.ulang?.email ?? ''}
          class="h-14 w-full rounded-2xl border border-line-2 bg-surface pr-4 pl-12 text-base text-ink"
        />
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between gap-3">
        <label for="sandi" class="text-[0.9375rem] font-semibold text-ink">Kata sandi</label>
        <a
          href={resolve('/lupa-sandi')}
          class="inline-flex min-h-12 items-center text-[0.9375rem] font-semibold text-brand"
          >Lupa kata sandi?</a
        >
      </div>
      <InputSandi id="sandi" autocomplete="current-password" invalid={galat?.kode === 'KREDENSIAL_SALAH'} />
    </div>
    <button
      type="submit"
      disabled={sibuk}
      class="mt-1 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primer font-semibold text-primer-ink hover:opacity-90 disabled:opacity-60"
    >
      Masuk <Icon name="panah" class="size-4.5" />
    </button>
  </form>

  <div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-[0.9375rem] text-body">
    <p>
      Belum punya akun? <a
        href={resolve('/daftar')}
        class="inline-flex min-h-12 items-center font-semibold text-ink">Daftar</a
      >
    </p>
    <a href={resolve('/beranda')} class="inline-flex min-h-12 items-center font-semibold text-ink underline"
      >Coba tanpa daftar</a
    >
  </div>

  {#if data.juri}
    <section class="mt-4 rounded-2xl border border-line bg-card px-4 py-4">
      <p class="text-[0.9375rem] text-body">
        Juri lomba tidak perlu akun: satu klik membuat salinan demo berisi data contoh, khusus untuk Anda,
        terhapus otomatis dalam 24 jam. Data contoh tidak pernah dikirim ke situs pemerintah.
      </p>
      <form method="POST" action="?/juri" data-juri class="mt-3">
        <input type="hidden" name="turnstile" value="" />
        <button
          type="submit"
          class="flex min-h-14 w-full items-center justify-center gap-2 rounded-full border border-line-2 bg-surface font-semibold text-ink hover:bg-bg-2"
        >
          <Icon name="perisai-centang" class="size-5" /> Masuk sebagai juri
        </button>
      </form>
    </section>
  {/if}
</KerangkaAuth>
