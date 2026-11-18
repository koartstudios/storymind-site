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

  // Etapa 2 ligada? (mesclagem por item: edições de dois aparelhos se somam em vez de uma sobrescrever a outra)
  function mergeMode() { try { return !!(window.SM_MERGE && window.SM_CLOUD && window.SM_CLOUD.mergeOn()); } catch (_) { return false; } }

  function off() { try { return localStorage.getItem('sm_live_off') === '1'; } catch (_) { return false; } }

  function visible(el) {
    if (!el) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  // O usuário está no meio de alguma coisa? Então não mexe na tela agora.
  // ignoreSave: edições locais ainda não salvas NÃO impedem (a mesclagem já as leva em conta).
  function isBusy(ignoreSave) {
    try {
      if (typeof editingNodeId !== 'undefined' && editingNodeId) return true;
      if (typeof isPanning !== 'undefined' && isPanning) return true;
      if (typeof isMarqueeSelecting !== 'undefined' && isMarqueeSelecting) return true;
      if (typeof isDraggingControlPoint !== 'undefined' && isDraggingControlPoint) return true;
      if (typeof isDraggingMinimap !== 'undefined' && isDraggingMinimap) return true;
      if (typeof draggedNodeId !== 'undefined' && draggedNodeId) return true;
      if (typeof activePointers !== 'undefined' && activePointers && activePointers.size > 0) return true;
      if (typeof pinchState !== 'undefined' && pinchState) return true;
      if (!ignoreSave && typeof saveTimer !== 'undefined' && saveTimer) return true;        // edição ainda não salva
      if (!ignoreSave && typeof saveScheduled !== 'undefined' && saveScheduled) return true;
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

  // Carimba as edições locais ainda sem carimbo (e, se houver tempo real, as envia aos outros).
  function stampLocal(key) {
    if (window.SM_CLOUD && typeof window.SM_CLOUD.stampStory === 'function') window.SM_CLOUD.stampStory(key, currentStory);
    else SM_MERGE.stamp(currentStory, { now: window.SM_CLOUD._clock() });
  }

  // Troca a história aberta pela versão que chegou, mantendo zoom, posição, página e seleção.
  function applyRemote(key) {
    var fresh = storiesDatabase[key];
    if (!fresh) return false;

    // Etapa 2: o que está na tela (inclusive edições ainda não enviadas) é mesclado com o que chegou.
    var base = fresh, mergedLocal = false;
    var viewer = false;
    try { viewer = window.SM_CLOUD && window.SM_CLOUD.roleOf(key) === 'viewer'; } catch (_) {}
    if (!viewer && mergeMode() && currentStory && Array.isArray(currentStory.sheets) && Array.isArray(fresh.sheets)) {
      try {
        var clock = window.SM_CLOUD._clock();
        stampLocal(key);
        var m = SM_MERGE.merge(currentStory, fresh, { now: clock });
        if (m) { base = m; mergedLocal = !SM_MERGE.same(m, fresh); }
      } catch (e) { console.warn('[SM_LIVE] mesclagem falhou; usando a versão da nuvem:', e); }
    }

    swapInto(base);
    // Havia edições locais que a nuvem ainda não tem: salva para elas subirem junto.
    if (mergedLocal) { try { saveStoriesStorage(); } catch (_) {} }
    return mergedLocal ? 'merged' : 'applied';
  }

  // Coloca na tela a história `base`, mantendo página, seleção, zoom e inspetor.
  function swapInto(base) {
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

    currentStory = migrateStoryToSheets(deepClone(base));
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
  }


  // ---------- Etapa 3: deltas em tempo real (só o que mudou, ~0,1 s) ----------
  var deltaQueue = [], deltaTimer = null, DELTA_QUEUE_MAX = 60;

  function tryDeltas() {
    clearTimeout(deltaTimer); deltaTimer = null;
    if (!deltaQueue.length) return;
    var key = typeof currentStoryKey !== 'undefined' ? currentStoryKey : null;
    if (!key) { deltaQueue = []; return; }
    if (isBusy(true)) { deltaTimer = setTimeout(tryDeltas, 400); return; }     // arrastando/digitando: espera soltar

    var batch = deltaQueue.splice(0);
    try {
      var clock = window.SM_CLOUD._clock();
      var viewer = false;
      try { viewer = window.SM_CLOUD.roleOf(key) === 'viewer'; } catch (_) {}
      if (!viewer) stampLocal(key);                                             // suas edições ainda sem carimbo entram na conta
      var story = currentStory, applied = 0;                                    // (leitora: rabiscos não ganham carimbo, então não vencem ninguém)
      batch.forEach(function (d) {
        var r = SM_MERGE.applyDelta(story, d, { now: clock, noStamp: viewer });
        if (r) { story = r.story; applied += r.applied; }
      });
      if (applied > 0) swapInto(story);                                         // sem salvar de volta: quem editou já salva
    } catch (e) {
      console.warn('[SM_LIVE] falha ao aplicar delta (a nuvem corrige em instantes):', e);
    }
  }

  function onDelta(p) {
    if (off() || !mergeMode()) return;
    var key = typeof currentStoryKey !== 'undefined' ? currentStoryKey : null;
    if (!key || !p || p.key !== key || !p.delta) return;                         // só vale para a história aberta
    deltaQueue.push(p.delta);
    if (deltaQueue.length > DELTA_QUEUE_MAX) deltaQueue.shift();                // fila longa: o mais antigo a nuvem entrega
    tryDeltas();
  }

  function tryApply() {
    clearTimeout(retryTimer); retryTimer = null;
    if (!pending) return;
    if (typeof currentStoryKey === 'undefined' || pending.key !== currentStoryKey) { pending = null; return; }

    if (!mergeMode() && editedLocallySince(pending)) {   // (sem a Etapa 2) sua edição é mais nova: ela vence
      keepRemoteCopy(pending);
      pending = null;
      return;
    }
    if (isBusy()) { retryTimer = setTimeout(tryApply, 1000); return; }

    var p = pending; pending = null;
    try {
      var res = applyRemote(p.key);
      if (res && !document.hidden) {
        showToast(res === 'merged' ? 'Mudanças de outro aparelho foram combinadas com as suas.' : 'Atualizado em outro aparelho.', 'success', 2200);
      }
    } catch (e) {
      console.warn('[SM_LIVE] falha ao aplicar atualização; recarregue a página:', e);
    }
  }

  function onPullDone(ev) {
    var d = (ev && ev.detail) || {};
    var changed = d.changed || [], deleted = d.deleted || [], revoked = d.revoked || [];
    if (!changed.length && !deleted.length && !revoked.length) return;          // nada mudou de verdade: não mexe em nada

    // Mantém o banco em memória fresco, para que um salvamento antigo não apague o que acabou de chegar.
    loadStoriesStorage();

    var key = typeof currentStoryKey !== 'undefined' ? currentStoryKey : null;

    if (key && revoked.indexOf(key) !== -1) {                // a dona removeu o seu acesso
      pending = null;
      var ks = Object.keys(storiesDatabase);
      try { showToast('Seu acesso a esta história foi removido pela dona. Uma cópia ficou no histórico de versões.', 'warn', 7000); } catch (_) {}
      if (ks.length) switchStory(ks[0]);
      return;
    }
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
    onDelta: onDelta,
    isBusy: isBusy,
    _state: function () { return { pending: pending }; }
  };
})();
