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
- **Idioma**: conteúdo da barbearia e página pública em pt-BR (serviços, preços em R$, `salon://info`). A camada que a IA lê fica em inglês: descrições das tools, `instructions` do servidor e `message` dos erros. Identificadores de código sempre em inglês. A IA do visitante responde no idioma dele de qualquer forma.
- **Stack**:
  - Front: Vite + React + TypeScript (SPA, sem SSR).
  - Backend: Vercel Functions (Node 22) no mesmo repositório, pasta `/api`, com a assinatura Web padrão (`export default { fetch }`). Código do servidor usa imports relativos: as funções da Vercel não aceitam path aliases do tsconfig.
  - MCP: `mcp-handler` + SDK oficial do MCP v2 (`@modelcontextprotocol/server`) + `zod`. Protocolo 2026-07-28 (sem estado) servido nativamente, com fallback de Streamable HTTP sem estado para clientes da geração 2025, no mesmo handler. Endpoint público `/mcp`, por rewrite no `vercel.json` para `api/mcp.ts`.
  - Versões fixadas (sem `^`): `mcp-handler` 2.3.1, `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/client` 2.4.0 (só testes), `zod` 4.6.7. Conferidas no npm em 2026-11-12. O `mcp-handler` 2.x exige o SDK v2; o pacote antigo `@modelcontextprotocol/sdk` 1.x não é usado.
  - Acesso ao banco: **SQL direto** com o driver `postgres` (postgres.js), sem ORM. As garantias do projeto moram no banco (exclusion constraint, view, RLS), que um ORM não modela bem. Linhas lidas são validadas com `zod` em `server/db`. Migrations em SQL pela CLI do Supabase.
  - Conexão do servidor: `DATABASE_URL` pelo pooler do Supabase em modo transaction (porta 6543), adequado a funções serverless; prepared statements desligados.
  - Banco e tempo real: Supabase (PostgreSQL + Realtime).
  - Rate limit: Redis gerenciado (Upstash, plano gratuito, pelo Marketplace da Vercel). Só o limite por tempo vai para o Redis; os limites de negócio (reservas ativas por IP, ocupação diária) ficam no Postgres, verificados na mesma transação da reserva.
  - Hospedagem: planos gratuitos da Vercel e do Supabase.
  - Ferramentas: pnpm; Supabase local sobre Docker Engine instalado direto no WSL, subindo só os serviços que cada fase usa.
- **Identificação do cliente MCP** (`client_label` do inspector): `clientInfo` do envelope `_meta` de cada requisição (protocolo 2026-07-28); para clientes da geração 2025, o header `User-Agent`; sem nenhum dos dois, "Cliente MCP". O valor é autodeclarado: serve só para exibição, nunca para regra ou segurança.
- **Tempo real**: carga inicial lida pelo front direto no Supabase (somente leitura, via RLS). Atualizações ao vivo via **Supabase Realtime Broadcast**, emitidas pelo servidor depois de cada escrita, contendo apenas dados públicos e sanitizados. (Postgres Changes não serve aqui porque a agenda pública é exposta por uma view e não deve vazar colunas privadas.)
- **Cron diário** (Vercel Cron): reseta a agenda, recria reservas fictícias e limpa eventos antigos. Como efeito colateral, mantém o projeto Supabase ativo (o plano gratuito pausa após 7 dias sem atividade).

## 3. Regras de negócio

| Regra | Valor inicial |
|---|---|
| Fuso horário da barbearia | `America/Sao_Paulo` |
| Granularidade dos horários | 15 minutos |
| Antecedência mínima para marcar | 2 horas |
| Máximo de dias à frente para marcar | 14 dias |
| Antecedência mínima para cancelar ou remarcar | 2 horas |
| Reservas ativas por visitante (IP) | 2 |
| Ocupação máxima por visitantes, por dia | 70% dos horários |
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
- `instructions` do servidor: apresentar a barbearia, informar o fuso horário, orientar a IA a consultar disponibilidade antes de reservar, nunca inventar serviços ou preços, mostrar o código de reserva ao usuário (pedindo que ele guarde) e oferecer o link da agenda ao vivo.

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

`INVALID_INPUT`, `SERVICE_NOT_FOUND`, `PROFESSIONAL_NOT_FOUND`, `PROFESSIONAL_DOES_NOT_OFFER_SERVICE`, `OUTSIDE_WORKING_HOURS`, `SLOT_UNAVAILABLE` (com sugestões), `TOO_SOON`, `TOO_FAR_AHEAD`, `CHANGE_WINDOW_PASSED`, `BOOKING_LIMIT_REACHED`, `DAILY_CAPACITY_REACHED`, `RATE_LIMITED`, `APPOINTMENT_NOT_FOUND`.

As mensagens nunca expõem detalhes internos (SQL, stack trace).

### Resource e prompt

- Resource `salon://info`: endereço fictício, horário de funcionamento e políticas (cancelamento, antecedência).
- Prompt `agendar_horario` (argumento opcional: serviço): conduz a conversa de agendamento.

## 6. Inspector ao vivo

Cada chamada de tool gera um `request_id` e registra etapas em `mcp_events`, emitidas também via Broadcast:

1. **received**: nome da tool e argumentos sanitizados (`client_name` removido, código de reserva mascarado).
2. **validated**: lista das regras verificadas, cada uma com resultado (ex.: "profissional faz o serviço ✓", "horário livre ✗").
3. **processed**: resumo do resultado (reserva criada, conflito, sugestões).
4. **responded** ou **error**: status e tempo total.

Nunca exibir IP, `ip_hash`, código de reserva completo nem nome do cliente.

## 7. Página pública

- Site simples da barbearia: serviços e preços, profissionais.
- Agenda do dia em colunas por profissional, atualizada ao vivo (horários piscam ao serem ocupados ou liberados).
- Feed curto: "Cliente #4821 marcou Corte + Barba com o Rafael às 16h".
- Painel do inspector com as chamadas recentes.
- Seção "Teste com a sua IA": URL do MCP com botão de copiar, passo a passo para Claude, ChatGPT e Cursor, e prompts de exemplo.

## 8. Segurança

- Validação estrita de toda entrada (zod), com limites de tamanho e de formato.
- Rate limit por IP, guardado no Redis (valor inicial: 30 chamadas por minuto e 10 escritas por hora).
- Limites de negócio: 2 reservas ativas por IP e teto de 70% de ocupação diária por visitantes, verificados no Postgres.
- IP armazenado apenas como hash com salt secreto, e só para os limites.
- Código de reserva armazenado só como hash.
- Nenhum texto livre de visitante exibido publicamente.
- Credenciais do banco, chave secreta do Supabase e demais segredos apenas em variáveis de ambiente do servidor.
- RLS conforme a seção 4.
- Endpoint do cron protegido por segredo (`CRON_SECRET`).
- Limite de tamanho do corpo das requisições.

### Variáveis de ambiente

Nunca no repositório. Localmente em `.env.local` (ignorado pelo git); em produção, no painel da Vercel.

| Variável | Onde | Fase |
|---|---|---|
| `DATABASE_URL` | servidor | 1 (local: Supabase local, sem segredo; produção: pooler em modo transaction) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | servidor, para o Broadcast | 2 |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | front (pública por design, protegida pelo RLS) | 2 |
| Variáveis do Redis criadas pela integração da Upstash | servidor | 3 |
| `IP_HASH_SALT`, `CRON_SECRET` | servidor | 3 |

O `watch_url` usa a variável de sistema `VERCEL_PROJECT_PRODUCTION_URL`, que a Vercel injeta sozinha.

## 9. Cron diário

Executa por volta das 03:00 de Brasília (06:00 UTC):

1. Remove reservas de origem `visitor`.
2. Recria as reservas fictícias (`seed`) para os próximos dias.
3. Marca como `completed` as reservas que já passaram.
4. Apaga `mcp_events` com mais de 7 dias.

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
- [ ] Regras de domínio com testes unitários
- [ ] Tools do MCP funcionando localmente
- [ ] Teste de concorrência passando
- [ ] Deploy na Vercel e teste com Claude e ChatGPT

### Fase 2: Vitrine
- [ ] Página da barbearia com agenda ao vivo
- [ ] Registro de eventos e inspector ao vivo
- [ ] Seção "Teste com a sua IA"

### Fase 3: Proteções e acabamento
- [ ] Rate limit e limites de negócio
- [ ] Cron diário
- [ ] Resource e prompt do MCP
- [ ] README com arquitetura, decisões e ameaças consideradas

## 13. Decisões em aberto

- Identidade visual da MCP Barber Shop (cores, logo, tipografia): decidir antes da fase 2.

Decididas em 2026-11-12 e movidas para a seção 2: nome, idioma, acesso ao banco, armazenamento do rate limit, identificação do cliente MCP e versões das dependências do MCP.

## 14. Fora do escopo (por enquanto)

- Login, pagamento e notificações por e-mail.
- Painel administrativo.
- Integração com Google Calendar.
- Assistente "Pergunte sobre mim" no portfólio (projeto futuro, separado).
