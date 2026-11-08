<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import Icon from '#lib/components/Icon.svelte';
  import KerangkaAuth from '#lib/components/auth/KerangkaAuth.svelte';
  import { formAuth, galatAuth } from '#lib/components/auth/form.js';

  /** App 18 Lupa kata sandi. Jawaban sukses sama untuk email terdaftar maupun tidak. */
  const form = $derived(formAuth());
  const galat = $derived(galatAuth());
  let sibuk = $state(false);
</script>

<svelte:head><title>Lupa kata sandi · Urusin</title></svelte:head>

<KerangkaAuth
  judul="Tenang, bisa diatur ulang"
  sub="Kami kirim tautan untuk membuat kata sandi baru ke email Anda."
>
  <span class="grid size-14 place-items-center rounded-2xl bg-bg-2"
    ><Icon name="gembok" class="size-6" /></span
  >
  {#if form?.terkirim}
    <h1 class="mt-5 text-[1.875rem] tracking-[-0.03em] text-ink">Cek email Anda</h1>
    <p role="status" class="mt-3 text-base text-body">
      Bila <span class="font-semibold text-ink">{form.email}</span> terdaftar, kami sudah mengirim tautan untuk
      membuat kata sandi baru. Tautan berlaku 30 menit.
    </p>
    {#if form.tertunda}
      <p
        role="alert"
        data-kode="EMAIL_TERTUNDA"
        class="mt-3 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat"
      >
        Pengiriman email sedang tertunda (layanan email kami sedang penuh atau belum aktif). Coba kirim ulang
        tautan nanti.
      </p>
    {/if}
    <p class="mt-3 text-sm text-muted">Cek juga folder Spam atau Promosi.</p>
  {:else}
    <h1 class="mt-5 text-[1.875rem] tracking-[-0.03em] text-ink">Lupa kata sandi</h1>
    <p class="mt-2 text-base text-body">Tulis email akun Anda.</p>
    {#if galat}
      <p
        role="alert"
        data-kode={galat.kode}
        class="mt-4 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat"
      >
        {galat.pesanWarga}
      </p>
    {/if}
    <form
      method="POST"
      class="mt-5 flex flex-col gap-4"
      use:enhance={() => {
        sibuk = true;
        return async ({ update }) => {
          await update({ reset: false });
          sibuk = false;
        };
      }}
    >
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
            value={form?.email ?? ''}
            class="h-14 w-full rounded-2xl border border-line-2 bg-surface pr-4 pl-12 text-base text-ink"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={sibuk}
        class="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primer font-semibold text-primer-ink hover:opacity-90 disabled:opacity-60"
      >
        Kirim tautan <Icon name="panah" class="size-4.5" />
      </button>
    </form>
  {/if}
  <p class="mt-5 text-[0.9375rem] text-body">
    <a href={resolve('/masuk')} class="inline-flex min-h-12 items-center gap-1.5 font-semibold text-ink"
      ><Icon name="panah-kiri" class="size-4" /> Kembali ke Masuk</a
    >
  </p>
</KerangkaAuth>
