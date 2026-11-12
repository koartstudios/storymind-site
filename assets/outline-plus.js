/* ============================================================
   STORYMIND — OUTLINE PLUS (mesclado com Write-to-Map)
   - Modo Árvore: drag & drop + edição inline (título)
   - Modo Texto: colar/escrever outline em massa → gera nós
   - Toggle no header do painel e botão "Escrever" no header principal
   - Um único arquivo. Não edita nada do app.html além de 1 <script>.
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_OUTLINE_PLUS_LOADED) return;
    window.SM_OUTLINE_PLUS_LOADED = true;

    /* ============================================================
       CONSTANTES
       ============================================================ */
    const TYPE_PREFIXES = [
        { prefix: '🎬', type: 'scene' },       { prefix: '🧙', type: 'character' },
        { prefix: '📍', type: 'location' },    { prefix: '⚡', type: 'event' },
        { prefix: '💬', type: 'dialogue' },    { prefix: '🎭', type: 'theme' },
        { prefix: '📅', type: 'timeline' },    { prefix: '🏺', type: 'object' },
        { prefix: '[cena]', type: 'scene' },   { prefix: '[scene]', type: 'scene' },
        { prefix: '[personagem]', type: 'character' }, { prefix: '[char]', type: 'character' },
        { prefix: '[local]', type: 'location' }, { prefix: '[loc]', type: 'location' },
        { prefix: '[evento]', type: 'event' }, { prefix: '[event]', type: 'event' },
        { prefix: '[dialogo]', type: 'dialogue' }, { prefix: '[tema]', type: 'theme' },
        { prefix: '[theme]', type: 'theme' },  { prefix: '[timeline]', type: 'timeline' },
        { prefix: '[objeto]', type: 'object' }, { prefix: '[object]', type: 'object' }
    ];

    const EXAMPLE_TEXT =
`# Ato I - O Chamado
  🎬 João acorda em casa
  🎬 Encontra a carta do pai
  🎬 Decide partir
# Ato II - A Jornada
  🎬 Viaja para o castelo
  🎬 Enfrenta o guarda
  🎬 Descobre a verdade
# Ato III - A Escolha
  🎬 Confronta o rei
  🎬 Escolhe perdoar`;

    /* ============================================================
       HELPERS
       ============================================================ */
    function escHTML(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
    function toast(msg, type) {
        if (typeof showToast === 'function') showToast(msg, type || 'info', 2200);
    }

    /* ============================================================
       ESTADO DO MÓDULO
       ============================================================ */
    let currentMode = 'tree';       // 'tree' | 'text'
    let draggedId = null;

    /* ============================================================
       PARSER (do write-to-map)
       ============================================================ */
    function parseLine(rawLine) {
        if (!rawLine.trim()) return null;
        const indentMatch = rawLine.match(/^(\s*)/);
        const indentStr = indentMatch ? indentMatch[1] : '';
        const level = indentStr.includes('\t')
            ? indentStr.split('\t').length - 1
            : Math.floor(indentStr.length / 2);

        let text = rawLine.trim().replace(/^[-*•]\s+/, '');
        let headerLevel = -1;
        const headerMatch = text.match(/^(#+)\s*(.*)$/);
        if (headerMatch) {
            headerLevel = headerMatch[1].length - 1;
            text = headerMatch[2].trim();
        }
        const finalLevel = headerLevel >= 0 ? headerLevel : level;

        let type = null;
        let title = text;
        for (const { prefix, type: t } of TYPE_PREFIXES) {
            if (title.startsWith(prefix)) {
                type = t;
                title = title.slice(prefix.length).trim();
                break;
            }
        }

        let content = '';
        const sepMatch = title.match(/^(.+?)\s+(?:\||::)\s+(.+)$/);
        if (sepMatch) {
            title = sepMatch[1].trim();
            content = sepMatch[2].trim();
        }

        if (!title) return null;
        return { level: finalLevel, title, content, type };
    }

    function parseOutline(text) {
        const items = [];
        text.split('\n').forEach(raw => {
            const parsed = parseLine(raw);
            if (parsed) items.push(parsed);
        });
        return items;
    }

    function buildTree(items) {
        const roots = [];
        const stack = [];
        items.forEach(item => {
            const node = { title: item.title, content: item.content || '', type: item.type || null, children: [] };
            while (stack.length > item.level) stack.pop();
            if (stack.length === 0) roots.push(node);
            else stack[stack.length - 1].children.push(node);
            stack.push(node);
        });
        return roots;
    }

    function countAllNodes(tree) {
        let n = 0;
        tree.forEach(node => { n += 1 + countAllNodes(node.children); });
        return n;
    }

    function serializeOutline() {
        if (!mindMapData || !Array.isArray(mindMapData.nodes)) return '';
        const byParent = {};
        mindMapData.nodes.forEach(n => {
            const key = n.parentId || '__root__';
            (byParent[key] ||= []).push(n);
        });
        const lines = [];
        function walk(parentKey, depth) {
            (byParent[parentKey] || []).forEach(n => {
                const indent = '  '.repeat(depth);
                let prefix = '';
                if (n.type === 'scene') prefix = '🎬 ';
                else if (n.type === 'character') prefix = '🧙 ';
                else if (n.type === 'location') prefix = '📍 ';
                else if (n.type === 'event') prefix = '⚡ ';
                else if (n.type === 'dialogue') prefix = '💬 ';
                else if (n.type === 'theme') prefix = '🎭 ';
                else if (n.type === 'timeline') prefix = '📅 ';
                else if (n.type === 'object') prefix = '🏺 ';
                let line = indent + prefix + (n.title || 'Sem título');
                if (n.content && n.content.trim()) {
                    line += ' | ' + n.content.replace(/\s+/g, ' ').trim();
                }
                lines.push(line);
                walk(n.id, depth + 1);
            });
        }
        walk('__root__', 0);
        return lines.join('\n');
    }

    function createNodesFromTree(tree, parentId, createdIds) {
        tree.forEach(nodeData => {
            if (typeof generateNodeId !== 'function') return;
            const newId = generateNodeId();
            mindMapData.nodes.push({
                id: newId,
                title: nodeData.title,
                content: nodeData.content || '',
                parentId: parentId,
                x: 0, y: 0,
                color: 'white', icons: [], collapsed: false,
                tension: 0, beatId: null,
                type: nodeData.type,
                pov: '', typeData: {},
                isVariant: false, variantOf: null, variantLabel: ''
            });
            createdIds.push(newId);
            if (nodeData.children.length) {
                createNodesFromTree(nodeData.children, newId, createdIds);
            }
        });
    }

    /* ============================================================
       TREE MODE
       ============================================================ */
    function buildRow(node, byParent, depth) {
        const li = document.createElement('li');
        li.setAttribute('data-outline-node', node.id);

        const row = document.createElement('div');
        row.className = `outline-item flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer relative group ${selectedNodeIds.has(node.id) ? 'bg-indigo-100' : ''}`;
        row.style.paddingLeft = `${depth * 14 + 6}px`;
        row.setAttribute('data-outline-row', node.id);
        row.setAttribute('tabindex', '-1');
        row.draggable = true;

        const children = byParent[node.id] || [];
        const hasChildren = children.length > 0;
        const collapsed = node.collapsed;
        const tColor = (typeof tensionColor === 'function') ? tensionColor(node.tension || 0) : null;
        const beat = node.beatId && typeof findBeatById === 'function' ? findBeatById(node.beatId) : null;
        const typeDef = node.type && typeof NODE_TYPES !== 'undefined' ? NODE_TYPES[node.type] : null;

        const arrowHTML = hasChildren
            ? `<span class="w-4 text-slate-400 text-[10px] flex items-center justify-center flex-shrink-0" data-action="toggle" title="Recolher/expandir">${collapsed ? '▶' : '▼'}</span>`
            : `<span class="w-4 flex-shrink-0"></span>`;
        const dotHTML = tColor
            ? `<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${tColor}"></span>`
            : `<span class="w-1.5 h-1.5 shrink-0"></span>`;
        const beatHTML = beat ? `<span class="text-[10px] shrink-0" title="${escHTML(beat.name)}">${renderIcon(beat.icon)}</span>` : '';
        const typeHTML = typeDef ? `<span class="text-[10px] shrink-0" title="${escHTML(typeDef.label)}">${renderIcon(typeDef.icon)}</span>` : '';
        const variantHTML = node.isVariant ? `<span class="text-[10px] shrink-0" title="Variante">🧪</span>` : '';

        row.innerHTML = `
            ${arrowHTML}${dotHTML}${variantHTML}${beatHTML}${typeHTML}
            <span class="sm-outline-title truncate flex-1 text-xs ${depth === 0 ? 'font-bold text-slate-800' : 'text-slate-700'}"
                  data-outline-title="${node.id}">${escHTML(node.title)}</span>
            <button type="button"
                    class="sm-outline-edit-btn opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-100 transition flex-shrink-0"
                    data-action="edit" title="Editar título (F2)">
                <i class="fa-solid fa-pen text-[9px] pointer-events-none"></i>
            </button>
        `;

        row.onclick = (e) => {
            if (e.target.closest('[data-action="toggle"]')) { e.stopPropagation(); toggleCollapse(node.id); return; }
            if (e.target.closest('[data-action="edit"]')) { e.stopPropagation(); startOutlineEdit(node.id); return; }
            if (e.target.classList && e.target.classList.contains('sm-outline-title') && e.target.isContentEditable) return;
            e.stopPropagation();
            selectNode(node.id);
            focusNodeInView(node);
        };

        const titleEl = row.querySelector('.sm-outline-title');
        titleEl.ondblclick = (e) => { e.stopPropagation(); startOutlineEdit(node.id); };

        row.onkeydown = (e) => {
            if (titleEl.isContentEditable) return;
            if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation(); startOutlineEdit(node.id);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const items = Array.from(document.querySelectorAll('#outline-list [data-outline-row]'));
                const idx = items.indexOf(row);
                const next = e.key === 'ArrowDown' ? items[idx + 1] : items[idx - 1];
                if (next) next.focus();
            }
        };

        row.ondragstart = (e) => {
            e.stopPropagation();
            draggedId = node.id;
            row.style.opacity = '0.4';
            document.body.classList.add('sm-outline-dragging');
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); } catch (_) {}
        };
        row.ondragend = () => {
            row.style.opacity = '';
            document.body.classList.remove('sm-outline-dragging');
            clearDropIndicators();
            draggedId = null;
        };
        row.ondragover = (e) => {
            if (!draggedId || draggedId === node.id) return;
            if (isDescendantOf(draggedId, node.id)) { clearDropIndicators(); return; }
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = row.getBoundingClientRect();
            const pct = (e.clientY - rect.top) / rect.height;
            clearDropIndicators();
            if (pct < 0.28) row.classList.add('sm-outline-drop-above');
            else if (pct > 0.72) row.classList.add('sm-outline-drop-below');
            else row.classList.add('sm-outline-drop-child');
        };
        row.ondragleave = (e) => {
            if (!row.contains(e.relatedTarget)) row.classList.remove('sm-outline-drop-above', 'sm-outline-drop-below', 'sm-outline-drop-child');
        };
        row.ondrop = (e) => {
            if (!draggedId || draggedId === node.id) return;
            if (isDescendantOf(draggedId, node.id)) return;
            e.preventDefault(); e.stopPropagation();
            const rect = row.getBoundingClientRect();
            const pct = (e.clientY - rect.top) / rect.height;
            clearDropIndicators();
            if (pct < 0.28)      applyDropAsSibling(draggedId, node.id, 'before');
            else if (pct > 0.72) applyDropAsSibling(draggedId, node.id, 'after');
            else                 applyDropAsChild(draggedId, node.id);
        };

        li.appendChild(row);
        if (hasChildren && !collapsed) {
            const ul = document.createElement('ul');
            ul.className = 'space-y-0.5';
            children.forEach(c => ul.appendChild(buildRow(c, byParent, depth + 1)));
            li.appendChild(ul);
        }
        return li;
    }

    function isDescendantOf(ancestorId, candidateId) {
        if (ancestorId === candidateId) return true;
        let cur = getNode(candidateId);
        const seen = new Set();
        while (cur && cur.parentId) {
            if (seen.has(cur.id)) return false;
            seen.add(cur.id);
            if (cur.parentId === ancestorId) return true;
            cur = getNode(cur.parentId);
        }
        return false;
    }

    function applyDropAsChild(dragId, targetId) {
        const dragged = getNode(dragId), target = getNode(targetId);
        if (!dragged || !target) return;
        pushHistory();
        dragged.parentId = targetId;
        target.collapsed = false;
        reorderInArray(dragId, (arr) => {
            let idx = -1;
            for (let i = arr.length - 1; i >= 0; i--) {
                if (arr[i].parentId === targetId) { idx = i + 1; break; }
            }
            if (idx < 0) {
                const tIdx = arr.findIndex(n => n.id === targetId);
                idx = tIdx >= 0 ? tIdx + 1 : arr.length;
            }
            return idx;
        });
        afterDrop(`"${dragged.title}" agora é filho de "${target.title}".`);
    }

    function applyDropAsSibling(dragId, targetId, position) {
        const dragged = getNode(dragId), target = getNode(targetId);
        if (!dragged || !target) return;
        if (dragged.parentId === targetId) return;
        pushHistory();
        dragged.parentId = target.parentId;
        reorderInArray(dragId, (arr) => {
            const tIdx = arr.findIndex(n => n.id === targetId);
            if (tIdx < 0) return arr.length;
            return position === 'before' ? tIdx : tIdx + 1;
        });
        afterDrop(`"${dragged.title}" reordenado.`);
    }

    function reorderInArray(nodeId, getInsertIdxFn) {
        const idx = mindMapData.nodes.findIndex(n => n.id === nodeId);
        if (idx < 0) return;
        const [node] = mindMapData.nodes.splice(idx, 1);
        const insertAt = Math.max(0, Math.min(mindMapData.nodes.length, getInsertIdxFn(mindMapData.nodes)));
        mindMapData.nodes.splice(insertAt, 0, node);
    }

    function afterDrop(message) {
        if (typeof invalidateStructure === 'function') invalidateStructure();
        saveStoriesStorage();
        renderApp();
        const skipLayout = mindMapData.beatSheetMode || mindMapData.beatSortMode || mindMapData.timelineMode;
        if (!skipLayout && typeof applyLayout === 'function') {
            applyLayout();
            renderApp();
        }
        renderOutline();
        if (message) toast(message + ' Ctrl+Z desfaz.', 'success');
    }

    function clearDropIndicators() {
        document.querySelectorAll('.sm-outline-drop-above, .sm-outline-drop-below, .sm-outline-drop-child')
            .forEach(el => el.classList.remove('sm-outline-drop-above', 'sm-outline-drop-below', 'sm-outline-drop-child'));
    }

    function startOutlineEdit(nodeId) {
        const titleEl = document.querySelector(`[data-outline-title="${CSS.escape(nodeId)}"]`);
        if (!titleEl) return;
        const node = getNode(nodeId);
        if (!node) return;

        const original = node.title;
        titleEl.contentEditable = 'true';
        titleEl.classList.add('ring-2', 'ring-indigo-400', 'bg-white', 'px-1', 'rounded');
        titleEl.focus();

        const range = document.createRange(); range.selectNodeContents(titleEl);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);

        let done = false;
        const finish = (save) => {
            if (done) return; done = true;
            titleEl.contentEditable = 'false';
            titleEl.classList.remove('ring-2', 'ring-indigo-400', 'bg-white', 'px-1', 'rounded');
            const newTitle = (titleEl.innerText || '').trim();
            if (save && newTitle && newTitle !== original) {
                pushHistory();
                node.title = newTitle;
                if (typeof invalidateStructure === 'function') invalidateStructure();
                saveStoriesStorage();
                renderApp();
                renderOutline();
                toast('Título atualizado.', 'success');
            } else {
                titleEl.textContent = original;
            }
        };
        titleEl.onblur = () => finish(true);
        titleEl.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); titleEl.onblur = null; finish(false); }
        };
    }

    /* ============================================================
       TEXT MODE
       ============================================================ */
    function renderTextModeUI() {
        const container = document.getElementById('outline-list');
        if (!container) return;

        const defaultReplace = (mindMapData && mindMapData.nodes && mindMapData.nodes.length <= 1);

        container.innerHTML = `
            <div class="sm-outline-text-wrap">
                <textarea id="sm-outline-textarea" class="sm-outline-textarea"
                    placeholder="Cole ou escreva seu outline aqui.

Cada linha vira um nó. 2 espaços (ou Tab) indicam hierarquia.
Emoji no início define o tipo: 🎬 cena · 🧙 personagem · 📍 local · ⚡ evento.

Exemplo:
# Ato I
  🎬 Cena 1 — Mundo comum
  🎬 Cena 2 — Incidente incitante"
                    spellcheck="false" autocomplete="off"></textarea>

                <div class="sm-outline-text-footer">
                    <span class="sm-outline-text-count"><b id="sm-outline-text-count-val">0</b> nó(s)</span>
                    <label class="sm-outline-text-opt">
                        <input type="checkbox" id="sm-outline-text-replace" ${defaultReplace ? 'checked' : ''}>
                        <span>Substituir mapa</span>
                    </label>
                </div>

                <div class="sm-outline-text-actions">
                    <button type="button" class="sm-outline-text-btn ghost" data-sm-action="clear">Limpar</button>
                    <button type="button" class="sm-outline-text-btn ghost" data-sm-action="sample">Exemplo</button>
                    <button type="button" class="sm-outline-text-btn ghost" data-sm-action="serialize" title="Preencher com o mapa atual">
                        <i class="fa-solid fa-download"></i>
                    </button>
                    <button type="button" class="sm-outline-text-btn primary" data-sm-action="apply" disabled>
                        <i class="fa-solid fa-bolt"></i> Aplicar
                    </button>
                </div>
            </div>
        `;

        const textarea = container.querySelector('#sm-outline-textarea');
        const countEl = container.querySelector('#sm-outline-text-count-val');
        const applyBtn = container.querySelector('[data-sm-action="apply"]');

        function updateCount() {
            const items = parseOutline(textarea.value);
            const tree = buildTree(items);
            const n = countAllNodes(tree);
            countEl.textContent = String(n);
            applyBtn.disabled = n === 0;
        }
        textarea.addEventListener('input', updateCount);

        // Tab insere 2 espaços; Shift+Tab remove até 2 do início da linha
        textarea.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const val = textarea.value;
            const start = textarea.selectionStart, end = textarea.selectionEnd;

            if (!e.shiftKey) {
                textarea.value = val.slice(0, start) + '  ' + val.slice(end);
                textarea.selectionStart = textarea.selectionEnd = start + 2;
            } else {
                const lineStart = val.lastIndexOf('\n', start - 1) + 1;
                const before = val.slice(0, lineStart);
                const rest = val.slice(lineStart);
                const trimmed = rest.replace(/^ {1,2}/, '');
                const removed = rest.length - trimmed.length;
                textarea.value = before + trimmed;
                textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - removed);
            }
            updateCount();
        });

        container.querySelector('[data-sm-action="clear"]').onclick = () => {
            textarea.value = '';
            updateCount();
            textarea.focus();
        };
        container.querySelector('[data-sm-action="sample"]').onclick = () => {
            textarea.value = EXAMPLE_TEXT;
            updateCount();
            textarea.focus();
        };
        container.querySelector('[data-sm-action="serialize"]').onclick = () => {
            const s = serializeOutline();
            if (!s) { toast('O mapa está vazio.', 'warn'); return; }
            textarea.value = s;
            updateCount();
            toast('Outline carregado. Edite e clique em Aplicar.', 'info');
        };
        applyBtn.onclick = applyTextToMap;

        updateCount();
        setTimeout(() => textarea.focus(), 50);
    }

    function applyTextToMap() {
        const textarea = document.getElementById('sm-outline-textarea');
        const replaceChk = document.getElementById('sm-outline-text-replace');
        if (!textarea) return;

        const text = textarea.value;
        if (!text.trim()) { toast('Escreva algo antes de aplicar.', 'warn'); return; }
        const items = parseOutline(text);
        if (items.length === 0) { toast('Nenhuma linha válida encontrada.', 'warn'); return; }
        const tree = buildTree(items);
        const total = countAllNodes(tree);

        const replace = replaceChk && replaceChk.checked;
        if (replace && mindMapData.nodes.length > 1) {
            const ok = confirm(
                `Substituir TODOS os ${mindMapData.nodes.length} nós do mapa atual?\n\n` +
                `Ctrl+Z desfaz.`
            );
            if (!ok) return;
        }

        pushHistory();

        if (replace) {
            mindMapData.nodes = [];
            mindMapData.relationships = [];
            mindMapData.relations = [];
            mindMapData.skillTrees = {};
            mindMapData.beatSheetMode = false;
            mindMapData.beatSortMode = false;
            mindMapData.timelineMode = false;
            mindMapData.beatSheetSavedPositions = null;
            mindMapData.beatSortSavedPositions = null;
            mindMapData.timelineSavedPositions = null;
        }

        // Append: se 1 nó selecionado, novos nós viram filhos dele; senão viram raízes
        let appendParentId = null;
        if (!replace && selectedNodeIds.size === 1) {
            appendParentId = Array.from(selectedNodeIds)[0];
        }

        const createdIds = [];
        createNodesFromTree(tree, appendParentId, createdIds);

        if (typeof invalidateStructure === 'function') invalidateStructure();
        saveStoriesStorage();

        renderApp();
        if (typeof applyLayout === 'function') applyLayout();
        renderApp();

        requestAnimationFrame(() => {
            if (typeof fitView === 'function') fitView();
        });

        exitTextMode();
        toast(`${total} nó(s) ${replace ? 'criado(s)' : 'adicionado(s)'}. Ctrl+Z desfaz.`, 'success');
    }

    /* ============================================================
       TOGGLE ENTRE MODOS
       ============================================================ */
    function enterTextMode() {
        currentMode = 'text';
        const panel = document.getElementById('outline-panel');
        if (!panel) return;

        // Abre o painel se estiver fechado
        if (panel.classList.contains('-ml-64')) {
            panel.classList.remove('-ml-64');
            const arrow = document.getElementById('outline-tab-arrow');
            if (arrow) {
                arrow.classList.remove('fa-chevron-right');
                arrow.classList.add('fa-chevron-left');
            }
        }
        panel.classList.add('sm-outline-text-mode');
        renderTextModeUI();
        updateToggleIcon();
    }

    function exitTextMode() {
        currentMode = 'tree';
        const panel = document.getElementById('outline-panel');
        if (panel) panel.classList.remove('sm-outline-text-mode');
        renderOutline();
        updateToggleIcon();
    }

    function updateToggleIcon() {
        const btn = document.querySelector('[data-sm-outline-toggle]');
        if (!btn) return;
        if (currentMode === 'tree') {
            btn.innerHTML = '<i class="fa-solid fa-pen-nib"></i>';
            btn.title = 'Editar como texto (criar em lote)';
        } else {
            btn.innerHTML = '<i class="fa-solid fa-tree"></i>';
            btn.title = 'Voltar para árvore (editar / arrastar)';
        }
    }

    /* ============================================================
       INJEÇÃO DE BOTÕES
       ============================================================ */
    function injectPanelToggle() {
        const header = document.querySelector('#outline-panel > div:first-child');
        if (!header || header.querySelector('[data-sm-outline-toggle]')) return;
        const closeBtn = header.querySelector('button');
        if (!closeBtn) return;

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.setAttribute('data-sm-outline-toggle', '1');
        toggle.className = 'text-slate-400 hover:text-indigo-600 p-1 rounded transition';
        toggle.addEventListener('click', () => {
            if (currentMode === 'tree') enterTextMode();
            else exitTextMode();
        });

        // Substitui o texto do título por "Estrutura" (mais claro)
        const titleSpan = header.querySelector('h2 span');
        if (titleSpan) titleSpan.textContent = 'Estrutura';

        header.insertBefore(toggle, closeBtn);
        updateToggleIcon();
    }

    /* ============================================================
       SUBSTITUIR renderOutline
       ============================================================ */
    function installWrap() {
        if (typeof window.renderOutline !== 'function') { setTimeout(installWrap, 100); return; }
        if (window.renderOutline.__smOutlinePlus) {
            console.warn('[OutlinePlus] renderOutline já foi modificado por outra versão. Ignorando.');
            return;
        }

        window.renderOutline = function () {
            if (currentMode === 'text') return;   // Não sobrescreve o editor de texto

            const container = document.getElementById('outline-list');
            if (!container) return;
            container.innerHTML = '';

            const byParent = {};
            const vCache = new Map();
            (function computeVR() {
                function walk(node, vr) {
                    vCache.set(node.id, node.isVariant ? node : vr);
                    mindMapData.nodes.forEach(n => { if (n.parentId === node.id) walk(n, vCache.get(node.id)); });
                }
                mindMapData.nodes.filter(n => !n.parentId).forEach(r => walk(r, null));
            })();
            mindMapData.nodes.forEach(n => {
                if (!showVariants && vCache.get(n.id)) return;
                (byParent[n.parentId || '__root__'] ||= []).push(n);
            });

            const rootNodes = byParent['__root__'] || [];
            const ul = document.createElement('ul');
            ul.className = 'space-y-0.5';
            rootNodes.forEach(r => ul.appendChild(buildRow(r, byParent, 0)));
            container.appendChild(ul);
        };
        window.renderOutline.__smOutlinePlus = true;

        window.buildOutlineItem = buildRow;

        // F2 global (só quando foco está dentro do outline)
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'F2') return;
            const active = document.activeElement;
            if (!active || !active.closest || !active.closest('#outline-panel')) return;
            const row = active.closest('[data-outline-row]');
            if (!row) return;
            e.preventDefault(); e.stopImmediatePropagation();
            startOutlineEdit(row.getAttribute('data-outline-row'));
        }, true);

        if (mindMapData) { try { window.renderOutline(); } catch (_) {} }
    }

    /* ============================================================
       CSS
       ============================================================ */
    function injectCSS() {
        if (document.getElementById('sm-outline-plus-css')) return;
        const s = document.createElement('style');
        s.id = 'sm-outline-plus-css';
        s.textContent = `
            /* ---------- TREE: drop indicators ---------- */
            .outline-item.sm-outline-drop-above::before,
            .outline-item.sm-outline-drop-below::after {
                content: ''; position: absolute; left: 4px; right: 4px;
                height: 2px; background: #6366f1; border-radius: 1px;
                pointer-events: none; z-index: 1;
            }
            .outline-item.sm-outline-drop-above::before { top: -1px; }
            .outline-item.sm-outline-drop-below::after  { bottom: -1px; }
            .outline-item.sm-outline-drop-above,
            .outline-item.sm-outline-drop-below { background: rgba(99,102,241,.04); }

            .outline-item.sm-outline-drop-child {
                background: rgba(99,102,241,.12) !important;
                outline: 1.5px dashed #6366f1; outline-offset: -1px;
            }

            .outline-item { position: relative; }
            .outline-item::before {
                content: '⋮⋮'; position: absolute; left: -4px; top: 50%;
                transform: translateY(-50%); font-size: 9px; color: #cbd5e1;
                opacity: 0; transition: opacity .12s; pointer-events: none;
                letter-spacing: -2px; z-index: 1;
            }
            .outline-item:hover::before { opacity: 1; }

            .sm-outline-edit-btn { pointer-events: none; }
            .outline-item:hover .sm-outline-edit-btn { pointer-events: auto; }

            body.sm-outline-dragging .outline-item { user-select: none; }
            body.sm-outline-dragging .outline-item[data-outline-row] { cursor: grabbing; }

            /* ---------- Painel mais largo no modo texto ---------- */
            #outline-panel { transition: width .25s ease, margin-left .25s ease; }
            #outline-panel.sm-outline-text-mode { width: 400px !important; }
            #outline-panel.sm-outline-text-mode.-ml-64 { margin-left: -400px !important; }

            /* ---------- TEXT MODE ---------- */
            .sm-outline-text-wrap {
                display: flex; flex-direction: column;
                height: 100%; gap: 8px;
            }
            .sm-outline-textarea {
                flex: 1; min-height: 180px; width: 100%;
                padding: 10px;
                border: 1px solid #cbd5e1; border-radius: 8px;
                background: #fff;
                font-family: 'Menlo', 'Consolas', 'Monaco', monospace;
                font-size: 12px; line-height: 1.6; color: #1e293b;
                resize: none; outline: none;
            }
            .sm-outline-textarea:focus {
                border-color: #6366f1;
                box-shadow: 0 0 0 3px rgba(99,102,241,.12);
            }
            .sm-outline-text-footer {
                display: flex; justify-content: space-between; align-items: center;
                font-size: 10.5px; color: #64748b;
            }
            .sm-outline-text-count b { color: #4338ca; }
            .sm-outline-text-opt { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
            .sm-outline-text-opt input { accent-color: #6366f1; }
            .sm-outline-text-actions {
                display: flex; gap: 6px; align-items: stretch;
            }
            .sm-outline-text-btn {
                padding: 6px 10px; border-radius: 6px;
                font-size: 11px; font-weight: 600; cursor: pointer;
                border: none; transition: all .12s;
                display: inline-flex; align-items: center; justify-content: center; gap: 5px;
            }
            .sm-outline-text-btn.ghost { background: #f1f5f9; color: #475569; }
            .sm-outline-text-btn.ghost:hover { background: #e2e8f0; }
            .sm-outline-text-btn.primary {
                flex: 1;
                background: linear-gradient(135deg, #6366f1, #8b5cf6);
                color: #fff;
            }
            .sm-outline-text-btn.primary:hover { box-shadow: 0 4px 12px -2px rgba(99,102,241,.45); }
            .sm-outline-text-btn.primary:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }

            /* ---------- Dark theme ---------- */
            body.app-theme-dark .outline-item.sm-outline-drop-child {
                background: rgba(129,140,248,.25) !important;
                outline-color: #818cf8;
            }
            body.app-theme-dark .outline-item.sm-outline-drop-above::before,
            body.app-theme-dark .outline-item.sm-outline-drop-below::after { background: #818cf8; }
            body.app-theme-dark .outline-item::before { color: #475569; }
            body.app-theme-dark .sm-outline-textarea {
                background: #0f172a; border-color: #334155; color: #e2e8f0;
            }
            body.app-theme-dark .sm-outline-text-footer { color: #94a3b8; }
            body.app-theme-dark .sm-outline-text-count b { color: #c7d2fe; }
            body.app-theme-dark .sm-outline-text-btn.ghost { background: #334155; color: #cbd5e1; }
            body.app-theme-dark .sm-outline-text-btn.ghost:hover { background: #475569; }

            /* ---------- Mobile: painel ocupa mais ---------- */
            @media (hover: none) and (max-width: 640px) {
                #outline-panel.sm-outline-text-mode { width: 92vw !important; }
                #outline-panel.sm-outline-text-mode.-ml-64 { margin-left: -92vw !important; }
            }
        `;
        document.head.appendChild(s);
    }

    /* ============================================================
       INIT
       ============================================================ */
    function init() {
        injectCSS();
        installWrap();
        injectPanelToggle();

        // Atalho Alt+Shift+W → text mode
        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.shiftKey && e.code === 'KeyW') {
                const t = e.target;
                if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
                e.preventDefault(); e.stopPropagation();
                if (currentMode === 'tree') enterTextMode();
                const ta = document.getElementById('sm-outline-textarea');
                if (ta) ta.focus();
            }
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    /* API pública */
    window.SM_openOutlineTextMode = function () {
        if (currentMode !== 'text') enterTextMode();
    };
    window.SM_outlineEdit = startOutlineEdit;
})();