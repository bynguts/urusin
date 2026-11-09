<script lang="ts">
  import Icon from '../Icon.svelte';
  import type { NamaIkon } from '../ikon.js';
  import type { KeadaanLayar } from '#lib/pendamping/sesi.svelte.js';

  /**
   * Chip mode Browser Pendamping (u5rYk "Chip mode", ukuran penuh App 06/07): nila = AI sedang mengisi,
   * kunyit = Giliran Anda, netral = antre/menyiapkan/dijeda/terputus/berakhir. Selalu ikon + teks.
   */
  let { keadaan }: { keadaan: KeadaanLayar } = $props();

  const CHIP: Record<KeadaanLayar, { teks: string; ikon: NamaIkon; nada: string } | undefined> = {
    ai: { teks: 'AI sedang mengisi', ikon: 'ai', nada: 'bg-nila text-nila-ink' },
    giliran: { teks: 'Giliran Anda', ikon: 'tangan', nada: 'bg-kuning text-kuning-ink' },
    antre: { teks: 'Antre', ikon: 'antre', nada: 'bg-bg-2 text-muted' },
    menyiapkan: { teks: 'Menyiapkan', ikon: 'memuat', nada: 'bg-bg-2 text-muted' },
    mati: { teks: 'Menyiapkan', ikon: 'memuat', nada: 'bg-bg-2 text-muted' },
    dijeda: { teks: 'Dijeda', ikon: 'jeda', nada: 'bg-bg-2 text-muted' },
    selesai: { teks: 'Selesai', ikon: 'centang-bulat', nada: 'bg-hijau text-hijau-ink' },
    kedaluwarsa: { teks: 'Sesi berakhir', ikon: 'waktu-habis', nada: 'bg-bg-2 text-muted' },
    terputus: { teks: 'Terputus', ikon: 'terputus', nada: 'bg-bg-2 text-muted' },
    dipandu: { teks: 'Mode dipandu', ikon: 'peta', nada: 'bg-merah text-galat' },
    tidak_tersedia: { teks: 'Mode dipandu', ikon: 'peta', nada: 'bg-merah text-galat' },
    galat: { teks: 'Berhenti', ikon: 'peringatan', nada: 'bg-merah text-galat' },
  };
  const c = $derived(CHIP[keadaan]);
</script>

{#if c}
  <span
    class="inline-flex shrink-0 items-center gap-[7px] rounded-full py-1.5 pr-3 pl-2.5 text-sm font-semibold whitespace-nowrap {c.nada}"
  >
    <Icon name={c.ikon} class="size-[15px] shrink-0" />{c.teks}
  </span>
{/if}
