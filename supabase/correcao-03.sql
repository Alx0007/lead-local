-- ============================================================
-- Correção 03 — atribuir todos os leads existentes ao Alexandre
--
-- Rode o bloco inteiro no SQL Editor do Supabase.
--
-- Usa o identificador direto em vez do e-mail. Comparar e-mail é
-- arriscado: o Postgres diferencia maiúscula de minúscula, e
-- 'Alexandre@clios.com' NÃO casa com 'alexandre@clios.com'. O select
-- devolveria nulo e o update deixaria todos os leads sem dono, calado.
-- ============================================================

do $$
declare
  eu uuid := '82be3a85-7c5f-444a-91c3-b3412f830fbe';   -- alexandre@clios.com
  n  integer;
begin
  -- trava de segurança: se o usuário não existir, nada é alterado
  if not exists (select 1 from auth.users where id = eu) then
    raise exception 'Usuário % não existe. Confira a lista de auth.users.', eu;
  end if;

  -- O gatilho de autoria grava auth.uid(), que é nulo quando a alteração
  -- vem do SQL Editor. Sem desligá-lo, este update apagaria o
  -- "alterado por" de todos os leads.
  alter table leads disable trigger leads_alteracao;

  update leads
     set dono         = eu,
         alterado_por = eu,
         alterado_em  = coalesce(alterado_em, now());
  get diagnostics n = row_count;

  alter table leads enable trigger leads_alteracao;

  raise notice '% leads atribuídos a alexandre@clios.com', n;
end $$;


-- Conferência: deve mostrar seu nome e o total.
select coalesce(p.nome, '(perfil ainda não salvo)') as nome,
       u.email,
       count(*) as leads
  from leads l
  join auth.users u on u.id = l.dono
  left join perfis p on p.id = l.dono
 group by p.nome, u.email;


-- Se aparecer alguma linha aqui, sobrou lead sem dono:
select count(*) as sem_dono from leads where dono is null;
