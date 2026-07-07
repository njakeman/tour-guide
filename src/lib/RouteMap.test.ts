import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import RouteMap from './RouteMap.svelte'
import type { TourRoute, TourStop } from './types'

function makeStop(id: string, title: string, i: number): TourStop {
  return {
    id,
    title,
    lat: 50.85 + i * 0.001,
    lng: -0.379,
    proximity_radius: 30,
    evidence: 'e',
    interpretation: 'i',
    bodyHtml: '<p>b</p>',
    media: [],
  }
}

function makeRoute(overrides: Partial<TourRoute> = {}): TourRoute {
  return {
    id: 'test-route',
    name: 'Test Route',
    description: 'desc',
    icon: '🗺️',
    stops: [makeStop('a', 'Stop A', 0), makeStop('b', 'Stop B', 1)],
    ...overrides,
  }
}

function baseProps(route = makeRoute()) {
  return {
    route,
    currentStopId: null,
    visitedStopIds: new Set<string>(),
    onBack: vi.fn(),
    onGoToStop: vi.fn(),
  }
}

describe('RouteMap', () => {
  it('renders the SVG schematic when no basemap is configured', () => {
    render(RouteMap, { props: baseProps() })
    const svgMap = screen.getByRole('img', { name: 'Route map for Test Route' })
    expect(svgMap.tagName.toLowerCase()).toBe('svg')
  })

  it('lists all stops with their titles', () => {
    render(RouteMap, { props: baseProps() })
    expect(screen.getByText('Stop A')).toBeTruthy()
    expect(screen.getByText('Stop B')).toBeTruthy()
  })

  it('navigates when a stop row is clicked', async () => {
    const props = baseProps()
    render(RouteMap, { props })
    await fireEvent.click(screen.getByText('Stop B'))
    expect(props.onGoToStop).toHaveBeenCalledWith('b')
  })

  it('marks visited stops as done and the current stop', () => {
    const props = {
      ...baseProps(),
      currentStopId: 'b',
      visitedStopIds: new Set(['a']),
    }
    render(RouteMap, { props })
    expect(screen.getByText('you are here')).toBeTruthy()
    expect(screen.getByLabelText('Current: Stop B')).toBeTruthy()
  })

  it('exposes the .start-tour[data-tour] hook and starts at the first stop', async () => {
    const props = baseProps()
    const { container } = render(RouteMap, { props })
    const cta = container.querySelector('.start-tour[data-tour="test-route"]') as HTMLButtonElement
    expect(cta).toBeTruthy()
    expect(cta.textContent).toContain('Start tour')
    await fireEvent.click(cta)
    expect(props.onGoToStop).toHaveBeenCalledWith('a')
  })

  it('shows the Resume CTA once the tour is in progress', () => {
    const props = {
      ...baseProps(),
      currentStopId: 'b',
      visitedStopIds: new Set(['a']),
    }
    const { container } = render(RouteMap, { props })
    const cta = container.querySelector('.start-tour') as HTMLButtonElement
    expect(cta.textContent).toContain('Resume')
  })

  it('renders as the .tour-overview[data-tour] pane, not a full screen', () => {
    const { container } = render(RouteMap, { props: baseProps() })
    expect(container.querySelector('.tour-overview[data-tour="test-route"]')).toBeTruthy()
  })
})
