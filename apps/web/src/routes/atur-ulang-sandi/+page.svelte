<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import Icon from '#lib/components/Icon.svelte';
  import InputSandi from '#lib/components/auth/InputSandi.svelte';
  import KerangkaAuth from '#lib/components/auth/KerangkaAuth.svelte';
  import { dataAuth, formAuth, galatAuth } from '#lib/components/auth/form.js';

  /** App 19 Atur ulang kata sandi. Token dari tautan email; terpakai saat sandi baru dikirim. */
  const data = $derived(dataAuth<{ token: string; tokenBerlaku: boolean }>());
  const form = $derived(formAuth());
  const galat = $derived(galatAuth());
  let sibuk = $state(false);
</script>

<svelte:head><title>Atur ulang kata sandi · Urusin</title></svelte:head>

<KerangkaAuth
  judul="Buat kata sandi baru"
  sub="Setelah tersimpan, semua perangkat dikeluarkan supaya akun Anda aman."
>
  <span class="grid size-14 place-items-center rounded-2xl bg-bg-2"
    ><Icon name="gembok" class="size-6" /></span
  >
  {#if form?.berhasil}
    <h1 class="mt-5 text-[2rem] leading-[37px] font-semibold tracking-[-0.9px] text-ink">
      Kata sandi diganti
    </h1>
    <p role="status" class="mt-3 text-[1.0625rem] leading-[25px] text-body">
      Kata sandi baru tersimpan. Semua perangkat sudah dikeluarkan. Silakan masuk lagi.
    </p>
    <a
      href={resolve('/masuk')}
      class="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primer font-semibold text-primer-ink hover:opacity-90"
      >Masuk <Icon name="panah" class="size-4.5" /></a
    >
  {:else if data.tokenBerlaku}
    <h1 class="mt-5 text-[2rem] leading-[37px] font-semibold tracking-[-0.9px] text-ink">Kata sandi baru</h1>
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
      <input type="hidden" name="token" value={data.token} />
      <div class="flex flex-col gap-2">
        <label for="sandi" class="text-[0.9375rem] font-semibold text-ink">Kata sandi baru</label>
        <InputSandi
          id="sandi"
          autocomplete="new-password"
          describedby="sandi-petunjuk"
          invalid={!!galat?.kode.startsWith('SANDI_')}
        />
        <p id="sandi-petunjuk" class="text-sm text-muted">
          Minimal 10 karakter dan bukan sandi yang umum dipakai.
        </p>
      </div>
      <button
        type="submit"
        disabled={sibuk}
        class="flex min-h-14 w-full items-center justify-center rounded-full bg-primer font-semibold text-primer-ink hover:opacity-90 disabled:opacity-60"
        >Simpan kata sandi</button
      >
    </form>
  {:else}
    <h1 class="mt-5 text-[2rem] leading-[37px] font-semibold tracking-[-0.9px] text-ink">
      Tautan sudah tidak berlaku
    </h1>
    <p
      role="alert"
      data-kode="TOKEN_TIDAK_VALID"
      class="mt-4 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] text-galat"
    >
      Tautan sudah tidak berlaku atau sudah dipakai. Tautan hanya berlaku 30 menit dan sekali pakai.
    </p>
    <a
      href={resolve('/lupa-sandi')}
      class="mt-6 flex min-h-14 w-full items-center justify-center rounded-full bg-primer font-semibold text-primer-ink hover:opacity-90"
      >Minta tautan baru</a
    >
  {/if}
</KerangkaAuth>
