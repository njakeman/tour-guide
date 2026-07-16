/**
 * Arrival feedback: a short two-tone chime (WebAudio — no asset, works
 * offline) and a vibration pattern where the platform supports it (Android;
 * iOS Safari has no Vibration API).
 *
 * Autoplay policy: an AudioContext only runs after the page has had a user
 * gesture. By the time anyone is walking a tour they have tapped plenty, but
 * if the context is still suspended we try to resume and otherwise stay
 * silent — the banner is the guaranteed signal, sound is enhancement.
 */

let ctx: AudioContext | null = null

function tone(context: AudioContext, freq: number, at: number, duration: number): void {
  const osc = context.createOscillator()
  const gain = context.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(0.22, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration)
  osc.connect(gain).connect(context.destination)
  osc.start(at)
  osc.stop(at + duration + 0.05)
}

export function playArrivalChime(): void {
  try {
    const AC =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext)
        : undefined
    if (!AC) return
    ctx ??= new AC()
    const play = () => {
      if (!ctx || ctx.state !== 'running') return
      const now = ctx.currentTime
      tone(ctx, 880, now, 0.2) // A5
      tone(ctx, 1318.5, now + 0.16, 0.3) // E6
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().then(play).catch(() => {})
    } else {
      play()
    }
  } catch {
    // No audio — the banner still shows
  }
}

export function vibrateArrival(): void {
  try {
    navigator.vibrate?.([100, 60, 100])
  } catch {
    // Not supported — fine
  }
}
