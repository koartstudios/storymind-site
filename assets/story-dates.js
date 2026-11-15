/* ============================================================
   StoryMind — DATAS DE CRIAÇÃO E MODIFICAÇÃO (correção)
   Arquivo: assets/story-dates.js
   Carregar em: dashboard.html (antes de dashboard.js) e app.html (no fim).

   POR QUE AS DATAS ESTAVAM ERRADAS
   • "Modificado" vinha da nuvem (updated_at), mas o app reenvia a história para a
     nuvem sempre que ela é ABERTA — então a data virava "última vez que abri".
   • "Criado" caía para "modificado" (ou para "hoje") quando a data não estava no
     navegador; e o logout apaga esse cache (storymind_meta), então toda vez que
     você entrava de novo a data "de criação" mudava.

   COMO ESTE ARQUIVO RESOLVE (sem destruir nada)
   • Guarda as datas DENTRO da própria história (createdAt / modifiedAt), então
     elas viajam junto com a nuvem e valem em qualquer aparelho.
   • modifiedAt só muda quando o CONTEÚDO muda de fato (comparando uma assinatura
     do conteúdo), nunca por abrir, favoritar ou trocar de aba.
   • Para histórias antigas, sem datas gravadas, reconstrói a data a partir dos
     identificadores (story_<ms>, sheet-<ms>, node-<ms>), que embutem o momento
     em que foram criados.
   • Se algo falhar, o app segue funcionando como antes (tudo aqui é opcional).
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_DATES) return;

    var META_KEY = 'storymind_meta';
    var MIN_TS = 946684800000;                       // 2000-01-01
    var EXCLUDED = { isFavorite: 1, activeSheetId: 1, createdAt: 1, modifiedAt: 1, contentSig: 1 };

    function valid(t) {
        t = Number(t);
        return isFinite(t) && t >= MIN_TS && t <= Date.now() + 864e5 ? t : 0;
    }
    function readMeta() {
        try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (_) { return {}; }
    }
    // story_1731666000000-ab12 → 1731666000000
    function keyTime(key) {
        var m = /^story_(\d{12,14})/.exec(String(key || ''));
        return m ? valid(m[1]) : 0;
    }
    // Menor e maior timestamp embutidos nos ids de abas (sheet-<ms>) e nós (node-<ms>)
    function idTimes(story) {
        var min = 0, max = 0;
        function see(id, prefix) {
            if (typeof id !== 'string' || id.indexOf(prefix) !== 0) return;
            var m = /^[a-z]+-(\d{12,14})/.exec(id);
            var t = m ? valid(m[1]) : 0;
            if (!t) return;
            if (!min || t < min) min = t;
            if (t > max) max = t;
        }
        var sheets = story && Array.isArray(story.sheets) ? story.sheets : [];
        for (var i = 0; i < sheets.length; i++) {
            var sh = sheets[i]; if (!sh) continue;
            see(sh.id, 'sheet-');
            var nodes = Array.isArray(sh.nodes) ? sh.nodes : [];
            for (var j = 0; j < nodes.length; j++) if (nodes[j]) see(nodes[j].id, 'node-');
        }
        return { min: min, max: max };
    }

    /* ---------- leitura (usada pelo dashboard) ---------- */
    function created(key, story, meta) {
        var c = valid(story && story.createdAt);
        if (c) return c;
        var k = keyTime(key), ids = idTimes(story);
        var best = [k, ids.min].filter(Boolean).sort(function (a, b) { return a - b; })[0];   // o mais antigo
        if (best) return best;
        return valid(meta && meta.cloudCreated) || valid(meta && meta.created);
    }
    function modified(key, story, meta) {
        var m = valid(story && story.modifiedAt);
        if (m) return m;
        var ids = idTimes(story);                    // história antiga: último nó/aba criado
        if (ids.max) return ids.max;
        return valid(meta && meta.modified) || created(key, story, meta);
    }

    /* ---------- assinatura do conteúdo ----------
       Hash que NÃO depende da ordem das chaves (a nuvem/JSONB embaralha a ordem),
       para que abrir a história em outro aparelho não pareça "edição". */
    function sig(story) {
        var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        function mix(ch) { h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
        function str(s) { for (var i = 0; i < s.length; i++) mix(s.charCodeAt(i)); mix(0x1f); }
        function walk(v) {
            if (v === null) { mix(0x6e); return; }
            var t = typeof v;
            if (t === 'string') { mix(0x22); str(v); }
            else if (t === 'number') { if (!isFinite(v)) mix(0x6e); else { mix(0x23); str(String(v)); } }
            else if (t === 'boolean') mix(v ? 0x74 : 0x66);
            else if (Array.isArray(v)) {
                mix(0x5b);
                for (var i = 0; i < v.length; i++) { var x = v[i]; if (x === undefined || typeof x === 'function') mix(0x6e); else walk(x); }
                mix(0x5d);
            } else if (t === 'object') {
                mix(0x7b);
                var ks = Object.keys(v).sort();
                for (var k = 0; k < ks.length; k++) {
                    var val = v[ks[k]];
                    if (val === undefined || typeof val === 'function') continue;
                    str(ks[k]); walk(val);
                }
                mix(0x7d);
            }
        }
        var top = Object.keys(story).sort();
        for (var i = 0; i < top.length; i++) {
            var k = top[i];
            if (EXCLUDED[k] || story[k] === undefined || typeof story[k] === 'function') continue;
            str(k); walk(story[k]);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
    }

    /* ---------- escrita ---------- */
    // Garante createdAt e atualiza modifiedAt só se o conteúdo mudou. Retorna true se alterou a história.
    function stamp(key, story) {
        if (!story || typeof story !== 'object') return false;
        var changed = false, meta = readMeta()[key];
        if (!valid(story.createdAt)) {
            story.createdAt = created(key, story, meta) || Date.now();
            changed = true;
        }
        var s = sig(story);
        if (typeof story.contentSig !== 'string') {
            // Primeira vez: só registra a linha de base. NÃO conta como edição.
            story.contentSig = s;
            if (!valid(story.modifiedAt)) story.modifiedAt = modified(key, story, meta) || story.createdAt;
            changed = true;
        } else if (story.contentSig !== s) {
            story.contentSig = s;
            story.modifiedAt = Date.now();
            changed = true;
        }
        return changed;
    }
    // Marca como modificada agora (ex.: renomear no dashboard) e atualiza a assinatura junto
    function touch(story) {
        if (!story || typeof story !== 'object') return;
        story.contentSig = sig(story);
        story.modifiedAt = Date.now();
    }
    // Para cópias: data de criação nova
    function resetForCopy(story) {
        if (!story || typeof story !== 'object') return story;
        var now = Date.now();
        story.createdAt = now; story.modifiedAt = now;
        story.contentSig = sig(story);
        return story;
    }

    /* ---------- integração com o app (app.html) ---------- */
    var lastStamp = 0, trailing = null, MIN_GAP = 1500;
    function installInApp() {
        if (typeof window.flushSaveToDisk !== 'function' || window.flushSaveToDisk.__smDates) return;
        var orig = window.flushSaveToDisk;
        var wrapped = function () {
            try {
                if (typeof currentStory !== 'undefined' && currentStory && typeof currentStoryKey !== 'undefined') {
                    var now = Date.now(), hidden = document.visibilityState === 'hidden';
                    var first = typeof currentStory.contentSig !== 'string' || !valid(currentStory.createdAt);
                    if (first || hidden || now - lastStamp >= MIN_GAP) {
                        lastStamp = now;
                        stamp(currentStoryKey, currentStory);
                    } else if (!trailing) {
                        // salvamento muito próximo do anterior: confere de novo logo depois
                        trailing = setTimeout(function () {
                            trailing = null;
                            try { if (typeof window.flushPendingSave === 'function') window.flushPendingSave(); } catch (_) {}
                        }, MIN_GAP + 200);
                    }
                }
            } catch (e) { console.warn('[SM_DATES] stamp falhou:', e); }
            return orig.apply(this, arguments);
        };
        wrapped.__smDates = true;
        window.flushSaveToDisk = wrapped;
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installInApp);
    else installInApp();
    window.addEventListener('load', installInApp);

    window.SM_DATES = { created: created, modified: modified, keyTime: keyTime, stamp: stamp, touch: touch, resetForCopy: resetForCopy, sig: sig };
})();
