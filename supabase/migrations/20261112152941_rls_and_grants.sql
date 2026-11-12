-- Row Level Security e privilégios (docs/SPEC.md, seção 4).
-- O front usa o papel anon e só lê. Toda escrita vem do servidor, pela conexão Postgres privilegiada.

-- 1. RLS em todas as tabelas.
alter table services              enable row level security;
alter table professionals         enable row level security;
alter table professional_services enable row level security;
alter table working_hours         enable row level security;
alter table closures              enable row level security;
alter table appointments          enable row level security;
alter table mcp_events            enable row level security;

-- 2. Privilégios do zero para os papéis públicos.
-- O Supabase concede tudo a anon e authenticated por padrão; aqui nada é concedido sem ser pedido.
-- Este projeto não tem login, então authenticated não recebe nada.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Tabelas, sequências e funções criadas no futuro também nascem fechadas.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- 3. Leitura pública: catálogo, bloqueios, eventos do inspector e a agenda pública.
-- appointments fica de fora: nenhum privilégio e nenhuma política para anon.
grant select on services, professionals, professional_services, working_hours, closures, mcp_events
  to anon;
grant select on public_agenda to anon;

create policy "anon reads services"              on services              for select to anon using (true);
create policy "anon reads professionals"         on professionals         for select to anon using (true);
create policy "anon reads professional_services" on professional_services for select to anon using (true);
create policy "anon reads working_hours"         on working_hours         for select to anon using (true);
create policy "anon reads closures"              on closures              for select to anon using (true);
create policy "anon reads mcp_events"            on mcp_events            for select to anon using (true);
