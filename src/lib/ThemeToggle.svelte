<!--
  Theme toggle — cycles Light → Dark → Night.
  Shows a sun (light), moon (dark), or rayed sun (night) icon.
  Composited with the fieldWorks henge mark underneath.
-->
<script lang="ts">
  import { theme, type Theme } from './theme/store'
  import HengeLogo from './HengeLogo.svelte'

  const LABEL: Record<Theme, string> = {
    light: 'Switch to dark mode',
    dark:  'Switch to night mode',
    night: 'Switch to light mode',
  }
</script>

<button
  class="toggle"
  aria-label={LABEL[$theme]}
  title={LABEL[$theme]}
  onclick={() => theme.cycle()}
>
  <span class="icon-wrap" aria-hidden="true">
    {#if $theme === 'light'}
      <!-- Moon icon (currently light → next is dark) -->
      <svg class="celestial" viewBox="0 0 46 46" width="46" height="46">
        <g transform="rotate(-42 32.5 13.5)">
          <circle cx="32.5" cy="13.5" r="6"   fill="currentColor" opacity="0.3"/>
          <circle cx="29.2" cy="13.5" r="5.4" fill="var(--surface-2)"/>
        </g>
        <foreignObject x="9" y="15" width="28" height="27">
          <HengeLogo size={28} />
        </foreignObject>
      </svg>
    {:else if $theme === 'dark'}
      <!-- Sun with rays (currently dark → next is night) -->
      <svg class="celestial" viewBox="0 0 46 46" width="46" height="46">
        <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <line x1="32.5" y1="3.4"  x2="32.5" y2="6.4"/>
          <line x1="39.6" y1="6.4"  x2="37.8" y2="8.2"/>
          <line x1="42.6" y1="13.5" x2="39.8" y2="13.5"/>
          <line x1="25.4" y1="6.4"  x2="27.2" y2="8.2"/>
        </g>
        <circle cx="32.5" cy="13.5" r="5.1" fill="currentColor" opacity="0.7"/>
        <foreignObject x="9" y="15" width="28" height="27">
          <HengeLogo size={28} />
        </foreignObject>
      </svg>
    {:else}
      <!-- Rayed sun (currently night → next is light) -->
      <svg class="celestial" viewBox="0 0 46 46" width="46" height="46">
        <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <line x1="32.5" y1="3.4"  x2="32.5" y2="6.4"/>
          <line x1="39.6" y1="6.4"  x2="37.8" y2="8.2"/>
          <line x1="42.6" y1="13.5" x2="39.8" y2="13.5"/>
          <line x1="25.4" y1="6.4"  x2="27.2" y2="8.2"/>
          <line x1="32.5" y1="23.6" x2="32.5" y2="20.6"/>
          <line x1="25.4" y1="20.6" x2="27.2" y2="18.8"/>
          <line x1="22.4" y1="13.5" x2="25.2" y2="13.5"/>
        </g>
        <circle cx="32.5" cy="13.5" r="5.1" fill="currentColor"/>
        <foreignObject x="9" y="15" width="28" height="27">
          <HengeLogo size={28} />
        </foreignObject>
      </svg>
    {/if}
  </span>
</button>

<style>
  .toggle {
    width: 46px;
    height: 46px;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    overflow: hidden;
    color: var(--accent);
    flex: none;
    transition: background 0.2s;
  }

  .toggle:hover {
    background: var(--surface);
  }

  .icon-wrap {
    display: block;
    line-height: 0;
  }

  .celestial {
    display: block;
  }
</style>
