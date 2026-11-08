<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Icon from '../Icon.svelte';
  import { NAV, menuAktif } from './navigasi.js';

  /** Navigasi bawah HP (< 1024 px): menu yang sama dengan sidebar, target 48 px+. */
</script>

<nav
  aria-label="Navigasi utama"
  class="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
>
  <ul class="mx-auto grid max-w-xl grid-cols-5">
    {#each NAV as item (item.href)}
      {@const kini = menuAktif(item.href, page.url.pathname)}
      <li>
        <a
          href={resolve(item.href)}
          aria-current={kini ? 'page' : undefined}
          class="flex min-h-16 flex-col items-center justify-center gap-1 text-[0.75rem] font-medium text-muted aria-[current=page]:text-ink"
        >
          <span
            class="grid h-7 w-12 place-items-center rounded-full transition-colors {kini ? 'bg-bg-2' : ''}"
          >
            <Icon name={item.ikon} class="size-5" />
          </span>
          {item.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>
