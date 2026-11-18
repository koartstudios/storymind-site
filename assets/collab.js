/* ============================================================
   STORYMIND — COLABORAÇÃO EM TEMPO REAL
   Carregar DEPOIS de cloud.js e live-sync.js no app.html.

   O QUE FAZ:
   1. Edição instantânea (~0,1 s): envia SÓ o que mudou (um "delta") a quem está
      com a mesma história aberta (outras abas, outros aparelhos, outras pessoas).
      Quem recebe aplica com a mesma regra da mesclagem completa (live-sync.js).
   2. Presença: mostra quem está online na história.
   3. Cursores e "fulana está editando este nó".

   SEGURANÇA:
   - O canal é PRIVADO: o banco só deixa entrar quem é dona da história ou foi
     convidada (regras no etapa3-supabase.sql). Quem só lê não transmite nada.
   - Tudo que vem de outras pessoas é validado/escapado antes de ir para a tela.

   A nuvem continua sendo a fonte de verdade: se um aviso se perder, a sincronização
   normal (cloud.js) corrige. Se este arquivo falhar, nada mais para de funcionar.
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
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function safeColor(c) { return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : '#6366f1'; }
    function num(v) { v = Number(v); return isFinite(v) ? v : 0; }

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

    // ---------- canal por história (PRIVADO) ----------
    let lastStatus = null;
    async function join(key) {
        if (!key) return;
        if (activeKey === key && channel) return;
        await leave();
        if (typeof sb === 'undefined' || !sb) return;
        activeKey = key;
        try { if (sb.realtime && typeof sb.realtime.setAuth === 'function') await sb.realtime.setAuth(); } catch (_) {}
        channel = sb.channel('story:' + key, {
            config: {
                private: true,                       // o banco confere se esta conta pode entrar (etapa3-supabase.sql)
                presence: { key: myDeviceId },
                broadcast: { self: false }
            }
        });

        channel.on('presence', { event: 'sync' }, () => renderPresence());
        channel.on('presence', { event: 'join' }, () => renderPresence());
        channel.on('presence', { event: 'leave' }, () => renderPresence());

        // Edição instantânea: só o que mudou. (O formato antigo "story", que mandava a história inteira
        // e gravava por cima do armazenamento local, foi aposentado e é ignorado de propósito.)
        channel.on('broadcast', { event: 'delta' }, (msg) => {
            const p = msg && msg.payload;
            if (!p || p.from === myDeviceId || p.key !== activeKey || !p.delta) return;
            try { if (window.SM_LIVE && typeof window.SM_LIVE.onDelta === 'function') window.SM_LIVE.onDelta(p); } catch (_) {}
        });

        channel.on('broadcast', { event: 'focus' }, (msg) => {
            const p = msg && msg.payload;
            if (!p || p.from === myDeviceId) return;
            if (!p.nodeId) { delete focusPeers[p.from]; renderFocus(); return; }
            focusPeers[p.from] = { nodeId: String(p.nodeId).slice(0, 200), name: String(p.name || '?').slice(0, 40), color: safeColor(p.color), ts: Date.now() };
            renderFocus();
        });

        channel.on('broadcast', { event: 'cursor' }, (msg) => {
            if (!msg || !msg.payload) return;
            if (msg.payload.from === myDeviceId) return;
            peers[msg.payload.from] = {
                name: String(msg.payload.name || '?').slice(0, 40),
                color: safeColor(msg.payload.color),
                x: num(msg.payload.x), y: num(msg.payload.y),
                ts: Date.now()
            };
            renderCursors();
        });

        channel.subscribe((status) => {
            lastStatus = status;
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
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                connected = false;
                if (status === 'CHANNEL_ERROR') console.info('[SM_COLLAB] canal privado indisponível. Rode o etapa3-supabase.sql no Supabase. A sincronização normal continua funcionando.');
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
        focusPeers = {};
        lastFocusId = null;
        renderPresence();
        renderCursors();
        renderFocus();
    }

    // ---------- (aposentado) história inteira ----------
    // Antes, cada salvamento mandava a história INTEIRA e quem recebia gravava por cima do armazenamento local,
    // sem mesclar. Agora só circulam deltas (broadcastDelta) e a mesclagem fica a cargo do live-sync.js.
    function broadcastStory() { /* aposentado */ }

    // ---------- enviar delta (só o que mudou) ----------
    function broadcastDelta(key, delta) {
        if (!channel || !connected || !delta || key !== activeKey) return;
        try {
            channel.send({
                type: 'broadcast', event: 'delta',
                payload: { key: key, delta: delta, from: myDeviceId }
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

        // Cria uma barra integrada ao layout (não flutuante)
        bar = document.createElement('div');
        bar.id = 'sm-collab-bar';
        bar.className = 'sm-collab-bar flex items-center justify-between px-4 py-1.5 bg-slate-50 border-b border-slate-200 z-20 shrink-0';
        bar.style.cssText = 'font-family: Inter, sans-serif; font-size: 11px; color: #475569;';
        
        bar.innerHTML = `
            <div class="flex items-center gap-2">
                <i class="fa-solid fa-circle-nodes" style="color:#6366f1;font-size:11px"></i>
                <span class="font-semibold text-slate-600">online</span>
                <span id="sm-collab-label" class="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium" style="font-size:10px">só você</span>
            </div>
            <div id="sm-collab-avatars" class="flex items-center gap-1"></div>
        `;

        // Insere logo após o header principal
        const header = document.querySelector('body > header');
        if (header) {
            header.insertAdjacentElement('afterend', bar);
        } else {
            // Fallback caso não ache o header (ex: dashboard)
            document.body.prepend(bar);
        }

        // Injeta CSS para Dark Mode e Mobile
        const style = document.createElement('style');
        style.textContent = `
            body.app-theme-dark .sm-collab-bar { background: #1e293b !important; border-color: #334155 !important; color: #94a3b8; }
            body.app-theme-dark .sm-collab-bar span#sm-collab-label { background: #334155; color: #cbd5e1; }
            @media (max-width: 640px) {
                .sm-collab-bar { display: none !important; } /* Esconde no mobile para não roubar tela */
            }
        `;
        document.head.appendChild(style);

        return bar;
    }
        function renderPresence() {
        const bar = ensureBar();
        if (!bar) return;
        const label = bar.querySelector('#sm-collab-label');
        const avatars = bar.querySelector('#sm-collab-avatars');
        
        const state = channel && channel.presenceState ? channel.presenceState() : {};
        const ids = Object.keys(state || {});
        const others = ids.filter(id => id !== myDeviceId);

        if (others.length === 0) {
            label.textContent = 'só você';
            label.className = 'bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full font-medium';
            avatars.innerHTML = '';
            return;
        }

        label.textContent = others.length + ' online';
        label.className = 'bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold';
        
        avatars.innerHTML = others.map(id => {
            const meta = (state[id] && state[id][0]) || {};
            const color = safeColor(meta.color);
            const initials = esc((meta.name || '?').slice(0, 2).toUpperCase());
            // Avatar circular compacto com a inicial do nome
            return `<span title="${esc(meta.name || '')}" style="width:22px;height:22px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:10px;display:inline-flex;align-items:center;justify-content:center;margin-left:-4px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.1)">${initials}</span>`;
        }).join('');
    }

    // ---------- UI: "fulana está editando este nó" ----------
    const FOCUS_TTL_MS = 12000;
    let focusPeers = {};          // deviceId -> { nodeId, name, color, ts }
    let lastFocusId = null, lastFocusSent = 0, lastFocusSig = '', focusLayer = null;

    function myFocusNodeId() {
        try {
            if (typeof editingNodeId !== 'undefined' && editingNodeId) return String(editingNodeId);
            const side = document.getElementById('inspector-sidebar');
            if (side && !side.classList.contains('translate-x-full')) {
                const f = document.getElementById('edit-node-id');
                if (f && f.value) return String(f.value);
            }
        } catch (_) {}
        return null;
    }
    function broadcastFocus(nodeId) {
        if (!channel || !connected) return;
        try { if (window.SM_CLOUD && activeKey && window.SM_CLOUD.roleOf(activeKey) === 'viewer') return; } catch (_) {}
        try {
            channel.send({
                type: 'broadcast', event: 'focus',
                payload: { nodeId: nodeId, from: myDeviceId, name: myUser ? myUser.name : '?', color: myColor }
            });
        } catch (_) {}
    }
    function ensureFocusLayer() {
        if (focusLayer) return focusLayer;
        focusLayer = document.createElement('div');
        focusLayer.id = 'sm-collab-focus';
        focusLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:74';
        document.body.appendChild(focusLayer);
        return focusLayer;
    }
    function renderFocus() {
        const layer = ensureFocusLayer();
        const now = Date.now();
        Object.keys(focusPeers).forEach(id => { if (!focusPeers[id].nodeId || now - focusPeers[id].ts > FOCUS_TTL_MS) delete focusPeers[id]; });
        const marks = [];
        Object.keys(focusPeers).forEach(id => {
            const p = focusPeers[id];
            let el = null;
            try { el = document.querySelector('[data-node-id="' + CSS.escape(p.nodeId) + '"]'); } catch (_) {}
            if (!el) return;
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) return;
            marks.push({ l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), color: p.color, name: p.name });
        });
        const sig = JSON.stringify(marks);
        if (sig === lastFocusSig) return;                       // nada mudou: não mexe no DOM (evita piscar)
        lastFocusSig = sig;
        layer.innerHTML = marks.map(m =>
            `<div style="position:absolute;left:${m.l - 3}px;top:${m.t - 3}px;width:${m.w + 6}px;height:${m.h + 6}px;border:2px solid ${m.color};border-radius:12px"></div>` +
            `<div style="position:absolute;left:${m.l - 3}px;top:${m.t - 21}px;background:${m.color};color:#fff;font:600 10px Inter,sans-serif;padding:2px 6px;border-radius:6px 6px 6px 0;white-space:nowrap">✎ ${esc(m.name)} editando</div>`
        ).join('');
    }
    function focusTick() {
        try {
            const k = currentKey();
            if (k && k !== activeKey) join(k);                  // trocou de história por outro caminho
            const id = myFocusNodeId(), now = Date.now();
            if (id !== lastFocusId || (id && now - lastFocusSent > 5000)) {
                lastFocusId = id; lastFocusSent = now; broadcastFocus(id);
            }
            renderFocus();
        } catch (_) {}
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
            el.style.cssText = `position:absolute;left:${num(c.x)}px;top:${num(c.y)}px;pointer-events:none`;
            el.innerHTML =
                `<svg width="18" height="24" viewBox="0 0 18 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))">
                    <path d="M0 0 L0 18 L5 13 L9 22 L12 20 L8 12 L15 12 Z" fill="${c.color}" stroke="#fff" stroke-width="1.5"/>
                </svg>
                <span style="position:absolute;left:14px;top:14px;background:${c.color};color:#fff;font:600 10px Inter,sans-serif;padding:2px 6px;border-radius:6px;white-space:nowrap">${esc(c.name)}</span>`;
            layer.appendChild(el);
        });
    }

    // ---------- hooks no app existente ----------
    // (hookSave aposentado: o envio agora é feito pelo cloud.js, só com o que mudou)
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
        setInterval(() => { hookSwitch(); }, 2000);
        hookSwitch(); hookCursor();
        setInterval(focusTick, 500);

        const k = currentKey();
        if (k) setTimeout(() => join(k), 800);

        console.info('[SM_COLLAB] ativo. device=' + myDeviceId + ' key=' + (k || '(nenhuma)'));
    }

    window.SM_COLLAB = {
        init, join, leave, broadcastStory, broadcastDelta, broadcastCursor,
        isConnected: () => connected,
        get status() { return lastStatus; },
        get activeKey() { return activeKey; },
        _t: { esc, safeColor, focusTick, renderFocus, focusPeers: () => focusPeers }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();