<!-- DEV-ONLY: kerangka tanpa gaya agar alur akun bisa diuji e2e. Rafi menggantinya dengan layar App 17 (Verifikasi email). -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Pastikan email · Urusin</title></svelte:head>

<main>
  <h1>Pastikan email</h1>
  {#if form && 'terverifikasi' in form}
    <p role="status">Email sudah dipastikan. Silakan masuk.</p>
    <p><a href={resolve('/masuk')}>Masuk</a></p>
  {:else if form && 'terkirim' in form}
    <p role="status">Bila email {form.email} terdaftar dan belum dipastikan, tautan baru sudah kami kirim.</p>
  {:else}
    {#if form && 'kode' in form}
      <p role="alert" data-kode={form.kode}>{form.pesanWarga}</p>
    {/if}
    {#if data.tokenBerlaku}
      <form method="POST" action="?/pastikan">
        <input type="hidden" name="token" value={data.token} />
        <button type="submit">Pastikan email saya</button>
      </form>
    {:else}
      {#if data.token}
        <p role="alert" data-kode="TOKEN_TIDAK_VALID">
          Tautan sudah tidak berlaku atau sudah dipakai. Minta tautan baru.
        </p>
      {/if}
      <form method="POST" action="?/kirimUlang">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <button type="submit">Kirim ulang tautan</button>
      </form>
    {/if}
  {/if}
</main>
