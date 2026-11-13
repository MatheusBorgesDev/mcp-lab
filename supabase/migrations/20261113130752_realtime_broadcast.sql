-- Atualizações ao vivo (docs/SPEC.md, seção 2): o próprio banco emite cada mudança por Broadcast, na mesma
-- transação da escrita (realtime.send grava em realtime.messages; o Realtime entrega depois do commit, e um
-- rollback não entrega nada). Canais privados: o visitante (anon) só ouve; em canal público, quem tem a chave
-- pública poderia transmitir reservas falsas para todos.

-- 1. Quem ouve: anon só recebe Broadcast dos tópicos públicos. Nenhuma política de INSERT: ninguém transmite
--    pelo navegador. realtime.topic() é o tópico do canal que o visitante tenta abrir.
create policy "anon receives the public broadcasts"
  on realtime.messages for select to anon
  using (realtime.messages.extension = 'broadcast' and realtime.topic() in ('agenda', 'inspector'));

-- 2. Agenda: cada reserva criada, alterada ou apagada, só com as colunas da view public_agenda (nunca nome do
--    cliente, hash do código ou do IP). O front trata status 'cancelled' e op 'delete' como horário liberado.
create function public.broadcast_appointment_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  changed public.appointments := case tg_op when 'DELETE' then old else new end;
begin
  perform realtime.send(
    jsonb_build_object(
      'op', lower(tg_op),
      'appointment', jsonb_build_object(
        'id', changed.id,
        'professional_id', changed.professional_id,
        'service_id', changed.service_id,
        'starts_at', changed.starts_at,
        'ends_at', changed.ends_at,
        'status', changed.status,
        'public_alias', changed.public_alias
      )
    ),
    'appointment',
    'agenda',
    true
  );
  return null;
end;
$$;

create trigger appointments_broadcast
  after insert or update or delete on public.appointments
  for each row execute function public.broadcast_appointment_change();

-- 3. Inspector: as etapas de uma chamada de tool são gravadas num único insert (server/db/events.ts), e saem
--    numa única mensagem. As linhas já são públicas (anon lê mcp_events).
create function public.broadcast_mcp_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from inserted) then
    perform realtime.send(
      jsonb_build_object('events', (select jsonb_agg(to_jsonb(e) order by e.id) from inserted e)),
      'call',
      'inspector',
      true
    );
  end if;
  return null;
end;
$$;

create trigger mcp_events_broadcast
  after insert on public.mcp_events
  referencing new table as inserted
  for each statement execute function public.broadcast_mcp_events();

-- Funções de gatilho não são chamáveis pela API; mesmo assim, ninguém além do dono as executa.
revoke all on function public.broadcast_appointment_change() from public, anon, authenticated;
revoke all on function public.broadcast_mcp_events() from public, anon, authenticated;
