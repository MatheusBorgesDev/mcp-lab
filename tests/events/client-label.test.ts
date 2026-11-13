import { describe, expect, it } from 'vitest'
import { clientLabel } from '../../server/events/client-label.js'

// The inspector's label for the AI behind a call. Clients declare their own name, so only known names are
// shown: anything else would let a client print any text on the public page.
describe('clientLabel', () => {
  it.each([
    ['claude-ai', 'Claude'],
    ['claude-code', 'Claude Code'],
    ['openai-mcp', 'ChatGPT'],
    ['cursor-vscode', 'Cursor'],
    ['Visual Studio Code', 'VS Code'],
    ['Windsurf', 'Windsurf'],
    ['gemini-cli-mcp-client', 'Gemini'],
    ['Zed', 'Zed'],
    ['mcp-inspector', 'MCP Inspector'],
  ])('names a known client from its declared name: %s', (name, label) => {
    expect(clientLabel({ clientInfo: { name } })).toBe(label)
  })

  it('also reads the declared title', () => {
    expect(clientLabel({ clientInfo: { name: 'app', title: 'Claude' } })).toBe('Claude')
  })

  it('falls back to the User-Agent when the request declares no client (2025-era clients)', () => {
    expect(clientLabel({ userAgent: 'openai-mcp/1.0.0' })).toBe('ChatGPT')
  })

  it('prefers the declared client over the User-Agent', () => {
    expect(clientLabel({ clientInfo: { name: 'cursor-vscode' }, userAgent: 'openai-mcp/1.0.0' })).toBe('Cursor')
  })

  it.each([
    [{ clientInfo: { name: 'my-own-client' } }],
    [{ clientInfo: { name: 'Fulano de Tal 11 99999-0000' } }],
    [{ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }],
    [{ userAgent: 'node' }],
    [{}],
  ])('shows "Cliente MCP" for anything else: %j', (input) => {
    expect(clientLabel(input)).toBe('Cliente MCP')
  })
})
