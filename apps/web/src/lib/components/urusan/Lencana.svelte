<script lang="ts">
  import Icon from '../Icon.svelte';
  import { KELAS_WARNA, type Peristiwa } from '#lib/peristiwa.js';

  /**
   * Badge/<Peristiwa> (App 02–10): pil 6/12, jarak 6, ikon 16 + label 15/400 -0.3, warna pendamping.
   * Urusan lain memakai ikon kartu identitas seperti "KTP & dokumen" di App 10.
   */
  let { peristiwa }: { peristiwa: Pick<Peristiwa, 'warna' | 'icon' | 'lencana'> } = $props();
</script>

<span
  class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[15px] leading-[18px] tracking-[-0.3px] whitespace-nowrap {KELAS_WARNA[
    peristiwa.warna
  ]}"
>
  <Icon name={peristiwa.icon === 'lainnya' ? 'ktp' : peristiwa.icon} class="size-4 shrink-0" />
  {peristiwa.lencana}
</span>
