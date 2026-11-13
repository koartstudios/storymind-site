/* ============================================================
   STORYMIND — ENTIDADES COMPARTILHADAS (v5)
   Correção definitiva para teia de relações e árvore de
   habilidades únicas por história.
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_SHARED_ENTITIES_LOADED) return;
    window.SM_SHARED_ENTITIES_LOADED = true;

    const ENTITY_TYPES = new Set(['character', 'location', 'object', 'theme', 'timeline', 'event']);
    const SHARED_FIELDS = ['title', 'content', 'type', 'typeData', 'pov', 'icons'];
    const ENTITY_PREFIX = 'ent-';

    // Para qual (história, aba) o registro compartilhado foi copiado por último.
    // Serve para nunca gravar de volta no registro dados de uma aba que acabou de ser trocada.
    let hydratedFor = { story: null, sheetId: null };

    /* ============================================================
       HELPERS
       ============================================================ */
    function deepClone(obj) {
        if (obj == null) return obj;
        if (typeof window.deepClone === 'function') { try { return window.deepClone(obj); } catch (_) {} }
        if (typeof structuredClone === 'function') { try { return structuredClone(obj); } catch (_) {} }
        return JSON.parse(JSON.stringify(obj));
    }
    function normalizeName(s) {
        if (typeof window.normalizeName === 'function') return window.normalizeName(s);
        return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    function escapeHTML(s) {
        if (typeof window.escapeHTML === 'function') return window.escapeHTML(s);
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
    function toast(msg, type) { if (typeof showToast === 'function') showToast(msg, type || 'info', 2400); }
    function newEntityId() { return ENTITY_PREFIX + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
    function fieldsEqual(a, b) {
        if (a === b) return true;
        if (a == null && b == null) return true;
        try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
    }
    function isEntityType(t) { return t && ENTITY_TYPES.has(t); }
    function extractShared(node) {
        const out = {};
        SHARED_FIELDS.forEach(f => { if (f in node) out[f] = deepClone(node[f]); });
        return out;
    }

    /* ============================================================
       ENTIDADE ↔ NÓ
       ============================================================ */
    function entityFromNode(node) {
        return {
            id: node.entityId,
            type: node.type,
            title: node.title,
            content: node.content || '',
            typeData: deepClone(node.typeData) || {},
            pov: node.pov || '',
            icons: deepClone(node.icons) || [],
            updatedAt: Date.now()
        };
    }
    function entityAsNode(ent) {
        return {
            id: ent.id, entityId: ent.id,
            type: ent.type, title: ent.title,
            content: ent.content || '',
            typeData: deepClone(ent.typeData) || {},
            pov: ent.pov || '', icons: deepClone(ent.icons) || [],
            parentId: null, x: 0, y: 0,
            color: 'white', collapsed: false, tension: 0, beatId: null,
            isVariant: false, variantOf: null, variantLabel: '',
            __virtual: true,
            __entitySnapshot: extractShared(ent)
        };
    }

    /* ============================================================
       >>> NOVO: NORMALIZE KEYS <<<
       Converte todos os ids de nodeId → entityId nas estruturas
       globais (entityRelations, skillTrees, relationWebPositions).
       Idempotente. Pode rodar sempre.
       ============================================================ */
    function normalizeEntityKeys(story) {
        if (!story) return { fixedRelations: 0, fixedSkillTrees: 0, fixedPositions: 0 };
        if (!story.entities) story.entities = {};
        if (!story.entityRelations) story.entityRelations = [];
        if (!story.skillTrees) story.skillTrees = {};
        if (!story.relationWebPositions) story.relationWebPositions = {};

        // Mapa nodeId → entityId (de TODAS as abas)
        const nodeIdToEntityId = new Map();
        (story.sheets || []).forEach(sheet => {
            (sheet.nodes || []).forEach(n => {
                if (n.entityId && n.id) nodeIdToEntityId.set(n.id, n.entityId);
            });
        });

        // Também aceita entidades que já usam o próprio id como chave
        Object.keys(story.entities).forEach(eid => {
            if (!nodeIdToEntityId.has(eid)) nodeIdToEntityId.set(eid, eid);
        });

        let fixedRelations = 0, fixedSkillTrees = 0, fixedPositions = 0;

        // 1) Relations: converter + deduplicar
        const seenRelKey = new Set();
        story.entityRelations = (story.entityRelations || []).map(r => {
            const newR = { ...r };
            const newFrom = nodeIdToEntityId.get(newR.from) || newR.from;
            const newTo   = nodeIdToEntityId.get(newR.to)   || newR.to;
            if (newFrom !== newR.from) fixedRelations++;
            if (newTo !== newR.to)     fixedRelations++;
            newR.from = newFrom;
            newR.to = newTo;
            return newR;
        }).filter(r => {
            if (!r.from || !r.to || r.from === r.to) return false;
            const key = `${r.from}|${r.to}|${r.type || ''}`;
            if (seenRelKey.has(key)) return false;
            seenRelKey.add(key);
            return true;
        });

        // 2) SkillTrees: converter chaves, mesclar duplicatas
        const normalizedTrees = {};
        Object.entries(story.skillTrees || {}).forEach(([key, tree]) => {
            const newKey = nodeIdToEntityId.get(key) || key;
            if (newKey !== key) fixedSkillTrees++;
            if (!normalizedTrees[newKey]) {
                normalizedTrees[newKey] = tree;
            } else {
                // Merge de skills únicas
                const existing = normalizedTrees[newKey];
                if (tree.skills && Array.isArray(tree.skills)) {
                    if (!existing.skills) existing.skills = [];
                    const ids = new Set(existing.skills.map(s => s.id));
                    tree.skills.forEach(sk => {
                        if (!ids.has(sk.id)) { existing.skills.push(sk); ids.add(sk.id); }
                    });
                }
            }
        });
        story.skillTrees = normalizedTrees;

        // 3) Posições da teia
        const normalizedPositions = {};
        Object.entries(story.relationWebPositions || {}).forEach(([key, pos]) => {
            const newKey = nodeIdToEntityId.get(key) || key;
            if (newKey !== key) fixedPositions++;
            if (!normalizedPositions[newKey]) normalizedPositions[newKey] = pos;
        });
        story.relationWebPositions = normalizedPositions;

        return { fixedRelations, fixedSkillTrees, fixedPositions };
    }

    /* ============================================================
       MIGRAÇÃO
       ============================================================ */
    function needsMigration(story) {
        if (!story) return false;
        return !story.__migratedToEntitiesV4 || !story.__sharedSyncV5;
    }

    // Depois da migração V5, as relações/árvores guardadas dentro de cada aba são só cópias velhas.
    // Limpa para que nunca ressuscitem algo que foi apagado.
    function purgeSheetCopies(story) {
        if (!story || !story.__sharedSyncV5) return;
        (story.sheets || []).forEach(sheet => {
            sheet.relations = [];
            sheet.skillTrees = {};
            sheet.relationWebPositions = {};
        });
    }

    function migrateStoryToEntities(story) {
        if (!story) return;
        if (!story.entities) story.entities = {};
        if (!story.entityRelations) story.entityRelations = [];
        if (!story.skillTrees) story.skillTrees = {};
        if (!story.relationWebPositions) story.relationWebPositions = {};

        const byKey = new Map();

        story.sheets.forEach(sheet => {
            (sheet.nodes || []).forEach(n => {
                if (!isEntityType(n.type) || n.isVariant) return;
                if (n.entityId && story.entities[n.entityId]) return;
                const key = n.type + '::' + normalizeName(n.title || '');
                let entityId = byKey.get(key);
                if (!entityId) {
                    const existing = Object.values(story.entities).find(e =>
                        e.type === n.type && normalizeName(e.title || '') === normalizeName(n.title || '')
                    );
                    if (existing) entityId = existing.id;
                    else {
                        entityId = n.entityId || newEntityId();
                        story.entities[entityId] = entityFromNode({ ...n, entityId });
                    }
                    byKey.set(key, entityId);
                }
                n.entityId = entityId;
                if (!n.__entitySnapshot) n.__entitySnapshot = extractShared(n);
            });
        });

        story.sheets.forEach(sheet => {
            (sheet.relations || []).forEach(r => {
                const fromNode = (sheet.nodes || []).find(n => n.id === r.from);
                const toNode = (sheet.nodes || []).find(n => n.id === r.to);
                const fromKey = fromNode?.entityId || fromNode?.id || (story.entities[r.from] ? r.from : null);
                const toKey = toNode?.entityId || toNode?.id || (story.entities[r.to] ? r.to : null);
                if (!fromKey || !toKey || fromKey === toKey) return;
                const already = story.entityRelations.some(er =>
                    er.from === fromKey && er.to === toKey && er.type === r.type
                );
                if (already) return;
                story.entityRelations.push({
                    id: r.id || ('rel-char-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
                    from: fromKey, to: toKey,
                    type: r.type || 'alianca',
                    label: r.label || '',
                    intensity: typeof r.intensity === 'number' ? r.intensity : 3,
                    directed: !!r.directed
                });
            });
            Object.entries(sheet.skillTrees || {}).forEach(([charNodeId, tree]) => {
                const charNode = (sheet.nodes || []).find(n => n.id === charNodeId);
                const charKey = charNode?.entityId || charNodeId;
                const countSk = t => Array.isArray(t && t.skills) ? t.skills.length : 0;
                if (!story.skillTrees[charKey] || countSk(tree) > countSk(story.skillTrees[charKey])) {
                    story.skillTrees[charKey] = deepClone(tree);
                }
            });
            Object.entries(sheet.relationWebPositions || {}).forEach(([nodeId, pos]) => {
                const node = (sheet.nodes || []).find(n => n.id === nodeId);
                const key = node?.entityId || nodeId;
                if (!story.relationWebPositions[key]) story.relationWebPositions[key] = pos;
            });
        });

        story.sheets.forEach(sheet => {
            sheet.relations = [];
            sheet.skillTrees = {};
            sheet.relationWebPositions = {};
        });

        story.__migratedToEntitiesV4 = true;
        story.__sharedSyncV5 = true;
        story.__migratedToEntitiesV3 = true;
        story.__migratedToEntities = true;
    }

    /* ============================================================
       ABSORVER/HIDRATAR
       ============================================================ */
    function absorbActiveToRegistry(opts) {
        opts = opts || {};
        if (!currentStory) return;
        if (!currentStory.entities) currentStory.entities = {};
        if (!mindMapData || !Array.isArray(mindMapData.nodes)) return;

        const force = !!opts.force;

        mindMapData.nodes.forEach(n => {
            if (!n.entityId) return;
            let ent = currentStory.entities[n.entityId];
            if (!ent) {
                currentStory.entities[n.entityId] = entityFromNode(n);
                n.__entitySnapshot = extractShared(n);
                return;
            }
            const snap = n.__entitySnapshot || {};
            SHARED_FIELDS.forEach(f => {
                if (!(f in n) && !(f in ent)) return;
                const nv = n[f], ev = ent[f];
                if (fieldsEqual(nv, ev)) return;
                if (force) { ent[f] = deepClone(nv); return; }
                if (snap[f] === undefined) { ent[f] = deepClone(nv); return; }
                if (!fieldsEqual(nv, snap[f])) ent[f] = deepClone(nv);
                else n[f] = deepClone(ev);
            });
            ent.updatedAt = Date.now();
            n.__entitySnapshot = extractShared(n);
        });

        // A aba ativa mudou desde a última cópia do registro? (o app troca de aba e salva logo em seguida,
        // com relações/árvores ainda vazias). Nesse caso o registro da história é a fonte de verdade:
        // copia DELE para a aba, em vez de gravar a aba por cima dele.
        const inSync = force || (hydratedFor.story === currentStory && hydratedFor.sheetId === mindMapData.id);
        if (!inSync) {
            if (currentStory.__sharedSyncV5) hydrateActiveFromRegistry();
            return;
        }

        // Mapa nodeId → entityId desta aba
        const nodeIdToEntityId = new Map();
        mindMapData.nodes.forEach(n => { if (n.entityId) nodeIdToEntityId.set(n.id, n.entityId); });

        // Relations
        currentStory.entityRelations = (mindMapData.relations || []).map(r => {
            const newR = deepClone(r);
            if (nodeIdToEntityId.has(newR.from)) newR.from = nodeIdToEntityId.get(newR.from);
            if (nodeIdToEntityId.has(newR.to)) newR.to = nodeIdToEntityId.get(newR.to);
            return newR;
        });

        // SkillTrees
        const convertedSkillTrees = {};
        Object.entries(mindMapData.skillTrees || {}).forEach(([charId, tree]) => {
            const key = nodeIdToEntityId.get(charId) || charId;
            convertedSkillTrees[key] = deepClone(tree);
        });
        currentStory.skillTrees = convertedSkillTrees;

        // Posições da teia: merge
        if (mindMapData.relationWebPositions) {
            const converted = {};
            Object.entries(mindMapData.relationWebPositions).forEach(([id, pos]) => {
                const key = nodeIdToEntityId.get(id) || id;
                converted[key] = pos;
            });
            currentStory.relationWebPositions = Object.assign(
                {}, currentStory.relationWebPositions || {}, converted
            );
        }
    }

    function hydrateActiveFromRegistry() {
        if (!currentStory || !mindMapData) return;
        if (!currentStory.entities) currentStory.entities = {};

        (mindMapData.nodes || []).forEach(n => {
            if (!n.entityId) return;
            const ent = currentStory.entities[n.entityId];
            if (!ent) return;
            SHARED_FIELDS.forEach(f => { if (f in ent) n[f] = deepClone(ent[f]); });
            n.__entitySnapshot = extractShared(n);
        });

        mindMapData.relations = deepClone(currentStory.entityRelations || []);
        mindMapData.skillTrees = deepClone(currentStory.skillTrees || {});
        mindMapData.relationWebPositions = deepClone(currentStory.relationWebPositions || {});
        hydratedFor = { story: currentStory, sheetId: mindMapData.id };
    }

    /* ============================================================
       ABRIR / ADICIONAR ENTIDADE
       ============================================================ */
    function openEntityInMap(entityId) {
        if (!currentStory?.entities?.[entityId]) return;
        const ent = currentStory.entities[entityId];
        const existing = mindMapData.nodes.find(n => n.entityId === entityId && !n.isVariant);
        if (existing) {
            if (typeof selectedNodeIds !== 'undefined') { selectedNodeIds.clear(); selectedNodeIds.add(existing.id); }
            if (typeof focusNodeInView === 'function') focusNodeInView(existing);
            if (typeof openInspectorFor === 'function') openInspectorFor(existing.id);
            if (typeof renderApp === 'function') renderApp();
            return;
        }
        const newId = typeof generateNodeId === 'function' ? generateNodeId() : 'node-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const cx = typeof CANVAS_CENTER_X === 'number' ? CANVAS_CENTER_X : 2600;
        const cy = typeof CANVAS_CENTER_Y === 'number' ? CANVAS_CENTER_Y : 2600;
        const newNode = {
            id: newId, entityId,
            title: ent.title, content: ent.content || '',
            type: ent.type, typeData: deepClone(ent.typeData) || {},
            pov: ent.pov || '', icons: deepClone(ent.icons) || [],
            parentId: null,
            x: cx + (Math.random() * 200 - 100),
            y: cy + (Math.random() * 200 - 100),
            color: 'white', collapsed: false, tension: 0, beatId: null,
            isVariant: false, variantOf: null, variantLabel: '',
            __entitySnapshot: extractShared(ent)
        };
        if (typeof pushHistory === 'function') pushHistory();
        mindMapData.nodes.push(newNode);
        if (typeof rebuildNodeIndex === 'function') rebuildNodeIndex();
        if (typeof invalidateStructure === 'function') invalidateStructure();
        if (typeof saveStoriesStorage === 'function') saveStoriesStorage();
        if (typeof selectedNodeIds !== 'undefined') { selectedNodeIds.clear(); selectedNodeIds.add(newId); }
        if (typeof focusNodeInView === 'function') focusNodeInView(newNode);
        if (typeof openInspectorFor === 'function') openInspectorFor(newId);
        if (typeof renderApp === 'function') renderApp();
        toast(`"${ent.title}" adicionado a esta aba.`, 'info');
    }

    function addEntityToSheet(entityId, sheetId) {
        const sheet = currentStory?.sheets?.find(s => s.id === sheetId);
        const ent = currentStory?.entities?.[entityId];
        if (!sheet || !ent) return;
        if ((sheet.nodes || []).some(n => n.entityId === entityId)) { toast('Essa entidade já está nesta aba.', 'info'); return; }
        const newId = typeof generateNodeId === 'function' ? generateNodeId() : 'node-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const cx = typeof CANVAS_CENTER_X === 'number' ? CANVAS_CENTER_X : 2600;
        const cy = typeof CANVAS_CENTER_Y === 'number' ? CANVAS_CENTER_Y : 2600;
        if (!sheet.nodes) sheet.nodes = [];
        sheet.nodes.push({
            id: newId, entityId,
            title: ent.title, content: ent.content || '',
            type: ent.type, typeData: deepClone(ent.typeData) || {},
            pov: ent.pov || '', icons: deepClone(ent.icons) || [],
            parentId: null,
            x: cx + (Math.random() * 200 - 100),
            y: cy + (Math.random() * 200 - 100),
            color: 'white', collapsed: false, tension: 0, beatId: null,
            isVariant: false, variantOf: null, variantLabel: '',
            __entitySnapshot: extractShared(ent)
        });
        if (typeof saveStoriesStorage === 'function') saveStoriesStorage();
        toast(`"${ent.title}" adicionada em "${sheet.name}".`, 'success');
    }

    function showAddToSheetPicker(entityId) {
        const others = currentStory.sheets.filter(s => s.id !== mindMapData.id);
        if (others.length === 0) { toast('Não há outras abas nesta história.', 'warn'); return; }
        const ent = currentStory.entities[entityId];
        if (!ent) return;
        const list = others.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
        const ans = prompt(`Adicionar "${ent.title}" em qual aba?\n\n${list}\n\nDigite o número:`, '1');
        if (ans === null) return;
        const n = parseInt(ans, 10);
        if (!n || n < 1 || n > others.length) { toast('Número inválido.', 'warn'); return; }
        addEntityToSheet(entityId, others[n - 1].id);
    }

    function showLinkExistingPicker() {
        const id = document.getElementById('edit-node-id')?.value;
        const node = id && typeof getNode === 'function' ? getNode(id) : null;
        if (!node || !isEntityType(node.type)) { toast('O nó atual não é de tipo compartilhável.', 'warn'); return; }
        const list = Object.values(currentStory.entities || {}).filter(e => e.type === node.type && e.id !== node.entityId);
        if (list.length === 0) { toast(`Nenhuma outra entidade do tipo "${node.type}" ainda.`, 'info'); return; }
        const options = list.map((e, i) => `${i + 1}. ${e.title}`).join('\n');
        const ans = prompt(`Vincular este nó a qual ${node.type}?\n\n${options}\n\nDigite o número:`, '1');
        if (ans === null) return;
        const n = parseInt(ans, 10);
        if (!n || n < 1 || n > list.length) { toast('Número inválido.', 'warn'); return; }
        linkNodeToEntity(list[n - 1].id);
    }

    function linkNodeToEntity(entityId) {
        const id = document.getElementById('edit-node-id')?.value;
        const node = id && typeof getNode === 'function' ? getNode(id) : null;
        const ent = currentStory.entities?.[entityId];
        if (!node || !ent) return;
        if (typeof pushHistory === 'function') pushHistory();
        if (node.entityId && node.entityId !== entityId) {
            const stillUsed = (currentStory.sheets || []).some(s => (s.nodes || []).some(n => n.entityId === node.entityId));
            if (!stillUsed) delete currentStory.entities[node.entityId];
        }
        node.entityId = entityId;
        SHARED_FIELDS.forEach(f => { if (f in ent) node[f] = deepClone(ent[f]); });
        node.__entitySnapshot = extractShared(node);
        if (typeof invalidateStructure === 'function') invalidateStructure();
        if (typeof saveStoriesStorage === 'function') saveStoriesStorage();
        if (typeof renderApp === 'function') renderApp();
        if (typeof openInspectorFor === 'function') openInspectorFor(node.id);
        toast(`Vinculado a "${ent.title}".`, 'success');
    }

    function unlinkEntity() {
        const id = document.getElementById('edit-node-id')?.value;
        const node = id && typeof getNode === 'function' ? getNode(id) : null;
        if (!node || !node.entityId) return;
        const ent = currentStory.entities?.[node.entityId];
        const title = ent?.title || node.title;
        if (!confirm(`Tornar este nó exclusivo desta aba?\n\n"${title}" deixará de ser compartilhado(a).`)) return;
        if (typeof pushHistory === 'function') pushHistory();
        node.entityId = null;
        delete node.__entitySnapshot;
        if (typeof invalidateStructure === 'function') invalidateStructure();
        if (typeof saveStoriesStorage === 'function') saveStoriesStorage();
        if (typeof renderApp === 'function') renderApp();
        if (typeof openInspectorFor === 'function') openInspectorFor(node.id);
        toast('Nó agora é exclusivo desta aba.', 'info');
    }

    /* ============================================================
       UI: seção no inspetor
       ============================================================ */
    function buildEntitySection(node) {
        if (!node || !node.entityId) return null;
        const ent = currentStory.entities?.[node.entityId];
        if (!ent) return null;
        const sheetsWithEntity = (currentStory.sheets || []).filter(s => (s.nodes || []).some(n => n.entityId === node.entityId));
        const div = document.createElement('div');
        div.id = 'sm-entity-section';
        div.style.cssText = 'margin-top:10px;padding:10px;background:#eef2ff;border:1px solid #a5b4fc;border-left:4px solid #6366f1;border-radius:8px;';
        div.innerHTML = `
            <div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#4338ca;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                <span>🌐</span><span>Entidade compartilhada</span>
            </div>
            <div style="font-size:11px;color:#475569;line-height:1.5;margin-bottom:8px;">
                "${escapeHTML(ent.title)}" aparece em <b>${sheetsWithEntity.length}</b> aba${sheetsWithEntity.length === 1 ? '' : 's'}:
                ${sheetsWithEntity.map(s => `<span style="display:inline-block;background:${s.id === mindMapData.id ? '#c7d2fe' : '#e0e7ff'};color:#3730a3;padding:1px 7px;border-radius:999px;font-size:10px;margin:1px 2px;">${escapeHTML(s.name)}</span>`).join('')}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button type="button" style="padding:5px 10px;border-radius:6px;border:1px solid #6366f1;background:#fff;color:#4338ca;font-size:11px;font-weight:600;cursor:pointer;" data-sm-entity-action="add-other-sheet">➕ Adicionar em outra aba</button>
                <button type="button" style="padding:5px 10px;border-radius:6px;border:1px solid #6366f1;background:#fff;color:#4338ca;font-size:11px;font-weight:600;cursor:pointer;" data-sm-entity-action="link-existing">📚 Vincular a outra existente</button>
                <button type="button" style="padding:5px 10px;border-radius:6px;border:1px solid #fca5a5;background:#fff;color:#dc2626;font-size:11px;font-weight:600;cursor:pointer;" data-sm-entity-action="unlink">🔓 Tornar exclusivo</button>
            </div>
        `;
        div.querySelector('[data-sm-entity-action="add-other-sheet"]').addEventListener('click', () => showAddToSheetPicker(node.entityId));
        div.querySelector('[data-sm-entity-action="link-existing"]').addEventListener('click', showLinkExistingPicker);
        div.querySelector('[data-sm-entity-action="unlink"]').addEventListener('click', unlinkEntity);
        return div;
    }

    /* ============================================================
       GRAFO DE MENÇÕES — badge "aba"
       ============================================================ */
    function findNodeSheet(nodeId) {
        for (const sheet of (currentStory?.sheets || [])) {
            if ((sheet.nodes || []).some(n => n.id === nodeId)) return { id: sheet.id, name: sheet.name };
        }
        return null;
    }
    function enrichMentionItems() {
        const container = document.getElementById('mentions-content');
        if (!container) return;
        const currentSheetId = mindMapData?.id;
        container.querySelectorAll('.mm-mention').forEach(el => {
            if (el.dataset.smSheetEnriched === '1') return;
            const onclick = el.getAttribute('onclick') || '';
            const m = onclick.match(/jumpToNodeFromBible\('([^']+)'\)/);
            if (!m) return;
            const sheet = findNodeSheet(m[1]);
            if (!sheet) return;
            el.dataset.smSheetEnriched = '1';
            const titleEl = el.querySelector('.mm-m-title');
            if (titleEl) {
                const base = titleEl.getAttribute('title') || titleEl.textContent || '';
                titleEl.setAttribute('title', `${base} · Aba: ${sheet.name}`);
            }
            if (sheet.id !== currentSheetId) {
                const badge = document.createElement('span');
                badge.textContent = sheet.name;
                badge.title = `Esta menção está em: "${sheet.name}". Clique para ir até a aba.`;
                badge.style.cssText = `margin-left:6px;font-size:9px;font-weight:800;padding:1px 7px;border-radius:999px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;flex-shrink:0;text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;`;
                el.appendChild(badge);
            }
        });
    }

    /* ============================================================
       HOOKS
       ============================================================ */
    function installHooks() {
        if (typeof window.saveStoriesStorage === 'function' && !window.saveStoriesStorage.__smSE) {
            const orig = window.saveStoriesStorage;
            window.saveStoriesStorage = function () {
                try { absorbActiveToRegistry(); } catch (e) { console.warn('[SE] absorb:', e); }
                return orig.apply(this, arguments);
            };
            window.saveStoriesStorage.__smSE = true;
        }

        if (typeof window.switchSheet === 'function' && !window.switchSheet.__smSE) {
            const orig = window.switchSheet;
            window.switchSheet = function () {
                try { absorbActiveToRegistry(); } catch (e) { console.warn('[SE] absorb:', e); }
                const result = orig.apply(this, arguments);
                try { hydrateActiveFromRegistry(); } catch (e) { console.warn('[SE] hydrate:', e); }
                return result;
            };
            window.switchSheet.__smSE = true;
        }

        if (typeof window.switchStory === 'function' && !window.switchStory.__smSE) {
            const orig = window.switchStory;
            window.switchStory = function () {
                const result = orig.apply(this, arguments);
                try {
                    if (currentStory) {
                        normalizeEntityKeys(currentStory);
                        if (needsMigration(currentStory)) migrateStoryToEntities(currentStory);
                        normalizeEntityKeys(currentStory);
                        purgeSheetCopies(currentStory);
                        hydrateActiveFromRegistry();
                        if (typeof saveStoriesStorage === 'function') saveStoriesStorage();
                        if (typeof renderApp === 'function') renderApp();
                    }
                } catch (e) { console.warn('[SE] migrate:', e); }
                return result;
            };
            window.switchStory.__smSE = true;
        }

        ['undo', 'redo'].forEach(fnName => {
            if (typeof window[fnName] !== 'function' || window[fnName].__smSE) return;
            const orig = window[fnName];
            window[fnName] = function () {
                const result = orig.apply(this, arguments);
                try { if (currentStory && mindMapData) absorbActiveToRegistry({ force: true }); }
                catch (e) { console.warn('[SE] force-absorb:', e); }
                return result;
            };
            window[fnName].__smSE = true;
        });

        if (typeof window.onNodeTypeChange === 'function' && !window.onNodeTypeChange.__smSE) {
            const orig = window.onNodeTypeChange;
            window.onNodeTypeChange = function (typeId) {
                const id = document.getElementById('edit-node-id')?.value;
                const result = orig.apply(this, arguments);
                const after = id && typeof getNode === 'function' ? getNode(id) : null;
                if (!after) return result;
                if (isEntityType(after.type)) {
                    if (!after.entityId) {
                        if (!currentStory.entities) currentStory.entities = {};
                        const eid = newEntityId();
                        after.entityId = eid;
                        currentStory.entities[eid] = entityFromNode({ ...after, entityId: eid });
                        after.__entitySnapshot = extractShared(after);
                    }
                } else {
                    if (after.entityId) {
                        const stillUsed = (currentStory.sheets || []).some(s => (s.nodes || []).some(n => n.entityId === after.entityId));
                        if (!stillUsed) delete currentStory.entities[after.entityId];
                        after.entityId = null;
                        delete after.__entitySnapshot;
                    }
                }
                if (typeof saveStoriesStorage === 'function') saveStoriesStorage();
                if (typeof renderTypeFields === 'function') renderTypeFields();
                return result;
            };
            window.onNodeTypeChange.__smSE = true;
        }

        if (typeof window.renderTypeFields === 'function' && !window.renderTypeFields.__smSE) {
            const orig = window.renderTypeFields;
            window.renderTypeFields = function () {
                const result = orig.apply(this, arguments);
                try {
                    const container = document.getElementById('type-fields-container');
                    if (!container) return result;
                    const old = container.querySelector('#sm-entity-section');
                    if (old) old.remove();
                    const id = document.getElementById('edit-node-id')?.value;
                    const node = id && typeof getNode === 'function' ? getNode(id) : null;
                    if (node && node.entityId) {
                        const section = buildEntitySection(node);
                        if (section) container.appendChild(section);
                    }
                } catch (e) { console.warn('[SE] inspector:', e); }
                return result;
            };
            window.renderTypeFields.__smSE = true;
        }

        if (typeof window.getNode === 'function' && !window.getNode.__smSE) {
            const orig = window.getNode;
            window.getNode = function (id) {
                const real = orig.call(this, id);
                if (real) return real;
                if (typeof id === 'string' && id.startsWith(ENTITY_PREFIX) && currentStory?.entities?.[id]) {
                    return entityAsNode(currentStory.entities[id]);
                }
                return null;
            };
            window.getNode.__smSE = true;
        }

        if (typeof window.getTitleIndex === 'function' && !window.getTitleIndex.__smSE) {
            window.getTitleIndex = function () {
                const map = new Map();
                const add = (key, id) => { if (key && id && !map.has(key)) map.set(key, id); };
                (mindMapData?.nodes || []).forEach(n => {
                    if (!n || n.isVariant) return;
                    add(normalizeName(n.title || ''), n.id);
                    if (n.type === 'character' && n.typeData?.fullName) add(normalizeName(n.typeData.fullName), n.id);
                });
                if (currentStory?.entities) {
                    Object.values(currentStory.entities).forEach(ent => {
                        add(normalizeName(ent.title || ''), ent.id);
                        if (ent.type === 'character' && ent.typeData?.fullName) add(normalizeName(ent.typeData.fullName), ent.id);
                    });
                }
                return map;
            };
            window.getTitleIndex.__smSE = true;
        }

        if (typeof window.getCharacterNodes === 'function' && !window.getCharacterNodes.__smSE) {
            const orig = window.getCharacterNodes;
            window.getCharacterNodes = function () {
                if (!currentStory?.entities) return orig.call(this);
                const out = [], seen = new Set();
                Object.values(currentStory.entities).forEach(ent => {
                    if (ent.type !== 'character') return;
                    seen.add(ent.id);
                    out.push(entityAsNode(ent));
                });
                orig.call(this).forEach(n => {
                    if (n.isVariant) return;
                    if (!n.entityId && !seen.has(n.id)) { out.push(n); seen.add(n.id); }
                });
                return out;
            };
            window.getCharacterNodes.__smSE = true;
        }

        if (typeof window.renderStoryBible === 'function' && !window.renderStoryBible.__smSE) {
            const orig = window.renderStoryBible;
            window.renderStoryBible = function () {
                if (!currentStory?.entities) return orig.apply(this, arguments);
                const existingIds = new Set((mindMapData.nodes || []).filter(n => n.entityId).map(n => n.entityId));
                const virtuals = [];
                Object.values(currentStory.entities).forEach(ent => {
                    if (existingIds.has(ent.id) || !isEntityType(ent.type)) return;
                    virtuals.push(entityAsNode(ent));
                });
                const added = virtuals.length;
                if (added > 0) mindMapData.nodes.push(...virtuals);
                let result;
                try { result = orig.apply(this, arguments); }
                finally {
                    if (added > 0) {
                        mindMapData.nodes.splice(mindMapData.nodes.length - added, added);
                        if (typeof rebuildNodeIndex === 'function') rebuildNodeIndex();
                    }
                }
                return result;
            };
            window.renderStoryBible.__smSE = true;
        }

        if (typeof window.getCharacterMentions === 'function' && !window.getCharacterMentions.__smSE) {
            const origAliases = typeof window.getCharacterAliases === 'function' ? window.getCharacterAliases : (n) => {
                const s = new Set(); if (n.title) s.add(n.title); if (n.typeData?.fullName) s.add(n.typeData.fullName); return Array.from(s);
            };
            window.getCharacterMentions = function () {
                if (!currentStory?.entities) return new Map();
                const characters = [], seen = new Set();
                Object.values(currentStory.entities).forEach(ent => {
                    if (ent.type !== 'character') return;
                    characters.push(entityAsNode(ent));
                    seen.add(ent.id);
                });
                (mindMapData.nodes || []).forEach(n => {
                    if (n.type !== 'character' || n.isVariant) return;
                    if (!n.entityId && !seen.has(n.id)) { characters.push(n); seen.add(n.id); }
                });
                const byAlias = new Map();
                characters.forEach(c => {
                    origAliases(c).forEach(a => {
                        const key = normalizeName(a);
                        if (!byAlias.has(key)) byAlias.set(key, []);
                        byAlias.get(key).push({ character: c, alias: a });
                    });
                });
                const mentionsByCharId = new Map();
                characters.forEach(c => mentionsByCharId.set(c.id, { character: c, aliases: origAliases(c), mentions: [] }));
                (currentStory.sheets || []).forEach(sheet => {
                    (sheet.nodes || []).forEach(n => {
                        if (n.isVariant) return;
                        const candidates = [];
                        if (n.typeData) {
                            if (n.typeData.characters) candidates.push({ raw: n.typeData.characters, source: 'characters' });
                            if (n.typeData.speaker) candidates.push({ raw: n.typeData.speaker, source: 'speaker' });
                            if (n.typeData.target) candidates.push({ raw: n.typeData.target, source: 'target' });
                            if (n.type === 'object') {
                                if (n.typeData.user) candidates.push({ raw: n.typeData.user, source: 'object-user' });
                                if (n.typeData.originalOwner) candidates.push({ raw: n.typeData.originalOwner, source: 'object-owner' });
                                if (n.typeData.currentLocation) candidates.push({ raw: n.typeData.currentLocation, source: 'object-location' });
                            }
                        }
                        if (n.type === 'object' && n.content) {
                            const re = /\[\[([^\[\]\n]{1,100})\]\]/g;
                            let m;
                            while ((m = re.exec(n.content)) !== null) candidates.push({ raw: m[1].trim(), source: 'object-link' });
                        }
                        candidates.forEach(({ raw, source }) => {
                            String(raw).split(/[,;·|]/).forEach(part => {
                                const name = part.trim();
                                if (!name) return;
                                const key = normalizeName(name);
                                if (!byAlias.has(key)) return;
                                byAlias.get(key).forEach(({ character }) => {
                                    const entry = mentionsByCharId.get(character.id);
                                    if (!entry) return;
                                    if (entry.mentions.some(mm => mm.node.id === n.id && mm.__sheetId === sheet.id)) return;
                                    entry.mentions.push({ node: n, source, raw: name, __sheetId: sheet.id, __sheetName: sheet.name });
                                });
                            });
                        });
                    });
                });
                return mentionsByCharId;
            };
            window.getCharacterMentions.__smSE = true;
        }

        if (typeof window.getObjectMentions === 'function' && !window.getObjectMentions.__smSE) {
            const origAliases = typeof window.getCharacterAliases === 'function' ? window.getCharacterAliases : (n) => {
                const s = new Set(); if (n.title) s.add(n.title); return Array.from(s);
            };
            window.getObjectMentions = function () {
                if (!currentStory?.entities) return [];
                const objects = [], chars = [];
                const seenObj = new Set(), seenChar = new Set();
                Object.values(currentStory.entities).forEach(ent => {
                    if (ent.type === 'object') { objects.push(entityAsNode(ent)); seenObj.add(ent.id); }
                    else if (ent.type === 'character') { chars.push(entityAsNode(ent)); seenChar.add(ent.id); }
                });
                (mindMapData.nodes || []).forEach(n => {
                    if (n.isVariant) return;
                    if (n.type === 'object' && !n.entityId && !seenObj.has(n.id)) { objects.push(n); seenObj.add(n.id); }
                    else if (n.type === 'character' && !n.entityId && !seenChar.has(n.id)) { chars.push(n); seenChar.add(n.id); }
                });
                const out = objects.map(obj => {
                    const keys = new Set(origAliases(obj).map(normalizeName));
                    const mentions = [];
                    (currentStory.sheets || []).forEach(sheet => {
                        (sheet.nodes || []).forEach(n => {
                            if (n.isVariant || n.id === obj.id) return;
                            let source = null;
                            if (n.typeData?.objects) {
                                if (String(n.typeData.objects).split(/[,;·|]/).some(x => keys.has(normalizeName(x)))) source = 'objects';
                            }
                            if (!source && n.content) {
                                const re = /\[\[([^\[\]\n]{1,100})\]\]/g;
                                let m;
                                while ((m = re.exec(n.content)) !== null) {
                                    if (keys.has(normalizeName(m[1]))) { source = 'link'; break; }
                                }
                            }
                            if (source) mentions.push({ node: n, source, __sheetId: sheet.id, __sheetName: sheet.name });
                        });
                    });
                    const users = [];
                    String((obj.typeData && obj.typeData.user) || '').split(/[,;·|]/).forEach(raw => {
                        const name = raw.trim();
                        if (!name) return;
                        const k = normalizeName(name);
                        const ch = chars.find(c => origAliases(c).some(a => normalizeName(a) === k)) || null;
                        users.push({ name, character: ch });
                    });
                    return { object: obj, mentions, users };
                });
                return out.sort((a, b) => b.mentions.length - a.mentions.length);
            };
            window.getObjectMentions.__smSE = true;
        }

        if (typeof window.jumpToNodeFromBible === 'function' && !window.jumpToNodeFromBible.__smSE) {
            const orig = window.jumpToNodeFromBible;
            function closeAllModals() {
                try { if (typeof closeStoryBible === 'function') closeStoryBible(); } catch (_) {}
                try { if (typeof closeMentionsGraph === 'function') closeMentionsGraph(); } catch (_) {}
            }
            window.jumpToNodeFromBible = function (nodeId) {
                if (typeof nodeId === 'string' && nodeId.startsWith(ENTITY_PREFIX) && currentStory?.entities?.[nodeId]) {
                    closeAllModals(); openEntityInMap(nodeId); return;
                }
                const inCurrent = (mindMapData?.nodes || []).some(n => n.id === nodeId);
                if (inCurrent) { closeAllModals(); return orig.call(this, nodeId); }
                for (const sheet of (currentStory?.sheets || [])) {
                    if ((sheet.nodes || []).some(n => n.id === nodeId)) {
                        closeAllModals();
                        if (sheet.id === mindMapData.id) break;
                        if (typeof switchSheet === 'function') switchSheet(sheet.id);
                        setTimeout(() => {
                            const target = getNode(nodeId);
                            if (!target) return;
                            if (typeof selectedNodeIds !== 'undefined') { selectedNodeIds.clear(); selectedNodeIds.add(nodeId); }
                            if (typeof focusNodeInView === 'function') focusNodeInView(target);
                            if (typeof openInspectorFor === 'function') openInspectorFor(nodeId);
                            if (typeof renderApp === 'function') renderApp();
                        }, 150);
                        return;
                    }
                }
                return orig.call(this, nodeId);
            };
            window.jumpToNodeFromBible.__smSE = true;
        }

        if (typeof window.openMentionsGraph === 'function' && !window.openMentionsGraph.__smSE) {
            const orig = window.openMentionsGraph;
            window.openMentionsGraph = function () {
                const result = orig.apply(this, arguments);
                setTimeout(enrichMentionItems, 30);
                setTimeout(enrichMentionItems, 250);
                return result;
            };
            window.openMentionsGraph.__smSE = true;
        }

        // >>> GARANTIR hidratação antes de abrir teia/árvore <<<
        if (typeof window.openRelationWeb === 'function' && !window.openRelationWeb.__smSE) {
            const orig = window.openRelationWeb;
            window.openRelationWeb = function () {
                try { hydrateActiveFromRegistry(); } catch (_) {}
                return orig.apply(this, arguments);
            };
            window.openRelationWeb.__smSE = true;
        }
        if (typeof window.openSkillTree === 'function' && !window.openSkillTree.__smSE) {
            const orig = window.openSkillTree;
            window.openSkillTree = function () {
                try { hydrateActiveFromRegistry(); } catch (_) {}
                return orig.apply(this, arguments);
            };
            window.openSkillTree.__smSE = true;
        }
    }

    /* ============================================================
       INIT
       ============================================================ */
    function waitForApp() {
        return new Promise(resolve => {
            const start = Date.now();
            const check = () => {
                const ok = typeof window.getNode === 'function'
                        && typeof window.saveStoriesStorage === 'function'
                        && typeof window.switchSheet === 'function'
                        && typeof mindMapData !== 'undefined';
                if (ok || Date.now() - start > 15000) resolve();
                else setTimeout(check, 200);
            };
            check();
        });
    }

    async function init() {
        await waitForApp();
        installHooks();

        if (currentStory) {
            // 1) SEMPRE normaliza (corrige v2 leftovers mesmo com flag setada)
            const fixes = normalizeEntityKeys(currentStory);
            if (fixes.fixedRelations || fixes.fixedSkillTrees || fixes.fixedPositions) {
                console.log('[SE] Chaves normalizadas:', fixes);
            }

            // 2) Migração (só se ainda houver dados nos sheets)
            if (needsMigration(currentStory)) {
                try {
                    migrateStoryToEntities(currentStory);
                    normalizeEntityKeys(currentStory);
                    console.log('[SE] Migração v4 executada.');
                } catch (e) { console.warn('[SE] migrate:', e); }
            }

            // 3) Hidrata a aba ativa
            purgeSheetCopies(currentStory);
            hydrateActiveFromRegistry();
            if (typeof saveStoriesStorage === 'function') saveStoriesStorage();
            if (typeof renderApp === 'function') renderApp();

            console.log('[SE] v5 pronto. Relações:', (currentStory.entityRelations || []).length,
                        '| Árvores:', Object.keys(currentStory.skillTrees || {}).length);
        }
    }

    init();

    /* ============================================================
       API PÚBLICA
       ============================================================ */
    window.SM_listEntities = () => currentStory?.entities || {};
    window.SM_entityUsage = (entityId) => (currentStory?.sheets || [])
        .filter(s => (s.nodes || []).some(n => n.entityId === entityId))
        .map(s => s.name);
    window.SM_openEntityInMap = openEntityInMap;
    window.SM_addEntityToSheet = addEntityToSheet;
    window.SM_enrichMentions = enrichMentionItems;

    window.SM_fixSharedData = function () {
        if (!currentStory) return;
        const before = {
            rel: (currentStory.entityRelations || []).length,
            trees: Object.keys(currentStory.skillTrees || {}).length
        };
        currentStory.__migratedToEntitiesV4 = false;
        const fixes = normalizeEntityKeys(currentStory);
        if (needsMigration(currentStory)) migrateStoryToEntities(currentStory);
        normalizeEntityKeys(currentStory);
        hydrateActiveFromRegistry();
        if (typeof saveStoriesStorage === 'function') saveStoriesStorage();
        if (typeof renderApp === 'function') renderApp();
        toast(`Correção aplicada: ${fixes.fixedRelations} relação(ões), ${fixes.fixedSkillTrees} árvore(s), ${fixes.fixedPositions} posição(ões).`, 'success', 4000);
        window.SM_debugSharedState();
    };

    window.SM_debugSharedState = function () {
        if (!currentStory || !mindMapData) { console.log('Sem história carregada.'); return; }
        const entityIds = new Set(Object.keys(currentStory.entities || {}));
        const rel = currentStory.entityRelations || [];
        const orphanRelations = rel.filter(r => !entityIds.has(r.from) || !entityIds.has(r.to));
        const trees = currentStory.skillTrees || {};
        const orphanTrees = Object.keys(trees).filter(k => !entityIds.has(k));

        console.log('=== ESTADO GLOBAL ===');
        console.log('Entidades:', entityIds.size);
        console.log('Relações:', rel.length, '| Órfãs (fora do registro):', orphanRelations.length);
        if (orphanRelations.length > 0) console.warn('  Órfãs:', orphanRelations);
        console.log('Árvores:', Object.keys(trees).length, '| Órfãs:', orphanTrees.length);
        if (orphanTrees.length > 0) console.warn('  Chaves órfãs:', orphanTrees);
        console.log('Posições teia:', Object.keys(currentStory.relationWebPositions || {}).length);
        console.log('=== ABA ATIVA:', mindMapData.name, '===');
        console.log('relations.length:', (mindMapData.relations || []).length);
        console.log('skillTrees keys:', Object.keys(mindMapData.skillTrees || {}));
        console.log('Abas com relations ainda:', (currentStory.sheets || []).filter(s => (s.relations || []).length > 0).map(s => s.name));
        console.log('Abas com skillTrees ainda:', (currentStory.sheets || []).filter(s => Object.keys(s.skillTrees || {}).length > 0).map(s => s.name));
        console.log('Migração v4?', currentStory.__migratedToEntitiesV4 === true);
    };
})();