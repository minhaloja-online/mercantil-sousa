/* ============================================================
   MercadoPDV — app.js
   SPA vanilla JS + Firebase (Firestore/Auth) modo compat.
   Estrutura de dados no Firestore (ver README.md para detalhes):
     usuarios, categorias, fornecedores, clientes, produtos,
     lotes, vendas (com itens embutidos), movimentacoesEstoque,
     financeiro, despesas (cobre despesas + contas a pagar/receber),
     configuracoes/geral
   ============================================================ */

/* ---------------- Firebase init ---------------- */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
try{
  db.enablePersistence({synchronizeTabs:true}).catch(err=>{
    console.warn('Persistência offline não habilitada:', err.code);
  });
}catch(e){ console.warn(e); }

/* ---------------- Estado global (cache local dos dados) ---------------- */
const Store = {
  user:null, perfil:null, // {nome,email,papel}
  produtos:[], categorias:[], fornecedores:[], clientes:[], lotes:[],
  vendas:[], movimentacoes:[], financeiro:[], despesas:[], usuarios:[],
  config:{ nomeLoja:'MercadoPDV', tema:'light', ultimoBackup:null, numeracaoVenda:1 },
  cart:[], // {tipo:'produto'|'avulsa', produtoId, nome, unidade, qtd, precoUnit, custoUnit}
  currentView:'dashboard',
  printerDevice:null, printerChar:null,
};

/* ---------------- Utils ---------------- */
const $ = (sel,ctx=document)=>ctx.querySelector(sel);
const $all = (sel,ctx=document)=>Array.from(ctx.querySelectorAll(sel));
function el(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstElementChild; }
function fmtBRL(v){ return (Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function fmtDate(d){ if(!d) return '—'; const dt = (d instanceof Date)? d : new Date(d); return dt.toLocaleDateString('pt-BR'); }
function fmtDateTime(d){ if(!d) return '—'; const dt=(d instanceof Date)?d:new Date(d); return dt.toLocaleDateString('pt-BR')+' '+dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function uid(){ return 'id'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function diasEntre(dataFutura){ const hoje=new Date(); hoje.setHours(0,0,0,0); const d=new Date(dataFutura); d.setHours(0,0,0,0); return Math.round((d-hoje)/86400000); }
function statusValidade(dataValidade){
  if(!dataValidade) return {cor:'gray', label:'Sem validade'};
  const dias = diasEntre(dataValidade);
  if(dias<0) return {cor:'red', label:'Vencido há '+Math.abs(dias)+'d'};
  if(dias<=30) return {cor:'yellow', label:dias+'d p/ vencer'};
  return {cor:'green', label:'Mais de 60d'.replace('60',(dias>60?'60':dias))};
}
function calcMargem(custo,preco){ custo=Number(custo)||0; preco=Number(preco)||0; if(custo<=0) return 0; return ((preco-custo)/custo)*100; }
function toast(msg,type='ok'){
  const t = el(`<div class="toast ${type}">${msg}</div>`);
  $('#toast-root').appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 2600);
}
function closeModal(){ $('#modal-root').innerHTML=''; }
function openModal(innerHtml,{center=false}={}){
  $('#modal-root').innerHTML='';
  const back = el(`<div class="modal-backdrop"><div class="modal-sheet ${center?'center':''}"><div class="modal-handle"></div>${innerHtml}</div></div>`);
  back.addEventListener('click', e=>{ if(e.target===back) closeModal(); });
  $('#modal-root').appendChild(back);
  return back;
}
function fbTs(date){ return firebase.firestore.Timestamp.fromDate(date instanceof Date? date : new Date(date)); }
function toJsDate(v){ if(!v) return null; if(v.toDate) return v.toDate(); return new Date(v); }

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */
function applyRoleVisibility(){
  const papel = Store.perfil?.papel || 'caixa';
  $all('[data-role]').forEach(node=>{
    const allowed = node.getAttribute('data-role').split(',');
    node.classList.toggle('role-hide', !allowed.includes(papel));
  });
  // Caixa: acesso restrito (PDV + dashboard). Operador: + estoque/produtos. Admin: tudo.
  const navMap = { 'financeiro': ['admin'], };
  $all('.nav-btn').forEach(btn=>{
    const v = btn.dataset.view;
    if(navMap[v] && !navMap[v].includes(papel)) btn.classList.add('hidden'); else btn.classList.remove('hidden');
  });
}

auth.onAuthStateChanged(async (user)=>{
  if(user){
    Store.user = user;
    let doc;
    try{ doc = await db.collection('usuarios').doc(user.uid).get(); }catch(e){ doc=null; }
    if(doc && doc.exists){
      Store.perfil = doc.data();
    } else {
      // Primeiro login sem perfil ainda gravado (ex: acabou de criar a conta)
      Store.perfil = { nome:user.email.split('@')[0], email:user.email, papel:'admin', ativo:true };
      await db.collection('usuarios').doc(user.uid).set(Store.perfil).catch(()=>{});
    }
    $('#loading-screen').classList.add('hidden');
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#user-info-box').textContent = `${Store.perfil.nome} · ${Store.perfil.email} · perfil: ${Store.perfil.papel}`;
    applyRoleVisibility();
    attachListeners();
  } else {
    Store.user=null; Store.perfil=null;
    $('#loading-screen').classList.add('hidden');
    $('#app').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
  }
});

$('#login-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const senha = $('#login-password').value;
  $('#login-error').classList.add('hidden');
  try{
    await auth.signInWithEmailAndPassword(email, senha);
  }catch(err){
    $('#login-error').textContent = traduzErroAuth(err.code);
    $('#login-error').classList.remove('hidden');
  }
});

$('#btn-create-account').addEventListener('click', async ()=>{
  const email = $('#login-email').value.trim();
  const senha = $('#login-password').value;
  if(!email || !senha || senha.length<6){
    $('#login-error').textContent='Preencha e-mail e uma senha com 6+ caracteres, depois toque em "Criar primeiro acesso".';
    $('#login-error').classList.remove('hidden');
    return;
  }
  try{
    const cred = await auth.createUserWithEmailAndPassword(email, senha);
    await db.collection('usuarios').doc(cred.user.uid).set({ nome:email.split('@')[0], email, papel:'admin', ativo:true, criadoEm:new Date().toISOString() });
    toast('Conta criada! Bem-vindo(a).');
  }catch(err){
    $('#login-error').textContent = traduzErroAuth(err.code);
    $('#login-error').classList.remove('hidden');
  }
});

function traduzErroAuth(code){
  const map = {
    'auth/invalid-email':'E-mail inválido.',
    'auth/user-not-found':'Usuário não encontrado.',
    'auth/wrong-password':'Senha incorreta.',
    'auth/invalid-credential':'E-mail ou senha incorretos.',
    'auth/email-already-in-use':'Este e-mail já tem uma conta — faça login normalmente.',
    'auth/weak-password':'Senha muito fraca (mínimo 6 caracteres).',
    'auth/network-request-failed':'Falha de conexão. Verifique sua internet.',
    'auth/configuration-not-found': 'Configuração do Firebase incompleta — revise firebase-config.js e habilite o Authentication por E-mail/Senha no console do Firebase.',
  };
  return map[code] || ('Erro: '+code);
}

function logout(){ auth.signOut(); }
$('#btn-logout').addEventListener('click', logout);
$('#btn-logout-2').addEventListener('click', logout);

/* ============================================================
   LISTENERS FIRESTORE (tempo real + cache offline automático)
   ============================================================ */
let listenersAttached=false;
function attachListeners(){
  if(listenersAttached) return; listenersAttached=true;

  db.collection('configuracoes').doc('geral').onSnapshot(doc=>{
    if(doc.exists) Store.config = Object.assign(Store.config, doc.data());
    $('#store-name').textContent = Store.config.nomeLoja || 'MercadoPDV';
    $('#cfg-nome-loja').value = Store.config.nomeLoja || '';
    if(Store.config.ultimoBackup) $('#backup-info').textContent = 'Último backup: '+fmtDateTime(Store.config.ultimoBackup);
    setTheme(Store.config.temaPreferido || localStorage.getItem('tema') || 'light', false);
  }, err=>console.warn('config', err));

  const bind = (colName, arrName, cb)=>{
    db.collection(colName).onSnapshot(snap=>{
      Store[arrName] = snap.docs.map(d=>({id:d.id, ...d.data()}));
      if(cb) cb();
      onDataChanged();
    }, err=>{ console.warn(colName, err.message); onSyncStatus(false); });
  };
  bind('produtos','produtos');
  bind('categorias','categorias', renderCategoriaChips);
  bind('fornecedores','fornecedores');
  bind('clientes','clientes');
  bind('lotes','lotes');
  bind('vendas','vendas');
  bind('movimentacoesEstoque','movimentacoes');
  bind('financeiro','financeiro');
  bind('despesas','despesas');
  bind('usuarios','usuarios');

  // status de conexão
  window.addEventListener('online', ()=>onSyncStatus(true));
  window.addEventListener('offline', ()=>onSyncStatus(false));
  onSyncStatus(navigator.onLine);
}

function onSyncStatus(online){
  const box = $('#sync-status');
  box.classList.toggle('offline', !online);
  $('#sync-text').textContent = online ? 'Sincronizado' : 'Offline — dados salvos localmente';
}

let renderScheduled=false;
function onDataChanged(){
  onSyncStatus(navigator.onLine);
  if(renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(()=>{
    renderScheduled=false;
    computeAlerts();
    renderCurrentView();
  });
}

function renderCurrentView(){
  switch(Store.currentView){
    case 'dashboard': renderDashboard(); break;
    case 'pdv': renderPdvList(); renderCartBadge(); break;
    case 'produtos': renderProdutosList(); break;
    case 'estoque': renderLotes(); renderMovimentacoes(); renderInventario(); break;
    case 'financeiro': renderFinanceiro(); break;
    case 'relatorios': renderRelatorioAtual(); break;
    case 'config': renderUsuarios(); break;
  }
}

/* ============================================================
   ROTEADOR / NAVEGAÇÃO
   ============================================================ */
function showView(name){
  Store.currentView = name;
  $all('.view').forEach(v=>v.classList.remove('active'));
  const target = $('#view-'+(name==='mais'?'config':name));
  if(target) target.classList.add('active');
  $all('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  renderCurrentView();
  window.scrollTo(0,0);
}
$all('.nav-btn').forEach(btn=> btn.addEventListener('click', ()=> showView(btn.dataset.view)));

/* ============================================================
   ALERTAS (vencendo, vencidos, estoque baixo)
   ============================================================ */
let Alerts = { vencendo7:[], vencendo30:[], vencidos:[], estoqueBaixo:[] };
function computeAlerts(){
  Alerts = { vencendo7:[], vencendo30:[], vencidos:[], estoqueBaixo:[] };
  Store.lotes.forEach(l=>{
    if(!l.dataValidade) return;
    const dias = diasEntre(toJsDate(l.dataValidade));
    const prod = Store.produtos.find(p=>p.id===l.produtoId);
    const item = {...l, produtoNome: prod?prod.nome:'(produto removido)', dias};
    if(dias<0) Alerts.vencidos.push(item);
    else if(dias<=7) Alerts.vencendo7.push(item);
    else if(dias<=30) Alerts.vencendo30.push(item);
  });
  Store.produtos.forEach(p=>{
    if(Number(p.estoqueAtual)<=Number(p.estoqueMinimo||0)) Alerts.estoqueBaixo.push(p);
  });
  const total = Alerts.vencendo7.length + Alerts.vencidos.length + Alerts.estoqueBaixo.length;
  $('#alert-dot').classList.toggle('hidden', total===0);
}
$('#btn-alerts').addEventListener('click', ()=>{
  showView('dashboard');
  document.getElementById('dash-alerts').scrollIntoView({behavior:'smooth'});
});

/* ============================================================
   DASHBOARD
   ============================================================ */
function vendasDoDia(dateStr){
  return Store.vendas.filter(v=> (v.data||'').slice(0,10) === dateStr && v.status!=='cancelada');
}
function vendasDoMes(anoMes){ // 'YYYY-MM'
  return Store.vendas.filter(v=> (v.data||'').slice(0,7) === anoMes && v.status!=='cancelada');
}
function renderDashboard(){
  const hoje = todayStr();
  const mesAtual = hoje.slice(0,7);
  const vHoje = vendasDoDia(hoje);
  const vMes = vendasDoMes(mesAtual);
  const fatHoje = vHoje.reduce((s,v)=>s+Number(v.total||0),0);
  const fatMes = vMes.reduce((s,v)=>s+Number(v.total||0),0);
  const lucroHoje = vHoje.reduce((s,v)=>s+Number(v.lucro||0),0);
  const ticketMedio = vHoje.length? fatHoje/vHoje.length : 0;
  const estoqueTotal = Store.produtos.reduce((s,p)=>s+Number(p.estoqueAtual||0),0);

  // Alertas banner
  const ab = $('#dash-alerts'); ab.innerHTML='';
  if(Alerts.vencidos.length) ab.appendChild(el(`<div class="alert-banner danger">❌ <span><b>${Alerts.vencidos.length} produto(s)</b> vencido(s) — retire do estoque ou dê baixa.</span></div>`));
  if(Alerts.vencendo7.length) ab.appendChild(el(`<div class="alert-banner danger">⚠ <span><b>${Alerts.vencendo7.length} produto(s)</b> vencem em até 7 dias.</span></div>`));
  if(Alerts.vencendo30.length) ab.appendChild(el(`<div class="alert-banner warn">⏰ <span><b>${Alerts.vencendo30.length} produto(s)</b> vencem em até 30 dias.</span></div>`));
  if(Alerts.estoqueBaixo.length) ab.appendChild(el(`<div class="alert-banner warn">📦 <span><b>${Alerts.estoqueBaixo.length} produto(s)</b> com estoque baixo.</span></div>`));

  $('#dash-stats-today').innerHTML = `
    <div class="stat-card"><span class="ic">💰</span><span class="val mono">${fmtBRL(fatHoje)}</span><span class="lbl">Faturamento do dia</span></div>
    <div class="stat-card"><span class="ic">📈</span><span class="val mono">${fmtBRL(lucroHoje)}</span><span class="lbl">Lucro do dia</span></div>
    <div class="stat-card"><span class="ic">🛒</span><span class="val mono">${vHoje.length}</span><span class="lbl">Vendas hoje</span></div>
    <div class="stat-card"><span class="ic">📊</span><span class="val mono">${fmtBRL(ticketMedio)}</span><span class="lbl">Ticket médio</span></div>`;

  $('#dash-stats-general').innerHTML = `
    <div class="stat-card"><span class="ic">💰</span><span class="val mono">${fmtBRL(fatMes)}</span><span class="lbl">Faturamento do mês</span></div>
    <div class="stat-card"><span class="ic">📦</span><span class="val mono">${estoqueTotal}</span><span class="lbl">Itens em estoque</span></div>
    <div class="stat-card ${Alerts.estoqueBaixo.length?'warn':''}"><span class="ic">⚠</span><span class="val mono">${Alerts.estoqueBaixo.length}</span><span class="lbl">Estoque baixo</span></div>
    <div class="stat-card ${Alerts.vencidos.length?'danger':(Alerts.vencendo30.length?'warn':'')}"><span class="ic">⏰</span><span class="val mono">${Alerts.vencendo30.length}</span><span class="lbl">Vencendo em 30 dias</span></div>`;

  renderChartVendasDia();
  renderChartLucroMes();
  renderChartTopProdutos();
  renderChartTopCategorias();
}

let charts = {};
function upsertChart(id, config){
  const ctx = document.getElementById(id);
  if(!ctx) return;
  if(charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, config);
}
const chartColors = ['#1B7A43','#E0703A','#2E7FB8','#C98A1E','#C6403F','#5B6B60','#3FBE73','#8A9990'];

function renderChartVendasDia(){
  const dias=[]; const valores=[];
  for(let i=13;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i);
    const ds = d.toISOString().slice(0,10);
    dias.push(ds.slice(5).split('-').reverse().join('/'));
    valores.push(vendasDoDia(ds).reduce((s,v)=>s+Number(v.total||0),0));
  }
  upsertChart('chart-vendas-dia', {type:'line', data:{labels:dias, datasets:[{label:'Vendas (R$)', data:valores, borderColor:chartColors[0], backgroundColor:'rgba(27,122,67,.12)', fill:true, tension:.3}]}, options: baseChartOpts()});
}
function renderChartLucroMes(){
  const labels=[]; const valores=[];
  for(let i=5;i>=0;i--){
    const d=new Date(); d.setMonth(d.getMonth()-i);
    const ym = d.toISOString().slice(0,7);
    labels.push(d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}));
    valores.push(vendasDoMes(ym).reduce((s,v)=>s+Number(v.lucro||0),0));
  }
  upsertChart('chart-lucro-mes', {type:'bar', data:{labels, datasets:[{label:'Lucro (R$)', data:valores, backgroundColor:chartColors[1]}]}, options: baseChartOpts()});
}
function renderChartTopProdutos(){
  const contagem={};
  Store.vendas.forEach(v=> (v.itens||[]).forEach(it=>{ if(it.tipo==='produto'){ contagem[it.nome]=(contagem[it.nome]||0)+Number(it.quantidade||0);} }));
  const arr = Object.entries(contagem).sort((a,b)=>b[1]-a[1]).slice(0,6);
  upsertChart('chart-top-produtos', {type:'bar', data:{labels:arr.map(a=>a[0]), datasets:[{label:'Unidades vendidas', data:arr.map(a=>a[1]), backgroundColor:chartColors[2]}]}, options: {...baseChartOpts(), indexAxis:'y'}});
}
function renderChartTopCategorias(){
  const contagem={};
  Store.vendas.forEach(v=> (v.itens||[]).forEach(it=>{
    if(it.tipo!=='produto') return;
    const prod = Store.produtos.find(p=>p.id===it.produtoId);
    const cat = Store.categorias.find(c=>c.id===prod?.categoriaId);
    const nome = cat? cat.nome : 'Sem categoria';
    contagem[nome] = (contagem[nome]||0) + Number(it.subtotal||0);
  }));
  const arr = Object.entries(contagem).sort((a,b)=>b[1]-a[1]).slice(0,6);
  upsertChart('chart-top-categorias', {type:'doughnut', data:{labels:arr.map(a=>a[0]), datasets:[{data:arr.map(a=>a[1]), backgroundColor:chartColors}]}, options: baseChartOpts()});
}
function baseChartOpts(){
  const dark = document.documentElement.getAttribute('data-theme')==='dark';
  const textColor = dark? '#93A69B':'#5B6B60';
  return { responsive:true, maintainAspectRatio:false, plugins:{legend:{labels:{color:textColor, font:{size:11}}}}, scales:{ x:{ticks:{color:textColor}, grid:{display:false}}, y:{ticks:{color:textColor}, grid:{color:dark?'#243530':'#EEF2EE'}} } };
}

/* ============================================================
   PRODUTOS
   ============================================================ */
let produtosFiltroCategoria = 'todas';
function renderCategoriaChips(){
  const box = $('#produtos-filtro-categoria');
  if(!box) return;
  box.innerHTML = `<button class="chip ${produtosFiltroCategoria==='todas'?'active':''}" data-cat="todas">Todas</button>` +
    Store.categorias.map(c=>`<button class="chip ${produtosFiltroCategoria===c.id?'active':''}" data-cat="${c.id}">${c.nome}</button>`).join('');
  $all('[data-cat]', box).forEach(b=> b.addEventListener('click', ()=>{ produtosFiltroCategoria=b.dataset.cat; renderCategoriaChips(); renderProdutosList(); }));
}

function produtoThumb(p){
  return p.foto ? `<img src="${p.foto}">` : '📦';
}
function renderProdutosList(){
  const list = $('#produtos-list'); if(!list) return;
  const q = ($('#produtos-search').value||'').toLowerCase();
  let arr = Store.produtos.filter(p=>{
    const matchQ = !q || (p.nome||'').toLowerCase().includes(q) || (p.codigoBarras||'').includes(q);
    const matchCat = produtosFiltroCategoria==='todas' || p.categoriaId===produtosFiltroCategoria;
    return matchQ && matchCat;
  }).sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
  if(!arr.length){ list.innerHTML = `<div class="empty-state"><div class="ic">📦</div>Nenhum produto encontrado.</div>`; return; }
  list.innerHTML = arr.map(p=>{
    const st = statusValidadeProduto(p);
    return `<div class="list-row" data-id="${p.id}">
      <div class="thumb">${produtoThumb(p)}</div>
      <div class="info">
        <div class="t1">${p.nome}</div>
        <div class="t2">${p.unidade||'UN'} · estoque ${p.estoqueAtual??0} ${Number(p.estoqueAtual)<=Number(p.estoqueMinimo||0)?'<span class="badge red">baixo</span>':''} ${st?`<span class="badge ${st.cor}">${st.label}</span>`:''}</div>
      </div>
      <div class="right"><div class="price mono">${fmtBRL(p.preco)}</div><div class="text-sm text-dim">custo ${fmtBRL(p.custo)}</div></div>
    </div>`;
  }).join('');
  $all('.list-row', list).forEach(row=> row.addEventListener('click', ()=> openProdutoForm(row.dataset.id)));
}
function statusValidadeProduto(p){
  const lotesProduto = Store.lotes.filter(l=>l.produtoId===p.id && l.dataValidade);
  if(!lotesProduto.length) return null;
  const proximo = lotesProduto.sort((a,b)=> toJsDate(a.dataValidade)-toJsDate(b.dataValidade))[0];
  return statusValidade(toJsDate(proximo.dataValidade));
}
$('#produtos-search').addEventListener('input', renderProdutosList);

function openProdutoForm(id){
  const p = id ? Store.produtos.find(x=>x.id===id) : {};
  const catOptions = Store.categorias.map(c=>`<option value="${c.id}" ${p.categoriaId===c.id?'selected':''}>${c.nome}</option>`).join('');
  const fornOptions = Store.fornecedores.map(f=>`<option value="${f.id}" ${p.fornecedorId===f.id?'selected':''}>${f.nome}</option>`).join('');
  const html = `
    <div class="modal-head"><h3>${id?'Editar produto':'Novo produto'}</h3><button class="btn-icon" onclick="closeModal()">✕</button></div>
    <div class="field-row"><div class="field" style="flex:2"><label>Nome *</label><input id="pf-nome" value="${p.nome||''}"></div></div>
    <div class="field-row">
      <div class="field"><label>Código de barras</label><input id="pf-codigo" value="${p.codigoBarras||''}"></div>
      <button class="btn-icon" style="margin-top:22px" onclick="abrirScannerPara('pf-codigo')">📷</button>
    </div>
    <div class="field-row">
      <div class="field"><label>Categoria</label><select id="pf-categoria"><option value="">—</option>${catOptions}</select></div>
      <div class="field"><label>Marca</label><input id="pf-marca" value="${p.marca||''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Unidade</label><select id="pf-unidade">
        ${['UN','KG','LT','CX'].map(u=>`<option ${p.unidade===u?'selected':''}>${u}</option>`).join('')}
      </select></div>
      <div class="field"><label>Fornecedor</label><select id="pf-fornecedor"><option value="">—</option>${fornOptions}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Custo (R$) *</label><input id="pf-custo" type="number" step="0.01" value="${p.custo??''}"></div>
      <div class="field"><label>Preço de venda (R$) *</label><input id="pf-preco" type="number" step="0.01" value="${p.preco??''}"></div>
    </div>
    <div class="card mb-0" style="padding:10px 14px;"><span class="text-sm text-dim">Margem de lucro:</span> <b id="pf-margem" class="mono">0%</b></div>
    <div class="field-row mt-2">
      <div class="field"><label>Estoque atual</label><input id="pf-estoque-atual" type="number" step="0.001" value="${p.estoqueAtual??0}"></div>
      <div class="field"><label>Estoque mínimo</label><input id="pf-estoque-minimo" type="number" step="0.001" value="${p.estoqueMinimo??0}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Localização</label><input id="pf-localizacao" value="${p.localizacao||''}" placeholder="Ex: Corredor 3"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Data de fabricação</label><input id="pf-fabricacao" type="date" value="${p.dataFabricacao||''}"></div>
      <div class="field"><label>Data de validade</label><input id="pf-validade" type="date" value="${p.dataValidade||''}"></div>
    </div>
    <div class="field"><label>Foto do produto</label><input id="pf-foto" type="file" accept="image/*" capture="environment"></div>
    <div class="perf"></div>
    <div class="fw-grid">
      ${id?'<button class="btn btn-danger" id="pf-excluir">Excluir</button>':'<div></div>'}
      <button class="btn btn-primary" id="pf-salvar">Salvar produto</button>
    </div>`;
  openModal(html);
  const custoEl=$('#pf-custo'), precoEl=$('#pf-preco'), margemEl=$('#pf-margem');
  const atualizaMargem = ()=>{ margemEl.textContent = calcMargem(custoEl.value, precoEl.value).toFixed(2)+'%'; };
  custoEl.addEventListener('input', atualizaMargem); precoEl.addEventListener('input', atualizaMargem); atualizaMargem();
  let fotoBase64 = p.foto || null;
  $('#pf-foto').addEventListener('change', (e)=>{
    const f = e.target.files[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{ fotoBase64 = reader.result; };
    reader.readAsDataURL(f);
  });
  if(id) $('#pf-excluir').addEventListener('click', async ()=>{
    if(!confirm('Excluir este produto? Esta ação não pode ser desfeita.')) return;
    await db.collection('produtos').doc(id).delete();
    closeModal(); toast('Produto excluído.');
  });
  $('#pf-salvar').addEventListener('click', async ()=>{
    const nome = $('#pf-nome').value.trim();
    const custo = parseFloat($('#pf-custo').value)||0;
    const preco = parseFloat($('#pf-preco').value)||0;
    if(!nome || !preco){ toast('Preencha nome e preço de venda.','err'); return; }
    const data = {
      nome, codigoBarras: $('#pf-codigo').value.trim(), categoriaId: $('#pf-categoria').value,
      marca: $('#pf-marca').value.trim(), unidade: $('#pf-unidade').value, fornecedorId: $('#pf-fornecedor').value,
      custo, preco, margem: calcMargem(custo,preco),
      estoqueAtual: parseFloat($('#pf-estoque-atual').value)||0, estoqueMinimo: parseFloat($('#pf-estoque-minimo').value)||0,
      localizacao: $('#pf-localizacao').value.trim(),
      dataFabricacao: $('#pf-fabricacao').value || null, dataValidade: $('#pf-validade').value || null,
      foto: fotoBase64, atualizadoEm: new Date().toISOString(),
    };
    try{
      if(id){ await db.collection('produtos').doc(id).update(data); toast('Produto atualizado!'); }
      else { data.criadoEm = new Date().toISOString(); await db.collection('produtos').add(data); toast('Produto cadastrado!'); }
      closeModal();
    }catch(err){ toast('Erro ao salvar: '+err.message,'err'); }
  });
}
$('#btn-novo-produto').addEventListener('click', ()=>openProdutoForm(null));

/* ============================================================
   LEITOR DE CÓDIGO DE BARRAS (câmera, via html5-qrcode)
   ============================================================ */
let html5QrInstance = null;
function abrirScannerPara(targetInputId){
  const html = `
    <div class="modal-head"><h3>Ler código de barras</h3><button class="btn-icon" onclick="fecharScanner()">✕</button></div>
    <div class="scanner-video" id="scanner-region"></div>
    <p class="text-sm text-dim mt-2">Aponte a câmera para o código de barras do produto.</p>`;
  openModal(html, {center:true});
  html5QrInstance = new Html5Qrcode('scanner-region');
  const config = { fps:10, qrbox:{width:250,height:130}, formatsToSupport:[
      Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.QR_CODE ] };
  html5QrInstance.start({facingMode:"environment"}, config, (decodedText)=>{
    const input = document.getElementById(targetInputId);
    if(input){ input.value = decodedText; input.dispatchEvent(new Event('input')); }
    if(targetInputId==='pdv-search'){ renderPdvList(); }
    fecharScanner();
    toast('Código lido: '+decodedText);
  }, ()=>{ /* ignora frames sem leitura */ }).catch(err=>{
    toast('Não foi possível acessar a câmera. Verifique as permissões.','err');
    closeModal();
  });
}
function fecharScanner(){
  if(html5QrInstance){ html5QrInstance.stop().then(()=>html5QrInstance.clear()).catch(()=>{}); html5QrInstance=null; }
  closeModal();
}
$('#btn-scan-produtos').addEventListener('click', ()=>abrirScannerPara('produtos-search'));
$('#btn-scan-pdv').addEventListener('click', ()=>abrirScannerPara('pdv-search'));

/* ============================================================
   IMPORTAÇÃO / EXPORTAÇÃO DE PRODUTOS (Excel)
   ============================================================ */
$('#btn-export-excel').addEventListener('click', ()=>{
  const rows = Store.produtos.map(p=>({
    Nome:p.nome, CodigoBarras:p.codigoBarras, Categoria:(Store.categorias.find(c=>c.id===p.categoriaId)||{}).nome||'',
    Marca:p.marca, Unidade:p.unidade, Fornecedor:(Store.fornecedores.find(f=>f.id===p.fornecedorId)||{}).nome||'',
    Custo:p.custo, Preco:p.preco, EstoqueAtual:p.estoqueAtual, EstoqueMinimo:p.estoqueMinimo,
    Localizacao:p.localizacao, DataFabricacao:p.dataFabricacao, DataValidade:p.dataValidade
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
  XLSX.writeFile(wb, 'produtos_'+todayStr()+'.xlsx');
});
$('#btn-import-excel').addEventListener('click', ()=> $('#input-import-excel').click());
$('#input-import-excel').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async (evt)=>{
    try{
      const wb = XLSX.read(evt.target.result, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      if(!rows.length){ toast('Planilha vazia.','err'); return; }
      if(!confirm(`Importar ${rows.length} produto(s) da planilha?`)) return;
      const batch = db.batch();
      rows.forEach(r=>{
        const ref = db.collection('produtos').doc();
        const custo = parseFloat(r.Custo)||0, preco = parseFloat(r.Preco)||0;
        batch.set(ref, {
          nome: String(r.Nome||'').trim(), codigoBarras: String(r.CodigoBarras||'').trim(),
          categoriaId:'', marca:r.Marca||'', unidade:r.Unidade||'UN', fornecedorId:'',
          custo, preco, margem: calcMargem(custo,preco),
          estoqueAtual: parseFloat(r.EstoqueAtual)||0, estoqueMinimo: parseFloat(r.EstoqueMinimo)||0,
          localizacao:r.Localizacao||'', dataFabricacao:r.DataFabricacao||null, dataValidade:r.DataValidade||null,
          criadoEm:new Date().toISOString(),
        });
      });
      await batch.commit();
      toast(rows.length+' produto(s) importado(s)!');
    }catch(err){ toast('Erro ao importar: '+err.message,'err'); }
    e.target.value='';
  };
  reader.readAsArrayBuffer(file);
});

/* ============================================================
   PDV — FRENTE DE CAIXA
   ============================================================ */
function renderPdvList(){
  const list = $('#pdv-product-list'); if(!list) return;
  const q = ($('#pdv-search').value||'').toLowerCase();
  let arr = Store.produtos;
  if(q) arr = arr.filter(p=> (p.nome||'').toLowerCase().includes(q) || (p.codigoBarras||'').includes(q));
  arr = arr.slice().sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
  if(!arr.length){ list.innerHTML = `<div class="empty-state"><div class="ic">🔍</div>Nenhum produto encontrado.<br>Use "Venda avulsa" para frutas e verduras.</div>`; return; }
  list.innerHTML = arr.map(p=>{
    const semEstoque = Number(p.estoqueAtual||0) <= 0;
    return `<div class="list-row" data-id="${p.id}" style="${semEstoque?'opacity:.5':''}">
      <div class="thumb">${produtoThumb(p)}</div>
      <div class="info"><div class="t1">${p.nome}</div><div class="t2">${p.unidade||'UN'} · estoque ${p.estoqueAtual??0}</div></div>
      <div class="right"><div class="price mono">${fmtBRL(p.preco)}</div></div>
    </div>`;
  }).join('');
  $all('.list-row', list).forEach(row=> row.addEventListener('click', ()=>{
    const p = Store.produtos.find(x=>x.id===row.dataset.id);
    if(Number(p.estoqueAtual||0)<=0){ toast('Produto sem estoque disponível.','err'); return; }
    addToCart(p); toast(p.nome+' adicionado ✓');
  }));
}
$('#pdv-search').addEventListener('input', renderPdvList);

function addToCart(produto, qtd=1){
  const existente = Store.cart.find(c=>c.produtoId===produto.id && c.tipo==='produto');
  if(existente) existente.qtd += qtd;
  else Store.cart.push({ key:uid(), tipo:'produto', produtoId:produto.id, nome:produto.nome, unidade:produto.unidade||'UN', qtd, precoUnit:Number(produto.preco)||0, custoUnit:Number(produto.custo)||0 });
  renderCartBadge();
}
function renderCartBadge(){ $('#cart-count').textContent = Store.cart.reduce((s,c)=>s+Number(c.qtd),0); }

$('#btn-venda-avulsa').addEventListener('click', ()=>{
  const html = `
    <div class="modal-head"><h3>🍌 Venda avulsa</h3><button class="btn-icon" onclick="closeModal()">✕</button></div>
    <div class="field"><label>Nome (ex: Banana, Tomate, Alface)</label><input id="av-nome" placeholder="Banana"></div>
    <div class="field-row">
      <div class="field"><label>Quantidade (Kg)</label><input id="av-qtd" type="number" step="0.001" placeholder="2,5"></div>
      <div class="field"><label>Valor por Kg (R$)</label><input id="av-valor" type="number" step="0.01" placeholder="6,90"></div>
    </div>
    <div class="card mb-0" style="padding:10px 14px"><span class="text-sm text-dim">Total:</span> <b id="av-total" class="mono">R$ 0,00</b></div>
    <div class="fw-grid mt-3"><div></div><button class="btn btn-primary" id="av-add">Adicionar à venda</button></div>`;
  openModal(html, {center:true});
  const qtdEl=$('#av-qtd'), valorEl=$('#av-valor'), totalEl=$('#av-total');
  const upd = ()=>{ totalEl.textContent = fmtBRL((parseFloat(qtdEl.value)||0)*(parseFloat(valorEl.value)||0)); };
  qtdEl.addEventListener('input', upd); valorEl.addEventListener('input', upd);
  $('#av-add').addEventListener('click', ()=>{
    const nome = $('#av-nome').value.trim() || 'Item avulso';
    const qtd = parseFloat(qtdEl.value)||0, valor = parseFloat(valorEl.value)||0;
    if(qtd<=0 || valor<=0){ toast('Informe quantidade e valor por Kg.','err'); return; }
    Store.cart.push({ key:uid(), tipo:'avulsa', produtoId:null, nome, unidade:'KG', qtd, precoUnit:valor, custoUnit:0 });
    renderCartBadge(); closeModal(); toast(nome+' adicionado ✓');
  });
});

function cartTotal(){ return Store.cart.reduce((s,c)=>s+c.qtd*c.precoUnit,0); }
function renderCarrinhoModal(){
  const html = `
    <div class="modal-head"><h3>Carrinho</h3><button class="btn-icon" onclick="closeModal()">✕</button></div>
    <div id="cart-items"></div>
    <div class="perf"></div>
    <div class="cart-total-row"><span class="lbl">Total</span><span class="val mono">${fmtBRL(cartTotal())}</span></div>
    <button class="btn btn-primary btn-block btn-lg" id="btn-finalizar-venda" ${!Store.cart.length?'disabled':''}>Finalizar venda</button>`;
  openModal(html);
  renderCartItems();
  $('#btn-finalizar-venda').addEventListener('click', abrirPagamentoModal);
}
function renderCartItems(){
  const box = $('#cart-items'); if(!box) return;
  if(!Store.cart.length){ box.innerHTML = `<div class="empty-state"><div class="ic">🛒</div>Carrinho vazio.</div>`; return; }
  box.innerHTML = Store.cart.map(c=>`
    <div class="cart-item" data-key="${c.key}">
      <div class="info"><div class="t1">${c.nome}</div><div class="t2">${c.unidade==='KG'?c.qtd.toFixed(3)+' Kg':c.qtd+' un'} × ${fmtBRL(c.precoUnit)}</div></div>
      <div class="qty-ctrl">
        <button data-act="dec">−</button><span>${c.unidade==='KG'?c.qtd.toFixed(3):c.qtd}</span><button data-act="inc">+</button>
      </div>
      <div style="text-align:right"><div class="mono" style="font-weight:700">${fmtBRL(c.qtd*c.precoUnit)}</div><button class="btn-sm" data-act="rm" style="background:none;border:none;color:var(--danger);cursor:pointer">remover</button></div>
    </div>`).join('');
  $all('.cart-item', box).forEach(row=>{
    const key = row.dataset.key; const item = Store.cart.find(c=>c.key===key);
    const step = item.unidade==='KG'?0.1:1;
    row.querySelector('[data-act="inc"]').addEventListener('click', ()=>{ item.qtd = +(item.qtd+step).toFixed(3); renderCartItems(); renderCartBadge(); refreshCartTotal(); });
    row.querySelector('[data-act="dec"]').addEventListener('click', ()=>{ item.qtd = Math.max(step, +(item.qtd-step).toFixed(3)); renderCartItems(); renderCartBadge(); refreshCartTotal(); });
    row.querySelector('[data-act="rm"]').addEventListener('click', ()=>{ Store.cart = Store.cart.filter(c=>c.key!==key); renderCartItems(); renderCartBadge(); refreshCartTotal(); });
  });
}
function refreshCartTotal(){
  const el2 = $('.cart-total-row .val'); if(el2) el2.textContent = fmtBRL(cartTotal());
  const btn = $('#btn-finalizar-venda'); if(btn) btn.disabled = !Store.cart.length;
}
$('#btn-ver-carrinho').addEventListener('click', renderCarrinhoModal);

/* ---------- Pagamento ---------- */
let pagamentoSelecionado = 'pix';
function abrirPagamentoModal(){
  const total = cartTotal();
  const clienteOptions = Store.clientes.map(c=>`<option value="${c.id}">${c.nome}</option>`).join('');
  pagamentoSelecionado='pix';
  const html = `
    <div class="modal-head"><h3>Pagamento</h3><button class="btn-icon" onclick="closeModal()">✕</button></div>
    <div class="cart-total-row"><span class="lbl">Total a pagar</span><span class="val mono">${fmtBRL(total)}</span></div>
    <div class="pay-grid">
      <div class="pay-opt sel" data-pay="pix"><span class="ic">🔳</span>Pix</div>
      <div class="pay-opt" data-pay="dinheiro"><span class="ic">💵</span>Dinheiro</div>
      <div class="pay-opt" data-pay="cartao"><span class="ic">💳</span>Cartão</div>
      <div class="pay-opt" data-pay="fiado"><span class="ic">📝</span>Fiado</div>
    </div>
    <div id="pay-extra"></div>
    <button class="btn btn-primary btn-block btn-lg mt-3" id="btn-confirmar-pagamento">Confirmar pagamento</button>`;
  openModal(html);
  $all('.pay-opt').forEach(opt=> opt.addEventListener('click', ()=>{
    $all('.pay-opt').forEach(o=>o.classList.remove('sel')); opt.classList.add('sel');
    pagamentoSelecionado = opt.dataset.pay; renderPayExtra(total, clienteOptions);
  }));
  renderPayExtra(total, clienteOptions);
  $('#btn-confirmar-pagamento').addEventListener('click', ()=>confirmarPagamento(total));
}
function renderPayExtra(total, clienteOptions){
  const box = $('#pay-extra');
  if(pagamentoSelecionado==='dinheiro'){
    box.innerHTML = `<div class="field"><label>Valor recebido</label><input id="pay-recebido" type="number" step="0.01" value="${total.toFixed(2)}"></div>
      <div class="card mb-0" style="padding:10px 14px"><span class="text-sm text-dim">Troco:</span> <b id="pay-troco" class="mono">R$ 0,00</b></div>`;
    const rec = $('#pay-recebido');
    const upd = ()=>{ const troco = Math.max(0,(parseFloat(rec.value)||0)-total); $('#pay-troco').textContent = fmtBRL(troco); };
    rec.addEventListener('input', upd); upd();
  } else if(pagamentoSelecionado==='fiado'){
    box.innerHTML = `<div class="field"><label>Cliente *</label><select id="pay-cliente"><option value="">Selecione…</option>${clienteOptions}<option value="__novo">+ Novo cliente</option></select></div>`;
    $('#pay-cliente').addEventListener('change', (e)=>{
      if(e.target.value==='__novo'){ const nome = prompt('Nome do cliente:'); if(nome) criarClienteRapido(nome); e.target.value=''; }
    });
  } else box.innerHTML = '';
}
async function criarClienteRapido(nome){
  const ref = await db.collection('clientes').add({nome, telefone:'', fiado:0, criadoEm:new Date().toISOString()});
  toast('Cliente criado. Selecione-o na lista.');
}
async function confirmarPagamento(total){
  let valorPago = total, troco = 0, clienteId = null;
  if(pagamentoSelecionado==='dinheiro'){
    valorPago = parseFloat($('#pay-recebido').value)||0;
    if(valorPago < total){ toast('Valor recebido é menor que o total.','err'); return; }
    troco = valorPago - total;
  }
  if(pagamentoSelecionado==='fiado'){
    clienteId = $('#pay-cliente')?.value;
    if(!clienteId){ toast('Selecione um cliente para venda fiado.','err'); return; }
  }
  try{ await finalizarVenda({formaPagamento:pagamentoSelecionado, valorPago, troco, clienteId, total}); }
  catch(err){ toast('Erro ao finalizar venda: '+err.message, 'err'); }
}

/* ---------- Finalização da venda (baixa de estoque + registros) ---------- */
async function finalizarVenda({formaPagamento, valorPago, troco, clienteId, total}){
  const itens = Store.cart.map(c=>({
    tipo:c.tipo, produtoId:c.produtoId, nome:c.nome, unidade:c.unidade,
    quantidade:c.qtd, precoUnit:c.precoUnit, custoUnit:c.custoUnit,
    subtotal: +(c.qtd*c.precoUnit).toFixed(2), custoTotal: +(c.qtd*c.custoUnit).toFixed(2),
  }));
  const custoTotal = itens.reduce((s,i)=>s+i.custoTotal,0);
  const totalVenda = itens.reduce((s,i)=>s+i.subtotal,0);
  const lucro = totalVenda - custoTotal;
  const numero = (Store.config.numeracaoVenda||1);
  const nowIso = new Date().toISOString();

  const batch = db.batch();
  // baixa de estoque (FIFO por lote quando existir, senão direto no produto)
  for(const it of itens){
    if(it.tipo!=='produto') continue;
    const prod = Store.produtos.find(p=>p.id===it.produtoId);
    if(!prod) continue;
    const novoEstoque = Math.max(0, Number(prod.estoqueAtual||0) - it.quantidade);
    batch.update(db.collection('produtos').doc(prod.id), {estoqueAtual: novoEstoque});
    let restante = it.quantidade;
    const lotesProduto = Store.lotes.filter(l=>l.produtoId===prod.id && Number(l.quantidade)>0)
      .sort((a,b)=> toJsDate(a.dataValidade||'2999-01-01') - toJsDate(b.dataValidade||'2999-01-01'));
    for(const lote of lotesProduto){
      if(restante<=0) break;
      const abate = Math.min(restante, Number(lote.quantidade));
      batch.update(db.collection('lotes').doc(lote.id), {quantidade: Number(lote.quantidade)-abate});
      restante -= abate;
    }
    const movRef = db.collection('movimentacoesEstoque').doc();
    batch.set(movRef, { produtoId:prod.id, produtoNome:prod.nome, tipo:'saida', quantidade:it.quantidade, motivo:'venda', data:nowIso, usuarioId:Store.user.uid });
  }
  const vendaRef = db.collection('vendas').doc();
  batch.set(vendaRef, {
    numero, data:nowIso, itens, total:totalVenda, custoTotal, lucro,
    formaPagamento, valorPago, troco, clienteId:clienteId||null,
    vendedorId:Store.user.uid, vendedorNome:Store.perfil?.nome||Store.user.email, status:'concluida',
  });
  if(formaPagamento!=='fiado'){
    const finRef = db.collection('financeiro').doc();
    batch.set(finRef, { tipo:'entrada', categoria:'venda', valor:totalVenda, data:nowIso, descricao:'Venda #'+numero, vendaId:vendaRef.id });
  } else {
    const despRef = db.collection('despesas').doc();
    batch.set(despRef, { tipo:'receber', descricao:'Fiado — Venda #'+numero, categoria:'fiado', valor:totalVenda, dataVencimento:null, status:'pendente', data:nowIso, clienteId, vendaId:vendaRef.id });
  }
  batch.set(db.collection('configuracoes').doc('geral'), {numeracaoVenda: numero+1}, {merge:true});

  await batch.commit();
  const vendaFinal = {numero, data:nowIso, itens, total:totalVenda, lucro, formaPagamento, valorPago, troco};
  Store.cart = [];
  renderCartBadge();
  closeModal();
  mostrarComprovante(vendaFinal);
}

/* ============================================================
   COMPROVANTE / CUPOM (impressão e Bluetooth)
   ============================================================ */
function generateReceiptText(v){
  const L = 32;
  const line = (ch='-')=>ch.repeat(L);
  const pad = (a,b)=>{ a=String(a); b=String(b); const sp=Math.max(1,L-a.length-b.length); return a+' '.repeat(sp)+b; };
  let t = '';
  t += center(Store.config.nomeLoja||'MercadoPDV', L)+'\n';
  t += center('Cupom não fiscal', L)+'\n';
  t += line('=')+'\n';
  t += 'Venda #'+v.numero+'   '+fmtDateTime(v.data)+'\n';
  t += line()+'\n';
  v.itens.forEach(it=>{
    t += it.nome+'\n';
    t += pad(`${it.quantidade} ${it.unidade} x ${fmtBRL(it.precoUnit)}`, fmtBRL(it.subtotal))+'\n';
  });
  t += line('=')+'\n';
  t += pad('TOTAL', fmtBRL(v.total))+'\n';
  t += pad('Pagamento', v.formaPagamento.toUpperCase())+'\n';
  if(v.formaPagamento==='dinheiro'){ t += pad('Recebido', fmtBRL(v.valorPago))+'\n'; t += pad('Troco', fmtBRL(v.troco))+'\n'; }
  t += line()+'\n';
  t += center('Obrigado pela preferência!', L)+'\n\n\n';
  return t;
}
function center(s,L){ s=String(s); const sp=Math.max(0,Math.floor((L-s.length)/2)); return ' '.repeat(sp)+s; }

function mostrarComprovante(v){
  const texto = generateReceiptText(v);
  $('#receipt-print').innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${texto}</pre>`;
  const html = `
    <div class="modal-head"><h3>✅ Venda #${v.numero} concluída</h3><button class="btn-icon" onclick="closeModal()">✕</button></div>
    <div class="card"><pre class="mono" style="white-space:pre-wrap;margin:0;font-size:12px">${texto}</pre></div>
    <div class="fw-grid">
      <button class="btn btn-outline" id="btn-imprimir">🖨 Imprimir</button>
      <button class="btn btn-outline" id="btn-compartilhar">📤 Compartilhar</button>
    </div>
    <button class="btn btn-ghost btn-block mt-2" id="btn-imprimir-bt">🔵 Imprimir na Bluetooth</button>
    <button class="btn btn-primary btn-block mt-2" onclick="closeModal()">Nova venda</button>`;
  openModal(html, {center:true});
  $('#btn-imprimir').addEventListener('click', ()=> window.print());
  $('#btn-compartilhar').addEventListener('click', async ()=>{
    if(navigator.share){ try{ await navigator.share({title:'Comprovante', text:texto}); }catch(e){} }
    else { navigator.clipboard.writeText(texto); toast('Comprovante copiado!'); }
  });
  $('#btn-imprimir-bt').addEventListener('click', ()=> imprimirBluetooth(texto));
}

/* ---------- Impressão térmica via Bluetooth (Web Bluetooth API) ----------
   Suporte: Chrome/Edge no Android. NÃO funciona no Safari/iOS (sem Web Bluetooth).
   Muitas impressoras térmicas usam serviços BLE proprietários; tentamos os mais
   comuns e, se não encontrarmos uma característica gravável, avisamos o usuário. */
const PRINTER_SERVICE_CANDIDATES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // comum em impressoras ESC/POS BLE
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC transparent UART
];
async function conectarImpressora(){
  if(!navigator.bluetooth){ toast('Web Bluetooth não é suportado neste navegador.','err'); return; }
  try{
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices:true, optionalServices: PRINTER_SERVICE_CANDIDATES });
    const server = await device.gatt.connect();
    let found=null;
    for(const sUuid of PRINTER_SERVICE_CANDIDATES){
      try{
        const service = await server.getPrimaryService(sUuid);
        const chars = await service.getCharacteristics();
        const writable = chars.find(c=>c.properties.write || c.properties.writeWithoutResponse);
        if(writable){ found = writable; break; }
      }catch(e){ /* serviço não existe neste aparelho, tenta o próximo */ }
    }
    if(!found){ toast('Conectado, mas não encontrei um canal de impressão compatível. Use "Imprimir" (navegador) como alternativa.','err'); return; }
    Store.printerDevice = device; Store.printerChar = found;
    $('#printer-status').textContent = 'Conectado: '+(device.name||'impressora Bluetooth');
    toast('Impressora conectada!');
  }catch(err){ if(err.name!=='NotFoundError') toast('Falha ao conectar: '+err.message,'err'); }
}
async function imprimirBluetooth(texto){
  if(!Store.printerChar){ toast('Nenhuma impressora Bluetooth conectada. Conecte em Mais > Impressora.','err'); return; }
  try{
    const encoder = new TextEncoder();
    const ESC = '\x1B'; const init = ESC+'@';
    const bytes = encoder.encode(init+texto+'\x1D\x56\x00'); // inicializa + texto + corte
    const CHUNK=180;
    for(let i=0;i<bytes.length;i+=CHUNK){
      await Store.printerChar.writeValue(bytes.slice(i,i+CHUNK));
    }
    toast('Enviado para a impressora!');
  }catch(err){ toast('Erro ao imprimir: '+err.message,'err'); }
}
$('#btn-connect-printer').addEventListener('click', conectarImpressora);

/* ============================================================
   ESTOQUE — Lotes/validade, Movimentações, Inventário
   ============================================================ */
$all('[data-tab-estoque]').forEach(btn=> btn.addEventListener('click', ()=>{
  $all('[data-tab-estoque]').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  ['lotes','mov','inventario'].forEach(t=> $('#estoque-tab-'+t).classList.toggle('hidden', t!==btn.dataset.tabEstoque));
}));

function renderLotes(){
  const box = $('#lotes-list'); if(!box) return;
  const arr = Store.lotes.slice().sort((a,b)=> toJsDate(a.dataValidade||'2999-01-01')-toJsDate(b.dataValidade||'2999-01-01'));
  if(!arr.length){ box.innerHTML = `<div class="empty-state"><div class="ic">⏰</div>Nenhum lote cadastrado.</div>`; return; }
  box.innerHTML = arr.map(l=>{
    const prod = Store.produtos.find(p=>p.id===l.produtoId);
    const st = statusValidade(l.dataValidade ? toJsDate(l.dataValidade) : null);
    return `<div class="list-row" data-id="${l.id}">
      <div class="thumb">🏷️</div>
      <div class="info"><div class="t1">${prod?prod.nome:'(produto removido)'}</div>
      <div class="t2">Fab: ${fmtDate(l.dataFabricacao)} · Val: ${fmtDate(l.dataValidade)} · Qtd: ${l.quantidade}</div></div>
      <div class="right"><span class="badge ${st.cor}">${st.label}</span></div>
    </div>`;
  }).join('');
  $all('.list-row', box).forEach(row=> row.addEventListener('click', ()=> openLoteForm(row.dataset.id)));
}
function openLoteForm(id){
  const l = id? Store.lotes.find(x=>x.id===id) : {};
  const prodOptions = Store.produtos.map(p=>`<option value="${p.id}" ${l.produtoId===p.id?'selected':''}>${p.nome}</option>`).join('');
  const html = `
    <div class="modal-head"><h3>${id?'Editar lote':'Novo lote / validade'}</h3><button class="btn-icon" onclick="closeModal()">✕</button></div>
    <div class="field"><label>Produto *</label><select id="lf-produto"><option value="">Selecione…</option>${prodOptions}</select></div>
    <div class="field-row">
      <div class="field"><label>Data de fabricação</label><input id="lf-fab" type="date" value="${l.dataFabricacao||''}"></div>
      <div class="field"><label>Data de validade</label><input id="lf-val" type="date" value="${l.dataValidade||''}"></div>
    </div>
    <div class="field"><label>Quantidade</label><input id="lf-qtd" type="number" step="0.001" value="${l.quantidade??''}"></div>
    <div class="fw-grid">
      ${id?'<button class="btn btn-danger" id="lf-excluir">Excluir</button>':'<div></div>'}
      <button class="btn btn-primary" id="lf-salvar">Salvar</button>
    </div>`;
  openModal(html, {center:true});
  if(id) $('#lf-excluir').addEventListener('click', async ()=>{ await db.collection('lotes').doc(id).delete(); closeModal(); toast('Lote excluído.'); });
  $('#lf-salvar').addEventListener('click', async ()=>{
    const data = { produtoId:$('#lf-produto').value, dataFabricacao:$('#lf-fab').value||null, dataValidade:$('#lf-val').value||null, quantidade: parseFloat($('#lf-qtd').value)||0 };
    if(!data.produtoId){ toast('Selecione um produto.','err'); return; }
    if(id) await db.collection('lotes').doc(id).update(data);
    else { data.criadoEm=new Date().toISOString(); await db.collection('lotes').add(data); }
    closeModal(); toast('Lote salvo!');
  });
}
$('#btn-novo-lote').addEventListener('click', ()=>openLoteForm(null));

function renderMovimentacoes(){
  const box = $('#mov-list'); if(!box) return;
  const arr = Store.movimentacoes.slice().sort((a,b)=> new Date(b.data)-new Date(a.data)).slice(0,60);
  if(!arr.length){ box.innerHTML = `<div class="empty-state"><div class="ic">📋</div>Nenhuma movimentação registrada.</div>`; return; }
  const icons={entrada:'⬆',saida:'⬇',ajuste:'⚖',transferencia:'🔁'};
  box.innerHTML = arr.map(m=>`<div class="list-row" style="cursor:default">
    <div class="thumb">${icons[m.tipo]||'📦'}</div>
    <div class="info"><div class="t1">${m.produtoNome||'-'}</div><div class="t2">${m.motivo||m.tipo} · ${fmtDateTime(m.data)}</div></div>
    <div class="right"><span class="badge gray">${m.tipo}</span><div class="mono text-sm">${m.quantidade}</div></div>
  </div>`).join('');
}
$all('[data-mov]').forEach(btn=> btn.addEventListener('click', ()=> abrirMovimentacaoForm(btn.dataset.mov)));
function abrirMovimentacaoForm(tipo){
  const titulos={entrada:'Entrada de estoque',saida:'Saída de estoque',ajuste:'Ajuste de estoque',transferencia:'Transferência entre lojas/setores'};
  const prodOptions = Store.produtos.map(p=>`<option value="${p.id}">${p.nome} (estoque: ${p.estoqueAtual})</option>`).join('');
  const html = `
    <div class="modal-head"><h3>${titulos[tipo]}</h3><button class="btn-icon" onclick="closeModal()">✕</button></div>
    <div class="field"><label>Produto *</label><select id="mv-produto"><option value="">Selecione…</option>${prodOptions}</select></div>
    <div class="field"><label>Quantidade</label><input id="mv-qtd" type="number" step="0.001"></div>
    <div class="field"><label>Motivo / observação</label><input id="mv-motivo" placeholder="${tipo==='ajuste'?'Ex: quebra, perda, contagem':'Ex: compra fornecedor X'}"></div>
    <button class="btn btn-primary btn-block mt-2" id="mv-salvar">Confirmar ${titulos[tipo].toLowerCase()}</button>`;
  openModal(html, {center:true});
  $('#mv-salvar').addEventListener('click', async ()=>{
    const produtoId = $('#mv-produto').value; const qtd = parseFloat($('#mv-qtd').value)||0;
    const prod = Store.produtos.find(p=>p.id===produtoId);
    if(!prod || qtd<=0){ toast('Selecione o produto e informe a quantidade.','err'); return; }
    let novoEstoque = Number(prod.estoqueAtual||0);
    if(tipo==='entrada') novoEstoque += qtd;
    else if(tipo==='saida' || tipo==='transferencia') novoEstoque = Math.max(0, novoEstoque-qtd);
    else if(tipo==='ajuste') novoEstoque = qtd; // ajuste define o valor final contado
    const batch = db.batch();
    batch.update(db.collection('produtos').doc(produtoId), {estoqueAtual:novoEstoque});
    batch.set(db.collection('movimentacoesEstoque').doc(), { produtoId, produtoNome:prod.nome, tipo, quantidade:qtd, motivo:$('#mv-motivo').value.trim(), data:new Date().toISOString(), usuarioId:Store.user.uid });
    await batch.commit();
    closeModal(); toast('Movimentação registrada!');
  });
}

function renderInventario(){
  const box = $('#inventario-list'); if(!box) return;
  box.innerHTML = Store.produtos.map(p=>`
    <div class="list-row" style="cursor:default">
      <div class="thumb">${produtoThumb(p)}</div>
      <div class="info"><div class="t1">${p.nome}</div><div class="t2">Sistema: ${p.estoqueAtual}</div></div>
      <div class="right"><input type="number" step="0.001" data-inv="${p.id}" style="width:80px;padding:8px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg-elev);color:var(--text)" placeholder="contado"></div>
    </div>`).join('') + `<button class="btn btn-primary btn-block mt-2" id="btn-aplicar-inventario">Aplicar contagem (gera ajustes)</button>`;
  $('#btn-aplicar-inventario')?.addEventListener('click', async ()=>{
    const inputs = $all('[data-inv]', box).filter(i=>i.value!=='');
    if(!inputs.length){ toast('Informe ao menos uma contagem.','err'); return; }
    if(!confirm(`Aplicar ${inputs.length} ajuste(s) de inventário?`)) return;
    const batch = db.batch();
    inputs.forEach(inp=>{
      const prod = Store.produtos.find(p=>p.id===inp.dataset.inv);
      const contado = parseFloat(inp.value);
      batch.update(db.collection('produtos').doc(prod.id), {estoqueAtual:contado});
      batch.set(db.collection('movimentacoesEstoque').doc(), {produtoId:prod.id, produtoNome:prod.nome, tipo:'ajuste', quantidade:contado, motivo:'Inventário/contagem física', data:new Date().toISOString(), usuarioId:Store.user.uid});
    });
    await batch.commit();
    toast('Inventário aplicado!');
  });
}

/* ============================================================
   FINANCEIRO
   ============================================================ */
$all('[data-tab-fin]').forEach(btn=> btn.addEventListener('click', ()=>{
  $all('[data-tab-fin]').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  ['fluxo','despesas','contas'].forEach(t=> $('#fin-tab-'+t).classList.toggle('hidden', t!==btn.dataset.tabFin));
}));

function renderFinanceiro(){
  const hoje = todayStr();
  const entradas = Store.financeiro.filter(f=>f.tipo==='entrada');
  const saidas = Store.financeiro.filter(f=>f.tipo==='saida');
  const despesasPagas = Store.despesas.filter(d=>d.tipo==='pagar' && d.status==='pago');
  const totalEntradas = entradas.reduce((s,f)=>s+Number(f.valor||0),0);
  const totalSaidas = saidas.reduce((s,f)=>s+Number(f.valor||0),0) + despesasPagas.reduce((s,d)=>s+Number(d.valor||0),0);
  const saldo = totalEntradas - totalSaidas;
  const aPagar = Store.despesas.filter(d=>d.tipo==='pagar' && d.status==='pendente').reduce((s,d)=>s+Number(d.valor||0),0);
  const aReceber = Store.despesas.filter(d=>d.tipo==='receber' && d.status==='pendente').reduce((s,d)=>s+Number(d.valor||0),0);
  $('#fin-stats').innerHTML = `
    <div class="stat-card"><span class="ic">💰</span><span class="val mono">${fmtBRL(totalEntradas)}</span><span class="lbl">Entradas</span></div>
    <div class="stat-card"><span class="ic">💸</span><span class="val mono">${fmtBRL(totalSaidas)}</span><span class="lbl">Saídas</span></div>
    <div class="stat-card ${saldo<0?'danger':''}"><span class="ic">🏦</span><span class="val mono">${fmtBRL(saldo)}</span><span class="lbl">Saldo</span></div>
    <div class="stat-card accent"><span class="ic">📄</span><span class="val mono">${fmtBRL(aPagar)}</span><span class="lbl">A pagar</span></div>`;
  renderFluxo(); renderDespesas(); renderContas();
}
function renderFluxo(){
  const box = $('#fluxo-list'); if(!box) return;
  const arr = Store.financeiro.slice().sort((a,b)=>new Date(b.data)-new Date(a.data)).slice(0,60);
  if(!arr.length){ box.innerHTML=`<div class="empty-state"><div class="ic">💵</div>Nenhum lançamento ainda.</div>`; return; }
  box.innerHTML = arr.map(f=>`<div class="list-row" style="cursor:default">
    <div class="thumb">${f.tipo==='entrada'?'⬆':'⬇'}</div>
    <div class="info"><div class="t1">${f.descricao||f.categoria}</div><div class="t2">${fmtDateTime(f.data)}</div></div>
    <div class="right"><span class="mono" style="color:${f.tipo==='entrada'?'var(--primary)':'var(--danger)'};font-weight:700">${f.tipo==='entrada'?'+':'-'}${fmtBRL(f.valor)}</span></div>
  </div>`).join('');
}
function renderDespesas(){
  const box = $('#despesas-list'); if(!box) return;
  const arr = Store.despesas.filter(d=>d.tipo==='pagar' || d.categoria==='despesa').sort((a,b)=>new Date(b.data)-new Date(a.data));
  box.innerHTML = arr.length? arr.map(d=>`<div class="list-row" style="cursor:default">
    <div class="thumb">📄</div><div class="info"><div class="t1">${d.descricao}</div><div class="t2">Venc: ${fmtDate(d.dataVencimento)}</div></div>
    <div class="right"><span class="badge ${d.status==='pago'?'green':'yellow'}">${d.status}</span><div class="mono text-sm">${fmtBRL(d.valor)}</div></div>
  </div>`).join('') : `<div class="empty-state"><div class="ic">📄</div>Nenhuma despesa lançada.</div>`;
}
function renderContas(){
  const box = $('#contas-list'); if(!box) return;
  const arr = Store.despesas.filter(d=>d.status==='pendente').sort((a,b)=>new Date(a.dataVencimento||0)-new Date(b.dataVencimento||0));
  box.innerHTML = arr.length? arr.map(d=>`<div class="list-row" data-id="${d.id}">
    <div class="thumb">${d.tipo==='receber'?'📥':'📤'}</div><div class="info"><div class="t1">${d.descricao}</div><div class="t2">Venc: ${fmtDate(d.dataVencimento)}</div></div>
    <div class="right"><span class="badge yellow">${d.tipo}</span><div class="mono text-sm">${fmtBRL(d.valor)}</div></div>
  </div>`).join('') : `<div class="empty-state"><div class="ic">✅</div>Nenhuma conta pendente.</div>`;
  $all('.list-row',box).forEach(row=> row.addEventListener('click', async ()=>{
    if(confirm('Marcar esta conta como paga/recebida?')){ await db.collection('despesas').doc(row.dataset.id).update({status:'pago'}); toast('Conta baixada!'); }
  }));
}

function abrirFinForm(tipo){
  const titulos={entrada:'Nova entrada financeira', saida:'Nova saída financeira', despesa:'Nova despesa', conta:'Conta a pagar/receber'};
  const html = `
    <div class="modal-head"><h3>${titulos[tipo]}</h3><button class="btn-icon" onclick="closeModal()">✕</button></div>
    <div class="field"><label>Descrição *</label><input id="ff-desc"></div>
    <div class="field"><label>Valor (R$) *</label><input id="ff-valor" type="number" step="0.01"></div>
    ${tipo==='conta'?`<div class="field"><label>Tipo</label><select id="ff-tipoconta"><option value="pagar">A pagar</option><option value="receber">A receber</option></select></div>
      <div class="field"><label>Vencimento</label><input id="ff-venc" type="date"></div>`:''}
    ${tipo==='despesa'?`<div class="field"><label>Categoria</label><input id="ff-cat" placeholder="Ex: aluguel, energia, água"></div>
      <div class="field"><label>Vencimento</label><input id="ff-venc" type="date"></div>`:''}
    <button class="btn btn-primary btn-block mt-2" id="ff-salvar">Salvar</button>`;
  openModal(html, {center:true});
  $('#ff-salvar').addEventListener('click', async ()=>{
    const desc = $('#ff-desc').value.trim(); const valor = parseFloat($('#ff-valor').value)||0;
    if(!desc||!valor){ toast('Preencha descrição e valor.','err'); return; }
    if(tipo==='entrada' || tipo==='saida'){
      await db.collection('financeiro').add({tipo, categoria:'manual', descricao:desc, valor, data:new Date().toISOString()});
    } else if(tipo==='despesa'){
      await db.collection('despesas').add({tipo:'pagar', descricao:desc, valor, categoria:$('#ff-cat').value||'despesa', dataVencimento:$('#ff-venc').value||null, status:'pendente', data:new Date().toISOString()});
    } else if(tipo==='conta'){
      await db.collection('despesas').add({tipo:$('#ff-tipoconta').value, descricao:desc, valor, dataVencimento:$('#ff-venc').value||null, status:'pendente', data:new Date().toISOString()});
    }
    closeModal(); toast('Lançamento salvo!');
  });
}
$('#btn-fin-entrada').addEventListener('click', ()=>abrirFinForm('entrada'));
$('#btn-fin-saida').addEventListener('click', ()=>abrirFinForm('saida'));
$('#btn-fin-despesa').addEventListener('click', ()=>abrirFinForm('despesa'));
$('#btn-fin-conta').addEventListener('click', ()=>abrirFinForm('conta'));

/* ============================================================
   RELATÓRIOS
   ============================================================ */
let relatorioAtivo = 'diario';
let ultimoRelatorio = {titulo:'', headers:[], rows:[]};
$all('[data-rel]').forEach(btn=> btn.addEventListener('click', ()=>{
  $all('[data-rel]').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  relatorioAtivo = btn.dataset.rel; renderRelatorioAtual();
}));
function renderRelatorioAtual(){ renderRelatorio(relatorioAtivo); }

function tabelaHtml(headers, rows){
  if(!rows.length) return `<div class="empty-state"><div class="ic">📊</div>Sem dados para este período/filtro.</div>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderRelatorio(tipo){
  const box = $('#relatorio-content');
  let headers=[], rows=[], titulo='';
  const vendasValidas = Store.vendas.filter(v=>v.status!=='cancelada');
  if(tipo==='diario'){
    titulo='Relatório diário (hoje)';
    headers=['Nº','Hora','Cliente/Forma','Total','Lucro'];
    rows = vendasDoDia(todayStr()).map(v=>[v.numero, fmtDateTime(v.data).split(' ')[1], v.formaPagamento, fmtBRL(v.total), fmtBRL(v.lucro)]);
  } else if(tipo==='mensal'){
    titulo='Relatório mensal';
    headers=['Dia','Vendas','Faturamento','Lucro'];
    const mesAtual = todayStr().slice(0,7);
    const porDia={};
    vendasDoMes(mesAtual).forEach(v=>{ const d=v.data.slice(0,10); porDia[d]=porDia[d]||{n:0,fat:0,lucro:0}; porDia[d].n++; porDia[d].fat+=Number(v.total); porDia[d].lucro+=Number(v.lucro); });
    rows = Object.entries(porDia).sort().map(([d,x])=>[fmtDate(d), x.n, fmtBRL(x.fat), fmtBRL(x.lucro)]);
  } else if(tipo==='anual'){
    titulo='Relatório anual';
    headers=['Mês','Vendas','Faturamento','Lucro'];
    const anoAtual = todayStr().slice(0,4);
    const porMes={};
    vendasValidas.filter(v=>v.data.slice(0,4)===anoAtual).forEach(v=>{ const m=v.data.slice(0,7); porMes[m]=porMes[m]||{n:0,fat:0,lucro:0}; porMes[m].n++; porMes[m].fat+=Number(v.total); porMes[m].lucro+=Number(v.lucro); });
    rows = Object.entries(porMes).sort().map(([m,x])=>[m, x.n, fmtBRL(x.fat), fmtBRL(x.lucro)]);
  } else if(tipo==='vendedor'){
    titulo='Vendas por vendedor';
    headers=['Vendedor','Vendas','Faturamento','Lucro'];
    const porVend={};
    vendasValidas.forEach(v=>{ const k=v.vendedorNome||'—'; porVend[k]=porVend[k]||{n:0,fat:0,lucro:0}; porVend[k].n++; porVend[k].fat+=Number(v.total); porVend[k].lucro+=Number(v.lucro); });
    rows = Object.entries(porVend).map(([k,x])=>[k,x.n,fmtBRL(x.fat),fmtBRL(x.lucro)]);
  } else if(tipo==='categoria'){
    titulo='Vendas por categoria';
    headers=['Categoria','Unidades','Faturamento'];
    const porCat={};
    vendasValidas.forEach(v=> (v.itens||[]).forEach(it=>{
      let catNome='Avulso (fruta/verdura)';
      if(it.tipo==='produto'){ const prod=Store.produtos.find(p=>p.id===it.produtoId); const cat=Store.categorias.find(c=>c.id===prod?.categoriaId); catNome=cat?cat.nome:'Sem categoria'; }
      porCat[catNome]=porCat[catNome]||{q:0,fat:0}; porCat[catNome].q+=Number(it.quantidade); porCat[catNome].fat+=Number(it.subtotal);
    }));
    rows = Object.entries(porCat).sort((a,b)=>b[1].fat-a[1].fat).map(([k,x])=>[k,x.q.toFixed(2),fmtBRL(x.fat)]);
  } else if(tipo==='cliente'){
    titulo='Vendas por cliente';
    headers=['Cliente','Vendas','Total'];
    const porCli={};
    vendasValidas.filter(v=>v.clienteId).forEach(v=>{ const cli=Store.clientes.find(c=>c.id===v.clienteId); const nome=cli?cli.nome:'(removido)'; porCli[nome]=porCli[nome]||{n:0,fat:0}; porCli[nome].n++; porCli[nome].fat+=Number(v.total); });
    rows = Object.entries(porCli).map(([k,x])=>[k,x.n,fmtBRL(x.fat)]);
  } else if(tipo==='produto'){
    titulo='Vendas por produto';
    headers=['Produto','Unidades vendidas','Faturamento'];
    const porProd={};
    vendasValidas.forEach(v=>(v.itens||[]).forEach(it=>{ porProd[it.nome]=porProd[it.nome]||{q:0,fat:0}; porProd[it.nome].q+=Number(it.quantidade); porProd[it.nome].fat+=Number(it.subtotal); }));
    rows = Object.entries(porProd).sort((a,b)=>b[1].fat-a[1].fat).map(([k,x])=>[k,x.q.toFixed(2),fmtBRL(x.fat)]);
  } else if(tipo==='semvenda'){
    titulo='Produtos sem venda registrada';
    headers=['Produto','Estoque atual','Categoria'];
    const vendidos = new Set(); vendasValidas.forEach(v=>(v.itens||[]).forEach(it=>{ if(it.produtoId) vendidos.add(it.produtoId); }));
    rows = Store.produtos.filter(p=>!vendidos.has(p.id)).map(p=>[p.nome, p.estoqueAtual, (Store.categorias.find(c=>c.id===p.categoriaId)||{}).nome||'—']);
  } else if(tipo==='vencidos'){
    titulo='Produtos vencidos';
    headers=['Produto','Validade','Dias vencido','Quantidade'];
    rows = Alerts.vencidos.map(l=>[l.produtoNome, fmtDate(l.dataValidade), Math.abs(l.dias), l.quantidade]);
  } else if(tipo==='estoquebaixo'){
    titulo='Produtos abaixo do estoque mínimo';
    headers=['Produto','Estoque atual','Estoque mínimo'];
    rows = Alerts.estoqueBaixo.map(p=>[p.nome, p.estoqueAtual, p.estoqueMinimo]);
  }
  ultimoRelatorio = {titulo, headers, rows};
  box.innerHTML = `<h3 style="margin-bottom:10px">${titulo}</h3>` + tabelaHtml(headers, rows);
}

$('#btn-export-xlsx-rel').addEventListener('click', ()=>{
  const {titulo, headers, rows} = ultimoRelatorio;
  if(!rows.length){ toast('Sem dados para exportar.','err'); return; }
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, titulo.slice(0,28));
  XLSX.writeFile(wb, titulo.replace(/\s+/g,'_')+'_'+todayStr()+'.xlsx');
});
$('#btn-export-pdf').addEventListener('click', ()=>{
  const {titulo, headers, rows} = ultimoRelatorio;
  if(!rows.length){ toast('Sem dados para exportar.','err'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14); doc.text(titulo, 14, 16);
  doc.setFontSize(9); doc.text(Store.config.nomeLoja+' · gerado em '+fmtDateTime(new Date()), 14, 22);
  doc.autoTable({ head:[headers], body:rows, startY:28, styles:{fontSize:8} });
  doc.save(titulo.replace(/\s+/g,'_')+'_'+todayStr()+'.pdf');
});

/* ============================================================
   CONFIGURAÇÕES — Loja, tema, usuários, backup, listas auxiliares
   ============================================================ */
$('#btn-salvar-loja').addEventListener('click', async ()=>{
  await db.collection('configuracoes').doc('geral').set({nomeLoja:$('#cfg-nome-loja').value.trim()}, {merge:true});
  toast('Nome da loja salvo!');
});

function setTheme(theme, persist=true){
  document.documentElement.setAttribute('data-theme', theme);
  $('#btn-theme').textContent = theme==='dark' ? '☀' : '🌙';
  $('#cfg-dark-toggle').checked = theme==='dark';
  localStorage.setItem('tema', theme);
  if(persist) db.collection('configuracoes').doc('geral').set({temaPreferido:theme},{merge:true}).catch(()=>{});
  if(Store.currentView==='dashboard') renderDashboard();
}
$('#btn-theme').addEventListener('click', ()=> setTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark'));
$('#cfg-dark-toggle').addEventListener('change', (e)=> setTheme(e.target.checked?'dark':'light'));

/* ---------- Backup ---------- */
$('#btn-backup-agora').addEventListener('click', async ()=>{
  const dump = {
    geradoEm:new Date().toISOString(),
    produtos:Store.produtos, categorias:Store.categorias, fornecedores:Store.fornecedores,
    clientes:Store.clientes, lotes:Store.lotes, vendas:Store.vendas, movimentacoesEstoque:Store.movimentacoes,
    financeiro:Store.financeiro, despesas:Store.despesas, usuarios:Store.usuarios, configuracoes:Store.config,
  };
  const blob = new Blob([JSON.stringify(dump,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download = 'backup_mercadopdv_'+todayStr()+'.json'; a.click();
  URL.revokeObjectURL(url);
  await db.collection('configuracoes').doc('geral').set({ultimoBackup:new Date().toISOString()},{merge:true});
  toast('Backup baixado com sucesso!');
});

/* ---------- Usuários ---------- */
function renderUsuarios(){
  const box = $('#usuarios-list'); if(!box) return;
  box.innerHTML = Store.usuarios.map(u=>`<div class="list-row" style="cursor:default">
    <div class="thumb">👤</div><div class="info"><div class="t1">${u.nome}</div><div class="t2">${u.email}</div></div>
    <div class="right"><span class="badge ${u.papel==='admin'?'green':'gray'}">${u.papel}</span></div>
  </div>`).join('');
}
$('#btn-novo-usuario').addEventListener('click', ()=>{
  const html = `
    <div class="modal-head"><h3>Convidar usuário</h3><button class="btn-icon" onclick="closeModal()">✕</button></div>
    <p class="text-sm text-dim">Crie o acesso diretamente pela tela de login (e-mail + senha), depois volte aqui e defina o perfil dele na lista abaixo. O Firebase Authentication não permite criar contas de outra pessoa sem a senha dela.</p>
    <div class="field mt-2"><label>E-mail do usuário já cadastrado</label><input id="nu-email" placeholder="funcionario@loja.com"></div>
    <div class="field"><label>Perfil</label><select id="nu-papel"><option value="operador">Operador (estoque + produtos + PDV)</option><option value="caixa">Caixa (somente PDV)</option><option value="admin">Administrador (acesso total)</option></select></div>
    <button class="btn btn-primary btn-block mt-2" id="nu-salvar">Aplicar perfil</button>`;
  openModal(html, {center:true});
  $('#nu-salvar').addEventListener('click', async ()=>{
    const email = $('#nu-email').value.trim().toLowerCase();
    const user = Store.usuarios.find(u=>u.email.toLowerCase()===email);
    if(!user){ toast('Este e-mail ainda não tem conta. Peça para a pessoa criar o acesso na tela de login primeiro.','err'); return; }
    await db.collection('usuarios').doc(user.id).update({papel:$('#nu-papel').value});
    closeModal(); toast('Perfil atualizado!');
  });
});

/* ---------- Categorias / Fornecedores / Clientes (CRUD simples genérico) ---------- */
function gerenciarLista(colecao, titulo, campos){
  const render = ()=>{
    const arr = Store[colecao];
    const html = `
      <div class="modal-head"><h3>${titulo}</h3><button class="btn-icon" onclick="closeModal()">✕</button></div>
      <div id="gl-list">${arr.map(item=>`<div class="list-row" data-id="${item.id}" style="cursor:default">
        <div class="thumb">📋</div><div class="info"><div class="t1">${item.nome}</div><div class="t2">${campos.slice(1).map(c=>item[c.key]||'').filter(Boolean).join(' · ')}</div></div>
        <button class="btn-icon" data-del="${item.id}">🗑</button>
      </div>`).join('') || `<p class="text-dim text-sm">Nada cadastrado ainda.</p>`}</div>
      <div class="perf"></div>
      ${campos.map(c=>`<div class="field"><label>${c.label}</label><input id="gl-${c.key}" placeholder="${c.label}"></div>`).join('')}
      <button class="btn btn-primary btn-block" id="gl-add">+ Adicionar</button>`;
    openModal(html, {center:true});
    $all('[data-del]').forEach(b=> b.addEventListener('click', async (e)=>{ e.stopPropagation(); await db.collection(colecao).doc(b.dataset.del).delete(); toast('Removido.'); render(); }));
    $('#gl-add').addEventListener('click', async ()=>{
      const data={}; let ok=true;
      campos.forEach(c=>{ const v=$('#gl-'+c.key).value.trim(); if(c.key==='nome' && !v) ok=false; data[c.key]=v; });
      if(!ok){ toast('Informe ao menos o nome.','err'); return; }
      if(colecao==='clientes') data.fiado=0;
      data.criadoEm = new Date().toISOString();
      await db.collection(colecao).add(data);
      render();
    });
  };
  render();
}
$('#btn-gerenciar-categorias').addEventListener('click', ()=> gerenciarLista('categorias','Categorias',[{key:'nome',label:'Nome da categoria'}]));
$('#btn-gerenciar-fornecedores').addEventListener('click', ()=> gerenciarLista('fornecedores','Fornecedores',[{key:'nome',label:'Nome'},{key:'contato',label:'Contato'},{key:'telefone',label:'Telefone'}]));
$('#btn-gerenciar-clientes').addEventListener('click', ()=> gerenciarLista('clientes','Clientes',[{key:'nome',label:'Nome'},{key:'telefone',label:'Telefone'}]));

/* ============================================================
   PWA — registro do service worker
   ============================================================ */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(err=> console.warn('SW falhou:', err));
  });
}

/* ============================================================
   INIT
   ============================================================ */
setTheme(localStorage.getItem('tema') || 'light', false);
