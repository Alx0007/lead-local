-- ============================================================
-- Correção 02 — dono do lead e nomes visíveis para a equipe
-- Rode no SQL Editor do Supabase.
-- ============================================================

-- ---------- DONO DO LEAD ----------
-- Todo mundo vê tudo, mas cada lead tem um responsável. É o que evita
-- duas pessoas abordarem a mesma empresa.
alter table leads add column if not exists dono uuid references auth.users(id);

-- quem criou o lead vira dono dos que já existem
update leads set dono = criado_por where dono is null;

create index if not exists leads_dono_idx on leads(dono);

-- ---------- NOMES VISÍVEIS ----------
-- A política anterior deixava cada um ver só o próprio perfil, então o
-- app não conseguia traduzir o identificador de quem alterou num nome:
-- apareceria "alterado por 3f2a-..." em vez de "alterado por Alexandre".
drop policy if exists "proprio perfil" on perfis;

-- ler: todo mundo da equipe, para resolver nome de quem mexeu e de quem é dono
create policy "equipe le perfis" on perfis for select to authenticated using (true);

-- escrever: cada um só no seu
create policy "escreve proprio perfil" on perfis for insert to authenticated
  with check (id = auth.uid());
create policy "atualiza proprio perfil" on perfis for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
