/* ============================================================
   STORYMIND — COLABORAÇÃO EM TEMPO REAL (aditivo, seguro)
   Carregar DEPOIS de cloud.js no app.html:
     <script src="assets/collab.js" defer></script>

   O QUE FAZ:
   1. Broadcast instantâneo (~100ms) das alterações para outras
      abas e outros dispositivos do MESMO usuário.
   2. Presença: mostra quem está online na história (badge no canto).
   3. Cursores: mostra onde cada colaborador está.

   O QUE NÃO FAZ:
   - Compartilhar entre contas (precisa Fase 3, com SQL).
   - Merge campo a campo (Fase 4, CRDT).

   NÃO TOCA no cloud.js: se este arquivo falhar, o cloud.js
   continua sincronizando normalmente (fallback automático).
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_COLLAB) return;

    const COLORS = ['#6366f1','#ec4899','#14b8a6','#f59e0b','#8b5cf6','#ef4444','#06b6d4'];
    const CURSOR_THROTTLE = 80;      // ms
    const CURSOR_TTL_MS = 8000;      // apaga cursor parado após 8s

    let myUser = null;
    let myDeviceId = null;
    let myColor = COLORS[0];
    let activeKey = null;
    let channel = null;
    let connected = false;
    let lastCursor = 0;
    let peers = {};   // deviceId -> {name, color, x, y, ts}

    // ---------- utilidades ----------
    function getDeviceId() {
        try {
            let id = sessionStorage.getItem('sm-device-id');
            if (!id) {
                id = 'dev-' + Math.random().toString(36).slice(2, 10);
                sessionStorage.setItem('sm-device-id', id);
            }
            return id;
        } catch (_) {
            return 'dev-' + Math.random().toString(36).slice(2, 10);
        }
    }
    function pickColor(id) {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
        return COLORS[Math.abs(h) % COLORS.length];
    }
    function currentKey() {
        if (typeof currentStoryKey !== 'undefined' && currentStoryKey) return currentStoryKey;
        const sel = document.getElementById('story-select');
        if (sel && sel.value && sel.value !== 'default' && sel.value !== 'new') return sel.value;
        return null;
    }
    function readDB() {
        try { return JSON.parse(localStorage.getItem('storymind_database_v2')) || {}; }
        catch (_) { return {}; }
    }

    // ---------- canal por história ----------
    async function join(key) {
        if (!key) return;
        if (activeKey === key && channel) return;
        await leave();
        if (typeof sb === 'undefined' || !sb) return;
        activeKey = key;
        channel = sb.channel('story:' + key, {
            config: {
                presence: { key: myDeviceId },
                broadcast: { self: false }
            }
        });

        channel.on('presence', { event: 'sync' }, () => renderPresence());
        channel.on('presence', { event: 'join' }, () => renderPresence());
        channel.on('presence', { event: 'leave' }, () => renderPresence());

        channel.on('broadcast', { event: 'story' }, (msg) => {
            if (!msg || !msg.payload) return;
            if (msg.payload.from === myDeviceId) return;
            applyRemote(msg.payload);
        });

        channel.on('broadcast', { event: 'cursor' }, (msg) => {
            if (!msg || !msg.payload) return;
            if (msg.payload.from === myDeviceId) return;
            peers[msg.payload.from] = {
                name: msg.payload.name || '?',
                color: msg.payload.color || '#6366f1',
                x: msg.payload.x, y: msg.payload.y,
                ts: Date.now()
            };
            renderCursors();
        });

        channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                connected = true;
                try {
                    channel.track({
                        name: myUser ? myUser.name : 'Anônimo',
                        color: myColor,
                        device: myDeviceId,
                        ts: Date.now()
                    });
                } catch (_) {}
            }
        });
    }

    async function leave() {
        if (channel) {
            try { await channel.untrack(); } catch (_) {}
            try { await sb.removeChannel(channel); } catch (_) {}
            channel = null;
        }
        activeKey = null;
        connected = false;
        peers = {};
        renderPresence();
        renderCursors();
    }

    // ---------- aplicar história recebida ----------
    function applyRemote(payload) {
        const key = payload.key;
        if (!key || !payload.story) return;
        const db = readDB();
        const local = db[key];
        const localTs = (local && local.updatedAt) || 0;
        const incomingTs = payload.ts || 0;
        if (incomingTs && localTs && incomingTs < localTs) return;   // versão antiga, ignora
        payload.story.updatedAt = payload.ts || Date.now();
        db[key] = payload.story;
        try { localStorage.setItem('storymind_database_v2', JSON.stringify(db)); } catch (_) {}
        if (currentKey() === key) {
            try {
                if (typeof storiesDatabase !== 'undefined') storiesDatabase[key] = payload.story;
                if (typeof renderApp === 'function') renderApp();
            } catch (_) {}
        }
    }

    // ---------- enviar história local ----------
    function broadcastStory(key, story) {
        if (!channel || !connected || !story) return;
        try {
            channel.send({
                type: 'broadcast', event: 'story',
                payload: { key, story, ts: story.updatedAt || Date.now(), from: myDeviceId }
            });
        } catch (_) {}
    }

    // ---------- cursor ----------
    function broadcastCursor(x, y) {
        if (!channel || !connected) return;
        const now = Date.now();
        if (now - lastCursor < CURSOR_THROTTLE) return;
        lastCursor = now;
        try {
            channel.send({
                type: 'broadcast', event: 'cursor',
                payload: {
                    x, y, from: myDeviceId,
                    name: myUser ? myUser.name : '?', color: myColor
                }
            });
        } catch (_) {}
    }

    // ---------- UI: presença ----------
    function ensureBar() {
        let bar = document.getElementById('sm-collab-bar');
        if (bar) return bar;
        bar = document.createElement('div');
        bar.id = 'sm-collab-bar';
        bar.style.cssText =
            'position:fixed;top:8px;right:12px;z-index:80;display:flex;align-items:center;gap:6px;' +
            'background:rgba(255,255,255,.96);backdrop-filter:blur(8px);border:1px solid #e2e8f0;' +
            'border-radius:999px;padding:4px 10px;font:11px Inter,sans-serif;color:#475569;' +
            'box-shadow:0 4px 12px rgba(0,0,0,.08);transition:opacity .2s';
        bar.innerHTML =
            '<i class="fa-solid fa-circle-nodes" style="color:#6366f1;font-size:10px"></i>' +
            '<span id="sm-collab-label">só você</span>' +
            '<div id="sm-collab-avatars" style="display:flex;margin-left:4px"></div>';
        document.body.appendChild(bar);
        return bar;
    }
    function renderPresence() {
        const bar = ensureBar();
        const label = bar.querySelector('#sm-collab-label');
        const avatars = bar.querySelector('#sm-collab-avatars');
        const state = channel && channel.presenceState ? channel.presenceState() : {};
        const ids = Object.keys(state || {});
        const others = ids.filter(id => id !== myDeviceId);
        if (others.length === 0) {
            label.textContent = 'só você';
            avatars.innerHTML = '';
            return;
        }
        label.textContent = others.length + ' online';
        avatars.innerHTML = others.map(id => {
            const meta = (state[id] && state[id][0]) || {};
            const color = meta.color || '#6366f1';
            const initials = (meta.name || '?').slice(0, 2).toUpperCase();
            return `<span title="${(meta.name || '').replace(/"/g, '')}" style="width:20px;height:20px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:9px;display:inline-flex;align-items:center;justify-content:center;margin-left:-4px;border:2px solid #fff">${initials}</span>`;
        }).join('');
    }

    // ---------- UI: cursores ----------
    let cursorLayer = null;
    function ensureCursorLayer() {
        if (cursorLayer) return cursorLayer;
        cursorLayer = document.createElement('div');
        cursorLayer.id = 'sm-collab-cursors';
        cursorLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:75';
        document.body.appendChild(cursorLayer);
        return cursorLayer;
    }
    function renderCursors() {
        const layer = ensureCursorLayer();
        const now = Date.now();
        Object.keys(peers).forEach(id => { if (now - peers[id].ts > CURSOR_TTL_MS) delete peers[id]; });
        layer.innerHTML = '';
        Object.keys(peers).forEach(id => {
            const c = peers[id];
            const el = document.createElement('div');
            el.style.cssText = `position:absolute;left:${c.x}px;top:${c.y}px;pointer-events:none`;
            el.innerHTML =
                `<svg width="18" height="24" viewBox="0 0 18 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))">
                    <path d="M0 0 L0 18 L5 13 L9 22 L12 20 L8 12 L15 12 Z" fill="${c.color}" stroke="#fff" stroke-width="1.5"/>
                </svg>
                <span style="position:absolute;left:14px;top:14px;background:${c.color};color:#fff;font:600 10px Inter,sans-serif;padding:2px 6px;border-radius:6px;white-space:nowrap">${c.name}</span>`;
            layer.appendChild(el);
        });
    }

    // ---------- hooks no app existente ----------
    function hookSave() {
        const orig = window.saveStoriesStorage;
        if (typeof orig !== 'function' || orig.__smCollab) return;
        const wrapped = function () {
            const r = orig.apply(this, arguments);
            try {
                const k = currentKey();
                if (k) {
                    const db = readDB();
                    const story = db[k];
                    if (story) { story.updatedAt = story.updatedAt || Date.now(); broadcastStory(k, story); }
                }
            } catch (_) {}
            return r;
        };
        wrapped.__smCollab = true;
        window.saveStoriesStorage = wrapped;
    }
    function hookSwitch() {
        const orig = window.switchStory;
        if (typeof orig !== 'function' || orig.__smCollab) return;
        const wrapped = function () {
            const r = orig.apply(this, arguments);
            try { setTimeout(() => join(currentKey()), 80); } catch (_) {}
            return r;
        };
        wrapped.__smCollab = true;
        window.switchStory = wrapped;
    }
    function hookCursor() {
        const canvas = document.getElementById('canvas-container');
        if (!canvas || canvas.__smCollabCursor) return;
        canvas.__smCollabCursor = true;
        canvas.addEventListener('mousemove', (e) => broadcastCursor(e.clientX, e.clientY), { passive: true });
    }

    // ---------- init ----------
    async function init() {
        try {
            if (typeof sb === 'undefined' || !sb) return;
            const { data } = await sb.auth.getUser();
            if (!data || !data.user) return;
            myUser = {
                id: data.user.id,
                name: (data.user.user_metadata && data.user.user_metadata.name)
                    || (data.user.email || '').split('@')[0]
            };
        } catch (_) { return; }
        myDeviceId = getDeviceId();
        myColor = pickColor(myDeviceId);

        // Re-aplica os hooks (o app pode recriar funções em runtime)
        setInterval(() => { hookSave(); hookSwitch(); }, 2000);
        hookSave(); hookSwitch(); hookCursor();

        const k = currentKey();
        if (k) setTimeout(() => join(k), 800);

        console.info('[SM_COLLAB] ativo. device=' + myDeviceId + ' key=' + (k || '(nenhuma)'));
    }

    window.SM_COLLAB = {
        init, join, leave, broadcastStory, broadcastCursor,
        isConnected: () => connected,
        get activeKey() { return activeKey; }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();