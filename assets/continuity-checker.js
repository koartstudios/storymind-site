/* ============================================================
   STORYMIND — CONTINUITY CHECKER (v2)
   ------------------------------------------------------------
   Detecta incoerências em todas as abas e permite marcar
   problemas como "intencionais" (persistidos por história).
   Issues ignoradas saem da lista E do score, mas podem ser
   restauradas a qualquer momento.

   Um único <script src="assets/continuity-checker.js">.
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_CONTINUITY_CHECKER_LOADED) return;
    window.SM_CONTINUITY_CHECKER_LOADED = true;

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
    function str(v) { return v == null ? '' : String(v).trim(); }

    /* ============================================================
       IGNORADOS (persistência por história)
       ============================================================ */
    function getIssueKey(issue) {
        const ids = (issue.nodeIds || []).slice().sort().join(',');
        return `${issue.ruleId || ''}|${ids}|${issue.title || ''}`;
    }
    function getStorageKey() {
        const storyKey = (typeof currentStoryKey !== 'undefined' && currentStoryKey) ? currentStoryKey : 'default';
        return 'sm_cc_ignored_' + storyKey;
    }
    function getIgnoredKeys() {
        try {
            const raw = localStorage.getItem(getStorageKey());
            if (!raw) return new Set();
            const arr = JSON.parse(raw);
            return new Set(Array.isArray(arr) ? arr : []);
        } catch (_) { return new Set(); }
    }
    function saveIgnoredKeys(set) {
        try { localStorage.setItem(getStorageKey(), JSON.stringify(Array.from(set))); }
        catch (e) { console.warn('[CC] save ignored:', e); }
    }
    function ignoreIssue(issue) {
        const set = getIgnoredKeys();
        set.add(getIssueKey(issue));
        saveIgnoredKeys(set);
    }
    function unignoreIssue(key) {
        const set = getIgnoredKeys();
        set.delete(key);
        saveIgnoredKeys(set);
    }
    function clearAllIgnored() {
        saveIgnoredKeys(new Set());
    }

    /* ============================================================
       COLETA
       ============================================================ */
    function collectContext() {
        const story = currentStory;
        if (!story) return null;
        const sheets = story.sheets || [];
        const entities = story.entities || {};
        const relations = story.entityRelations || [];
        const skillTrees = story.skillTrees || {};

        const allNodes = [];
        sheets.forEach(sheet => {
            (sheet.nodes || []).forEach(n => allNodes.push({ node: n, sheet }));
        });

        const charactersByAlias = new Map();
        Object.values(entities).forEach(ent => {
            if (ent.type !== 'character') return;
            const aliases = new Set();
            if (ent.title) aliases.add(normalizeName(ent.title));
            if (ent.typeData?.fullName) aliases.add(normalizeName(ent.typeData.fullName));
            aliases.forEach(a => {
                if (!charactersByAlias.has(a)) charactersByAlias.set(a, []);
                charactersByAlias.get(a).push(ent);
            });
        });
        allNodes.forEach(({ node }) => {
            if (node.type !== 'character' || node.isVariant) return;
            if (node.entityId && entities[node.entityId]) return;
            const aliases = new Set();
            if (node.title) aliases.add(normalizeName(node.title));
            if (node.typeData?.fullName) aliases.add(normalizeName(node.typeData.fullName));
            aliases.forEach(a => {
                if (!charactersByAlias.has(a)) charactersByAlias.set(a, []);
                if (!charactersByAlias.get(a).some(c => c.id === node.id)) charactersByAlias.get(a).push(node);
            });
        });

        const locationsByAlias = new Map();
        Object.values(entities).forEach(ent => {
            if (ent.type !== 'location') return;
            if (ent.title) {
                const k = normalizeName(ent.title);
                if (!locationsByAlias.has(k)) locationsByAlias.set(k, []);
                locationsByAlias.get(k).push(ent);
            }
        });
        allNodes.forEach(({ node }) => {
            if (node.type !== 'location' || node.isVariant) return;
            if (node.entityId && entities[node.entityId]) return;
            if (node.title) {
                const k = normalizeName(node.title);
                if (!locationsByAlias.has(k)) locationsByAlias.set(k, []);
                if (!locationsByAlias.get(k).some(l => l.id === node.id)) locationsByAlias.get(k).push(node);
            }
        });

        const characters = [], seenChar = new Set();
        Object.values(entities).forEach(ent => {
            if (ent.type === 'character') { characters.push(ent); seenChar.add(ent.id); }
        });
        allNodes.forEach(({ node }) => {
            if (node.type !== 'character' || node.isVariant) return;
            if (node.entityId && entities[node.entityId]) return;
            if (!seenChar.has(node.id)) { characters.push(node); seenChar.add(node.id); }
        });

        const objects = [], seenObj = new Set();
        Object.values(entities).forEach(ent => {
            if (ent.type === 'object') { objects.push(ent); seenObj.add(ent.id); }
        });
        allNodes.forEach(({ node }) => {
            if (node.type !== 'object' || node.isVariant) return;
            if (node.entityId && entities[node.entityId]) return;
            if (!seenObj.has(node.id)) { objects.push(node); seenObj.add(node.id); }
        });

        const scenes = [];
        allNodes.forEach(({ node, sheet }) => {
            if (node.type === 'scene' && !node.isVariant) scenes.push({ node, sheet });
        });

        return {
            story, sheets, entities, relations, skillTrees,
            allNodes, characters, objects, scenes,
            charactersByAlias, locationsByAlias
        };
    }

    function issue(opts) {
        return {
            severity: opts.severity || 'warning',
            category: opts.category || 'Geral',
            title: opts.title || 'Problema',
            message: opts.message || '',
            nodeIds: opts.nodeIds || [],
            entityIds: opts.entityIds || [],
            sheetId: opts.sheetId || null,
            ruleId: opts.ruleId || ''
        };
    }

    /* ============================================================
       REGRAS — REFERÊNCIAS QUEBRADAS
       ============================================================ */
    function checkBrokenReferences(ctx) {
        const issues = [];
        ctx.allNodes.forEach(({ node, sheet }) => {
            const td = node.typeData || {};

            if (node.type === 'scene' && str(td.characters)) {
                str(td.characters).split(/[,;·|]/).forEach(name => {
                    const clean = str(name);
                    if (!clean) return;
                    const key = normalizeName(clean);
                    if (!ctx.charactersByAlias.has(key)) {
                        issues.push(issue({
                            severity: 'warning', category: 'Referências',
                            title: 'Personagem citado sem ficha',
                            message: `A cena "${node.title}" cita "${clean}" no campo Personagens, mas nenhum nó de Personagem com esse nome existe. Corrija o nome na cena ou crie o personagem.`,
                            nodeIds: [node.entityId || node.id], sheetId: sheet.id,
                            ruleId: 'scene-char-not-registered'
                        }));
                    }
                });
            }

            if (node.type === 'dialogue') {
                ['speaker', 'target'].forEach(field => {
                    const val = str(td[field]);
                    if (!val) return;
                    const key = normalizeName(val);
                    if (!ctx.charactersByAlias.has(key)) {
                        const label = field === 'speaker' ? 'Falante' : 'Alvo';
                        issues.push(issue({
                            severity: 'warning', category: 'Referências',
                            title: `Diálogo com ${label.toLowerCase()} não cadastrado`,
                            message: `O diálogo "${node.title}" tem ${label.toLowerCase()} "${val}", mas nenhum personagem com esse nome existe no mapa.`,
                            nodeIds: [node.entityId || node.id], sheetId: sheet.id,
                            ruleId: `dialogue-${field}-not-registered`
                        }));
                    }
                });
            }

            if (node.type === 'scene' && str(td.location)) {
                const loc = str(td.location);
                if (!ctx.locationsByAlias.has(normalizeName(loc))) {
                    issues.push(issue({
                        severity: 'info', category: 'Referências',
                        title: 'Local citado sem ficha',
                        message: `A cena "${node.title}" acontece em "${loc}", mas nenhum nó de Cenário com esse nome existe.`,
                        nodeIds: [node.entityId || node.id], sheetId: sheet.id,
                        ruleId: 'scene-location-not-registered'
                    }));
                }
            }

            if (node.type === 'object') {
                ['user', 'originalOwner'].forEach(field => {
                    const val = str(td[field]);
                    if (!val) return;
                    str(val).split(/[,;·|]/).forEach(name => {
                        const clean = str(name);
                        if (!clean) return;
                        if (!ctx.charactersByAlias.has(normalizeName(clean))) {
                            const label = field === 'user' ? 'usuário' : 'dono original';
                            issues.push(issue({
                                severity: 'info', category: 'Referências',
                                title: `Objeto com ${label} não cadastrado`,
                                message: `O objeto "${node.title}" tem ${label} "${clean}", mas nenhum personagem com esse nome existe.`,
                                nodeIds: [node.entityId || node.id], sheetId: sheet.id,
                                ruleId: `object-${field}-not-registered`
                            }));
                        }
                    });
                });
            }

            if (str(node.pov)) {
                const pov = str(node.pov);
                if (!ctx.charactersByAlias.has(normalizeName(pov))) {
                    issues.push(issue({
                        severity: 'info', category: 'Referências',
                        title: 'POV sem personagem cadastrado',
                        message: `"${node.title}" tem POV "${pov}", mas nenhum personagem com esse nome existe. Pode ser narrador externo (intencional) ou personagem faltando.`,
                        nodeIds: [node.entityId || node.id], sheetId: sheet.id,
                        ruleId: 'pov-not-registered'
                    }));
                }
            }
        });
        return issues;
    }

    /* ============================================================
       REGRAS — PERSONAGENS
       ============================================================ */
    function checkCharacters(ctx) {
        const issues = [];
        const appearances = new Map();
        ctx.characters.forEach(c => appearances.set(c.id, 0));
        ctx.allNodes.forEach(({ node }) => {
            if (node.type !== 'scene' || node.isVariant) return;
            const td = node.typeData || {};
            const names = new Set();
            str(td.characters).split(/[,;·|]/).forEach(n => {
                const k = normalizeName(str(n));
                if (k) names.add(k);
            });
            names.forEach(k => {
                (ctx.charactersByAlias.get(k) || []).forEach(c => {
                    appearances.set(c.id, (appearances.get(c.id) || 0) + 1);
                });
            });
        });

        ctx.characters.forEach(c => {
            const td = c.typeData || {};
            const role = str(td.role).toLowerCase();
            const name = c.title || 'Sem título';
            const targetId = c.entityId || c.id;

            if (role.includes('protagonista') && !role.includes('co-') && !str(td.want)) {
                issues.push(issue({
                    severity: 'warning', category: 'Personagens',
                    title: 'Protagonista sem desejo externo',
                    message: `"${name}" é protagonista mas não tem "Desejo externo (want)" definido.`,
                    nodeIds: [targetId], ruleId: 'protagonist-no-want'
                }));
            }
            if (role.includes('protagonista') && !role.includes('co-') && !str(td.need)) {
                issues.push(issue({
                    severity: 'warning', category: 'Personagens',
                    title: 'Protagonista sem necessidade interna',
                    message: `"${name}" é protagonista mas não tem "Necessidade interna (need)" definida.`,
                    nodeIds: [targetId], ruleId: 'protagonist-no-need'
                }));
            }
            if (role.includes('protagonista') && !role.includes('co-') && !str(td.arc)) {
                issues.push(issue({
                    severity: 'warning', category: 'Personagens',
                    title: 'Protagonista sem arco',
                    message: `"${name}" é protagonista mas não tem "Arco de transformação" definido.`,
                    nodeIds: [targetId], ruleId: 'protagonist-no-arc'
                }));
            }
            if (role.includes('antagonista') && !str(td.conflictValue)) {
                issues.push(issue({
                    severity: 'warning', category: 'Personagens',
                    title: 'Antagonista sem valor em conflito',
                    message: `"${name}" é antagonista mas não tem "Valor em conflito" definido.`,
                    nodeIds: [targetId], ruleId: 'antagonist-no-conflict'
                }));
            }
            if (role && !role.includes('figurante') && !role.includes('secund')) {
                const nothingFilled = !str(td.want) && !str(td.need) && !str(td.arc) && !str(td.conflictValue);
                if (nothingFilled) {
                    issues.push(issue({
                        severity: 'info', category: 'Personagens',
                        title: 'Personagem sem motor dramático',
                        message: `"${name}" tem papel "${td.role}" mas nenhum dos campos de arco está preenchido.`,
                        nodeIds: [targetId], ruleId: 'character-no-drama'
                    }));
                }
            }
            if (appearances.get(c.id) === 0) {
                issues.push(issue({
                    severity: 'info', category: 'Personagens',
                    title: 'Personagem sem aparições',
                    message: `"${name}" existe no mapa, mas nunca é citado no campo "Personagens" de nenhuma cena.`,
                    nodeIds: [targetId], ruleId: 'character-no-appearances'
                }));
            }
        });

        const byKey = new Map();
        ctx.characters.forEach(c => {
            const key = normalizeName(c.title || '');
            if (!key) return;
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push(c);
        });
        byKey.forEach(list => {
            if (list.length < 2) return;
            issues.push(issue({
                severity: 'warning', category: 'Personagens',
                title: 'Personagens duplicados',
                message: `Existem ${list.length} personagens com nome "${list[0].title}". Provavelmente é uma duplicação involuntária.`,
                nodeIds: list.map(c => c.entityId || c.id),
                ruleId: 'duplicate-characters'
            }));
        });

        return issues;
    }

    /* ============================================================
       REGRAS — OBJETOS
       ============================================================ */
    function checkObjects(ctx) {
        const issues = [];
        const appearances = new Map();
        ctx.objects.forEach(o => appearances.set(o.id, 0));
        ctx.allNodes.forEach(({ node }) => {
            if (node.type !== 'scene' || node.isVariant) return;
            const td = node.typeData || {};
            const names = new Set();
            str(td.objects).split(/[,;·|]/).forEach(n => {
                const k = normalizeName(str(n));
                if (k) names.add(k);
            });
            names.forEach(k => {
                ctx.objects.forEach(o => {
                    if (normalizeName(o.title || '') === k) {
                        appearances.set(o.id, (appearances.get(o.id) || 0) + 1);
                    }
                });
            });
        });

        ctx.objects.forEach(o => {
            const td = o.typeData || {};
            const name = o.title || 'Sem título';
            const targetId = o.entityId || o.id;
            const status = str(td.status).toLowerCase();

            if (status.includes('destruído') && str(td.user)) {
                issues.push(issue({
                    severity: 'warning', category: 'Objetos',
                    title: 'Objeto destruído com usuário ativo',
                    message: `"${name}" está marcado como "Destruído", mas tem usuário "${td.user}".`,
                    nodeIds: [targetId], ruleId: 'object-destroyed-has-user'
                }));
            }
            if (status.includes('perdido') && str(td.currentLocation)) {
                issues.push(issue({
                    severity: 'warning', category: 'Objetos',
                    title: 'Objeto perdido com local definido',
                    message: `"${name}" está marcado como "Perdido", mas tem localização atual "${td.currentLocation}".`,
                    nodeIds: [targetId], ruleId: 'object-lost-has-location'
                }));
            }
            if (str(td.plant) && !str(td.payoff)) {
                issues.push(issue({
                    severity: 'warning', category: 'Objetos',
                    title: 'Objeto plantado sem colheita',
                    message: `"${name}" tem plantio "${td.plant}", mas nenhuma colheita registrada.`,
                    nodeIds: [targetId], ruleId: 'object-plant-no-payoff'
                }));
            }
            if (!str(td.plant) && str(td.payoff)) {
                issues.push(issue({
                    severity: 'warning', category: 'Objetos',
                    title: 'Objeto colhido sem plantio',
                    message: `"${name}" tem colheita "${td.payoff}", mas nenhum plantio registrado.`,
                    nodeIds: [targetId], ruleId: 'object-payoff-no-plant'
                }));
            }
            if (appearances.get(o.id) === 0) {
                issues.push(issue({
                    severity: 'info', category: 'Objetos',
                    title: 'Objeto sem aparições',
                    message: `"${name}" existe no mapa, mas não aparece em nenhuma cena.`,
                    nodeIds: [targetId], ruleId: 'object-no-appearances'
                }));
            }
            if (str(td.properties) && !str(td.cost)) {
                issues.push(issue({
                    severity: 'info', category: 'Objetos',
                    title: 'Objeto com poder, sem custo',
                    message: `"${name}" tem propriedades/regras definidas mas nenhum custo.`,
                    nodeIds: [targetId], ruleId: 'object-no-cost'
                }));
            }
        });
        return issues;
    }

    /* ============================================================
       REGRAS — CENAS
       ============================================================ */
    function checkScenes(ctx) {
        const issues = [];
        ctx.scenes.forEach(({ node, sheet }) => {
            const td = node.typeData || {};
            const name = node.title || 'Sem título';
            const targetId = node.entityId || node.id;

            if (!str(td.objective)) {
                issues.push(issue({
                    severity: 'warning', category: 'Cenas',
                    title: 'Cena sem objetivo',
                    message: `"${name}" não tem "Objetivo da cena".`,
                    nodeIds: [targetId], sheetId: sheet.id, ruleId: 'scene-no-objective'
                }));
            }
            if (!str(td.conflict)) {
                issues.push(issue({
                    severity: 'warning', category: 'Cenas',
                    title: 'Cena sem conflito',
                    message: `"${name}" não tem "Conflito / obstáculo".`,
                    nodeIds: [targetId], sheetId: sheet.id, ruleId: 'scene-no-conflict'
                }));
            }
            if (str(td.valueAtStake) && (!str(td.valueStart) || !str(td.valueEnd))) {
                issues.push(issue({
                    severity: 'warning', category: 'Cenas',
                    title: 'Valor em jogo sem virada',
                    message: `"${name}" declara valor "${td.valueAtStake}", mas não define carga inicial e/ou final.`,
                    nodeIds: [targetId], sheetId: sheet.id, ruleId: 'scene-value-no-shift'
                }));
            }
            if (str(td.valueStart) && str(td.valueEnd)) {
                const s = str(td.valueStart).replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
                const e = str(td.valueEnd).replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
                if (s === e) {
                    issues.push(issue({
                        severity: 'warning', category: 'Cenas',
                        title: 'Cena não vira o valor',
                        message: `"${name}" começa e termina com o valor na mesma carga.`,
                        nodeIds: [targetId], sheetId: sheet.id, ruleId: 'scene-value-static'
                    }));
                }
            }
            if (!str(node.pov)) {
                issues.push(issue({
                    severity: 'info', category: 'Cenas',
                    title: 'Cena sem POV',
                    message: `"${name}" não tem POV definido.`,
                    nodeIds: [targetId], sheetId: sheet.id, ruleId: 'scene-no-pov'
                }));
            }
            if (!str(td.characters)) {
                issues.push(issue({
                    severity: 'info', category: 'Cenas',
                    title: 'Cena sem personagens',
                    message: `"${name}" não lista personagens.`,
                    nodeIds: [targetId], sheetId: sheet.id, ruleId: 'scene-no-characters'
                }));
            }
            if (typeof node.tension !== 'number' || node.tension === 0) {
                issues.push(issue({
                    severity: 'info', category: 'Cenas',
                    title: 'Cena sem tensão',
                    message: `"${name}" não tem tensão dramática definida.`,
                    nodeIds: [targetId], sheetId: sheet.id, ruleId: 'scene-no-tension'
                }));
            }
        });
        return issues;
    }

    /* ============================================================
       REGRAS — ESTRUTURA
       ============================================================ */
    function checkStructure(ctx) {
        const issues = [];
        const fw = (typeof getCurrentFramework === 'function') ? getCurrentFramework() : null;
        if (fw) {
            const beatCounts = new Map();
            fw.beats.forEach(b => beatCounts.set(b.id, 0));
            ctx.allNodes.forEach(({ node }) => {
                if (node.isVariant) return;
                if (node.beatId && beatCounts.has(node.beatId)) {
                    beatCounts.set(node.beatId, beatCounts.get(node.beatId) + 1);
                }
            });
            fw.beats.forEach(b => {
                if (beatCounts.get(b.id) === 0) {
                    issues.push(issue({
                        severity: 'warning', category: 'Estrutura',
                        title: `Beat "${b.name}" vazio`,
                        message: `Nenhuma cena foi atribuída ao beat "${b.name}" do framework ${fw.name}.`,
                        nodeIds: [], ruleId: 'beat-empty'
                    }));
                }
            });
            ctx.allNodes.forEach(({ node, sheet }) => {
                if (node.isVariant) return;
                if (node.beatId && !fw.beats.some(b => b.id === node.beatId)) {
                    issues.push(issue({
                        severity: 'warning', category: 'Estrutura',
                        title: 'Beat inválido na cena',
                        message: `"${node.title}" está atribuído a um beat que não existe mais no framework ${fw.name}.`,
                        nodeIds: [node.entityId || node.id], sheetId: sheet.id,
                        ruleId: 'scene-invalid-beat'
                    }));
                }
            });
        }
        ctx.sheets.forEach(sheet => {
            const roots = (sheet.nodes || []).filter(n => !n.parentId && !n.isVariant);
            if (roots.length > 5) {
                issues.push(issue({
                    severity: 'info', category: 'Estrutura',
                    title: 'Muitas raízes soltas',
                    message: `A aba "${sheet.name}" tem ${roots.length} nós sem pai. Considere conectar alguns.`,
                    nodeIds: [], sheetId: sheet.id, ruleId: 'too-many-roots'
                }));
            }
        });
        return issues;
    }

    /* ============================================================
       REGRAS — TEMA
       ============================================================ */
    function checkThemes(ctx) {
        const issues = [];
        const themes = Object.values(ctx.entities).filter(e => e.type === 'theme');
        ctx.allNodes.forEach(({ node }) => {
            if (node.type === 'theme' && !node.isVariant) {
                if (node.entityId && ctx.entities[node.entityId]) return;
                if (!themes.some(t => t.id === node.id)) themes.push(node);
            }
        });
        themes.forEach(t => {
            const td = t.typeData || {};
            const name = t.title || 'Sem título';
            const targetId = t.entityId || t.id;
            const core = str(td.coreValue);
            if (core) {
                const hasScenes = ctx.scenes.some(({ node }) => {
                    const v = str(node.typeData?.valueAtStake).toLowerCase();
                    return v.includes(core.toLowerCase());
                });
                if (!hasScenes) {
                    issues.push(issue({
                        severity: 'info', category: 'Temas',
                        title: 'Tema não dramatizado',
                        message: `O tema "${name}" declara valor central "${core}", mas nenhuma cena tem esse valor em jogo.`,
                        nodeIds: [targetId], ruleId: 'theme-not-dramatized'
                    }));
                }
            }
        });
        return issues;
    }

    /* ============================================================
       ORQUESTRADOR
       ============================================================ */
    function runAllChecks() {
        const ctx = collectContext();
        if (!ctx) {
            return { issues: [], ignoredIssues: [], score: 100, counts: { error: 0, warning: 0, info: 0 }, ignoredCount: 0, totalNodes: 0 };
        }
        const all = []
            .concat(checkBrokenReferences(ctx))
            .concat(checkCharacters(ctx))
            .concat(checkObjects(ctx))
            .concat(checkScenes(ctx))
            .concat(checkStructure(ctx))
            .concat(checkThemes(ctx));

        // Dedup + atribui key
        const seen = new Set();
        const tagged = all.filter(i => {
            i.key = getIssueKey(i);
            const dedupKey = i.key;
            if (seen.has(dedupKey)) return false;
            seen.add(dedupKey);
            return true;
        });

        // Separa ignorados dos ativos
        const ignored = getIgnoredKeys();
        const active = tagged.filter(i => !ignored.has(i.key));
        const ignoredIssues = tagged.filter(i => ignored.has(i.key));

        const counts = { error: 0, warning: 0, info: 0 };
        active.forEach(i => counts[i.severity]++);

        const penalty = counts.error * 8 + counts.warning * 2 + counts.info * 0.5;
        const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

        return {
            issues: active,
            ignoredIssues,
            score,
            counts,
            ignoredCount: ignoredIssues.length,
            totalNodes: ctx.allNodes.length
        };
    }

    /* ============================================================
       CSS
       ============================================================ */
    function injectCSS() {
        if (document.getElementById('sm-cc-css')) return;
        const s = document.createElement('style');
        s.id = 'sm-cc-css';
        s.textContent = `
            #sm-cc-modal { position: fixed; inset: 0; z-index: 9997;
                background: rgba(15,23,42,.6);
                -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
                display: none; align-items: center; justify-content: center; padding: 20px; }
            #sm-cc-modal.open { display: flex; }
            .sm-cc-panel { background: #ffffff; width: 100%; max-width: 920px; max-height: 92vh;
                border-radius: 18px; box-shadow: 0 30px 60px -12px rgba(0,0,0,.4);
                overflow: hidden; display: flex; flex-direction: column;
                animation: sm-cc-in .2s cubic-bezier(.16,1,.3,1); }
            @keyframes sm-cc-in { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
            body.app-theme-dark .sm-cc-panel { background: #1e293b; }

            .sm-cc-header { padding: 18px 22px; border-bottom: 1px solid #e2e8f0;
                display: flex; align-items: center; justify-content: space-between; gap: 16px;
                background: linear-gradient(135deg, #eef2ff, #e0e7ff); flex-shrink: 0; }
            body.app-theme-dark .sm-cc-header { background: linear-gradient(135deg, #1e1b4b, #312e81); border-bottom-color: #334155; }
            .sm-cc-header-title { font-size: 18px; font-weight: 800; color: #4338ca; display: flex; align-items: center; gap: 10px; }
            body.app-theme-dark .sm-cc-header-title { color: #c7d2fe; }
            .sm-cc-header-sub { font-size: 12px; color: #6366f1; margin-top: 4px; }
            body.app-theme-dark .sm-cc-header-sub { color: #a5b4fc; }

            .sm-cc-score-wrap { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
            .sm-cc-score-circle { width: 78px; height: 78px; border-radius: 50%;
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                font-weight: 900; color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.15); }
            .sm-cc-score-num { font-size: 24px; line-height: 1; }
            .sm-cc-score-label { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; opacity: .9; margin-top: 2px; }
            .sm-cc-score-detail { font-size: 11px; color: #64748b; line-height: 1.6; }
            body.app-theme-dark .sm-cc-score-detail { color: #94a3b8; }
            .sm-cc-score-detail b { color: #475569; }
            body.app-theme-dark .sm-cc-score-detail b { color: #cbd5e1; }
            .sm-cc-sev-error { color: #dc2626; }
            .sm-cc-sev-warning { color: #d97706; }
            .sm-cc-sev-info { color: #0891b2; }

            .sm-cc-close { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
                border: none; border-radius: 8px; background: transparent; color: #6366f1; cursor: pointer; flex-shrink: 0; }
            .sm-cc-close:hover { background: rgba(99,102,241,.1); }
            body.app-theme-dark .sm-cc-close { color: #a5b4fc; }

            .sm-cc-filters { padding: 10px 22px; border-bottom: 1px solid #e2e8f0; background: #f8fafc;
                display: flex; flex-wrap: wrap; gap: 8px; align-items: center; flex-shrink: 0; }
            body.app-theme-dark .sm-cc-filters { background: #0f172a; border-bottom-color: #334155; }
            .sm-cc-filter-label { font-size: 10px; font-weight: 800; text-transform: uppercase;
                letter-spacing: .05em; color: #64748b; margin-right: 4px; }
            body.app-theme-dark .sm-cc-filter-label { color: #94a3b8; }
            .sm-cc-chip { padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 600;
                background: #fff; border: 1px solid #e2e8f0; color: #475569; cursor: pointer;
                transition: all .12s; display: inline-flex; align-items: center; gap: 5px; }
            .sm-cc-chip:hover { background: #eef2ff; border-color: #a5b4fc; }
            .sm-cc-chip.active { background: #6366f1; border-color: #6366f1; color: #fff; }
            .sm-cc-chip.active .sm-cc-chip-count { background: rgba(255,255,255,.25); color: #fff; }
            .sm-cc-chip-count { font-size: 10px; font-weight: 700; background: #f1f5f9;
                padding: 0 6px; border-radius: 999px; color: #475569; }
            .sm-cc-chip-ignored { border-color: #fcd34d; background: #fef3c7; color: #78350f; }
            .sm-cc-chip-ignored:hover { background: #fde68a; border-color: #f59e0b; }
            .sm-cc-chip-ignored.active { background: #d97706; border-color: #d97706; color: #fff; }
            .sm-cc-chip-ignored.active .sm-cc-chip-count { background: rgba(255,255,255,.25); color: #fff; }
            body.app-theme-dark .sm-cc-chip { background: #0f172a; border-color: #334155; color: #cbd5e1; }
            body.app-theme-dark .sm-cc-chip:hover { background: #312e81; }
            body.app-theme-dark .sm-cc-chip.active { background: #6366f1; border-color: #6366f1; color: #fff; }
            body.app-theme-dark .sm-cc-chip-count { background: #334155; color: #cbd5e1; }
            body.app-theme-dark .sm-cc-chip-ignored { background: #78350f; border-color: #92400e; color: #fef3c7; }
            body.app-theme-dark .sm-cc-chip-ignored:hover { background: #92400e; }
            body.app-theme-dark .sm-cc-chip-ignored.active { background: #d97706; border-color: #d97706; color: #fff; }
            .sm-cc-clear-ignored { padding: 4px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700;
                background: transparent; border: 1px solid #fca5a5; color: #dc2626; cursor: pointer; }
            .sm-cc-clear-ignored:hover { background: #fef2f2; }

            .sm-cc-body { flex: 1; overflow-y: auto; padding: 16px 22px; }
            .sm-cc-section { margin-bottom: 20px; }
            .sm-cc-section-title { font-size: 11px; font-weight: 800; text-transform: uppercase;
                letter-spacing: .06em; color: #6366f1; margin-bottom: 8px;
                display: flex; align-items: center; gap: 8px; padding-bottom: 6px;
                border-bottom: 1px solid #e2e8f0; }
            body.app-theme-dark .sm-cc-section-title { color: #a5b4fc; border-bottom-color: #334155; }
            .sm-cc-section-title .sm-cc-section-count { background: #eef2ff; color: #4338ca;
                padding: 1px 8px; border-radius: 999px; font-size: 10px; }
            body.app-theme-dark .sm-cc-section-title .sm-cc-section-count { background: #312e81; color: #c7d2fe; }

            .sm-cc-issue { display: flex; gap: 12px; padding: 12px;
                background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
                margin-bottom: 8px; border-left: 4px solid #94a3b8;
                transition: box-shadow .12s; }
            .sm-cc-issue:hover { box-shadow: 0 4px 12px -4px rgba(0,0,0,.1); }
            body.app-theme-dark .sm-cc-issue { background: #0f172a; border-color: #334155; }
            .sm-cc-issue.error { border-left-color: #dc2626; }
            .sm-cc-issue.warning { border-left-color: #d97706; }
            .sm-cc-issue.info { border-left-color: #0891b2; }
            .sm-cc-issue.is-ignored { opacity: 0.75; border-left-style: dashed; }

            .sm-cc-issue-icon { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
                border-radius: 8px; flex-shrink: 0; font-size: 13px; }
            .sm-cc-issue.error .sm-cc-issue-icon { background: #fef2f2; color: #dc2626; }
            .sm-cc-issue.warning .sm-cc-issue-icon { background: #fef3c7; color: #d97706; }
            .sm-cc-issue.info .sm-cc-issue-icon { background: #ecfeff; color: #0891b2; }
            body.app-theme-dark .sm-cc-issue.error .sm-cc-issue-icon { background: #450a0a; color: #fca5a5; }
            body.app-theme-dark .sm-cc-issue.warning .sm-cc-issue-icon { background: #422006; color: #fcd34d; }
            body.app-theme-dark .sm-cc-issue.info .sm-cc-issue-icon { background: #083344; color: #67e8f9; }

            .sm-cc-issue-body { flex: 1; min-width: 0; }
            .sm-cc-issue-title { font-size: 13px; font-weight: 700; color: #1e293b;
                line-height: 1.35; margin-bottom: 4px; }
            body.app-theme-dark .sm-cc-issue-title { color: #f1f5f9; }
            .sm-cc-issue-message { font-size: 12px; color: #475569; line-height: 1.55; }
            body.app-theme-dark .sm-cc-issue-message { color: #cbd5e1; }
            .sm-cc-issue-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
            .sm-cc-issue-btn { padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 600;
                background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe; cursor: pointer;
                display: inline-flex; align-items: center; gap: 4px; transition: all .12s; }
            .sm-cc-issue-btn:hover { background: #e0e7ff; border-color: #a5b4fc; }
            .sm-cc-issue-btn.confirm-btn { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
            .sm-cc-issue-btn.confirm-btn:hover { background: #d1fae5; border-color: #6ee7b7; }
            .sm-cc-issue-btn.restore-btn { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
            .sm-cc-issue-btn.restore-btn:hover { background: #fde68a; border-color: #f59e0b; }
            body.app-theme-dark .sm-cc-issue-btn { background: #312e81; color: #c7d2fe; border-color: #4338ca; }
            body.app-theme-dark .sm-cc-issue-btn:hover { background: #4338ca; color: #e0e7ff; }
            body.app-theme-dark .sm-cc-issue-btn.confirm-btn { background: #064e3b; color: #6ee7b7; border-color: #065f46; }
            body.app-theme-dark .sm-cc-issue-btn.confirm-btn:hover { background: #065f46; color: #d1fae5; }
            body.app-theme-dark .sm-cc-issue-btn.restore-btn { background: #78350f; color: #fef3c7; border-color: #92400e; }
            body.app-theme-dark .sm-cc-issue-btn.restore-btn:hover { background: #92400e; color: #fef3c7; }

            .sm-cc-empty { padding: 60px 20px; text-align: center; color: #64748b; }
            body.app-theme-dark .sm-cc-empty { color: #94a3b8; }
            .sm-cc-empty .sm-cc-empty-icon { font-size: 48px; color: #10b981; margin-bottom: 16px; }
            .sm-cc-empty .sm-cc-empty-icon.info { color: #f59e0b; }
            .sm-cc-empty-title { font-size: 18px; font-weight: 800; color: #059669; margin-bottom: 6px; }
            .sm-cc-empty-title.info { color: #d97706; }
            body.app-theme-dark .sm-cc-empty-title { color: #6ee7b7; }
            body.app-theme-dark .sm-cc-empty-title.info { color: #fcd34d; }
            .sm-cc-empty-message { font-size: 13px; line-height: 1.6; max-width: 500px; margin: 0 auto; }

            .sm-cc-footer { padding: 12px 22px; border-top: 1px solid #e2e8f0;
                display: flex; align-items: center; justify-content: space-between;
                gap: 10px; flex-wrap: wrap; background: #f8fafc; flex-shrink: 0; }
            body.app-theme-dark .sm-cc-footer { background: #0f172a; border-top-color: #334155; }
            .sm-cc-footer-stat { font-size: 11.5px; color: #64748b; }
            body.app-theme-dark .sm-cc-footer-stat { color: #94a3b8; }
            .sm-cc-footer-stat b { color: #475569; font-weight: 700; }
            body.app-theme-dark .sm-cc-footer-stat b { color: #cbd5e1; }
            .sm-cc-footer-ignored { color: #d97706; font-weight: 700; }
            .sm-cc-btn { padding: 8px 14px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
                cursor: pointer; border: none; transition: all .12s;
                display: inline-flex; align-items: center; gap: 6px; }
            .sm-cc-btn.ghost { background: #f1f5f9; color: #475569; }
            .sm-cc-btn.ghost:hover { background: #e2e8f0; }
            body.app-theme-dark .sm-cc-btn.ghost { background: #334155; color: #cbd5e1; }
            body.app-theme-dark .sm-cc-btn.ghost:hover { background: #475569; }

            @media (max-width: 640px) {
                #sm-cc-modal { padding: 0; }
                .sm-cc-panel { max-width: 100vw; width: 100vw; max-height: 100dvh; height: 100dvh; border-radius: 0; }
                .sm-cc-header { flex-direction: column; align-items: stretch; }
                .sm-cc-score-wrap { justify-content: center; }
                .sm-cc-header-title { font-size: 16px; }
                .sm-cc-body { padding: 12px; }
                .sm-cc-filters { padding: 8px 12px; overflow-x: auto; flex-wrap: nowrap; }
            }
        `;
        document.head.appendChild(s);
    }

    /* ============================================================
       MODAL
       ============================================================ */
    let state = {
        filterSeverity: null,
        filterCategory: null,
        showIgnored: false,
        results: null
    };

    function buildModal() {
        if (document.getElementById('sm-cc-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'sm-cc-modal';
        modal.innerHTML = `
            <div class="sm-cc-panel" role="dialog" aria-labelledby="sm-cc-title">
                <div class="sm-cc-header">
                    <div>
                        <div class="sm-cc-header-title" id="sm-cc-title">
                            <i class="fa-solid fa-shield-halved"></i>
                            <span>Verificação de Coerência</span>
                        </div>
                        <div class="sm-cc-header-sub">Detecta contradições, lacunas e referências quebradas em todas as abas.</div>
                    </div>
                    <div class="sm-cc-score-wrap">
                        <div class="sm-cc-score-circle" id="sm-cc-score-circle">
                            <div class="sm-cc-score-num" id="sm-cc-score-num">—</div>
                            <div class="sm-cc-score-label">Score</div>
                        </div>
                        <div class="sm-cc-score-detail" id="sm-cc-score-detail"></div>
                    </div>
                    <button class="sm-cc-close" type="button" aria-label="Fechar" data-sm-cc-close>
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="sm-cc-filters" id="sm-cc-filters"></div>
                <div class="sm-cc-body" id="sm-cc-body"></div>
                <div class="sm-cc-footer">
                    <div class="sm-cc-footer-stat" id="sm-cc-footer-stat"></div>
                    <div style="display:flex;gap:8px;">
                        <button class="sm-cc-btn ghost" data-sm-cc-action="export">
                            <i class="fa-solid fa-download"></i> Exportar
                        </button>
                        <button class="sm-cc-btn ghost" data-sm-cc-action="rerun">
                            <i class="fa-solid fa-rotate"></i> Verificar de novo
                        </button>
                        <button class="sm-cc-btn ghost" data-sm-cc-close>Fechar</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
            if (e.target.closest('[data-sm-cc-close]')) close();
            const actionBtn = e.target.closest('[data-sm-cc-action]');
            if (actionBtn) {
                const action = actionBtn.getAttribute('data-sm-cc-action');
                if (action === 'rerun') refresh();
                else if (action === 'export') exportReport();
            }
        });
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }, true);
    }

    /* ============================================================
       RENDER
       ============================================================ */
    function scoreColor(score) {
        if (score >= 85) return 'linear-gradient(135deg, #10b981, #059669)';
        if (score >= 65) return 'linear-gradient(135deg, #f59e0b, #d97706)';
        return 'linear-gradient(135deg, #ef4444, #dc2626)';
    }

    function renderHeader(res) {
        document.getElementById('sm-cc-score-circle').style.background = scoreColor(res.score);
        document.getElementById('sm-cc-score-num').textContent = res.score;
        document.getElementById('sm-cc-score-detail').innerHTML = `
            <div><b class="sm-cc-sev-error">${res.counts.error}</b> erro${res.counts.error === 1 ? '' : 's'}</div>
            <div><b class="sm-cc-sev-warning">${res.counts.warning}</b> aviso${res.counts.warning === 1 ? '' : 's'}</div>
            <div><b class="sm-cc-sev-info">${res.counts.info}</b> informaç${res.counts.info === 1 ? 'ão' : 'ões'}</div>
        `;
    }

    function renderFilters(res) {
        const container = document.getElementById('sm-cc-filters');
        if (!container) return;

        const sevChips = [
            { id: 'error', label: 'Erros', count: res.counts.error },
            { id: 'warning', label: 'Avisos', count: res.counts.warning },
            { id: 'info', label: 'Info', count: res.counts.info }
        ];

        const categories = new Map();
        (state.showIgnored ? (res.ignoredIssues || []) : res.issues).forEach(i => {
            if (!categories.has(i.category)) categories.set(i.category, 0);
            categories.set(i.category, categories.get(i.category) + 1);
        });

        let html = '';
        // Chip "Ignorados" só aparece se há ignorados
        if (res.ignoredCount > 0) {
            const active = state.showIgnored ? 'active' : '';
            html += `<button class="sm-cc-chip sm-cc-chip-ignored ${active}" data-sm-cc-ignored-toggle>
                <i class="fa-solid fa-check-circle"></i> Marcados como corretos
                <span class="sm-cc-chip-count">${res.ignoredCount}</span>
            </button>`;
            if (state.showIgnored) {
                html += `<button class="sm-cc-clear-ignored" data-sm-cc-clear-ignored>
                    <i class="fa-solid fa-eraser"></i> Restaurar todos
                </button>`;
            }
            html += `<span class="sm-cc-filter-label" style="margin-left:12px;"></span>`;
        }

        html += `<span class="sm-cc-filter-label">Severidade:</span>`;
        sevChips.forEach(chip => {
            const active = state.filterSeverity === chip.id ? 'active' : '';
            const isDisabled = state.showIgnored ? '' : ''; // sempre habilitado
            html += `<button class="sm-cc-chip ${active}" data-sm-cc-sev="${chip.id}">
                ${chip.label} <span class="sm-cc-chip-count">${chip.count}</span>
            </button>`;
        });
        if (state.filterSeverity) {
            html += `<button class="sm-cc-chip" data-sm-cc-sev="clear" style="background:#fef2f2;border-color:#fca5a5;color:#dc2626;">
                <i class="fa-solid fa-xmark"></i> Limpar
            </button>`;
        }

        if (categories.size > 0) {
            html += `<span class="sm-cc-filter-label" style="margin-left:12px;">Categoria:</span>`;
            Array.from(categories.entries()).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
                const active = state.filterCategory === cat ? 'active' : '';
                html += `<button class="sm-cc-chip ${active}" data-sm-cc-cat="${escHTML(cat)}">
                    ${escHTML(cat)} <span class="sm-cc-chip-count">${count}</span>
                </button>`;
            });
            if (state.filterCategory) {
                html += `<button class="sm-cc-chip" data-sm-cc-cat="clear" style="background:#fef2f2;border-color:#fca5a5;color:#dc2626;">
                    <i class="fa-solid fa-xmark"></i> Limpar
                </button>`;
            }
        }

        container.innerHTML = html;

        // Handlers
        const ignoredToggle = container.querySelector('[data-sm-cc-ignored-toggle]');
        if (ignoredToggle) {
            ignoredToggle.addEventListener('click', () => {
                state.showIgnored = !state.showIgnored;
                if (state.showIgnored) { state.filterSeverity = null; state.filterCategory = null; }
                renderFilters(res);
                renderBody(res);
            });
        }
        const clearIgnoredBtn = container.querySelector('[data-sm-cc-clear-ignored]');
        if (clearIgnoredBtn) {
            clearIgnoredBtn.addEventListener('click', () => {
                if (!confirm(`Restaurar ${res.ignoredCount} item(ns) marcado(s) como correto(s)?\n\nEles voltarão a aparecer na verificação.`)) return;
                clearAllIgnored();
                state.showIgnored = false;
                toast('Todos restaurados.', 'success');
                refresh();
            });
        }
        container.querySelectorAll('[data-sm-cc-sev]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-sm-cc-sev');
                if (id === 'clear') state.filterSeverity = null;
                else state.filterSeverity = (state.filterSeverity === id) ? null : id;
                renderFilters(res);
                renderBody(res);
            });
        });
        container.querySelectorAll('[data-sm-cc-cat]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-sm-cc-cat');
                if (id === 'clear') state.filterCategory = null;
                else state.filterCategory = (state.filterCategory === id) ? null : id;
                renderFilters(res);
                renderBody(res);
            });
        });
    }

    function severityIcon(sev) {
        if (sev === 'error') return 'fa-circle-exclamation';
        if (sev === 'warning') return 'fa-triangle-exclamation';
        return 'fa-circle-info';
    }

    function renderIssue(item, isIgnored) {
        const sheetHint = item.sheetId ? (() => {
            const s = (currentStory?.sheets || []).find(x => x.id === item.sheetId);
            return s ? `<span style="font-size:9.5px;font-weight:700;padding:1px 7px;border-radius:999px;background:#fef3c7;color:#92400e;text-transform:uppercase;margin-left:6px;">${escHTML(s.name)}</span>` : '';
        })() : '';

        const actions = [];
        if (item.nodeIds && item.nodeIds.length > 0) {
            const label = item.nodeIds.length > 1 ? 'Ir para os nós' : 'Ir para o nó';
            actions.push(`<button class="sm-cc-issue-btn" data-sm-cc-go="${escHTML(item.nodeIds[0])}">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> ${label}
            </button>`);
            if (item.nodeIds.length > 1) {
                for (let i = 1; i < item.nodeIds.length; i++) {
                    actions.push(`<button class="sm-cc-issue-btn" data-sm-cc-go="${escHTML(item.nodeIds[i])}">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> Ver nó ${i + 1}
                    </button>`);
                }
            }
        }
        if (item.entityIds && item.entityIds.length > 0 && typeof window.SM_openEntityDossier === 'function') {
            actions.push(`<button class="sm-cc-issue-btn" data-sm-cc-dossier="${escHTML(item.entityIds[0])}">
                <i class="fa-solid fa-id-card"></i> Ver dossiê
            </button>`);
        }

        if (isIgnored) {
            actions.push(`<button class="sm-cc-issue-btn restore-btn" data-sm-cc-restore="${escHTML(item.key)}">
                <i class="fa-solid fa-rotate-left"></i> Restaurar
            </button>`);
        } else {
            actions.push(`<button class="sm-cc-issue-btn confirm-btn" data-sm-cc-ignore="${escHTML(item.key)}" title="Marcar como intencional — não aparecerá mais na verificação">
                <i class="fa-solid fa-check"></i> Marcar como correto
            </button>`);
        }

        return `<div class="sm-cc-issue ${item.severity}${isIgnored ? ' is-ignored' : ''}">
            <div class="sm-cc-issue-icon"><i class="fa-solid ${severityIcon(item.severity)}"></i></div>
            <div class="sm-cc-issue-body">
                <div class="sm-cc-issue-title">${escHTML(item.title)}${sheetHint}</div>
                <div class="sm-cc-issue-message">${escHTML(item.message)}</div>
                ${actions.length ? `<div class="sm-cc-issue-actions">${actions.join('')}</div>` : ''}
            </div>
        </div>`;
    }

    function renderBody(res) {
        const container = document.getElementById('sm-cc-body');
        if (!container) return;

        let filtered = state.showIgnored ? (res.ignoredIssues || []) : res.issues;
        if (state.filterSeverity) filtered = filtered.filter(i => i.severity === state.filterSeverity);
        if (state.filterCategory) filtered = filtered.filter(i => i.category === state.filterCategory);

        if (filtered.length === 0) {
            if (state.showIgnored) {
                container.innerHTML = `<div class="sm-cc-empty">
                    <div class="sm-cc-empty-icon info"><i class="fa-solid fa-check-circle"></i></div>
                    <div class="sm-cc-empty-title info">Nenhum item marcado como correto</div>
                    <div class="sm-cc-empty-message">Você pode marcar issues como "corretas" quando a incoerência é intencional. Elas somem da verificação principal e podem ser restauradas aqui.</div>
                </div>`;
            } else if (res.issues.length === 0) {
                container.innerHTML = `<div class="sm-cc-empty">
                    <div class="sm-cc-empty-icon"><i class="fa-solid fa-shield-halved"></i></div>
                    <div class="sm-cc-empty-title">História coerente!</div>
                    <div class="sm-cc-empty-message">Nenhum problema detectado. Continue escrevendo com tranquilidade — o próximo run vai pegar qualquer inconsistência que surgir.</div>
                </div>`;
            } else {
                container.innerHTML = `<div class="sm-cc-empty">
                    <div class="sm-cc-empty-message">Nenhum resultado para os filtros atuais. Remova os filtros para ver todos os ${res.issues.length} problema(s).</div>
                </div>`;
            }
            return;
        }

        const byCategory = new Map();
        filtered.forEach(i => {
            if (!byCategory.has(i.category)) byCategory.set(i.category, []);
            byCategory.get(i.category).push(i);
        });

        const sevOrder = { error: 0, warning: 1, info: 2 };
        const catOrder = ['Referências', 'Personagens', 'Objetos', 'Cenas', 'Estrutura', 'Temas'];

        let html = '';
        if (state.showIgnored) {
            html += `<div style="padding:10px 12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;margin-bottom:14px;font-size:12px;color:#78350f;line-height:1.5;">
                <b>⚠️ Modo de visualização: itens marcados como corretos</b><br>
                Estes itens não contam no score. Clique em "Restaurar" para trazê-los de volta à verificação, ou em "Restaurar todos" no topo para reverter todos.
            </div>`;
        }

        Array.from(byCategory.entries())
            .sort((a, b) => {
                const ia = catOrder.indexOf(a[0]);
                const ib = catOrder.indexOf(b[0]);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            })
            .forEach(([cat, list]) => {
                list.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));
                html += `<div class="sm-cc-section">
                    <div class="sm-cc-section-title">
                        <span>${escHTML(cat)}</span>
                        <span class="sm-cc-section-count">${list.length}</span>
                    </div>
                    ${list.map(i => renderIssue(i, state.showIgnored)).join('')}
                </div>`;
            });

        container.innerHTML = html;

        // Handlers
        container.querySelectorAll('[data-sm-cc-go]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-sm-cc-go');
                if (!id) return;
                close();
                if (typeof jumpToNodeFromBible === 'function') jumpToNodeFromBible(id);
            });
        });
        container.querySelectorAll('[data-sm-cc-dossier]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-sm-cc-dossier');
                if (!id || typeof window.SM_openEntityDossier !== 'function') return;
                close();
                window.SM_openEntityDossier(id);
            });
        });
        container.querySelectorAll('[data-sm-cc-ignore]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.getAttribute('data-sm-cc-ignore');
                const item = (state.results?.issues || []).find(i => i.key === key);
                if (!item) return;
                ignoreIssue(item);
                toast('Marcado como correto. Não aparecerá mais.', 'success', 2200);
                refresh();
            });
        });
        container.querySelectorAll('[data-sm-cc-restore]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.getAttribute('data-sm-cc-restore');
                if (!key) return;
                unignoreIssue(key);
                toast('Restaurado na verificação.', 'info', 2000);
                refresh();
            });
        });
    }

    function renderFooter(res) {
        const el = document.getElementById('sm-cc-footer-stat');
        if (!el) return;
        let html = `<b>${res.totalNodes}</b> nó(s) verificado(s) · <b>${res.issues.length}</b> problema(s) encontrado(s)`;
        if (res.ignoredCount > 0) {
            html += ` · <span class="sm-cc-footer-ignored">${res.ignoredCount} marcado(s) como correto(s)</span>`;
        }
        el.innerHTML = html;
    }

    function refresh() {
        const res = runAllChecks();
        state.results = res;
        renderHeader(res);
        renderFilters(res);
        renderBody(res);
        renderFooter(res);
    }

    /* ============================================================
       EXPORT
       ============================================================ */
    function exportReport() {
        const res = state.results;
        if (!res) return;
        const story = currentStory?.title || 'historia';
        const date = new Date().toLocaleString('pt-BR');

        let md = `# Verificação de Coerência\n\n`;
        md += `**História:** ${story}\n`;
        md += `**Data:** ${date}\n`;
        md += `**Score:** ${res.score}/100\n`;
        md += `**Nós verificados:** ${res.totalNodes}\n`;
        md += `**Marcados como corretos:** ${res.ignoredCount}\n\n`;
        md += `## Resumo\n\n`;
        md += `- **Erros:** ${res.counts.error}\n`;
        md += `- **Avisos:** ${res.counts.warning}\n`;
        md += `- **Info:** ${res.counts.info}\n\n`;

        const sevEmoji = { error: '❌', warning: '⚠️', info: 'ℹ️' };

        function renderCategoryBlock(issues) {
            const byCat = new Map();
            issues.forEach(i => {
                if (!byCat.has(i.category)) byCat.set(i.category, []);
                byCat.get(i.category).push(i);
            });
            let block = '';
            byCat.forEach((list, cat) => {
                block += `### ${cat} (${list.length})\n\n`;
                list.forEach(i => {
                    block += `#### ${sevEmoji[i.severity] || '•'} ${i.title}\n\n${i.message}\n\n`;
                    if (i.sheetId) {
                        const s = (currentStory?.sheets || []).find(x => x.id === i.sheetId);
                        if (s) block += `_Aba: ${s.name}_\n\n`;
                    }
                });
            });
            return block;
        }

        if (res.issues.length === 0) {
            md += `Nenhum problema ativo.\n\n`;
        } else {
            md += renderCategoryBlock(res.issues);
        }

        if (res.ignoredCount > 0) {
            md += `\n---\n\n## Marcados como corretos (não contam no score)\n\n`;
            md += renderCategoryBlock(res.ignoredIssues);
        }

        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const slug = story.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        a.download = `${slug}_coerencia.md`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Relatório exportado.', 'success');
    }

    /* ============================================================
       OPEN / CLOSE
       ============================================================ */
    function open() {
        if (!currentStory) {
            toast('Nenhuma história carregada.', 'warn');
            return;
        }
        injectCSS();
        buildModal();
        state.filterSeverity = null;
        state.filterCategory = null;
        state.showIgnored = false;
        refresh();
        const modal = document.getElementById('sm-cc-modal');
        if (modal) modal.classList.add('open');
    }
    function close() {
        const modal = document.getElementById('sm-cc-modal');
        if (modal) modal.classList.remove('open');
    }
    window.SM_openContinuityChecker = open;
    window.SM_closeContinuityChecker = close;

    /* ============================================================
       BOTÃO NO HEADER
       ============================================================ */
    function injectHeaderButton() {
        const actions = document.querySelector('body > header > div:nth-child(2)');
        if (!actions || actions.querySelector('[data-sm-cc-open]')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-sm-cc-open', '1');
        btn.title = 'Verificar coerência da história (Ctrl+Shift+V)';
        btn.className = 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 border border-emerald-200';
        btn.innerHTML = '<i class="fa-solid fa-shield-halved"></i><span class="hidden sm:inline">Verificar</span>';
        btn.addEventListener('click', open);

        const gear = Array.from(actions.querySelectorAll('button')).find(b => b.querySelector('.fa-gear'));
        if (gear && gear.parentNode === actions) actions.insertBefore(btn, gear);
        else actions.appendChild(btn);
    }

    /* ============================================================
       ATALHO
       ============================================================ */
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey && e.shiftKey && e.code === 'KeyV')) return;
        const t = e.target;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
        e.preventDefault(); e.stopPropagation();
        open();
    }, true);

    /* ============================================================
       INIT
       ============================================================ */
    function init() {
        injectCSS();
        const tryInject = () => {
            if (typeof mindMapData !== 'undefined' && currentStory) injectHeaderButton();
            else setTimeout(tryInject, 300);
        };
        tryInject();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();