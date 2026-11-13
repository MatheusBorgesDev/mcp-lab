import styles from './App.module.css'
import { SiteHeader } from './site/SiteHeader'

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
          </div>
          <section id="teste" aria-labelledby="teste-titulo" className={styles.try}>
            <h2 id="teste-titulo">Teste com a sua IA</h2>
          </section>
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

        <div className={styles.menu}>
          <section id="servicos" aria-labelledby="servicos-titulo">
            <h2 id="servicos-titulo">Serviços</h2>
          </section>
          <section id="equipe" aria-labelledby="equipe-titulo">
            <h2 id="equipe-titulo">Equipe</h2>
          </section>
        </div>
      </main>
      <footer className={styles.footer}>
        <p className="wrap">Barbearia fictícia, servidor MCP de verdade. Um projeto de portfólio.</p>
      </footer>
    </>
  )
}
