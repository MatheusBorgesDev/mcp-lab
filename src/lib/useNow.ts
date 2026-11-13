import { useEffect, useState } from 'react'

/** The current time, refreshed every `everyMs`: what the page shows as "now" moves without a reload. */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}
