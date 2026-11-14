# MCP Barber Shop — Especificação do projeto

## 1. Visão geral

Projeto de portfólio: uma barbearia fictícia, a **MCP Barber Shop**, cujo sistema de agendamento é exposto como **servidor MCP remoto**. O visitante conecta a URL do MCP na IA que já usa (Claude, ChatGPT, Cursor etc.) e, conversando, consulta serviços, preços, profissionais e disponibilidade, e marca, remarca e desmarca horários.

O resultado aparece **ao vivo numa página pública**: a agenda da barbearia é compartilhada entre todos os visitantes, e um **inspector** mostra cada chamada MCP sendo recebida, validada, processada e respondida.

Objetivos:

- Demonstrar domínio de MCP (tools, resources e prompts) num servidor em produção.
- Mostrar regras de negócio reais, tratamento de concorrência e segurança.
- Ser fácil e interessante de testar por um avaliador.

## 2. Decisões tomadas

- **Domínio**: barbearia fictícia **MCP Barber Shop**, com 3 ou 4 profissionais e cerca de 8 serviços.
- **Agenda compartilhada**: todos os visitantes veem e disputam os mesmos horários.
- **Sem chat embutido**: o visitante usa a própria IA. O projeto não paga inferência de LLM.
- **Sem login**: a posse de uma reserva é dada pelo **código de reserva** (aleatório, impossível de adivinhar).
- **Idioma**: conteúdo da barbearia e página pública em pt-BR (serviços, preços em R$, `salon://info` e o prompt `agendar_horario`, que o visitante escolhe num menu e é enviado em nome dele). A camada que a IA lê fica em inglês: descrições das tools, `instructions` do servidor e `message` dos erros. Identificadores de código sempre em inglês. A IA do visitante responde no idioma dele de qualquer forma.
- **Stack**:
  - Front: Vite + React + TypeScript (SPA, sem SSR).
  - Backend: Vercel Functions (Node 22) no mesmo repositório, pasta `/api`, com a assinatura Web padrão (`export default { fetch }`). Código do servidor usa imports relativos: as funções da Vercel não aceitam path aliases do tsconfig.
  - MCP: `mcp-handler` + SDK oficial do MCP v2 (`@modelcontextprotocol/server`) + `zod`. Protocolo 2026-07-28 (sem estado) servido nativamente, com fallback de Streamable HTTP sem estado para clientes da geração 2025, no mesmo handler. Endpoint público `/mcp`, por rewrite no `vercel.json` para `api/mcp.ts`.
  - Versões fixadas (sem `^`): `mcp-handler` 2.3.1, `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/client` 2.4.0 (só testes), `zod` 4.6.7. Conferidas no npm em 2026-11-12. O `mcp-handler` 2.x exige o SDK v2; o pacote antigo `@modelcontextprotocol/sdk` 1.x não é usado.
  - Acesso ao banco: **SQL direto** com o driver `postgres` (postgres.js), sem ORM. As garantias do projeto moram no banco (exclusion constraint, view, RLS), que um ORM não modela bem. Linhas lidas são validadas com `zod` em `server/db`. Migrations em SQL pela CLI do Supabase.
  - Conexão do servidor: `DATABASE_URL` pelo pooler do Supabase em modo transaction (porta 6543), adequado a funções serverless; prepared statements desligados.
  - Banco e tempo real: Supabase (PostgreSQL + Realtime).
  - Rate limit: Redis gerenciado (Upstash, plano gratuito, pelo Marketplace da Vercel). Só o limite por tempo vai para o Redis; os limites de negócio (reservas ativas por IP, ocupação diária) ficam no Postgres, verificados na mesma transação da reserva.
  - Visitante por IP e plataformas de IA (decidido em 2026-11-13): os conectores do claude.ai e do ChatGPT chamam o MCP da nuvem da plataforma, não do aparelho do visitante, então um IP dessas faixas representa muitos visitantes. Para eles não vale o limite de reservas por visitante e o rate limit é maior (seção 8); o teto diário e a limpeza diária valem para todos. Faixas: as de saída publicadas pela Anthropic e a lista `chatgpt-connectors.json` da OpenAI (cópia no repositório; se envelhecer, o IP novo só recebe os limites de um visitante).
  - Hospedagem: planos gratuitos da Vercel e do Supabase.
  - Ferramentas: pnpm; Supabase local sobre Docker Engine instalado direto no WSL, subindo só os serviços que cada fase usa.
- **Identificação do cliente MCP** (`client_label` do inspector): `clientInfo` do envelope `_meta` de cada requisição (protocolo 2026-07-28); para clientes da geração 2025, o header `User-Agent`; sem nenhum dos dois, "Cliente MCP". O valor é autodeclarado: serve só para exibição, nunca para regra ou segurança.
- **Tempo real**: carga inicial lida pelo front direto no Supabase (somente leitura, via RLS). Atualizações ao vivo via **Supabase Realtime Broadcast**, contendo apenas dados públicos e sanitizados. Quem emite é o próprio banco: gatilhos em `appointments` e `mcp_events` chamam `realtime.send` na mesma transação de cada escrita do servidor, então um rollback não emite nada e o servidor não precisa de chave do Supabase. O `realtime.send` não propaga erro (só registra um WARNING): uma falha no Broadcast nunca desfaz a escrita. Os canais (`agenda` e `inspector`) são **privados**: uma política RLS em `realtime.messages` deixa o papel `anon` só ouvir esses dois tópicos, sem transmitir. (Em canal público, quem tem a chave pública pode transmitir para todos os visitantes. Postgres Changes não serve aqui porque a agenda pública é exposta por uma view e não deve vazar colunas privadas.)
  - `agenda`, evento `appointment`: `{ op: 'insert' | 'update' | 'delete', appointment }`, com as colunas da view `public_agenda`. Status `cancelled` ou op `delete` liberam o horário.
  - `inspector`, evento `call`: `{ events }`, as linhas de `mcp_events` de uma chamada de tool, gravadas num único insert.
- **Cron diário** (Vercel Cron): reseta a agenda, recria reservas fictícias e limpa eventos antigos. Como efeito colateral, mantém o projeto Supabase ativo (o plano gratuito pausa após 7 dias sem atividade).
- **Identidade visual** (aprovada em 2026-11-12): barbearia de bairro, com caderno de agenda e impressora de comandas. A agenda é o caderno do balcão (papel, pauta, tinta); o inspector é um quadro verde-escuro onde cada chamada MCP sai como um tíquete de borda serrilhada.
  - Cores, como tokens CSS (tema claro / escuro): papel `#F4EDDF` / `#15130F`; papel 2 `#EAE1CD` / `#1E1B15`; tinta `#1F1A14` / `#EFE6D3`; tinta 2 `#5A5044` / `#B0A38C`; pauta `#D6C9AE` / `#3A3329`; verde placa `#1E4D3A` / `#24573F` (marca, botão, horário ocupado; como texto no escuro, `#7FC2A0`); vermelho poste `#B23A2C` / `#E46B5D` (destaque, erro); latão `#C8963E` / `#D9A84E` (só pisca o que acabou de mudar; nunca é texto no tema claro). O inspector é escuro nos dois temas: quadro `#0F2219` (`#0B1A13` no escuro), giz `#ECE4D1`, comanda `#F6F0E3`, confere `#1E6B47`, não confere `#B23A2C`. Todo texto com contraste de pelo menos 4,5:1.
  - Tipografia: Fraunces nos títulos, marca e preços (eixos SOFT 100 e WONK 1); Schibsted Grotesk no texto e na interface; IBM Plex Mono em horários, inspector, códigos e apelidos. Fontes auto-hospedadas pelos pacotes `@fontsource`: a página não chama o Google.
  - Logo: placa esmaltada verde com "MCP / Barber Shop" entre dois postes de barbeiro. Símbolo: o poste (listras vermelho e creme, ponteiras de latão) num quadrado verde, usado como favicon (versão simplificada em 16 px) e como ícone do conector.
  - Detalhes que assinam: o poste girando no indicador "ao vivo" (parado e "reconectando" quando a conexão cai); o horário que acende em latão ao ser ocupado ou liberado; o tíquete serrilhado; o apelido "Cliente #NNNN" e o código mascarado em fonte mono. Todo movimento respeita `prefers-reduced-motion`.

## 3. Regras de negócio

| Regra | Valor inicial |
|---|---|
| Fuso horário da barbearia | `America/Sao_Paulo` |
| Granularidade dos horários | 15 minutos |
| Antecedência mínima para marcar | 2 horas |
| Máximo de dias à frente para marcar | 14 dias |
| Antecedência mínima para cancelar ou remarcar | 2 horas |
| Reservas ativas por visitante (IP; não vale para IPs de plataformas de IA, ver seção 2) | 2 |
| Ocupação máxima do dia para aceitar reserva de visitante (conta todas as reservas, inclusive as fictícias) | 70% dos horários |
| Ocupação das reservas fictícias, recriadas pelo cron diário (seção 9) | cerca de 30% dos horários de cada dia |
| Sugestões quando o horário não está livre | 3 horários mais próximos |

Regras adicionais:

- Cada serviço tem duração e preço próprios. O fim da reserva é sempre calculado pelo servidor (`início + duração do serviço`), nunca informado pelo cliente.
- Nem todo profissional faz todo serviço.
- Cada profissional tem seus horários de trabalho por dia da semana, com múltiplos intervalos por dia (o intervalo entre eles representa o almoço).
- Bloqueios (feriados, folgas) por profissional ou para a barbearia inteira.
- Nenhuma sobreposição de reservas do mesmo profissional, **garantida pelo banco** (exclusion constraint), não só pelo código.
- Se o profissional não for informado na reserva, o servidor escolhe um profissional disponível que faça o serviço.
- Datas recebidas e devolvidas em ISO 8601 com offset. Armazenamento sempre em `timestamptz`.

## 4. Modelo de dados (proposta)

```sql
create extension if not exists btree_gist;

create table services (
  id           text primary key,              -- slug, ex.: 'corte-masculino'
  name         text not null,
  description  text,
  duration_min int  not null check (duration_min > 0 and duration_min % 15 = 0),
  price_cents  int  not null check (price_cents >= 0),
  active       boolean not null default true
);

create table professionals (
  id     text primary key,                       -- slug
  name   text not null,
  bio    text,
  active boolean not null default true
);

create table professional_services (
  professional_id text references professionals(id),
  service_id      text references services(id),
  primary key (professional_id, service_id)
);

-- Vários intervalos por dia representam o almoço.
create table working_hours (
  id              serial primary key,
  professional_id text not null references professionals(id),
  weekday         smallint not null check (weekday between 0 and 6), -- 0 = domingo
  start_time      time not null,
  end_time        time not null,
  check (end_time > start_time)
);

create table closures (
  id              serial primary key,
  professional_id text references professionals(id),  -- null = barbearia inteira
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  reason          text,
  check (ends_at > starts_at)
);

create type appointment_status as enum ('confirmed', 'cancelled', 'completed');
create type appointment_source as enum ('visitor', 'seed');

create table appointments (
  id              uuid primary key default gen_random_uuid(),
  code_hash       text not null unique,         -- sha256 do código entregue ao visitante
  professional_id text not null references professionals(id),
  service_id      text not null references services(id),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          appointment_status not null default 'confirmed',
  source          appointment_source not null default 'visitor',
  client_name     text check (char_length(client_name) <= 60), -- privado, nunca exibido
  public_alias    text not null,                -- ex.: 'Cliente #4821'
  ip_hash         text,                         -- hash com salt secreto, só para limites
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_at > starts_at),
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled')
);

-- Eventos do inspector (já sanitizados antes de gravar).
create table mcp_events (
  id           bigint generated always as identity primary key,
  request_id   uuid not null,                   -- agrupa as etapas de uma chamada
  tool_name    text,
  step         text not null check (step in ('received', 'validated', 'processed', 'responded', 'error')),
  detail       jsonb not null default '{}',
  duration_ms  int,
  client_label text,                            -- ex.: 'Claude', 'ChatGPT' (ver "Identificação do cliente MCP")
  created_at   timestamptz not null default now()
);

-- Agenda pública: só colunas públicas.
create view public_agenda as
  select id, professional_id, service_id, starts_at, ends_at, status, public_alias
  from appointments
  where status <> 'cancelled';
```

### Row Level Security

- RLS habilitado em **todas** as tabelas.
- Papel `anon` (front): apenas `SELECT` em `services`, `professionals`, `professional_services`, `working_hours`, `closures`, `mcp_events` e na view `public_agenda`.
- `appointments`: **nenhuma** política para `anon`. Só o servidor acessa, pela sua conexão Postgres privilegiada (`DATABASE_URL`).
- `public_agenda` roda com privilégios do dono para expor apenas as colunas públicas. O linter do Supabase alerta sobre esse tipo de view; aqui é intencional e deve ser documentado no README.
- Nenhuma escrita parte do front.
- Privilégios: tudo revogado de `anon` e `authenticated` (inclusive, por default privileges, para tabelas futuras); `anon` recebe só `SELECT` nas tabelas e na view listadas acima. `authenticated` não recebe nada, porque o projeto não tem login. Os testes de `tests/db` verificam essas regras e reprovam se forem quebradas.

## 5. Servidor MCP

- Endpoint: `/mcp` (rewrite para `api/mcp.ts`; sem estado, sem autenticação; protocolo 2026-07-28 com fallback para Streamable HTTP da geração 2025).
- `instructions` do servidor: apresentar a barbearia, informar o fuso horário, orientar a IA a consultar disponibilidade antes de reservar, nunca inventar serviços ou preços, mostrar o código de reserva ao usuário (pedindo que ele guarde), oferecer o link da agenda ao vivo e avisar que a agenda reinicia todo dia às 3h (reserva para outro dia some antes de acontecer).

### Tools

| Tool | Entrada | Saída | Anotações |
|---|---|---|---|
| `list_services` | — | serviços com preço, duração e profissionais que fazem | readOnly |
| `list_professionals` | — | profissionais, serviços e horários de trabalho | readOnly |
| `check_availability` | `service_id`, `date` (YYYY-MM-DD), `professional_id?` | horários livres por profissional | readOnly |
| `book_appointment` | `service_id`, `start` (ISO 8601), `professional_id?`, `client_name?` | `code`, reserva, `watch_url` | — |
| `get_appointment` | `code` | reserva | readOnly |
| `reschedule_appointment` | `code`, `new_start`, `professional_id?` | reserva atualizada | — |
| `cancel_appointment` | `code` | confirmação | destructive |

- Todas as entradas validadas com `zod`, com limites de tamanho.
- Respostas com conteúdo estruturado (JSON) e um texto curto legível.
- `watch_url`: link da página pública destacando a reserva.

### Erros

Resultado com `isError: true` e conteúdo estruturado `{ code, message, suggestions? }`. Códigos:

`INVALID_INPUT`, `SERVICE_NOT_FOUND`, `PROFESSIONAL_NOT_FOUND`, `PROFESSIONAL_DOES_NOT_OFFER_SERVICE`, `OUTSIDE_WORKING_HOURS`, `SLOT_UNAVAILABLE` (com sugestões), `TOO_SOON`, `TOO_FAR_AHEAD`, `CHANGE_WINDOW_PASSED`, `BOOKING_LIMIT_REACHED`, `DAILY_CAPACITY_REACHED`, `RATE_LIMITED`, `APPOINTMENT_NOT_FOUND`, `INTERNAL_ERROR` (falha inesperada, como banco fora do ar; detalhe só no log do servidor).

`OUTSIDE_WORKING_HOURS` também traz sugestões. A validação de entrada é feita pela própria tool com o mesmo schema zod anunciado em `tools/list`, para que `INVALID_INPUT` volte estruturado (quando o SDK valida sozinho, o erro volta só como texto).

As mensagens nunca expõem detalhes internos (SQL, stack trace).

### Resource e prompt

- Resource `salon://info`: endereço fictício, horário de funcionamento e políticas (cancelamento, antecedência).
- Prompt `agendar_horario` (argumento opcional: serviço): conduz a conversa de agendamento.

Como funcionam (fase 3):

- `salon://info` é Markdown montado a cada leitura: o horário de cada dia da semana vem do banco (do primeiro início ao último fim dos profissionais ativos) e as políticas, de `rules.ts`. O texto nunca diverge do que as tools aplicam. Falha ao ler (banco fora do ar) responde erro genérico; o detalhe vai só para o log.
- A leitura do resource não conta no rate limit (seção 8 conta chamadas de tool): lê os mesmos dados públicos que a página já lê direto do Supabase.
- `agendar_horario` devolve uma mensagem do usuário: o pedido (com o serviço, se veio) e os passos que a IA deve seguir (consultar serviços e disponibilidade, resumir e esperar o ok antes de reservar, mostrar o código e o link da agenda). O serviço é texto livre de até 80 caracteres; vazio vale como ausente.

## 6. Inspector ao vivo

Cada chamada de tool gera um `request_id` e registra etapas em `mcp_events`, emitidas também via Broadcast:

1. **received**: nome da tool e argumentos sanitizados (`client_name` removido, código de reserva mascarado).
2. **validated**: lista das regras verificadas, cada uma com resultado (ex.: "profissional faz o serviço ✓", "horário livre ✗").
3. **processed**: resumo do resultado (reserva criada, conflito, sugestões).
4. **responded** ou **error**: status e tempo total.

Nunca exibir IP, `ip_hash`, código de reserva completo nem nome do cliente.

Como os eventos são gravados (fase 2):

- Todas as etapas de uma chamada vão ao banco numa única escrita, no fim da chamada e antes da resposta. Cada etapa guarda o próprio horário e o tempo desde o início, para a página revelar uma a uma. Se a gravação falhar, a tool responde normalmente e o erro fica só no log.
- Argumentos: só passam valores no formato que a tool espera (ids, datas, horários). Qualquer outro valor aparece como `•••`, porque pode ser texto livre digitado pelo visitante. Argumentos que as tools não recebem são descartados, e o evento informa só quantos foram. O código de reserva mostra os 2 primeiros caracteres (`R1•••-•••••`).
- Regras verificadas: a primeira é sempre a validação da entrada; as seguintes vêm do domínio (reservar, remarcar, cancelar, consultar).
- Rótulo do cliente: só nomes conhecidos aparecem (Claude, Claude Code, ChatGPT, Cursor, VS Code, Windsurf, Gemini, Zed, MCP Inspector); qualquer outro vira "Cliente MCP". O nome é autodeclarado, e a página é pública.

## 7. Página pública

- Site simples da barbearia: serviços e preços, profissionais.
- Agenda do dia em colunas por profissional, atualizada ao vivo (horários piscam ao serem ocupados ou liberados).
- Feed curto: "Cliente #4821 marcou Corte + Barba com o Rafael às 16h".
- Painel do inspector com as chamadas recentes.
- Seção "Teste com a sua IA": URL do MCP com botão de copiar, passo a passo para Claude, ChatGPT e Cursor, e prompts de exemplo.

## 8. Segurança

- Validação estrita de toda entrada (zod), com limites de tamanho e de formato.
- Rate limit por IP, guardado no Redis, contando chamadas de tool (não o handshake): 30 chamadas por minuto e 10 escritas por hora; IPs de plataformas de IA (seção 2), que representam muitos visitantes, 120 chamadas por minuto e 40 escritas por hora. A recusa (`RATE_LIMITED`) diz em quantos segundos tentar de novo; o inspector mostra só a primeira recusa de cada IP por janela. Redis fora do ar ou lento (mais de 1 s): a chamada passa e o servidor registra no log; os limites de negócio continuam no Postgres.
- Limites de negócio: 2 reservas ativas por IP (exceto IPs de plataformas de IA, seção 2) e teto de 70% de ocupação diária (somando visitantes e reservas fictícias; sempre sobram 30% livres para o próximo visitante), verificados no Postgres.
- IP armazenado apenas como hash com salt secreto, e só para os limites.
- Código de reserva armazenado só como hash.
- Nenhum texto livre de visitante exibido publicamente.
- Credenciais do banco e demais segredos apenas em variáveis de ambiente do servidor. O servidor não usa chave do Supabase: o Broadcast sai do próprio banco (seção 2).
- RLS conforme a seção 4, e em `realtime.messages`: `anon` só lê (ouve) os tópicos `agenda` e `inspector`, e não tem política de escrita.
- Endpoint do cron protegido por segredo (`CRON_SECRET`).
- Limite de tamanho do corpo das requisições.

### Variáveis de ambiente

Nunca no repositório. Localmente em `.env.local` (ignorado pelo git); em produção, no painel da Vercel.

| Variável | Onde | Fase |
|---|---|---|
| `DATABASE_URL` | servidor | 1 (local: Supabase local, sem segredo; produção: pooler em modo transaction) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | front (pública por design, protegida pelo RLS) | 2 |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (criadas pela integração da Upstash; o servidor recusa rodar na Vercel sem elas) | servidor | 3 |
| `IP_HASH_SALT`, `CRON_SECRET` | servidor | 3 |

O `watch_url` usa a variável de sistema `VERCEL_PROJECT_PRODUCTION_URL`, que a Vercel injeta sozinha.

## 9. Cron diário

Executa por volta das 03:00 de Brasília (06:00 UTC):

1. Remove reservas de origem `visitor`.
2. Recria as reservas fictícias (`seed`) para os próximos dias.
3. Marca como `completed` as reservas que já passaram.
4. Apaga `mcp_events` com mais de 7 dias.

Como funciona (fase 3):

- Vercel Cron com `0 6 * * *` no `vercel.json`. No plano Hobby roda uma vez por dia, em algum momento dentro dessa hora. A Vercel chama `GET /api/cron/reset` com `Authorization: Bearer <CRON_SECRET>`; sem o segredo, a resposta é 401 e o banco nem é tocado.
- As reservas fictícias cobrem a janela de reserva (hoje e os 14 dias seguintes). Uma função pura as sorteia com semente na data: o mesmo dia gera sempre as mesmas reservas, então cada execução só acrescenta o novo último dia, e rodar duas vezes não muda nada. Elas seguem as regras de um visitante (serviço que o profissional faz, expediente, grade de 15 minutos, bloqueios), têm apelido `Cliente #NNNN` como o de um visitante e não têm código: ninguém consegue ver, remarcar ou cancelar uma delas.
- Tudo numa transação, que começa travando as escritas em `appointments` (leituras continuam): uma reserva feita no meio da limpeza espera e depois planeja sobre a agenda nova.

## 10. Testes

- Unitários (Vitest) para as regras de domínio: cálculo de disponibilidade, antecedências, fuso horário, sugestões de horários.
- Integração contra Supabase local (Docker Engine no WSL): **teste de concorrência** disparando várias reservas simultâneas para o mesmo horário e verificando que exatamente uma é aceita.
- Tools do MCP testadas com o MCP Inspector e com um cliente do SDK em testes automatizados.

## 11. Estrutura de pastas (proposta)

```
/api
  mcp.ts                 # endpoint MCP
  cron/reset.ts          # cron diário
/server
  domain/                # regras de negócio puras (sem banco, sem HTTP)
  db/                    # acesso ao banco
  mcp/                   # tools, resources, prompts, instructions
  events/                # inspector e broadcast
  security/              # rate limit, hashing, sanitização
/src                     # front (Vite + React)
/supabase
  migrations/
  seed.sql
/tests
/docs
  SPEC.md                # este arquivo
vercel.json
```

## 12. Fases

### Fase 1: Núcleo
- [x] Projeto criado (Vite + TS + funções da Vercel) e Supabase configurado
- [x] Migrations do modelo de dados e RLS
- [x] Seed com serviços, profissionais e horários
- [x] Regras de domínio com testes unitários
- [x] Tools do MCP funcionando localmente
- [x] Teste de concorrência passando
- [x] Deploy na Vercel e teste com Claude e ChatGPT

### Fase 2: Vitrine
- [x] Página da barbearia com agenda ao vivo
- [x] Registro de eventos e inspector ao vivo
- [x] Seção "Teste com a sua IA"

### Fase 3: Proteções e acabamento
- [x] Rate limit e limites de negócio
- [x] Cron diário
- [x] Resource e prompt do MCP
- [ ] README com arquitetura, decisões e ameaças consideradas

## 13. Decisões em aberto

Nenhuma no momento.

Decididas em 2026-11-12 e movidas para a seção 2: nome, idioma, acesso ao banco, armazenamento do rate limit, identificação do cliente MCP, versões das dependências do MCP e identidade visual.

## 14. Fora do escopo (por enquanto)

- Login, pagamento e notificações por e-mail.
- Painel administrativo.
- Integração com Google Calendar.
- Assistente "Pergunte sobre mim" no portfólio (projeto futuro, separado).
