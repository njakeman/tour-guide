import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import TourStopView from './TourStop.svelte'
import type { TourRoute, TourStop } from './types'

function makeStop(id: string, title: string, overrides: Partial<TourStop> = {}): TourStop {
  return {
    id,
    title,
    lat: 50.8561,
    lng: -0.379,
    proximity_radius: 30,
    evidence: 'Some evidence.',
    interpretation: 'Some interpretation.',
    bodyHtml: '<p>Body text.</p>',
    media: [],
    ...overrides,
  }
}

function makeRoute(): TourRoute {
  return {
    id: 'test-route',
    name: 'Test Route',
    description: 'desc',
    icon: '🗺️',
    stops: [
      makeStop('stop-a', 'First Stop'),
      makeStop('stop-b', 'Middle Stop'),
      makeStop('stop-c', 'Last Stop'),
    ],
  }
}

function baseProps(stopIndex = 0) {
  const route = makeRoute()
  return {
    stop: route.stops[stopIndex],
    stopIndex,
    route,
    visitedStopIds: new Set<string>(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onBack: vi.fn(),
    onGoToStop: vi.fn(),
  }
}

describe('TourStop — proximity footer', () => {
  it('shows the manual-navigation message when GPS is unavailable', () => {
    render(TourStopView, { props: baseProps() })
    expect(screen.getByText(/GPS unavailable/)).toBeTruthy()
  })

  it('shows the live distance when a fresh fix is available', () => {
    render(TourStopView, {
      props: {
        ...baseProps(),
        distanceMetres: 120,
        accuracy: 10,
        fixTimestamp: Date.now(),
      },
    })
    expect(screen.getByText('120m')).toBeTruthy()
    expect(screen.queryByText(/arriving/)).toBeNull()
  })

  it('shows the arriving state inside the proximity radius', () => {
    render(TourStopView, {
      props: {
        ...baseProps(),
        distanceMetres: 20,
        accuracy: 10,
        fixTimestamp: Date.now(),
      },
    })
    expect(screen.getByText(/arriving/)).toBeTruthy()
  })

  it('does not claim arrival when GPS accuracy is too poor', () => {
    render(TourStopView, {
      props: {
        ...baseProps(),
        distanceMetres: 20,
        accuracy: 100, // worse than 2× the 30 m radius
        fixTimestamp: Date.now(),
      },
    })
    expect(screen.queryByText(/arriving/)).toBeNull()
  })

  it('marks the distance as stale when the fix is old', () => {
    render(TourStopView, {
      props: {
        ...baseProps(),
        distanceMetres: 20,
        accuracy: 10,
        fixTimestamp: Date.now() - 5 * 60_000,
      },
    })
    expect(screen.getByText(/last GPS fix/)).toBeTruthy()
    expect(screen.queryByText(/arriving/)).toBeNull()
  })
})

describe('TourStop — navigation', () => {
  it('disables prev on the first stop', () => {
    render(TourStopView, { props: baseProps(0) })
    const prev = screen.getByLabelText('Previous stop') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
  })

  it('disables next and shows the final-stop label on the last stop', () => {
    render(TourStopView, { props: baseProps(2) })
    const next = screen.getByLabelText('Next stop') as HTMLButtonElement
    expect(next.disabled).toBe(true)
    expect(next.textContent).toContain('Final stop')
  })

  it('names the next stop on the next button', () => {
    render(TourStopView, { props: baseProps(0) })
    const next = screen.getByLabelText('Next stop') as HTMLButtonElement
    expect(next.textContent).toContain('Middle Stop')
  })
})

describe('TourStop — responsive one-DOM layout', () => {
  it('renders rail (map + stop list), detail, and tab bar in one DOM', () => {
    const { container } = render(TourStopView, { props: baseProps() })
    // Rail: map mount point and every stop listed
    expect(container.querySelector('#tour-map')).toBeTruthy()
    expect(screen.getByLabelText('Current: First Stop')).toBeTruthy()
    expect(screen.getByLabelText('Last Stop')).toBeTruthy()
    // Detail: title present
    expect(container.querySelector('.stop-detail')).toBeTruthy()
    // Tab bar: all three phone tabs
    expect(screen.getByText('Stop')).toBeTruthy()
    expect(screen.getByText('Map & route')).toBeTruthy()
    expect(screen.getByText('Stops')).toBeTruthy()
  })

  it('mounts a phone stop-locator map in the hero with a distinct label and id', () => {
    const { container } = render(TourStopView, { props: baseProps() })
    // Two MapPanels are now in the DOM at once (rail + hero) — ids and
    // accessible names must not collide.
    expect(container.querySelector('#tour-map')).toBeTruthy()
    expect(container.querySelector('#tour-map-hero')).toBeTruthy()
    expect(
      screen.getByRole('img', { name: 'Map showing the location of First Stop' })
    ).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Route map for Test Route' })).toBeTruthy()
  })

  it('starts on the Stop pane and switches panes via the tab bar', async () => {
    const { container } = render(TourStopView, { props: baseProps() })
    const body = container.querySelector('.ts-body')!
    expect(body.getAttribute('data-phone-view')).toBe('stop')

    await fireEvent.click(screen.getByText('Map & route'))
    expect(body.getAttribute('data-phone-view')).toBe('map')

    await fireEvent.click(screen.getByText('Stops'))
    expect(body.getAttribute('data-phone-view')).toBe('stops')
  })

  it('returns to the Stop pane after choosing a stop from the rail', async () => {
    const props = baseProps()
    const { container } = render(TourStopView, { props })
    await fireEvent.click(screen.getByText('Stops'))

    await fireEvent.click(screen.getByLabelText('Last Stop'))
    expect(props.onGoToStop).toHaveBeenCalledWith('stop-c')
    const body = container.querySelector('.ts-body')!
    expect(body.getAttribute('data-phone-view')).toBe('stop')
  })
})

describe('TourStop — coordinate-less hero plate', () => {
  it('keeps the contour-art plate (no data-has-map, no hero map) when the stop has no coordinates', () => {
    const props = baseProps()
    const stop = makeStop('no-coords', 'No Coords', { lat: null, lng: null })
    props.route.stops[0] = stop
    props.stop = stop
    const { container } = render(TourStopView, { props })

    // Without coordinates the phone hero must NOT flip to a locator map,
    // otherwise the @media rules would hide the plate and leave it blank.
    const hero = container.querySelector('.stop-hero')!
    expect(hero.hasAttribute('data-has-map')).toBe(false)
    expect(container.querySelector('#tour-map-hero')).toBeNull()
    // The fallback plate art is still rendered.
    expect(container.querySelector('.plate-svg')).toBeTruthy()
  })

  it('sets data-has-map and mounts the hero locator map when the stop has coordinates', () => {
    const { container } = render(TourStopView, { props: baseProps() })
    const hero = container.querySelector('.stop-hero')!
    expect(hero.getAttribute('data-has-map')).toBe('true')
    expect(container.querySelector('#tour-map-hero')).toBeTruthy()
  })
})
