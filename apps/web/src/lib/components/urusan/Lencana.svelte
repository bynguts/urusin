<script lang="ts">
  import Chip from '../ui/Chip.svelte';
  import type { Peristiwa } from '#lib/peristiwa.js';

  /** Badge/<Peristiwa>: lencana berwarna pendamping di header urusan dan kartu Urusanku. */
  let { peristiwa }: { peristiwa: Pick<Peristiwa, 'warna' | 'icon' | 'lencana'> } = $props();
</script>

<Chip nada={peristiwa.warna} ikon={peristiwa.icon} besar>{peristiwa.lencana}</Chip>
