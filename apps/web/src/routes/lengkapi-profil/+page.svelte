<!-- DEV-ONLY: kerangka tanpa gaya agar alur akun bisa diuji e2e. Rafi menggantinya dengan layar App 20 (Lengkapi profil). -->
<script lang="ts">
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Lengkapi profil · Urusin</title></svelte:head>

<main>
  <h1>Lengkapi profil</h1>
  {#if form}
    <p role="alert" data-kode={form.kode}>{form.pesanWarga}</p>
  {/if}
  <form method="POST">
    <input type="hidden" name="next" value={data.next} />
    <label for="namaLengkap">Nama lengkap (sesuai KTP)</label>
    <input id="namaLengkap" name="namaLengkap" autocomplete="name" required value={data.namaLengkap} />
    <label for="hp">Nomor HP (boleh dikosongkan)</label>
    <input id="hp" name="hp" type="tel" inputmode="numeric" autocomplete="tel" />
    <button type="submit">Simpan</button>
  </form>
</main>
