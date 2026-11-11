/* ============================================================
   STORYMIND — ONBOARDING (auto-contido)
   Aguarda o app terminar de carregar (mindMapData async).
   Abre só se o mapa tiver ≤ 1 nó. Reabrível via ?onboarding=1
   ou window.SM_openOnboarding().
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_ONBOARDING_LOADED) return;
    window.SM_ONBOARDING_LOADED = true;

    const STORAGE_KEY = 'storymind_onboarding_done_v1';
    const DEBUG = true;  // mude para false quando estiver funcionando

    function log(...args) { if (DEBUG) console.log('[Onboarding]', ...args); }

    function injectCSS() {
        if (document.getElementById('sm-ob-css')) return;
        const s = document.createElement('style');
        s.id = 'sm-ob-css';
        s.textContent = `
            #sm-ob-modal { position: fixed; inset: 0; z-index: 9998;
                background: rgba(15,23,42,.55); backdrop-filter: blur(6px);
                display: none; align-items: center; justify-content: center; padding: 16px; }
            #sm-ob-modal.open { display: flex; }
            .sm-ob-panel { background: #fff; width: 100%; max-width: 720px;
                border-radius: 20px; box-shadow: 0 24px 60px -12px rgba(0,0,0,.45);
                overflow: hidden; animation: sm-ob-in .25s cubic-bezier(.16,1,.3,1);
                max-height: 92vh; display: flex; flex-direction: column; }
            @keyframes sm-ob-in { from { opacity:0; transform: translateY(12px) scale(.97); } to { opacity:1; transform:none; } }
            body.app-theme-dark .sm-ob-panel { background: #1e293b; }
            .sm-ob-hero { padding: 22px 24px 16px; background: linear-gradient(135deg, #eef2ff, #e0e7ff); border-bottom: 1px solid #c7d2fe; }
            body.app-theme-dark .sm-ob-hero { background: linear-gradient(135deg, #1e1b4b, #312e81); border-bottom-color: #334155; }
            .sm-ob-title { font-size: 18px; font-weight: 800; color: #4338ca; display: flex; align-items: center; gap: 8px; }
            body.app-theme-dark .sm-ob-title { color: #c7d2fe; }
            .sm-ob-sub { font-size: 12.5px; color: #6366f1; margin-top: 6px; line-height: 1.5; }
            body.app-theme-dark .sm-ob-sub { color: #a5b4fc; }
            .sm-ob-body { padding: 20px 24px 8px; overflow-y: auto; }
            .sm-ob-step-title { font-size: 11px; font-weight: 800; text-transform: uppercase;
                letter-spacing: .06em; color: #64748b; margin-bottom: 10px; }
            .sm-ob-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
            .sm-ob-card { text-align: left; padding: 16px 14px; border: 2px solid #e2e8f0;
                border-radius: 12px; background: #fff; cursor: pointer; transition: all .15s;
                display: flex; flex-direction: column; gap: 8px; min-height: 120px; }
            .sm-ob-card:hover { border-color: #a5b4fc; box-shadow: 0 8px 20px -8px rgba(99,102,241,.35); transform: translateY(-1px); }
            .sm-ob-card:active { transform: translateY(0); }
            body.app-theme-dark .sm-ob-card { background: #0f172a; border-color: #334155; color: #e2e8f0; }
            body.app-theme-dark .sm-ob-card:hover { border-color: #6366f1; }
            .sm-ob-card-icon { font-size: 24px; line-height: 1; }
            .sm-ob-card-title { font-size: 13px; font-weight: 800; color: #1e293b; }
            body.app-theme-dark .sm-ob-card-title { color: #f1f5f9; }
            .sm-ob-card-desc { font-size: 11.5px; color: #64748b; line-height: 1.45; }
            body.app-theme-dark .sm-ob-card-desc { color: #94a3b8; }
            .sm-ob-footer { padding: 14px 24px 20px; display: flex; justify-content: space-between;
                align-items: center; gap: 12px; border-top: 1px solid #e2e8f0; background: #f8fafc; }
            body.app-theme-dark .sm-ob-footer { background: #0f172a; border-top-color: #334155; }
            .sm-ob-skip { font-size: 12px; font-weight: 600; color: #64748b; background: transparent;
                border: none; cursor: pointer; padding: 8px 12px; border-radius: 8px; }
            .sm-ob-skip:hover { background: #f1f5f9; color: #475569; }
            body.app-theme-dark .sm-ob-skip:hover { background: #334155; color: #cbd5e1; }
            .sm-ob-tip { font-size: 11.5px; color: #64748b; font-style: italic; line-height: 1.5; }
            body.app-theme-dark .sm-ob-tip { color: #94a3b8; }
            @media (max-width: 640px) {
                .sm-ob-grid { grid-template-columns: 1fr; }
                .sm-ob-title { font-size: 16px; }
                .sm-ob-card { min-height: 92px; padding: 12px; }
            }
        `;
        document.head.appendChild(s);
    }

    function mapReady() {
        return typeof mindMapData !== 'undefined'
            && mindMapData
            && Array.isArray(mindMapData.nodes);
    }

    function isNewUser() {
        if (!mapReady()) return false;
        return mindMapData.nodes.length <= 1;
    }

    function hasSeenOnboarding() {
        try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
    }
    function markSeen() {
        try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    }

    function waitForMapReady(maxMs = 20000) {
        return new Promise(resolve => {
            if (mapReady()) { log('mapa já pronto'); return resolve(); }
            const start = Date.now();
            const check = () => {
                if (mapReady()) { log('mapa ficou pronto em', Date.now() - start, 'ms'); return resolve(); }
                if (Date.now() - start > maxMs) { log('timeout esperando mapa'); return resolve(); }
                setTimeout(check, 200);
            };
            check();
        });
    }

    function buildModal() {
        if (document.getElementById('sm-ob-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'sm-ob-modal';
        modal.innerHTML = `
            <div class="sm-ob-panel" role="dialog" aria-labelledby="sm-ob-title">
                <div class="sm-ob-hero">
                    <div class="sm-ob-title" id="sm-ob-title">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                        <span>Bem-vindo ao StoryMind</span>
                    </div>
                    <div class="sm-ob-sub">
                        Um mapa vazio pode ser libertador — ou assustador. Escolha por onde quer começar. Não existe caminho errado: você pode criar qualquer um depois.
                    </div>
                </div>
                <div class="sm-ob-body">
                    <div class="sm-ob-step-title">Por onde quer começar?</div>
                    <div class="sm-ob-grid">
                        <button class="sm-ob-card" data-path="character">
                            <div class="sm-ob-card-icon">🧙</div>
                            <div class="sm-ob-card-title">Começar pela protagonista</div>
                            <div class="sm-ob-card-desc">Crio um nó de Personagem para você preencher nome, papel, desejo e necessidade. Costuma ser o motor de tudo.</div>
                        </button>
                        <button class="sm-ob-card" data-path="scene">
                            <div class="sm-ob-card-icon">🎬</div>
                            <div class="sm-ob-card-title">Começar pela primeira cena</div>
                            <div class="sm-ob-card-desc">Crio um nó de Cena para você preencher objetivo, conflito e valor em jogo. Ideal se você pensa em imagens.</div>
                        </button>
                        <button class="sm-ob-card" data-path="theme">
                            <div class="sm-ob-card-icon">🎭</div>
                            <div class="sm-ob-card-title">Começar pela história</div>
                            <div class="sm-ob-card-desc">Crio um nó de Tema para você escrever a declaração e o valor central. Bom se você tem a ideia mas não o caminho.</div>
                        </button>
                    </div>
                    <p class="sm-ob-tip" style="margin-top:16px;">
                        💡 <b>Depois de começar:</b> use o botão <i class="fa-solid fa-wand-magic-sparkles" style="color:#8b5cf6"></i> <b>Magic Write</b> no inspetor para expandir qualquer nó com IA, e explore as <b>Visualizações</b> (Storyboard, Outline, Timeline) no canto superior.
                    </p>
                </div>
                <div class="sm-ob-footer">
                    <button class="sm-ob-skip" data-action="skip">Começar com o mapa vazio</button>
                    <span style="font-size:10.5px;color:#94a3b8;">Não mostra de novo ao abrir</span>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        modal.querySelectorAll('[data-path]').forEach(btn => {
            btn.addEventListener('click', () => {
                const path = btn.getAttribute('data-path');
                try { createStarterNode(path); }
                catch (err) { console.error('[Onboarding] erro ao criar nó:', err); }
                close();
            });
        });
        modal.querySelector('[data-action="skip"]').addEventListener('click', close);
    }

    function createStarterNode(path) {
        log('createStarterNode', path);
        if (!mapReady() || mindMapData.nodes.length === 0) {
            log('mapa sem nós — abortando');
            return;
        }

        const root = mindMapData.nodes.find(n => !n.parentId) || mindMapData.nodes[0];
        log('root:', root && root.id, root && root.title);

        if (typeof createChild !== 'function') {
            log('createChild não existe — abortando');
            return;
        }
        const newNodeId = createChild(root.id);
        if (!newNodeId) { log('createChild devolveu null'); return; }

        const node = (typeof getNode === 'function') ? getNode(newNodeId) : null;
        if (!node) { log('getNode não achou o nó recém-criado'); return; }

        if (path === 'character') {
            node.type = 'character';
            node.title = 'Protagonista';
            node.content = 'Quem move a história? Quem o leitor vai seguir?';
            node.color = 'purple';
        } else if (path === 'scene') {
            node.type = 'scene';
            node.title = 'Primeira cena';
            node.content = 'Onde tudo começa. O que está em jogo?';
            node.color = 'blue';
        } else if (path === 'theme') {
            node.type = 'theme';
            node.title = 'Tema da história';
            node.content = 'Sobre o que essa história realmente é?';
            node.color = 'rose';
        }

        if (typeof pushHistory === 'function') pushHistory();
        if (typeof saveStoriesStorage === 'function') saveStoriesStorage();
        if (typeof selectedNodeIds !== 'undefined') {
            selectedNodeIds.clear();
            selectedNodeIds.add(newNodeId);
        }
        if (typeof renderApp === 'function') renderApp();
        if (typeof openInspectorFor === 'function') openInspectorFor(newNodeId);

        if (typeof showToast === 'function') {
            showToast('Nó criado! Preencha os detalhes no inspetor à direita.', 'success', 4000);
        }
        log('nó criado:', newNodeId, path);
    }

    function open() {
        log('open()');
        buildModal();
        const modal = document.getElementById('sm-ob-modal');
        if (modal) modal.classList.add('open');
    }

    function close() {
        const modal = document.getElementById('sm-ob-modal');
        if (modal) modal.classList.remove('open');
        markSeen();
    }

    /* Botão "?" auto-injetado no header — reabre o onboarding */
    function injectHelpButton() {
        const headerActions = document.querySelector('body > header > div:nth-child(2)');
        if (!headerActions || headerActions.querySelector('[data-sm-help]')) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-sm-help', '1');
        btn.title = 'Como começar';
        btn.className = 'bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg text-xs font-medium transition';
        btn.innerHTML = '<i class="fa-solid fa-circle-question"></i>';
        btn.addEventListener('click', open);
        // Insere antes do botão de configurações (⚙) se achar
        const settingsBtn = Array.from(headerActions.querySelectorAll('button'))
            .find(b => b.querySelector('.fa-gear'));
        if (settingsBtn && settingsBtn.parentNode === headerActions) {
            headerActions.insertBefore(btn, settingsBtn);
        } else {
            headerActions.appendChild(btn);
        }
        log('botão de ajuda injetado');
    }

    async function init() {
        injectCSS();
        await waitForMapReady();

        log('estado:', {
            mapReady: mapReady(),
            nodeCount: mapReady() ? mindMapData.nodes.length : null,
            isNewUser: isNewUser(),
            hasSeen: hasSeenOnboarding(),
            forceParam: new URLSearchParams(location.search).get('onboarding')
        });

        injectHelpButton();

        const force = new URLSearchParams(location.search).get('onboarding') === '1';
        if (force) {
            log('forçado por ?onboarding=1');
            setTimeout(open, 300);
            return;
        }
        if (isNewUser() && !hasSeenOnboarding()) {
            log('mostrando (novo usuário + nunca visto)');
            setTimeout(open, 900);
        } else {
            log('não mostrando');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { init(); }, { once: true });
    } else {
        init();
    }

    window.SM_openOnboarding = open;
    window.SM_resetOnboarding = function () {
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        log('reset — recarregue ou chame SM_openOnboarding()');
    };
})();