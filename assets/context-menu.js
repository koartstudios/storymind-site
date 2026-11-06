/* StoryMind — menu de contexto (botão direito no computador, toque longo no celular)
 *
 * Carregado no fim do app.html:  <script src="assets/context-menu.js"></script>
 *
 * Princípios:
 *  - Um único elemento de menu, reutilizado. Um único ouvinte no documento (não há ouvinte por cartão,
 *    então nada se perde quando o mapa é redesenhado).
 *  - Abrir o menu NÃO chama renderApp(): a seleção é pintada só nos cartões afetados.
 *  - Todas as ações reaproveitam as funções que o app já tem (undo, salvar e sincronizar continuam iguais).
 */
(function () {
  'use strict';
  if (window.SM_CTX) return;

  var LONG_PRESS_MS = 520;   // tempo do toque longo
  var MOVE_TOL = 10;         // px de movimento que cancelam o toque longo
  var GUARD_MS = 380;        // ignora toques logo após abrir (evita clique "fantasma")
  var EDGE = 8;              // margem até a borda da tela
  var MAX_C = 19700;         // limite do canvas (igual ao app)

  /* ------------------------------------------------------------------ acesso ao app */
  function $(id) { return document.getElementById(id); }
  function fn(name) { return typeof window[name] === 'function' ? window[name] : null; }
  function call(name) { var f = fn(name); return f ? f.apply(null, Array.prototype.slice.call(arguments, 1)) : undefined; }
  function selSet() { return typeof selectedNodeIds !== 'undefined' ? selectedNodeIds : new Set(); }
  function mapData() { return typeof mindMapData !== 'undefined' ? mindMapData : null; }
  function getN(id) { return call('getNode', id); }
  function toast(msg, type, ms) { call('showToast', msg, type || 'info', ms || 2200); }
  function nodeW() { return typeof NODE_W !== 'undefined' ? NODE_W : 260; }
  function clamp(v) { return Math.max(0, Math.min(MAX_C, v)); }
  function isDark() { var c = $('canvas-container'); return !!(c && c.classList.contains('theme-dark')); }
  function hasChildren(id) { var d = mapData(); return !!d && d.nodes.some(function (n) { return n.parentId === id; }); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ------------------------------------------------------------------ seleção "leve" (sem renderApp) */
  function borderColors(el, node, on) {
    if (on) { el.style.borderTopColor = el.style.borderRightColor = el.style.borderBottomColor = el.style.borderLeftColor = ''; return; }
    var nc = (typeof NODE_COLORS !== 'undefined' && NODE_COLORS[node.color]) || (typeof NODE_COLORS !== 'undefined' ? NODE_COLORS.white : { border: '#e2e8f0' });
    var td = node.type && typeof NODE_TYPES !== 'undefined' ? NODE_TYPES[node.type] : null;
    if (el.classList.contains('is-variant')) {
      el.style.borderTopColor = el.style.borderRightColor = el.style.borderBottomColor = el.style.borderLeftColor = '#a855f7';
    } else {
      el.style.borderTopColor = el.style.borderRightColor = el.style.borderBottomColor = nc.border;
      el.style.borderLeftColor = td ? td.color : nc.border;
    }
  }
  function paint(id, on) {
    var el = (typeof domCache !== 'undefined' && domCache.get) ? domCache.get(id) : document.querySelector('[data-node-id="' + id + '"]');
    var n = getN(id);
    if (!el || !n) return;
    ['ring-4', 'ring-indigo-400', 'is-selected', 'shadow-xl'].forEach(function (c) { el.classList.toggle(c, on); });
    borderColors(el, n, on);
  }
  function fastSelect(ids) {
    var s = selSet(), prev = Array.from(s);
    s.clear(); ids.forEach(function (id) { s.add(id); });
    prev.forEach(function (id) { if (ids.indexOf(id) < 0) paint(id, false); });
    ids.forEach(function (id) { paint(id, true); });
    call('updateAlignToolbar');
  }

  /* ------------------------------------------------------------------ construtores de itens */
  var SEP = { t: 'sep' };
  function HEAD(label) { return { t: 'head', label: label }; }
  function ITEM(icon, label, action, o) { return Object.assign({ t: 'item', icon: icon, label: label, action: action }, o || {}); }
  function SUB(icon, label, items, o) { return Object.assign({ t: 'sub', icon: icon, label: label, items: items }, o || {}); }

  function keepInspectorClosed(f) {      // applyMulti* abrem o painel lateral; aqui ele deve continuar fechado
    var sb = $('inspector-sidebar');
    var was = !!sb && !sb.classList.contains('translate-x-full');
    f();
    if (!was) call('closeInspector');
  }

  var COLOR_NAMES = { purple: 'Roxo', orange: 'Âmbar', blue: 'Azul', emerald: 'Verde', rose: 'Rosa', white: 'Branco' };

  function colorRow(current) {
    if (typeof NODE_COLORS === 'undefined') return [];
    return [{ t: 'sw', list: Object.keys(NODE_COLORS).map(function (k) {
      return { label: COLOR_NAMES[k] || k, bg: NODE_COLORS[k].bg, border: NODE_COLORS[k].border, on: k === current,
               action: function () { call('applyMultiColor', k); } };
    }) }];
  }
  function typeItems(current) {
    if (typeof NODE_TYPES === 'undefined') return [];
    var out = Object.keys(NODE_TYPES).map(function (k) {
      var t = NODE_TYPES[k];
      return ITEM(t.icon, t.label, function () { keepInspectorClosed(function () { call('applyMultiType', k); }); }, { on: k === current });
    });
    out.push(SEP, ITEM('fa-ban', 'Sem tipo', function () { keepInspectorClosed(function () { call('applyMultiType', '__clear'); }); }, { on: !current }));
    return out;
  }
  function tensionRow(current) {
    var list = [];
    for (var v = 0; v <= 10; v++) (function (val) {
      list.push({ label: String(val), on: current === val, action: function () { keepInspectorClosed(function () { call('applyMultiTension', val); }); } });
    })(v);
    return [HEAD('Nível de tensão (0 a 10)'), { t: 'chips', list: list }];
  }
  function beatItems(current) {
    var fw = call('getCurrentFramework'); if (!fw || !fw.beats) return null;
    var out = fw.beats.map(function (b) {
      return ITEM(b.icon, b.name, function () { keepInspectorClosed(function () { call('applyMultiBeat', b.id); }); }, { on: b.id === current });
    });
    out.push(SEP, ITEM('fa-ban', 'Nenhum beat', function () { keepInspectorClosed(function () { call('applyMultiBeat', null); }); }, { on: !current }));
    return out;
  }
  function sheetTargets() {
    var cs = typeof currentStory !== 'undefined' ? currentStory : null, d = mapData();
    var out = [];
    if (cs && d) cs.sheets.forEach(function (sh) {
      if (sh.id !== d.id) out.push(ITEM('fa-file-lines', sh.name || 'Aba', function () { call('moveSelectedNodesToSheet', sh.id); }));
    });
    if (out.length) out.push(SEP);
    out.push(ITEM('fa-plus', 'Nova aba…', function () { call('moveSelectedNodesToNewSheet'); }));
    return out;
  }

  /* ------------------------------------------------------------------ ações próprias (reproduzem as do app) */
  function duplicateSelection() {
    var s = selSet(); if (!s.size) return;
    call('pushHistory');
    var newIds = call('duplicateSelectedNodesInPlace') || [];
    newIds.forEach(function (id) { var n = getN(id); if (n) { n.x = clamp(n.x + 40); n.y = clamp(n.y + 40); } });   // deslocado, para não ficar escondido atrás do original
    s.clear(); newIds.forEach(function (id) { s.add(id); });
    call('invalidateStructure'); call('saveStoriesStorage'); call('renderApp');
  }
  function copySelection() {
    var n = selSet().size; call('copySelectedNodes');
    toast(plural(n, 'nó copiado.', 'nós copiados.'), 'success', 1400);
  }
  function addSibling(id) {
    var nid = call('createSibling', id);
    if (nid) { var s = selSet(); s.clear(); s.add(nid); call('commit'); call('startInlineEdit', nid, 'title'); }
  }
  function newNodeAt(cx, cy) {
    var d = mapData(); if (!d) return;
    if (d.beatSheetMode || d.beatSortMode || d.timelineMode) { call('addNewNode'); return; }   // nesses modos o app posiciona sozinho
    var id = call('generateNodeId');
    var pos = call('findFreePosition', clamp(cx - nodeW() / 2), clamp(cy - 40)) || { x: cx, y: cy };
    d.nodes.push({ id: id, title: 'Novo nó de enredo', content: 'Escreva os detalhes...', parentId: null, x: pos.x, y: pos.y, color: 'white', icons: [], collapsed: false, tension: 0, beatId: null, type: null, pov: '', typeData: {}, isVariant: false, variantOf: null, variantLabel: '' });
    call('rebuildNodeIndex');
    var s = selSet(); s.clear(); s.add(id);
    call('commit'); call('startInlineEdit', id, 'title');
  }
  function pasteAt(cx, cy) {
    var cb = typeof nodeClipboard !== 'undefined' ? nodeClipboard : null, d = mapData();
    if (!cb || !cb.nodes || !cb.nodes.length || !d) return;
    call('pushHistory');
    var idMap = {}; cb.nodes.forEach(function (n) { idMap[n.id] = call('generateNodeId'); });
    var minX = Infinity, minY = Infinity; cb.nodes.forEach(function (n) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); });
    var dx = cx - minX, dy = cy - minY;                       // canto superior esquerdo do grupo no ponto do clique
    var newNodes = cb.nodes.map(function (n) {
      var c = call('deepClone', n);
      c.id = idMap[n.id]; c.parentId = (n.parentId && idMap[n.parentId]) ? idMap[n.parentId] : null;
      c.x = clamp(n.x + dx); c.y = clamp(n.y + dy); c.icons = (n.icons || []).slice(); c.collapsed = false;
      return c;
    });
    var newRels = (cb.relationships || []).map(function (r) {
      return Object.assign({}, r, { id: 'rel-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), from: idMap[r.from], to: idMap[r.to], c1x: null, c1y: null, c2x: null, c2y: null });
    });
    d.nodes.push.apply(d.nodes, newNodes);
    d.relationships = (d.relationships || []).concat(newRels);
    call('rebuildNodeIndex');
    var s = selSet(); s.clear(); newNodes.forEach(function (n) { s.add(n.id); });
    if (d.beatSortMode) { d.beatSortLastArrangement = null; call('applyBeatSortLayout'); }
    var ids = new Set(newNodes.map(function (n) { return n.id; }));
    requestAnimationFrame(function () { var f = fn('resolveOverlapsForDragged'); if (f && f(ids)) call('renderApp'); });
    call('saveStoriesStorage'); call('renderApp');
    toast(plural(newNodes.length, 'nó colado.', 'nós colados.'), 'success', 1800);
  }
  function copyWikiLink(n) {
    var text = '[[' + (n.title || '') + ']]';
    var done = function () { toast('Link ' + text + ' copiado.', 'success', 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove();
  }
  function undoState() { var h = typeof history !== 'undefined' && history && Array.isArray(history.stack) ? history : null; return h ? { undo: h.index > 0, redo: h.index < h.stack.length - 1 } : { undo: true, redo: true }; }

  /* ------------------------------------------------------------------ menus por contexto */
  function nodeMenu(id) {
    var n = getN(id); if (!n) return [];
    var s = selSet(), multi = s.size > 1 && s.has(id), count = s.size;
    var items = [];
    var canPaste = typeof nodeClipboard !== 'undefined' && nodeClipboard && nodeClipboard.nodes && nodeClipboard.nodes.length;

    if (multi) {
      items.push(HEAD(count + ' cartões selecionados'));
      items.push(SUB('fa-align-left', 'Alinhar', [
        ITEM('fa-align-left', 'À esquerda', function () { call('alignSelectedNodes', 'left'); }),
        ITEM('fa-align-center', 'Centralizar na horizontal', function () { call('alignSelectedNodes', 'center-h'); }),
        ITEM('fa-align-right', 'À direita', function () { call('alignSelectedNodes', 'right'); }),
        SEP,
        ITEM('fa-arrow-up', 'Ao topo', function () { call('alignSelectedNodes', 'top'); }),
        ITEM('fa-grip-lines', 'Centralizar na vertical', function () { call('alignSelectedNodes', 'center-v'); }),
        ITEM('fa-arrow-down', 'Na base', function () { call('alignSelectedNodes', 'bottom'); })
      ]));
      items.push(SUB('fa-arrows-left-right', 'Distribuir', [
        ITEM('fa-arrows-left-right', 'Espaço igual na horizontal', function () { call('alignSelectedNodes', 'distribute-h'); }, { disabled: count < 3 }),
        ITEM('fa-arrows-up-down', 'Espaço igual na vertical', function () { call('alignSelectedNodes', 'distribute-v'); }, { disabled: count < 3 })
      ]));
      items.push(SEP);
    } else {
      items.push(ITEM('fa-pen', 'Editar título', function () { call('startInlineEdit', id, 'title'); }, { hint: 'F2' }));
      items.push(ITEM('fa-sliders', 'Abrir detalhes', function () { call('openInspectorFor', id); }));
      if (n.type === 'scene') items.push(ITEM('fa-feather-pointed', 'Abrir rascunho da cena', function () { call('openSceneWritingMode', id); }));
      items.push(SEP);
      items.push(ITEM('fa-diagram-successor', 'Adicionar filho', function () { call('addChildToNode', id); }, { hint: 'Tab' }));
      items.push(ITEM('fa-share-nodes', 'Adicionar irmão', function () { addSibling(id); }, { hint: 'Enter' }));
      items.push(SEP);
    }

    items.push(ITEM('fa-clone', multi ? 'Duplicar seleção' : 'Duplicar', duplicateSelection, { hint: 'Ctrl+D' }));
    items.push(ITEM('fa-copy', multi ? 'Copiar seleção' : 'Copiar', copySelection, { hint: 'Ctrl+C' }));
    items.push(ITEM('fa-scissors', multi ? 'Recortar seleção' : 'Recortar', function () { call('cutSelectedNodes'); }, { hint: 'Ctrl+X' }));
    if (!multi) items.push(ITEM('fa-paste', 'Colar como filho', function () { call('pasteClipboard'); }, { hint: 'Ctrl+V', disabled: !canPaste }));
    items.push(ITEM('fa-trash', multi ? 'Excluir seleção' : 'Excluir', function () { call('deleteSelectedNodes'); }, { hint: 'Del', danger: true }));
    items.push(SEP);

    items.push(SUB('fa-palette', 'Cor', colorRow(multi ? null : n.color)));
    items.push(SUB('fa-shapes', 'Tipo', typeItems(multi ? null : n.type)));
    items.push(SUB('fa-bolt', 'Tensão', tensionRow(multi ? null : n.tension)));
    var beats = beatItems(multi ? null : n.beatId);
    if (beats) items.push(SUB('fa-flag', 'Beat da estrutura', beats));
    items.push(SEP);

    if (!multi) {
      if (hasChildren(id)) items.push(ITEM(n.collapsed ? 'fa-expand' : 'fa-compress', n.collapsed ? 'Expandir ramo' : 'Recolher ramo', function () { call('toggleCollapse', id); }));
      items.push(ITEM('fa-sitemap', 'Selecionar ramo inteiro', function () { call('selectDescendants'); }));
      var inFocus = typeof focusModeNodeId !== 'undefined' && focusModeNodeId;
      items.push(ITEM('fa-bullseye', inFocus ? 'Sair do modo foco' : 'Modo foco neste nó', function () { call('toggleFocusMode'); }));
      items.push(ITEM('fa-crosshairs', 'Centralizar na tela', function () { call('focusNodeInView', n); }));
      items.push(SEP);
    } else {
      items.push(ITEM('fa-sitemap', 'Incluir descendentes na seleção', function () { call('selectDescendants'); }));
    }

    items.push(SUB('fa-folder-tree', 'Mover para aba', sheetTargets()));
    if (!multi) {
      items.push(ITEM('fa-code-branch', 'Extrair ramo para nova aba', function () { var f = $('edit-node-id'); if (f) f.value = id; call('extractCurrentNodeToNewSheet'); }));
      items.push(ITEM('fa-link', 'Iniciar relação daqui', function () { call('setTool', 'relation'); call('handleRelationshipClick', id); }));
      items.push(ITEM('fa-at', 'Copiar como [[link]]', function () { copyWikiLink(n); }));
    } else {
      items.push(ITEM('fa-image', 'Exportar seleção como PNG', function () { call('exportPNG', 'selected'); }));
    }
    return items;
  }

  function bgMenu(cx, cy) {
    var d = mapData(); if (!d) return [];
    var canPaste = typeof nodeClipboard !== 'undefined' && nodeClipboard && nodeClipboard.nodes && nodeClipboard.nodes.length;
    var u = undoState(), layout = d.layout || 'tree';
    var minimap = typeof minimapVisible !== 'undefined' && minimapVisible, tension = typeof tensionStripVisible !== 'undefined' && tensionStripVisible;
    return [
      ITEM('fa-circle-plus', 'Novo nó aqui', function () { newNodeAt(cx, cy); }),
      ITEM('fa-paste', 'Colar aqui', function () { pasteAt(cx, cy); }, { hint: 'Ctrl+V', disabled: !canPaste }),
      SEP,
      ITEM('fa-object-group', 'Selecionar tudo', function () { call('selectAllNodes'); }, { hint: 'Ctrl+A' }),
      ITEM('fa-rotate-left', 'Desfazer', function () { call('undo'); }, { hint: 'Ctrl+Z', disabled: !u.undo }),
      ITEM('fa-rotate-right', 'Refazer', function () { call('redo'); }, { hint: 'Ctrl+Y', disabled: !u.redo }),
      SEP,
      SUB('fa-eye', 'Visualização', [
        ITEM('fa-expand', 'Ajustar à tela', function () { call('fitView'); }),
        ITEM('fa-magnifying-glass', 'Zoom 100%', function () { call('resetView'); }),
        SEP,
        ITEM('fa-map', 'Minimapa', function () { call('toggleMinimap'); }, { on: minimap }),
        ITEM('fa-chart-line', 'Curva de tensão', function () { call('toggleTensionStrip'); }, { on: tension }),
        ITEM('fa-list-ul', 'Estrutura (lista lateral)', function () { call('toggleOutline'); })
      ]),
      SUB('fa-wand-magic-sparkles', 'Organizar', [
        ITEM('fa-wand-magic-sparkles', 'Organizar automaticamente', function () { call('autoLayoutNodes'); }),
        SEP,
        ITEM('fa-diagram-project', 'Layout em árvore', function () { call('changeLayout', 'tree'); }, { on: layout === 'tree' }),
        ITEM('fa-sitemap', 'Layout de organograma', function () { call('changeLayout', 'org'); }, { on: layout === 'org' }),
        ITEM('fa-bullseye', 'Layout radial', function () { call('changeLayout', 'radial'); }, { on: layout === 'radial' }),
        SEP,
        ITEM('fa-compress', 'Recolher tudo', function () { call('collapseAll'); }),
        ITEM('fa-expand', 'Expandir tudo', function () { call('expandAll'); })
      ]),
      SUB('fa-file-export', 'Exportar', [
        ITEM('fa-image', 'Imagem PNG (mapa inteiro)', function () { call('exportPNG', 'all'); }),
        ITEM('fa-bezier-curve', 'Imagem SVG', function () { call('exportSVG'); }),
        ITEM('fa-file-lines', 'Texto Markdown', function () { call('exportMarkdown'); }),
        ITEM('fa-database', 'Backup (JSON)', function () { call('exportDataWithDialog'); })
      ]),
      SEP,
      ITEM('fa-book-open', 'Bíblia da história', function () { call('openStoryBible'); }, { hint: 'Ctrl+B' })
    ];
  }

  function relMenu(relId) {
    var d = mapData(); if (!d) return [];
    var rel = (d.relationships || []).find(function (r) { return r.id === relId; }); if (!rel) return [];
    var colors = typeof RELATIONSHIP_COLORS !== 'undefined' ? RELATIONSHIP_COLORS : {};
    var commit = function (mutate) { call('pushHistory'); mutate(); call('saveStoriesStorage'); call('renderApp'); };
    return [
      ITEM('fa-pen', 'Editar rótulo e detalhes', function () { call('openRelationshipEditor', rel); call('renderApp'); }),
      { t: 'sw', list: Object.keys(colors).map(function (k) { return { label: k, bg: colors[k], border: colors[k], on: rel.color === k, action: function () { commit(function () { rel.color = k; }); } }; }) },
      SEP,
      ITEM('fa-arrows-left-right', 'Inverter direção', function () { commit(function () { var f = rel.from; rel.from = rel.to; rel.to = f; rel.c1x = rel.c1y = rel.c2x = rel.c2y = null; }); }),
      ITEM('fa-bezier-curve', 'Resetar curva', function () { commit(function () { rel.c1x = rel.c1y = rel.c2x = rel.c2y = null; }); }),
      SEP,
      ITEM('fa-trash', 'Excluir relação', function () { if (typeof selectedRelationshipId !== 'undefined') selectedRelationshipId = rel.id; call('deleteSelectedRelationship'); }, { danger: true })
    ];
  }

  /* ------------------------------------------------------------------ interface do menu */
  var S = { open: false, sheet: false, root: null, panel: null, back: null, fly: null, flyRow: null, stack: [], openedAt: 0, tOpen: 0, tClose: 0, ctx: null };
  var extenders = {};

  function injectStyle() {
    if ($('sm-ctx-style')) return;
    var st = document.createElement('style'); st.id = 'sm-ctx-style';
    st.textContent = [
      '#canvas-container{-webkit-touch-callout:none}',
      '.sm-ctx-layer{position:fixed;inset:0;z-index:9000;pointer-events:none}',
      '.sm-ctx-back{position:fixed;inset:0;background:rgba(15,23,42,.45);pointer-events:auto}',
      '.sm-ctx{position:fixed;box-sizing:border-box;min-width:224px;max-width:min(330px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow-y:auto;overscroll-behavior:contain;padding:6px;border-radius:12px;pointer-events:auto;',
      'background:#fff;color:#1e293b;border:1px solid #e2e8f0;box-shadow:0 18px 40px -12px rgba(15,23,42,.35),0 2px 8px rgba(15,23,42,.08);font:500 13.5px/1.25 Inter,system-ui,-apple-system,Segoe UI,sans-serif;animation:sm-ctx-in .12s ease-out}',
      '.sm-ctx.dark{background:#1e293b;color:#e2e8f0;border-color:#334155}',
      '.sm-ctx-item{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;padding:7px 10px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;position:relative}',
      '.sm-ctx-item:hover,.sm-ctx-item:focus-visible,.sm-ctx-item.act{background:#eef2ff;outline:none}',
      '.dark .sm-ctx-item:hover,.dark .sm-ctx-item:focus-visible,.dark .sm-ctx-item.act{background:#334155}',
      '.sm-ctx-item[aria-disabled="true"]{opacity:.4;cursor:default}',
      '.sm-ctx-item[aria-disabled="true"]:hover{background:none}',
      '.sm-ctx-item.danger{color:#e11d48}',
      '.sm-ctx-ico{flex:none;width:18px;text-align:center;color:#64748b;font-size:13px}',
      '.dark .sm-ctx-ico{color:#94a3b8}.sm-ctx-item.danger .sm-ctx-ico{color:inherit}',
      '.sm-ctx-lbl{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.sm-ctx-hint{flex:none;margin-left:14px;color:#94a3b8;font-size:12px}',
      '.sm-ctx-arrow{flex:none;color:#94a3b8;font-size:11px}',
      '.sm-ctx-check{flex:none;color:#6366f1;font-size:12px}',
      '.sm-ctx-sep{height:1px;margin:6px 4px;background:#e2e8f0}.dark .sm-ctx-sep{background:#334155}',
      '.sm-ctx-head{padding:6px 10px 4px;color:#64748b;font-size:12px}',
      '.sm-ctx-row{display:flex;flex-wrap:wrap;gap:8px;padding:8px 10px}',
      '.sm-ctx-dot{width:26px;height:26px;padding:0;border-radius:50%;border:2px solid;cursor:pointer}',
      '.sm-ctx-dot.on{box-shadow:0 0 0 2px #fff,0 0 0 4px #6366f1}',
      '.sm-ctx-dot:focus-visible{outline:2px solid #6366f1;outline-offset:2px}',
      '.sm-ctx-chip{min-width:30px;height:30px;padding:0 6px;border-radius:8px;border:1px solid #cbd5e1;background:transparent;color:inherit;font:inherit;cursor:pointer}',
      '.sm-ctx-chip.on{background:#6366f1;border-color:#6366f1;color:#fff}.sm-ctx-chip:hover{border-color:#6366f1}',
      '.sm-ctx-chip:focus-visible{outline:2px solid #6366f1;outline-offset:2px}',
      '.sm-ctx.sheet{left:8px!important;right:8px!important;top:auto!important;bottom:calc(8px + env(safe-area-inset-bottom))!important;max-width:none;max-height:74vh;padding:8px;border-radius:18px;animation:sm-ctx-up .18s ease-out}',
      '.sm-ctx.sheet .sm-ctx-item{min-height:48px;padding:10px 12px;font-size:15.5px}',
      '.sm-ctx.sheet .sm-ctx-dot{width:36px;height:36px}.sm-ctx.sheet .sm-ctx-chip{min-width:40px;height:40px}',
      '.sm-ctx.sheet .sm-ctx-hint{display:none}',
      '@keyframes sm-ctx-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}',
      '@keyframes sm-ctx-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.sm-ctx{animation:none!important}}'
    ].join('');
    document.head.appendChild(st);
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(ic) {
    var s = el('span', 'sm-ctx-ico');
    if (!ic) return s;
    if (ic.indexOf('fa-') === 0) { var i = el('i', 'fa-solid ' + ic); i.setAttribute('aria-hidden', 'true'); s.appendChild(i); } else s.textContent = ic;
    return s;
  }
  function ensureRoot() {
    if (S.root) return;
    injectStyle();
    S.root = el('div', 'sm-ctx-layer'); S.root.id = 'sm-ctx-root'; S.root.hidden = true;
    document.body.appendChild(S.root);
    S.root.addEventListener('click', onMenuClick);
    S.root.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    S.root.addEventListener('mouseover', onMenuHover);
  }

  function renderItems(panel, items) {
    panel.textContent = '';
    items.forEach(function (it) {
      if (it.t === 'sep') { panel.appendChild(el('div', 'sm-ctx-sep')); return; }
      if (it.t === 'head') { panel.appendChild(el('div', 'sm-ctx-head', it.label)); return; }
      if (it.t === 'sw' || it.t === 'chips') {
        var row = el('div', 'sm-ctx-row'); row.setAttribute('role', 'group');
        it.list.forEach(function (c) {
          var b;
          if (it.t === 'sw') { b = el('button', 'sm-ctx-dot' + (c.on ? ' on' : '')); b.style.background = c.bg; b.style.borderColor = c.border; b.title = c.label; b.setAttribute('aria-label', c.label); }
          else { b = el('button', 'sm-ctx-chip' + (c.on ? ' on' : ''), c.label); }
          b.type = 'button'; b.tabIndex = -1; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', c.on ? 'true' : 'false'); b._it = c; row.appendChild(b);
        });
        panel.appendChild(row); return;
      }
      var b2 = el('button', 'sm-ctx-item' + (it.danger ? ' danger' : '') + (it.t === 'sub' ? ' sub' : ''));
      b2.type = 'button'; b2.tabIndex = -1; b2._it = it;
      b2.setAttribute('role', it.on !== undefined && it.t === 'item' ? 'menuitemcheckbox' : 'menuitem');
      if (it.on !== undefined && it.t === 'item') b2.setAttribute('aria-checked', it.on ? 'true' : 'false');
      if (it.disabled) b2.setAttribute('aria-disabled', 'true');
      if (it.t === 'sub') { b2.setAttribute('aria-haspopup', 'menu'); b2.setAttribute('aria-expanded', 'false'); }
      b2.appendChild(icon(it.icon)); b2.appendChild(el('span', 'sm-ctx-lbl', it.label));
      if (it.on && it.t === 'item') { var ck = el('i', 'fa-solid fa-check sm-ctx-check'); ck.setAttribute('aria-hidden', 'true'); b2.appendChild(ck); }
      if (it.hint) b2.appendChild(el('span', 'sm-ctx-hint', it.hint));
      if (it.t === 'sub') { var ar = el('i', 'fa-solid fa-chevron-right sm-ctx-arrow'); ar.setAttribute('aria-hidden', 'true'); b2.appendChild(ar); }
      panel.appendChild(b2);
    });
  }
  function newPanel(items, cls) {
    var p = el('div', 'sm-ctx' + (isDark() ? ' dark' : '') + (cls ? ' ' + cls : '')); p.setAttribute('role', 'menu'); p.tabIndex = -1;
    renderItems(p, items); return p;
  }
  function place(p, x, y) {
    p.style.left = '0px'; p.style.top = '0px'; p.style.visibility = 'hidden';
    var w = p.offsetWidth, h = p.offsetHeight, left = x + 2, top = y + 2;
    if (left + w > innerWidth - EDGE) left = Math.max(EDGE, x - w - 2);
    if (top + h > innerHeight - EDGE) top = Math.max(EDGE, innerHeight - h - EDGE);
    p.style.left = left + 'px'; p.style.top = top + 'px'; p.style.visibility = '';
  }

  function close() {
    clearTimeout(S.tOpen); clearTimeout(S.tClose);
    if (!S.open) return;
    S.open = false; S.stack = []; S.fly = null; S.flyRow = null; S.panel = null;
    if (S.root) { S.root.textContent = ''; S.root.hidden = true; }
  }

  function focusables(panel) { return Array.prototype.slice.call(panel.querySelectorAll('.sm-ctx-item:not([aria-disabled="true"]),.sm-ctx-dot,.sm-ctx-chip')); }
  function focusFirst(panel) { var f = focusables(panel); if (f[0]) { f[0].focus(); f[0].classList.add('act'); } }

  /* submenus: desktop = flyout ao lado; celular = troca o conteúdo da folha (com "Voltar") */
  function openSub(row, viaKeyboard) {
    var it = row._it; if (!it || it.t !== 'sub') return;
    if (S.sheet) {
      S.stack.push({ items: S.panel._items, title: null });
      var items = [ITEM('fa-chevron-left', it.label, function () { goBack(); }, { back: true }), SEP].concat(it.items);
      S.panel._items = items; renderItems(S.panel, items); S.panel.scrollTop = 0; return;
    }
    if (S.flyRow === row && S.fly) return;
    closeFly();
    var f = newPanel(it.items, 'fly'); f._items = it.items; S.root.appendChild(f); S.fly = f; S.flyRow = row; row.setAttribute('aria-expanded', 'true'); row.classList.add('act');
    var rr = row.getBoundingClientRect(), pr = S.panel.getBoundingClientRect();
    f.style.visibility = 'hidden'; f.style.left = '0px'; f.style.top = '0px';
    var w = f.offsetWidth, h = f.offsetHeight, left = pr.right - 4, top = rr.top - 6;
    if (left + w > innerWidth - EDGE) left = Math.max(EDGE, pr.left - w + 4);
    if (top + h > innerHeight - EDGE) top = Math.max(EDGE, innerHeight - h - EDGE);
    f.style.left = left + 'px'; f.style.top = top + 'px'; f.style.visibility = '';
    if (viaKeyboard) focusFirst(f);
  }
  function closeFly(refocus) {
    if (S.fly) { S.fly.remove(); S.fly = null; }
    if (S.flyRow) { S.flyRow.setAttribute('aria-expanded', 'false'); S.flyRow.classList.remove('act'); if (refocus) S.flyRow.focus(); S.flyRow = null; }
  }
  function goBack() {
    var prev = S.stack.pop(); if (!prev) return;
    S.panel._items = prev.items; renderItems(S.panel, prev.items); S.panel.scrollTop = 0;
  }

  function activate(node) {
    var it = node._it; if (!it) return;
    if (Date.now() - S.openedAt < GUARD_MS) return;                       // clique "fantasma" logo após o toque longo
    if (it.disabled) return;
    if (it.t === 'sub') { openSub(node, true); return; }
    if (it.back) { goBack(); return; }
    var action = it.action; close();
    if (!action) return;
    requestAnimationFrame(function () {                                   // deixa o menu sumir antes da ação (que pode redesenhar o mapa)
      setTimeout(function () {
        try { action(); } catch (err) { console.error('[SM_CTX]', err); toast('Não foi possível executar essa ação.', 'error'); }
      }, 0);
    });
  }
  function onMenuClick(e) {
    var n = e.target.closest('.sm-ctx-item,.sm-ctx-dot,.sm-ctx-chip');
    if (n) { e.preventDefault(); activate(n); }
  }
  function onMenuHover(e) {                                               // intenção de hover para abrir/fechar submenus (só com mouse)
    if (S.sheet) return;
    var row = e.target.closest('.sm-ctx-item'); if (!row) return;
    var inFly = !!row.closest('.sm-ctx.fly');
    clearTimeout(S.tClose);
    if (inFly) return;
    clearTimeout(S.tOpen);
    var it = row._it;
    if (it && it.t === 'sub' && !it.disabled) S.tOpen = setTimeout(function () { openSub(row, false); }, 130);
    else if (S.fly) S.tClose = setTimeout(function () { closeFly(); }, 220);
  }

  /* ------------------------------------------------------------------ abrir */
  function hitInfo(t) {
    if (!t || !t.closest || !t.closest('#canvas-container')) return null;
    if (t.closest('input,textarea,select,[contenteditable="true"],.rel-handle,#focus-pill,#beat-pill,#narrative-pill,#marquee-box')) return null;
    var card = t.closest('.node-card'); if (card && card.dataset.nodeId) return { kind: 'node', id: card.dataset.nodeId };
    var path = t.closest('.relationship-path'); if (path && path.dataset.relId) return { kind: 'rel', id: path.dataset.relId };
    return { kind: 'bg' };
  }

  function openMenu(hit, x, y, touch) {
    if (!mapData()) return;
    ensureRoot(); close();
    call('hideNodeTooltip');
    var pt = call('getCanvasPoint', { clientX: x, clientY: y }) || { canvasX: 0, canvasY: 0 };
    var items;
    if (hit.kind === 'node') {
      if (!getN(hit.id)) return;
      if (!selSet().has(hit.id)) fastSelect([hit.id]);                    // como no sistema: clicar com o direito num item não selecionado seleciona só ele
      items = nodeMenu(hit.id);
    } else if (hit.kind === 'rel') { items = relMenu(hit.id); }
    else { items = bgMenu(pt.canvasX, pt.canvasY); }
    (extenders[hit.kind] || []).forEach(function (f) { try { items = f(items, { kind: hit.kind, id: hit.id, x: pt.canvasX, y: pt.canvasY }) || items; } catch (e) { console.error('[SM_CTX]', e); } });
    if (!items.length) return;

    S.sheet = !!touch; S.openedAt = Date.now(); S.open = true; S.ctx = hit; S.stack = [];
    S.root.hidden = false; S.root.textContent = '';
    if (S.sheet) { var bk = el('div', 'sm-ctx-back'); bk.addEventListener('pointerdown', function (e) { if (Date.now() - S.openedAt > GUARD_MS) { e.preventDefault(); close(); } }); S.root.appendChild(bk); }
    var p = newPanel(items, S.sheet ? 'sheet' : ''); p._items = items; S.panel = p; S.root.appendChild(p);
    if (!S.sheet) place(p, x, y);
    p.focus({ preventScroll: true });
    if (navigator.vibrate && touch) { try { navigator.vibrate(12); } catch (e) {} }
  }

  /* ------------------------------------------------------------------ eventos */
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  var lp = null;
  function lpCancel() { if (lp) { clearTimeout(lp.timer); lp = null; } }

  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest && e.target.closest('.sm-ctx-layer')) { e.preventDefault(); return; }
    var hit = hitInfo(e.target); if (!hit) return;                         // fora do mapa (ou campo de texto): comportamento normal
    e.preventDefault(); e.stopPropagation();
    if (S.open && Date.now() - S.openedAt < 800) return;                   // toque longo: o navegador e o nosso timer podem disparar juntos
    lpCancel();
    var touch = e.pointerType ? e.pointerType !== 'mouse' : (S.sheetHint === true);
    openMenu(hit, e.clientX, e.clientY, touch);
  }, true);

  document.addEventListener('pointerdown', function (e) {
    var inMenu = e.target.closest && e.target.closest('.sm-ctx');
    if (S.open && !inMenu) {
      if (S.sheet && e.target.closest && e.target.closest('.sm-ctx-back')) return;   // o fundo escurecido tem tratamento próprio
      close();
    }
    if (inMenu) return;
    var hit = hitInfo(e.target);
    // 1) botão direito (ou Ctrl+clique no Mac): não é clique de seleção/arrasto. O app antes limpava a seleção e redesenhava tudo.
    if (e.pointerType === 'mouse' && hit && (e.button === 2 || (isMac && e.button === 0 && e.ctrlKey))) { e.stopImmediatePropagation(); return; }
    // 2) toque longo
    if (e.pointerType !== 'mouse') {
      if (e.isPrimary === false) { lpCancel(); return; }
      lpCancel();
      if (!hit) return;
      lp = { x: e.clientX, y: e.clientY, hit: hit, timer: setTimeout(function () {
        var h = lp && lp.hit, x = lp && lp.x, y = lp && lp.y; lp = null;
        if (!h) return;
        call('cancelAllInteractions');                                     // desfaz o "arrastar" que o app iniciou no toque
        S.sheetHint = true; openMenu(h, x, y, true);
      }, LONG_PRESS_MS) };
    }
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (lp && Math.abs(e.clientX - lp.x) + Math.abs(e.clientY - lp.y) > MOVE_TOL) lpCancel();
  }, true);
  ['pointerup', 'pointercancel'].forEach(function (t) { document.addEventListener(t, lpCancel, true); });

  document.addEventListener('keydown', function (e) {
    if (!S.open) return;
    var k = e.key, panel = S.fly || S.panel; if (!panel) return;
    var stop = function () { e.preventDefault(); e.stopImmediatePropagation(); };
    if (k === 'Escape') { stop(); if (S.fly) closeFly(true); else if (S.stack.length) goBack(); else close(); return; }
    if (k === 'Tab') { close(); return; }
    var list = focusables(panel), i = list.indexOf(document.activeElement);
    if (k === 'ArrowDown') { stop(); var nx = list[(i + 1 + list.length) % list.length]; if (nx) { nx.focus(); } return; }
    if (k === 'ArrowUp') { stop(); var pv = list[i <= 0 ? list.length - 1 : i - 1]; if (pv) pv.focus(); return; }
    if (k === 'Home') { stop(); if (list[0]) list[0].focus(); return; }
    if (k === 'End') { stop(); if (list.length) list[list.length - 1].focus(); return; }
    if (k === 'ArrowRight') { var cur = document.activeElement; if (cur && cur._it && cur._it.t === 'sub') { stop(); openSub(cur, true); } return; }
    if (k === 'ArrowLeft') { if (S.fly) { stop(); closeFly(true); } else if (S.stack.length) { stop(); goBack(); } return; }
    if (k === 'Enter' || k === ' ') { var c = document.activeElement; if (c && c._it) { stop(); S.openedAt = 0; activate(c); } }
  }, true);

  ['wheel', 'resize', 'blur'].forEach(function (t) { window.addEventListener(t, function (e) { if (S.open && !(e.target && e.target.closest && e.target.closest('.sm-ctx'))) close(); }, true); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) close(); });

  /* ------------------------------------------------------------------ API pública */
  window.SM_CTX = {
    isOpen: function () { return S.open; },
    close: close,
    // permite acrescentar itens: SM_CTX.extend('node'|'bg'|'rel', (items, ctx) => items)
    extend: function (kind, f) { (extenders[kind] = extenders[kind] || []).push(f); }
  };
})();
