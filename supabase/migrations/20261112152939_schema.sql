-- Modelo de dados da MCP Barber Shop (docs/SPEC.md, seção 4).
-- Horários sempre em timestamptz; a conversão para America/Sao_Paulo fica na borda da aplicação.

-- btree_gist permite combinar "=" em text com sobreposição de intervalos numa exclusion constraint.
create extension if not exists btree_gist with schema extensions;

create table services (
  id           text primary key,              -- slug, ex.: 'corte-masculino'
  name         text not null,
  description  text,
  duration_min int  not null check (duration_min > 0 and duration_min % 15 = 0),
  price_cents  int  not null check (price_cents >= 0),
  active       boolean not null default true
);

create table professionals (
  id     text primary key,                      -- slug
  name   text not null,
  bio    text,
  active boolean not null default true
);

create table professional_services (
  professional_id text references professionals(id),
  service_id      text references services(id),
  primary key (professional_id, service_id)
);

-- Vários intervalos no mesmo dia representam o almoço.
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
  -- A garantia central: o mesmo profissional nunca tem duas reservas ativas sobrepostas.
  -- O intervalo é [início, fim), então reservas encostadas (10:00–10:30 e 10:30–11:00) convivem.
  constraint appointments_no_overlap exclude using gist (
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
  client_label text,                            -- ex.: 'Claude', 'ChatGPT'
  created_at   timestamptz not null default now()
);

-- Agenda pública: só colunas públicas.
-- security_invoker = false de propósito: a view lê appointments com os privilégios do dono, e o papel
-- anon (front) só enxerga estas colunas. O linter do Supabase alerta sobre isso; é intencional (SPEC, seção 4).
create view public_agenda with (security_invoker = false) as
  select id, professional_id, service_id, starts_at, ends_at, status, public_alias
  from appointments
  where status <> 'cancelled';

comment on view public_agenda is
  'Agenda pública sem colunas privadas. Roda com os privilégios do dono, de propósito (ver SPEC, seção 4).';
