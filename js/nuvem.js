/* ==========================================================
   Lead Local — camada de nuvem (Supabase)

   Guarda a conexão, o login e as leituras/escritas no banco
   compartilhado. O app.js continua sem saber que existe rede:
   ele fala com o Store, e o Store fala com aqui.

   A chave abaixo é a PÚBLICA, feita para ficar no navegador.
   A segurança não vem de escondê-la e sim das políticas de
   acesso do banco: sem login, ela não lê nem escreve nada.
   ========================================================== */

"use strict";

const NUVEM_URL  = 'https://oznzbyajfrvipzxwoywf.supabase.co';
const NUVEM_KEY  = 'sb_publishable_Z_PLS63aALEmWU3qkHs1jA_A1fDZTfm';

const Nuvem = (() => {
  const sb = window.supabase.createClient(NUVEM_URL, NUVEM_KEY);
  let usuario = null;

  return {
    sb,
    get usuario(){ return usuario; },
    get logado(){ return !!usuario; },

    async sessao(){
      const { data } = await sb.auth.getSession();
      usuario = data.session ? data.session.user : null;
      return usuario;
    },

    async entrar(email, senha){
      const { data, error } = await sb.auth.signInWithPassword({email, password: senha});
      if(error) throw new Error(traduzirErroLogin(error.message));
      usuario = data.user;
      return usuario;
    },

    async sair(){
      await sb.auth.signOut();
      usuario = null;
    },

    /* ---- leitura de uma tabela inteira ---- */
    async ler(tabela){
      const { data, error } = await sb.from(tabela).select('*');
      if(error) throw new Error(error.message);
      return data || [];
    },

    /* ---- grava (insere ou atualiza) uma linha ---- */
    async gravar(tabela, linha){
      const { error } = await sb.from(tabela).upsert(linha);
      if(error) throw new Error(error.message);
    },

    async apagar(tabela, coluna, valor){
      const { error } = await sb.from(tabela).delete().eq(coluna, valor);
      if(error) throw new Error(error.message);
    },

    /* ---- contador de envios, compartilhado e atômico ----
       Dois envios ao mesmo tempo têm que contar como dois: quem
       resolve isso é a função no banco, não o navegador. */
    async contarEnvio(){
      const { data, error } = await sb.rpc('contar_envio');
      if(error) throw new Error(error.message);
      return data;
    },

    async enviosHoje(){
      const hoje = new Date().toISOString().slice(0,10);
      const { data, error } = await sb.from('envios').select('n').eq('dia', hoje).maybeSingle();
      if(error) throw new Error(error.message);
      return data ? data.n : 0;
    },

    /* ---- avisa quando o outro alterar algo ---- */
    escutar(tabela, aoMudar){
      return sb.channel('mud-' + tabela)
        .on('postgres_changes', {event:'*', schema:'public', table:tabela}, aoMudar)
        .subscribe();
    }
  };
})();

function traduzirErroLogin(m){
  const t = String(m||'');
  if(/Invalid login credentials/i.test(t)) return 'E-mail ou senha incorretos.';
  if(/Email not confirmed/i.test(t))       return 'Esta conta ainda não foi confirmada. Confirme no painel do Supabase.';
  if(/rate limit|too many/i.test(t))       return 'Tentativas demais. Espere um minuto.';
  if(/Failed to fetch|NetworkError/i.test(t)) return 'Sem conexão com o servidor.';
  return t;
}

/* ==========================================================
   Tradução entre o formato do app e o do banco.

   Os nomes divergem de propósito em dois pontos, e confundi-los
   corromperia dado:
     · lead.fonte    = origem do dado (Google Maps)
     · landing.fonte = tipografia da página -> coluna "tipografia"
   ========================================================== */

const Mapa = {
  leadParaBanco(l){
    return {
      id:l.id, nome:l.nome, categoria:l.categoria||null, nicho:l._nicho||null,
      phone:l.phone||null, website:l.website||null, endereco:l.endereco||null,
      cidade:l.cidade||null, rating:l.rating, reviews:l.reviews,
      fonte:l.fonte||null, mapa:l.mapa||null,
      score:l._p?l._p.score:null, faixa:l._p?l._p.faixa:null,
      motivos:l._p?l._p.motivos:null,
      status:l.status||'novo', valor:Number(l.valor)||0,
      data_fech:l.dataFech||null, prox_contato:l.proxContato||null,
      nota:l.nota||null, dono:l.dono||null
    };
  },
  leadDoBanco(r){
    const l = {
      id:r.id, nome:r.nome, categoria:r.categoria||'', _nicho:r.nicho||'',
      phone:r.phone||'', website:r.website||'', endereco:r.endereco||'',
      cidade:r.cidade||'', rating:r.rating, reviews:r.reviews,
      fonte:r.fonte||'', mapa:r.mapa||'',
      status:r.status||'novo', valor:Number(r.valor)||0,
      dataFech:r.data_fech||'', proxContato:r.prox_contato||'', nota:r.nota||'',
      dono:r.dono||'',
      _alteradoEm:r.alterado_em || '', _alteradoPor:r.alterado_por || ''
    };
    l._p = (r.score != null)
      ? {score:r.score, faixa:r.faixa, motivos:r.motivos||[]}
      : pontuar(l);
    return l;
  },
  landingParaBanco(x){
    return {
      id:x.id, nome:x.nome, url:x.url||null, status:x.status||'modelo',
      cor:x.cor||null, cor2:x.cor2||null, estilo:x.estilo||null,
      tipografia:x.fonte||null, nichos:x.nichos||[],
      cliente_id:x.clienteId||null, nota:x.nota||null, criada:x.criada||null
    };
  },
  landingDoBanco(r){
    return {
      id:r.id, nome:r.nome, url:r.url||'', status:r.status||'modelo',
      cor:r.cor||'', cor2:r.cor2||'', estilo:r.estilo||'',
      fonte:r.tipografia||'', nichos:r.nichos||[],
      clienteId:r.cliente_id||'', nota:r.nota||'', criada:r.criada||'',
      _alteradoEm:r.alterado_em || ''
    };
  }
};

/* ==========================================================
   Sincronização.

   O app continua trabalhando no localStorage, que é a cópia de
   trabalho — por isso funciona no celular sem sinal. Cada
   alteração entra numa fila e sobe quando houver conexão.

   Conflito resolve por horário: alteração que chega mais velha
   que a local não sobrescreve.
   ========================================================== */
const Sinc = (() => {
  let fila = [];
  try { fila = JSON.parse(localStorage.getItem('ll_fila') || '[]'); } catch(e){ fila = {}; }
  if(!Array.isArray(fila)) fila = [];

  let sombra = {};          // último estado conhecido, para mandar só o que mudou
  let subindo = false;
  let aoMudarStatus = () => {};

  const guardarFila = () => { try{ localStorage.setItem('ll_fila', JSON.stringify(fila)); }catch(e){} };

  const chaveDe = item => item.tabela + ':' + (item.linha ? (item.linha.id || item.linha.fone) : item.valor);

  function enfileirar(item){
    // cada registro entra uma vez só: a operação nova substitui a anterior.
    // Se algo foi editado e depois apagado, o que vale é o apagar.
    const k = chaveDe(item);
    const i = fila.findIndex(f => chaveDe(f) === k);
    if(i >= 0) fila[i] = item; else fila.push(item);
    guardarFila();
    aoMudarStatus();
    subir();
  }

  const enfileirarGravacao = (tabela, linha) => enfileirar({tabela, linha});
  const enfileirarRemocao  = (tabela, coluna, valor) => enfileirar({tabela, coluna, valor});

  async function subir(){
    if(subindo || !fila.length || !Nuvem.logado || !navigator.onLine) return;
    subindo = true;
    try{
      while(fila.length){
        const item = fila[0];
        if(item.linha) await Nuvem.gravar(item.tabela, item.linha);
        else           await Nuvem.apagar(item.tabela, item.coluna, item.valor);
        fila.shift(); guardarFila(); aoMudarStatus();
      }
    }catch(e){
      console.warn('[sinc] não consegui subir agora:', e.message);
    }finally{
      subindo = false; aoMudarStatus();
    }
  }

  return {
    get pendentes(){ return fila.length; },
    get online(){ return navigator.onLine; },
    aoMudar(fn){ aoMudarStatus = fn; },

    /* chamado pelo Store a cada gravação; manda só o que mudou de verdade */
    registrar(chave, valor){
      if(chave === 'll_crm'){
        Object.values(valor||{}).forEach(l=>{
          const linha = Mapa.leadParaBanco(l), txt = JSON.stringify(linha);
          if(sombra['l:'+l.id] !== txt){ sombra['l:'+l.id] = txt; enfileirarGravacao('leads', linha); }
        });
      }else if(chave === 'll_landings'){
        (valor||[]).forEach(x=>{
          const linha = Mapa.landingParaBanco(x), txt = JSON.stringify(linha);
          if(sombra['g:'+x.id] !== txt){ sombra['g:'+x.id] = txt; enfileirarGravacao('landings', linha); }
        });
      }else if(chave === 'll_semwa'){
        (valor||[]).forEach(f=>{
          if(!sombra['w:'+f]){ sombra['w:'+f] = 1; enfileirarGravacao('sem_whatsapp', {fone:f}); }
        });
      }
    },

    /* marca tudo como já conhecido, para não reenviar o que veio do banco */
    semear(crm, landings, semwa){
      sombra = {};
      Object.values(crm||{}).forEach(l=> sombra['l:'+l.id] = JSON.stringify(Mapa.leadParaBanco(l)));
      (landings||[]).forEach(x=> sombra['g:'+x.id] = JSON.stringify(Mapa.landingParaBanco(x)));
      (semwa||[]).forEach(f=> sombra['w:'+f] = 1);
    },

    /* Remoção precisa ser explícita: o registrar() só enxerga o que
       existe, então apagar algo localmente jamais chegaria ao banco. */
    remover(tabela, coluna, valor){
      delete sombra[(tabela === 'leads' ? 'l:' : tabela === 'landings' ? 'g:' : 'w:') + valor];
      enfileirarRemocao(tabela, coluna, valor);
    },

    /* força o envio do que estiver parado (usado na migração e ao reconectar) */
    async esvaziar(){ await subir(); return fila.length; },

    /* manda TUDO, ignorando a sombra — é a migração inicial */
    async migrar(crm, landings, semwa){
      Object.values(crm||{}).forEach(l=> enfileirarGravacao('leads', Mapa.leadParaBanco(l)));
      (landings||[]).forEach(x=> enfileirarGravacao('landings', Mapa.landingParaBanco(x)));
      (semwa||[]).forEach(f=> enfileirarGravacao('sem_whatsapp', {fone:f}));
      await subir();
      return fila.length;
    }
  };
})();

window.addEventListener('online',  ()=> Sinc.esvaziar());
window.addEventListener('offline', ()=> Sinc.aoMudar && Sinc.esvaziar());

/* `const` no topo de um script clássico NÃO vira propriedade de window.
   Como o app.js consulta window.Sinc antes de usar, sem estas duas linhas
   o gancho de sincronização nunca dispara — e falha calado. */
/* Quem é quem na equipe. Sem isto a tela mostraria o identificador
   interno do usuário no lugar do nome. */
const Equipe = (() => {
  let porId = {};
  return {
    async carregar(){
      try{
        const ps = await Nuvem.ler('perfis');
        porId = {};
        ps.forEach(p => porId[p.id] = p.nome || '');
      }catch(e){ console.warn('[equipe]', e.message); }
      return porId;
    },
    /* Cai para o começo do e-mail quando ainda não há perfil salvo, e
       para "—" quando o identificador é desconhecido. */
    nome(id){
      if(!id) return '';
      if(porId[id]) return porId[id];
      const eu = Nuvem.usuario;
      if(eu && eu.id === id) return window.nomeDoEmail ? nomeDoEmail(eu.email) : (eu.email||'').split('@')[0];
      return 'outro usuário';
    },
    get todos(){ return Object.assign({}, porId); },
    async salvarMeuNome(nome){
      const eu = Nuvem.usuario; if(!eu) return;
      await Nuvem.gravar('perfis', {id: eu.id, nome});
      porId[eu.id] = nome;
    }
  };
})();

window.Equipe = Equipe;
window.Nuvem = Nuvem;
window.Sinc  = Sinc;
window.Mapa  = Mapa;
