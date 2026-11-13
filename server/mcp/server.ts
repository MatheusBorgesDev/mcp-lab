import { createMcpHandler } from 'mcp-handler'
import { INSTRUCTIONS } from './instructions.js'
import { registerReadTools, registerWriteTools, type ToolDeps } from './tools.js'

/**
 * The MCP endpoint as a Web handler: protocol 2026-07-28 (stateless) natively, with the stateless
 * Streamable HTTP fallback for 2025-era clients, both handled by mcp-handler.
 */
export function createMcpRequestHandler(deps: ToolDeps): (request: Request) => Promise<Response> {
  return createMcpHandler(
    (server) => {
      registerReadTools(server, deps)
      registerWriteTools(server, deps)
    },
    {
      serverInfo: { name: 'mcp-barber-shop', version: '0.1.0' },
      instructions: INSTRUCTIONS,
    },
  )
}
