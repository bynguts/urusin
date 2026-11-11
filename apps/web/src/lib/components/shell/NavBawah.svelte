<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Icon from '../Icon.svelte';
  import { NAV_HP, menuAktif } from './navigasi.js';

  /** Navigasi bawah HP (< 1024 px, frame IzXAR): empat menu, target 48 px+. */
</script>

<nav
  aria-label="Navigasi utama"
  class="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg-2 pb-[env(safe-area-inset-bottom)] lg:hidden"
>
  <ul class="mx-auto grid max-w-xl grid-cols-4">
    {#each NAV_HP as item (item.href)}
      {@const kini = menuAktif(item.href, page.url.pathname)}
      <li>
        <a
          href={resolve(item.href)}
          aria-current={kini ? 'page' : undefined}
          class="flex min-h-[5.125rem] min-w-0 flex-col items-center justify-center gap-1.5 px-1 text-[clamp(14px,0.875rem,16px)] text-muted transition-all duration-150 active:scale-95 aria-[current=page]:font-semibold aria-[current=page]:text-ink"
        >
          <Icon name={item.ikon} class="size-5" />
          <span class="max-w-full text-center leading-tight">{item.label}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>
