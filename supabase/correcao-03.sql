-- ============================================================
-- Correção 03 — atribuir todos os leads existentes a você
--
-- Rode no SQL Editor do Supabase, um passo de cada vez.
-- ============================================================

-- PASSO 1: confira qual é o seu usuário e copie o e-mail exato.
select id, email, created_at from auth.users order by created_at;


-- PASSO 2: troque o e-mail abaixo pelo SEU e rode o bloco inteiro.
--
-- O "disable trigger" é obrigatório: o gatilho de autoria grava auth.uid(),
-- que é nulo quando a alteração vem do SQL Editor. Sem desligá-lo, este
-- update apagaria o "alterado por" de todos os leads.
begin;

alter table leads disable trigger leads_alteracao;

update leads
   set dono         = (select id from auth.users where email = 'SEU_EMAIL_AQUI'),
       alterado_por = (select id from auth.users where email = 'SEU_EMAIL_AQUI'),
       alterado_em  = coalesce(alterado_em, now());

alter table leads enable trigger leads_alteracao;

commit;


-- PASSO 3: confira o resultado. Deve mostrar seu nome e o total.
select p.nome,
       u.email,
       count(*) as leads
  from leads l
  join auth.users u on u.id = l.dono
  left join perfis p on p.id = l.dono
 group by p.nome, u.email;
