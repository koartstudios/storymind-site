const DB_KEY = 'storymind_database_v2', META_KEY = 'storymind_meta';   // mesma chave do app.html
const $ = id => document.getElementById(id);
const COR = { purple: '#a78bfa', orange: '#fbbf24', blue: '#60a5fa', emerald: '#34d399', rose: '#fb7185', white: '#cbd5e1' };
let owner = '', view = localStorage.getItem('storymind_view') || 'list';
// 🔽 ADICIONE ESTE BLOCO AQUI 🔽
const NODE_TYPE_CONFIG = {
  'scene':      { label: 'Cenas',       icon: 'fa-film',             color: 'bg-indigo-100 text-indigo-700' },
  'character':  { label: 'Personagens', icon: 'fa-user',             color: 'bg-emerald-100 text-emerald-700' },
  'location':   { label: 'Cenários',    icon: 'fa-location-dot',     color: 'bg-teal-100 text-teal-700' },
  'event':      { label: 'Eventos',     icon: 'fa-bolt',             color: 'bg-amber-100 text-amber-700' },
  'dialogue':   { label: 'Diálogos',    icon: 'fa-comments',         color: 'bg-sky-100 text-sky-700' },
  'theme':      { label: 'Temas',       icon: 'fa-masks-theater',    color: 'bg-rose-100 text-rose-700' },
  'note':       { label: 'Notas',       icon: 'fa-note-sticky',      color: 'bg-slate-100 text-slate-700' },
  'timeline':   { label: 'Timelines',   icon: 'fa-timeline',         color: 'bg-purple-100 text-purple-700' },
  'object':     { label: 'Objetos',     icon: 'fa-flask',            color: 'bg-orange-100 text-orange-700' },
  'sem':        { label: 'Sem Tipo',    icon: 'fa-xmark',            color: 'bg-slate-100 text-slate-500' }
};
document.getElementById('favs').checked = false;

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
  
  // 1. CALCULAR TIPOS DE NÓS
  let typeCounts = {};
  Object.values(db).forEach(story => {
    (story.sheets || []).forEach(sheet => {
      (sheet.nodes || []).forEach(node => {
        const t = node.type || 'sem';
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });
    });
  });

  // 2. RENDERIZAR PAINEL DE TIPOS DE NÓS
  const typesContainer = document.getElementById('node-types-container');
  const typesGrid = document.getElementById('node-types-grid');
  if (typesContainer && typesGrid) {
    const activeTypes = Object.keys(typeCounts).sort((a,b) => typeCounts[b] - typeCounts[a]);
    if (activeTypes.length > 0) {
      typesContainer.style.display = 'block';
      typesGrid.innerHTML = activeTypes.map(t => {
        const conf = NODE_TYPE_CONFIG[t] || { label: t, icon: 'fa-circle', color: 'bg-slate-100 text-slate-700' };
        // 🔽 NOVO ESTILO: Usa as variáveis do seu CSS para funcionar no claro e escuro 🔽
        return `<div style="display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:999px; border:1px solid var(--line, #e2e8f0); background:var(--card, #fff); font-size:11px; font-weight:600; box-shadow:0 1px 3px rgba(0,0,0,0.05); color:var(--tx, #0f172a);">
          <i class="fa-solid ${conf.icon}" style="color:#6366f1;"></i> ${conf.label} 
          <span style="background:#6366f1; color:#fff; padding:1px 8px; border-radius:999px; font-size:10px; font-weight:800;">${typeCounts[t]}</span>
        </div>`;
      }).join('');
    } else {
      typesContainer.style.display = 'none';
    }
  }

  // 3. FILTRAR E ORDENAR HISTÓRIAS
  let keys = Object.keys(db).filter(k => (db[k].title || '').toLowerCase().includes(q) && (!onlyFav || db[k].isFavorite));
  const t = (k, f) => {
    const m = meta[k] || {};
    if (window.SM_DATES && (f === 'created' || f === 'modified')) {
      const v = f === 'created' ? SM_DATES.created(k, db[k], m) : SM_DATES.modified(k, db[k], m);
      if (v) return v;
    }
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
    $('list').innerHTML = '<p class="mut">Nenhum mapa encontrado.</p>'; 
    return; 
  }
  
  // 4. RENDERIZAR CARDS COM METADADOS
  const star = k => `<button class="ic ${db[k].isFavorite ? 'fav' : ''}" data-fav="${esc(k)}" title="Favorito"><i class="fa-${db[k].isFavorite ? 'solid' : 'regular'} fa-star"></i></button>`;
  
  // Menu atualizado com o botão de metadados (sliders)
  const menu = k => `
    <button class="ic" data-meta="${esc(k)}" title="Detalhes / Gênero"><i class="fa-solid fa-sliders"></i></button>
    <button class="ic" data-menu="${esc(k)}" title="Mais opções"><i class="fa-solid fa-ellipsis-vertical"></i></button>`;
    
  const info = (s, k) => { 
    const n = (s.sheets || []).reduce((a, sh) => a + ((sh.nodes || []).length), 0);
    const g = s.meta?.genre ? `<span style="background:#eef2ff; color:#4338ca; padding:1px 6px; border-radius:4px; font-size:9px; font-weight:800; margin-right:4px;">${esc(s.meta.genre)}</span>` : '';
    const stat = s.meta?.status ? `<span style="background:#ecfdf5; color:#047857; padding:1px 6px; border-radius:4px; font-size:9px; font-weight:800; margin-right:4px;">${esc(s.meta.status)}</span>` : '';
    return `${g}${stat}${(s.sheets || []).length} aba(s) · ${n} nós · modificado ${fmt(t(k, 'modified')).toLowerCase()}`; 
  };

  if (view === 'grid') {
    $('list').innerHTML = '<div class="gv">' + keys.map(k => `
      <div class="card" data-open="${esc(k)}">
        <div class="thumb">
            ${thumb(db[k])}
            <div class="overlay"><span>Abrir mapa</span></div>
        </div>
        <div class="in">
            <div class="nm">
                <div style="min-width:0">
                    <b>${esc(db[k].title || 'Sem título')}</b>
                    <span style="display:block; margin-top:4px;">${info(db[k], k)}</span>
                    ${db[k].meta?.logline ? `<p style="font-size:10px; color:#64748b; font-style:italic; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">"${esc(db[k].meta.logline)}"</p>` : ''}
                </div>
            </div>
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
  const metaBtn = e.target.closest('[data-meta]'); // ✅ Botão de Detalhes
  const op = e.target.closest('[data-open]');
  
  document.querySelectorAll('.menu').forEach(m => m.remove());

  // ✅ 1. Abrir Modal de Metadados
  if (metaBtn) {
    const k = metaBtn.dataset.meta;
    const s = load()[k];
    $('meta-key').value = k;
    $('meta-genre').value = s.meta?.genre || '';
    $('meta-status').value = s.meta?.status || '';
    $('meta-logline').value = s.meta?.logline || '';
    $('meta-audience').value = s.meta?.audience || '';
    document.getElementById('meta-modal').style.display = 'flex';
    return e.stopPropagation();
  }

  // ✅ 2. Botão de Favorito
  if (fav) { 
    const db = load(), k = fav.dataset.fav; 
    if (db[k]) {
        db[k].isFavorite = !db[k].isFavorite; 
        save(db); 
        if (window.SM_CLOUD) {
            SM_CLOUD.push(k, db[k]); 
            if (SM_CLOUD.flush) SM_CLOUD.flush(); 
        }
    }
    return render(); 
  }
  
  // ✅ 3. Menu de Três Pontinhos (Duplicar, Excluir, etc)
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
        ev.stopPropagation(); 
        
        const key = btn.dataset.k;
        const act = btn.dataset.act;
        const db = load();
        d.remove(); 

        if (act === 'open') return abrir(key);

        if (act === 'dup') {
            const original = db[key];
            const copy = JSON.parse(JSON.stringify(original));
            const newK = 'story_' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            copy.title = (original.title || 'Sem título') + ' (Cópia)';
            try { if (window.SM_DATES) SM_DATES.resetForCopy(copy); } catch (_) {} 
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
    let res = await sb.from('stories').select('key,created_at,updated_at');
    if (res.error) res = await sb.from('stories').select('key,updated_at');   // tabela sem created_at: segue como antes
    const data = res.data, m = loadMeta();
    (data || []).forEach(r => { 
        m[r.key] = { ...m[r.key], modified: new Date(r.updated_at).getTime() };
        if (r.created_at) m[r.key].cloudCreated = new Date(r.created_at).getTime();
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

// MIGRAÇÃO DE FAVORITOS ANTIGOS
(function migrarFavoritos() {
  // ... código original que já estava aí ...
})();

// 🔽 COLE ISSO AQUI 🔽
window.saveStoryMeta = function() {
    const k = document.getElementById('meta-key').value;
    if (!k) return;
    const db = load();
    if (!db[k]) return;

    if (!db[k].meta) db[k].meta = {};
    db[k].meta.genre = document.getElementById('meta-genre').value;
    db[k].meta.status = document.getElementById('meta-status').value;
    db[k].meta.logline = document.getElementById('meta-logline').value.trim();
    db[k].meta.audience = document.getElementById('meta-audience').value;

    save(db);
    
    if (window.SM_CLOUD) {
        SM_CLOUD.push(k, db[k]);
        if (SM_CLOUD.flush) SM_CLOUD.flush();
    }
    
    document.getElementById('meta-modal').style.display = 'none';
    render();
    if (window.SM_TOAST) window.SM_TOAST('Detalhes da história salvos!', 'success');
};
// 🔼 FIM 🔼

window.SM_NODE_TYPES = NODE_TYPE_CONFIG; // Expõe os tipos para a Bíblia

render();