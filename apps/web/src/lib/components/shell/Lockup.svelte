<script lang="ts">
  import lockup from '#lib/assets/img/lockup.webp';
  import lockupGelap from '#lib/assets/img/lockup-gelap.webp';

  /** Brand/Lockup: mark piksel + wordmark (aset Rafi, frame Ergbs). Versi gelap ikut tema. */
  let { class: kelas = 'h-8 w-auto' }: { class?: string } = $props();
</script>

<img src={lockup} alt="Urusin" width="183" height="61" class="lockup-terang {kelas}" />
<img src={lockupGelap} alt="Urusin" width="183" height="61" class="lockup-gelap {kelas}" />

<style>
  .lockup-gelap {
    display: none;
  }
  :global([data-theme='dark']) .lockup-gelap {
    display: inline-block;
  }
  :global([data-theme='dark']) .lockup-terang {
    display: none;
  }
</style>
