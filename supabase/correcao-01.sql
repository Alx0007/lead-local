-- ============================================================
-- Correção 01 — fechar o contador de envios
--
-- A versão anterior de contar_envio() era "security definer", o que a
-- fazia rodar por cima das políticas de acesso. Como o Postgres libera
-- execução de função para todos por padrão, dava para chamá-la sem estar
-- logado e inflar o teto diário de envios da equipe.
--
-- Sem "security definer" a função respeita a política normal: só quem
-- está autenticado escreve em envios.
-- ============================================================

create or replace function contar_envio()
returns integer language plpgsql as $$      -- sem security definer
declare total integer;
begin
  insert into envios (dia, n) values (current_date, 1)
    on conflict (dia) do update set n = envios.n + 1
    returning n into total;
  return total;
end $$;

revoke execute on function contar_envio() from public, anon;
grant  execute on function contar_envio() to authenticated;

-- apaga a linha criada pela chamada de teste
delete from envios where dia = current_date;
