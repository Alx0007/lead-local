/* ==========================================================
   Lead Local — lógica da aplicação
   Projeto sem build: nada de npm, nada de compilar.
   Rode com Live Server (VS Code) ou iniciar-servidor.bat
   ========================================================== */

"use strict";

/* =========================================================
   1. ARMAZENAMENTO (com proteção: se o navegador bloquear,
      o app continua funcionando só na memória)
   ========================================================= */
const Store = (() => {
  let ok = false;
  try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); ok = true; } catch(e){ ok = false; }
  const mem = {};
  return {
    ok,
    get(k, def){
      try { const v = ok ? localStorage.getItem(k) : mem[k];
            return v ? JSON.parse(v) : def; } catch(e){ return def; }
    },
    set(k, v){
      const s = JSON.stringify(v);
      try { if(ok) localStorage.setItem(k, s); else mem[k] = s; } catch(e){ mem[k] = s; }
      // toda gravação do app passa por aqui: é onde a nuvem entra,
      // sem que o resto do código saiba que existe rede
      try { if(window.Sinc) Sinc.registrar(k, v); } catch(e){ console.warn('[sinc]', e); }
    }
  };
})();

let CFG   = Store.get('ll_cfg', {
  nome:'', serv:'landing pages que captam clientes pelo WhatsApp', site:'', key:'',
  iaProv:'gemini', iaKey:'', iaMod:'gemini-2.0-flash',
  msgPadrao:null,   // null = nunca mexeu, vale MSG_PADRAO. '' = modelos automáticos
  uazUrl:'', uazToken:'', uazInt:60, uazLim:30,
  sites:{}          // nicho -> endereço da página de demonstração daquele nicho
});
let CHAMADAS = Store.get('ll_chamadas', {dia:'', n:0});   // contador de consumo da API
let CRM   = Store.get('ll_crm', {});   // id -> lead (com .status)
let LG    = Store.get('ll_landings', []);   // acervo de landings produzidas
let KFLT  = {q:'', nicho:'', ordem:'score', atrasado:false, comValor:false, quente:false};
let RES   = [];                        // resultados da busca atual
let FLT   = {nosite:false, fone:false, quente:false, zap:false,
             semFunil:false, semWa:false, score:0, nota:0, aval:''};

/* Números que o WhatsApp disse não existir. Guardado por telefone, não por
   id do lead: o mesmo número reaparece em buscas e fontes diferentes, e o
   que não tem WhatsApp hoje não passa a ter porque você buscou de novo. */
let SEM_WA = new Set(Store.get('ll_semwa', []));
function marcarSemWa(fone){
  const n = normFone(fone);
  if(!n) return;
  SEM_WA.add(n);
  Store.set('ll_semwa', Array.from(SEM_WA));
}
const ehSemWa = fone => { const n = normFone(fone); return !!n && SEM_WA.has(n); };

const ETAPAS = [
  {k:'novo',       t:'Novo'},
  {k:'qualificado',t:'Qualificado'},
  {k:'contatado',  t:'Contatado'},
  {k:'negociacao', t:'Negociação'},
  {k:'fechado',    t:'Fechado'},
  {k:'perdido',    t:'Perdido'}
];

/* =========================================================
   2. NICHOS, CATEGORIAS E LOCALIDADES
   ========================================================= */
const NICHOS = [
  'academia', 'crossfit', 'restaurante', 'pizzaria',
  'lanchonete', 'hamburgueria', 'cafeteria', 'padaria',
  'bar', 'sorveteria', 'salão de beleza', 'cabeleireiro',
  'barbearia', 'estética', 'manicure', 'dentista',
  'clínica odontológica', 'clínica médica', 'médico', 'psicólogo',
  'fisioterapia', 'nutricionista', 'laboratório', 'veterinário',
  'pet shop', 'farmácia', 'advogado', 'contabilidade',
  'imobiliária', 'seguros', 'arquiteto', 'hotel',
  'pousada', 'escola', 'escola de idiomas', 'autoescola',
  'creche', 'oficina mecânica', 'lava jato', 'concessionária',
  'borracharia', 'ótica', 'joalheria', 'loja de roupas',
  'calçados', 'móveis', 'material de construção', 'supermercado',
  'mercado', 'floricultura', 'gráfica', 'fotógrafo',
  'lavanderia', 'tatuagem', 'informática', 'assistência técnica',
  'celular', 'hospital', 'restaurante italiano', 'comida japonesa',
  'churrascaria', 'doceria', 'açaí', 'pastelaria',
  'pilates', 'escola de dança', 'artes marciais', 'nail designer',
  'depilação', 'spa', 'auto peças'
];

/* Agrupamento dos nichos em categorias. Serve só para a interface:
   escolher a categoria filtra a lista de nichos. Nicho que você
   adicionar em NICHOS e esquecer de citar aqui não some — cai
   sozinho no grupo "Outros". */
const CATEGORIAS = {
  'Alimentação':            ['restaurante','restaurante italiano','comida japonesa','churrascaria',
                             'pizzaria','hamburgueria','lanchonete','cafeteria','padaria','doceria',
                             'sorveteria','açaí','pastelaria','bar'],
  'Saúde':                  ['hospital','clínica médica','médico','clínica odontológica','dentista',
                             'psicólogo','fisioterapia','nutricionista','laboratório','farmácia',
                             'veterinário','pet shop'],
  'Beleza e bem-estar':     ['salão de beleza','cabeleireiro','barbearia','manicure','nail designer',
                             'estética','depilação','spa','tatuagem'],
  'Fitness e esporte':      ['academia','crossfit','pilates','escola de dança','artes marciais'],
  'Serviços profissionais': ['advogado','contabilidade','imobiliária','seguros','arquiteto',
                             'gráfica','fotógrafo','lavanderia'],
  'Automotivo':             ['oficina mecânica','lava jato','concessionária','borracharia','auto peças'],
  'Educação':               ['escola','escola de idiomas','autoescola','creche'],
  'Comércio':               ['loja de roupas','calçados','ótica','joalheria','móveis',
                             'material de construção','supermercado','mercado','floricultura',
                             'informática','assistência técnica','celular'],
  'Hospedagem':             ['hotel','pousada']
};

const OUTRO = '__outro';
const ptSort = (a,b) => a.localeCompare(b,'pt-BR');

function preencherCategorias(){
  $('#cat').innerHTML = '<option value="">Todas as categorias</option>' +
    Object.keys(CATEGORIAS).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function preencherNichos(cat){
  const opt = n => `<option value="${esc(n)}">${esc(n)}</option>`;
  let html;
  if(cat && CATEGORIAS[cat]){
    html = CATEGORIAS[cat].map(opt).join('');
  }else{
    // "Todas": mostra tudo agrupado, para a lista não virar um paredão de 70 itens
    const usados = new Set();
    html = Object.keys(CATEGORIAS).map(c=>{
      CATEGORIAS[c].forEach(n=>usados.add(n));
      return `<optgroup label="${esc(c)}">${CATEGORIAS[c].map(opt).join('')}</optgroup>`;
    }).join('');
    const soltos = NICHOS.filter(n=>!usados.has(n)).sort(ptSort);
    if(soltos.length) html += `<optgroup label="Outros">${soltos.map(opt).join('')}</optgroup>`;
  }
  $('#qSel').innerHTML = '<option value="">— escolha o nicho —</option>' + html +
                         `<option value="${OUTRO}">— outro termo (digitar) —</option>`;
  $('#q').style.display = 'none';
}

/* O termo que vale para a busca: o da lista, ou o digitado se
   estiver em "outro termo". */
function nichoAtual(){
  const v = $('#qSel').value;
  return (v === OUTRO ? $('#q').value : v).trim();
}

/* =========================================================
   2B. LOCALIDADES — estados e cidades pela API do IBGE
   (grátis, sem chave; se cair, o campo vira texto livre)
   ========================================================= */
const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades';

function cidadeAtual(){
  const sel = $('#cidadeSel');
  return (sel.style.display === 'none' ? $('#cidade').value : sel.value).trim();
}

function modoCidadeLivre(motivo){
  $('#uf').parentElement.style.display = 'none';
  $('#cidadeSel').style.display = 'none';
  $('#cidade').style.display = '';
  $('#hCidade').textContent = motivo;
}

async function carregarEstados(){
  let ufs = Store.get('ll_ufs', null);
  if(!ufs){
    const r = await fetch(IBGE + '/estados?orderBy=nome');
    if(!r.ok) throw new Error('HTTP ' + r.status);
    ufs = (await r.json()).map(e=>({s:e.sigla, n:e.nome}));
    Store.set('ll_ufs', ufs);
  }
  $('#uf').innerHTML = '<option value="">— escolha —</option>' +
    ufs.map(e=>`<option value="${esc(e.s)}">${esc(e.n)} (${esc(e.s)})</option>`).join('');
}

async function carregarMunicipios(uf){
  const sel = $('#cidadeSel');
  if(!uf){ sel.innerHTML = '<option value="">— escolha o estado primeiro —</option>'; return; }
  let lista = Store.get('ll_mun_' + uf, null);
  if(!lista){
    sel.disabled = true;
    sel.innerHTML = '<option value="">carregando cidades…</option>';
    const r = await fetch(`${IBGE}/estados/${encodeURIComponent(uf)}/municipios?orderBy=nome`);
    if(!r.ok) throw new Error('HTTP ' + r.status);
    lista = (await r.json()).map(m=>m.nome);
    Store.set('ll_mun_' + uf, lista);
  }
  sel.disabled = false;
  // o value já sai no formato "Cidade, UF" — é o que a busca espera
  sel.innerHTML = '<option value="">— escolha a cidade —</option>' +
    lista.map(n=>`<option value="${esc(n + ', ' + uf)}">${esc(n)}</option>`).join('');
  const salva = Store.get('ll_cidade', '');
  if(salva && salva.endsWith(', ' + uf)) sel.value = salva;
}

/* =========================================================
   3. UTILITÁRIOS
   ========================================================= */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('on'), 2200);
}
function openM(id){ $('#'+id).classList.add('on'); }
function closeM(id){ $('#'+id).classList.remove('on'); }
window.closeM = closeM;

function setStatus(txt, kind){
  const el = $('#status');
  if(!txt){ el.classList.remove('on'); return; }
  el.className = 'on' + (kind==='err' ? ' err' : '');
  el.innerHTML = (kind==='load' ? '<div class="spin"></div>' : '') + '<div>' + esc(txt) + '</div>';
}

/* --- telefone brasileiro --- */
function digits(s){ return String(s||'').replace(/\D+/g,''); }
function normFone(raw){
  let d = digits(raw);
  if(!d) return null;
  if(d.startsWith('55') && d.length >= 12) d = d.slice(2);
  d = d.replace(/^0+/,'');
  if(d.length === 10 || d.length === 11) return '55' + d;
  if(d.length === 8 || d.length === 9) return null;   // sem DDD, inútil pro WhatsApp
  return d.length >= 12 ? d : null;
}
function ehCelular(raw){
  const n = normFone(raw); if(!n) return false;
  const semPais = n.slice(2);
  return semPais.length === 11 && semPais[2] === '9';
}
function foneBonito(raw){
  const n = normFone(raw); if(!n) return raw || '';
  const d = n.slice(2);
  return d.length === 11
    ? `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
    : `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
}

/* busca sem acento e sem caixa: procurar "jose" tem que achar "José" */
const chave = t => String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

const REDES = /instagram\.com|facebook\.com|fb\.com|linktr\.ee|linktree|beacons\.ai|bio\.link|wa\.me|api\.whatsapp|bit\.ly|linkedin\.com|tiktok\.com/i;

/* =========================================================
   4. SCORE — por que este lead vale a sua ligação
   ========================================================= */
function pontuar(l){
  let p = 0, max = 0;
  const r = [];
  const site = (l.website||'').trim();

  // Sinal mais forte para quem vende site
  max += 45;
  if(!site){ p += 45; r.push({t:'Sem site', k:'top'}); }
  else if(REDES.test(site)){ p += 32; r.push({t:'Só rede social', k:'top'}); }
  else { p += 5; r.push({t:'Já tem site', k:'low'}); }

  // Dá pra abordar?
  max += 23;
  if(l.phone){
    p += 15; r.push({t:'Tem telefone', k:'ok'});
    if(ehCelular(l.phone)){ p += 8; r.push({t:'Provável WhatsApp', k:'ok'}); }
  } else {
    r.push({t:'Sem telefone', k:'low'});
  }

  // Volume de avaliações (só o Google traz)
  if(l.reviews != null){
    max += 18;
    if(l.reviews === 0){ p += 5;  r.push({t:'Sem avaliações', k:'low'}); }
    else if(l.reviews <= 30){ p += 18; r.push({t:'Pouca presença digital', k:'top'}); }
    else if(l.reviews <= 150){ p += 11; r.push({t:'Presença média', k:'ok'}); }
    else { p += 4; r.push({t:'Já consolidado', k:'low'}); }
  }

  // Reputação
  if(l.rating != null){
    max += 12;
    if(l.rating < 3.5){ p += 12; r.push({t:'Reputação fraca', k:'top'}); }
    else if(l.rating < 4.5){ p += 10; r.push({t:'Reputação média', k:'ok'}); }
    else { p += 6; r.push({t:'Bem avaliado', k:'ok'}); }
  }

  const score = Math.max(0, Math.min(100, Math.round(p / max * 100)));
  return { score, motivos: r, faixa: score >= 75 ? 'hot' : score >= 50 ? 'warm' : 'cold' };
}
const moeda = v => (Number(v)||0).toLocaleString('pt-BR',
  {style:'currency', currency:'BRL', maximumFractionDigits:0});
const dataBonita = d => {
  if(!d) return '';
  const [a,m,x] = String(d).split('-');
  return (a && m && x) ? `${x}/${m}` : '';
};
// dias até a data; negativo = já passou
const diasAte = d => d ? Math.ceil((new Date(d+'T00:00:00') - new Date(hojeISO()+'T00:00:00')) / 86400000) : null;

const nomeFaixa = f => f==='hot' ? 'Quente' : f==='warm' ? 'Morno' : 'Frio';

/* =========================================================
   5. MENSAGEM DE ABORDAGEM
   ========================================================= */
/* Texto que vem preenchido em toda mensagem. Editável em ⚙ Config.
   [link] é de propósito deixado como está: a página de demonstração é
   diferente para cada lead, então quem cola é você, na hora do envio. */
const MSG_PADRAO =
`Olá, tudo bem?

Me chamo Alexandre Lacerda. Encontrei o [nome do restaurante] no Google Maps e reparei que vocês não têm um site próprio — hoje quem procura por vocês no Google encontra só o perfil do Maps.

Montei uma página de demonstração para vocês verem como ficaria, com cardápio, endereço, horário e um botão que chama direto no WhatsApp:

[link]

Já está no ar e funciona bem no celular. Fiz sem compromisso nenhum: se gostarem, a gente conversa sobre colocar no domínio de vocês. Se não for o momento, é só me responder que não incomodo mais.

Um abraço,
Alexandre Lacerda`;

function aplicarEtiquetas(texto, l){
  return String(texto)
    .replace(/\[nome do restaurante\]/gi, l.nome || '')
    .replace(/\[nome\]/gi,                l.nome || '')
    .replace(/\[categoria\]/gi,           (l.categoria || 'negócios como o de vocês').toLowerCase())
    .replace(/\[cidade\]/gi,              l.cidade || '')
    // [link] só é trocado se houver site cadastrado para o nicho buscado;
    // sem cadastro ele fica visível de propósito, para você não esquecer
    .replace(/\[link\]/gi,                siteDoNicho(l) || '[link]');
}

/* Ordem de busca do [link]: primeiro o acervo de landings (fonte de verdade),
   depois o cadastro antigo de Config, que fica só como compatibilidade. */
function siteDoNicho(l){
  if(!l || !l._nicho) return '';
  const naLoja = LG.find(x => x.url && (x.nichos||[]).includes(l._nicho));
  if(naLoja) return naLoja.url;
  return (CFG.sites || {})[l._nicho] || '';
}

function montarMsg(l){
  // '' = você esvaziou o campo de propósito, então voltam os modelos automáticos.
  // null/ausente = nunca mexeu, vale a mensagem padrão de fábrica.
  if(CFG.msgPadrao === '') return montarMsgAuto(l);
  return aplicarEtiquetas(CFG.msgPadrao || MSG_PADRAO, l);
}

function montarMsgAuto(l){
  const nome = CFG.nome || '[seu nome]';
  const serv = CFG.serv || 'landing pages que captam clientes pelo WhatsApp';
  const cat  = (l.categoria || 'negócios como o de vocês').toLowerCase();
  const site = (l.website||'').trim();
  const port = CFG.site ? ` Meu portfólio: ${CFG.site}.` : '';

  let prova = '';
  if(l.reviews != null && l.reviews > 0){
    prova = ` Vocês já têm ${l.reviews} avaliações` + (l.rating != null ? ` com nota ${l.rating}` : '') +
            `, então movimento não falta.`;
  }

  if(!site){
    return `Olá! Tudo bem? Encontrei a ${l.nome} no mapa e reparei que vocês não têm um site.${prova}\n\n` +
           `Eu trabalho com ${serv} — uma página enxuta que aparece na busca do Google e leva o cliente direto pro WhatsApp de vocês.${port}\n\n` +
           `Posso te mandar um exemplo de como ficaria pra ${cat}? Sem compromisso nenhum.\n\n${nome}`;
  }
  if(REDES.test(site)){
    return `Olá! Tudo bem? Achei a ${l.nome} no mapa e vi que o link de vocês vai direto pro perfil na rede social.${prova}\n\n` +
           `Uma página própria costuma converter melhor: aparece no Google, carrega rápido e leva o cliente pro WhatsApp em um toque. Faço exatamente isso — ${serv}.${port}\n\n` +
           `Quer que eu monte uma prévia pra vocês verem? Leva pouco tempo e não custa nada olhar.\n\n${nome}`;
  }
  return `Olá! Tudo bem? Dei uma olhada no site da ${l.nome}.${prova}\n\n` +
         `Trabalho com ${serv} e costumo achar três coisas que travam contato nesse tipo de página: velocidade, versão no celular e o caminho até o WhatsApp.${port}\n\n` +
         `Posso te mandar um diagnóstico rápido e gratuito do site de vocês? Se fizer sentido, a gente conversa.\n\n${nome}`;
}
function waLink(l, msg){
  const n = normFone(l.phone);
  if(!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
}

/* =========================================================
   5B. ENVIO AUTOMÁTICO (gateway uazapi)

   A uazapi conecta no seu WhatsApp como o WhatsApp Web faz.
   É gateway não-oficial: está fora dos termos do WhatsApp e
   quem arrisca banimento é o seu número. Por isso o disparo
   daqui tem três travas que NÃO devem ser removidas:
     1. intervalo entre envios, com variação sorteada
     2. teto diário, contado e guardado no navegador
     3. mensagem montada por lead, nunca texto igual pra todos
   ========================================================= */

let ENVIOS = Store.get('ll_envios', {dia:'', n:0});

const hojeISO   = () => new Date().toISOString().slice(0,10);
const enviosHoje = () => (ENVIOS.dia === hojeISO() ? ENVIOS.n : 0);
/* O teto é da EQUIPE, não do aparelho: o número de WhatsApp é um só.
   Quem manda é o contador do banco; o valor local é apenas o último que
   vimos, para a tela ter o que mostrar enquanto a resposta não chega. */
async function atualizarEnvios(){
  if(!navigator.onLine || !Nuvem.logado) return enviosHoje();
  try{
    const n = await Nuvem.enviosHoje();
    ENVIOS = {dia: hojeISO(), n};
    Store.set('ll_envios', ENVIOS);
  }catch(e){ console.warn('[envios] não consegui ler do servidor:', e.message); }
  return enviosHoje();
}

async function contarEnvio(){
  const n = await Nuvem.contarEnvio();      // soma e devolve numa operação só
  ENVIOS = {dia: hojeISO(), n};
  Store.set('ll_envios', ENVIOS);
  return n;
}

/* Devolve o motivo pelo qual NÃO dá para enviar agora, ou string vazia. */
function bloqueioDeEnvio(){
  if(!uazPronto())     return 'Configure a uazapi em ⚙ Config para enviar.';
  if(!Nuvem.logado)    return 'Entre na conta da equipe para enviar.';
  if(!navigator.onLine)
    return 'Sem conexão. O envio precisa de internet porque o teto diário é ' +
           'compartilhado com a equipe — sem consultar o servidor, o número ' +
           'poderia levar o dobro de mensagens e ser restringido.';
  if(enviosHoje() >= uazLim())
    return `A equipe já usou os ${uazLim()} envios de hoje. O contador zera amanhã.`;
  return '';
}

const uazBase   = () => (CFG.uazUrl || 'https://free.uazapi.com').replace(/\/+$/, '');
const uazPronto = () => !!(CFG.uazUrl && CFG.uazToken);
const uazInt    = () => Math.max(20, Number(CFG.uazInt) || 60);
const uazLim    = () => Math.max(1,  Number(CFG.uazLim) || 30);

/* A uazapi responde em inglês. Estes são os erros que aparecem de verdade —
   principalmente o 401, porque instância do servidor gratuito expira sozinha. */
function traduzirErroUaz(msg, http){
  const m = String(msg || '');
  if(http === 401 || /invalid token|unauthorized/i.test(m))
    return 'a uazapi recusou o token. Confira no painel dela se o endereço do servidor ' +
           'e o token batem com os da sua instância — o token é válido só no servidor onde a instância vive.';
  // 463: o WhatsApp barrou a CONTA de iniciar conversas novas. Insistir piora.
  if(/\b463\b|temporary restriction|restricted from starting/i.test(m))
    return 'o WhatsApp restringiu temporariamente a SUA conta de iniciar conversas novas (erro 463). ' +
           'Não insista: cada tentativa durante a restrição piora a avaliação do número. ' +
           'Espere, use o número normalmente por alguns dias, e volte depois.';
  if(/is not on WhatsApp/i.test(m))
    return 'esse número não tem WhatsApp.';
  if(/not connected|disconnected|need to restore|qr/i.test(m))
    return 'a instância está desconectada do WhatsApp. Leia o QR code de novo no painel da uazapi.';
  if(http === 429 || /rate|too many/i.test(m))
    return 'a uazapi está limitando os envios. Aumente o intervalo em ⚙ Config.';
  return m || ('HTTP ' + http);
}

/* Cada gateway devolve o erro num campo diferente, e alguns mandam
   {"error": true, "message": "..."} — pegar o primeiro campo verdadeiro
   daria a string "true" em vez do motivo. Aqui só serve texto. */
function textoDoErro(j, status){
  const campos = [j && j.error, j && j.message, j && j.msg,
                  j && j.detail, j && j.description,
                  j && j.error && j.error.message];
  const achou = campos.find(v => typeof v === 'string' && v.trim());
  if(achou) return achou.trim();
  // sem texto aproveitável: mostra o corpo cru, que é melhor que "true"
  let cru = '';
  try{ cru = j && Object.keys(j).length ? JSON.stringify(j).slice(0, 220) : ''; }catch(e){}
  return cru ? `HTTP ${status} — ${cru}` : `HTTP ${status}`;
}

async function uazChamar(caminho, opcoes){
  const o = Object.assign({}, opcoes);
  o.headers = Object.assign({'token': CFG.uazToken}, o.headers || {});
  const r = await fetch(uazBase() + caminho, o);
  const j = await r.json().catch(()=>({}));
  // alguns gateways devolvem 200 com erro no corpo; isso também é falha
  const falhou = !r.ok || (j && j.error === true) ||
                 (typeof j?.status === 'string' && /^erro|^error/i.test(j.status));
  if(falhou){
    console.warn('[uazapi] resposta de erro', r.status, j);   // corpo inteiro no console
    throw new Error(traduzirErroUaz(textoDoErro(j, r.status), r.status));
  }
  return j;
}

async function uazStatus(){
  return uazChamar('/instance/status', {method:'GET'});
}

async function uazEnviar(fone, texto){
  const n = normFone(fone);
  if(!n) throw new Error('telefone sem DDD válido');
  return uazChamar('/send/text', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({number: n, text: texto})
  });
}

/* ---- fila de envio: uma mensagem por vez, sempre revisada ---- */
const FILA = {leads:[], i:0, liberaEm:0, timer:null, enviando:false};
const dormir = ms => new Promise(r => setTimeout(r, ms));

function loteLog(classe, nome, txt){
  const cx = $('#loteLog');
  cx.classList.add('on');
  const d = document.createElement('div');
  d.innerHTML = `<span class="${classe}">${classe==='ok'?'✓':classe==='er'?'✕':'—'}</span>` +
                `<span class="nm">${esc(nome)}</span><span class="${classe}">${esc(txt)}</span>`;
  cx.appendChild(d);
  cx.scrollTop = cx.scrollHeight;
}

/* Quem entra no disparo: tem telefone com DDD e ainda não foi contatado. */
function elegiveis(leads){
  return leads.filter(l => normFone(l.phone) &&
                           !(CRM[l.id] && CRM[l.id].status !== 'novo'));
}

function filaAbrir(leads){
  FILA.leads = leads; FILA.i = 0; FILA.liberaEm = 0; FILA.enviando = false;
  $('#loteLog').innerHTML = ''; $('#loteLog').classList.remove('on');
  $('#loteFl').style.width = '0';
  filaMostrar();
  openM('mLote');
}

function filaMostrar(){
  const l = FILA.leads[FILA.i];
  const acabou = !l;
  const noTeto = enviosHoje() >= uazLim();

  $('#loteAtual').style.display = (acabou || noTeto) ? 'none' : '';
  $('#bLoteEnviar').style.display = (acabou || noTeto) ? 'none' : '';
  $('#bLotePular').style.display  = (acabou || noTeto) ? 'none' : '';

  if(acabou || noTeto){
    $('#loteResumo').innerHTML = acabou
      ? '<div><b>Fila terminada.</b> Nada mais para enviar aqui.</div>'
      : `<div><b>Teto diário atingido</b> — ${enviosHoje()} de ${uazLim()}. O contador zera amanhã.</div>`;
    return;
  }

  $('#loteQuem').textContent = `${FILA.i + 1} de ${FILA.leads.length} · ${l.nome} · ${foneBonito(l.phone)}`;
  $('#loteTxt').value = montarMsg(l);
  $('#loteFl').style.width = FILA.i / FILA.leads.length * 100 + '%';
  $('#loteResumo').innerHTML =
    `<div>Enviados hoje: <span class="n">${enviosHoje()}</span> de ${uazLim()}.</div>` +
    `<div>${l.website ? 'Site: ' + esc(l.website.replace(/^https?:\/\//,'')) : 'Sem site — é o caso do texto padrão.'}</div>`;
  filaTique();
}

/* Trava do intervalo: o botão só libera quando o tempo passou. Enquanto
   isso você aproveita para colar o link e ajustar o texto. */
function filaTique(){
  clearTimeout(FILA.timer);
  const b = $('#bLoteEnviar');
  const falta = Math.ceil((FILA.liberaEm - Date.now()) / 1000);
  if(FILA.enviando){ b.disabled = true; b.textContent = 'Enviando…'; return; }

  // sem conexão ou sem vaga no teto: o botão diz o porquê, não fica só cinza
  const impedimento = bloqueioDeEnvio();
  if(impedimento){
    b.disabled = true;
    b.textContent = navigator.onLine ? 'Teto da equipe atingido' : 'Sem conexão';
    b.title = impedimento;
    FILA.timer = setTimeout(filaTique, 2000);   // volta sozinho quando a rede voltar
    return;
  }
  b.title = '';
  if(falta > 0){
    b.disabled = true;
    b.textContent = `Aguarde ${falta}s`;
    FILA.timer = setTimeout(filaTique, 500);
  }else{
    b.disabled = false;
    b.textContent = 'Enviar e ir para o próximo';
  }
}

function filaAvancar(){
  FILA.i++;
  filaMostrar();
}

async function filaEnviar(){
  const l = FILA.leads[FILA.i];
  if(!l || FILA.enviando) return;
  const texto = $('#loteTxt').value.trim();
  if(!texto){ toast('A mensagem está vazia.'); return; }
  if(/\[link\]/i.test(texto) &&
     !confirm('O texto ainda tem [link] sem preencher. Enviar assim mesmo?')) return;

  await atualizarEnvios();
  const impedimento = bloqueioDeEnvio();
  if(impedimento){ toast(impedimento); filaMostrar(); return; }

  FILA.enviando = true; filaTique();
  // toda tentativa conta para o teto, dando certo ou não: o que pesa para o
  // WhatsApp é o tráfego que sai do número
  await contarEnvio();
  try{
    await uazEnviar(l.phone, texto);
    CRM[l.id] = Object.assign({}, CRM[l.id] || l, {status:'contatado'});
    if(!CRM[l.id]._p) CRM[l.id]._p = l._p;
    Store.set('ll_crm', CRM);
    loteLog('ok', l.nome, foneBonito(l.phone));
  }catch(e){
    const msg = (e && e.message) || 'falhou';
    loteLog('er', l.nome, msg);
    if(/não tem WhatsApp/i.test(msg)) marcarSemWa(l.phone);
    // Restrição de conta não é erro de um lead: é o WhatsApp barrando o número.
    // Continuar a fila só acumula tentativa negativa — para tudo aqui.
    if(/restringiu temporariamente/i.test(msg)){
      FILA.enviando = false;
      FILA.leads = [];
      $('#loteAtual').style.display = 'none';
      $('#bLoteEnviar').style.display = 'none';
      $('#bLotePular').style.display = 'none';
      $('#loteResumo').innerHTML =
        '<div><b>Fila interrompida — o WhatsApp restringiu seu número.</b></div>' +
        '<div>Erro 463: a conta está impedida de iniciar conversas novas. ' +
        'Cada nova tentativa agora conta contra você.</div>';
      return;
    }
  }
  FILA.enviando = false;
  // intervalo com variação de ±40%, para não sair num ritmo mecânico
  FILA.liberaEm = Date.now() + Math.round(uazInt() * 1000 * (0.8 + Math.random() * 0.6));
  renderRes(); renderKb(); renderPainel();
  filaAvancar();
}

/* =========================================================
   7. BUSCA — Google Maps (Places, via API JavaScript)
   ========================================================= */
let gPronto = null;
let gAuthFalhou = false;

// O Google chama isto quando recusa a chave: inválida, restrição de origem
// errada, ou a Places API (New) não ativada no projeto.
window.gm_authFailure = () => {
  gAuthFalhou = true;
  gPronto = null;   // deixa tentar de novo depois de arrumar a chave
  setStatus('O Google recusou sua chave. Confira três coisas: a chave está certa, ' +
            'a Places API (New) está ativada no projeto, e as restrições da chave ' +
            'permitem este endereço.', 'err');
};

function carregarGoogle(key){
  if(gPronto) return gPronto;
  gPronto = new Promise((ok, err)=>{
    // Com loading=async, o onload do script dispara ANTES de
    // google.maps.importLibrary existir — dá uns 150ms de diferença, e é
    // exatamente onde a primeira busca falhava com "is not a function".
    // Quem avisa que a API está mesmo de pé é o callback.
    const nome = '__gmapsPronto';
    const limpar = () => { try{ delete window[nome]; }catch(e){ window[nome] = undefined; } };

    const desistir = setTimeout(()=>{
      gPronto = null; limpar();
      err(new Error('A API do Google não terminou de carregar. Tente de novo.'));
    }, 20000);

    window[nome] = () => {
      clearTimeout(desistir); limpar();
      gAuthFalhou ? err(new Error('O Google recusou sua chave.')) : ok(true);
    };

    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
            '&libraries=places&v=weekly&language=pt-BR&region=BR&loading=async&callback=' + nome;
    s.async = true;
    s.onerror = () => {
      clearTimeout(desistir); gPronto = null; limpar();
      err(new Error('Não consegui carregar a API do Google. Verifique a chave e a conexão.'));
    };
    document.head.appendChild(s);
  });
  return gPronto;
}

/* O Places responde em inglês e com jargão. Estes são os erros que aparecem
   de verdade enquanto você arruma a chave — o resto passa direto. */
function traduzirErroGoogle(msg){
  const m = String(msg || 'falhou');
  if(/API key not valid|INVALID_ARGUMENT.*key/i.test(m))
    return 'a chave não é válida. Confira se copiou inteira, sem espaços.';
  if(/API_KEY_HTTP_REFERRER_BLOCKED|referer/i.test(m))
    return 'a chave existe, mas as restrições dela bloqueiam este endereço. ' +
           'No Google Cloud, libere ' + location.origin + ' nas restrições da chave.';
  if(/PERMISSION_DENIED|REQUEST_DENIED|SERVICE_DISABLED|has not been used/i.test(m))
    return 'a Places API (New) não está ativada neste projeto do Google Cloud.';
  if(/RESOURCE_EXHAUSTED|quota|OVER_QUERY_LIMIT/i.test(m))
    return 'a cota da chave acabou por hoje. Use a fonte OpenStreetMap enquanto isso.';
  if(/BillingNotEnabled|billing/i.test(m))
    return 'o projeto do Google Cloud está sem faturamento ativo.';
  return m;
}

function contar(n){
  const hoje = new Date().toISOString().slice(0,10);
  if(CHAMADAS.dia !== hoje) CHAMADAS = {dia:hoje, n:0};
  CHAMADAS.n += n;
  Store.set('ll_chamadas', CHAMADAS);
}

async function buscarGoogle(nicho, cidade, limite, bairros){
  if(!CFG.key) throw new Error('Cole sua chave do Places em ⚙ Config, ou troque a fonte para OpenStreetMap.');
  setStatus('Conectando na API do Google…', 'load');
  await carregarGoogle(CFG.key);
  const { Place } = await google.maps.importLibrary('places');

  // O Places devolve no máximo 20 por consulta. Uma consulta por bairro = volume de verdade.
  const areas = (bairros && bairros.length) ? bairros : [''];
  const campos = ['id','displayName','formattedAddress','nationalPhoneNumber','websiteURI',
                  'rating','userRatingCount','primaryTypeDisplayName','googleMapsURI'];
  const todos = [];
  const erros = [];

  for(let i = 0; i < areas.length; i++){
    if(todos.length >= limite) break;
    const alvo = areas[i] ? `${nicho} em ${areas[i]}, ${cidade}` : `${nicho} em ${cidade}`;
    setStatus(`Buscando ${i+1} de ${areas.length}: "${alvo}"…`, 'load');
    try{
      const { places } = await Place.searchByText({
        textQuery: alvo, fields: campos,
        language:'pt-BR', region:'br', maxResultCount: 20
      });
      contar(1);
      (places||[]).forEach(p => todos.push({
        id: 'goo-' + (p.id || Math.random().toString(36).slice(2)),
        nome: p.displayName || '(sem nome)',
        categoria: p.primaryTypeDisplayName || '',
        phone: p.nationalPhoneNumber || '',
        website: p.websiteURI || '',
        endereco: p.formattedAddress || '',
        cidade: areas[i] ? areas[i] + ', ' + cidade : cidade,
        rating:  p.rating != null ? p.rating : null,
        reviews: p.userRatingCount != null ? p.userRatingCount : 0,
        fonte: 'Google Maps',
        mapa: p.googleMapsURI || ''
      }));
    }catch(e){
      erros.push((areas[i]||cidade) + ': ' + traduzirErroGoogle(e && e.message));
    }
  }
  if(!todos.length && erros.length) throw new Error(erros[0]);
  return todos.slice(0, limite);
}

/* ---- Escrita com IA (Gemini grátis, OpenRouter ou Groq) ---- */
async function escreverComIA(l, rascunho){
  if(!CFG.iaKey) throw new Error('Cole a chave da IA em ⚙ Config. O Gemini é grátis e não pede cartão.');
  const modelo = CFG.iaMod || 'gemini-2.0-flash';
  const ctx =
    `Empresa: ${l.nome}\nSegmento: ${l.categoria||'não informado'}\n` +
    `Site: ${l.website || 'NÃO TEM SITE'}\n` +
    (l.rating != null ? `Nota no Google: ${l.rating} com ${l.reviews} avaliações\n` : '') +
    `Cidade: ${l.cidade||''}\n` +
    `Quem está abordando: ${CFG.nome||'um freelancer'}, que vende ${CFG.serv||'sites e landing pages'}.`;
  const prompt =
    `Você escreve mensagens frias de prospecção no WhatsApp, em português do Brasil.\n\n${ctx}\n\n` +
    `Rascunho atual:\n"""${rascunho}"""\n\n` +
    `Reescreva essa mensagem deixando-a mais natural, curta e específica para esta empresa. Regras: ` +
    `no máximo 3 parágrafos curtos; tom de gente, não de robô; nada de "espero que esteja bem" nem jargão de vendas; ` +
    `cite um detalhe concreto do negócio; termine com uma pergunta simples e fácil de responder; ` +
    `não invente fatos que não estejam acima; não use emojis. Responda SÓ com o texto da mensagem.`;

  let url, corpo, cab = {'Content-Type':'application/json'};
  if(CFG.iaProv === 'gemini'){
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(CFG.iaKey)}`;
    corpo = {contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.8}};
  }else{
    url = CFG.iaProv === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
    cab['Authorization'] = 'Bearer ' + CFG.iaKey;
    corpo = {model: modelo, messages:[{role:'user', content:prompt}], temperature:0.8};
  }

  const r = await fetch(url, {method:'POST', headers:cab, body:JSON.stringify(corpo)});
  const j = await r.json().catch(()=>({}));
  if(!r.ok){
    const m = (j.error && (j.error.message || j.error)) || ('HTTP ' + r.status);
    throw new Error(typeof m === 'string' ? m : 'A IA recusou a chamada.');
  }
  const txt = CFG.iaProv === 'gemini'
    ? (((j.candidates||[])[0]||{}).content||{}).parts?.[0]?.text
    : ((j.choices||[])[0]||{}).message?.content;
  if(!txt) throw new Error('A IA respondeu vazio. Tente outro modelo.');
  return txt.trim();
}

/* =========================================================
   9. RENDERIZAÇÃO — resultados
   ========================================================= */
function visiveis(){
  return RES.filter(l=>{
    if(FLT.nosite   && l.website && !REDES.test(l.website)) return false;
    if(FLT.fone     && !normFone(l.phone)) return false;
    if(FLT.zap      && !ehCelular(l.phone)) return false;
    if(FLT.quente   && l._p.faixa !== 'hot') return false;
    if(FLT.semFunil && CRM[l.id]) return false;
    if(FLT.semWa    && ehSemWa(l.phone)) return false;
    if(FLT.score    && l._p.score < FLT.score) return false;
    if(FLT.aval){
      const n = l.reviews;
      // lead sem esse dado (OpenStreetMap não traz) não entra em faixa nenhuma
      if(n == null) return false;
      if(FLT.aval === 'zero'    && n !== 0) return false;
      if(FLT.aval === 'ate30'   && !(n >= 1 && n <= 30)) return false;
      if(FLT.aval === '31a150'  && !(n > 30 && n <= 150)) return false;
      if(FLT.aval === 'mais150' && !(n > 150)) return false;
    }
    if(FLT.nota){
      const nota = l.rating;
      if(FLT.nota === -1 && nota != null) return false;          // só os sem nota
      if(FLT.nota === -2 && !(nota != null && nota < 3.5)) return false;
      if(FLT.nota > 0 && !(nota != null && nota >= FLT.nota)) return false;
    }
    return true;
  });
}

function filtrosAtivos(){
  return FLT.nosite || FLT.fone || FLT.zap || FLT.quente ||
         FLT.semFunil || FLT.semWa || FLT.score || FLT.nota || FLT.aval;
}

function cardLead(l){
  const p = l._p;
  const noCrm = !!CRM[l.id];
  const wa = normFone(l.phone);
  const semWa = ehSemWa(l.phone);
  // lead já trabalhado ou sem WhatsApp confirmado sai do caminho visualmente,
  // mas continua na lista — some só se você ligar o filtro
  const apagado = (noCrm || semWa) ? ' apagado' : '';
  const etapa = noCrm ? (ETAPAS.find(e=>e.k===CRM[l.id].status)||{}).t : '';
  return `
  <div class="lead ${p.faixa}${apagado}" data-id="${esc(l.id)}">
    ${semWa ? '<div class="selo semwa">✕ não tem WhatsApp</div>'
            : noCrm ? `<div class="selo nofunil">✓ ${esc(etapa || 'no funil')}</div>` : ''}
    <div class="top">
      <div class="nm">${esc(l.nome)}<div class="cat">${esc(l.categoria||'—')} · ${esc(l.fonte)}</div></div>
      <div class="sc ${p.faixa}"><span class="n">${p.score}</span><span class="l">${nomeFaixa(p.faixa)}</span></div>
    </div>
    <div class="why">${p.motivos.map(m=>`<span class="${m.k}">${esc(m.t)}</span>`).join('')}</div>
    <div class="meta">
      <div class="row"><span class="k">☎</span><span>${l.phone ? esc(foneBonito(l.phone)) : '<span style="color:var(--dim2)">sem telefone</span>'}</span></div>
      <div class="row"><span class="k">🌐</span><span>${l.website ? esc(l.website.replace(/^https?:\/\//,'').slice(0,42)) : '<span style="color:var(--dim2)">sem site</span>'}</span></div>
      ${l.rating != null ? `<div class="row"><span class="k">★</span><span>${l.rating} · ${l.reviews} avaliações</span></div>` : ''}
      <div class="row"><span class="k">📍</span><span>${esc((l.endereco||'—').slice(0,46))}</span></div>
    </div>
    <div class="acts">
      <button class="wa" data-a="msg" ${(wa && !semWa)?'':'disabled'}>${
        semWa ? 'Sem WhatsApp' : wa ? 'WhatsApp' : 'Sem telefone'}</button>
      <button class="add" data-a="crm">${noCrm ? 'No funil' : '+ Funil'}</button>
      ${l.mapa ? `<button data-a="mapa">Mapa</button>` : ''}
    </div>
  </div>`;
}

function renderRes(){
  const box = $('#res'), v = visiveis();
  $('#resBar').style.display = RES.length ? '' : 'none';
  $('#resN').textContent = RES.length ? `· ${v.length} de ${RES.length}` : '';
  $('#bLimpaFlt').style.display = filtrosAtivos() ? '' : 'none';
  if(!RES.length){ box.innerHTML = ''; return; }
  box.innerHTML = v.length ? v.map(cardLead).join('')
    : '<div class="empty">Nenhum lead passou pelos filtros.<br>Solte algum filtro acima ou clique em "Limpar filtros".</div>';
}

/* =========================================================
   10. RENDERIZAÇÃO — funil e painel
   ========================================================= */
function kbPassa(l){
  if(KFLT.q && !chave(l.nome).includes(chave(KFLT.q))) return false;
  if(KFLT.nicho && l._nicho !== KFLT.nicho) return false;
  if(KFLT.quente && l._p.faixa !== 'hot') return false;
  if(KFLT.comValor && !(Number(l.valor) > 0)) return false;
  if(KFLT.atrasado){
    const d = diasAte(l.proxContato);
    if(d == null || d >= 0 || l.status === 'fechado' || l.status === 'perdido') return false;
  }
  return true;
}

function kbOrdenar(a, b){
  switch(KFLT.ordem){
    case 'valor': return (Number(b.valor)||0) - (Number(a.valor)||0);
    case 'nome':  return a.nome.localeCompare(b.nome, 'pt-BR');
    case 'prox':  // quem não tem data vai para o fim
      return (a.proxContato || '9999').localeCompare(b.proxContato || '9999');
    default:      return b._p.score - a._p.score;
  }
}

function kbFiltrosAtivos(){
  return !!(KFLT.q || KFLT.nicho || KFLT.atrasado || KFLT.comValor || KFLT.quente);
}

function renderKb(){
  const kb = $('#kb');
  const todos = Object.values(CRM);
  const passam = todos.filter(kbPassa);

  // o seletor de nicho lista só o que existe no funil
  const nichos = Array.from(new Set(todos.map(l=>l._nicho).filter(Boolean))).sort(ptSort);
  $('#kbNicho').innerHTML = '<option value="">todos</option>' + nichos.map(n=>
    `<option value="${esc(n)}"${n===KFLT.nicho?' selected':''}>${esc(n)}</option>`).join('');

  $('#kbN').textContent = todos.length
    ? (kbFiltrosAtivos() ? `· ${passam.length} de ${todos.length}` : `· ${todos.length}`) : '';
  $('#bKbLimpa').style.display = kbFiltrosAtivos() ? '' : 'none';

  kb.innerHTML = ETAPAS.map(e=>{
    const its = passam.filter(l=>l.status===e.k).sort(kbOrdenar);
    const total = todos.filter(l=>l.status===e.k).length;
    return `<div class="col" data-col="${e.k}">
      <h3>${e.t}<i>${kbFiltrosAtivos() ? its.length+'/'+total : total}</i></h3>
      ${its.map(l=>`
        <div class="kcard" draggable="true" data-id="${esc(l.id)}">
          <div class="nm">${esc(l.nome)}</div>
          <div class="sm">${l._p.score} pts · ${l.phone?esc(foneBonito(l.phone)):'sem telefone'}</div>
          ${linhaValor(l)}
          ${l.nota ? `<div class="knota">${esc(l.nota.slice(0,90))}${l.nota.length>90?'…':''}</div>` : ''}
          <div class="kacts">
            <button data-k="edit">Abrir</button>
            <button data-k="msg">Msg</button>
          </div>
        </div>`).join('')}
      ${!its.length && kbFiltrosAtivos() ? '<div class="kvazio">nada aqui com esse filtro</div>' : ''}
    </div>`;
  }).join('');
  ligarDnD();
}

/* Valor, previsão de fechamento e próximo contato aparecem no card só
   quando existem — cartão vazio não deve carregar campo em branco. */
function linhaValor(l){
  const partes = [];
  if(l.valor)  partes.push(`<b>${moeda(l.valor)}</b>`);
  if(l.dataFech) partes.push(`fecha ${dataBonita(l.dataFech)}`);
  if(!partes.length && !l.proxContato) return '';

  let alerta = '';
  if(l.proxContato && l.status !== 'fechado' && l.status !== 'perdido'){
    const d = diasAte(l.proxContato);
    const classe = d < 0 ? 'atrasado' : d === 0 ? 'hoje' : '';
    const txt = d < 0 ? `contato atrasado ${-d}d` : d === 0 ? 'contatar hoje' : `contato ${dataBonita(l.proxContato)}`;
    alerta = `<span class="kprox ${classe}">${txt}</span>`;
  }
  return `<div class="kval">${partes.join(' · ')}${alerta}</div>`;
}

function ligarDnD(){
  let arrastado = null;
  $$('.kcard').forEach(c=>{
    c.addEventListener('dragstart', ()=>{ arrastado = c.dataset.id; c.style.opacity = '.4'; });
    c.addEventListener('dragend',   ()=>{ c.style.opacity = '1'; });
  });
  $$('.col').forEach(col=>{
    col.addEventListener('dragover', e=>{ e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave',()=> col.classList.remove('over'));
    col.addEventListener('drop', e=>{
      e.preventDefault(); col.classList.remove('over');
      if(arrastado && CRM[arrastado]){
        CRM[arrastado].status = col.dataset.col;
        Store.set('ll_crm', CRM); renderKb(); renderPainel();
      }
    });
  });
}

function renderPainel(){
  const all = Object.values(CRM);
  const semSite = all.filter(l=>!l.website).length;
  const media = all.length ? Math.round(all.reduce((s,l)=>s+l._p.score,0)/all.length) : 0;
  const fechados = all.filter(l=>l.status==='fechado');
  const fech = fechados.length;
  const trab = all.filter(l=>l.status!=='novo').length;

  const emNegoc   = all.filter(l=>l.status==='negociacao');
  const soma      = xs => xs.reduce((t,l)=>t+(Number(l.valor)||0), 0);
  const pipeline  = soma(emNegoc);
  const ganho     = soma(fechados);
  const comValor  = fechados.filter(l=>Number(l.valor)>0);
  const ticket    = comValor.length ? ganho / comValor.length : 0;

  $('#kpis').innerHTML = `
    <div class="kpi"><div class="v">${all.length}</div><div class="l">Leads no funil</div></div>
    <div class="kpi"><div class="v" style="color:var(--warm)">${moeda(pipeline)}</div><div class="l">Em negociação · ${emNegoc.length}</div></div>
    <div class="kpi"><div class="v" style="color:var(--ok)">${moeda(ganho)}</div><div class="l">Fechado · ${fech}</div></div>
    <div class="kpi"><div class="v">${moeda(ticket)}</div><div class="l">Ticket médio</div></div>
    <div class="kpi"><div class="v">${trab?Math.round(fech/trab*100):0}%</div><div class="l">Conversão dos trabalhados</div></div>
    <div class="kpi"><div class="v" style="color:var(--hot)">${semSite}</div><div class="l">Sem site nenhum</div></div>
    <div class="kpi"><div class="v">${media}</div><div class="l">Score médio</div></div>`;

  const max = Math.max(1, ...ETAPAS.map(e=>all.filter(l=>l.status===e.k).length));
  $('#bars').innerHTML = ETAPAS.map(e=>{
    const n = all.filter(l=>l.status===e.k).length;
    return `<div class="brow"><div class="lb">${e.t}</div>
      <div class="tr"><div class="fl" style="width:${n/max*100}%"></div></div>
      <div class="vv">${n}</div></div>`;
  }).join('');

  // negociações em aberto, da proposta maior para a menor
  const abertas = emNegoc.slice().sort((a,b)=>(Number(b.valor)||0)-(Number(a.valor)||0));
  const maiorV = Math.max(1, ...abertas.map(l=>Number(l.valor)||0));
  $('#negoc').innerHTML = abertas.length ? abertas.map(l=>{
    const d = diasAte(l.proxContato);
    const atrasado = d != null && d < 0;
    return `<div class="brow"><div class="lb" style="width:200px">${esc(l.nome.slice(0,28))}</div>
      <div class="tr"><div class="fl" style="width:${(Number(l.valor)||0)/maiorV*100}%;background:var(--warm)"></div></div>
      <div class="vv" style="width:auto;min-width:90px">${l.valor?moeda(l.valor):'—'}</div>
      <div class="vv" style="width:auto;min-width:110px;color:${atrasado?'var(--bad)':'var(--dim2)'}">${
        l.dataFech ? 'fecha '+dataBonita(l.dataFech) : (l.proxContato ? 'contato '+dataBonita(l.proxContato) : 'sem data')}</div>
    </div>`;
  }).join('')
    : '<div class="empty" style="padding:20px">Nenhuma negociação aberta. Arraste um lead para "Negociação" e preencha valor e data na ficha.</div>';

  // agenda: quem tem próximo contato marcado e ainda está vivo no funil
  const agenda = all.filter(l=>l.proxContato && l.status!=='fechado' && l.status!=='perdido')
                    .sort((a,b)=>a.proxContato.localeCompare(b.proxContato));
  $('#agenda').innerHTML = agenda.length ? agenda.map(l=>{
    const d = diasAte(l.proxContato);
    const cor = d < 0 ? 'var(--bad)' : d === 0 ? 'var(--warm)' : 'var(--dim)';
    const txt = d < 0 ? `atrasado ${-d} dia${-d>1?'s':''}` : d === 0 ? 'hoje' : `em ${d} dia${d>1?'s':''}`;
    return `<div class="brow"><div class="lb" style="width:200px">${esc(l.nome.slice(0,28))}</div>
      <div class="vv" style="width:auto;min-width:80px;color:var(--dim2)">${dataBonita(l.proxContato)}</div>
      <div class="vv" style="width:auto;min-width:110px;color:${cor};font-weight:700">${txt}</div>
      <div class="tr" style="flex:1"></div>
      <div class="vv" style="width:auto;min-width:90px;color:var(--dim2)">${(ETAPAS.find(e=>e.k===l.status)||{}).t||''}</div>
    </div>`;
  }).join('')
    : '<div class="empty" style="padding:20px">Nenhum contato agendado. Abra um lead no funil e preencha "Próximo contato".</div>';

  const top = all.filter(l=>l.status==='novo').sort((a,b)=>b._p.score-a._p.score).slice(0,8);
  $('#top').innerHTML = top.length ? top.map(l=>`
    <div class="brow"><div class="lb" style="width:190px">${esc(l.nome.slice(0,26))}</div>
      <div class="tr"><div class="fl" style="width:${l._p.score}%;background:${
        l._p.faixa==='hot'?'var(--hot)':l._p.faixa==='warm'?'var(--warm)':'var(--cold)'}"></div></div>
      <div class="vv">${l._p.score}</div></div>`).join('')
    : '<div class="empty" style="padding:20px">Nada em "Novo". Busque leads e mande pro funil.</div>';
}

/* =========================================================
   10B. ACERVO DE LANDINGS
   O que você já produziu: modelo, proposta enviada ou entregue.
   É daqui que sai o [link] da mensagem de prospecção.
   ========================================================= */
const LG_ESTADOS = {modelo:'Modelo', proposta:'Proposta', entregue:'Entregue'};
let lgAtual = null;

function lgSalvarTudo(){ Store.set('ll_landings', LG); }

function renderLandings(){
  const fn = $('#lgFiltro').value, fs = $('#lgStatus').value;
  const vis = LG.filter(x => (!fn || (x.nichos||[]).includes(fn)) && (!fs || x.status === fs));

  // o filtro de nicho lista só o que o acervo realmente cobre
  const usados = Array.from(new Set(LG.flatMap(x => x.nichos || []))).sort(ptSort);
  $('#lgFiltro').innerHTML = '<option value="">todos os nichos</option>' +
    usados.map(n=>`<option value="${esc(n)}"${n===fn?' selected':''}>${esc(n)}</option>`).join('');

  $('#lgN').textContent = LG.length ? `· ${vis.length} de ${LG.length}` : '';
  $('#lgLista').innerHTML = vis.length ? vis.map(cardLanding).join('') :
    `<div class="empty">${LG.length ? 'Nenhuma landing passou pelos filtros.'
      : 'Nenhuma landing no acervo ainda.<br>Clique em "+ Nova landing" para registrar a primeira.'}</div>`;
}

function cardLanding(x){
  const cliente = x.clienteId && CRM[x.clienteId] ? CRM[x.clienteId].nome : '';
  const nichos = (x.nichos||[]);
  return `
  <div class="lgcard" data-id="${esc(x.id)}">
    <div class="lgtopo" style="background:linear-gradient(135deg, ${esc(x.cor||'#7c6cff')}, ${esc(x.cor2||'#1b1f2a')})">
      <span class="lgest ${esc(x.status||'modelo')}">${esc(LG_ESTADOS[x.status]||'Modelo')}</span>
    </div>
    <div class="lgcorpo">
      <div class="lgnome">${esc(x.nome||'(sem nome)')}</div>
      <div class="lgmeta">
        <span class="lgswatch" style="background:${esc(x.cor||'#7c6cff')}"></span>
        <span class="lgswatch" style="background:${esc(x.cor2||'#1b1f2a')}"></span>
        <span>${esc(x.estilo||'—')}</span>
        ${x.fonte ? `<span class="lgfonte">${esc(x.fonte)}</span>` : ''}
      </div>
      ${nichos.length ? `<div class="lgnichos">${nichos.slice(0,4).map(n=>`<span>${esc(n)}</span>`).join('')}${
        nichos.length>4?`<span>+${nichos.length-4}</span>`:''}</div>` : ''}
      ${cliente ? `<div class="lgcli">👤 ${esc(cliente)}</div>` : ''}
      <div class="lgacts">
        <button data-lg="edit">Abrir</button>
        ${x.url ? `<button data-lg="ver">Visitar</button>` : ''}
      </div>
    </div>
  </div>`;
}

function abrirLanding(id){
  const x = id ? LG.find(y=>y.id===id) : null;
  lgAtual = id || null;
  $('#lgTit').textContent = x ? x.nome || 'Landing' : 'Nova landing';
  $('#lgNome').value  = x ? (x.nome||'')  : '';
  $('#lgUrl').value   = x ? (x.url||'')   : '';
  $('#lgSt').value    = x ? (x.status||'modelo') : 'modelo';
  $('#lgEstilo').value= x ? (x.estilo||'minimalista') : 'minimalista';
  $('#lgFonte').value = x ? (x.fonte||'') : '';
  $('#lgNota').value  = x ? (x.nota||'')  : '';
  const c1 = (x && x.cor)  || '#7c6cff', c2 = (x && x.cor2) || '#1b1f2a';
  $('#lgCor').value = c1; $('#lgCorTxt').value = c1;
  $('#lgCor2').value = c2; $('#lgCor2Txt').value = c2;

  $('#lgCliente').innerHTML = '<option value="">nenhum — é modelo</option>' +
    Object.values(CRM).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'))
      .map(l=>`<option value="${esc(l.id)}"${x&&x.clienteId===l.id?' selected':''}>${esc(l.nome)}</option>`).join('');

  const marcados = new Set(x ? (x.nichos||[]) : []);
  $('#lgNichos').innerHTML = NICHOS.slice().sort(ptSort).map(n=>
    `<label class="npick${marcados.has(n)?' on':''}"><input type="checkbox" value="${esc(n)}"${
      marcados.has(n)?' checked':''}><span>${esc(n)}</span></label>`).join('');

  $('#bLgDel').style.display = id ? '' : 'none';
  openM('mLg');
}

/* =========================================================
   11. EXPORTAÇÃO
   ========================================================= */
function baixar(nome, texto, tipo){
  const blob = new Blob([texto], {type: tipo});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function exportarCSV(){
  const fonte = Object.values(CRM).length ? Object.values(CRM) : RES;
  if(!fonte.length){ toast('Nada para exportar ainda.'); return; }
  const cols = ['Nome','Categoria','Telefone','LinkWhatsApp','Site','Nota','Avaliacoes',
                'Score','Faixa','Motivos','Endereco','Cidade','Etapa','Valor','PrevisaoFechamento',
                'ProximoContato','Observacoes','Fonte','LinkMapa','DataCaptura'];
  const hoje = new Date().toISOString().slice(0,10);
  const linhas = fonte.map(l=>{
    const n = normFone(l.phone);
    return [
      l.nome, l.categoria, l.phone ? foneBonito(l.phone) : '',
      n ? 'https://wa.me/'+n : '', l.website,
      l.rating != null ? String(l.rating).replace('.',',') : '',
      l.reviews != null ? l.reviews : '',
      l._p.score, nomeFaixa(l._p.faixa), l._p.motivos.map(m=>m.t).join(' | '),
      l.endereco, l.cidade, l.status ? (ETAPAS.find(e=>e.k===l.status)||{}).t : 'Não trabalhado',
      // vírgula decimal: é o que o Excel e o Power BI em português esperam
      l.valor ? String(Number(l.valor).toFixed(2)).replace('.',',') : '',
      l.dataFech || '', l.proxContato || '', l.nota || '',
      l.fonte, l.mapa, hoje
    ].map(c=>{
      const s = String(c==null?'':c).replace(/"/g,'""');
      return /[";\n]/.test(s) ? '"'+s+'"' : s;
    }).join(';');
  });
  // BOM + separador ";" = abre certinho no Excel e no Power BI em português
  baixar('leads-'+hoje+'.csv', '\uFEFF'+cols.join(';')+'\n'+linhas.join('\n'), 'text/csv;charset=utf-8');
  toast('CSV baixado — pronto pro Power BI.');
}

/* =========================================================
   12. EVENTOS
   ========================================================= */
$$('nav button').forEach(b=>b.addEventListener('click', ()=>{
  $$('nav button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');
  $$('.view').forEach(v=>v.classList.remove('on'));
  $('#v-'+b.dataset.v).classList.add('on');
  if(b.dataset.v === 'crm') renderKb();
  if(b.dataset.v === 'landings') renderLandings();
  if(b.dataset.v === 'painel') renderPainel();
}));

$('#cat').addEventListener('change', ()=> preencherNichos($('#cat').value));
$('#qSel').addEventListener('change', ()=>{
  const outro = $('#qSel').value === OUTRO;
  $('#q').style.display = outro ? '' : 'none';
  if(outro) $('#q').focus();
});

$('#uf').addEventListener('change', async ()=>{
  const uf = $('#uf').value;
  Store.set('ll_uf', uf);
  try{ await carregarMunicipios(uf); }
  catch(e){ modoCidadeLivre('A lista de cidades do IBGE não respondeu. Digite a cidade com o estado, ex: "Curitiba, PR".'); }
});
$('#cidadeSel').addEventListener('change', ()=> Store.set('ll_cidade', $('#cidadeSel').value));

$$('.chip[data-flt]').forEach(c=>c.addEventListener('click', ()=>{
  FLT[c.dataset.flt] = !FLT[c.dataset.flt];
  c.classList.toggle('on', FLT[c.dataset.flt]);
  renderRes();
}));
$('#fScore').addEventListener('change', ()=>{ FLT.score = Number($('#fScore').value) || 0; renderRes(); });
$('#fNota').addEventListener('change',  ()=>{ FLT.nota  = Number($('#fNota').value)  || 0; renderRes(); });
$('#fAval').addEventListener('change',  ()=>{ FLT.aval  = $('#fAval').value; renderRes(); });
/* ---- filtros do funil ---- */
$('#kbQ').addEventListener('input', ()=>{ KFLT.q = $('#kbQ').value; renderKb(); });
$('#kbNicho').addEventListener('change', ()=>{ KFLT.nicho = $('#kbNicho').value; renderKb(); });
$('#kbOrdem').addEventListener('change', ()=>{ KFLT.ordem = $('#kbOrdem').value; renderKb(); });
$$('.chip[data-kflt]').forEach(c=>c.addEventListener('click', ()=>{
  KFLT[c.dataset.kflt] = !KFLT[c.dataset.kflt];
  c.classList.toggle('on', KFLT[c.dataset.kflt]);
  renderKb();
}));
$('#bKbLimpa').addEventListener('click', ()=>{
  KFLT = {q:'', nicho:'', ordem:KFLT.ordem, atrasado:false, comValor:false, quente:false};
  $('#kbQ').value = ''; $('#kbNicho').value = '';
  $$('.chip[data-kflt]').forEach(c=>c.classList.remove('on'));
  renderKb();
});

/* ---- acervo de landings ---- */
$('#bLgNova').addEventListener('click', ()=> abrirLanding(null));
$('#lgFiltro').addEventListener('change', renderLandings);
$('#lgStatus').addEventListener('change', renderLandings);

$('#lgLista').addEventListener('click', e=>{
  const b = e.target.closest('button[data-lg]'); if(!b) return;
  const id = b.closest('.lgcard').dataset.id;
  if(b.dataset.lg === 'edit') abrirLanding(id);
  if(b.dataset.lg === 'ver'){
    const x = LG.find(y=>y.id===id);
    if(x && x.url) window.open(/^https?:/i.test(x.url) ? x.url : 'https://' + x.url, '_blank', 'noopener');
  }
});

// o seletor de cor e o campo de texto andam juntos
[['#lgCor','#lgCorTxt'], ['#lgCor2','#lgCor2Txt']].forEach(([c,t])=>{
  $(c).addEventListener('input', ()=> $(t).value = $(c).value);
  $(t).addEventListener('change', ()=>{
    const v = $(t).value.trim();
    if(/^#[0-9a-f]{6}$/i.test(v)) $(c).value = v;
    else $(t).value = $(c).value;   // valor inválido volta ao que estava
  });
});

$('#lgNichos').addEventListener('change', e=>{
  const cx = e.target.closest('input[type=checkbox]');
  if(cx) cx.closest('.npick').classList.toggle('on', cx.checked);
});

$('#bLgSalvar').addEventListener('click', ()=>{
  const nome = $('#lgNome').value.trim();
  if(!nome){ toast('Dê um nome para a landing.'); return; }
  const dados = {
    nome, url: $('#lgUrl').value.trim(), status: $('#lgSt').value,
    cor: $('#lgCor').value, cor2: $('#lgCor2').value,
    estilo: $('#lgEstilo').value, fonte: $('#lgFonte').value.trim(),
    clienteId: $('#lgCliente').value, nota: $('#lgNota').value.trim(),
    nichos: $$('#lgNichos input:checked').map(c=>c.value)
  };
  if(lgAtual){
    Object.assign(LG.find(x=>x.id===lgAtual), dados);
  }else{
    dados.id = 'lg-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    dados.criada = hojeISO();
    LG.unshift(dados);
  }
  lgSalvarTudo(); closeM('mLg'); renderLandings();
  toast('Landing salva.');
});

$('#bLgDel').addEventListener('click', ()=>{
  if(!lgAtual) return;
  if(!confirm('Excluir esta landing do acervo?')) return;
  LG = LG.filter(x=>x.id !== lgAtual);
  lgSalvarTudo(); closeM('mLg'); renderLandings();
  toast('Excluída do acervo.');
});

$('#bLimpaFlt').addEventListener('click', ()=>{
  FLT = {nosite:false, fone:false, quente:false, zap:false,
         semFunil:false, semWa:false, score:0, nota:0, aval:''};
  $$('.chip[data-flt]').forEach(c=>c.classList.remove('on'));
  $('#fScore').value = '0'; $('#fNota').value = '0'; $('#fAval').value = '';
  renderRes();
});

function receber(leads){
  const vistos = new Set();
  RES = leads.filter(l=>{
    const ch = (l.nome+'|'+(l.endereco||'')).toLowerCase();
    if(vistos.has(ch)) return false;
    vistos.add(ch); return true;
  });
  const nicho = nichoAtual();
  RES.forEach(l=>{ l._p = pontuar(l); l._nicho = nicho; });
  RES.sort((a,b)=> b._p.score - a._p.score);
  renderRes();
}

$('#bGo').addEventListener('click', async ()=>{
  const nicho  = nichoAtual();
  const cidade = cidadeAtual();
  const limite = Number($('#lim').value);
  const bairros = $('#bairros').value.split(',').map(s=>s.trim()).filter(Boolean);
  if(!nicho){  setStatus('Escolha o nicho na lista — ou "outro termo" para digitar.', 'err'); return; }
  if(!cidade){ setStatus('Escolha o estado e a cidade.', 'err'); return; }

  $('#bGo').disabled = true;
  try{
    receber(await buscarGoogle(nicho, cidade, limite, bairros));
    if(!RES.length) setStatus('Nenhum resultado. Tente outro termo ou confira a grafia da cidade.', 'err');
    else{
      const quentes = RES.filter(l=>l._p.faixa==='hot').length;
      const semSite = RES.filter(l=>!l.website).length;
      setStatus(`${RES.length} leads · ${quentes} quentes · ${semSite} sem site` +
                ` · ${CHAMADAS.n} consultas ao Places hoje.`);
    }
  }catch(e){
    const m = (e && e.message) || '';
    if(/Failed to fetch|NetworkError|Load failed/i.test(m) && location.protocol === 'file:'){
      setStatus('O navegador bloqueou a busca porque o arquivo foi aberto direto do disco. ' +
                'Rode por um servidor local (veja o aviso amarelo no topo da página) e tente de novo.', 'err');
    } else if(/Failed to fetch|NetworkError|Load failed/i.test(m)){
      setStatus('Não consegui falar com o servidor. Verifique sua internet e tente de novo.', 'err');
      setStatus(m || 'Falhou. Tente de novo em alguns segundos.', 'err');
    }
  }finally{
    $('#bGo').disabled = false;
  }
});

$('#res').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-a]'); if(!btn) return;
  const l = RES.find(x=>x.id === btn.closest('.lead').dataset.id); if(!l) return;
  const a = btn.dataset.a;
  if(a === 'mapa'){ window.open(l.mapa,'_blank'); return; }
  if(a === 'crm'){
    if(!CRM[l.id]){ CRM[l.id] = Object.assign({}, l, {status:'novo'}); Store.set('ll_crm', CRM);
      toast('Adicionado ao funil.'); renderRes(); }
    return;
  }
  if(a === 'msg') abrirMsg(l);
});

let msgAtual = null;
function abrirMsg(l){
  msgAtual = l;
  $('#msgTit').textContent = 'Mensagem para ' + l.nome;
  $('#msgTxt').value = montarMsg(l);
  openM('mMsg');
}
$('#bCopiar').addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText($('#msgTxt').value); toast('Copiado.'); }
  catch(e){ $('#msgTxt').select(); document.execCommand('copy'); toast('Copiado.'); }
});
$('#bWa').addEventListener('click', ()=>{
  if(!msgAtual) return;
  const url = waLink(msgAtual, $('#msgTxt').value);
  if(!url){ toast('Esse lead não tem telefone com DDD.'); return; }
  if(CRM[msgAtual.id] && CRM[msgAtual.id].status === 'novo'){
    CRM[msgAtual.id].status = 'contatado'; Store.set('ll_crm', CRM);
  }
  window.open(url, '_blank');
  closeM('mMsg');
});

$('#bAddAll').addEventListener('click', ()=>{
  let n = 0;
  visiveis().forEach(l=>{ if(!CRM[l.id]){ CRM[l.id] = Object.assign({}, l, {status:'novo'}); n++; } });
  Store.set('ll_crm', CRM); renderRes();
  toast(n ? n + ' leads no funil.' : 'Todos já estavam no funil.');
});

$('#kb').addEventListener('click', e=>{
  const b = e.target.closest('button[data-k]'); if(!b) return;
  const id = b.closest('.kcard').dataset.id, l = CRM[id]; if(!l) return;
  if(b.dataset.k === 'msg')  abrirMsg(l);
  if(b.dataset.k === 'edit') abrirLead(id);
});

/* ---- ficha do lead no funil ---- */
let leadAtual = null;
function abrirLead(id){
  const l = CRM[id]; if(!l) return;
  leadAtual = id;
  $('#leadTit').textContent = l.nome;
  $('#leadSub').innerHTML = `${l._p.score} pts · ${esc(l.categoria||'—')}` +
    (l.phone ? ` · ${esc(foneBonito(l.phone))}` : ' · sem telefone') +
    (l.website ? ` · <a href="${esc(l.website)}" target="_blank" rel="noopener">site</a>` : ' · sem site');
  $('#lEtapa').innerHTML = ETAPAS.map(e=>
    `<option value="${e.k}"${l.status===e.k?' selected':''}>${e.t}</option>`).join('');
  $('#lValor').value = l.valor || '';
  $('#lDataF').value = l.dataFech || '';
  $('#lProx').value  = l.proxContato || '';
  $('#lNota').value  = l.nota || '';
  openM('mLead');
}

$('#bLeadSalvar').addEventListener('click', ()=>{
  const l = CRM[leadAtual]; if(!l) return;
  l.status      = $('#lEtapa').value;
  l.valor       = Number($('#lValor').value) || 0;
  l.dataFech    = $('#lDataF').value;
  l.proxContato = $('#lProx').value;
  l.nota        = $('#lNota').value.trim();
  Store.set('ll_crm', CRM);
  closeM('mLead'); renderKb(); renderPainel(); renderRes();
  toast('Ficha salva.');
});

$('#bLeadDel').addEventListener('click', ()=>{
  if(!CRM[leadAtual]) return;
  if(!confirm('Remover este lead do funil? As observações e valores vão junto.')) return;
  delete CRM[leadAtual]; Store.set('ll_crm', CRM);
  closeM('mLead'); renderKb(); renderPainel(); renderRes();
  toast('Removido do funil.');
});

$('#bLimpar').addEventListener('click', ()=>{
  if(!Object.keys(CRM).length){ toast('O funil já está vazio.'); return; }
  if(confirm('Isso apaga todos os leads do funil. Baixe um backup antes se quiser guardar. Continuar?')){
    CRM = {}; Store.set('ll_crm', CRM); renderKb(); renderPainel(); toast('Funil limpo.');
  }
});

$('#bExp').addEventListener('click', exportarCSV);
$('#bBkp').addEventListener('click', ()=>openM('mBkp'));
$('#bBaixar').addEventListener('click', ()=>{
  baixar('leadlocal-backup-'+new Date().toISOString().slice(0,10)+'.json',
         JSON.stringify({cfg:CFG, crm:CRM, landings:LG}, null, 2), 'application/json');
  toast('Backup baixado.');
});
$('#bRest').addEventListener('click', ()=>$('#fBkp').click());
$('#fBkp').addEventListener('change', e=>{
  const f = e.target.files[0]; if(!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    try{
      const d = JSON.parse(fr.result);
      if(d.crm){ CRM = d.crm; Object.values(CRM).forEach(l=>{ if(!l._p) l._p = pontuar(l); }); Store.set('ll_crm', CRM); }
      if(d.cfg){ CFG = Object.assign(CFG, d.cfg); Store.set('ll_cfg', CFG); }
      if(d.landings){ LG = d.landings; lgSalvarTudo(); renderLandings(); }
      renderKb(); renderPainel(); closeM('mBkp'); toast('Backup restaurado.');
    }catch(err){ toast('Arquivo inválido.'); }
  };
  fr.readAsText(f);
  e.target.value = '';
});

$('#bCfg').addEventListener('click', ()=>{
  $('#cNome').value = CFG.nome || ''; $('#cServ').value = CFG.serv || '';
  $('#cSite').value = CFG.site || ''; $('#cKey').value  = CFG.key  || '';
  $('#cIaProv').value = CFG.iaProv || 'gemini';
  $('#cIaKey').value  = CFG.iaKey  || '';
  $('#cIaMod').value  = CFG.iaMod  || 'gemini-2.0-flash';
  $('#cMsg').value = CFG.msgPadrao != null ? CFG.msgPadrao : MSG_PADRAO;
  $('#cUazUrl').value   = CFG.uazUrl   || '';
  $('#cUazToken').value = CFG.uazToken || '';
  $('#cUazInt').value   = CFG.uazInt   || 60;
  $('#cUazLim').value   = CFG.uazLim   || 30;
  $('#uazStatus').textContent = '';
  renderSites(CFG.sites);
  openM('mCfg');
});
/* ---- site padrão por nicho ---- */
function linhaSite(nicho, url){
  const opts = NICHOS.slice().sort(ptSort)   // slice: sort() mutaria o NICHOS
    .map(n=>`<option value="${esc(n)}"${n===nicho?' selected':''}>${esc(n)}</option>`).join('');
  const d = document.createElement('div');
  d.className = 'siterow';
  d.innerHTML = `<select class="sn">${opts}</select>` +
                `<input class="su" placeholder="https://exemplo.com.br" value="${esc(url||'')}">` +
                `<button type="button" class="sx" title="remover">✕</button>`;
  d.querySelector('.sx').addEventListener('click', ()=> d.remove());
  return d;
}

function renderSites(mapa){
  const cx = $('#cSites');
  cx.innerHTML = '';
  const pares = Object.entries(mapa || {});
  if(!pares.length) cx.appendChild(linhaSite('', ''));
  else pares.forEach(([n,u]) => cx.appendChild(linhaSite(n, u)));
}

/* Lê as linhas da tela. Linha sem endereço é descartada — cadastrar nicho
   sem site não serviria para nada, e a etiqueta [link] continuaria aparecendo. */
function lerSites(){
  const out = {};
  $$('#cSites .siterow').forEach(d=>{
    const n = d.querySelector('.sn').value;
    const u = d.querySelector('.su').value.trim();
    if(n && u) out[n] = u;
  });
  return out;
}

$('#bSiteAdd').addEventListener('click', ()=> $('#cSites').appendChild(linhaSite('', '')));

$('#bSalvarCfg').addEventListener('click', ()=>{
  CFG = {nome:$('#cNome').value.trim(), serv:$('#cServ').value.trim(),
         site:$('#cSite').value.trim(), key:$('#cKey').value.trim(),
         iaProv:$('#cIaProv').value, iaKey:$('#cIaKey').value.trim(),
         iaMod:$('#cIaMod').value.trim() || 'gemini-2.0-flash',
         msgPadrao:$('#cMsg').value.trim(),
         uazUrl:$('#cUazUrl').value.trim(), uazToken:$('#cUazToken').value.trim(),
         uazInt:Math.max(20, Number($('#cUazInt').value) || 60),
         uazLim:Math.max(1,  Number($('#cUazLim').value) || 30),
         sites:lerSites()};
  Store.set('ll_cfg', CFG); closeM('mCfg'); pintarEnvio(); toast('Configurações salvas.');
});

$('#bMsgPadrao').addEventListener('click', ()=>{
  $('#cMsg').value = MSG_PADRAO;
  toast('Texto original restaurado. Salve para valer.');
});
$('#bMsgAuto').addEventListener('click', ()=>{
  $('#cMsg').value = '';
  toast('Campo vazio = voltam os três modelos automáticos por tipo de lead.');
});

$('#bUazTeste').addEventListener('click', async ()=>{
  const el = $('#uazStatus'), b = $('#bUazTeste');
  // testa o que está na tela, não o que está salvo
  const antes = {url: CFG.uazUrl, token: CFG.uazToken};
  CFG.uazUrl = $('#cUazUrl').value.trim(); CFG.uazToken = $('#cUazToken').value.trim();
  if(!CFG.uazUrl || !CFG.uazToken){
    el.textContent = 'Preencha o servidor e o token primeiro.';
    Object.assign(CFG, {uazUrl:antes.url, uazToken:antes.token});
    return;
  }
  b.disabled = true; el.textContent = 'Consultando…';
  try{
    const j = await uazStatus();
    const i = j.instance || {}, s = j.status || {};
    el.innerHTML = (s.connected || i.status === 'connected')
      ? `<span style="color:var(--ok)">✓ conectado</span> — ${esc(i.profileName || '')} · ${esc(foneBonito(i.owner || ''))}`
      : `<span style="color:var(--hot)">✕ desconectado</span> — ${esc(i.status || 'leia o QR code no painel da uazapi')}`;
  }catch(e){
    el.innerHTML = `<span style="color:var(--hot)">✕ ${esc((e && e.message) || 'falhou')}</span>`;
    Object.assign(CFG, {uazUrl:antes.url, uazToken:antes.token});
  }finally{ b.disabled = false; }
});

/* Os botões de envio ficam sempre visíveis. Escondê-los quando falta
   configuração só faz o recurso sumir sem explicação — quem clica sem
   ter configurado é levado direto ao Config. */
function pintarEnvio(){
  const on = uazPronto();
  $('#bLote').style.display   = '';
  $('#bEnviar').style.display = '';
  $('#bEnviar').title = on ? '' : 'Precisa configurar a uazapi em ⚙ Config';
  $('#bLote').title   = on ? '' : 'Precisa configurar a uazapi em ⚙ Config';
}

/* true = pode enviar. false = leva o usuário para o Config explicando. */
function exigirUaz(){
  if(uazPronto()) return true;
  toast('Configure a uazapi em ⚙ Config para enviar daqui.');
  $$('.mask').forEach(m => m.classList.remove('on'));
  $('#bCfg').click();
  return false;
}

$('#bEnviar').addEventListener('click', async ()=>{
  if(!msgAtual) return;
  if(!exigirUaz()) return;
  if(!normFone(msgAtual.phone)){ toast('Esse lead não tem telefone com DDD.'); return; }
  await atualizarEnvios();
  const impedimento = bloqueioDeEnvio();
  if(impedimento){ toast(impedimento); return; }
  const b = $('#bEnviar'), antes = b.textContent;
  b.disabled = true; b.textContent = 'Enviando…';
  try{
    await contarEnvio();                      // reserva a vaga antes de disparar
    await uazEnviar(msgAtual.phone, $('#msgTxt').value);
    CRM[msgAtual.id] = Object.assign({}, CRM[msgAtual.id] || msgAtual, {status:'contatado'});
    if(!CRM[msgAtual.id]._p) CRM[msgAtual.id]._p = msgAtual._p;
    Store.set('ll_crm', CRM);
    renderRes(); renderKb(); renderPainel();
    closeM('mMsg');
    toast(`Enviada. ${enviosHoje()} de ${uazLim()} hoje.`);
  }catch(e){
    const msg = (e && e.message) || 'Não consegui enviar.';
    if(/não tem WhatsApp/i.test(msg)){ marcarSemWa(msgAtual.phone); renderRes(); }
    toast(msg);
  }finally{ b.disabled = false; b.textContent = antes; }
});

$('#bLote').addEventListener('click', ()=>{
  if(!exigirUaz()) return;
  const leads = elegiveis(visiveis());
  if(!leads.length){ toast('Nenhum lead visível com telefone e ainda não contatado.'); return; }
  filaAbrir(leads);
});
$('#bLoteEnviar').addEventListener('click', filaEnviar);
$('#bLotePular').addEventListener('click', ()=>{
  loteLog('sk', (FILA.leads[FILA.i] || {}).nome || '', 'pulado');
  filaAvancar();
});
$('#cIaProv').addEventListener('change', ()=>{
  const p = $('#cIaProv').value, m = $('#cIaMod');
  if(p === 'gemini'     && !/gemini/.test(m.value)) m.value = 'gemini-2.0-flash';
  if(p === 'openrouter' && !/\//.test(m.value))     m.value = 'meta-llama/llama-3.3-70b-instruct:free';
  if(p === 'groq'       && !/llama/.test(m.value))  m.value = 'llama-3.3-70b-versatile';
});

$('#bIA').addEventListener('click', async ()=>{
  if(!msgAtual) return;
  const b = $('#bIA'), antes = b.textContent;
  b.disabled = true; b.textContent = 'Escrevendo…';
  try{
    $('#msgTxt').value = await escreverComIA(msgAtual, $('#msgTxt').value);
    toast('Reescrita pela IA — revise antes de mandar.');
  }catch(e){
    toast(e.message || 'A IA não respondeu.');
  }finally{
    b.disabled = false; b.textContent = antes;
  }
});
// não deixa fechar o modal enquanto uma mensagem está saindo
const podeFechar = m => !(m.id === 'mLote' && FILA.enviando);
$$('.mask').forEach(m=>m.addEventListener('click', e=>{
  if(e.target === m && podeFechar(m)) m.classList.remove('on');
}));
document.addEventListener('keydown', e=>{
  if(e.key === 'Escape') $$('.mask').forEach(m=>{ if(podeFechar(m)) m.classList.remove('on'); });
});

/* =========================================================
   13. INÍCIO
   ========================================================= */

/* ---- porta de entrada: sem login, o app não abre ---- */
function mostrarApp(usuario){
  $('#login').classList.remove('on');
  $('#quem').textContent = (usuario.email||'').split('@')[0];
  $('#quem').title = usuario.email || '';
}
function mostrarLogin(){
  $('#login').classList.add('on');
  $('#logSenha').value = '';
}

$('#loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const b = $('#bLogin'), antes = b.textContent;
  $('#logErr').textContent = '';
  b.disabled = true; b.textContent = 'Entrando…';
  try{
    const u = await Nuvem.entrar($('#logEmail').value.trim(), $('#logSenha').value);
    mostrarApp(u);
    await iniciarComNuvem();
  }catch(err){
    $('#logErr').textContent = err.message || 'Não consegui entrar.';
  }finally{ b.disabled = false; b.textContent = antes; }
});

$('#bSair').addEventListener('click', async ()=>{
  if(!confirm('Sair da conta? Os dados ficam no servidor.')) return;
  await Nuvem.sair();
  mostrarLogin();
});

/* Ao entrar: traz o que está no banco, mescla com o que existe no
   aparelho e sobe o que ficou pendente offline. */
async function iniciarComNuvem(){
  pintarSinc();
  Sinc.aoMudar(pintarSinc);
  try{
    const [ls, gs, ws] = await Promise.all([
      Nuvem.ler('leads'), Nuvem.ler('landings'), Nuvem.ler('sem_whatsapp')]);

    /* A sombra é semeada com o que o BANCO tem — não com o resultado da
       mescla. É isso que faz a migração acontecer sozinha: tudo que existe
       só neste aparelho vira diferença e entra na fila no Store.set abaixo.
       Semear com o estado mesclado deixaria os dados locais presos aqui. */
    const crmBanco = {}; ls.forEach(r=> crmBanco[r.id] = Mapa.leadDoBanco(r));
    const lgBanco  = gs.map(Mapa.landingDoBanco);
    const waBanco  = ws.map(r=>r.fone);
    Sinc.semear(crmBanco, lgBanco, waBanco);

    // mescla: em empate de id, vence quem foi alterado por último
    let sobemDaqui = 0;
    Object.values(crmBanco).forEach(vindo=>{
      const atual = CRM[vindo.id];
      if(!atual || !atual._alteradoEm || vindo._alteradoEm > atual._alteradoEm) CRM[vindo.id] = vindo;
    });
    Object.values(CRM).forEach(l=>{ if(!crmBanco[l.id]) sobemDaqui++; });

    const porId = new Map(LG.map(x=>[x.id,x]));
    lgBanco.forEach(vindo=>{
      const atual = porId.get(vindo.id);
      if(!atual || !atual._alteradoEm || vindo._alteradoEm > atual._alteradoEm) porId.set(vindo.id, vindo);
    });
    LG = Array.from(porId.values());
    waBanco.forEach(f=> SEM_WA.add(f));

    // este Store.set é o que enfileira a diferença
    Store.set('ll_crm', CRM);
    Store.set('ll_landings', LG);
    Store.set('ll_semwa', Array.from(SEM_WA));
    renderRes(); renderKb(); renderPainel(); renderLandings();

    await atualizarEnvios();
    const aSubir = Sinc.pendentes;
    if(aSubir) toast(`Subindo ${aSubir} registro${aSubir>1?'s':''} deste aparelho para a nuvem…`);
    const pend = await Sinc.esvaziar();
    if(aSubir && !pend) toast(`${aSubir} registro${aSubir>1?'s':''} na nuvem. Tudo sincronizado.`);
    console.log('[nuvem] banco: ' + ls.length + ' leads, ' + gs.length + ' landings · ' +
                'só neste aparelho: ' + sobemDaqui + ' · subiram: ' + (aSubir - pend) +
                ' · ainda pendentes: ' + pend);
    ligarTempoReal();
  }catch(e){
    toast('Entrou, mas não consegui ler o banco: ' + e.message);
  }
}

/* Alteração do colega aparece sem precisar recarregar. */
let tempoRealLigado = false;
function ligarTempoReal(){
  if(tempoRealLigado) return;
  tempoRealLigado = true;
  Nuvem.escutar('leads', carga=>{
    const r = carga.new;
    if(!r || !r.id) return;
    if(carga.eventType === 'DELETE'){ delete CRM[carga.old.id]; }
    else{
      const vindo = Mapa.leadDoBanco(r), atual = CRM[vindo.id];
      if(atual && atual._alteradoEm && vindo._alteradoEm <= atual._alteradoEm) return;
      CRM[vindo.id] = vindo;
    }
    Store.set('ll_crm', CRM);
    renderRes(); renderKb(); renderPainel();
  });
  Nuvem.escutar('landings', async ()=>{
    LG = (await Nuvem.ler('landings')).map(Mapa.landingDoBanco);
    Store.set('ll_landings', LG); renderLandings();
  });
}

/* Aviso de conexão e de fila pendente, no cabeçalho. */
function pintarSinc(){
  const el = $('#sinc'); if(!el) return;
  const p = Sinc.pendentes;
  if(!navigator.onLine){ el.textContent = 'sem conexão' + (p?` · ${p} a enviar`:''); el.className = 'sinc off'; }
  else if(p){ el.textContent = `enviando ${p}…`; el.className = 'sinc pend'; }
  else { el.textContent = 'sincronizado'; el.className = 'sinc ok'; }
}
window.addEventListener('online',  pintarSinc);
window.addEventListener('offline', pintarSinc);

Object.values(CRM).forEach(l=>{ if(!l._p) l._p = pontuar(l); });
pintarEnvio();
preencherCategorias();
preencherNichos('');

(async function iniciarLocalidades(){
  try{
    await carregarEstados();
    const ufSalva = Store.get('ll_uf', '');
    if(ufSalva){ $('#uf').value = ufSalva; await carregarMunicipios(ufSalva); }
  }catch(e){
    modoCidadeLivre('Não consegui carregar a lista do IBGE. Digite a cidade com o estado, ex: "Curitiba, PR".');
  }
})();

// Aberto direto do disco? O Chrome bloqueia chamadas de rede — avisa antes de o usuário se frustrar.
if(location.protocol === 'file:'){
  $('#noStore').innerHTML =
    '<div class="warn"><b>Abra por um servidor local para as buscas funcionarem.</b><br>' +
    'Você abriu este arquivo com duplo clique, e nesse modo o navegador bloqueia o acesso à internet ' +
    '(erro "Failed to fetch"). O conteúdo do app funciona, mas nenhuma busca vai completar.<br><br>' +
    '<b>Jeito mais fácil, se você usa o VS Code:</b> instale a extensão <b>Live Server</b>, clique com o botão ' +
    'direito neste arquivo e escolha "Open with Live Server".<br>' +
    '<b>Ou pelo Prompt de Comando</b>, dentro da pasta do arquivo: <code>python -m http.server 8000</code> ' +
    'e abra <code>http://localhost:8000/index.html</code>.<br><br>' +
    'Sem isso nenhuma busca completa.</div>';
}
if(CHAMADAS.dia !== new Date().toISOString().slice(0,10)){ CHAMADAS = {dia:'', n:0}; }
if(!CFG.key){
  setStatus('Cole sua chave do Google Places em ⚙ Config para começar a buscar.');
}
if(!Store.ok){
  $('#noStore').innerHTML = '<div class="warn"><b>Aviso:</b> este navegador está bloqueando o armazenamento local, ' +
    'então seu funil não sobrevive ao fechar a aba. Use o botão <b>Backup</b> para salvar em arquivo antes de sair.</div>';
}
renderKb(); renderPainel();

(async function verificarSessao(){
  try{
    const u = await Nuvem.sessao();
    if(u){ mostrarApp(u); await iniciarComNuvem(); }
    else mostrarLogin();
  }catch(e){
    mostrarLogin();
    $('#logErr').textContent = 'Não consegui falar com o servidor. Verifique sua internet.';
  }
})();

/* =========================================================
   14. MIGRAÇÃO E AUTOTESTE DA NUVEM
   ========================================================= */
function nlog(classe, txt){
  const cx = $('#nuvemLog'); cx.classList.add('on');
  const d = document.createElement('div');
  d.innerHTML = `<span class="${classe}">${classe==='ok'?'✓':classe==='er'?'✕':'—'}</span>` +
                `<span class="nm">${esc(txt)}</span>`;
  cx.appendChild(d); cx.scrollTop = cx.scrollHeight;
}

$('#bMigrar').addEventListener('click', async ()=>{
  if(!Nuvem.logado){ toast('Entre na conta primeiro.'); return; }
  const n = Object.keys(CRM).length, g = LG.length, w = SEM_WA.size;
  if(!n && !g && !w){ toast('Não há nada neste aparelho para subir.'); return; }
  if(!confirm(`Subir ${n} leads, ${g} landings e ${w} números sem WhatsApp para a nuvem?

` +
              'Registro que já existir lá será atualizado com a versão daqui.')) return;
  const b = $('#bMigrar'); b.disabled = true;
  $('#nuvemLog').innerHTML = '';
  nlog('sk', `enviando ${n} leads, ${g} landings, ${w} telefones…`);
  try{
    const restam = await Sinc.migrar(CRM, LG, Array.from(SEM_WA));
    if(restam) nlog('er', `${restam} não subiram — confira a conexão e tente de novo`);
    else nlog('ok', 'tudo no banco');
  }catch(e){ nlog('er', e.message); }
  finally{ b.disabled = false; pintarSinc(); }
});

$('#bAutoteste').addEventListener('click', async ()=>{
  const b = $('#bAutoteste'); b.disabled = true;
  $('#nuvemLog').innerHTML = '';
  const id = 'teste-' + Date.now().toString(36);
  try{
    nlog(Nuvem.logado ? 'ok' : 'er', Nuvem.logado ? 'sessão ativa: ' + Nuvem.usuario.email : 'sem sessão');
    if(!Nuvem.logado) throw new Error('entre na conta primeiro');

    await Nuvem.gravar('leads', {id, nome:'Teste de conexão', status:'novo'});
    nlog('ok', 'escrita aceita');

    const achou = (await Nuvem.ler('leads')).some(r=>r.id===id);
    nlog(achou?'ok':'er', achou ? 'leitura confirmou o registro' : 'gravou mas não li de volta');

    await Nuvem.apagar('leads', 'id', id);
    nlog('ok', 'remoção aceita');

    const envios = await Nuvem.enviosHoje();
    nlog('ok', `contador compartilhado responde: ${envios} envios hoje`);

    nlog('ok', 'tudo certo — a nuvem está funcionando');
  }catch(e){
    nlog('er', e.message);
    try{ await Nuvem.apagar('leads','id',id); }catch(x){}
  }finally{ b.disabled = false; }
});

$('#bVerBanco').addEventListener('click', async ()=>{
  if(!Nuvem.logado){ toast('Entre na conta primeiro.'); return; }
  const b = $('#bVerBanco'); b.disabled = true;
  $('#nuvemLog').innerHTML = '';
  try{
    const [ls, gs, ws] = await Promise.all([
      Nuvem.ler('leads'), Nuvem.ler('landings'), Nuvem.ler('sem_whatsapp')]);
    const envios = await Nuvem.enviosHoje();

    nlog('ok', `${ls.length} leads no banco · ${Object.keys(CRM).length} neste aparelho`);
    nlog('ok', `${gs.length} landings no banco · ${LG.length} neste aparelho`);
    nlog('ok', `${ws.length} números sem WhatsApp`);
    nlog('ok', `${envios} de ${uazLim()} envios usados hoje pela equipe`);

    // o que existe aqui e não chegou lá
    const idsLa = new Set(ls.map(r=>r.id));
    const faltando = Object.values(CRM).filter(l=>!idsLa.has(l.id));
    if(faltando.length){
      nlog('er', `${faltando.length} lead(s) daqui ainda não estão no banco:`);
      faltando.slice(0,8).forEach(l=> nlog('sk', l.nome));
      if(faltando.length>8) nlog('sk', `…e mais ${faltando.length-8}`);
      nlog('sk', `${Sinc.pendentes} na fila de subida`);
    }else{
      nlog('ok', 'nenhum lead deste aparelho ficou para trás');
    }

    // por etapa, que é como você enxerga o funil
    const porEtapa = ETAPAS.map(e=>{
      const n = ls.filter(r=>r.status===e.k).length;
      return n ? `${e.t}: ${n}` : null;
    }).filter(Boolean).join(' · ');
    if(porEtapa) nlog('ok', porEtapa);
  }catch(e){ nlog('er', e.message); }
  finally{ b.disabled = false; }
});
