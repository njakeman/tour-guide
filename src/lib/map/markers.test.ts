import { describe, it, expect } from 'vitest'
import {
  createStopMarkerElement,
  createStopPopupElement,
  createWalkerLocatorElement,
  setWalkerHeading,
  formatDistanceAway,
  formatPopupEyebrow,
  updateStopPopupDistance,
} from './markers'

describe('stop marker element', () => {
  it('builds an accessible button with the numbered chalk disc', () => {
    const el = createStopMarkerElement('3', 'The Flint Mines')
    expect(el.tagName).toBe('BUTTON')
    expect(el.type).toBe('button')
    expect(el.className).toBe('stop-marker')
    expect(el.getAttribute('aria-label')).toBe('Stop 3: The Flint Mines')
    // Pin art + HTML number overlay
    expect(el.querySelector('svg[viewBox="0 0 40 49"]')).toBeTruthy()
    expect(el.querySelectorAll('.sm-body')).toHaveLength(2)
    expect(el.querySelector('.stop-marker__num')?.textContent).toBe('3')
  })

  it('escapes hostile titles via textContent, not markup', () => {
    const el = createStopMarkerElement('1', '<img src=x onerror=alert(1)>')
    expect(el.querySelector('img')).toBeNull()
  })
})

describe('walker locator element', () => {
  it('starts with the heading cone hidden', () => {
    const el = createWalkerLocatorElement()
    expect(el.getAttribute('aria-label')).toBe('Your location')
    expect(el.dataset.heading).toBe('none')
    expect(el.querySelector('.wl-cone')).toBeTruthy()
    expect(el.querySelector('.wl-dot')).toBeTruthy()
  })

  it('rotates the cone group to the bearing and back to hidden on null', () => {
    const el = createWalkerLocatorElement()
    setWalkerHeading(el, 135)
    expect(el.dataset.heading).toBe('135')
    expect(el.querySelector('.wl-heading')?.getAttribute('transform')).toBe('rotate(135 44 44)')

    setWalkerHeading(el, null)
    expect(el.dataset.heading).toBe('none')

    setWalkerHeading(el, NaN)
    expect(el.dataset.heading).toBe('none')
  })
})

describe('popup eyebrow formatting', () => {
  it('formats metres under 1 km and kilometres above', () => {
    expect(formatDistanceAway(320)).toBe('320m away')
    expect(formatDistanceAway(999.4)).toBe('999m away')
    expect(formatDistanceAway(1234)).toBe('1.2 km away')
  })

  it('falls back to just the stop number without a fix', () => {
    expect(formatPopupEyebrow('3', 320)).toBe('Stop 3 · 320m away')
    expect(formatPopupEyebrow('3', null)).toBe('Stop 3')
    expect(formatPopupEyebrow('3', Infinity)).toBe('Stop 3')
  })
})

describe('stop popup element', () => {
  it('builds the callout with eyebrow, name, chevron, and tail', () => {
    const el = createStopPopupElement({
      label: '3',
      title: 'The Flint Mines',
      distanceMetres: 320,
    })
    expect(el.tagName).toBe('BUTTON')
    expect(el.getAttribute('aria-label')).toBe('Open stop 3: The Flint Mines')
    expect(el.querySelector('.tour-popup__eyebrow')?.textContent).toBe('Stop 3 · 320m away')
    expect(el.querySelector('.tour-popup__name')?.textContent).toBe('The Flint Mines')
    expect(el.querySelector('.tour-popup__chevron')?.textContent).toBe('›')
    expect(el.querySelector('.tour-popup__tail')).toBeTruthy()
  })

  it('updates the distance eyebrow in place as the walker moves', () => {
    const el = createStopPopupElement({ label: '2', title: 'The Ring Bank', distanceMetres: null })
    expect(el.querySelector('.tour-popup__eyebrow')?.textContent).toBe('Stop 2')

    updateStopPopupDistance(el, '2', 1490)
    expect(el.querySelector('.tour-popup__eyebrow')?.textContent).toBe('Stop 2 · 1.5 km away')
  })
})
