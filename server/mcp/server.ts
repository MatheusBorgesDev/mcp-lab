import { createMcpHandler } from 'mcp-handler'
import { limitBody } from '../security/body-limit.js'
import { INSTRUCTIONS } from './instructions.js'
import { registerPrompts } from './prompts.js'
import { registerResources } from './resources.js'
import { registerReadTools, registerWriteTools, type ToolDeps } from './tools.js'

/**
 * The MCP endpoint as a Web handler: protocol 2026-07-28 (stateless) natively, with the stateless
 * Streamable HTTP fallback for 2025-era clients, both handled by mcp-handler. Bodies over 64 KB get a 413.
 */
export function createMcpRequestHandler(deps: ToolDeps): (request: Request) => Promise<Response> {
  const mcp = createMcpHandler(
    (server) => {
      registerReadTools(server, deps)
      registerWriteTools(server, deps)
      registerResources(server, deps)
      registerPrompts(server)
    },
    {
      serverInfo: { name: 'mcp-barber-shop', version: '0.1.0' },
      instructions: INSTRUCTIONS,
    },
  )
  // Oversized bodies are refused before the SDK parses them.
  return async (request) => {
    const limited = await limitBody(request)
    return limited instanceof Response ? limited : mcp(limited)
  }
}
