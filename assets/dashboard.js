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

// Miniatura: agora retorna apenas o SVG
function thumb(s) {
  const sh = (s.sheets || []).find(x => x.id === s.activeSheetId) || (s.sheets || [])[0];
  const ns = ((sh && sh.nodes) || []).filter(n => isFinite(n.x) && isFinite(n.y)).slice(0, 400);
  if (!ns.length) return '';
  const W = 220, H = 70, xs = ns.map(n => n.x), ys = ns.map(n => n.y);
  const x0 = Math.min(...xs) - 40, y0 = Math.min(...ys) - 40;
  const vw = Math.max(...xs) - x0 + W + 40, vh = Math.max(...ys) - y0 + H + 40, sw = Math.max(vw, vh) / 140;
  const by = Object.fromEntries(ns.map(n => [n.id, n]));
  const lines = ns.filter(n => by[n.parentId]).map(n => { const p = by[n.parentId];
    return `<line x1="${p.x + W / 2}" y1="${p.y + H / 2}" x2="${n.x + W / 2}" y2="${n.y + H / 2}" stroke="#94a3b8" stroke-width="${sw}"/>`; }).join('');
  const boxes = ns.map(n => `<rect x="${n.x}" y="${n.y}" width="${W}" height="${H}" rx="14" fill="${COR[n.color] || COR.white}"/>`).join('');
  return `<svg viewBox="${x0} ${y0} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">${lines}${boxes}</svg>`;
}

function render() {
  const db = load(), meta = loadMeta(), q = $('q').value.toLowerCase(), st = $('sort').value, onlyFav = $('favs').checked;
  let keys = Object.keys(db).filter(k => (db[k].title || '').toLowerCase().includes(q) && (!onlyFav || db[k].isFavorite));
  const t = (k, f) => {
    const m = meta[k] || {};
    if (f === 'created') return m.created || m.modified || m.opened || 0;
    return m[f] || 0;
  };
  keys.sort((a, b) => {
    if (st === 'name') return (db[a].title || '').localeCompare(db[b].title || '', 'pt-BR');
    return t(b, st) - t(a, st);
  });
  
  $('vg').classList.toggle('on', view === 'grid'); 
  $('vl').classList.toggle('on', view === 'list');
  
  if (!keys.length) { 
    // O empty state do HTML cuida disso depois via MutationObserver
    $('list').innerHTML = '<p class="mut">Nenhum mapa encontrado.</p>'; 
    return; 
  }
  
  const star = k => `<button class="ic ${db[k].isFavorite ? 'fav' : ''}" data-fav="${esc(k)}" title="Favorito"><i class="fa-${db[k].isFavorite ? 'solid' : 'regular'} fa-star"></i></button>`;
  const menu = k => `<button class="ic" data-menu="${esc(k)}" title="Mais"><i class="fa-solid fa-ellipsis-vertical"></i></button>`;
  const info = (s, k) => { 
    const n = (s.sheets || []).reduce((a, sh) => a + ((sh.nodes || []).length), 0);
    return `${(s.sheets || []).length} aba(s) · ${n} nós · modificado ${fmt(t(k, 'modified')).toLowerCase()}`; 
  };

  if (view === 'grid') {
    $('list').innerHTML = '<div class="gv">' + keys.map(k => `
      <div class="card" data-open="${esc(k)}">
        <div class="thumb">
            ${thumb(db[k])}
            <div class="overlay"><span>Abrir mapa</span></div>
        </div>
        <div class="in">
            <div class="nm"><div><b>${esc(db[k].title || 'Sem título')}</b><span>Criado ${fmt(t(k, 'created')).toLowerCase()}</span></div></div>
            <div class="act">${star(k)}${menu(k)}</div>
        </div>
      </div>`).join('') + '</div>';
  } else {
    $('list').innerHTML = '<div class="row h"><div>Nome</div><div>Criado em</div><div>Modificado</div><div>Titular</div><div></div></div>' +
      keys.map(k => `<div class="row it" data-open="${esc(k)}">
        <div class="nm">${thumb(db[k])}<div style="min-width:0"><b>${esc(db[k].title || 'Sem título')}</b><span>${info(db[k], k)}</span></div></div>
        <div class="mut">${fmt(t(k, 'created'))}</div>
        <div class="mut">${fmt(t(k, 'modified'))}</div>
        <div class="mut" style="overflow:hidden;text-overflow:ellipsis">${esc(owner)}</div>
        <div class="act">${star(k)}${menu(k)}</div>
      </div>`).join('');
  }
}

// --- DELEGAÇÃO DE EVENTOS DA LISTA (Abertura e Favoritos) ---
$('list').onclick = e => {
  const fav = e.target.closest('[data-fav]');
  const mn = e.target.closest('[data-menu]');
  const op = e.target.closest('[data-open]');
  
  document.querySelectorAll('.menu').forEach(m => m.remove());

    if (fav) { 
    const db = load(), k = fav.dataset.fav; 
    if (db[k]) {
        db[k].isFavorite = !db[k].isFavorite; // Inverte o status
        save(db); // Salva no localStorage local
        
        if (window.SM_CLOUD) {
            SM_CLOUD.push(k, db[k]); 
            if (SM_CLOUD.flush) SM_CLOUD.flush(); // OBRIGA o envio imediato
        }
    }
    return render(); 
  }
  
  if (mn) { 
    const k = mn.dataset.menu;
    const d = document.createElement('div');
    d.className = 'menu';
    d.innerHTML = `
        <button data-act="open" data-k="${esc(k)}"><i class="fa-solid fa-folder-open mr-2 text-slate-400"></i>Abrir</button>
        <button data-act="dup" data-k="${esc(k)}"><i class="fa-solid fa-copy mr-2 text-slate-400"></i>Duplicar história</button>
        <button data-act="json" data-k="${esc(k)}"><i class="fa-solid fa-download mr-2 text-slate-400"></i>Exportar JSON</button>
        <hr class="my-1 border-slate-200">
        <button data-act="del" data-k="${esc(k)}" class="text-rose-600 hover:bg-rose-50"><i class="fa-solid fa-trash mr-2"></i>Excluir</button>
    `;
    document.body.appendChild(d);

    // Posiciona o menu
    const rect = mn.getBoundingClientRect();
    const menuW = 180;
    let left = rect.right - menuW;
    let top = rect.bottom + 4;
    if (left < 8) left = 8;
    if (top + 150 > window.innerHeight) top = rect.top - 150 - 4;
    
    d.style.left = left + 'px';
    d.style.top = top + 'px';

    // Handler do próprio menu
    d.onclick = (ev) => {
        const btn = ev.target.closest('[data-act]');
        if (!btn) return;
        ev.stopPropagation(); // Impede o fechamento imediato pelo document
        
        const key = btn.dataset.k;
        const act = btn.dataset.act;
        const db = load();
        d.remove(); // Fecha o menu

        if (act === 'open') return abrir(key);

        if (act === 'dup') {
            const original = db[key];
            const copy = JSON.parse(JSON.stringify(original));
            const newK = 'story_' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            copy.title = (original.title || 'Sem título') + ' (Cópia)';
            db[newK] = copy;
            save(db);
            const m = loadMeta();
            m[newK] = { opened: Date.now(), modified: Date.now(), created: Date.now() };
            saveMeta(m);
            if (window.SM_CLOUD) SM_CLOUD.push(newK, copy);
            render();
            return alert('História duplicada com sucesso!');
        }

        if (act === 'json') {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(db[key], null, 2)], { type: 'application/json' }));
            a.download = (db[key].title || 'mapa').replace(/[^\w-]+/g, '_') + '.json';
            return a.click();
        }

        if (act === 'del') {
            if (Object.keys(db).length <= 1) return alert('Mantenha ao menos uma história.');
            if (confirm('Excluir "' + db[key].title + '"?')) {
                delete db[key];
                save(db);
                SM_CLOUD.remove(key).catch(e => { 
                    console.warn(e); 
                    alert('Excluído aqui, mas não foi possível remover da nuvem agora. Vamos tentar de novo na próxima sincronização.'); 
                });
                render();
            }
        }
    };

    return e.stopPropagation(); 
  }

  if (op) abrir(op.dataset.open);
};

// Fecha o menu ao clicar em qualquer lugar da tela
document.addEventListener('click', e => { 
    if (!e.target.closest('.act') && !e.target.closest('.menu')) {
        document.querySelectorAll('.menu').forEach(m => m.remove()); 
    }
});

function abrir(k) { 
    const m = loadMeta(); 
    m[k] = { ...m[k], opened: Date.now() }; 
    saveMeta(m); 
    location.href = 'app.html?story=' + encodeURIComponent(k); 
}

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
    const m = loadMeta(); m[k] = { opened: Date.now(), modified: Date.now(), created: Date.now() }; saveMeta(m); render();
  } catch (_) { alert('JSON inválido.'); } };
  r.readAsText(f);
};

window.addEventListener('pagehide', () => SM_CLOUD.flush());
SM_AUTH.user().then(u => { if (u) { owner = u.email; $('who').textContent = u.email; } });

// Baixa da nuvem e pega as datas de modificação
SM_CLOUD.pull().then(async () => {
  try { 
    const { data } = await sb.from('stories').select('key,updated_at'), m = loadMeta();
    (data || []).forEach(r => { 
        m[r.key] = { ...m[r.key], modified: new Date(r.updated_at).getTime() }; 
    });
    Object.keys(load()).forEach(k => { 
      const old = m[k] || {};
      m[k] = {
        ...old,
        opened: Date.now(),
        created: old.created || old.modified || Date.now()
      };
    }); 
    saveMeta(m); 
  } catch (e) {}
  render();
});

// MIGRAÇÃO DE FAVORITOS ANTIGOS
(function migrarFavoritos() {
  const db = load();
  const meta = loadMeta();
  let mudou = false;
  
  Object.keys(meta).forEach(k => {
    if (meta[k].fav && db[k] && !db[k].isFavorite) {
      db[k].isFavorite = true;
      mudou = true;
      if (window.SM_CLOUD) SM_CLOUD.push(k, db[k]); // Sincroniza os antigos com a nuvem
    }
  });
  
  if (mudou) save(db);
})();

render();