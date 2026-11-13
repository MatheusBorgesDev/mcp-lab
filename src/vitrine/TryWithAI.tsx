import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import styles from './TryWithAI.module.css'

const SERVER_NAME = 'mcp-barber-shop'

/** Cursor's install link: the server config as base64 JSON (cursor.com/docs/mcp/install-links). */
const cursorInstallLink = (url: string) =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(btoa(JSON.stringify({ url })))}`

type Client = { id: string; label: string; steps: (url: string) => ReactNode }

// Claude and ChatGPT: the paths the owner followed (12 and 13/11/2026). Cursor: its documentation (13/11/2026).
const CLIENTS: Client[] = [
  {
    id: 'claude',
    label: 'Claude',
    steps: () => (
      <ol className={styles.steps}>
        <li>
          No claude.ai, abra <b>Configurações → Conectores</b>.
        </li>
        <li>
          Clique em <b>Adicionar conector personalizado</b>, dê o nome MCP Barber Shop e cole o endereço acima.
        </li>
        <li>
          Em <b>Autenticação</b>, marque <b>Sem login</b> e salve. O Claude vem com login (OAuth) marcado, e este
          servidor não tem login.
        </li>
        <li>Numa conversa nova, peça um horário. Reservar, remarcar e cancelar pedem a sua aprovação antes.</li>
      </ol>
    ),
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    steps: () => (
      <ol className={styles.steps}>
        <li>
          Abra <b>chatgpt.com/plugins</b> e clique em <b>Adicionar</b>.
        </li>
        <li>
          Escolha <b>Adicionar servidor MCP personalizado</b>, cole o endereço acima e deixe sem autenticação.
        </li>
        <li>Funciona também no plano gratuito. Os horários e a reserva aparecem em cartões na conversa.</li>
      </ol>
    ),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    steps: (url) => (
      <ol className={styles.steps}>
        <li>
          Com o Cursor instalado, clique em{' '}
          <a className={styles.install} href={cursorInstallLink(url)}>
            Adicionar ao Cursor
          </a>{' '}
          e confirme.
        </li>
        <li>
          Ou adicione à mão, em <code>~/.cursor/mcp.json</code>:
          <pre className={styles.code}>
            {JSON.stringify({ mcpServers: { [SERVER_NAME]: { url } } }, null, 2)}
          </pre>
        </li>
        <li>No chat do Cursor, peça um horário.</li>
      </ol>
    ),
  },
]

const PROMPTS = [
  'Quero cortar o cabelo amanhã à tarde com o Rafael. Que horários ele tem?',
  'Marca uma barba no sábado de manhã, com quem estiver livre.',
  'Preciso remarcar a minha reserva para uma hora mais tarde.',
]

/** How to connect the shop to the visitor's own AI: the MCP address, steps per client, prompts to try. */
export function TryWithAI({ origin = window.location.origin }: { origin?: string }) {
  const url = `${origin}/mcp`
  const id = useId()
  const [selected, setSelected] = useState(0)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const address = useRef<HTMLElement>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied('done')
    } catch {
      // No clipboard (insecure context, denied): select the address so the visitor can copy it.
      const range = document.createRange()
      if (address.current) range.selectNodeContents(address.current)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      setCopied('failed')
    }
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = CLIENTS.length - 1
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : undefined
    if (next === undefined) return
    event.preventDefault()
    setSelected(next)
    tabs.current[next]?.focus()
  }

  const client = CLIENTS[selected] ?? CLIENTS[0]!
  return (
    <section id="teste" aria-labelledby={`${id}-title`} className={styles.try}>
      <p className={styles.stamp}>grátis · sem login</p>
      <h2 id={`${id}-title`} className={styles.title}>
        Teste com a sua IA
      </h2>

      <div className={styles.address}>
        <code ref={address}>{url}</code>
        <button type="button" className={styles.copy} onClick={copy}>
          Copiar
        </button>
      </div>
      <p role="status" className={styles.copied}>
        {copied === 'done' ? 'Copiado!' : copied === 'failed' ? 'Selecionado: copie com Ctrl+C.' : ''}
      </p>

      <div role="tablist" aria-label="Escolha a sua IA" className={styles.tabs}>
        {CLIENTS.map((c, index) => (
          <button
            key={c.id}
            ref={(el) => {
              tabs.current[index] = el
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${c.id}`}
            aria-selected={index === selected}
            aria-controls={`${id}-panel`}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${client.id}`} tabIndex={0}>
        {client.steps(url)}
      </div>

      <div className={styles.prompts}>
        <p className="eyebrow">Peça assim</p>
        <ul>
          {PROMPTS.map((prompt) => (
            <li key={prompt}>“{prompt}”</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
