const DB_KEY = 'storymind_database_v2';   // mesma chave usada pelo app.html
const $ = id => document.getElementById(id);
SM_AUTH.user().then(u => { if (u) $('who').textContent = u.email; });

const load = () => { try { return JSON.parse(localStorage.getItem(DB_KEY)) || {}; } catch (e) { return {}; } };
const save = db => localStorage.setItem(DB_KEY, JSON.stringify(db));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function render() {
  const db = load(), keys = Object.keys(db);
  if (!keys.length) { $('list').innerHTML = '<p class="mut">Nenhuma história ainda. Abra o canvas para criar a primeira.</p>'; return; }
  $('list').innerHTML = keys.map(k => {
    const s = db[k], sheets = s.sheets || [], nodes = sheets.reduce((n, sh) => n + (sh.nodes?.length || 0), 0);
    return `<div class="card"><b>${esc(s.title || 'Sem título')}</b>
      <p class="mut" style="margin:6px 0 14px">${sheets.length} aba(s) · ${nodes} nós</p>
      <a class="btn" href="app.html?story=${encodeURIComponent(k)}">Abrir</a>
      <button class="btn ghost" data-del="${esc(k)}">Excluir</button></div>`;
  }).join('');
}

$('new').onclick = () => { location.href = 'app.html?story=new'; };
$('list').onclick = e => {
  const k = e.target.dataset.del; if (!k) return;
  const db = load();
  if (Object.keys(db).length <= 1) return alert('Mantenha ao menos uma história.');
  if (confirm('Excluir "' + db[k].title + '"?')) { delete db[k]; save(db); SM_CLOUD.remove(k); render(); }
};
$('imp').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try {
    const j = JSON.parse(r.result); if (!j.sheets && !j.nodes) throw 0;
    const db = load(); db['story_' + Date.now()] = j; save(db); SM_CLOUD.push(Object.keys(db).pop(), j); render();
  } catch (_) { alert('JSON inválido.'); } };
  r.readAsText(f);
};
SM_CLOUD.pull().then(render);
