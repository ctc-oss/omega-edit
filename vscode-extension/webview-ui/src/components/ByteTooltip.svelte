<script lang="ts">
  interface Props {
    title: string
    alignRight?: boolean
    below?: boolean
    showAccent?: boolean
  }

  let {
    title,
    alignRight = false,
    below = false,
    showAccent = false,
  }: Props = $props()

  const lines = $derived(title.split('\n'))
</script>

<span
  class="byte-tooltip"
  class:alignRight
  class:below
  class:showAccent
  aria-hidden="true"
>
  {#each lines as line}
    <span>{line}</span>
  {/each}
</span>
