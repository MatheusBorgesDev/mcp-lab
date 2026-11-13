import styles from './App.module.css'
import { SiteHeader } from './site/SiteHeader'
import { Menu } from './vitrine/Menu'
import { ShopFacts } from './vitrine/ShopFacts'
import { TryWithAI } from './vitrine/TryWithAI'

export default function App() {
  return (
    <>
      <a className="skip" href="#conteudo">
        Pular para o conteúdo
      </a>
      <SiteHeader />
      <main id="conteudo" className="wrap">
        <div id="top" className={styles.hero}>
          <div>
            <p className="eyebrow">Barbearia de bairro · servidor MCP aberto</p>
            <h1 className={styles.title}>
              Marque pela sua IA. <em>Veja acontecer aqui.</em>
            </h1>
            <p className={styles.lede}>
              Conecte a MCP Barber Shop no Claude, no ChatGPT ou no Cursor e peça um horário conversando. A agenda é a
              mesma para todo mundo, e cada chamada aparece no inspector enquanto acontece.
            </p>
            <ShopFacts />
          </div>
          <TryWithAI />
        </div>

        <div className={styles.live}>
          <section id="agenda" aria-labelledby="agenda-titulo" className={styles.agenda}>
            <h2 id="agenda-titulo">Agenda</h2>
          </section>
          <section id="inspector" aria-labelledby="inspector-titulo" className={styles.inspector}>
            <h2 id="inspector-titulo">Inspector</h2>
            <p className={styles.sub}>cada chamada MCP, da chegada à resposta</p>
            <p className={styles.foot}>sem IP, sem nome, sem código completo · só o que é público</p>
          </section>
        </div>

        <Menu />
      </main>
      <footer className={styles.footer}>
        <div className="wrap">
          <p>Barbearia fictícia, servidor MCP de verdade. Um projeto de portfólio.</p>
        </div>
      </footer>
    </>
  )
}
