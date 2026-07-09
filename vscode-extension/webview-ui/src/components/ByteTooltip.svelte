<script lang="ts">
  interface Props {
    id: string
    title: string
    alignRight?: boolean
    below?: boolean
    showAccent?: boolean
  }

  let {
    id,
    title,
    alignRight = false,
    below = false,
    showAccent = false,
  }: Props = $props()

  const lines = $derived(title.split('\n'))
</script>

<span
  id={id}
  class="byte-tooltip"
  class:alignRight
  class:below
  class:showAccent
  role="tooltip"
>
  {#each lines as line}
    <span>{line}</span>
  {/each}
</span>
