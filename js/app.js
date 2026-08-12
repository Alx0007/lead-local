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
    }
  };
})();

let CFG   = Store.get('ll_cfg', {
  nome:'', serv:'landing pages que captam clientes pelo WhatsApp', site:'', key:'',
  iaProv:'gemini', iaKey:'', iaMod:'gemini-2.0-flash',
  msgPadrao:null,   // null = nunca mexeu, vale MSG_PADRAO. '' = modelos automáticos
  uazUrl:'', uazToken:'', uazInt:60, uazLim:30
});
let CHAMADAS = Store.get('ll_chamadas', {dia:'', n:0});   // contador de consumo da API
let CRM   = Store.get('ll_crm', {});   // id -> lead (com .status)
let RES   = [];                        // resultados da busca atual
let FLT   = {nosite:false, fone:false, quente:false};

const ETAPAS = [
  {k:'novo',       t:'Novo'},
  {k:'qualificado',t:'Qualificado'},
  {k:'contatado',  t:'Contatado'},
  {k:'negociacao', t:'Negociação'},
  {k:'fechado',    t:'Fechado'},
  {k:'perdido',    t:'Perdido'}
];

/* =========================================================
   2. DICIONÁRIO DE NICHOS (português -> etiquetas do OSM)
   ========================================================= */
const NICHOS = {
  'academia':            [['leisure','fitness_centre']],
  'crossfit':            [['leisure','fitness_centre']],
  'restaurante':         [['amenity','restaurant']],
  'pizzaria':            [['amenity','restaurant'],['amenity','fast_food']],
  'lanchonete':          [['amenity','fast_food']],
  'hamburgueria':        [['amenity','fast_food']],
  'cafeteria':           [['amenity','cafe']],
  'padaria':             [['shop','bakery']],
  'bar':                 [['amenity','bar'],['amenity','pub']],
  'sorveteria':          [['amenity','ice_cream']],
  'salão de beleza':     [['shop','hairdresser'],['shop','beauty']],
  'cabeleireiro':        [['shop','hairdresser']],
  'barbearia':           [['shop','hairdresser']],
  'estética':            [['shop','beauty']],
  'manicure':            [['shop','beauty']],
  'dentista':            [['amenity','dentist'],['healthcare','dentist']],
  'clínica odontológica':[['amenity','dentist'],['healthcare','dentist']],
  'clínica médica':      [['amenity','clinic'],['healthcare','clinic']],
  'médico':              [['amenity','doctors']],
  'psicólogo':           [['healthcare','psychotherapist']],
  'fisioterapia':        [['healthcare','physiotherapist']],
  'nutricionista':       [['healthcare','nutrition_counselling']],
  'laboratório':         [['healthcare','laboratory']],
  'veterinário':         [['amenity','veterinary']],
  'pet shop':            [['shop','pet']],
  'farmácia':            [['amenity','pharmacy']],
  'advogado':            [['office','lawyer']],
  'contabilidade':       [['office','accountant']],
  'imobiliária':         [['office','estate_agent']],
  'seguros':             [['office','insurance']],
  'arquiteto':           [['office','architect']],
  'hotel':               [['tourism','hotel']],
  'pousada':             [['tourism','guest_house']],
  'escola':              [['amenity','school']],
  'escola de idiomas':   [['amenity','language_school']],
  'autoescola':          [['amenity','driving_school']],
  'creche':              [['amenity','kindergarten']],
  'oficina mecânica':    [['shop','car_repair']],
  'lava jato':           [['shop','car_wash'],['amenity','car_wash']],
  'concessionária':      [['shop','car']],
  'borracharia':         [['shop','tyres']],
  'ótica':               [['shop','optician']],
  'joalheria':           [['shop','jewelry']],
  'loja de roupas':      [['shop','clothes']],
  'calçados':            [['shop','shoes']],
  'móveis':              [['shop','furniture']],
  'material de construção':[['shop','doityourself'],['shop','hardware'],['shop','trade']],
  'supermercado':        [['shop','supermarket']],
  'mercado':             [['shop','convenience'],['shop','supermarket']],
  'floricultura':        [['shop','florist']],
  'gráfica':             [['shop','copyshop'],['craft','printer']],
  'fotógrafo':           [['shop','photo'],['craft','photographer']],
  'lavanderia':          [['shop','laundry']],
  'tatuagem':            [['shop','tattoo']],
  'informática':         [['shop','computer']],
  'assistência técnica': [['shop','electronics'],['shop','mobile_phone']],
  'celular':             [['shop','mobile_phone']],
  'hospital':            [['amenity','hospital']],
  'restaurante italiano':[['cuisine','italian']],
  'comida japonesa':     [['cuisine','japanese'],['cuisine','sushi']],
  'churrascaria':        [['cuisine','barbecue'],['cuisine','steak_house']],
  'doceria':             [['shop','confectionery'],['shop','pastry']],
  'açaí':                [],
  'pilates':             [['leisure','fitness_centre']],
  'escola de dança':     [['leisure','dance']],
  'artes marciais':      [['sport','martial_arts']],
  'nail designer':       [['beauty','nails'],['shop','beauty']],
  'depilação':           [['shop','beauty']],
  'spa':                 [['leisure','spa'],['shop','massage']],
  'auto peças':          [['shop','car_parts']]
};

/* Agrupamento dos nichos em categorias. Serve só para a interface:
   escolher a categoria filtra a lista de nichos. Nicho que você
   adicionar em NICHOS e esquecer de citar aqui não some — cai
   sozinho no grupo "Outros". */
const CATEGORIAS = {
  'Alimentação':            ['restaurante','restaurante italiano','comida japonesa','churrascaria',
                             'pizzaria','hamburgueria','lanchonete','cafeteria','padaria','doceria',
                             'sorveteria','açaí','bar'],
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
    const soltos = Object.keys(NICHOS).filter(n=>!usados.has(n)).sort(ptSort);
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
    .replace(/\[cidade\]/gi,              l.cidade || '');
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
function contarEnvio(){
  if(ENVIOS.dia !== hojeISO()) ENVIOS = {dia: hojeISO(), n:0};
  ENVIOS.n++;
  Store.set('ll_envios', ENVIOS);
}

const uazBase   = () => (CFG.uazUrl || 'https://free.uazapi.com').replace(/\/+$/, '');
const uazPronto = () => !!(CFG.uazUrl && CFG.uazToken);
const uazInt    = () => Math.max(20, Number(CFG.uazInt) || 60);
const uazLim    = () => Math.max(1,  Number(CFG.uazLim) || 30);

async function uazChamar(caminho, opcoes){
  const o = Object.assign({}, opcoes);
  o.headers = Object.assign({'token': CFG.uazToken}, o.headers || {});
  const r = await fetch(uazBase() + caminho, o);
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error || j.message || ('HTTP ' + r.status));
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

  FILA.enviando = true; filaTique();
  // toda tentativa conta para o teto, dando certo ou não: o que pesa para o
  // WhatsApp é o tráfego que sai do número
  contarEnvio();
  try{
    await uazEnviar(l.phone, texto);
    CRM[l.id] = Object.assign({}, CRM[l.id] || l, {status:'contatado'});
    if(!CRM[l.id]._p) CRM[l.id]._p = l._p;
    Store.set('ll_crm', CRM);
    loteLog('ok', l.nome, foneBonito(l.phone));
  }catch(e){
    loteLog('er', l.nome, (e && e.message) || 'falhou');
  }
  FILA.enviando = false;
  // intervalo com variação de ±40%, para não sair num ritmo mecânico
  FILA.liberaEm = Date.now() + Math.round(uazInt() * 1000 * (0.8 + Math.random() * 0.6));
  renderRes(); renderKb(); renderPainel();
  filaAvancar();
}

/* =========================================================
   6. BUSCA — OpenStreetMap (Overpass + Nominatim)
   ========================================================= */
async function geocodar(cidade){
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=pt-BR' +
              '&countrycodes=br&q=' + encodeURIComponent(cidade);
  const r = await fetch(url, {headers:{'Accept':'application/json'}});
  if(!r.ok) throw new Error('Não consegui localizar a cidade (HTTP ' + r.status + ').');
  const j = await r.json();
  if(!j.length) throw new Error('Cidade não encontrada. Tente escrever como "Curitiba, PR".');
  return j[0];
}

function montarOverpass(nicho, areaId, limite){
  const chave = nicho.trim().toLowerCase();
  const tags  = NICHOS[chave] || [];
  const partes = tags.map(([k,v]) => `nwr["${k}"="${v}"](area.a);`);
  // busca por nome sempre entra: pega o que o dicionário não cobre
  const seguro = chave.replace(/["\\]/g,'');
  if(seguro) partes.push(`nwr["name"~"${seguro}",i](area.a);`);
  return `[out:json][timeout:60];area(${areaId})->.a;(${partes.join('')});out tags center ${limite};`;
}

async function buscarOSM(nicho, cidade, limite){
  setStatus('Localizando "' + cidade + '"…', 'load');
  const geo = await geocodar(cidade);
  if(!geo.osm_id || geo.osm_type !== 'relation')
    throw new Error('Essa cidade não tem área mapeada no OpenStreetMap. Tente a cidade principal da região.');
  const areaId = 3600000000 + Number(geo.osm_id);

  setStatus('Procurando "' + nicho + '" em ' + (geo.display_name||cidade).split(',')[0] + '…', 'load');
  const q = montarOverpass(nicho, areaId, limite);
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'data=' + encodeURIComponent(q)
  });
  if(r.status === 429 || r.status === 504)
    throw new Error('O servidor gratuito do OpenStreetMap está ocupado. Espere um minuto e tente de novo.');
  if(!r.ok) throw new Error('Falha na busca (HTTP ' + r.status + ').');
  const j = await r.json();

  return (j.elements||[]).map(e=>{
    const t = e.tags || {};
    if(!t.name) return null;
    const end = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
    const cat = t.amenity || t.shop || t.office || t.healthcare || t.leisure || t.craft || t.tourism || '';
    const lat = e.lat != null ? e.lat : (e.center ? e.center.lat : null);
    const lon = e.lon != null ? e.lon : (e.center ? e.center.lon : null);
    return {
      id: 'osm-' + e.type + '-' + e.id,
      nome: t.name,
      categoria: cat.replace(/_/g,' '),
      phone: t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile || '',
      website: t.website || t['contact:website'] ||
               (t['contact:instagram'] ? 'instagram.com/' + t['contact:instagram'].replace(/^@/,'') : ''),
      endereco: end,
      cidade: t['addr:city'] || cidade,
      rating: null, reviews: null,
      fonte: 'OpenStreetMap',
      mapa: lat != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : ''
    };
  }).filter(Boolean);
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
   8. DADOS DE EXEMPLO (pra você ver a ferramenta funcionando)
   ========================================================= */
function exemplos(){
  const base = [
    ['Academia Corpo & Forma','academia','(41) 99812-4471','',4.2,38],
    ['Studio Pilates Equilíbrio','academia','(41) 3244-1180','instagram.com/studioequilibrio',4.8,12],
    ['Smart Fit Batel','academia','(41) 3018-2200','smartfit.com.br',4.4,1820],
    ['Box CrossFit Ferro','academia','(41) 99655-2013','',4.9,26],
    ['Academia Vida Ativa','academia','(41) 99120-8876','',3.2,54],
    ['Espaço Treino Funcional','academia','','instagram.com/espacotreino',4.6,9],
    ['Power Gym Portão','academia','(41) 3376-4409','powergym.com.br',4.1,213],
    ['Studio Zen Yoga','academia','(41) 99804-3321','',5.0,7],
    ['Academia Musculação Central','academia','(41) 3232-9087','',3.8,96],
    ['Clube Atlético Bairro Alto','academia','(41) 99733-1245','facebook.com/clubebairroalto',4.3,31]
  ];
  return base.map((b,i)=>({
    id:'demo-'+i, nome:b[0], categoria:b[1], phone:b[2], website:b[3],
    endereco:'Rua Exemplo, '+(100+i*37), cidade:'Curitiba, PR',
    rating:b[4], reviews:b[5], fonte:'Exemplo',
    mapa:'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(b[0])
  }));
}

/* =========================================================
   9. RENDERIZAÇÃO — resultados
   ========================================================= */
function visiveis(){
  return RES.filter(l=>{
    if(FLT.nosite && l.website && !REDES.test(l.website)) return false;
    if(FLT.fone   && !normFone(l.phone)) return false;
    if(FLT.quente && l._p.faixa !== 'hot') return false;
    return true;
  });
}

function cardLead(l){
  const p = l._p;
  const noCrm = !!CRM[l.id];
  const wa = normFone(l.phone);
  return `
  <div class="lead ${p.faixa}" data-id="${esc(l.id)}">
    ${noCrm ? '<div class="inCrm">✓ no funil</div>' : ''}
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
      <button class="wa" data-a="msg" ${wa?'':'disabled style="opacity:.45"'}>${wa?'WhatsApp':'Sem WhatsApp'}</button>
      <button class="add" data-a="crm">${noCrm ? 'No funil' : '+ Funil'}</button>
      ${l.mapa ? `<button data-a="mapa">Mapa</button>` : ''}
    </div>
  </div>`;
}

function renderRes(){
  const box = $('#res'), v = visiveis();
  $('#resBar').style.display = RES.length ? 'flex' : 'none';
  $('#resN').textContent = RES.length ? `· ${v.length} de ${RES.length}` : '';
  if(!RES.length){ box.innerHTML = ''; return; }
  box.innerHTML = v.length ? v.map(cardLead).join('')
    : '<div class="empty">Nenhum lead passou pelos filtros. Desligue algum filtro acima.</div>';
}

/* =========================================================
   10. RENDERIZAÇÃO — funil e painel
   ========================================================= */
function renderKb(){
  const kb = $('#kb');
  kb.innerHTML = ETAPAS.map(e=>{
    const its = Object.values(CRM).filter(l=>l.status===e.k)
                      .sort((a,b)=>b._p.score - a._p.score);
    return `<div class="col" data-col="${e.k}">
      <h3>${e.t}<i>${its.length}</i></h3>
      ${its.map(l=>`
        <div class="kcard" draggable="true" data-id="${esc(l.id)}">
          <div class="nm">${esc(l.nome)}</div>
          <div class="sm">${l._p.score} pts · ${l.phone?esc(foneBonito(l.phone)):'sem telefone'}</div>
          <div class="kacts">
            <button data-k="msg">Msg</button>
            <button data-k="del">Remover</button>
          </div>
        </div>`).join('')}
    </div>`;
  }).join('');
  ligarDnD();
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
  const fech = all.filter(l=>l.status==='fechado').length;
  const trab = all.filter(l=>l.status!=='novo').length;

  $('#kpis').innerHTML = `
    <div class="kpi"><div class="v">${all.length}</div><div class="l">Leads no funil</div></div>
    <div class="kpi"><div class="v" style="color:var(--hot)">${semSite}</div><div class="l">Sem site nenhum</div></div>
    <div class="kpi"><div class="v">${media}</div><div class="l">Score médio</div></div>
    <div class="kpi"><div class="v" style="color:var(--ok)">${fech}</div><div class="l">Fechados</div></div>
    <div class="kpi"><div class="v">${trab?Math.round(fech/trab*100):0}%</div><div class="l">Conversão dos trabalhados</div></div>`;

  const max = Math.max(1, ...ETAPAS.map(e=>all.filter(l=>l.status===e.k).length));
  $('#bars').innerHTML = ETAPAS.map(e=>{
    const n = all.filter(l=>l.status===e.k).length;
    return `<div class="brow"><div class="lb">${e.t}</div>
      <div class="tr"><div class="fl" style="width:${n/max*100}%"></div></div>
      <div class="vv">${n}</div></div>`;
  }).join('');

  const top = all.filter(l=>l.status==='novo').sort((a,b)=>b._p.score-a._p.score).slice(0,8);
  $('#top').innerHTML = top.length ? top.map(l=>`
    <div class="brow"><div class="lb" style="width:190px">${esc(l.nome.slice(0,26))}</div>
      <div class="tr"><div class="fl" style="width:${l._p.score}%;background:${
        l._p.faixa==='hot'?'var(--hot)':l._p.faixa==='warm'?'var(--warm)':'var(--cold)'}"></div></div>
      <div class="vv">${l._p.score}</div></div>`).join('')
    : '<div class="empty" style="padding:20px">Nada em "Novo". Busque leads e mande pro funil.</div>';
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
                'Score','Faixa','Motivos','Endereco','Cidade','Etapa','Fonte','LinkMapa','DataCaptura'];
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
  if(b.dataset.v === 'painel') renderPainel();
}));

function pintarFonte(){
  const goo = $('input[name=src][value=google]').checked;
  $('#lbGoo').classList.toggle('on', goo);
  $('#lbOsm').classList.toggle('on', !goo);
  $('#fBairros').style.display = goo ? '' : 'none';
}
$$('input[name=src]').forEach(r=>r.addEventListener('change', pintarFonte));

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

function receber(leads){
  const vistos = new Set();
  RES = leads.filter(l=>{
    const ch = (l.nome+'|'+(l.endereco||'')).toLowerCase();
    if(vistos.has(ch)) return false;
    vistos.add(ch); return true;
  });
  RES.forEach(l=> l._p = pontuar(l));
  RES.sort((a,b)=> b._p.score - a._p.score);
  renderRes();
}

$('#bGo').addEventListener('click', async ()=>{
  const nicho  = nichoAtual();
  const cidade = cidadeAtual();
  const limite = Number($('#lim').value);
  const src    = $('input[name=src]:checked').value;
  const bairros = $('#bairros').value.split(',').map(s=>s.trim()).filter(Boolean);
  if(!nicho){  setStatus('Escolha o nicho na lista — ou "outro termo" para digitar.', 'err'); return; }
  if(!cidade){ setStatus('Escolha o estado e a cidade.', 'err'); return; }

  $('#bGo').disabled = true;
  try{
    const leads = src === 'google'
      ? await buscarGoogle(nicho, cidade, limite, bairros)
      : await buscarOSM(nicho, cidade, limite);
    receber(leads);
    if(!RES.length) setStatus('Nenhum resultado. Tente outro termo ou confira a grafia da cidade.', 'err');
    else{
      const quentes = RES.filter(l=>l._p.faixa==='hot').length;
      const semSite = RES.filter(l=>!l.website).length;
      const consumo = src === 'google' ? ` · ${CHAMADAS.n} consultas ao Places hoje` : '';
      setStatus(`${RES.length} leads · ${quentes} quentes · ${semSite} sem site${consumo}.`);
    }
  }catch(e){
    const m = (e && e.message) || '';
    if(/Failed to fetch|NetworkError|Load failed/i.test(m) && location.protocol === 'file:'){
      setStatus('O navegador bloqueou a busca porque o arquivo foi aberto direto do disco. ' +
                'Rode por um servidor local (veja o aviso amarelo no topo da página) e tente de novo.', 'err');
    } else if(/Failed to fetch|NetworkError|Load failed/i.test(m)){
      setStatus('Não consegui falar com o servidor de dados. Verifique sua internet — ou o servidor gratuito do OpenStreetMap pode estar ocupado; espere um minuto.', 'err');
    } else {
      setStatus(m || 'Falhou. Tente de novo em alguns segundos.', 'err');
    }
  }finally{
    $('#bGo').disabled = false;
  }
});

$('#bDemo').addEventListener('click', ()=>{
  receber(exemplos());
  setStatus('Mostrando 10 leads de exemplo — é só pra você ver como funciona.');
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
  if(b.dataset.k === 'msg') abrirMsg(l);
  if(b.dataset.k === 'del'){ delete CRM[id]; Store.set('ll_crm', CRM); renderKb(); renderPainel(); }
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
         JSON.stringify({cfg:CFG, crm:CRM}, null, 2), 'application/json');
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
  openM('mCfg');
});
$('#bSalvarCfg').addEventListener('click', ()=>{
  CFG = {nome:$('#cNome').value.trim(), serv:$('#cServ').value.trim(),
         site:$('#cSite').value.trim(), key:$('#cKey').value.trim(),
         iaProv:$('#cIaProv').value, iaKey:$('#cIaKey').value.trim(),
         iaMod:$('#cIaMod').value.trim() || 'gemini-2.0-flash',
         msgPadrao:$('#cMsg').value.trim(),
         uazUrl:$('#cUazUrl').value.trim(), uazToken:$('#cUazToken').value.trim(),
         uazInt:Math.max(20, Number($('#cUazInt').value) || 60),
         uazLim:Math.max(1,  Number($('#cUazLim').value) || 30)};
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

/* mostra os botões de envio só quando o gateway está configurado */
function pintarEnvio(){
  const on = uazPronto();
  $('#bLote').style.display   = on ? '' : 'none';
  $('#bEnviar').style.display = on ? '' : 'none';
}

$('#bEnviar').addEventListener('click', async ()=>{
  if(!msgAtual) return;
  if(!normFone(msgAtual.phone)){ toast('Esse lead não tem telefone com DDD.'); return; }
  if(enviosHoje() >= uazLim()){ toast(`Teto de ${uazLim()} envios por dia já atingido.`); return; }
  const b = $('#bEnviar'), antes = b.textContent;
  b.disabled = true; b.textContent = 'Enviando…';
  try{
    await uazEnviar(msgAtual.phone, $('#msgTxt').value);
    contarEnvio();
    CRM[msgAtual.id] = Object.assign({}, CRM[msgAtual.id] || msgAtual, {status:'contatado'});
    if(!CRM[msgAtual.id]._p) CRM[msgAtual.id]._p = msgAtual._p;
    Store.set('ll_crm', CRM);
    renderRes(); renderKb(); renderPainel();
    closeM('mMsg');
    toast(`Enviada. ${enviosHoje()} de ${uazLim()} hoje.`);
  }catch(e){
    toast((e && e.message) || 'Não consegui enviar.');
  }finally{ b.disabled = false; b.textContent = antes; }
});

$('#bLote').addEventListener('click', ()=>{
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
Object.values(CRM).forEach(l=>{ if(!l._p) l._p = pontuar(l); });
pintarFonte();
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
    'Enquanto isso, o botão "Ver com dados de exemplo" continua funcionando normalmente.</div>';
}
if(CHAMADAS.dia !== new Date().toISOString().slice(0,10)){ CHAMADAS = {dia:'', n:0}; }
if(!CFG.key){
  setStatus('Cole sua chave do Places em ⚙ Config para buscar no Google — ou clique em "Ver com dados de exemplo" para conhecer a ferramenta agora.');
}
if(!Store.ok){
  $('#noStore').innerHTML = '<div class="warn"><b>Aviso:</b> este navegador está bloqueando o armazenamento local, ' +
    'então seu funil não sobrevive ao fechar a aba. Use o botão <b>Backup</b> para salvar em arquivo antes de sair.</div>';
}
renderKb(); renderPainel();
