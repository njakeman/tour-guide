/**
 * DOM builders for the MapLibre map markers (design handoff: "Map Markers").
 *
 * Three pieces, all plain-DOM so MapLibre HTML Markers can own them and so
 * they are testable under jsdom without a map:
 *
 * - stop marker  — numbered "chalk disc" pin; the pin TIP is at the bottom
 *   centre of the element, so the MapLibre marker must use anchor: 'bottom'.
 * - walker locator — surveyor's reticle for the live GPS fix (anchor:
 *   'center'); the heading cone rotates to the device bearing and is hidden
 *   when no bearing is available.
 * - stop popup — tap callout with a mono eyebrow (stop number · distance),
 *   the stop name, a chevron, and a pointer tail down to the marker.
 *
 * All colours come from brand tokens (--marker-*, --locator-*, --popup-*)
 * applied in app.css — the SVGs carry classes, never baked-in fills — so the
 * assets follow the light / dark / night themes from the handoff table.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Stop marker: 40×49 pin in a 44px-wide tap target (min tap area per handoff). */
export function createStopMarkerElement(label: string, title: string): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'stop-marker'
  el.setAttribute('aria-label', `Stop ${label}: ${title}`)
  el.innerHTML =
    `<svg viewBox="0 0 40 49" width="40" height="49" aria-hidden="true" focusable="false">` +
    `<path class="sm-body" d="M20,47 L11,30 A16,16 0 1 1 29,30 Z"/>` +
    `<circle class="sm-body" cx="20" cy="18" r="15.5"/>` +
    `<circle class="sm-inner" cx="20" cy="18" r="11.5"/>` +
    `</svg>` +
    // Number overlaid in HTML, centred on the disc (crisper than SVG <text>,
    // and restyles per theme with plain CSS) — per the handoff README.
    `<span class="stop-marker__num" aria-hidden="true"></span>`
  el.querySelector('.stop-marker__num')!.textContent = label
  return el
}

/** Walker locator: 88×88 reticle + heading cone + position dot (anchor centre). */
export function createWalkerLocatorElement(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'walker-locator'
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', 'Your location')
  el.dataset.heading = 'none' // cone hidden until a bearing arrives
  el.innerHTML =
    `<svg viewBox="0 0 88 88" width="88" height="88" aria-hidden="true" focusable="false">` +
    `<circle class="wl-halo" cx="44" cy="44" r="40"/>` +
    `<circle class="wl-halo-ring" cx="44" cy="44" r="40" stroke-dasharray="2 6"/>` +
    `<g class="wl-heading"><path class="wl-cone" d="M44,44 L27,8 A38,38 0 0 1 61,8 Z"/></g>` +
    `<g class="wl-reticle">` +
    `<circle cx="44" cy="44" r="21"/>` +
    `<line x1="44" y1="17" x2="44" y2="27"/>` +
    `<line x1="44" y1="61" x2="44" y2="71"/>` +
    `<line x1="17" y1="44" x2="27" y2="44"/>` +
    `<line x1="61" y1="44" x2="71" y2="44"/>` +
    `</g>` +
    `<text class="wl-n" x="44" y="14" text-anchor="middle">N</text>` +
    `<circle class="wl-dot" cx="44" cy="44" r="8.5"/>` +
    `</svg>`
  return el
}

/**
 * Rotate the locator's heading cone to `bearing` (degrees clockwise from
 * north, map assumed north-up), or hide the cone when bearing is null.
 * The reticle and N label never rotate — only the cone turns.
 *
 * `source` distinguishes the device compass (which way the phone FACES —
 * solid, sharper cone via .walker-locator--compass) from the GPS travel
 * heading (softer cone, only meaningful while moving).
 */
export function setWalkerHeading(
  el: HTMLElement,
  bearing: number | null,
  source: 'compass' | 'travel' = 'travel'
): void {
  const heading = el.querySelector('.wl-heading')
  if (!heading) return
  if (bearing == null || !Number.isFinite(bearing)) {
    el.dataset.heading = 'none'
    el.classList.remove('walker-locator--compass')
    return
  }
  el.dataset.heading = String(Math.round(bearing))
  el.classList.toggle('walker-locator--compass', source === 'compass')
  heading.setAttribute('transform', `rotate(${bearing} 44 44)`)
}

/** "320m away" under 1 km, "1.2 km away" above. */
export function formatDistanceAway(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)}m away`
  return `${(metres / 1000).toFixed(1)} km away`
}

/** "Stop 3 · 320m away", or just "Stop 3" when there is no GPS fix. */
export function formatPopupEyebrow(label: string, distanceMetres: number | null): string {
  if (distanceMetres == null || !Number.isFinite(distanceMetres)) return `Stop ${label}`
  return `Stop ${label} · ${formatDistanceAway(distanceMetres)}`
}

export interface StopPopupOptions {
  label: string
  title: string
  distanceMetres: number | null
}

/**
 * Stop popup: whole card is a button (the chevron implies "opens the stop").
 * Anchor it 'bottom' at the stop's coordinate, offset upward past the marker,
 * so the tail points down at the disc. One popup at a time — the caller
 * closes any open one first.
 */
export function createStopPopupElement(opts: StopPopupOptions): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'tour-popup'
  el.setAttribute('aria-label', `Open stop ${opts.label}: ${opts.title}`)
  // <button> allows only phrasing content — spans styled as blocks, no divs.
  el.innerHTML =
    `<span class="tour-popup__card">` +
    `<span class="tour-popup__text">` +
    `<span class="tour-popup__eyebrow"></span>` +
    `<span class="tour-popup__name"></span>` +
    `</span>` +
    `<span class="tour-popup__chevron" aria-hidden="true">›</span>` +
    `</span>` +
    `<span class="tour-popup__tail" aria-hidden="true"></span>`
  el.querySelector('.tour-popup__eyebrow')!.textContent = formatPopupEyebrow(
    opts.label,
    opts.distanceMetres
  )
  el.querySelector('.tour-popup__name')!.textContent = opts.title
  return el
}

/** Refresh the eyebrow on an existing popup as the walker moves. */
export function updateStopPopupDistance(
  el: HTMLElement,
  label: string,
  distanceMetres: number | null
): void {
  const eyebrow = el.querySelector('.tour-popup__eyebrow')
  if (eyebrow) eyebrow.textContent = formatPopupEyebrow(label, distanceMetres)
}
