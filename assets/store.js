/* ============================================================
   StoryMind — CÓPIA DE SEGURANÇA EM INDEXEDDB + HISTÓRICO DE VERSÕES
   Arquivo: assets/store.js   (carregar logo depois de auth.js, ANTES de cloud.js)

   O QUE FAZ (sem mudar como o app salva hoje):
   1. Espelho: toda vez que o app grava 'storymind_database_v2' no localStorage,
      uma cópia de cada história vai (em segundo plano) para o IndexedDB.
   2. Versões: guarda snapshots automáticos (e manuais) de cada história, com
      retenção escalonada (tudo das últimas 3h, 1/hora no dia, 1/dia por 30 dias).
   3. Rede de segurança: snapshot antes de a nuvem sobrescrever uma história,
      antes de excluir e antes de restaurar uma versão.
   4. Recuperação: se histórias sumirem do localStorage (limpeza do navegador,
      cota estourada...), oferece trazê-las de volta.
   5. Cota cheia: se o localStorage recusar a gravação (~5 MB), o IndexedDB
      continua guardando tudo e o usuário é avisado.

   O localStorage continua sendo o armazenamento principal. Se o IndexedDB não
   existir/falhar, tudo aqui se desliga em silêncio e o app funciona como antes.
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_STORE) return;

    var DB_KEY = 'storymind_database_v2';
    var TOMB_KEY = 'storymind_tombstones';
    var IDB_NAME = 'storymind_safe', IDB_VER = 1;
    var MIRROR_DELAY = 3500;               // espera o app "assentar" antes de copiar
    var AUTO_MIN_GAP = 10 * 60 * 1000;     // no máx. 1 snapshot automático / 10 min / história
    var CLOUD_SNAP_GAP = 5 * 60 * 1000;    // idem para "antes da nuvem"
    var H = 3600e3, DAY = 24 * H;

    var idb = null, disabled = false;
    var deletedSet = new Set();
    var lastHash = {}, lastOk = {}, lastCloudSnap = {};

    var REASONS = {
        'auto': 'Automática',
        'manual': 'Salva por você',
        'antes-da-nuvem': 'Antes de atualizar pela nuvem',
        'antes-de-restaurar': 'Antes de restaurar outra versão',
        'excluida': 'Antes de excluir'
    };

    /* ---------------- utilidades ---------------- */
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fmtDate(ts) {
        try { return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
        catch (_) { return new Date(ts).toISOString(); }
    }
    function fmtSize(chars) { return chars >= 1048576 ? (chars / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(chars / 1024)) + ' KB'; }
    function isQuota(e) {
        return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014 || /quota/i.test(e.message || ''));
    }
    // Hash rápido (cyrb53) + tamanho — só para detectar "mudou / não mudou"
    function hash(str) {
        var h1 = 0xdeadbeef, h2 = 0x41c6ce57, ch, i;
        for (i = 0; i < str.length; i++) {
            ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + str.length;
    }
    function readLocalDB() {
        try { return JSON.parse(localStorage.getItem(DB_KEY)) || {}; } catch (_) { return {}; }
    }
    function notify(msg, type, ms) {
        try { if (typeof window.showToast === 'function') { window.showToast(msg, type || 'info', ms || 4000); return; } } catch (_) {}
        var d = document.createElement('div');
        d.textContent = msg;
        d.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 16px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;z-index:2147483000;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,.25)';
        document.body.appendChild(d);
        setTimeout(function () { d.remove(); }, ms || 4000);
    }

    /* ---------------- IndexedDB (promises finas) ---------------- */
    function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
    function done(tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; tx.onabort = function () { rej(tx.error || new Error('abortada')); }; }); }

    function openDB() {
        return new Promise(function (resolve, reject) {
            if (!window.indexedDB) return reject(new Error('sem IndexedDB'));
            var rq = indexedDB.open(IDB_NAME, IDB_VER);
            rq.onupgradeneeded = function () {
                var d = rq.result;
                if (!d.objectStoreNames.contains('latest')) d.createObjectStore('latest', { keyPath: 'key' });
                if (!d.objectStoreNames.contains('snaps')) {
                    var s = d.createObjectStore('snaps', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('key_ts', ['key', 'ts']);
                }
                if (!d.objectStoreNames.contains('snapdata')) d.createObjectStore('snapdata', { keyPath: 'id' });
                if (!d.objectStoreNames.contains('deleted')) d.createObjectStore('deleted', { keyPath: 'key' });
            };
            rq.onsuccess = function () { resolve(rq.result); };
            rq.onerror = function () { reject(rq.error); };
            rq.onblocked = function () { reject(new Error('IndexedDB bloqueado')); };
        });
    }
    async function getAll(store) {
        var tx = idb.transaction(store, 'readonly');
        return req(tx.objectStore(store).getAll());
    }

    var ready = (async function () {
        try {
            idb = await openDB();
            idb.onversionchange = function () { try { idb.close(); } catch (_) {} disabled = true; };
            (await getAll('deleted')).forEach(function (r) { deletedSet.add(r.key); });
            (await getAll('latest')).forEach(function (r) { lastHash[r.key] = r.hash; lastOk[r.key] = r.nativeOk !== false; });
        } catch (e) {
            disabled = true;
            console.warn('[SM_STORE] IndexedDB indisponível — backup extra desligado:', e);
        }
    })();

    /* ---------------- compressão (opcional) ---------------- */
    async function pack(str) {
        try {
            if (typeof CompressionStream === 'function') {
                var cs = new CompressionStream('gzip');
                var w = cs.writable.getWriter();
                w.write(new TextEncoder().encode(str)).catch(function () {});
                w.close().catch(function () {});
                return { gz: true, data: await new Response(cs.readable).arrayBuffer() };
            }
        } catch (_) { /* cai para texto puro */ }
        return { gz: false, data: str };
    }
    async function unpack(rec) {
        if (!rec) return null;
        if (!rec.gz) return rec.data;
        var ds = new DecompressionStream('gzip');
        var w = ds.writable.getWriter();
        w.write(rec.data).catch(function () {});
        w.close().catch(function () {});
        return new Response(ds.readable).text();
    }

    /* ---------------- snapshots ---------------- */
    async function listSnaps(key) {
        var tx = idb.transaction('snaps', 'readonly');
        var idx = tx.objectStore('snaps').index('key_ts');
        var all = await req(idx.getAll(IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER])));
        return all.reverse();                                  // mais novo primeiro
    }
    async function newestSnap(key) {
        var tx = idb.transaction('snaps', 'readonly');
        var idx = tx.objectStore('snaps').index('key_ts');
        var cur = await req(idx.openCursor(IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]), 'prev'));
        return cur ? cur.value : null;
    }
    async function addSnapshot(key, title, json, h, reason) {
        if (disabled) return false;
        var last = await newestSnap(key);
        if (last && last.hash === h) {
            // Mesmo conteúdo: se o pedido é de um tipo "protegido", só promove o snapshot existente
            if (reason !== 'auto' && last.reason === 'auto') {
                var t0 = idb.transaction('snaps', 'readwrite');
                last.reason = reason; t0.objectStore('snaps').put(last);
                await done(t0);
                return true;
            }
            return false;
        }
        var packed = await pack(json);
        var tx = idb.transaction(['snaps', 'snapdata'], 'readwrite');
        var id = await req(tx.objectStore('snaps').add({ key: key, title: String(title || ''), ts: Date.now(), reason: reason, hash: h, size: json.length }));
        tx.objectStore('snapdata').put({ id: id, gz: packed.gz, data: packed.data });
        await done(tx);
        prune(key).catch(function () {});
        return true;
    }
    // Retenção: automáticos = tudo nas últimas 3h, 1/hora até 24h, 1/dia até 30 dias.
    // Protegidos (manual, antes-da-nuvem, antes-de-restaurar, excluida) = até 40, por 120 dias.
    async function prune(key) {
        var list = await listSnaps(key), now = Date.now();
        var keep = new Set(), seen = new Set(), pinned = 0;
        list.forEach(function (s) {
            var age = now - s.ts;
            if (s.reason !== 'auto') { if (pinned < 40 && age < 120 * DAY) { keep.add(s.id); pinned++; } return; }
            var b = age < 3 * H ? 'a' + s.id : age < DAY ? 'h' + Math.floor(s.ts / H) : age < 30 * DAY ? 'd' + Math.floor(s.ts / DAY) : null;
            if (b && !seen.has(b)) { seen.add(b); keep.add(s.id); }
        });
        var drop = list.filter(function (s) { return !keep.has(s.id); });
        if (!drop.length) return;
        var tx = idb.transaction(['snaps', 'snapdata'], 'readwrite');
        drop.forEach(function (s) { tx.objectStore('snaps').delete(s.id); tx.objectStore('snapdata').delete(s.id); });
        await done(tx);
    }
    async function getStory(id) {
        var tx = idb.transaction('snapdata', 'readonly');
        var rec = await req(tx.objectStore('snapdata').get(id));
        var txt = await unpack(rec);
        return txt ? JSON.parse(txt) : null;
    }
    async function getSnapMeta(id) {
        var tx = idb.transaction('snaps', 'readonly');
        return req(tx.objectStore('snaps').get(id));
    }

    /* ---------------- espelho (localStorage → IndexedDB) ---------------- */
    var pendingStr = null, pendingOk = true, timer = null, running = false;

    function schedule(str, ok, now) {
        if (disabled) return;
        pendingStr = str; pendingOk = ok;
        clearTimeout(timer);
        timer = setTimeout(function () {
            if (typeof requestIdleCallback === 'function') requestIdleCallback(function () { run(); }, { timeout: 3000 });
            else run();
        }, now ? 0 : MIRROR_DELAY);
    }
    async function run() {
        if (running) return;
        running = true;
        try {
            await ready;
            if (disabled) return;
            while (pendingStr !== null) {
                var str = pendingStr, ok = pendingOk;
                pendingStr = null;
                await mirrorOnce(str, ok);
            }
        } catch (e) { console.warn('[SM_STORE] espelho falhou:', e); }
        finally { running = false; }
    }
    async function mirrorOnce(str, ok) {
        var db;
        try { db = JSON.parse(str); } catch (_) { return; }
        if (!db || typeof db !== 'object' || Array.isArray(db)) return;
        var keys = Object.keys(db);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (deletedSet.has(key)) continue;
            var story = db[key];
            if (!story || typeof story !== 'object') continue;
            var json = JSON.stringify(story), h = hash(json);
            if (lastHash[key] === h && lastOk[key] === ok) continue;
            var rec = { key: key, title: story.title || '', ts: Date.now(), hash: h, nativeOk: ok, json: json };
            var tx = idb.transaction('latest', 'readwrite');
            tx.objectStore('latest').put(rec);
            await done(tx);
            lastHash[key] = h; lastOk[key] = ok;
            // snapshot automático (com intervalo mínimo)
            var last = await newestSnap(key);
            if (!last || (last.hash !== h && Date.now() - last.ts >= AUTO_MIN_GAP)) {
                await addSnapshot(key, rec.title, json, h, 'auto');
            }
        }
    }

    // Gancho no localStorage: captura TODAS as gravações do banco (app, dashboard, nuvem) sem editar cada uma
    var quotaWarned = false;
    function onQuota() {
        if (quotaWarned) return;
        quotaWarned = true;
        notify('⚠️ O armazenamento do navegador encheu. Suas alterações estão sendo guardadas no backup automático, mas faça Exportar → JSON e libere espaço.', 'error', 9000);
    }
    try {
        var proto = Storage.prototype;
        var nativeSet = proto.setItem, nativeRemove = proto.removeItem;
        proto.setItem = function (k, v) {
            if (k === DB_KEY && this === window.localStorage) {
                try { nativeSet.call(this, k, v); }
                catch (e) {
                    if (isQuota(e)) onQuota();
                    try { schedule(String(v), false, true); } catch (_) {}
                    throw e;                                   // o app continua vendo o erro de sempre
                }
                try { schedule(String(v), true, false); } catch (_) {}
                return;
            }
            return nativeSet.apply(this, arguments);
        };
        proto.removeItem = function (k) {
            // Logout limpa o localStorage de propósito; a cópia local também deve sumir (privacidade)
            if (k === DB_KEY && this === window.localStorage) { try { wipe(); } catch (_) {} }
            return nativeRemove.apply(this, arguments);
        };
    } catch (e) { console.warn('[SM_STORE] não foi possível instalar o gancho:', e); disabled = true; }

    function wipe() {
        clearTimeout(timer); pendingStr = null; disabled = true;
        try { if (idb) idb.close(); } catch (_) {}
        try { indexedDB.deleteDatabase(IDB_NAME); } catch (_) {}
    }

    // Salva logo quando a aba vai para segundo plano / fecha
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && pendingStr !== null) { clearTimeout(timer); run(); }
    });
    window.addEventListener('pagehide', function () { if (pendingStr !== null) { clearTimeout(timer); run(); } });

    /* ---------------- ganchos chamados pelo cloud.js ---------------- */
    async function noteDeleted(key) {
        try {
            await ready;
            if (disabled || deletedSet.has(key)) return;
            deletedSet.add(key);
            var rec = await req(idb.transaction('latest', 'readonly').objectStore('latest').get(key));
            if (rec && rec.json) await addSnapshot(key, rec.title, rec.json, rec.hash, 'excluida');
            var tx = idb.transaction(['latest', 'deleted'], 'readwrite');
            tx.objectStore('latest').delete(key);
            tx.objectStore('deleted').put({ key: key, ts: Date.now() });
            await done(tx);
            delete lastHash[key]; delete lastOk[key];
        } catch (e) { console.warn('[SM_STORE] noteDeleted:', e); }
    }
    // A nuvem vai substituir esta história local: guarda a versão local antes (sem travar o pull)
    function beforeOverwrite(key, story) {
        setTimeout(async function () {
            try {
                await ready;
                if (disabled || !story) return;
                if (Date.now() - (lastCloudSnap[key] || 0) < CLOUD_SNAP_GAP) return;
                var json = JSON.stringify(story);
                var did = await addSnapshot(key, story.title, json, hash(json), 'antes-da-nuvem');
                if (did) lastCloudSnap[key] = Date.now();
            } catch (_) {}
        }, 0);
    }

    /* ---------------- aplicar uma história (restaurar / recuperar) ---------------- */
    async function applyStory(key, story) {
        deletedSet.delete(key);
        try {
            var tx = idb.transaction('deleted', 'readwrite');
            tx.objectStore('deleted').delete(key);
            await done(tx);
        } catch (_) {}
        try {
            if (window.SM_CLOUD) {
                window.SM_CLOUD.clearTombstone(key);
                if (window.SM_CLOUD.revive) window.SM_CLOUD.revive[key] = true;   // a nuvem pode ter a linha marcada como excluída
            }
        } catch (_) {}

        var inApp = typeof storiesDatabase !== 'undefined' && typeof switchStory === 'function' && document.getElementById('story-select');
        if (inApp) {
            storiesDatabase[key] = story;        // o app recarrega a partir daqui
            switchStory(key);                    // redesenha, salva local e empurra para a nuvem
            return 'app';
        }
        var db = readLocalDB();
        db[key] = story;
        localStorage.setItem(DB_KEY, JSON.stringify(db));
        try { if (window.SM_CLOUD) window.SM_CLOUD.push(key, story); } catch (_) {}
        return 'page';
    }
    async function snapshotCurrent(key, reason) {
        try { if (typeof flushPendingSave === 'function') flushPendingSave(); } catch (_) {}
        var st = readLocalDB()[key];
        if (!st) return false;
        var json = JSON.stringify(st);
        return addSnapshot(key, st.title, json, hash(json), reason);
    }
    function currentKey() { return (typeof currentStoryKey !== 'undefined' && currentStoryKey) ? currentStoryKey : null; }

    async function restoreSnapshot(id) {
        await ready;
        var meta = await getSnapMeta(id);
        var story = await getStory(id);
        if (!meta || !story) throw new Error('Versão não encontrada.');
        await snapshotCurrent(meta.key, 'antes-de-restaurar');
        return applyStory(meta.key, story);
    }
    async function restoreLatest(key) {
        var rec = await req(idb.transaction('latest', 'readonly').objectStore('latest').get(key));
        if (!rec) throw new Error('Cópia não encontrada.');
        await snapshotCurrent(key, 'antes-de-restaurar');
        return applyStory(key, JSON.parse(rec.json));
    }

    /* ---------------- recuperação ---------------- */
    async function findRecoverable() {
        await ready;
        var out = { missing: [], newer: [], trash: [] };
        if (disabled) return out;
        var latest = await getAll('latest'), local = readLocalDB(), tomb = [];
        try { tomb = JSON.parse(localStorage.getItem(TOMB_KEY)) || []; } catch (_) {}
        latest.forEach(function (r) {
            if (deletedSet.has(r.key) || tomb.indexOf(r.key) >= 0) return;
            if (!(r.key in local)) out.missing.push(r);
            else if (r.nativeOk === false) {
                try { if (hash(JSON.stringify(local[r.key])) !== r.hash) out.newer.push(r); } catch (_) {}
            }
        });
        // histórias excluídas: o snapshot mais recente de cada uma que não está mais na lista
        var snaps = await getAll('snaps'), byKey = {};
        snaps.forEach(function (s) { if (!(s.key in local) && (!byKey[s.key] || s.ts > byKey[s.key].ts)) byKey[s.key] = s; });
        Object.keys(byKey).forEach(function (k) {
            if (!out.missing.some(function (m) { return m.key === k; })) out.trash.push(byKey[k]);
        });
        out.trash.sort(function (a, b) { return b.ts - a.ts; });
        return out;
    }

    /* ---------------- interface ---------------- */
    var cssDone = false;
    function injectCSS() {
        if (cssDone) return; cssDone = true;
        var s = document.createElement('style');
        s.textContent =
            '#smbk-ov{position:fixed;inset:0;background:rgba(15,23,42,.5);backdrop-filter:blur(3px);z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif}' +
            '.smbk-box{background:#fff;color:#1e293b;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,.3);width:100%;max-width:560px;max-height:86vh;display:flex;flex-direction:column;overflow:hidden}' +
            '.smbk-hd{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc;font-size:15px}' +
            '.smbk-x{background:none;border:0;font-size:22px;line-height:1;color:#94a3b8;cursor:pointer}.smbk-x:hover{color:#475569}' +
            '.smbk-tabs{display:flex;gap:4px;padding:8px 14px 0;border-bottom:1px solid #e2e8f0}' +
            '.smbk-tab{background:none;border:0;padding:8px 12px;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;border-bottom:2px solid transparent}' +
            '.smbk-tab.on{color:#4f46e5;border-bottom-color:#4f46e5}' +
            '.smbk-badge{background:#4f46e5;color:#fff;border-radius:99px;font-size:10px;padding:1px 6px;margin-left:4px}' +
            '.smbk-bd{padding:12px 14px;overflow:auto;flex:1;font-size:13px}' +
            '.smbk-ft{padding:10px 18px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;background:#f8fafc}' +
            '.smbk-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:7px}' +
            '.smbk-row .m{flex:1;min-width:0}.smbk-row .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.smbk-row .s{font-size:11px;color:#64748b}' +
            '.smbk-btn{border:0;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:600;cursor:pointer;background:#eef2ff;color:#4338ca}.smbk-btn:hover{background:#e0e7ff}' +
            '.smbk-btn.pri{background:#4f46e5;color:#fff}.smbk-btn.pri:hover{background:#4338ca}' +
            '.smbk-btn.gh{background:#f1f5f9;color:#475569}.smbk-btn.gh:hover{background:#e2e8f0}' +
            '.smbk-h{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:12px 2px 6px}' +
            '.smbk-empty{color:#94a3b8;text-align:center;padding:22px 8px}' +
            '#smbk-banner{position:fixed;left:16px;bottom:16px;z-index:2147481000;background:#1e293b;color:#fff;border-radius:12px;padding:12px 14px;max-width:min(92vw,380px);font:13px/1.45 Inter,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
            '#smbk-banner .a{display:flex;gap:8px;margin-top:9px}';
        document.head.appendChild(s);
    }
    function download(name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = name; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 600);
    }
    function safeName(t) { return String(t || 'historia').replace(/[^\w\-]+/g, '_').slice(0, 40) || 'historia'; }

    async function afterApply(mode) {
        closeHistory();
        if (mode === 'page') { notify('Restaurado. Atualizando a página…', 'success', 1500); setTimeout(function () { location.reload(); }, 700); }
        else notify('Versão restaurada.', 'success', 3000);
    }
    function closeHistory() { var o = document.getElementById('smbk-ov'); if (o) o.remove(); }

    async function openHistory(tab) {
        injectCSS(); closeHistory();
        await ready;
        var ov = document.createElement('div'); ov.id = 'smbk-ov';
        var key = currentKey();
        ov.innerHTML = '<div class="smbk-box"><div class="smbk-hd"><b>🛟 Backup e versões</b><button class="smbk-x" aria-label="Fechar">×</button></div>' +
            '<div class="smbk-tabs">' + (key ? '<button class="smbk-tab" data-t="cur">Esta história</button>' : '') +
            '<button class="smbk-tab" data-t="rec">Recuperar <span class="smbk-badge" id="smbk-n" style="display:none"></span></button></div>' +
            '<div class="smbk-bd"></div><div class="smbk-ft">Cópias guardadas só neste navegador (IndexedDB). Para guardar fora dele, use Exportar → JSON.</div></div>';
        document.body.appendChild(ov);
        ov.addEventListener('click', function (e) { if (e.target === ov) closeHistory(); });
        ov.querySelector('.smbk-x').onclick = closeHistory;
        var bd = ov.querySelector('.smbk-bd');

        if (disabled) { bd.innerHTML = '<div class="smbk-empty">O backup automático não está disponível neste navegador (IndexedDB bloqueado, ex.: aba privativa).</div>'; return; }

        var rec = await findRecoverable();
        var total = rec.missing.length + rec.newer.length + rec.trash.length;
        var badge = ov.querySelector('#smbk-n'); if (total) { badge.textContent = total; badge.style.display = ''; }

        async function showCur() {
            var list = await listSnaps(key), st = readLocalDB()[key] || {};
            bd.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px"><div style="min-width:0"><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(st.title || key) + '</div><div class="s" style="font-size:11px;color:#64748b">' + list.length + ' versão(ões) guardada(s)</div></div><button class="smbk-btn pri" id="smbk-now">Salvar versão agora</button></div>' +
                (list.length ? '' : '<div class="smbk-empty">Ainda não há versões desta história. A primeira aparece em instantes, depois que você editar.</div>');
            list.forEach(function (s) {
                var row = document.createElement('div'); row.className = 'smbk-row';
                row.innerHTML = '<div class="m"><div class="t">' + fmtDate(s.ts) + '</div><div class="s">' + esc(REASONS[s.reason] || s.reason) + ' · ' + fmtSize(s.size) + '</div></div>' +
                    '<button class="smbk-btn gh" data-a="dl">Baixar</button><button class="smbk-btn" data-a="rs">Restaurar</button>';
                row.querySelector('[data-a=rs]').onclick = async function () {
                    if (!confirm('Restaurar a versão de ' + fmtDate(s.ts) + '?\n\nO estado atual será guardado antes, então você pode voltar atrás.')) return;
                    try { afterApply(await restoreSnapshot(s.id)); } catch (e) { notify('Não foi possível restaurar: ' + e.message, 'error', 5000); }
                };
                row.querySelector('[data-a=dl]').onclick = async function () {
                    var story = await getStory(s.id); if (!story) return;
                    download(safeName(s.title) + '_' + new Date(s.ts).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json', JSON.stringify(story, null, 2));
                };
                bd.appendChild(row);
            });
            bd.querySelector('#smbk-now').onclick = async function () {
                var ok = await snapshotCurrent(key, 'manual');
                notify(ok ? 'Versão salva.' : 'Nada mudou desde a última versão guardada.', ok ? 'success' : 'info', 2500);
                showCur();
            };
        }
        function recRow(title, sub, btn, fn) {
            var row = document.createElement('div'); row.className = 'smbk-row';
            row.innerHTML = '<div class="m"><div class="t">' + esc(title || 'Sem título') + '</div><div class="s">' + sub + '</div></div><button class="smbk-btn pri">' + btn + '</button>';
            row.querySelector('button').onclick = async function () {
                try { afterApply(await fn()); } catch (e) { notify('Não foi possível restaurar: ' + e.message, 'error', 5000); }
            };
            return row;
        }
        function showRec() {
            bd.innerHTML = '';
            if (!total) { bd.innerHTML = '<div class="smbk-empty">Nenhuma história para recuperar. Tudo o que está no backup já está na sua lista. ✅</div>'; return; }
            if (rec.missing.length) {
                bd.insertAdjacentHTML('beforeend', '<div class="smbk-h">Sumiram da sua lista</div>');
                rec.missing.forEach(function (r) { bd.appendChild(recRow(r.title, 'Cópia de ' + fmtDate(r.ts) + ' · ' + fmtSize(r.json.length), 'Restaurar', function () { return restoreLatest(r.key); })); });
            }
            if (rec.newer.length) {
                bd.insertAdjacentHTML('beforeend', '<div class="smbk-h">Versão mais nova no backup</div>');
                rec.newer.forEach(function (r) { bd.appendChild(recRow(r.title, 'O navegador não conseguiu gravar a última edição · ' + fmtDate(r.ts), 'Recuperar', function () { return restoreLatest(r.key); })); });
            }
            if (rec.trash.length) {
                bd.insertAdjacentHTML('beforeend', '<div class="smbk-h">Excluídas (últimas versões guardadas)</div>');
                rec.trash.forEach(function (s) { bd.appendChild(recRow(s.title, esc(REASONS[s.reason] || s.reason) + ' · ' + fmtDate(s.ts) + ' · ' + fmtSize(s.size), 'Restaurar', function () { return restoreSnapshot(s.id); })); });
            }
        }
        function go(t) {
            ov.querySelectorAll('.smbk-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
            if (t === 'cur' && key) showCur(); else showRec();
        }
        ov.querySelectorAll('.smbk-tab').forEach(function (b) { b.onclick = function () { go(b.dataset.t); }; });
        go(tab === 'rec' || !key ? 'rec' : 'cur');
    }

    /* ---------------- aviso de recuperação (uma vez por carregamento) ---------------- */
    var bannerChecked = false;
    async function checkRecoveryBanner() {
        if (bannerChecked) return; bannerChecked = true;
        try {
            var rec = await findRecoverable();
            var n = rec.missing.length + rec.newer.length;     // lixeira não gera aviso: só se o usuário procurar
            if (!n) return;
            injectCSS();
            var b = document.createElement('div'); b.id = 'smbk-banner';
            b.innerHTML = '🛟 Encontramos <b>' + n + '</b> ' + (n === 1 ? 'história' : 'histórias') + ' no backup automático que ' + (n === 1 ? 'não está' : 'não estão') + ' na sua lista ou ' + (n === 1 ? 'tem' : 'têm') + ' edições mais novas.' +
                '<div class="a"><button class="smbk-btn pri" data-a="v">Ver</button><button class="smbk-btn gh" data-a="x">Agora não</button></div>';
            document.body.appendChild(b);
            b.querySelector('[data-a=v]').onclick = function () { b.remove(); openHistory('rec'); };
            b.querySelector('[data-a=x]').onclick = function () { b.remove(); };
        } catch (_) {}
    }
    window.addEventListener('cloud:pull:done', function () { setTimeout(checkRecoveryBanner, 1500); }, { once: true });
    setTimeout(checkRecoveryBanner, 9000);                      // se a nuvem não responder (offline), verifica mesmo assim

    /* ---------------- API pública ---------------- */
    window.SM_STORE = {
        ready: ready,
        isEnabled: function () { return !disabled; },
        openHistory: openHistory,
        snapshotNow: function (key, reason) { return ready.then(function () { return disabled ? false : snapshotCurrent(key || currentKey(), reason || 'manual'); }); },
        listVersions: function (key) { return ready.then(function () { return disabled ? [] : listSnaps(key || currentKey()); }); },
        findRecoverable: findRecoverable,
        noteDeleted: noteDeleted,
        beforeOverwrite: beforeOverwrite
    };
})();
