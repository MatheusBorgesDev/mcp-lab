import { describe, expect, it } from 'vitest'
import { liveStatus } from './status'

// The page listens to two channels (agenda and inspector); the header shows one status for both.
describe('liveStatus', () => {
  it('is connecting until every channel has answered', () => {
    expect(liveStatus([undefined, undefined])).toBe('connecting')
    expect(liveStatus(['SUBSCRIBED', undefined])).toBe('connecting')
  })

  it('is live when every channel is subscribed', () => {
    expect(liveStatus(['SUBSCRIBED', 'SUBSCRIBED'])).toBe('live')
  })

  it.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'] as const)('is reconnecting when a channel reports %s', (status) => {
    expect(liveStatus(['SUBSCRIBED', status])).toBe('reconnecting')
    expect(liveStatus([undefined, status])).toBe('reconnecting')
  })
})
