<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import Icon from '#lib/components/Icon.svelte';
  import InputSandi from '#lib/components/auth/InputSandi.svelte';
  import KerangkaAuth from '#lib/components/auth/KerangkaAuth.svelte';
  import { dataAuth, formAuth, galatAuth } from '#lib/components/auth/form.js';
  import { turnstile, ulangTurnstile } from '#lib/components/auth/turnstile.js';

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
  judul="Urusan administrasi,&#10;kini ada yang menemani"
  sub="Lanjutkan urusan keluarga Anda dari HP, laptop, atau komputer mana saja."
>
  <h1 class="text-[2rem] leading-[37px] font-semibold tracking-[-0.9px] text-ink">Masuk ke Urusin</h1>
  <p class="mt-2 text-[1.0625rem] leading-[25px] text-body">Lanjutkan urusan keluarga Anda.</p>

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
      Demi keamanan, masuk sekali lagi sebelum membuka brankas (Data Diri dan dokumen) di perangkat ini.
      Setelah itu Anda kembali ke halaman tadi.
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
        class="flex min-h-14 w-full items-center justify-center gap-3 rounded-full border border-line-2 bg-surface text-[1.0625rem] font-semibold text-ink hover:bg-card"
        ><img src="/pen/google-g.svg" alt="" width="20" height="20" />Lanjutkan dengan Google</button
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
        ulangTurnstile();
        sibuk = false;
      };
    }}
  >
    <input type="hidden" name="next" value={next} />
    <!-- Widget Turnstile (hanya bila dikonfigurasi) mengisi cf-turnstile-response; field ini untuk uji. -->
    <input type="hidden" name="turnstile" value="" />
    {#if data.turnstileSiteKey}<div use:turnstile={data.turnstileSiteKey}></div>{/if}
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
          defaultValue={form?.email ?? data.ulang?.email ?? ''}
          class="h-14 w-full rounded-[14px] border border-line-2 bg-surface pr-4 pl-12 text-[1.125rem] text-ink"
        />
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3">
        <label for="sandi" class="text-[0.9375rem] font-semibold whitespace-nowrap text-ink">Kata sandi</label
        >
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
    <a href={resolve('/')} class="inline-flex min-h-12 items-center font-semibold text-ink underline"
      >Coba tanpa daftar</a
    >
  </div>

  {#if data.juri}
    <section class="mt-4 rounded-2xl border border-line bg-card p-4.5 sm:p-5">
      <div class="flex items-center gap-2">
        <span class="inline-flex size-2 rounded-full bg-hijau" aria-hidden="true"></span>
        <h2 class="text-[0.9375rem] font-semibold text-ink">Mode Evaluasi &amp; Juri</h2>
      </div>
      <p class="mt-1.5 text-[0.875rem] leading-relaxed text-body">
        Eksplorasi seluruh alur Urusin secara instan dengan salinan demo dan data contoh siap pakai tanpa
        perlu mendaftar. Sesi ini terisolasi, aman, dan terhapus otomatis dalam 24 jam tanpa dikirim ke
        instansi resmi.
      </p>
      <form
        method="POST"
        action="?/juri"
        data-juri
        use:enhance={() => {
          sibuk = true;
          return async ({ update }) => {
            sibuk = false;
            await update();
          };
        }}
        class="mt-3.5"
      >
        <input type="hidden" name="turnstile" value="" />
        {#if data.turnstileSiteKey}<div class="mb-3" use:turnstile={data.turnstileSiteKey}></div>{/if}
        <button
          type="submit"
          disabled={sibuk}
          class="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line-2 bg-surface font-semibold text-ink transition-all duration-150 hover:bg-bg-2 hover:shadow-xs active:scale-[0.99] disabled:opacity-60"
        >
          <Icon name="perisai-centang" class="size-5 text-hijau" /> Masuk sebagai juri
        </button>
      </form>
    </section>
  {/if}
</KerangkaAuth>
