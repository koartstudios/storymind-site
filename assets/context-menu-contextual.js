/* StoryMind — Fase 4: itens contextuais por tipo de nó
 *
 * Carregado DEPOIS de context-menu.js:
 *   <script src="assets/context-menu.js"></script>
 *   <script src="assets/context-menu-contextual.js"></script>
 *
 * Usa a API pública window.SM_CTX.extend('node', fn) para adicionar,
 * sem tocar no menu original, ações que só fazem sentido para o tipo do nó:
 *
 *  🎬 Cena        → Diagnóstico de virada de valor
 *  🧙 Personagem  → Teia de Relações · Árvore de Habilidades · Grafo de Menções
 *  📅 Timeline    → Abrir Linha do Tempo
 *  🎭 Tema        → Ver cenas que dramatizam o valor central
 *  📍 Cenário     → Ver cenas que acontecem aqui
 *  🧪 Variante    → Promover a canônica · Tornar canônico
 *  💬 Diálogo     → Ir para falante · Ir para alvo
 *
 * Nada disso substitui o menu: um HEAD "Contexto · X" + SEP cercam o bloco,
 * que é inserido antes de "Mover para aba".
 */
(function () {
  'use strict';
  if (!window.SM_CTX || typeof window.SM_CTX.extend !== 'function') {
    console.warn('[CM-Fase4] SM_CTX.extend não disponível — extensão ignorada.');
    return;
  }

  /* ---------- acesso ao app (mesmo padrão do context-menu.js) ---------- */
  function $fn(name) { return typeof window[name] === 'function' ? window[name] : null; }
  function call(name) {
    var f = $fn(name);
    if (!f) return undefined;
    return f.apply(null, Array.prototype.slice.call(arguments, 1));
  }
  function getN(id) { return call('getNode', id); }
  function mapData() { return typeof mindMapData !== 'undefined' ? mindMapData : null; }
  function selSet() { return typeof selectedNodeIds !== 'undefined' ? selectedNodeIds : null; }
  function nodeTypes() { return typeof NODE_TYPES !== 'undefined' ? NODE_TYPES : null; }
  function allNodes() { var d = mapData(); return d && Array.isArray(d.nodes) ? d.nodes : []; }
  function toast(msg, type, ms) { call('showToast', msg, type || 'info', ms || 2400); }
  function norm(s) {
    return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function typeLabel(type) {
    var t = nodeTypes();
    return (t && t[type] && t[type].label) || type;
  }

  /* ---------- construtores compatíveis com o renderItems do menu ---------- */
  function ITEM(icon, label, action, opts) {
    return Object.assign({ t: 'item', icon: icon, label: label, action: action }, opts || {});
  }
  function SEP() { return { t: 'sep' }; }
  function HEAD(label) { return { t: 'head', label: label }; }

  /* ============================================================
   *  AÇÕES POR TIPO
   *  (mantidas pequenas, cada uma retorna zero ou mais ITEMs)
   * ============================================================ */

  // 🎬 CENA — diagnóstico de virada de valor
  //  (o "Abrir rascunho" já está no menu base, não duplico)
  function sceneItems(node) {
    var out = [];
    var diag = call('getSceneDiagnostic', node);
    if (diag) {
      var warn = diag.level === 'warn';
      out.push(ITEM(
        warn ? 'fa-triangle-exclamation' : 'fa-circle-check',
        warn ? 'Ver problema da cena' : 'Cena vira o valor',
        function () {
          toast(diag.title + ': ' + diag.message, warn ? 'warn' : 'success', 6000);
        },
        { danger: warn }   // o menu já colore itens danger em rosa
      ));
      return out;
    }
    // Sem start/end mas com valor declarado → dica curta
    var td = node.typeData || {};
    if (td.valueAtStake) {
      out.push(ITEM('fa-circle-info', 'Diagnóstico: faltam cargas', function () {
        toast('Preencha Carga Inicial e Final do valor para o diagnóstico automático.', 'info', 4500);
      }));
    }
    return out;
  }

  // 🧙 PERSONAGEM — três atalhos para as visões que já existem
  function characterItems(node) {
    return [
      ITEM('fa-diagram-project', 'Abrir na Teia de Relações', function () {
        call('openRelationWeb');
      }),
      ITEM('fa-sitemap', 'Árvore de Habilidades', function () {
        // openSkillTree já aceita o ID do personagem como foco inicial
        call('openSkillTree', node.id);
      }),
      ITEM('fa-users-viewfinder', 'Ver no Grafo de Menções', function () {
        call('openMentionsGraph');
      })
    ];
  }

  // 📅 TIMELINE — abre o painel já com o ano no rótulo
  function timelineItems(node) {
    var year = node.typeData && node.typeData.year;
    var label = year ? 'Abrir Linha do Tempo (Ano ' + year + ')' : 'Abrir Linha do Tempo';
    return [ITEM('fa-timeline', label, function () {
      call('openTimeline');
    })];
  }

  // 🎭 TEMA — busca cenas com o mesmo valor em jogo
  function themeItems(node) {
    var core = ((node.typeData && node.typeData.coreValue) || '').trim();
    if (!core) return [];
    return [ITEM('fa-book-open', 'Ver cenas que dramatizam "' + core + '"', function () {
      var needle = norm(core);
      var scenes = allNodes().filter(function (n) {
        return n.type === 'scene' && norm(n.typeData && n.typeData.valueAtStake).indexOf(needle) >= 0;
      });
      if (!scenes.length) {
        toast('Nenhuma cena tem "' + core + '" como valor em jogo.', 'warn', 4200);
        return;
      }
      var s = selSet();
      if (s) { s.clear(); scenes.forEach(function (x) { s.add(x.id); }); }
      if (scenes.length === 1) call('openInspectorFor', scenes[0].id);
      else call('openMultiInspector');
      call('renderApp');
      toast(scenes.length + ' cena(s) dramatizam "' + core + '".', 'success', 2600);
    })];
  }

  // 📍 CENÁRIO — busca cenas cujo campo "location" bate com o título
  function locationItems(node) {
    return [ITEM('fa-clapperboard', 'Ver cenas que acontecem aqui', function () {
      var needle = norm(node.title);
      var scenes = allNodes().filter(function (n) {
        return n.type === 'scene' && norm(n.typeData && n.typeData.location) === needle;
      });
      if (!scenes.length) {
        toast('Nenhuma cena acontece em "' + node.title + '".', 'warn', 4200);
        return;
      }
      var s = selSet();
      if (s) { s.clear(); scenes.forEach(function (x) { s.add(x.id); }); }
      if (scenes.length === 1) call('openInspectorFor', scenes[0].id);
      else call('openMultiInspector');
      call('renderApp');
      toast(scenes.length + ' cena(s) acontecem em "' + node.title + '".', 'success', 2600);
    })];
  }

  // 🧪 VARIANTE — promover / tornar canônico
  //  As funções originais leem #edit-node-id do inspector.
  //  Em vez de abrir o inspector (o que piscaria a UI), escrevemos
  //  o id direto no input — ambas as ações terminam abrindo o inspector
  //  por conta própria quando faz sentido.
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

  // 💬 DIÁLOGO — ir para falante / alvo (se existirem como personagens)
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
    if (spk) {
      out.push(ITEM('fa-comment', 'Ir para falante: ' + spk.title, function () {
        call('jumpToNodeFromBible', spk.id);
      }));
    }
    var tgt = findChar(td.target);
    if (tgt) {
      out.push(ITEM('fa-ear-listen', 'Ir para alvo: ' + tgt.title, function () {
        call('jumpToNodeFromBible', tgt.id);
      }));
    }
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
   *  HOOK — insere o bloco "Contexto · X" antes de "Mover para aba"
   * ============================================================ */
  window.SM_CTX.extend('node', function (items, ctx) {
    if (!ctx || ctx.kind !== 'node') return items;

    // Multi-seleção heterogênea: não faz sentido (cada nó tem seu tipo).
    var sel = selSet();
    if (sel && sel.size > 1) return items;

    var node = getN(ctx.id);
    if (!node) return items;

    var ctxItems = buildContextual(node);
    if (!ctxItems.length) return items;

    // Localiza o "Mover para aba…" — ponto de inserção estável.
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

  console.log('[CM-Fase4] Extensão contextual carregada.');
})();
