/* ============================================================
   STORYMIND — CONTEXT MENU (Botão Direito) - FASE 1
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_CONTEXT_MENU_LOADED) return;
    window.SM_CONTEXT_MENU_LOADED = true;

    let menuEl = null;
    let submenuEl = null;
    let activeNodeId = null;

    // ============================================================
    // 1. CSS DO MENU
    // ============================================================
    function injectCSS() {
        if (document.getElementById('sm-cm-styles')) return;
        const s = document.createElement('style');
        s.id = 'sm-cm-styles';
        s.textContent = `
            .sm-cm-menu {
                position: fixed;
                z-index: 9999;
                min-width: 220px;
                background: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                box-shadow: 0 10px 30px -5px rgba(15,23,42,.25), 0 4px 10px -2px rgba(15,23,42,.1);
                padding: 6px;
                font-family: 'Inter', sans-serif;
                font-size: 12px;
                color: #334155;
                user-select: none;
                animation: sm-cm-pop .12s cubic-bezier(.16,1,.3,1);
                display: flex;
                flex-direction: column;
            }
            @keyframes sm-cm-pop {
                from { opacity: 0; transform: scale(0.96) translateY(-4px); }
                to   { opacity: 1; transform: scale(1) translateY(0); }
            }
            .sm-cm-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 10px;
                border-radius: 6px;
                cursor: pointer;
                transition: background 0.1s;
                position: relative;
            }
            .sm-cm-item:hover {
                background: #eef2ff;
                color: #4338ca;
            }
            .sm-cm-item.sm-cm-disabled {
                opacity: 0.4;
                cursor: not-allowed;
                pointer-events: none;
            }
            .sm-cm-item.sm-cm-danger:hover {
                background: #fef2f2;
                color: #dc2626;
            }
            .sm-cm-icon {
                width: 16px;
                text-align: center;
                font-size: 13px;
                flex-shrink: 0;
                color: #64748b;
            }
            .sm-cm-item:hover .sm-cm-icon { color: inherit; }
            .sm-cm-label { flex: 1; font-weight: 500; }
            .sm-cm-hint {
                font-family: ui-monospace, monospace;
                font-size: 9.5px;
                color: #94a3b8;
                padding: 1px 5px;
                border: 1px solid #e2e8f0;
                border-radius: 4px;
                background: #f8fafc;
            }
            .sm-cm-divider {
                height: 1px;
                background: #e2e8f0;
                margin: 4px 6px;
            }
            .sm-cm-header {
                padding: 8px 10px 6px;
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #94a3b8;
                display: flex;
                align-items: center;
                gap: 6px;
                border-bottom: 1px solid #e2e8f0;
                margin-bottom: 4px;
                pointer-events: none;
            }
            .sm-cm-submenu {
                position: fixed;
                z-index: 10000;
                min-width: 180px;
                max-height: 320px;
                overflow-y: auto;
                background: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                box-shadow: 0 10px 30px -5px rgba(15,23,42,.25);
                padding: 6px;
                font-family: 'Inter', sans-serif;
                font-size: 12px;
                animation: sm-cm-pop .12s ease;
            }
            .sm-cm-submenu .sm-cm-item { padding: 6px 10px; }
            body.app-theme-dark .sm-cm-menu,
            body.app-theme-dark .sm-cm-submenu {
                background: #1e293b; border-color: #334155; color: #e2e8f0;
            }
            body.app-theme-dark .sm-cm-item:hover { background: #312e81; color: #c7d2fe; }
            body.app-theme-dark .sm-cm-item.sm-cm-danger:hover { background: #7f1d1d; color: #fecaca; }
            body.app-theme-dark .sm-cm-icon { color: #94a3b8; }
            body.app-theme-dark .sm-cm-hint { background: #0f172a; border-color: #334155; color: #94a3b8; }
            body.app-theme-dark .sm-cm-divider { background: #334155; }
            body.app-theme-dark .sm-cm-header { border-bottom-color: #334155; }
            @media (hover: none) and (max-width: 640px) {
                .sm-cm-menu {
                    left: 10px !important; right: 10px !important; bottom: 10px !important; top: auto !important;
                    width: auto !important; transform: none !important; animation: sm-cm-slide-up .2s ease;
                }
                .sm-cm-submenu {
                    left: 10px !important; right: 10px !important; bottom: 10px !important; top: auto !important; width: auto !important;
                }
                @keyframes sm-cm-slide-up {
                    from { transform: translateY(100%); } to { transform: translateY(0); }
                }
            }
        `;
        document.head.appendChild(s);
    }

    // ============================================================
    // 2. UTILITÁRIOS E AÇÕES
    // ============================================================
    function closeMenu() {
        if (menuEl) { menuEl.remove(); menuEl = null; }
        if (submenuEl) { submenuEl.remove(); submenuEl = null; }
        activeNodeId = null;
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', closeMenu);
        window.removeEventListener('blur', closeMenu);
    }

    function onDocClick(e) {
        if (menuEl && !menuEl.contains(e.target) && (!submenuEl || !submenuEl.contains(e.target))) closeMenu();
    }

    function onKeyDown(e) { if (e.key === 'Escape') closeMenu(); }

    const actions = {
        'edit-title': (id) => { if (window.startInlineEdit) window.startInlineEdit(id, 'title'); },
        'add-child': (id) => { if (window.addChildToNode) window.addChildToNode(id); },
        'add-sibling': (id) => {
            if (window.createSibling) {
                const newId = window.createSibling(id);
                if (newId) {
                    if (window.selectedNodeIds) { window.selectedNodeIds.clear(); window.selectedNodeIds.add(newId); }
                    if (window.commit) window.commit();
                    if (window.startInlineEdit) window.startInlineEdit(newId, 'title');
                }
            }
        },
        'create-variant': (id) => {
            if (window.selectedNodeIds) { window.selectedNodeIds.clear(); window.selectedNodeIds.add(id); }
            if (window.openInspectorFor) window.openInspectorFor(id);
            if (window.openVariantModal) window.openVariantModal();
        },
        'duplicate': (id) => {
            if (window.selectedNodeIds) { window.selectedNodeIds.clear(); window.selectedNodeIds.add(id); }
            if (window.pushHistory && window.duplicateSelectedNodesInPlace) {
                window.pushHistory();
                const newIds = window.duplicateSelectedNodesInPlace();
                if (window.selectedNodeIds) { window.selectedNodeIds.clear(); newIds.forEach(nid => window.selectedNodeIds.add(nid)); }
                if (window.invalidateStructure) window.invalidateStructure();
                if (window.saveStoriesStorage) window.saveStoriesStorage();
                if (window.renderApp) window.renderApp();
            }
        },
        'copy': (id) => {
            if (window.selectedNodeIds) { window.selectedNodeIds.clear(); window.selectedNodeIds.add(id); }
            if (window.copySelectedNodes) window.copySelectedNodes();
            if (window.showToast) window.showToast('Nó copiado.', 'success', 1500);
        },
        'delete': (id) => {
            if (window.selectedNodeIds) { window.selectedNodeIds.clear(); window.selectedNodeIds.add(id); }
            if (window.deleteSelectedNodes) window.deleteSelectedNodes();
        },
        'change-type': (id, type) => {
            const node = window.getNode ? window.getNode(id) : null;
            if (!node) return;
            if (type === '__clear') node.type = null; else node.type = type;
            if (!node.typeData) node.typeData = {};
            if (window.domCache) window.domCache.invalidateHeight(node.id);
            if (window.pushHistory) window.pushHistory();
            if (window.saveStoriesStorage) window.saveStoriesStorage();
            if (window.renderApp) window.renderApp();
            if (document.getElementById('edit-node-id') && document.getElementById('edit-node-id').value === id) {
                if (window.renderTypePicker) window.renderTypePicker();
                if (window.renderTypeFields) window.renderTypeFields();
            }
        }
    };

    // ============================================================
    // 3. CONSTRUÇÃO DO MENU
    // ============================================================
    function buildMenu(node, clientX, clientY) {
        closeMenu();
        activeNodeId = node.id;
        injectCSS();

        menuEl = document.createElement('div');
        menuEl.className = 'sm-cm-menu';

        const header = document.createElement('div');
        header.className = 'sm-cm-header';
        const types = window.NODE_TYPES || {};
        const typeIcon = node.type && types[node.type] ? window.renderIcon(types[node.type].icon) : '📄';
        header.innerHTML = `<span>${typeIcon}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${window.escapeHTML(node.title)}</span>`;
        menuEl.appendChild(header);

        const createItem = (icon, label, hint, actionId, payload, isDanger = false, disabled = false) => {
            const item = document.createElement('div');
            item.className = `sm-cm-item ${isDanger ? 'sm-cm-danger' : ''} ${disabled ? 'sm-cm-disabled' : ''}`;
            let hintHTML = hint ? `<span class="sm-cm-hint">${hint}</span>` : '';
            let arrowHTML = actionId === 'change-type' ? `<i class="fa-solid fa-chevron-right" style="font-size:10px;margin-left:4px;opacity:0.5;"></i>` : '';
            item.innerHTML = `<div class="sm-cm-icon">${window.renderIcon(icon)}</div><div class="sm-cm-label">${label}</div>${hintHTML}${arrowHTML}`;

            if (actionId === 'change-type') {
                item.addEventListener('mouseenter', () => { const rect = item.getBoundingClientRect(); buildSubmenu(node, rect.right, rect.top); });
                item.addEventListener('click', (e) => { e.stopPropagation(); const rect = item.getBoundingClientRect(); buildSubmenu(node, rect.left, rect.bottom); });
            } else if (!disabled) {
                item.addEventListener('click', (e) => { e.stopPropagation(); if (actionId && actions[actionId]) actions[actionId](node.id, payload); closeMenu(); });
            }
            return item;
        };

        const createDivider = () => { const d = document.createElement('div'); d.className = 'sm-cm-divider'; return d; };

        menuEl.appendChild(createItem('✏️', 'Editar título', 'F2', 'edit-title'));
        menuEl.appendChild(createItem('📝', 'Abrir Inspector', '', 'open-inspector', null, false, true));
        menuEl.appendChild(createDivider());
        menuEl.appendChild(createItem('🌿', 'Adicionar filho', 'Tab', 'add-child'));
        menuEl.appendChild(createItem('↔️', 'Adicionar irmão', 'Enter', 'add-sibling'));
        menuEl.appendChild(createItem('🧪', 'Criar variante', 'E', 'create-variant'));
        menuEl.appendChild(createItem('📋', 'Duplicar', 'Ctrl+D', 'duplicate'));
        menuEl.appendChild(createDivider());
        menuEl.appendChild(createItem('🎨', 'Mudar tipo', '', 'change-type'));
        menuEl.appendChild(createDivider());
        menuEl.appendChild(createItem('📄', 'Copiar', 'Ctrl+C', 'copy'));
        menuEl.appendChild(createItem('🗑️', 'Excluir', 'Del', 'delete', null, true));

        document.body.appendChild(menuEl);

        const rect = menuEl.getBoundingClientRect();
        let left = clientX; let top = clientY;
        if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
        if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
        if (left < 8) left = 8;
        if (top < 8) top = 8;
        menuEl.style.left = left + 'px'; menuEl.style.top = top + 'px';

        setTimeout(() => {
            document.addEventListener('click', onDocClick);
            document.addEventListener('keydown', onKeyDown);
            window.addEventListener('resize', closeMenu);
            window.addEventListener('blur', closeMenu);
        }, 10);
    }

    // ============================================================
    // 4. CONSTRUÇÃO DO SUBMENU
    // ============================================================
    function buildSubmenu(node, x, y) {
        if (submenuEl) submenuEl.remove();
        submenuEl = document.createElement('div');
        submenuEl.className = 'sm-cm-submenu';

        const clearOpt = document.createElement('div');
        clearOpt.className = 'sm-cm-item';
        clearOpt.innerHTML = `<div class="sm-cm-icon">✖</div><div class="sm-cm-label">Sem tipo (limpar)</div>`;
        clearOpt.onclick = (e) => { e.stopPropagation(); actions['change-type'](node.id, '__clear'); closeMenu(); };
        submenuEl.appendChild(clearOpt);

        const divider = document.createElement('div'); divider.className = 'sm-cm-divider'; submenuEl.appendChild(divider);

        const types = window.NODE_TYPES || {};
        Object.values(types).forEach(t => {
            const opt = document.createElement('div');
            const isSelected = node.type === t.id;
            opt.className = `sm-cm-item ${isSelected ? 'sm-cm-disabled' : ''}`;
            opt.innerHTML = `<div class="sm-cm-icon" style="color:${t.color}">${window.renderIcon(t.icon)}</div><div class="sm-cm-label">${window.escapeHTML(t.label)}</div>`;
            if (!isSelected) opt.onclick = (e) => { e.stopPropagation(); actions['change-type'](node.id, t.id); closeMenu(); };
            submenuEl.appendChild(opt);
        });

        document.body.appendChild(submenuEl);

        const rect = submenuEl.getBoundingClientRect();
        let left = x; let top = y;
        if (left + rect.width > window.innerWidth - 8) left = x - rect.width - 10;
        if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
        if (left < 8) left = 8;
        if (top < 8) top = 8;
        submenuEl.style.left = left + 'px'; submenuEl.style.top = top + 'px';
    }

    // ============================================================
    // 5. GATILHO
    // ============================================================
    document.addEventListener('contextmenu', (e) => {
        const card = e.target.closest('[data-node-id]');
        if (card && window.getNode) {
            e.preventDefault();
            const nodeId = card.getAttribute('data-node-id');
            const node = window.getNode(nodeId);
            if (node) {
                if (window.selectedNodeIds && !window.selectedNodeIds.has(nodeId)) {
                    window.selectedNodeIds.clear();
                    window.selectedNodeIds.add(nodeId);
                    if (window.renderApp) window.renderApp();
                }
                buildMenu(node, e.clientX, e.clientY);
            }
        }
    });
})();