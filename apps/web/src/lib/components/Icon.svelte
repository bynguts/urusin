<script lang="ts">
  // Ikon SVG inline (tanpa pustaka ikon runtime). Garis 24×24, warna mengikuti currentColor.
  type Name =
    | 'kelahiran'
    | 'kematian'
    | 'perkawinan'
    | 'pindah'
    | 'lainnya'
    | 'beranda'
    | 'urusan'
    | 'bantuan'
    | 'panah';

  let { name, class: className = 'size-6' }: { name: Name; class?: string } = $props();

  const PATHS: Record<Name, string[]> = {
    kelahiran: [
      'M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
      'M7 21v-4a5 5 0 0 1 10 0v4',
      'M9.5 14.5c.8.7 1.6 1 2.5 1s1.7-.3 2.5-1',
    ],
    kematian: [
      'M12 3c2.5 2.2 3.5 4.3 3.5 6.2A3.5 3.5 0 0 1 12 12.7a3.5 3.5 0 0 1-3.5-3.5C8.5 7.3 9.5 5.2 12 3Z',
      'M12 12.7V21',
      'M8 21h8',
    ],
    perkawinan: ['M9 9a5 5 0 1 0 0 10A5 5 0 0 0 9 9Z', 'M15 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z'],
    pindah: [
      'M3 7h11v9H3z',
      'M14 10h4l3 3v3h-7',
      'M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
      'M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    ],
    lainnya: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M16.5 13v7', 'M13 16.5h7'],
    beranda: ['M4 11 12 4l8 7', 'M6 9.5V20h12V9.5', 'M10 20v-5h4v5'],
    urusan: ['M8 4h8v3H8z', 'M6 5.5H5v15h14v-15h-1', 'M8.5 12l2 2 4-4', 'M8.5 17h7'],
    bantuan: [
      'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
      'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6',
      'M12 17h.01',
    ],
    panah: ['M9 6l6 6-6 6'],
  };
</script>

<svg
  class={className}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each PATHS[name] as d (d)}
    <path {d} />
  {/each}
</svg>
