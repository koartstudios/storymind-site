/* StoryMind — atualização ao vivo (Etapa 1)
 *
 * Quando outro aparelho altera a história que está aberta aqui, aplica a versão nova
 * na tela SEM piscar e SEM atropelar o que você está fazendo (arrastando, digitando,
 * com uma janela aberta...). Se você estiver ocupado, espera e aplica depois.
 *
 * Regras de segurança:
 *  - Se você editou localmente depois que a atualização chegou, a SUA versão vence e a
 *    versão que chegou é guardada no histórico de versões (nada se perde em silêncio).
 *  - Não chama saveStoriesStorage(): aplicar o que veio da nuvem não gera nova gravação.
 *  - Para desligar: localStorage.setItem('sm_live_off','1') e recarregue.
 */
(function () {
  'use strict';
  if (window.SM_LIVE) return;

  var MODALS = ['beat-picker-modal', 'bible-modal', 'mentions-modal', 'reteia-modal',
    'scene-writing-modal', 'skilltree-modal', 'st-copy-modal', 'story-modal',
    'timeline-modal', 'variant-modal'];
  var TEXT_INPUT_TYPES = ['', 'text', 'search', 'number', 'email', 'url', 'tel', 'password'];

  var pending = null;      // { key, arrivedAt, remote }
  var retryTimer = null;

  function off() { try { return localStorage.getItem('sm_live_off') === '1'; } catch (_) { return false; } }

  function visible(el) {
    if (!el) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  // O usuário está no meio de alguma coisa? Então não mexe na tela agora.
  function isBusy() {
    try {
      if (typeof editingNodeId !== 'undefined' && editingNodeId) return true;
      if (typeof isPanning !== 'undefined' && isPanning) return true;
      if (typeof isMarqueeSelecting !== 'undefined' && isMarqueeSelecting) return true;
      if (typeof isDraggingControlPoint !== 'undefined' && isDraggingControlPoint) return true;
      if (typeof isDraggingMinimap !== 'undefined' && isDraggingMinimap) return true;
      if (typeof draggedNodeId !== 'undefined' && draggedNodeId) return true;
      if (typeof activePointers !== 'undefined' && activePointers && activePointers.size > 0) return true;
      if (typeof pinchState !== 'undefined' && pinchState) return true;
      if (typeof saveTimer !== 'undefined' && saveTimer) return true;        // edição ainda não salva
      if (typeof saveScheduled !== 'undefined' && saveScheduled) return true;
    } catch (_) { return true; }

    var ae = document.activeElement;
    if (ae && ae.id !== 'search-input') {
      var tag = ae.tagName;
      if (tag === 'TEXTAREA' || ae.isContentEditable) return true;
      if (tag === 'INPUT' && TEXT_INPUT_TYPES.indexOf((ae.type || '').toLowerCase()) !== -1) return true;
    }
    for (var i = 0; i < MODALS.length; i++) {
      if (visible(document.getElementById(MODALS[i]))) return true;
    }
    return false;
  }

  // O usuário editou ESTA história depois que a atualização chegou?
  function editedLocallySince(p) {
    try {
      var c = window.SM_CLOUD;
      if (!c) return false;
      if ((c.lastPushTs[p.key] || 0) > p.arrivedAt) return true;
      if (c.queue[p.key]) return true;
      var d = c.dirty()[p.key] || 0;
      return d > p.arrivedAt;
    } catch (_) { return false; }
  }

  function keepRemoteCopy(p) {
    try { if (window.SM_STORE && p.remote) SM_STORE.beforeOverwrite(p.key, p.remote); } catch (_) {}
    try {
      showToast('Você e outro aparelho editaram ao mesmo tempo. Mantive a sua versão; a outra ficou no histórico de versões.', 'warn', 6000);
    } catch (_) {}
  }

  // Troca a história aberta pela versão que chegou, mantendo zoom, posição, página e seleção.
  function applyRemote(key) {
    var fresh = storiesDatabase[key];
    if (!fresh) return false;

    var prevSheetId = mindMapData && mindMapData.id;
    var prevSelected = Array.from(selectedNodeIds);
    var inspectorId = null;
    try {
      var side = document.getElementById('inspector-sidebar');
      if (side && !side.classList.contains('translate-x-full')) {
        var f = document.getElementById('edit-node-id');
        inspectorId = f && f.value;
      }
    } catch (_) {}

    currentStory = migrateStoryToSheets(deepClone(fresh));
    var sheet = currentStory.sheets.find(function (s) { return s.id === prevSheetId; })
      || currentStory.sheets.find(function (s) { return s.id === currentStory.activeSheetId; })
      || currentStory.sheets[0];
    mindMapData = sheet;

    selectedNodeIds.clear();
    prevSelected.forEach(function (id) {
      if (mindMapData.nodes.some(function (n) { return n.id === id; })) selectedNodeIds.add(id);
    });
    if (typeof selectedRelationshipId !== 'undefined' && selectedRelationshipId) {
      var relOk = (mindMapData.relationships || []).some(function (r) { return r.id === selectedRelationshipId; });
      if (!relOk) { selectedRelationshipId = null; try { closeRelationshipEditor(); } catch (_) {} }
    }

    applyTheme(mindMapData.theme || 'default');
    var layoutSel = document.getElementById('layout-select');
    if (layoutSel) layoutSel.value = mindMapData.layout || 'tree';
    domCache.clear(); domCache.invalidateHeights();
    invalidateStructure();
    try { syncBeatSheetUI(); syncBeatSortUI(); syncTimelineModeUI(); } catch (_) {}
    rebuildNodeIndex();

    // Desfazer não pode desfazer o que veio de outro aparelho: recomeça o histórico desta página.
    try {
      history.stack = []; history.index = -1;
      historiesBySheet.delete(mindMapData.id);
      pushHistory();
    } catch (_) {}

    renderApp();
    renderSheetTabs();

    if (inspectorId) {
      if (mindMapData.nodes.some(function (n) { return n.id === inspectorId; })) openInspectorFor(inspectorId);
      else closeInspector();
    }
    return true;
  }

  function tryApply() {
    clearTimeout(retryTimer); retryTimer = null;
    if (!pending) return;
    if (typeof currentStoryKey === 'undefined' || pending.key !== currentStoryKey) { pending = null; return; }

    if (editedLocallySince(pending)) {          // sua edição é mais nova: ela vence
      keepRemoteCopy(pending);
      pending = null;
      return;
    }
    if (isBusy()) { retryTimer = setTimeout(tryApply, 1000); return; }

    var p = pending; pending = null;
    try {
      if (applyRemote(p.key) && !document.hidden) showToast('Atualizado em outro aparelho.', 'success', 1500);
    } catch (e) {
      console.warn('[SM_LIVE] falha ao aplicar atualização; recarregue a página:', e);
    }
  }

  function onPullDone(ev) {
    var d = (ev && ev.detail) || {};
    var changed = d.changed || [], deleted = d.deleted || [];
    if (!changed.length && !deleted.length) return;          // nada mudou de verdade: não mexe em nada

    // Mantém o banco em memória fresco, para que um salvamento antigo não apague o que acabou de chegar.
    loadStoriesStorage();

    var key = typeof currentStoryKey !== 'undefined' ? currentStoryKey : null;

    if (key && deleted.indexOf(key) !== -1) {                 // a história aberta foi excluída em outro aparelho
      pending = null;
      var keys = Object.keys(storiesDatabase);
      if (keys.length) {
        try { showToast('Esta história foi excluída em outro aparelho.', 'warn', 5000); } catch (_) {}
        switchStory(keys[0]);
      }
      return;
    }
    if (key && changed.indexOf(key) !== -1) {
      pending = { key: key, arrivedAt: Date.now(), remote: deepClone(storiesDatabase[key]) };
      tryApply();
    }
  }

  window.SM_LIVE = {
    onPullDone: function (ev) { if (off()) return false; onPullDone(ev); return true; },
    isBusy: isBusy,
    _state: function () { return { pending: pending }; }
  };
})();
