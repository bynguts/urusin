<!-- DEV-ONLY: kerangka tanpa gaya agar alur akun bisa diuji e2e. Rafi menggantinya dengan layar App 18 (Lupa kata sandi). -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();
</script>

<svelte:head><title>Lupa kata sandi · Urusin</title></svelte:head>

<main>
  <h1>Lupa kata sandi</h1>
  {#if form && 'terkirim' in form}
    <p role="status">
      Bila {form.email} terdaftar, kami sudah mengirim tautan untuk membuat kata sandi baru. Tautan berlaku 30 menit.
    </p>
  {:else}
    {#if form && 'kode' in form}
      <p role="alert" data-kode={form.kode}>{form.pesanWarga}</p>
    {/if}
    <form method="POST">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
      <button type="submit">Kirim tautan</button>
    </form>
  {/if}
  <p><a href={resolve('/masuk')}>Kembali ke Masuk</a></p>
</main>
