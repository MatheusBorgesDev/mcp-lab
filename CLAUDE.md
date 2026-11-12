# CLAUDE.md

Projeto de portfólio: servidor MCP de agendamento de uma barbearia fictícia, a MCP Barber Shop, testável por visitantes com a própria IA, com agenda compartilhada e inspector ao vivo.

**Leia `docs/SPEC.md` antes de qualquer tarefa.** Ela contém o escopo, as decisões tomadas, as regras de negócio, o modelo de dados e as fases.

## Como trabalhar neste projeto

- Siga as fases da SPEC em ordem. Ao concluir um item, marque o checklist na SPEC.
- Não altere decisões da seção "Decisões tomadas" sem perguntar antes.
- Itens da seção "Decisões em aberto" devem ser discutidos comigo antes de implementar.
- As versões de `mcp-handler`, `@modelcontextprotocol/server` e `zod` estão fixadas (ver SPEC, seção 2). Antes de atualizar qualquer uma, confirme a compatibilidade entre as três.
- Repositório pessoal: os commits usam o e-mail noreply do GitHub configurado no próprio repositório. Confira `git config user.email` antes do primeiro commit numa cópia nova.

## Convenções

- TypeScript em modo strict em todo o projeto.
- Toda entrada externa validada com `zod`.
- Regras de negócio em `server/domain`, como funções puras e testadas, sem acesso a banco ou HTTP.
- Horários sempre armazenados como `timestamptz`; conversão para `America/Sao_Paulo` só na borda.
- O front nunca escreve no banco. Toda escrita passa pelas funções do servidor, pela conexão Postgres do servidor (`DATABASE_URL`).
- Nenhum segredo no front ou no repositório: apenas variáveis de ambiente.
- Nada que identifique o visitante (IP, nome, código de reserva completo) aparece em telas públicas ou no inspector.
- Idioma: conteúdo da barbearia e página em pt-BR; descrições das tools, `instructions` e mensagens de erro em inglês; identificadores de código em inglês.
- Código do servidor (`/api`, `/server`, `/tests`, `/dev`) usa imports relativos com extensão `.js` (resolução NodeNext; Vite e Vitest resolvem para o `.ts`). As funções da Vercel não aceitam path aliases do tsconfig.
- Toda função em `/api` exporta a assinatura Web: `export default { fetch(request) { ... } }`.
- Dois tsconfig independentes: `tsconfig.json` (servidor; a Vercel compila `/api` estendendo este arquivo) e `src/tsconfig.json` (front). Sem project references.
- Gerenciador de pacotes: pnpm. Node 22 (`engines` no package.json; `.tool-versions` para quem usa asdf).

## Comandos

- `pnpm dev`: página e funções de `/api` na mesma porta (5173). O plugin `dev/vercel-api-plugin.ts` serve `/api/<nome>` a partir de `api/<nome>.ts` e aplica os rewrites exatos do `vercel.json`, como a Vercel.
- `pnpm test` / `pnpm test:watch`: testes unitários (Vitest, projeto `unit`), sem banco.
- `pnpm test:db`: testes contra o Supabase local (projeto `db`, em `tests/db`), inclusive o de concorrência. Os arquivos rodam em paralelo: cada teste ou roda numa transação desfeita no fim, ou (quando precisa de várias conexões) grava dados com um prefixo de id só daquele arquivo e apaga no fim. O helper recusa qualquer banco que não seja local.
- `pnpm db:start` / `db:stop` / `db:status`: Supabase local (precisa do Docker). Studio em http://127.0.0.1:54323.
- `pnpm db:reset`: recria o banco local aplicando `supabase/migrations` e o `supabase/seed.sql`.
- `pnpm typecheck`: servidor e front.
- `pnpm lint`: oxlint (não imprime nada quando está tudo certo).
- `pnpm build`: typecheck + build do front.
