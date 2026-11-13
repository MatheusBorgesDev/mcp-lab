import { describe, expect, it } from 'vitest'
import { formatDuration, formatPrice, formatWeekdays } from './format'

describe('formatPrice', () => {
  it.each([
    [5000, 'R$ 50'],
    [18000, 'R$ 180'],
    [5250, 'R$ 52,50'],
    [0, 'R$ 0'],
  ])('%i cents → %s', (cents, text) => {
    expect(formatPrice(cents)).toBe(text)
  })
})

describe('formatDuration', () => {
  it.each([
    [15, '15 min'],
    [45, '45 min'],
    [60, '1h'],
    [90, '1h30'],
    [120, '2h'],
  ])('%i minutes → %s', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text)
  })
})

describe('formatWeekdays', () => {
  it.each([
    [[2, 3, 4, 5, 6], 'ter a sáb'],
    [[1, 2, 3, 4, 5], 'seg a sex'],
    [[1, 3, 4, 5, 6], 'seg, qua a sáb'],
    [[1, 3, 5], 'seg, qua, sex'],
    [[5, 6], 'sex, sáb'],
    [[6, 1, 2, 3, 4, 5, 6], 'seg a sáb'],
    [[], ''],
  ])('%j → %s', (days, text) => {
    expect(formatWeekdays(days)).toBe(text)
  })
})
