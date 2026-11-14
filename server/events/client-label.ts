/** Shown when the client is unknown or did not say who it is. */
export const UNKNOWN_CLIENT = 'Cliente MCP'

// Known clients, matched against the name they declare. Order matters: "claude-code" before "claude",
// "cursor-vscode" before "vscode". Any other name is not shown: it is self-declared text on a public page.
const KNOWN: ReadonlyArray<readonly [RegExp, string]> = [
  [/claude[\s_-]?code/i, 'Claude Code'],
  [/claude/i, 'Claude'],
  [/openai|chatgpt/i, 'ChatGPT'],
  [/cursor/i, 'Cursor'],
  [/visual studio code|vscode|copilot/i, 'VS Code'],
  [/windsurf|codeium/i, 'Windsurf'],
  [/gemini/i, 'Gemini'],
  [/\bzed\b/i, 'Zed'],
  [/mcp[\s_-]?inspector/i, 'MCP Inspector'],
]

export type ClientHints = {
  /** From the request's `_meta` envelope (2026-07-28 protocol). */
  clientInfo?: { name: string; title?: string } | undefined
  /** 2025-era clients send no envelope; the User-Agent header is the only hint. */
  userAgent?: string | null | undefined
}

// claude.ai (web, desktop and mobile) calls from Anthropic's servers with Claude Code's MCP client, so its clientInfo
// says "Claude Code". The User-Agent tells them apart: Claude-User is Anthropic's agent for a request a person makes
// in Claude, while Claude Code sends claude-code/<version>.
const CLAUDE_APP_AGENT = /^claude-user\b/i

function known(text: string | undefined): string | undefined {
  if (!text) return undefined
  return KNOWN.find(([pattern]) => pattern.test(text))?.[1]
}

/** The inspector's label for the AI behind a call. Display only: never used for rules or security. */
export function clientLabel({ clientInfo, userAgent }: ClientHints): string {
  if (userAgent && CLAUDE_APP_AGENT.test(userAgent)) return 'Claude'
  const declared = clientInfo ? known(`${clientInfo.title ?? ''} ${clientInfo.name}`) : undefined
  return declared ?? known(userAgent ?? undefined) ?? UNKNOWN_CLIENT
}
