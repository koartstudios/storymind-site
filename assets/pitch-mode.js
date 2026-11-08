/* ============================================================
   STORYMIND PRO — MÓDULO: STORYBOARD (Galeria em Camadas v2)
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_STORYBOARD_LOADED) return;
    window.SM_STORYBOARD_LOADED = true;

    let currentFilter = 'all';
    let currentParentId = null; // null significa "Raiz" (todos os nós sem pai)
    let breadcrumbPath = [];    // Histórico de navegação

    function injectCSS() {
        if (document.getElementById('sm-sb-css')) return;
        const style = document.createElement('style');
        style.id = 'sm-sb-css';
        style.textContent = `
            #sm-sb-overlay {
                position: fixed; inset: 0; z-index: 10000;
                background: #f8fafc; display: none; flex-direction: column;
                font-family: 'Inter', sans-serif; animation: sm-sb-fade 0.2s ease;
            }
            #sm-sb-overlay.active { display: flex; }
            @keyframes sm-sb-fade { from { opacity: 0; } to { opacity: 1; } }
            body.app-theme-dark #sm-sb-overlay { background: #0f172a; color: white; }

            .sm-sb-header {
                padding: 16px 24px; display: flex; justify-content: space-between; align-items: center;
                border-bottom: 1px solid #e2e8f0; background: white; flex-shrink: 0;
            }
            body.app-theme-dark .sm-sb-header { background: #1e293b; border-bottom-color: #334155; }

            .sm-sb-title { font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 10px; color: #1e293b; }
            body.app-theme-dark .sm-sb-title { color: #f8fafc; }

            .sm-sb-filters { display: flex; gap: 8px; background: #f1f5f9; padding: 4px; border-radius: 10px; }
            body.app-theme-dark .sm-sb-filters { background: #0f172a; }
            
            .sm-sb-filter-btn {
                background: transparent; border: none; padding: 6px 12px; border-radius: 8px;
                font-size: 12px; font-weight: 600; color: #64748b; cursor: pointer; transition: all 0.2s;
            }
            .sm-sb-filter-btn.active { background: white; color: #4f46e5; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            body.app-theme-dark .sm-sb-filter-btn.active { background: #334155; color: #a5b4fc; }

            .sm-sb-close {
                background: transparent; border: 1px solid #cbd5e1; color: #64748b; padding: 8px 16px;
                border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
            }
            .sm-sb-close:hover { background: #f1f5f9; color: #0f172a; }
            body.app-theme-dark .sm-sb-close { border-color: #475569; color: #cbd5e1; }
            body.app-theme-dark .sm-sb-close:hover { background: #334155; color: white; }

            /* Breadcrumb / Barra de Navegação */
            .sm-sb-breadcrumb-bar {
                padding: 12px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
                display: flex; align-items: center; gap: 8px; font-size: 13px; color: #64748b; flex-wrap: wrap;
            }
            body.app-theme-dark .sm-sb-breadcrumb-bar { background: #1e293b; border-bottom-color: #334155; color: #cbd5e1; }
            
            .sm-sb-crumb { cursor: pointer; font-weight: 600; color: #6366f1; display: flex; align-items: center; gap: 4px; }
            .sm-sb-crumb:hover { text-decoration: underline; }
            .sm-sb-crumb.current { color: #0f172a; cursor: default; text-decoration: none; font-weight: 700; }
            body.app-theme-dark .sm-sb-crumb.current { color: #f1f5f9; }
            
            .sm-sb-back-btn {
                background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 6px;
                font-size: 11px; font-weight: 600; color: #475569; cursor: pointer; display: flex; align-items: center; gap: 6px;
                margin-right: 8px;
            }
            .sm-sb-back-btn:hover { background: #f1f5f9; }
            body.app-theme-dark .sm-sb-back-btn { background: #334155; border-color: #475569; color: #cbd5e1; }

            .sm-sb-body { flex: 1; overflow-y: auto; padding: 24px; }
            .sm-sb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }

            .sm-sb-card {
                background: white; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden;
                box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s; display: flex; flex-direction: column; position: relative;
            }
            body.app-theme-dark .sm-sb-card { background: #1e293b; border-color: #334155; }
            .sm-sb-card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
            
            /* Indicador de pasta (nó que tem filhos) */
            .sm-sb-folder-badge {
                position: absolute; top: 10px; right: 10px; background: rgba(15, 23, 42, 0.7);
                color: white; padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: 700;
                display: flex; align-items: center; gap: 4px; backdrop-filter: blur(4px); z-index: 2;
            }

            .sm-sb-img-container {
                width: 100%; height: 160px; background: #f8fafc; display: flex; align-items: center; justify-content: center;
                border-bottom: 1px solid #e2e8f0; position: relative; overflow: hidden;
            }
            body.app-theme-dark .sm-sb-img-container { background: #0f172a; border-bottom-color: #334155; }
            .sm-sb-img-container img { width: 100%; height: 100%; object-fit: cover; }
            .sm-sb-placeholder-icon { font-size: 48px; opacity: 0.2; }

            .sm-sb-content { padding: 16px; flex: 1; display: flex; flex-direction: column; gap: 8px; }
            .sm-sb-badges { display: flex; gap: 6px; flex-wrap: wrap; }
            .sm-sb-badge { padding: 2px 8px; border-radius: 99px; font-size: 9px; font-weight: 800; color: white; text-transform: uppercase; letter-spacing: 0.05em; }
            
            .sm-sb-card-title { font-size: 15px; font-weight: 700; color: #0f172a; line-height: 1.3; }
            body.app-theme-dark .sm-sb-card-title { color: #f1f5f9; }
            
            .sm-sb-card-text {
                font-size: 12px; color: #64748b; line-height: 1.5;
                display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
            }
            body.app-theme-dark .sm-sb-card-text { color: #94a3b8; }

            .sm-sb-actions { display: flex; gap: 8px; margin-top: auto; padding-top: 10px; }
            .sm-sb-btn {
                flex: 1; padding: 6px; border-radius: 6px; font-size: 11px; font-weight: 600;
                text-align: center; border: none; cursor: pointer; transition: background 0.2s;
            }
            .sm-sb-btn.explore { background: #e0e7ff; color: #4338ca; }
            .sm-sb-btn.explore:hover { background: #c7d2fe; }
            .sm-sb-btn.map { background: #f1f5f9; color: #475569; }
            .sm-sb-btn.map:hover { background: #e2e8f0; }
            body.app-theme-dark .sm-sb-btn.explore { background: #312e81; color: #c7d2fe; }
            body.app-theme-dark .sm-sb-btn.map { background: #334155; color: #cbd5e1; }
        `;
        document.head.appendChild(style);
    }

    function injectUI() {
        if (document.getElementById('sm-sb-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'sm-sb-overlay';
        overlay.innerHTML = `
            <div class="sm-sb-header">
                <div class="sm-sb-title"><i class="fa-solid fa-table-cells-large text-indigo-500"></i> Storyboard</div>
                
                <div class="sm-sb-filters">
                    <button class="sm-sb-filter-btn active" data-filter="all" onclick="window.sbFilter('all')">Tudo</button>
                    <button class="sm-sb-filter-btn" data-filter="scene" onclick="window.sbFilter('scene')">Cenas</button>
                    <button class="sm-sb-filter-btn" data-filter="character" onclick="window.sbFilter('character')">Elenco</button>
                    <button class="sm-sb-filter-btn" data-filter="location" onclick="window.sbFilter('location')">Cenários</button>
                    <button class="sm-sb-filter-btn" data-filter="object" onclick="window.sbFilter('object')">Objetos</button>
                </div>

                <button class="sm-sb-close" onclick="window.closeStoryboardMode()"><i class="fa-solid fa-xmark mr-1"></i> Fechar</button>
            </div>

            <div class="sm-sb-breadcrumb-bar" id="sm-sb-breadcrumb"></div>

            <div class="sm-sb-body">
                <div class="sm-sb-grid" id="sm-sb-grid"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        const headerActions = document.querySelector('body > header > div:nth-child(2)');
        if (headerActions && !document.getElementById('sm-sb-header-btn')) {
            const btn = document.createElement('button');
            btn.id = 'sm-sb-header-btn';
            btn.className = 'bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5';
            btn.title = 'Galeria Visual (Storyboard)';
            btn.innerHTML = '<i class="fa-solid fa-images"></i><span class="hidden md:inline">Galeria</span>';
            btn.onclick = window.openStoryboardMode;
            
            const exportWrap = document.getElementById('export-menu-wrap');
            if (exportWrap) headerActions.insertBefore(btn, exportWrap);
            else headerActions.appendChild(btn);
        }
    }

    // --- Lógica ---
    window.openStoryboardMode = function () {
        // Sempre abre na raiz
        currentParentId = null;
        breadcrumbPath = [];
        document.getElementById('sm-sb-overlay').classList.add('active');
        window.sbFilter(currentFilter);
    };

    window.closeStoryboardMode = function () {
        document.getElementById('sm-sb-overlay').classList.remove('active');
    };

    window.sbFilter = function (type) {
        currentFilter = type;
        document.querySelectorAll('.sm-sb-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === type);
        });
        renderGallery();
    };

    // Navega para dentro de um nó (mostra os filhos)
    window.sbDrillDown = function (nodeId) {
        const node = getNode(nodeId);
        if (!node) return;
        currentParentId = nodeId;
        breadcrumbPath.push({ id: nodeId, title: node.title });
        renderGallery();
    };

    // Volta um nível
    window.sbGoBack = function () {
        if (breadcrumbPath.length > 0) {
            breadcrumbPath.pop();
            currentParentId = breadcrumbPath.length > 0 ? breadcrumbPath[breadcrumbPath.length - 1].id : null;
            renderGallery();
        }
    };

    // Vai para a raiz clicando no breadcrumb
    window.sbGoToRoot = function () {
        currentParentId = null;
        breadcrumbPath = [];
        renderGallery();
    };

    // Vai para o mapa
    window.sbJumpToMap = function (nodeId, event) {
        if (event) event.stopPropagation();
        window.closeStoryboardMode();
        if (typeof jumpToNodeFromBible === 'function') {
            jumpToNodeFromBible(nodeId);
        } else {
            selectedNodeIds.clear();
            selectedNodeIds.add(nodeId);
            renderApp();
            focusNodeInView(getNode(nodeId));
        }
    };

    function renderBreadcrumb() {
        const bc = document.getElementById('sm-sb-breadcrumb');
        let html = '';

        if (breadcrumbPath.length > 0) {
            html += `<button class="sm-sb-back-btn" onclick="window.sbGoBack()"><i class="fa-solid fa-arrow-left"></i> Voltar</button>`;
        }

        html += `<span class="sm-sb-crumb ${breadcrumbPath.length === 0 ? 'current' : ''}" onclick="window.sbGoToRoot()"><i class="fa-solid fa-house"></i> Raiz</span>`;

        breadcrumbPath.forEach((item, index) => {
            const isLast = index === breadcrumbPath.length - 1;
            html += `<i class="fa-solid fa-chevron-right" style="font-size: 9px; opacity: 0.5;"></i>`;
            html += `<span class="sm-sb-crumb ${isLast ? 'current' : ''}" onclick="window.sbNavigateToCrumb(${index})">${escapeHTML(item.title)}</span>`;
        });

        bc.innerHTML = html;
    }

    // Permite clicar no meio do breadcrumb para voltar vários níveis
    window.sbNavigateToCrumb = function (index) {
        if (index === breadcrumbPath.length - 1) return; // já é o atual
        breadcrumbPath = breadcrumbPath.slice(0, index + 1);
        currentParentId = breadcrumbPath[index].id;
        renderGallery();
    };

    function renderGallery() {
        renderBreadcrumb();

        const grid = document.getElementById('sm-sb-grid');
        if (!grid) return;

        // Filtra os nós com base no nível atual (Pai)
        let nodes = mindMapData.nodes.filter(n => !n.isVariant && n.parentId === currentParentId);

        // Aplica o filtro de tipo
        if (currentFilter !== 'all') {
            nodes = nodes.filter(n => n.type === currentFilter);
        }

        if (nodes.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #94a3b8; font-style: italic;">
                    <i class="fa-solid fa-folder-open text-4xl mb-3 opacity-30"></i><br>
                    Nenhum nó encontrado neste nível ${currentFilter !== 'all' ? 'com este filtro' : ''}.
                </div>`;
            return;
        }

        grid.innerHTML = '';
        nodes.forEach(node => {
            const typeDef = node.type ? NODE_TYPES[node.type] : null;
            const color = typeDef ? typeDef.color : '#64748b';
            const icon = typeDef ? typeDef.icon : '📄';
            const tColor = tensionColor(node.tension || 0);

            // Verifica se tem filhos
            const childrenCount = mindMapData.nodes.filter(n => n.parentId === node.id && !n.isVariant).length;
            const hasChildren = childrenCount > 0;

            const imgUrl = (node.icons && node.icons.length > 0) ? node.icons[0] : null;
            let imgHTML = imgUrl ? `<img src="${escapeHTML(imgUrl)}" alt="${escapeHTML(node.title)}">` : `<div class="sm-sb-placeholder-icon" style="color: ${color};">${renderIcon(icon)}</div>`;

            let badges = '';
            if (typeDef) badges += `<span class="sm-sb-badge" style="background:${color}">${typeDef.label}</span>`;
            if (tColor) badges += `<span class="sm-sb-badge" style="background:${tColor}">Tensão ${node.tension}</span>`;

            const folderBadge = hasChildren 
                ? `<div class="sm-sb-folder-badge"><i class="fa-solid fa-folder"></i> ${childrenCount} itens</div>` 
                : '';

            const card = document.createElement('div');
            card.className = 'sm-sb-card';
            
            // Ação principal do card: se tiver filhos, drill-down; se não, vai pro mapa
            card.onclick = () => {
                if (hasChildren) window.sbDrillDown(node.id);
                else window.sbJumpToMap(node.id);
            };

            // Botões de ação no rodapé
            let actionButtons = '';
            if (hasChildren) {
                actionButtons = `
                    <button class="sm-sb-btn explore" onclick="event.stopPropagation(); window.sbDrillDown('${node.id}')"><i class="fa-solid fa-folder-open"></i> Explorar</button>
                    <button class="sm-sb-btn map" onclick="window.sbJumpToMap('${node.id}', event)"><i class="fa-solid fa-location-dot"></i> Mapa</button>
                `;
            } else {
                actionButtons = `
                    <button class="sm-sb-btn map" style="flex:1" onclick="window.sbJumpToMap('${node.id}', event)"><i class="fa-solid fa-location-dot"></i> Ver no Mapa</button>
                `;
            }

            card.innerHTML = `
                <div class="sm-sb-img-container">
                    ${imgHTML}
                    ${folderBadge}
                </div>
                <div class="sm-sb-content">
                    <div class="sm-sb-badges">${badges}</div>
                    <div class="sm-sb-card-title">${escapeHTML(node.title)}</div>
                    <div class="sm-sb-card-text">${node.content ? escapeHTML(node.content) : 'Sem descrição...'}</div>
                    <div class="sm-sb-actions">${actionButtons}</div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    document.addEventListener('keydown', function(e) {
        const overlay = document.getElementById('sm-sb-overlay');
        if (overlay && overlay.classList.contains('active') && e.key === 'Escape') {
            e.preventDefault();
            window.closeStoryboardMode();
        }
    }, true);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { injectCSS(); injectUI(); });
    else { injectCSS(); injectUI(); }
})();