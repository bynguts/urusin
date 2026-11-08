<script lang="ts">
  import Chip from '../ui/Chip.svelte';
  import type { KeadaanLayar } from '#lib/pendamping/sesi.svelte.js';

  /** Satu chip mode per layar (Chip/Mode): AI sedang mengisi (nila), Giliran Anda (kunyit), netral. Ikon + teks. */
  let { keadaan }: { keadaan: KeadaanLayar } = $props();
</script>

{#if keadaan === 'ai'}
  <Chip nada="ai" ikon="ai" besar>AI sedang mengisi</Chip>
{:else if keadaan === 'giliran'}
  <Chip nada="anda" ikon="tangan" besar>Giliran Anda</Chip>
{:else if keadaan === 'antre'}
  <Chip nada="netral" ikon="antre" besar>Antre</Chip>
{:else if keadaan === 'menyiapkan'}
  <Chip nada="netral" ikon="memuat" besar>Menyiapkan</Chip>
{:else if keadaan === 'dijeda'}
  <Chip nada="netral" ikon="jeda" besar>Dijeda</Chip>
{:else if keadaan === 'selesai'}
  <Chip nada="hijau" ikon="centang-bulat" besar>Selesai</Chip>
{:else if keadaan === 'kedaluwarsa'}
  <Chip nada="netral" ikon="waktu-habis" besar>Sesi berakhir</Chip>
{:else if keadaan === 'terputus'}
  <Chip nada="netral" ikon="terputus" besar>Terputus</Chip>
{:else if keadaan === 'dipandu' || keadaan === 'tidak_tersedia'}
  <Chip nada="galat" ikon="peta" besar>Mode dipandu</Chip>
{:else if keadaan === 'galat'}
  <Chip nada="galat" ikon="peringatan" besar>Berhenti</Chip>
{/if}
