-- Dados fixos da MCP Barber Shop: catálogo, equipe, expediente e bloqueios.
-- Aplicado pelo `supabase db reset` depois das migrations. Reservas fictícias não ficam aqui:
-- dependem da data de hoje e são recriadas pelo cron diário (fase 3).

insert into services (id, name, description, duration_min, price_cents) values
  ('corte-masculino', 'Corte masculino', 'Corte na tesoura ou na máquina, com lavagem e finalização.',  30,  5000),
  ('corte-infantil',  'Corte infantil',  'Para crianças de até 12 anos.',                               30,  4000),
  ('barba',           'Barba',           'Barba desenhada na navalha, com toalha quente.',              30,  4000),
  ('corte-e-barba',   'Corte + barba',   'Corte masculino e barba completa no mesmo horário.',           60,  8000),
  ('pezinho',         'Pezinho',         'Acabamento do contorno entre um corte e outro.',               15,  2000),
  ('sobrancelha',     'Sobrancelha',     'Limpeza e alinhamento na navalha.',                            15,  2000),
  ('barboterapia',    'Barboterapia',    'Barba com esfoliação, toalha quente e hidratação.',            45,  7000),
  ('platinado',       'Platinado',       'Descoloração completa com matização. Reserve a tarde.',       120, 18000);

insert into professionals (id, name, bio) values
  ('rafael', 'Rafael', 'Barbeiro há 12 anos, especialista em cortes clássicos e barba na navalha.'),
  ('bruno',  'Bruno',  'Cuida da barba do começo ao fim: desenho, barboterapia e acabamento.'),
  ('diego',  'Diego',  'Cortes modernos, degradês e coloração. É quem faz o platinado da casa.'),
  ('lucas',  'Lucas',  'O mais novo da equipe, paciente com a criançada e rápido no acabamento.');

-- Nem todo profissional faz todo serviço.
insert into professional_services (professional_id, service_id) values
  ('rafael', 'corte-masculino'), ('rafael', 'barba'), ('rafael', 'corte-e-barba'),
  ('rafael', 'barboterapia'),    ('rafael', 'pezinho'), ('rafael', 'sobrancelha'),
  ('bruno',  'corte-masculino'), ('bruno',  'barba'), ('bruno',  'corte-e-barba'),
  ('bruno',  'barboterapia'),    ('bruno',  'pezinho'),
  ('diego',  'corte-masculino'), ('diego',  'corte-infantil'), ('diego', 'platinado'),
  ('diego',  'pezinho'),         ('diego',  'sobrancelha'),
  ('lucas',  'corte-masculino'), ('lucas',  'corte-infantil'), ('lucas', 'pezinho'),
  ('lucas',  'sobrancelha');

-- Expediente por dia da semana (0 = domingo). Dois intervalos no mesmo dia = pausa para o almoço.
-- A barbearia não abre aos domingos.
insert into working_hours (professional_id, weekday, start_time, end_time)
select 'rafael', weekday, start_time, end_time
from generate_series(2, 6) as weekday,                                    -- terça a sábado
     (values (time '09:00', time '12:00'), (time '13:00', time '19:00')) as shift(start_time, end_time)
union all
select 'bruno', weekday, start_time, end_time
from generate_series(2, 5) as weekday,                                    -- terça a sexta
     (values (time '10:00', time '13:00'), (time '14:00', time '20:00')) as shift(start_time, end_time)
union all
select 'bruno', 6, time '08:00', time '14:00'                             -- sábado, sem pausa
union all
select 'diego', weekday, start_time, end_time
from generate_series(1, 5) as weekday,                                    -- segunda a sexta
     (values (time '11:00', time '15:00'), (time '16:00', time '20:00')) as shift(start_time, end_time)
union all
select 'lucas', weekday, start_time, end_time
from unnest(array[1, 3, 4, 5, 6]) as weekday,                             -- folga às terças
     (values (time '09:00', time '12:00'), (time '13:00', time '18:00')) as shift(start_time, end_time);

-- Feriados nacionais: a barbearia inteira fecha o dia todo, no horário de Brasília.
insert into closures (professional_id, starts_at, ends_at, reason)
select null,
       day::timestamp at time zone 'America/Sao_Paulo',
       (day + 1)::timestamp at time zone 'America/Sao_Paulo',
       'Feriado: ' || name
from (values
  (date '2026-11-15', 'Proclamação da República'),
  (date '2026-11-20', 'Dia da Consciência Negra'),
  (date '2026-12-25', 'Natal'),
  (date '2027-01-01', 'Confraternização Universal'),
  (date '2027-03-26', 'Sexta-feira Santa'),
  (date '2027-04-21', 'Tiradentes'),
  (date '2027-05-01', 'Dia do Trabalho'),
  (date '2027-09-07', 'Independência do Brasil'),
  (date '2027-10-12', 'Nossa Senhora Aparecida'),
  (date '2027-11-02', 'Finados'),
  (date '2027-11-15', 'Proclamação da República'),
  (date '2027-11-20', 'Dia da Consciência Negra'),
  (date '2027-12-25', 'Natal')
) as holiday(day, name);

-- Bloqueio de um profissional só.
insert into closures (professional_id, starts_at, ends_at, reason) values
  ('rafael',
   date '2027-01-04'::timestamp at time zone 'America/Sao_Paulo',
   date '2027-01-18'::timestamp at time zone 'America/Sao_Paulo',
   'Férias');
