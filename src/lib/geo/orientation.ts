/**
 * Device compass heading — which way the phone is FACING, as opposed to the
 * GPS `heading` (direction of travel, only present while moving). Drives the
 * walker locator's cone while standing still and the device-relative bearing
 * arrow in the stop footer.
 *
 * Platform split (see w3c/deviceorientation#137):
 * - iOS Safari: `DeviceOrientationEvent.requestPermission()` must be called
 *   from a user gesture; afterwards `deviceorientation` events carry the 1D
 *   `webkitCompassHeading` (degrees clockwise from north).
 * - Android/Chromium: `deviceorientationabsolute` fires unprompted; heading
 *   is derived from `alpha` (`(360 - alpha) % 360`) when `absolute` is true.
 *
 * The store is subscriber-scoped like `geolocation`: listeners attach on
 * first subscribe, detach on last unsubscribe. Listeners registered before
 * an iOS grant simply never fire — so the store can always listen and the
 * permission flow stays separate. A successful grant is remembered in
 * localStorage (`fw-compass`) so later sessions can re-request silently
 * (a previously granted origin resolves without showing a prompt).
 */
import { readable, writable, type Readable } from 'svelte/store'

const STORAGE_KEY = 'fw-compass'

type OrientationEventLike = DeviceOrientationEvent & { webkitCompassHeading?: number }
type OrientationCtorLike = {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/** True on platforms (iOS Safari) where the compass needs a permission tap. */
export function compassNeedsPermission(): boolean {
  return (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof (DeviceOrientationEvent as unknown as OrientationCtorLike).requestPermission ===
      'function'
  )
}

/** Whether a previous session already granted compass access. */
export function hasStoredCompassGrant(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** True once permission is granted this session (or none was ever needed). */
export const compassGranted = writable<boolean>(false)

/**
 * Ask for compass access. On iOS this MUST be called from a user gesture the
 * first time; once the origin is granted it resolves silently, which is why
 * MapPanel retries it on mount when `hasStoredCompassGrant()`.
 */
export async function requestCompassPermission(): Promise<boolean> {
  if (!compassNeedsPermission()) {
    compassGranted.set(true)
    return true
  }
  try {
    const request = (DeviceOrientationEvent as unknown as OrientationCtorLike)
      .requestPermission!
    const granted = (await request()) === 'granted'
    if (granted) {
      compassGranted.set(true)
      try {
        localStorage.setItem(STORAGE_KEY, '1')
      } catch {
        /* private browsing — session-only grant */
      }
    }
    return granted
  } catch {
    // Called without a user gesture (or denied) — the enable button stays
    return false
  }
}

/**
 * Current UI rotation in degrees (0/90/180/270). The orientation sensors
 * report in the DEVICE frame — the heading of the physical portrait-top
 * edge — so a phone held in landscape reads ±90° off unless corrected by
 * the screen rotation. Verified on iPhone: portrait was right, landscape
 * was ±90° with the sign following the rotation direction. Do not
 * "simplify" this away.
 */
function screenAngle(): number {
  if (typeof screen !== 'undefined' && screen.orientation) {
    return screen.orientation.angle
  }
  // Legacy iOS Safari (< 16.4): window.orientation is 0 / 90 / -90 / 180
  if (typeof window !== 'undefined') {
    const legacy = (window as unknown as { orientation?: unknown }).orientation
    if (typeof legacy === 'number') return ((legacy % 360) + 360) % 360
  }
  return 0
}

/**
 * Compass heading in degrees clockwise from north, or null while unknown.
 * Screen-rotation compensated (see screenAngle). Updates are thresholded to
 * whole-degree changes — deviceorientation can fire at 60Hz and the
 * consumers rotate DOM elements.
 */
export const compassHeading: Readable<number | null> = readable<number | null>(
  null,
  (set) => {
    if (typeof window === 'undefined') return

    let last: number | null = null
    const update = (deg: number) => {
      const rounded = ((Math.round(deg) % 360) + 360) % 360
      if (rounded !== last) {
        last = rounded
        set(rounded)
      }
    }

    // iOS: webkitCompassHeading on the plain event (post-permission)
    const onOrientation = (e: Event) => {
      const webkit = (e as OrientationEventLike).webkitCompassHeading
      if (typeof webkit === 'number' && Number.isFinite(webkit)) {
        update((webkit + screenAngle()) % 360)
      }
    }
    // Android/Chromium: absolute alpha, no permission needed
    const onAbsolute = (e: Event) => {
      const ev = e as DeviceOrientationEvent
      if (ev.absolute && typeof ev.alpha === 'number' && Number.isFinite(ev.alpha)) {
        update((360 - ev.alpha + screenAngle()) % 360)
      }
    }

    window.addEventListener('deviceorientation', onOrientation)
    window.addEventListener('deviceorientationabsolute', onAbsolute)
    return () => {
      window.removeEventListener('deviceorientation', onOrientation)
      window.removeEventListener('deviceorientationabsolute', onAbsolute)
      last = null
      set(null)
    }
  }
)
