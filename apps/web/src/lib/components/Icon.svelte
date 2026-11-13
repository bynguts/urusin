<script lang="ts">
  import { IKON, type NamaIkon } from './ikon.js';

  /** Ikon garis 24×24 (warna currentColor). Tanpa `label` dianggap dekoratif dan disembunyikan dari pembaca layar. */
  let {
    name,
    class: className = 'size-5',
    label,
  }: { name: NamaIkon; class?: string; label?: string | undefined } = $props();
</script>

<svg
  class={className}
  data-ikon={name}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={label ? undefined : 'true'}
  role={label ? 'img' : undefined}
  aria-label={label}
  focusable="false"
>
  {#each IKON[name] as d (d)}
    <path {d} />
  {/each}
</svg>
