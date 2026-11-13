import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TryWithAI } from './TryWithAI'

const ORIGIN = 'https://barber.test'
const URL_MCP = `${ORIGIN}/mcp`

describe('TryWithAI', () => {
  it('shows the MCP address of this site', () => {
    render(<TryWithAI origin={ORIGIN} />)

    expect(screen.getByText(URL_MCP)).toBeInTheDocument()
  })

  it('copies the address and says it did', async () => {
    const user = userEvent.setup()
    render(<TryWithAI origin={ORIGIN} />)

    await user.click(screen.getByRole('button', { name: /copiar/i }))

    expect(await navigator.clipboard.readText()).toBe(URL_MCP)
    expect(screen.getByRole('status')).toHaveTextContent(/copiado/i)
  })

  it('has one tab per AI, Claude first, each with its own steps', async () => {
    const user = userEvent.setup()
    render(<TryWithAI origin={ORIGIN} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Claude', 'ChatGPT', 'Cursor'])
    expect(screen.getByRole('tab', { name: 'Claude' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/conector personalizado/i)
    // Claude offers OAuth by default; this server has no login, so the visitor must pick "Sem login".
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/Autenticação.*Sem login/)

    await user.click(screen.getByRole('tab', { name: 'ChatGPT' }))

    expect(screen.getByRole('tab', { name: 'ChatGPT' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('chatgpt.com/plugins')
  })

  it('moves between tabs with the arrow keys, keeping only the selected tab in the tab order', async () => {
    const user = userEvent.setup()
    render(<TryWithAI origin={ORIGIN} />)

    await user.click(screen.getByRole('tab', { name: 'Claude' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'ChatGPT' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'ChatGPT' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Cursor' })).toHaveFocus()
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '-1', '0'])
  })

  it('offers Cursor a one-click install link with this address', async () => {
    const user = userEvent.setup()
    render(<TryWithAI origin={ORIGIN} />)

    await user.click(screen.getByRole('tab', { name: 'Cursor' }))

    const link = within(screen.getByRole('tabpanel')).getByRole('link', { name: /adicionar ao cursor/i })
    const href = new URL(link.getAttribute('href') ?? '')
    expect(`${href.protocol}//${href.host}${href.pathname}`).toBe('cursor://anysphere.cursor-deeplink/mcp/install')
    expect(href.searchParams.get('name')).toBe('mcp-barber-shop')
    expect(JSON.parse(atob(href.searchParams.get('config') ?? ''))).toEqual({ url: URL_MCP })
  })

  it('suggests what to ask', () => {
    render(<TryWithAI origin={ORIGIN} />)

    expect(screen.getByText(/que horários ele tem/i)).toBeInTheDocument()
  })
})
