/* StoryMind — Compartilhar
 *
 * Tela de compartilhamento (substitui o prompt() antigo):
 *   - dona: convida por e-mail (pode editar / só leitura), vê quem tem acesso, muda o papel, remove
 *   - convidado: vê de quem é a história e seu papel, e pode SAIR dela
 *   - aviso de "modo leitura" quando a história foi compartilhada só para leitura
 *
 * Precisa do SQL compartilhamento-supabase.sql no Supabase (sm_share_story / sm_story_sharing).
 * As permissões de verdade são cumpridas pelo banco; esta tela só as mostra e as pede.
 */
(function () {
  'use strict';
  if (window.SM_SHARING) return;

  var ROLE_LABEL = { editor: 'Pode editar', viewer: 'Só leitura' };
  var overlay = null;
  var state = { key: null, info: null, busy: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function say(msg, type) {
    try { showToast(msg, type || 'success', 4000); } catch (_) { try { alert(msg); } catch (__) {} }
  }
  function errText(code) {
    return ({
      not_found: 'Nenhuma conta com esse e-mail. A pessoa precisa criar a conta no StoryMind primeiro.',
      self: 'Você não pode convidar a si mesma.',
      not_owner: 'Só quem criou a história pode convidar.',
      bad_role: 'Papel inválido.'
    })[code] || 'Não foi possível compartilhar.';
  }
  function msgOf(e) { return esc(e && e.message ? e.message : e); }

  // ---------- HTML (funções puras) ----------
  var CARD = 'background:#fff;border-radius:14px;max-width:480px;width:calc(100% - 32px);max-height:85vh;overflow:auto;' +
    'box-shadow:0 20px 50px rgba(15,23,42,.35);padding:18px 20px;font-family:Inter,system-ui,sans-serif;color:#0f172a;';
  var BTN = 'border:0;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;';
  var INPUT = 'border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:13px;';

  function head(title) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
      '<div style="font-size:16px;font-weight:700">' + esc(title) + '</div>' +
      '<button type="button" onclick="SM_SHARING.close()" aria-label="Fechar" style="' + BTN + 'background:#f1f5f9;color:#334155">✕</button></div>';
  }
  function msgBox(text) {
    return head('Compartilhar') + '<p style="font-size:14px;line-height:1.5;color:#475569;margin:0">' + text + '</p>';
  }
  function roleSelect(id, value) {
    return '<select onchange="SM_SHARING.setRole(\'' + esc(id) + '\', this.value)" style="' + INPUT + 'padding:6px 8px">' +
      ['editor', 'viewer'].map(function (r) {
        return '<option value="' + r + '"' + (r === value ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>';
      }).join('') + '</select>';
  }
  function renderOwner(info) {
    var members = info.members || [];
    var list = members.length
      ? members.map(function (m) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #e2e8f0">' +
            '<div style="flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(m.email) + '">' + esc(m.email) + '</div>' +
            roleSelect(m.id, m.role) +
            '<button type="button" title="Remover acesso" onclick="SM_SHARING.removeMember(\'' + esc(m.id) + '\', \'' + esc(String(m.email).replace(/'/g, '')) + '\')" ' +
            'style="' + BTN + 'background:#fee2e2;color:#b91c1c;padding:6px 9px">Remover</button></div>';
        }).join('')
      : '<p style="font-size:13px;color:#64748b;margin:8px 0 0">Ninguém além de você tem acesso a esta história ainda.</p>';
    return head('Compartilhar esta história') +
      '<div style="font-size:13px;color:#475569;margin-bottom:8px">Convide pela conta de e-mail que a pessoa usa no StoryMind.</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<input id="sm-share-email" type="email" placeholder="e-mail da pessoa" autocomplete="off" style="' + INPUT + 'flex:1;min-width:160px">' +
      '<select id="sm-share-role" style="' + INPUT + '"><option value="editor">Pode editar</option><option value="viewer">Só leitura</option></select>' +
      '<button type="button" onclick="SM_SHARING.invite()" style="' + BTN + 'background:#4f46e5;color:#fff">Convidar</button></div>' +
      '<div style="margin-top:16px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em">Quem tem acesso</div>' + list +
      '<p style="font-size:12px;color:#94a3b8;margin:14px 0 0;line-height:1.45">Quem pode editar altera a história junto com você, sem sobrescrever o seu trabalho. ' +
      'Quem só lê vê as mudanças, mas não consegue salvar. Só você pode excluir a história.</p>';
  }
  function renderMember(info) {
    return head('Esta história foi compartilhada com você') +
      '<p style="font-size:14px;line-height:1.55;color:#334155;margin:0 0 6px">De: <b>' + esc(info.owner_email || 'outra pessoa') + '</b></p>' +
      '<p style="font-size:14px;line-height:1.55;color:#334155;margin:0 0 14px">Seu acesso: <b>' + esc(ROLE_LABEL[info.role] || ROLE_LABEL.editor) + '</b></p>' +
      '<button type="button" onclick="SM_SHARING.leave()" style="' + BTN + 'background:#fee2e2;color:#b91c1c">Sair desta história</button>' +
      '<p style="font-size:12px;color:#94a3b8;margin:12px 0 0;line-height:1.45">Sair não exclui a história para a dona nem para os outros. ' +
      'Sua cópia neste aparelho fica no histórico de versões.</p>';
  }

  // ---------- janela ----------
  function show(html) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sm-share-overlay';
      overlay.setAttribute('style', 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:99999;display:flex;align-items:center;justify-content:center');
      overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '<div style="' + CARD + '">' + html + '</div>';
  }
  function close() { if (overlay) { try { overlay.remove(); } catch (_) {} overlay = null; } }

  function missingSql(err) { return !!(window.SM_CLOUD && window.SM_CLOUD._isMissingFn && window.SM_CLOUD._isMissingFn(err)); }

  async function refresh() {
    try {
      var r = await sb.rpc('sm_story_sharing', { p_key: state.key });
      if (r.error) {
        if (missingSql(r.error)) { show(msgBox('O SQL do compartilhamento ainda não foi rodado no Supabase. Rode o arquivo <b>compartilhamento-supabase.sql</b> e tente de novo.')); return; }
        throw r.error;
      }
      var info = r.data || {};
      if (!info.found) { show(msgBox('Esta história ainda não está na nuvem. Espere aparecer “Salvo” no topo e tente de novo.')); return; }
      state.info = info;
      show(info.is_owner ? renderOwner(info) : renderMember(info));
    } catch (e) {
      show(msgBox('Não consegui carregar o compartilhamento: ' + msgOf(e)));
    }
  }

  async function open() {
    var key = typeof currentStoryKey !== 'undefined' ? currentStoryKey : null;
    if (!key) return;
    state.key = key; state.info = null;
    show('<p style="font-size:14px;color:#64748b;margin:0">Carregando…</p>');
    await refresh();
  }

  // ---------- ações ----------
  async function invite() {
    var emailEl = document.getElementById('sm-share-email'), roleEl = document.getElementById('sm-share-role');
    var email = emailEl ? String(emailEl.value || '').trim() : '';
    var role = roleEl ? roleEl.value : 'editor';
    if (!email || state.busy) return;
    state.busy = true;
    try {
      var r = await sb.rpc('sm_share_story', { p_key: state.key, p_email: email, p_role: role });
      if (r.error) {
        if (missingSql(r.error)) say('O SQL do compartilhamento ainda não foi rodado no Supabase.', 'warn');
        else throw r.error;
      } else if (r.data && r.data.ok) {
        say('Acesso concedido a ' + email + ' (' + (ROLE_LABEL[role] || role) + '). Peça para a pessoa abrir o StoryMind.');
        await refresh();
      } else {
        say(errText(r.data && r.data.error), 'warn');
      }
    } catch (e) {
      say('Erro ao compartilhar: ' + (e && e.message ? e.message : e), 'warn');
    } finally { state.busy = false; }
  }

  async function setRole(id, role) {
    try {
      var r = await sb.from('story_members').update({ role: role }).eq('id', id);
      if (r.error) throw r.error;
      say('Papel atualizado.');
    } catch (e) {
      say('Não consegui mudar o papel: ' + (e && e.message ? e.message : e), 'warn');
    }
    await refresh();
  }

  async function removeMember(id, email) {
    if (!confirm('Remover o acesso de ' + email + '?\nA pessoa deixa de ver esta história.')) return;
    try {
      var r = await sb.from('story_members').delete().eq('id', id);
      if (r.error) throw r.error;
      say('Acesso removido.');
    } catch (e) {
      say('Não consegui remover: ' + (e && e.message ? e.message : e), 'warn');
    }
    await refresh();
  }

  // Convidado sai da história: remove o próprio convite (não exclui nada para os outros)
  async function leave() {
    if (!confirm('Sair desta história?\nEla continua existindo para a dona. Sua cópia neste aparelho fica no histórico de versões.')) return;
    try {
      var key = state.key;
      var u = (await sb.auth.getUser()).data.user;
      if (!u) throw new Error('Você não está conectada.');
      var r = await sb.from('story_members').delete().eq('story_key', key).eq('member_id', u.id);
      if (r.error) throw r.error;
      try { if (window.SM_STORE) SM_STORE.noteDeleted(key); } catch (_) {}
      var shared = SM_CLOUD.sharedMap(); delete shared[key]; SM_CLOUD.setSharedMap(shared);
      var db = SM_CLOUD.local();
      if (db[key]) { delete db[key]; localStorage.setItem(SM_CLOUD.DB_KEY, JSON.stringify(db)); }
      SM_CLOUD.addTombstone(key);        // evita reenvio; se for convidada de novo, a nuvem a traz de volta
      close();
      location.href = 'dashboard.html';
    } catch (e) {
      say('Não consegui sair da história: ' + (e && e.message ? e.message : e), 'warn');
    }
  }

  // ---------- aviso de modo leitura ----------
  function updateBanner() {
    var key = typeof currentStoryKey !== 'undefined' ? currentStoryKey : null;
    var viewer = false;
    try { viewer = !!key && !!window.SM_CLOUD && window.SM_CLOUD.roleOf(key) === 'viewer'; } catch (_) {}
    var bar = document.getElementById('sm-readonly-bar');
    if (viewer && !bar) {
      bar = document.createElement('div');
      bar.id = 'sm-readonly-bar';
      bar.setAttribute('style', 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9998;background:#1e293b;color:#fff;' +
        'padding:8px 14px;border-radius:999px;font:600 12px Inter,system-ui,sans-serif;box-shadow:0 6px 20px rgba(15,23,42,.3);max-width:calc(100% - 24px);text-align:center');
      bar.textContent = 'Modo leitura: esta história foi compartilhada só para leitura. Suas alterações não são salvas.';
      document.body.appendChild(bar);
    } else if (!viewer && bar) {
      try { bar.remove(); } catch (_) {}
    }
  }

  window.addEventListener('cloud:forbidden', function () {
    say('Sem permissão para salvar esta história (acesso removido ou só leitura).', 'warn');
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
  setInterval(updateBanner, 1500);

  window.SM_SHARING = {
    open: open, close: close, invite: invite, setRole: setRole, removeMember: removeMember, leave: leave,
    _t: { esc: esc, errText: errText, renderOwner: renderOwner, renderMember: renderMember, updateBanner: updateBanner }
  };
})();
