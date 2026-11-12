<script lang="ts">
  import type { Snippet } from 'svelte';
  import './landing-dasar.css';
  import './landing-pen.css';
  import './landing-responsif.css';
  import LandingNav from './LandingNav.svelte';
  import LandingFooter from './LandingFooter.svelte';
  let {
    judul,
    ringkasan,
    aktif,
    children,
  }: {
    judul: string;
    ringkasan: string;
    aktif: 'cara-kerja' | 'tanya-jawab';
    children: Snippet;
  } = $props();
</script>

<svelte:head>
  <title>{aktif === 'cara-kerja' ? 'Cara kerja' : 'Tanya jawab'} · Urusin</title>
  <meta name="description" content={ringkasan} />
</svelte:head>
<main class="lp0 lp" id="konten">
  <LandingNav {aktif} />
  <header class="pengantar">
    <h1>{judul}</h1>
    <p>{ringkasan}</p>
  </header>
  <div class="bacaan">{@render children()}</div>
  <LandingFooter />
</main>

<style>
  .pengantar,
  .bacaan {
    width: 100%;
    max-width: 1120px;
    margin-inline: auto;
    padding-inline: 32px;
  }
  .pengantar {
    padding-block: 72px 40px;
  }
  .pengantar h1 {
    max-width: 18ch;
    font-size: clamp(2rem, 4.5vw, 3.5rem);
    line-height: 1.1;
  }
  .pengantar p {
    max-width: 65ch;
    margin-top: 24px;
    font-size: 1.1875rem;
    line-height: 1.6;
    color: var(--sb-text-body);
  }
  .bacaan {
    padding-bottom: 80px;
  }
  .bacaan :global(section) {
    max-width: 76ch;
    padding-block: 28px;
    border-top: 1px solid var(--sb-stroke);
    scroll-margin-top: 100px;
  }
  .bacaan :global(h2) {
    margin-bottom: 16px;
    font-size: 1.625rem;
    line-height: 1.25;
  }
  .bacaan :global(h3) {
    margin-block: 24px 8px;
    font-size: 1.1875rem;
  }
  .bacaan :global(p),
  .bacaan :global(li) {
    font-size: 1.0625rem;
    line-height: 1.7;
    color: var(--sb-text-body);
  }
  .bacaan :global(p + p) {
    margin-top: 12px;
  }
  .bacaan :global(ol),
  .bacaan :global(ul) {
    padding-left: 24px;
  }
  .bacaan :global(ol) {
    list-style: decimal;
  }
  .bacaan :global(ul) {
    list-style: disc;
  }
  .bacaan :global(li + li) {
    margin-top: 16px;
  }
  .bacaan :global(a) {
    color: var(--sb-text-primary);
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .bacaan :global(summary) {
    cursor: pointer;
    padding-block: 16px;
    font-size: 1.125rem;
    font-weight: 600;
  }
  .bacaan :global(details + details) {
    border-top: 1px solid var(--sb-stroke);
  }
  .bacaan :global(details p) {
    padding-bottom: 20px;
  }
  .bacaan :global(.coming-soon) {
    display: inline-flex;
    margin-bottom: 16px;
    border-radius: 100px;
    padding: 6px 14px;
    background: var(--sb-bg-secondary);
    font-size: 0.875rem;
    font-weight: 600;
  }
  @media (max-width: 639px) {
    .pengantar,
    .bacaan {
      padding-inline: 20px;
    }
    .pengantar {
      padding-top: 40px;
    }
  }
</style>
