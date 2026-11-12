import { createMcpHandler } from 'mcp-handler'
import type { Barbershop } from '../app/barbershop.js'
import { INSTRUCTIONS } from './instructions.js'
import { registerReadTools } from './tools.js'

/**
 * The MCP endpoint as a Web handler: protocol 2026-07-28 (stateless) natively, with the stateless
 * Streamable HTTP fallback for 2025-era clients, both handled by mcp-handler.
 */
export function createMcpRequestHandler({ shop }: { shop: Barbershop }): (request: Request) => Promise<Response> {
  return createMcpHandler(
    (server) => {
      registerReadTools(server, { shop })
    },
    {
      serverInfo: { name: 'mcp-barber-shop', version: '0.1.0' },
      instructions: INSTRUCTIONS,
    },
  )
}
