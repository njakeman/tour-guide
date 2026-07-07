import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import TourLibrary from './TourLibrary.svelte'
import type { TourRoute } from './types'

function makeRoute(id: string, name: string): TourRoute {
  return {
    id,
    name,
    description: `About ${name}`,
    icon: '🗺️',
    stops: [
      {
        id: `${id}-1`,
        title: `${name} stop`,
        lat: 50.85,
        lng: -0.379,
        proximity_radius: 30,
        evidence: 'e',
        interpretation: 'i',
        bodyHtml: '<p>b</p>',
        media: [],
      },
    ],
  }
}

describe('TourLibrary', () => {
  it('renders a card per route', () => {
    render(TourLibrary, {
      props: {
        routes: [makeRoute('a', 'Route A'), makeRoute('b', 'Route B')],
        onSelect: vi.fn(),
      },
    })
    expect(screen.getByText('Route A')).toBeTruthy()
    expect(screen.getByText('Route B')).toBeTruthy()
  })

  it('calls onSelect with the route id when a card is tapped', async () => {
    const onSelect = vi.fn()
    render(TourLibrary, {
      props: { routes: [makeRoute('a', 'Route A')], onSelect },
    })
    await fireEvent.click(screen.getByLabelText('Open tour: Route A'))
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('shows an explanatory empty state on the Saved filter', async () => {
    render(TourLibrary, {
      props: { routes: [makeRoute('a', 'Route A')], onSelect: vi.fn() },
    })
    await fireEvent.click(screen.getByText('Saved'))
    expect(screen.getByText(/No saved tours yet/)).toBeTruthy()
  })

  it('does not show the offline badge before a tour is cached', () => {
    render(TourLibrary, {
      props: {
        routes: [makeRoute('a', 'Route A')],
        onSelect: vi.fn(),
        selectedRouteId: 'a',
        currentRoute: makeRoute('a', 'Route A'),
      },
    })
    expect(screen.queryByLabelText('Map saved offline')).toBeNull()
  })
})

describe('TourLibrary — responsive master–detail Landing', () => {
  function landingProps(view: 'library' | 'route' = 'library') {
    const routes = [makeRoute('a', 'Route A'), makeRoute('b', 'Route B')]
    return {
      routes,
      onSelect: vi.fn(),
      view,
      selectedRouteId: 'a',
      currentRoute: routes[0],
      currentStopId: null,
      visitedStopIds: new Set<string>(),
      onGoToStop: vi.fn(),
      onBack: vi.fn(),
    }
  }

  it('renders the card list and the overview pane in one DOM', () => {
    const { container } = render(TourLibrary, { props: landingProps() })
    expect(container.querySelector('.tour-list')).toBeTruthy()
    // The overview (RouteMap) mounts for the selected tour
    expect(container.querySelector('.tour-overview[data-tour="a"]')).toBeTruthy()
  })

  it('drives the phone pane from the view prop', () => {
    const { container } = render(TourLibrary, { props: landingProps('route') })
    const body = container.querySelector('.tl-body')!
    expect(body.getAttribute('data-phone-view')).toBe('route')
  })

  it('marks the selected card and leaves the others idle', () => {
    const { container } = render(TourLibrary, { props: landingProps() })
    expect(container.querySelector('.tour-card[data-tour="a"]')!.getAttribute('data-state')).toBe('selected')
    expect(container.querySelector('.tour-card[data-tour="b"]')!.getAttribute('data-state')).toBe('idle')
  })

  it('calls onSelect when an idle card is tapped', async () => {
    const props = landingProps()
    render(TourLibrary, { props })
    await fireEvent.click(screen.getByLabelText('Open tour: Route B'))
    expect(props.onSelect).toHaveBeenCalledWith('b')
  })
})
