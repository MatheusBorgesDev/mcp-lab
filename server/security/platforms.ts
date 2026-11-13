import { BlockList, isIP } from 'node:net'
import { CHATGPT_CONNECTOR_RANGES } from './chatgpt-connectors.js'

/**
 * Anthropic's outbound ranges, where claude.ai connectors call MCP servers from
 * (https://platform.claude.com/docs/en/api/ip-addresses, checked on 2026-11-13).
 */
const ANTHROPIC_OUTBOUND_RANGES = ['160.79.104.0/21', '153.61.208.0/20']

const platforms = new BlockList()
for (const range of [...ANTHROPIC_OUTBOUND_RANGES, ...CHATGPT_CONNECTOR_RANGES]) {
  const [network = '', prefix = ''] = range.split('/')
  platforms.addSubnet(network, Number(prefix), 'ipv4')
}

/**
 * Whether an address belongs to an AI platform that calls MCP servers from its own cloud (claude.ai, ChatGPT):
 * one such address stands for many visitors. Visitors whose AI runs on their machine (Claude Code, Cursor)
 * arrive with their own address. An IPv4 address written as IPv6 matches too.
 */
export function isPlatformAddress(ip: string): boolean {
  const family = isIP(ip)
  return family !== 0 && platforms.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}
