import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import ArrivalBanner from './ArrivalBanner.svelte'

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    stopTitle: 'The Rampart Walk',
    isCurrent: false,
    onOpen: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  }
}

describe('ArrivalBanner', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('announces the stop politely with an Open action', () => {
    render(ArrivalBanner, { props: makeProps() })
    expect(screen.getByRole('status').textContent).toContain('The Rampart Walk')
    expect(screen.getByText('Open ›')).toBeTruthy()
  })

  it('tapping opens the stop when it is not the current one', async () => {
    const props = makeProps()
    render(ArrivalBanner, { props })
    await fireEvent.click(screen.getByRole('button'))
    expect(props.onOpen).toHaveBeenCalled()
    expect(props.onDismiss).not.toHaveBeenCalled()
  })

  it('tapping just dismisses when the arrival IS the open stop (no Open label)', async () => {
    const props = makeProps({ isCurrent: true })
    render(ArrivalBanner, { props })
    expect(screen.queryByText('Open ›')).toBeNull()
    await fireEvent.click(screen.getByRole('button'))
    expect(props.onDismiss).toHaveBeenCalled()
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('auto-dismisses after 10 seconds', () => {
    const props = makeProps()
    render(ArrivalBanner, { props })
    vi.advanceTimersByTime(9_000)
    expect(props.onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_500)
    expect(props.onDismiss).toHaveBeenCalled()
  })
})
