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
- Código do servidor (`/api`, `/server`) usa imports relativos: as funções da Vercel não aceitam path aliases do tsconfig.
- Gerenciador de pacotes: pnpm.

## Comandos

(preencher conforme o projeto for criado)
