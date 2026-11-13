import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiveIndicator } from './LiveIndicator'

describe('LiveIndicator', () => {
  it.each([
    ['live', 'ao vivo'],
    ['connecting', 'conectando'],
    ['reconnecting', 'reconectando'],
    ['unavailable', 'sem tempo real'],
  ] as const)('announces %s as "%s"', (status, label) => {
    render(<LiveIndicator status={status} />)

    expect(screen.getByRole('status')).toHaveTextContent(label)
  })

  it('turns the pole only while live', () => {
    const { rerender } = render(<LiveIndicator status="live" />)
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'live')

    rerender(<LiveIndicator status="reconnecting" />)
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'reconnecting')
  })
})
