import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(cleanup)

// jsdom has no layout, so no scrolling: the page calls scrollIntoView to show the appointment in the link.
Element.prototype.scrollIntoView ??= () => {}
