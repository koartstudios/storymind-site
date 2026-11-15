/* ============================================================
   STORYMIND — DOSSIÊ DE ENTIDADE
   ------------------------------------------------------------
   Modal que agrega TUDO sobre uma entidade compartilhada:
   ficha completa, relações, habilidades, objetos, diálogos e
   aparições em todas as abas.

   Funciona com entidades do shared-entities.js (entityId = ent-xxx)
   e, como fallback, com nós antigos sem entityId.

   Um único <script src="assets/entity-dossier.js"> no app.html.
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_ENTITY_DOSSIER_LOADED) return;
    window.SM_ENTITY_DOSSIER_LOADED = true;

    const ENTITY_TYPES = new Set(['character', 'location', 'object', 'theme', 'timeline', 'event']);

    /* ============================================================
       HELPERS
       ============================================================ */
    function deepClone(o) {
        if (o == null) return o;
        if (typeof window.deepClone === 'function') { try { return window.deepClone(o); } catch (_) {} }
        if (typeof structuredClone === 'function') { try { return structuredClone(o); } catch (_) {} }
        return JSON.parse(JSON.stringify(o));
    }
    function normalizeName(s) {
        if (typeof window.normalizeName === 'function') return window.normalizeName(s);
        return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    function escHTML(s) {
        if (typeof window.escapeHTML === 'function') return window.escapeHTML(s);
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
    function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info', 2400); }

    /* ============================================================
       RESOLUÇÃO DO ALVO
       Aceita ent-xxx, node-xxx, ou o próprio objeto nó.
       ============================================================ */
    function resolveTarget(idOrNode) {
        // Objeto nó direto
        if (idOrNode && typeof idOrNode === 'object' && idOrNode.id) {
            const node = idOrNode;
            if (node.entityId && currentStory?.entities?.[node.entityId]) {
                return { entityId: node.entityId, nodeId: node.id, data: currentStory.entities[node.entityId] };
            }
            // Fallback: usa o nó como entidade "ad-hoc"
            return { entityId: null, nodeId: node.id, data: nodeToData(node) };
        }

        // String
        if (typeof idOrNode === 'string') {
            if (idOrNode.startsWith('ent-') && currentStory?.entities?.[idOrNode]) {
                return { entityId: idOrNode, nodeId: null, data: currentStory.entities[idOrNode] };
            }
            if (typeof getNode === 'function') {
                const node = getNode(idOrNode);
                if (node) return resolveTarget(node);
            }
            // Procura em todas as abas
            if (currentStory?.sheets) {
                for (const sheet of currentStory.sheets) {
                    const found = (sheet.nodes || []).find(n => n.id === idOrNode);
                    if (found) return resolveTarget(found);
                }
            }
        }
        return null;
    }

    function nodeToData(node) {
        return {
            id: node.id,
            entityId: node.entityId || null,
            type: node.type,
            title: node.title || 'Sem título',
            content: node.content || '',
            typeData: deepClone(node.typeData) || {},
            pov: node.pov || '',
            icons: deepClone(node.icons) || []
        };
    }

    /* ============================================================
       COLETA DE DADOS
       ============================================================ */
    function findRelations(entityId) {
        if (!entityId || !currentStory?.entityRelations) return [];
        return currentStory.entityRelations
            .filter(r => r.from === entityId || r.to === entityId)
            .map(r => {
                const isOut = r.from === entityId;
                const otherId = isOut ? r.to : r.from;
                const other = currentStory.entities?.[otherId]
                    || { id: otherId, title: otherId, type: null };
                return { ...r, direction: isOut ? 'out' : 'in', other };
            });
    }

    function findSkills(entityId) {
        if (!entityId || !currentStory?.skillTrees) return [];
        const tree = currentStory.skillTrees[entityId];
        if (!tree || !Array.isArray(tree.skills)) return [];
        return tree.skills.slice();
    }

    function findMentions(entityData, entityId) {
        const aliases = new Set();
        if (entityData.title) aliases.add(normalizeName(entityData.title));
        if (entityData.typeData?.fullName) aliases.add(normalizeName(entityData.typeData.fullName));

        const sheets = (currentStory && currentStory.sheets) || (mindMapData ? [mindMapData] : []);
        const mentions = [];

        sheets.forEach(sheet => {
            (sheet.nodes || []).forEach(node => {
                // 1) Este nó é a própria entidade em outra aba?
                if (entityId && node.entityId === entityId) {
                    mentions.push({ kind: 'reference', node, sheet });
                    return;
                }

                const td = node.typeData || {};
                const hits = [];

                if (entityData.type === 'character') {
                    if (td.characters && String(td.characters).split(/[,;·|]/).some(n => aliases.has(normalizeName(n)))) {
                        hits.push({ via: 'characters', label: 'personagens da cena' });
                    }
                    if (td.speaker && aliases.has(normalizeName(td.speaker))) {
                        hits.push({ via: 'speaker', label: 'falante' });
                    }
                    if (td.target && aliases.has(normalizeName(td.target))) {
                        hits.push({ via: 'target', label: 'alvo' });
                    }
                    if (node.type === 'object' && td.user &&
                        String(td.user).split(/[,;·|]/).some(n => aliases.has(normalizeName(n)))) {
                        hits.push({ via: 'user', label: 'usuário de objeto' });
                    }
                    if (node.type === 'object' && td.originalOwner &&
                        aliases.has(normalizeName(td.originalOwner))) {
                        hits.push({ via: 'owner', label: 'dono original' });
                    }
                }

                if (entityData.type === 'object' && td.objects &&
                    String(td.objects).split(/[,;·|]/).some(n => aliases.has(normalizeName(n)))) {
                    hits.push({ via: 'objects', label: 'objetos da cena' });
                }

                if (entityData.type === 'location' && td.location &&
                    aliases.has(normalizeName(td.location))) {
                    hits.push({ via: 'location', label: 'local da cena' });
                }

                if (node.content) {
                    const re = /\[\[([^\[\]\n]{1,100})\]\]/g;
                    let m;
                    while ((m = re.exec(node.content)) !== null) {
                        if (aliases.has(normalizeName(m[1].trim()))) {
                            hits.push({ via: 'wikilink', label: '[[' + m[1] + ']]' });
                            break;
                        }
                    }
                }

                if (hits.length > 0) mentions.push({ kind: 'mention', node, sheet, via: hits });
            });
        });

        return mentions;
    }

    function findObjectsForCharacter(entityData, entityId) {
        const aliases = new Set();
        if (entityData.title) aliases.add(normalizeName(entityData.title));
        if (entityData.typeData?.fullName) aliases.add(normalizeName(entityData.typeData.fullName));
        const out = [];
        const sheets = (currentStory && currentStory.sheets) || [];
        sheets.forEach(sheet => {
            (sheet.nodes || []).forEach(node => {
                if (node.type !== 'object' || !node.typeData) return;
                const owner = node.typeData.user || '';
                if (String(owner).split(/[,;·|]/).some(n => aliases.has(normalizeName(n)))) {
                    out.push({ node, sheet, kind: 'porta' });
                }
                const orig = node.typeData.originalOwner || '';
                if (orig && aliases.has(normalizeName(orig)) && !out.some(o => o.node.id === node.id)) {
                    out.push({ node, sheet, kind: 'criou' });
                }
            });
        });
        return out;
    }

    /* ============================================================
       RENDER
       ============================================================ */
    function injectCSS() {
        if (document.getElementById('sm-dossier-css')) return;
        const s = document.createElement('style');
        s.id = 'sm-dossier-css';
        s.textContent = `
            #sm-dossier-modal {
                position: fixed; inset: 0; z-index: 9997;
                background: rgba(15,23,42,.6);
                -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
                display: none; align-items: center; justify-content: center;
                padding: 20px;
            }
            #sm-dossier-modal.open { display: flex; }
            .sm-dossier-panel {
                background: #ffffff;
                width: 100%; max-width: 900px;
                max-height: 92vh;
                border-radius: 18px;
                box-shadow: 0 30px 60px -12px rgba(0,0,0,.4);
                overflow: hidden;
                display: flex; flex-direction: column;
                animation: sm-dossier-in .2s cubic-bezier(.16,1,.3,1);
            }
            @keyframes sm-dossier-in {
                from { opacity: 0; transform: translateY(10px) scale(.98); }
                to { opacity: 1; transform: none; }
            }
            body.app-theme-dark .sm-dossier-panel { background: #1e293b; }

            .sm-dossier-header {
                padding: 18px 22px;
                border-bottom: 1px solid #e2e8f0;
                display: flex; align-items: flex-start; justify-content: space-between;
                gap: 12px;
                background: linear-gradient(135deg, #eef2ff, #e0e7ff);
                flex-shrink: 0;
            }
            body.app-theme-dark .sm-dossier-header {
                background: linear-gradient(135deg, #1e1b4b, #312e81);
                border-bottom-color: #334155;
            }
            .sm-dossier-header-content { min-width: 0; flex: 1; }
            .sm-dossier-type-badge {
                display: inline-flex; align-items: center; gap: 6px;
                padding: 3px 10px; border-radius: 999px;
                font-size: 10px; font-weight: 800; text-transform: uppercase;
                letter-spacing: .04em; color: #fff;
                margin-bottom: 6px;
            }
            .sm-dossier-title {
                font-size: 20px; font-weight: 800; color: #1e293b;
                line-height: 1.25; word-break: break-word;
            }
            body.app-theme-dark .sm-dossier-title { color: #f1f5f9; }
            .sm-dossier-meta {
                font-size: 12px; color: #64748b; margin-top: 6px;
                display: flex; flex-wrap: wrap; gap: 10px 16px;
            }
            body.app-theme-dark .sm-dossier-meta { color: #94a3b8; }
            .sm-dossier-meta b { color: #475569; font-weight: 600; }
            body.app-theme-dark .sm-dossier-meta b { color: #cbd5e1; }
            .sm-dossier-sheet-badge {
                display: inline-flex; align-items: center; gap: 4px;
                padding: 2px 8px; border-radius: 999px;
                background: #c7d2fe; color: #3730a3;
                font-size: 10px; font-weight: 700;
            }
            body.app-theme-dark .sm-dossier-sheet-badge {
                background: #4338ca; color: #c7d2fe;
            }
            .sm-dossier-close {
                width: 34px; height: 34px;
                display: flex; align-items: center; justify-content: center;
                border: none; border-radius: 8px; background: transparent;
                color: #6366f1; cursor: pointer; flex-shrink: 0;
            }
            .sm-dossier-close:hover { background: rgba(99,102,241,.1); }
            body.app-theme-dark .sm-dossier-close { color: #a5b4fc; }

            .sm-dossier-body {
                flex: 1; overflow-y: auto;
                padding: 20px 22px;
                display: flex; flex-direction: column; gap: 18px;
            }
            .sm-dossier-section { }
            .sm-dossier-section-title {
                font-size: 11px; font-weight: 800; text-transform: uppercase;
                letter-spacing: .06em; color: #6366f1; margin-bottom: 10px;
                display: flex; align-items: center; gap: 8px;
            }
            body.app-theme-dark .sm-dossier-section-title { color: #a5b4fc; }
            .sm-dossier-section-title .sm-dossier-count {
                background: #eef2ff; color: #4338ca;
                font-size: 10px; padding: 1px 8px; border-radius: 999px;
                font-weight: 700;
            }
            body.app-theme-dark .sm-dossier-section-title .sm-dossier-count {
                background: #312e81; color: #c7d2fe;
            }

            .sm-dossier-fiche {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px 20px;
                padding: 14px;
                background: #f8fafc; border: 1px solid #e2e8f0;
                border-radius: 10px;
                font-size: 12.5px;
            }
            body.app-theme-dark .sm-dossier-fiche {
                background: #0f172a; border-color: #334155;
            }
            .sm-dossier-field { display: flex; flex-direction: column; gap: 2px; }
            .sm-dossier-field-label {
                font-size: 10px; font-weight: 700; text-transform: uppercase;
                letter-spacing: .04em; color: #64748b;
            }
            body.app-theme-dark .sm-dossier-field-label { color: #94a3b8; }
            .sm-dossier-field-value {
                color: #1e293b; line-height: 1.5; word-break: break-word;
            }
            body.app-theme-dark .sm-dossier-field-value { color: #e2e8f0; }
            .sm-dossier-field.full { grid-column: 1 / -1; }
            .sm-dossier-field.full .sm-dossier-field-value {
                white-space: pre-wrap;
            }

            .sm-dossier-archetype {
                grid-column: 1 / -1;
                padding: 10px 12px;
                background: linear-gradient(135deg, #faf5ff, #ede9fe);
                border: 1px solid #e9d5ff; border-left: 4px solid #8b5cf6;
                border-radius: 8px; margin-top: 4px;
            }
            body.app-theme-dark .sm-dossier-archetype {
                background: linear-gradient(135deg, #2e1065, #4c1d95);
                border-color: #6d28d9; border-left-color: #a78bfa;
            }
            .sm-dossier-archetype-title {
                font-size: 11px; font-weight: 800; text-transform: uppercase;
                letter-spacing: .05em; color: #6d28d9; margin-bottom: 6px;
                display: flex; align-items: center; gap: 6px;
            }
            body.app-theme-dark .sm-dossier-archetype-title { color: #ddd6fe; }
            .sm-dossier-archetype-desc {
                font-size: 12px; color: #475569; line-height: 1.5;
                margin-bottom: 8px; font-style: italic;
            }
            body.app-theme-dark .sm-dossier-archetype-desc { color: #cbd5e1; }
            .sm-dossier-archetype-grid {
                display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px;
                font-size: 11px;
            }
            .sm-dossier-archetype-grid b {
                color: #6d28d9; font-weight: 700;
            }
            body.app-theme-dark .sm-dossier-archetype-grid b { color: #c4b5fd; }
            body.app-theme-dark .sm-dossier-archetype-grid span { color: #e2e8f0; }

            .sm-dossier-bigfive {
                grid-column: 1 / -1;
                padding: 10px 12px;
                background: #f8fafc; border: 1px dashed #cbd5e1;
                border-radius: 8px;
            }
            body.app-theme-dark .sm-dossier-bigfive {
                background: #0f172a; border-color: #475569;
            }
            .sm-dossier-bigfive-title {
                font-size: 10px; font-weight: 800; text-transform: uppercase;
                color: #64748b; margin-bottom: 8px;
                display: flex; align-items: center; gap: 6px;
            }
            body.app-theme-dark .sm-dossier-bigfive-title { color: #94a3b8; }
            .sm-dossier-bigfive-row {
                display: flex; align-items: center; gap: 8px;
                margin-bottom: 5px; font-size: 11.5px;
            }
            .sm-dossier-bigfive-row:last-child { margin-bottom: 0; }
            .sm-dossier-bigfive-label { min-width: 100px; color: #475569; }
            body.app-theme-dark .sm-dossier-bigfive-label { color: #cbd5e1; }
            .sm-dossier-bigfive-bars {
                display: flex; gap: 2px;
            }
            .sm-dossier-bigfive-bar {
                width: 12px; height: 6px; border-radius: 1px;
            }

            .sm-dossier-list {
                display: flex; flex-direction: column; gap: 4px;
            }
            .sm-dossier-item {
                display: flex; align-items: center; gap: 10px;
                padding: 8px 12px;
                background: #fff; border: 1px solid #e2e8f0;
                border-radius: 8px;
                font-size: 12.5px; cursor: pointer;
                transition: all .12s;
            }
            .sm-dossier-item:hover {
                border-color: #a5b4fc; background: #eef2ff;
                transform: translateX(2px);
            }
            body.app-theme-dark .sm-dossier-item {
                background: #0f172a; border-color: #334155; color: #e2e8f0;
            }
            body.app-theme-dark .sm-dossier-item:hover {
                background: #312e81; border-color: #6366f1;
            }
            .sm-dossier-item-icon {
                width: 20px; text-align: center; flex-shrink: 0;
                font-size: 12px; color: #6366f1;
            }
            body.app-theme-dark .sm-dossier-item-icon { color: #a5b4fc; }
            .sm-dossier-item-body { flex: 1; min-width: 0; }
            .sm-dossier-item-title {
                font-weight: 600; line-height: 1.35;
                overflow: hidden; text-overflow: ellipsis;
                white-space: nowrap;
            }
            .sm-dossier-item-meta {
                font-size: 10.5px; color: #64748b; margin-top: 2px;
            }
            body.app-theme-dark .sm-dossier-item-meta { color: #94a3b8; }
            .sm-dossier-item-actions {
                display: flex; gap: 4px; flex-shrink: 0;
            }
            .sm-dossier-item-btn {
                width: 24px; height: 24px;
                display: flex; align-items: center; justify-content: center;
                border: 1px solid #e2e8f0; border-radius: 5px;
                background: #fff; color: #64748b;
                font-size: 10px; cursor: pointer;
                transition: all .12s;
            }
            .sm-dossier-item-btn:hover {
                background: #eef2ff; border-color: #a5b4fc; color: #4338ca;
            }
            body.app-theme-dark .sm-dossier-item-btn {
                background: #0f172a; border-color: #334155; color: #94a3b8;
            }
            body.app-theme-dark .sm-dossier-item-btn:hover {
                background: #312e81; color: #c7d2fe;
            }
            .sm-dossier-sheet-tag {
                font-size: 9px; font-weight: 800;
                padding: 1px 7px; border-radius: 999px;
                background: #fef3c7; color: #92400e;
                border: 1px solid #fcd34d;
                text-transform: uppercase;
                letter-spacing: .02em;
                flex-shrink: 0;
                white-space: nowrap;
            }
            body.app-theme-dark .sm-dossier-sheet-tag {
                background: #78350f; color: #fef3c7;
                border-color: #92400e;
            }

            .sm-dossier-empty {
                font-size: 12px; color: #94a3b8; font-style: italic;
                padding: 8px 12px;
            }

            .sm-dossier-group {
                padding: 8px 12px;
                background: #f1f5f9;
                border-radius: 6px; margin-bottom: 4px;
                font-size: 10.5px; font-weight: 800;
                text-transform: uppercase; letter-spacing: .04em;
                color: #475569;
                display: flex; justify-content: space-between;
            }
            body.app-theme-dark .sm-dossier-group {
                background: #334155; color: #cbd5e1;
            }
            .sm-dossier-group .sm-dossier-group-count {
                font-weight: 700; color: #6366f1;
            }
            body.app-theme-dark .sm-dossier-group .sm-dossier-group-count { color: #a5b4fc; }

            .sm-dossier-footer {
                padding: 14px 22px;
                border-top: 1px solid #e2e8f0;
                display: flex; align-items: center; justify-content: space-between;
                gap: 10px; flex-wrap: wrap;
                background: #f8fafc; flex-shrink: 0;
            }
            body.app-theme-dark .sm-dossier-footer {
                background: #0f172a; border-top-color: #334155;
            }
            .sm-dossier-btn {
                padding: 8px 14px; border-radius: 8px;
                font-size: 12.5px; font-weight: 600;
                cursor: pointer; border: none; transition: all .12s;
                display: inline-flex; align-items: center; gap: 6px;
            }
            .sm-dossier-btn.ghost {
                background: #f1f5f9; color: #475569;
            }
            .sm-dossier-btn.ghost:hover { background: #e2e8f0; }
            body.app-theme-dark .sm-dossier-btn.ghost {
                background: #334155; color: #cbd5e1;
            }
            body.app-theme-dark .sm-dossier-btn.ghost:hover { background: #475569; }
            .sm-dossier-btn.primary {
                background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
            }
            .sm-dossier-btn.primary:hover {
                box-shadow: 0 4px 12px -2px rgba(99,102,241,.5);
                transform: translateY(-1px);
            }

            @media (max-width: 640px) {
                #sm-dossier-modal { padding: 0; }
                .sm-dossier-panel {
                    max-width: 100vw; width: 100vw;
                    max-height: 100dvh; height: 100dvh;
                    border-radius: 0;
                }
                .sm-dossier-fiche { grid-template-columns: 1fr; }
                .sm-dossier-archetype-grid { grid-template-columns: 1fr; }
                .sm-dossier-title { font-size: 17px; }
                .sm-dossier-body { padding: 14px; gap: 14px; }
            }
        `;
        document.head.appendChild(s);
    }

    function buildModal() {
        if (document.getElementById('sm-dossier-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'sm-dossier-modal';
        modal.innerHTML = `
            <div class="sm-dossier-panel" role="dialog" aria-labelledby="sm-dossier-title">
                <div class="sm-dossier-header">
                    <div class="sm-dossier-header-content" id="sm-dossier-header-content"></div>
                    <button class="sm-dossier-close" type="button" aria-label="Fechar" data-sm-dossier-close>
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="sm-dossier-body" id="sm-dossier-body"></div>
                <div class="sm-dossier-footer">
                    <div id="sm-dossier-footer-left"></div>
                    <div style="display:flex;gap:8px;">
                        <button class="sm-dossier-btn ghost" data-sm-dossier-close>Fechar</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
            if (e.target.closest('[data-sm-dossier-close]')) close();
        });
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }, true);
    }

    /* ============================================================
       RENDER SECTIONS
       ============================================================ */
    function renderHeader(target, sheetsWithEntity) {
        const data = target.data;
        const td = (typeof NODE_TYPES !== 'undefined' && data.type) ? NODE_TYPES[data.type] : null;
        const color = td ? td.color : '#94a3b8';
        const icon = td && typeof renderIcon === 'function' ? renderIcon(td.icon) : (td ? td.icon : '');
        const typeLabel = td ? td.label : (data.type || 'Sem tipo');

        // Meta
        const metaBits = [];
        if (data.typeData?.role) metaBits.push(`<span><b>${escHTML(data.typeData.role)}</b></span>`);
        if (data.typeData?.age) metaBits.push(`<span><b>${escHTML(data.typeData.age)}</b> anos</span>`);
        if (data.typeData?.category && (data.type === 'object' || data.type === 'timeline')) {
            metaBits.push(`<span>${escHTML(data.typeData.category)}</span>`);
        }

        const sheets = (sheetsWithEntity || []).map(s =>
            `<span class="sm-dossier-sheet-badge">${escHTML(s.name)}</span>`
        ).join('');

        return `
            <div class="sm-dossier-type-badge" style="background:${color}">
                ${icon ? icon : ''} ${escHTML(typeLabel)}
            </div>
            <div class="sm-dossier-title" id="sm-dossier-title">${escHTML(data.title || 'Sem título')}</div>
            ${metaBits.length ? `<div class="sm-dossier-meta">${metaBits.join('')}</div>` : ''}
            ${sheets ? `<div class="sm-dossier-meta" style="margin-top:8px;">${sheets}</div>` : ''}
        `;
    }

    function fieldHTML(label, value, full) {
        if (value == null || value === '') return '';
        return `<div class="sm-dossier-field${full ? ' full' : ''}">
            <div class="sm-dossier-field-label">${escHTML(label)}</div>
            <div class="sm-dossier-field-value">${escHTML(String(value))}</div>
        </div>`;
    }

    function renderFicha(data) {
        const td = data.typeData || {};
        const fields = [];
        const T = (v) => v && String(v).trim();

        if (data.type === 'character') {
            if (T(td.fullName)) fields.push(fieldHTML('Nome completo', td.fullName));
            if (T(td.age)) fields.push(fieldHTML('Idade', td.age));
            if (T(td.role)) fields.push(fieldHTML('Papel', td.role));
            if (T(td.want)) fields.push(fieldHTML('Desejo externo (want)', td.want, true));
            if (T(td.need)) fields.push(fieldHTML('Necessidade interna (need)', td.need, true));
            if (T(td.arc)) fields.push(fieldHTML('Arco de transformação', td.arc, true));
            if (T(td.conflictValue)) fields.push(fieldHTML('Valor em conflito', td.conflictValue, true));
            if (T(td.firstAppearance)) fields.push(fieldHTML('Primeira aparição', td.firstAppearance));
            if (T(td.lastAppearance)) fields.push(fieldHTML('Última aparição', td.lastAppearance));
        } else if (data.type === 'location') {
            if (T(td.era)) fields.push(fieldHTML('Época / período', td.era));
            if (T(td.climate)) fields.push(fieldHTML('Clima', td.climate));
            if (T(td.atmosphere)) fields.push(fieldHTML('Atmosfera', td.atmosphere, true));
            if (T(td.geography)) fields.push(fieldHTML('Geografia / descrição', td.geography, true));
            if (T(td.significance)) fields.push(fieldHTML('Significado na história', td.significance, true));
            if (T(td.environmentPressures)) fields.push(fieldHTML('Pressões do ambiente', td.environmentPressures, true));
        } else if (data.type === 'object') {
            if (T(td.category)) fields.push(fieldHTML('Categoria', td.category));
            if (T(td.user)) fields.push(fieldHTML('Usuário', td.user));
            if (T(td.originalOwner)) fields.push(fieldHTML('Dono / criador original', td.originalOwner));
            if (T(td.status)) fields.push(fieldHTML('Estado atual', td.status));
            if (T(td.currentLocation)) fields.push(fieldHTML('Localização atual', td.currentLocation));
            if (T(td.dramaticFunction)) fields.push(fieldHTML('Função dramática', td.dramaticFunction, true));
            if (T(td.description)) fields.push(fieldHTML('Aparência', td.description, true));
            if (T(td.origin)) fields.push(fieldHTML('Origem e história', td.origin, true));
            if (T(td.properties)) fields.push(fieldHTML('Propriedades e regras', td.properties, true));
            if (T(td.cost)) fields.push(fieldHTML('Custo de usar', td.cost));
            if (T(td.symbolicMeaning)) fields.push(fieldHTML('Significado simbólico', td.symbolicMeaning, true));
            if (T(td.valueCharged)) fields.push(fieldHTML('Valor que carrega', td.valueCharged));
            if (T(td.chargeStart) || T(td.chargeEnd)) {
                fields.push(fieldHTML('Carga do valor', `${td.chargeStart || '—'} → ${td.chargeEnd || '—'}`));
            }
            if (T(td.expectation)) fields.push(fieldHTML('Expectativa', td.expectation));
            if (T(td.reality)) fields.push(fieldHTML('Realidade', td.reality));
            if (T(td.plant)) fields.push(fieldHTML('Plantio', td.plant));
            if (T(td.payoff)) fields.push(fieldHTML('Colheita', td.payoff));
        } else if (data.type === 'theme') {
            if (T(td.statement)) fields.push(fieldHTML('Declaração do tema', td.statement, true));
            if (T(td.coreValue)) fields.push(fieldHTML('Valor central', td.coreValue));
            if (T(td.motifs)) fields.push(fieldHTML('Motivos recorrentes', td.motifs));
            if (T(td.symbolism)) fields.push(fieldHTML('Simbolismo', td.symbolism, true));
            if (T(td.examples)) fields.push(fieldHTML('Exemplos na história', td.examples, true));
        } else if (data.type === 'timeline') {
            if (T(td.year)) fields.push(fieldHTML('Ano', td.year));
            if (T(td.location)) fields.push(fieldHTML('Local', td.location));
            if (T(td.category)) fields.push(fieldHTML('Categoria', td.category));
            if (T(td.characters)) fields.push(fieldHTML('Personagens presentes', td.characters, true));
        } else if (data.type === 'event') {
            if (T(td.eventType)) fields.push(fieldHTML('Tipo de evento', td.eventType));
            if (T(td.objective)) fields.push(fieldHTML('Objetivo', td.objective, true));
            if (T(td.obstacle)) fields.push(fieldHTML('Obstáculo', td.obstacle, true));
            if (T(td.outcome)) fields.push(fieldHTML('Resultado', td.outcome, true));
            if (T(td.stakes)) fields.push(fieldHTML('Apostas', td.stakes, true));
            if (T(td.consequences)) fields.push(fieldHTML('Consequências', td.consequences, true));
        }

        if (T(data.pov)) fields.push(fieldHTML('POV', data.pov));
        if (T(data.content)) fields.push(fieldHTML('Notas', data.content, true));

        // Archetype for character
        if (data.type === 'character' && T(td.dominantArchetype)) {
            const archName = td.dominantArchetype;
            const archInfo = typeof getArchetypeInfo === 'function' ? getArchetypeInfo(archName) : null;
            if (archInfo) {
                fields.push(`
                    <div class="sm-dossier-archetype">
                        <div class="sm-dossier-archetype-title">🎭 Arquétipo dominante: ${escHTML(archInfo.name)}</div>
                        <div class="sm-dossier-archetype-desc">${escHTML(archInfo.desc || '')}</div>
                        <div class="sm-dossier-archetype-grid">
                            ${archInfo.desire ? `<div><b>Desejo:</b> <span>${escHTML(archInfo.desire)}</span></div>` : ''}
                            ${archInfo.fear ? `<div><b>Medo:</b> <span>${escHTML(archInfo.fear)}</span></div>` : ''}
                            ${archInfo.gift ? `<div><b>Dom:</b> <span>${escHTML(archInfo.gift)}</span></div>` : ''}
                            ${archInfo.shadow ? `<div><b>Sombra:</b> <span>${escHTML(archInfo.shadow)}</span></div>` : ''}
                        </div>
                    </div>
                `);
            } else {
                fields.push(fieldHTML('Arquétipo dominante', archName));
            }
        }

        // Big five for character
        if (data.type === 'character' && td.bigFive && typeof BIG_FIVE_TRAITS !== 'undefined') {
            const hasAny = BIG_FIVE_TRAITS.some(t => typeof td.bigFive[t.key] === 'number' && td.bigFive[t.key] !== 3);
            if (hasAny) {
                let bars = '';
                BIG_FIVE_TRAITS.forEach(t => {
                    const v = typeof td.bigFive[t.key] === 'number' ? td.bigFive[t.key] : 3;
                    const cells = [];
                    for (let i = 1; i <= 5; i++) {
                        cells.push(`<span class="sm-dossier-bigfive-bar" style="background:${i <= v ? t.color : '#e2e8f0'};"></span>`);
                    }
                    bars += `<div class="sm-dossier-bigfive-row">
                        <span class="sm-dossier-bigfive-label">${escHTML(t.short)}</span>
                        <div class="sm-dossier-bigfive-bars">${cells.join('')}</div>
                        <span style="color:${t.color};font-weight:700;font-size:10.5px;margin-left:6px;">${v}</span>
                    </div>`;
                });
                fields.push(`<div class="sm-dossier-bigfive">
                    <div class="sm-dossier-bigfive-title">📊 Traços de Personalidade (Big Five)</div>
                    ${bars}
                </div>`);
            }
        }

        if (fields.length === 0) {
            return '';
        }

        return `<div class="sm-dossier-section">
            <div class="sm-dossier-section-title">
                <i class="fa-solid fa-id-card"></i>
                <span>Ficha completa</span>
            </div>
            <div class="sm-dossier-fiche">${fields.join('')}</div>
        </div>`;
    }

    function relationIcon(type) {
        if (typeof RELATION_TYPES !== 'undefined' && RELATION_TYPES[type]) {
            return RELATION_TYPES[type].icon || '•';
        }
        return '•';
    }
    function relationLabel(type) {
        if (typeof RELATION_TYPES !== 'undefined' && RELATION_TYPES[type]) {
            return RELATION_TYPES[type].label || type;
        }
        return type;
    }
    function relationColor(type) {
        if (typeof RELATION_TYPES !== 'undefined' && RELATION_TYPES[type]) {
            return RELATION_TYPES[type].color || '#94a3b8';
        }
        return '#94a3b8';
    }

    function renderRelations(relations) {
        if (!relations || relations.length === 0) return '';
        const items = relations.map(r => {
            const td = r.other.type && typeof NODE_TYPES !== 'undefined' ? NODE_TYPES[r.other.type] : null;
            const otherIcon = td && typeof renderIcon === 'function' ? renderIcon(td.icon) : (td ? td.icon : '');
            const color = relationColor(r.type);
            const label = relationLabel(r.type);
            const dirArrow = r.direction === 'out' ? '→' : '←';
            const intensity = Math.max(1, Math.min(5, r.intensity || 3));
            const stars = '●'.repeat(intensity);
            return `<div class="sm-dossier-item" data-relation-to="${escHTML(r.other.id)}">
                <span class="sm-dossier-item-icon" style="color:${color}">${relationIcon(r.type)}</span>
                <div class="sm-dossier-item-body">
                    <div class="sm-dossier-item-title">${otherIcon} ${escHTML(r.other.title || 'Sem título')}</div>
                    <div class="sm-dossier-item-meta">${dirArrow} ${escHTML(label)} · <span style="color:${color}">${stars}</span>${r.label ? ' · ' + escHTML(r.label) : ''}</div>
                </div>
                <div class="sm-dossier-item-actions">
                    <button class="sm-dossier-item-btn" data-sm-dossier-go="${escHTML(r.other.id)}" title="Abrir entidade">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </button>
                </div>
            </div>`;
        }).join('');

        return `<div class="sm-dossier-section">
            <div class="sm-dossier-section-title">
                <i class="fa-solid fa-diagram-project"></i>
                <span>Relações</span>
                <span class="sm-dossier-count">${relations.length}</span>
            </div>
            <div class="sm-dossier-list">${items}</div>
        </div>`;
    }

    function renderSkills(skills) {
        if (!skills || skills.length === 0) return '';
        // Agrupa por tipo
        const byType = new Map();
        skills.forEach(sk => {
            const type = sk.type || 'physical';
            if (!byType.has(type)) byType.set(type, []);
            byType.get(type).push(sk);
        });
        let items = '';
        byType.forEach((list, type) => {
            const typeDef = typeof SKILL_TYPES !== 'undefined' ? SKILL_TYPES.find(t => t.id === type) : null;
            const color = typeDef ? typeDef.color : '#94a3b8';
            const icon = typeDef ? typeDef.icon : '⭐';
            const label = typeDef ? typeDef.label : type;
            items += `<div class="sm-dossier-group">
                <span>${typeof renderIcon === 'function' ? renderIcon(icon) : icon} ${escHTML(label)}</span>
                <span class="sm-dossier-group-count">${list.length}</span>
            </div>`;
            list.forEach(sk => {
                const rank = `${sk.rank || 0}/${sk.maxRank || 1}`;
                items += `<div class="sm-dossier-item">
                    <span class="sm-dossier-item-icon" style="color:${color}">${typeof renderIcon === 'function' ? renderIcon(icon) : icon}</span>
                    <div class="sm-dossier-item-body">
                        <div class="sm-dossier-item-title">${escHTML(sk.name || 'Sem nome')}</div>
                        <div class="sm-dossier-item-meta">Rank ${escHTML(rank)}${sk.costs ? ' · ' + escHTML(String(sk.costs).slice(0, 80)) : ''}</div>
                    </div>
                </div>`;
            });
        });

        return `<div class="sm-dossier-section">
            <div class="sm-dossier-section-title">
                <i class="fa-solid fa-sitemap"></i>
                <span>Habilidades</span>
                <span class="sm-dossier-count">${skills.length}</span>
            </div>
            <div class="sm-dossier-list">${items}</div>
        </div>`;
    }

    function renderObjects(objects) {
        if (!objects || objects.length === 0) return '';
        const items = objects.map(o => {
            const td = NODE_TYPES?.object || null;
            const icon = td && typeof renderIcon === 'function' ? renderIcon(td.icon) : '🏺';
            return `<div class="sm-dossier-item" data-sm-dossier-go="${escHTML(o.node.entityId || o.node.id)}">
                <span class="sm-dossier-item-icon">${icon}</span>
                <div class="sm-dossier-item-body">
                    <div class="sm-dossier-item-title">${escHTML(o.node.title || 'Sem título')}</div>
                    <div class="sm-dossier-item-meta">${escHTML(o.kind)}${o.sheet && o.sheet.id !== (mindMapData?.id) ? ' · ' + escHTML(o.sheet.name) : ''}</div>
                </div>
                <div class="sm-dossier-item-actions">
                    <button class="sm-dossier-item-btn" title="Abrir"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
                </div>
            </div>`;
        }).join('');

        return `<div class="sm-dossier-section">
            <div class="sm-dossier-section-title">
                <i class="fa-solid fa-gem"></i>
                <span>Objetos</span>
                <span class="sm-dossier-count">${objects.length}</span>
            </div>
            <div class="sm-dossier-list">${items}</div>
        </div>`;
    }

    function renderMentions(mentions, currentSheetId) {
        if (!mentions || mentions.length === 0) {
            return `<div class="sm-dossier-section">
                <div class="sm-dossier-section-title">
                    <i class="fa-solid fa-film"></i>
                    <span>Aparições e menções</span>
                    <span class="sm-dossier-count">0</span>
                </div>
                <div class="sm-dossier-empty">Nenhuma aparição encontrada ainda.</div>
            </div>`;
        }

        // Agrupa por aba
        const bySheet = new Map();
        mentions.forEach(m => {
            const sid = m.sheet.id;
            if (!bySheet.has(sid)) bySheet.set(sid, { sheet: m.sheet, items: [] });
            bySheet.get(sid).items.push(m);
        });

        let content = '';
        bySheet.forEach(({ sheet, items }) => {
            // Ordena por y (proxy de ordem visual) ou ordem do array
            items.sort((a, b) => (a.node.y || 0) - (b.node.y || 0));

            const sheetTag = sheet.id !== currentSheetId
                ? `<span class="sm-dossier-sheet-tag">${escHTML(sheet.name)}</span>`
                : '';

            content += `<div class="sm-dossier-group">
                <span>📁 ${escHTML(sheet.name)}</span>
                <span class="sm-dossier-group-count">${items.length}</span>
            </div>`;

            items.forEach(m => {
                const node = m.node;
                const td = node.type && typeof NODE_TYPES !== 'undefined' ? NODE_TYPES[node.type] : null;
                const icon = td && typeof renderIcon === 'function' ? renderIcon(td.icon) : (td ? td.icon : '📄');
                const nodeTargetId = node.entityId || node.id;

                const viaBits = (m.via || []).map(v =>
                    `<span style="font-size:9.5px;background:#f1f5f9;color:#64748b;padding:1px 6px;border-radius:999px;margin-right:3px;">${escHTML(v.label)}</span>`
                ).join('');

                const referenceLabel = m.kind === 'reference' ? 'nó próprio' : '';

                content += `<div class="sm-dossier-item" data-sm-dossier-go="${escHTML(nodeTargetId)}">
                    <span class="sm-dossier-item-icon">${icon}</span>
                    <div class="sm-dossier-item-body">
                        <div class="sm-dossier-item-title">${escHTML(node.title || 'Sem título')}</div>
                        <div class="sm-dossier-item-meta">${viaBits}${referenceLabel ? `<span style="font-size:9.5px;background:#dcfce7;color:#166534;padding:1px 6px;border-radius:999px;">${referenceLabel}</span>` : ''}</div>
                    </div>
                    ${sheetTag}
                </div>`;
            });
        });

        return `<div class="sm-dossier-section">
            <div class="sm-dossier-section-title">
                <i class="fa-solid fa-film"></i>
                <span>Aparições e menções</span>
                <span class="sm-dossier-count">${mentions.length}</span>
            </div>
            <div class="sm-dossier-list">${content}</div>
        </div>`;
    }

    /* ============================================================
       RENDER COMPLETO
       ============================================================ */
    function renderDossier(target) {
        if (!target || !target.data) return;
        const data = target.data;

        // Sheets onde a entidade aparece
        const sheetsWithEntity = [];
        const sheets = (currentStory && currentStory.sheets) || (mindMapData ? [mindMapData] : []);
        sheets.forEach(sheet => {
            const found = (sheet.nodes || []).some(n =>
                (target.entityId && n.entityId === target.entityId) ||
                (target.nodeId && n.id === target.nodeId)
            );
            if (found) sheetsWithEntity.push(sheet);
        });

        // Header
        document.getElementById('sm-dossier-header-content').innerHTML = renderHeader(target, sheetsWithEntity);

        // Body
        const bodyEl = document.getElementById('sm-dossier-body');
        const sections = [];

        sections.push(renderFicha(data));

        if (target.entityId) {
            const relations = findRelations(target.entityId);
            sections.push(renderRelations(relations));

            if (data.type === 'character') {
                const skills = findSkills(target.entityId);
                sections.push(renderSkills(skills));

                const objects = findObjectsForCharacter(data, target.entityId);
                sections.push(renderObjects(objects));
            }
        }

        const mentions = findMentions(data, target.entityId);
        sections.push(renderMentions(mentions, mindMapData?.id));

        bodyEl.innerHTML = sections.filter(Boolean).join('');

        // Footer
        const footerLeft = document.getElementById('sm-dossier-footer-left');
        const otherSheets = sheets.filter(s => !sheetsWithEntity.some(x => x.id === s.id));
        let footerHTML = '';
        if (target.entityId && otherSheets.length > 0) {
            footerHTML += `<button class="sm-dossier-btn ghost" data-sm-dossier-add-sheet>
                <i class="fa-solid fa-plus"></i> Adicionar em outra aba
            </button>`;
        }
        footerLeft.innerHTML = footerHTML;

        // Handlers
        document.querySelectorAll('[data-sm-dossier-go]').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('[data-sm-dossier-go]').dataset.smDossierGo !== el.dataset.smDossierGo) return;
                const id = el.getAttribute('data-sm-dossier-go');
                if (!id) return;
                close();
                if (typeof jumpToNodeFromBible === 'function') {
                    jumpToNodeFromBible(id);
                }
            });
        });

        const addSheetBtn = document.querySelector('[data-sm-dossier-add-sheet]');
        if (addSheetBtn && target.entityId) {
            addSheetBtn.addEventListener('click', () => {
                if (typeof window.SM_addEntityToSheet !== 'function') {
                    toast('Recurso indisponível.', 'warn');
                    return;
                }
                // Pede a aba
                const list = otherSheets.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
                const ans = prompt(`Adicionar "${data.title}" em qual aba?\n\n${list}\n\nDigite o número:`, '1');
                if (ans === null) return;
                const n = parseInt(ans, 10);
                if (!n || n < 1 || n > otherSheets.length) return;
                window.SM_addEntityToSheet(target.entityId, otherSheets[n - 1].id);
                close();
            });
        }
    }

    /* ============================================================
       OPEN / CLOSE
       ============================================================ */
    function open(idOrNode) {
        injectCSS();
        buildModal();

        const target = resolveTarget(idOrNode);
        if (!target) {
            toast('Entidade não encontrada.', 'warn');
            return;
        }

        renderDossier(target);
        const modal = document.getElementById('sm-dossier-modal');
        if (modal) modal.classList.add('open');
    }

    function close() {
        const modal = document.getElementById('sm-dossier-modal');
        if (modal) modal.classList.remove('open');
    }

    window.SM_openEntityDossier = open;
    window.SM_closeEntityDossier = close;

    /* ============================================================
       TRIGGERS
       ============================================================ */

    // 1) Botão no inspetor (appended ao #type-fields-container)
    function installInspectorButton() {
        if (typeof window.renderTypeFields !== 'function') {
            setTimeout(installInspectorButton, 200);
            return;
        }
        if (window.renderTypeFields.__smDossier) return;

        const orig = window.renderTypeFields;
        window.renderTypeFields = function () {
            const result = orig.apply(this, arguments);
            try {
                const container = document.getElementById('type-fields-container');
                if (!container) return result;

                // Remove botão antigo
                const old = container.querySelector('#sm-dossier-trigger');
                if (old) old.remove();

                const id = document.getElementById('edit-node-id')?.value;
                const node = id && typeof getNode === 'function' ? getNode(id) : null;
                if (!node) return result;

                // Mostra se for entidade compartilhada OU tipo que pode virar entidade
                const isEntityType = node.type && ENTITY_TYPES.has(node.type);
                const hasEntity = !!node.entityId;

                if (!isEntityType && !hasEntity) return result;

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.id = 'sm-dossier-trigger';
                btn.style.cssText = 'width:100%;margin-top:10px;padding:10px 12px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:12px;font-weight:700;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 12px -2px rgba(99,102,241,.4);';
                btn.innerHTML = '<i class="fa-solid fa-id-card"></i> Ver dossiê completo';
                btn.addEventListener('click', () => {
                    open(node.entityId || node.id);
                });
                container.appendChild(btn);
            } catch (e) {
                console.warn('[Dossier] inspector button:', e);
            }
            return result;
        };
        window.renderTypeFields.__smDossier = true;
    }

    // 2) Ícone "📋" nas entradas da Bíblia
    function installBibleIcons() {
        if (typeof window.renderStoryBible !== 'function') {
            setTimeout(installBibleIcons, 200);
            return;
        }
        if (window.renderStoryBible.__smDossier) return;

        const orig = window.renderStoryBible;
        window.renderStoryBible = function () {
            const result = orig.apply(this, arguments);
            setTimeout(() => {
                document.querySelectorAll('#bible-modal .bible-entry').forEach(entry => {
                    if (entry.dataset.smDossierEnriched === '1') return;
                    const onclick = entry.getAttribute('onclick') || '';
                    const m = onclick.match(/jumpToNodeFromBible\('([^']+)'\)/);
                    if (!m) return;
                    entry.dataset.smDossierEnriched = '1';
                    entry.dataset.smNodeId = m[1];

                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.title = 'Ver dossiê completo';
                    btn.style.cssText = 'margin-left:6px;background:transparent;border:1px solid #c7d2fe;border-radius:5px;padding:1px 6px;font-size:10px;color:#4338ca;cursor:pointer;flex-shrink:0;';
                    btn.innerHTML = '<i class="fa-solid fa-id-card"></i>';
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const nid = entry.dataset.smNodeId;
                        if (!nid) return;
                        // Fecha bíblia, abre dossiê
                        if (typeof closeStoryBible === 'function') closeStoryBible();
                        open(nid);
                    });
                    entry.appendChild(btn);
                });
            }, 50);
            return result;
        };
        window.renderStoryBible.__smDossier = true;
    }

    // 3) Botão nos cards do Grafo de Menções
    function installMentionsIcons() {
        if (typeof window.openMentionsGraph !== 'function') {
            setTimeout(installMentionsIcons, 200);
            return;
        }
        if (window.openMentionsGraph.__smDossier) return;

        const orig = window.openMentionsGraph;
        window.openMentionsGraph = function () {
            const result = orig.apply(this, arguments);
            setTimeout(() => {
                document.querySelectorAll('#mentions-modal .mm-card').forEach(card => {
                    if (card.dataset.smDossierEnriched === '1') return;
                    const onclick = card.getAttribute('onclick') || '';
                    const m = onclick.match(/jumpToNodeFromBible\('([^']+)'\)/);
                    if (!m) return;
                    card.dataset.smDossierEnriched = '1';
                    card.dataset.smNodeId = m[1];

                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.title = 'Ver dossiê completo';
                    btn.style.cssText = 'position:absolute;top:8px;right:8px;background:#6366f1;color:#fff;border:none;border-radius:5px;width:22px;height:22px;font-size:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1;';
                    btn.innerHTML = '<i class="fa-solid fa-id-card"></i>';
                    card.style.position = 'relative';
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const nid = card.dataset.smNodeId;
                        if (!nid) return;
                        if (typeof closeMentionsGraph === 'function') closeMentionsGraph();
                        open(nid);
                    });
                    card.appendChild(btn);
                });
            }, 50);
            return result;
        };
        window.openMentionsGraph.__smDossier = true;
    }

    // 4) Atalho de teclado: Alt+Shift+D quando há exatamente 1 nó selecionado
    document.addEventListener('keydown', (e) => {
        if (!(e.altKey && e.shiftKey && e.code === 'KeyD')) return;
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        if (typeof selectedNodeIds === 'undefined' || selectedNodeIds.size !== 1) return;
        e.preventDefault(); e.stopPropagation();
        const id = Array.from(selectedNodeIds)[0];
        open(id);
    }, true);

    // ============================================================
    // INIT
    // ============================================================
    function waitForApp() {
        const start = Date.now();
        const check = () => {
            const ok = typeof window.getNode === 'function'
                    && typeof window.renderTypeFields === 'function'
                    && typeof window.renderStoryBible === 'function'
                    && typeof window.openMentionsGraph === 'function'
                    && typeof mindMapData !== 'undefined';
            if (ok || Date.now() - start > 15000) {
                installInspectorButton();
                installBibleIcons();
                installMentionsIcons();
            } else {
                setTimeout(check, 200);
            }
        };
        check();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { injectCSS(); waitForApp(); }, { once: true });
    } else {
        injectCSS();
        waitForApp();
    }
})();