const DB_KEY = 'storymind_database_v2', META_KEY = 'storymind_meta';   // mesma chave do app.html
const $ = id => document.getElementById(id);
const COR = { purple: '#a78bfa', orange: '#fbbf24', blue: '#60a5fa', emerald: '#34d399', rose: '#fb7185', white: '#cbd5e1' };
let owner = '', view = localStorage.getItem('storymind_view') || 'list';

const load = () => { try { return JSON.parse(localStorage.getItem(DB_KEY)) || {}; } catch (e) { return {}; } };
const save = db => localStorage.setItem(DB_KEY, JSON.stringify(db));
const loadMeta = () => { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; } };
const saveMeta = m => localStorage.setItem(META_KEY, JSON.stringify(m));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmt(t) {
  if (!t) return '—';
  const d = new Date(t), h = new Date(), dia = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((dia(h) - dia(d)) / 864e5);
  if (diff === 0) return 'Hoje'; if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(d.getFullYear() !== h.getFullYear() && { year: 'numeric' }) });
}

// Miniatura: desenha os nós do mapa (aba ativa) e as ligações pai → filho
function thumb(s) {
  const sh = (s.sheets || []).find(x => x.id === s.activeSheetId) || (s.sheets || [])[0];
  const ns = ((sh && sh.nodes) || []).filter(n => isFinite(n.x) && isFinite(n.y)).slice(0, 400);
  if (!ns.length) return '<div class="thumb"></div>';
  const W = 220, H = 70, xs = ns.map(n => n.x), ys = ns.map(n => n.y);
  const x0 = Math.min(...xs) - 40, y0 = Math.min(...ys) - 40;
  const vw = Math.max(...xs) - x0 + W + 40, vh = Math.max(...ys) - y0 + H + 40, sw = Math.max(vw, vh) / 140;
  const by = Object.fromEntries(ns.map(n => [n.id, n]));
  const lines = ns.filter(n => by[n.parentId]).map(n => { const p = by[n.parentId];
    return `<line x1="${p.x + W / 2}" y1="${p.y + H / 2}" x2="${n.x + W / 2}" y2="${n.y + H / 2}" stroke="#94a3b8" stroke-width="${sw}"/>`; }).join('');
  const boxes = ns.map(n => `<rect x="${n.x}" y="${n.y}" width="${W}" height="${H}" rx="14" fill="${COR[n.color] || COR.white}"/>`).join('');
  return `<div class="thumb"><svg viewBox="${x0} ${y0} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">${lines}${boxes}</svg></div>`;
}

function render() {
  const db = load(), meta = loadMeta(), q = $('q').value.toLowerCase(), st = $('sort').value, onlyFav = $('favs').checked;
  let keys = Object.keys(db).filter(k => (db[k].title || '').toLowerCase().includes(q) && (!onlyFav || (meta[k] || {}).fav));
  const t = (k, f) => (meta[k] || {})[f] || 0;
  keys.sort((a, b) => st === 'name' ? (db[a].title || '').localeCompare(db[b].title || '', 'pt-BR') : t(b, st) - t(a, st));
  $('vg').classList.toggle('on', view === 'grid'); $('vl').classList.toggle('on', view === 'list');
  if (!keys.length) { $('list').innerHTML = '<p class="mut">Nenhum mapa encontrado.</p>'; return; }
  const star = k => `<button class="ic ${(meta[k] || {}).fav ? 'fav' : ''}" data-fav="${esc(k)}" title="Favorito"><i class="fa-${(meta[k] || {}).fav ? 'solid' : 'regular'} fa-star"></i></button>`;
  const menu = k => `<button class="ic" data-menu="${esc(k)}" title="Mais"><i class="fa-solid fa-ellipsis-vertical"></i></button>`;
  const info = (s, k) => { const n = (s.sheets || []).reduce((a, sh) => a + ((sh.nodes || []).length), 0);
    return `${(s.sheets || []).length} aba(s) · ${n} nós · modificado ${fmt(t(k, 'modified')).toLowerCase()}`; };
  if (view === 'grid') {
    $('list').innerHTML = '<div class="gv">' + keys.map(k => `<div class="card" data-open="${esc(k)}">${thumb(db[k])}
      <div class="in"><div class="nm"><div><b>${esc(db[k].title || 'Sem título')}</b><span>${fmt(t(k, 'opened'))}</span></div></div>
      <div class="act">${star(k)}${menu(k)}</div></div></div>`).join('') + '</div>';
  } else {
    $('list').innerHTML = '<div class="row h"><div>Nome</div><div>Última abertura</div><div>Modificado</div><div>Titular</div><div></div></div>' +
      keys.map(k => `<div class="row it" data-open="${esc(k)}"><div class="nm">${thumb(db[k])}<div style="min-width:0"><b>${esc(db[k].title || 'Sem título')}</b><span>${info(db[k], k)}</span></div></div>
      <div class="mut">${fmt(t(k, 'opened'))}</div><div class="mut">${fmt(t(k, 'modified'))}</div><div class="mut" style="overflow:hidden;text-overflow:ellipsis">${esc(owner)}</div>
      <div class="act">${star(k)}${menu(k)}</div></div>`).join('');
  }
}

$('list').onclick = e => {
  const fav = e.target.closest('[data-fav]'), mn = e.target.closest('[data-menu]'), ac = e.target.closest('[data-act]'), op = e.target.closest('[data-open]');
  document.querySelectorAll('.menu').forEach(m => m.remove());
  if (fav) { const m = loadMeta(), k = fav.dataset.fav; m[k] = { ...m[k], fav: !(m[k] || {}).fav }; saveMeta(m); return render(); }
  if (mn) { const k = mn.dataset.menu, d = document.createElement('div'); d.className = 'menu';
    d.innerHTML = `<button data-act="open" data-k="${esc(k)}">Abrir</button><button data-act="json" data-k="${esc(k)}">Exportar JSON</button><button data-act="del" data-k="${esc(k)}">Excluir</button>`;
    mn.parentElement.appendChild(d); return e.stopPropagation(); }
  if (ac) { const k = ac.dataset.k, db = load();
    if (ac.dataset.act === 'open') return abrir(k);
    if (ac.dataset.act === 'json') { const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(db[k], null, 2)], { type: 'application/json' }));
      a.download = (db[k].title || 'mapa').replace(/[^\w-]+/g, '_') + '.json'; return a.click(); }
    if (ac.dataset.act === 'del') {
      if (Object.keys(db).length <= 1) return alert('Mantenha ao menos uma história.');
      if (confirm('Excluir "' + db[k].title + '"?')) { delete db[k]; save(db); SM_CLOUD.remove(k).catch(e => { console.warn(e); alert('Excluído aqui, mas não foi possível remover da nuvem agora. Vamos tentar de novo na próxima sincronização.'); }); render(); } }
    return; }
  if (op) abrir(op.dataset.open);
};
document.addEventListener('click', e => { if (!e.target.closest('.act')) document.querySelectorAll('.menu').forEach(m => m.remove()); });

function abrir(k) { const m = loadMeta(); m[k] = { ...m[k], opened: Date.now() }; saveMeta(m); location.href = 'app.html?story=' + encodeURIComponent(k); }
$('new').onclick = () => { location.href = 'app.html?story=new'; };
['q', 'sort', 'favs'].forEach(i => $(i).oninput = render);
$('vg').onclick = () => { view = 'grid'; localStorage.setItem('storymind_view', view); render(); };
$('vl').onclick = () => { view = 'list'; localStorage.setItem('storymind_view', view); render(); };
$('imp').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try {
    const j = JSON.parse(r.result); if (!j.sheets && !j.nodes) throw 0;
    const db = load(), k = 'story_' + Date.now(); db[k] = j; save(db); SM_CLOUD.push(k, j);
    const m = loadMeta(); m[k] = { opened: Date.now(), modified: Date.now() }; saveMeta(m); render();
  } catch (_) { alert('JSON inválido.'); } };
  r.readAsText(f);
};

window.addEventListener('pagehide', () => SM_CLOUD.flush());
SM_AUTH.user().then(u => { if (u) { owner = u.email; $('who').textContent = u.email; } });
// Baixa da nuvem e pega as datas de modificação
SM_CLOUD.pull().then(async () => {
  try { const { data } = await sb.from('stories').select('key,updated_at'), m = loadMeta();
    (data || []).forEach(r => { m[r.key] = { ...m[r.key], modified: new Date(r.updated_at).getTime() }; });
    Object.keys(load()).forEach(k => { m[k] = { opened: Date.now(), ...m[k] }; }); saveMeta(m); } catch (e) {}
  render();
});
render();
