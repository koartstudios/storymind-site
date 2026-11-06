/* StoryMind — Fase 4: itens contextuais por tipo de nó
 *
 * Carregado DEPOIS de context-menu.js:
 *   <script src="assets/context-menu.js"></script>
 *   <script src="assets/context-menu-contextual.js"></script>
 *
 * Debug: no console, execute `window.SM_CTX_DEBUG = true` para ver
 * o tipo real do nó no console toda vez que o menu abrir.
 */
(function () {
  'use strict';
  if (!window.SM_CTX || typeof window.SM_CTX.extend !== 'function') {
    console.warn('[CM-Fase4] SM_CTX.extend não disponível — extensão ignorada.');
    return;
  }

  /* ---------- acesso ao app ---------- */
  function call(name) {
    var f = typeof window[name] === 'function' ? window[name] : null;
    if (!f) return undefined;
    return f.apply(null, Array.prototype.slice.call(arguments, 1));
  }
  function getN(id) { return call('getNode', id); }
  function allNodes() {
    var d = typeof mindMapData !== 'undefined' ? mindMapData : null;
    return d && Array.isArray(d.nodes) ? d.nodes : [];
  }
  function selSet() {
    return typeof selectedNodeIds !== 'undefined' ? selectedNodeIds : null;
  }
  function norm(s) {
    return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function toast(m, t, ms) { call('showToast', m, t || 'info', ms || 2400); }

  function ITEM(icon, label, action, opts) {
    return Object.assign({ t: 'item', icon: icon, label: label, action: action }, opts || {});
  }
  function SEP() { return { t: 'sep' }; }
  function HEAD(label) { return { t: 'head', label: label }; }

  function typeLabel(type) {
    var t = typeof NODE_TYPES !== 'undefined' ? NODE_TYPES : null;
    return (t && t[type] && t[type].label) || type;
  }

  /* ============================================================
   *  AÇÕES POR TIPO
   * ============================================================ */

  // 🎬 CENA — item garantido + diagnóstico
  function sceneItems(node) {
    var out = [];

    // ⚠️ REDUNDÂNCIA PROPOSITAL: mesmo que o menu base perca esse item
    // por qualquer motivo, aqui garantimos que ele aparece.
    out.push(ITEM('fa-feather-pointed', 'Abrir modo escrita', function () {
      call('openSceneWritingMode', node.id);
    }));

    var diag = call('getSceneDiagnostic', node);
    if (diag) {
      var warn = diag.level === 'warn';
      out.push(ITEM(
        warn ? 'fa-triangle-exclamation' : 'fa-circle-check',
        warn ? 'Ver problema da cena' : 'Cena vira o valor',
        function () { toast(diag.title + ': ' + diag.message, warn ? 'warn' : 'success', 6000); },
        { danger: warn }
      ));
      return out;
    }
    var td = node.typeData || {};
    if (td.valueAtStake) {
      out.push(ITEM('fa-circle-info', 'Diagnóstico: faltam cargas', function () {
        toast('Preencha Carga Inicial e Final do valor para o diagnóstico automático.', 'info', 4500);
      }));
    }
    return out;
  }

  // 🧙 PERSONAGEM
  function characterItems(node) {
    return [
      ITEM('fa-diagram-project', 'Abrir na Teia de Relações', function () { call('openRelationWeb'); }),
      ITEM('fa-sitemap', 'Árvore de Habilidades', function () { call('openSkillTree', node.id); }),
      ITEM('fa-users-viewfinder', 'Ver no Grafo de Menções', function () { call('openMentionsGraph'); })
    ];
  }

  // 📅 TIMELINE
  function timelineItems(node) {
    var year = node.typeData && node.typeData.year;
    return [ITEM('fa-timeline',
      year ? 'Abrir Linha do Tempo (Ano ' + year + ')' : 'Abrir Linha do Tempo',
      function () { call('openTimeline'); }
    )];
  }

  // 🎭 TEMA
  function themeItems(node) {
    var core = ((node.typeData && node.typeData.coreValue) || '').trim();
    if (!core) return [];
    return [ITEM('fa-book-open', 'Ver cenas que dramatizam "' + core + '"', function () {
      var needle = norm(core);
      var scenes = allNodes().filter(function (n) {
        return n.type === 'scene' && norm(n.typeData && n.typeData.valueAtStake).indexOf(needle) >= 0;
      });
      if (!scenes.length) { toast('Nenhuma cena tem "' + core + '" como valor em jogo.', 'warn', 4200); return; }
      var s = selSet(); if (s) { s.clear(); scenes.forEach(function (x) { s.add(x.id); }); }
      if (scenes.length === 1) call('openInspectorFor', scenes[0].id);
      else call('openMultiInspector');
      call('renderApp');
      toast(scenes.length + ' cena(s) dramatizam "' + core + '".', 'success', 2600);
    })];
  }

  // 📍 CENÁRIO
  function locationItems(node) {
    return [ITEM('fa-clapperboard', 'Ver cenas que acontecem aqui', function () {
      var needle = norm(node.title);
      var scenes = allNodes().filter(function (n) {
        return n.type === 'scene' && norm(n.typeData && n.typeData.location) === needle;
      });
      if (!scenes.length) { toast('Nenhuma cena acontece em "' + node.title + '".', 'warn', 4200); return; }
      var s = selSet(); if (s) { s.clear(); scenes.forEach(function (x) { s.add(x.id); }); }
      if (scenes.length === 1) call('openInspectorFor', scenes[0].id);
      else call('openMultiInspector');
      call('renderApp');
      toast(scenes.length + ' cena(s) acontecem em "' + node.title + '".', 'success', 2600);
    })];
  }

  // 🧪 VARIANTE
  function variantItems(node) {
    if (!node.isVariant) return [];
    function setInspectorId(id) {
      var inp = document.getElementById('edit-node-id');
      if (inp) inp.value = id;
    }
    return [
      ITEM('fa-circle-check', 'Promover a canônica', function () {
        setInspectorId(node.id);
        call('promoteCurrentVariant');
      }),
      ITEM('fa-rotate-left', 'Tornar canônico (sem substituir)', function () {
        setInspectorId(node.id);
        call('removeVariantFlag');
      })
    ];
  }

  // 💬 DIÁLOGO
  function dialogueItems(node) {
    var td = node.typeData || {};
    var all = allNodes();
    function findChar(name) {
      if (!name) return null;
      var needle = norm(name);
      return all.find(function (n) {
        return n.type === 'character' &&
          (norm(n.title) === needle || norm(n.typeData && n.typeData.fullName) === needle);
      }) || null;
    }
    var out = [];
    var spk = findChar(td.speaker);
    if (spk) out.push(ITEM('fa-comment', 'Ir para falante: ' + spk.title, function () { call('jumpToNodeFromBible', spk.id); }));
    var tgt = findChar(td.target);
    if (tgt) out.push(ITEM('fa-ear-listen', 'Ir para alvo: ' + tgt.title, function () { call('jumpToNodeFromBible', tgt.id); }));
    return out;
  }

  function buildContextual(node) {
    if (!node || !node.type) return [];
    var out = [];
    switch (node.type) {
      case 'scene':     out = out.concat(sceneItems(node));     break;
      case 'character': out = out.concat(characterItems(node)); break;
      case 'timeline':  out = out.concat(timelineItems(node));  break;
      case 'theme':     out = out.concat(themeItems(node));     break;
      case 'location':  out = out.concat(locationItems(node));  break;
      case 'dialogue':  out = out.concat(dialogueItems(node));  break;
    }
    if (node.isVariant) out = out.concat(variantItems(node));
    return out;
  }

  /* ============================================================
   *  HOOK
   * ============================================================ */
  window.SM_CTX.extend('node', function (items, ctx) {
    if (!ctx || ctx.kind !== 'node') return items;

    var sel = selSet();
    var isMulti = !!(sel && sel.size > 1);

    // ⚠️ MULTI-SELEÇÃO: garante "Abrir modo escrita" se TODOS forem cenas
    if (isMulti) {
      var selectedNodes = [];
      if (sel) sel.forEach(function (id) { var n = getN(id); if (n) selectedNodes.push(n); });
      var allScenes = selectedNodes.length > 0 && selectedNodes.every(function (n) { return n.type === 'scene'; });

      if (window.SM_CTX_DEBUG) {
        console.log('[CM-Fase4] multi =', true, '| total =', selectedNodes.length,
                    '| só cenas =', allScenes);
      }

      if (allScenes) {
        // Adiciona um bloco enxuto para lote de cenas
        var block = [
          HEAD('Contexto · ' + selectedNodes.length + ' cenas'),
          ITEM('fa-feather-pointed', 'Abrir modo escrita (primeira cena)', function () {
            call('openSceneWritingMode', selectedNodes[0].id);
          })
        ];
        return items.concat([SEP()]).concat(block);
      }
      return items;   // multi heterogêneo: nada a adicionar
    }

    // SINGLE: caminho original
    var node = getN(ctx.id);
    if (!node) return items;

    if (window.SM_CTX_DEBUG) {
      console.log('[CM-Fase4] single | node.id =', node.id, '| node.type =', node.type,
                  '| contextualItems =', buildContextual(node).length);
    }

    var ctxItems = buildContextual(node);
    if (!ctxItems.length) return items;

    // Localiza "Mover para aba" para inserir antes
    var insertAt = -1;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it && it.t === 'sub' && it.icon === 'fa-folder-tree') { insertAt = i; break; }
    }

    var block = [HEAD('Contexto · ' + typeLabel(node.type))]
      .concat(ctxItems)
      .concat([SEP()]);

    if (insertAt >= 0) {
      return items.slice(0, insertAt).concat(block).concat(items.slice(insertAt));
    }
    return items.concat(block);
  });

  console.log('[CM-Fase4] Extensão contextual carregada. Debug: window.SM_CTX_DEBUG = true');
})();
