-- ============================================================
-- Lead Local — esquema do banco compartilhado (Supabase/Postgres)
--
-- Desenho para equipe pequena: duas pessoas, todo mundo vê tudo,
-- um número de WhatsApp só.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode.
-- ============================================================

-- ---------- FUNIL ----------
create table if not exists leads (
  id            text primary key,          -- mantém o id que o app já usa (goo-...)
  nome          text not null,
  categoria     text,
  nicho         text,                      -- termo buscado; é a chave do [link]
  phone         text,
  website       text,
  endereco      text,
  cidade        text,
  rating        numeric,
  reviews       integer,
  fonte         text,
  mapa          text,
  score         integer,
  faixa         text,
  motivos       jsonb,
  status        text not null default 'novo',
  valor         numeric default 0,
  data_fech     date,
  prox_contato  date,
  nota          text,
  criado_por    uuid references auth.users(id),
  criado_em     timestamptz default now(),
  alterado_por  uuid references auth.users(id),
  alterado_em   timestamptz default now()
);
create index if not exists leads_status_idx on leads(status);
create index if not exists leads_nicho_idx  on leads(nicho);

-- ---------- ACERVO DE LANDINGS ----------
create table if not exists landings (
  id           text primary key,
  nome         text not null,
  url          text,
  status       text default 'modelo',      -- modelo | proposta | entregue
  cor          text,
  cor2         text,
  estilo       text,
  tipografia   text,
  nichos       text[] default '{}',
  cliente_id   text references leads(id) on delete set null,
  nota         text,
  criada       date default current_date,
  alterado_por uuid references auth.users(id),
  alterado_em  timestamptz default now()
);
create index if not exists landings_nichos_idx on landings using gin(nichos);

-- ---------- CONFIGURAÇÃO DA EQUIPE (linha única) ----------
-- Chaves e ajustes que valem para os dois.
create table if not exists config (
  id          integer primary key default 1,
  serv        text,                        -- o que vocês vendem
  msg_padrao  text,
  google_key  text,
  uaz_url     text,
  uaz_token   text,
  uaz_int     integer default 60,
  uaz_lim     integer default 30,
  alterado_em timestamptz default now(),
  constraint config_linha_unica check (id = 1)
);
insert into config (id) values (1) on conflict (id) do nothing;

-- ---------- PERFIL DE CADA PESSOA ----------
-- O que NÃO é compartilhado: o nome que assina a mensagem.
create table if not exists perfis (
  id        uuid primary key references auth.users(id) on delete cascade,
  nome      text,
  portfolio text
);

-- ---------- TETO DE ENVIOS, COMPARTILHADO ----------
-- Crítico: o número do WhatsApp é um só. Se cada pessoa tivesse seu
-- contador, o número levaria o dobro de disparos e seria restringido.
create table if not exists envios (
  dia date primary key,
  n   integer not null default 0
);

-- Soma 1 e devolve o total do dia, numa operação atômica —
-- dois envios simultâneos não podem contar como um.
create or replace function contar_envio()
returns integer language plpgsql as $$
declare total integer;
begin
  insert into envios (dia, n) values (current_date, 1)
    on conflict (dia) do update set n = envios.n + 1
    returning n into total;
  return total;
end $$;

-- Postgres libera execução de função para todos por padrão. Sem isto,
-- daria para chamar a função sem login e inflar o teto de envios.
revoke execute on function contar_envio() from public, anon;
grant  execute on function contar_envio() to authenticated;

-- ---------- NÚMEROS SEM WHATSAPP, COMPARTILHADO ----------
create table if not exists sem_whatsapp (
  fone     text primary key,
  visto_em timestamptz default now()
);

-- ============================================================
-- SEGURANÇA
-- A chave pública do app fica visível no navegador. Isso é normal e
-- previsto, MAS só é seguro com as políticas abaixo: sem elas,
-- qualquer pessoa com a chave lê o banco inteiro.
-- "to authenticated" barra quem não fez login.
-- ============================================================
alter table leads        enable row level security;
alter table landings     enable row level security;
alter table config       enable row level security;
alter table perfis       enable row level security;
alter table envios       enable row level security;
alter table sem_whatsapp enable row level security;

-- Equipe pequena, todo mundo vê tudo: quem está logado lê e escreve.
do $$
declare t text;
begin
  foreach t in array array['leads','landings','config','envios','sem_whatsapp'] loop
    execute format(
      'create policy "equipe" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Cada um mexe só no próprio perfil (é o nome que assina a mensagem).
create policy "proprio perfil" on perfis for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- CARIMBO DE QUEM ALTEROU ----------
create or replace function marcar_alteracao()
returns trigger language plpgsql as $$
begin
  new.alterado_por := auth.uid();
  new.alterado_em  := now();
  return new;
end $$;

create trigger leads_alteracao    before insert or update on leads
  for each row execute function marcar_alteracao();
create trigger landings_alteracao before insert or update on landings
  for each row execute function marcar_alteracao();
