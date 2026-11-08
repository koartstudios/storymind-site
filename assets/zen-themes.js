/* ============================================================
   STORYMIND PRO — MÓDULO: MODO ZEN & KITS DE ESTILO (Final)
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_ZEN_THEMES_LOADED) return;
    window.SM_ZEN_THEMES_LOADED = true;

    // ---------- 1. Injeção do CSS ----------
    function injectCSS() {
        if (document.getElementById('sm-zen-themes-css')) return;
        const style = document.createElement('style');
        style.id = 'sm-zen-themes-css';
        style.textContent = `
            /* --- KITS DE ESTILO --- */
            .theme-midnight { --canvas-bg: #0f172a; --dot-color: #1e293b; --line-color: #334155; }
            .theme-ink { --canvas-bg: #fafafa; --dot-color: #e4e4e7; --line-color: #d4d4d8; }
            .theme-mk { --canvas-bg: #120000; --dot-color: #2a0808; --line-color: #991b1b; }

            /* --- MODO ZEN --- */
            body.zen-mode header,
            body.zen-mode aside,
            body.zen-mode #tension-strip,
            body.zen-mode #sheet-tabs-bar,
            body.zen-mode #outline-tab,
            body.zen-mode #sm-mobile-nav,
            body.zen-mode #sm-mobile-toolbar,
            body.zen-mode #align-toolbar,
            body.zen-mode #sm-mobile-zoom-selected { 
                display: none !important; 
            }
            body.zen-mode { padding-bottom: 0 !important; overflow: hidden; }
            body.zen-mode .flex-1.flex.relative { height: 100vh !important; }

            #sm-zen-exit-btn {
                display: none;
                position: fixed; top: 20px; right: 20px; z-index: 9999;
                background: rgba(15, 23, 42, 0.85); color: white;
                border: 1px solid rgba(255,255,255,0.2); border-radius: 999px;
                padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3); backdrop-filter: blur(8px);
                align-items: center; gap: 6px; transition: background 0.2s;
            }
            #sm-zen-exit-btn:hover { background: rgba(15, 23, 42, 1); }
            body.zen-mode #sm-zen-exit-btn { display: inline-flex; }
        `;
        document.head.appendChild(style);
    }

    // ---------- 2. Lógica do Modo Zen ----------
    window.toggleZenMode = function () {
        const isZen = document.body.classList.toggle('zen-mode');
        
        const btn = document.getElementById('btn-zen');
        if (btn) {
            if (isZen) btn.className = 'w-10 h-10 rounded-xl text-indigo-600 bg-indigo-50 hover:bg-indigo-100 flex items-center justify-center transition shadow-sm';
            else btn.className = 'w-10 h-10 rounded-xl text-slate-600 hover:bg-slate-100 flex items-center justify-center transition';
        }

        setTimeout(() => {
            if (typeof renderApp === 'function') renderApp();
            if (typeof fitView === 'function') fitView();
        }, 60);

        if (isZen && typeof showToast === 'function') {
            showToast('Modo Zen ativado. Pressione Esc ou Ctrl+Shift+Z para sair.', 'info', 3000);
        }
    };

    // ---------- 3. Substituição do Sistema de Temas ----------
    window.applyTheme = function (theme) {
        const container = document.getElementById('canvas-container');
        if (!container) return;

        container.classList.remove('theme-dark', 'theme-paper', 'theme-midnight', 'theme-ink', 'theme-mk');
        
        if (theme !== 'default') {
            container.classList.add('theme-' + theme);
        }

        const isDark = ['dark', 'midnight', 'mk'].includes(theme);
        document.body.classList.toggle('app-theme-dark', isDark);

        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) themeSelect.value = theme;
        
        if (typeof renderMinimap === 'function') renderMinimap();
    };

    // ---------- 4. Injeção de UI (Botões e Opções) ----------
    function injectUI() {
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect && !themeSelect.querySelector('option[value="midnight"]')) {
            const options = [
                { value: 'midnight', text: 'Midnight (Azul)' },
                { value: 'ink', text: 'Nanquim (Tinta)' },
                { value: 'mk', text: 'Mortal Kombat' }
            ];
            options.forEach(opt => {
                const el = document.createElement('option');
                el.value = opt.value;
                el.textContent = opt.text;
                themeSelect.appendChild(el);
            });
        }

        const headerActions = document.querySelector('body > header > div:nth-child(2)');
        if (headerActions && !document.getElementById('sm-zen-header-btn')) {
            const zenBtn = document.createElement('button');
            zenBtn.id = 'sm-zen-header-btn';
            zenBtn.className = 'bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg text-xs font-medium transition';
            zenBtn.title = 'Modo Zen (Ctrl+Shift+Z)';
            zenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
            zenBtn.onclick = window.toggleZenMode;
            
            const exportWrap = document.getElementById('export-menu-wrap');
            if (exportWrap) headerActions.insertBefore(zenBtn, exportWrap);
            else headerActions.appendChild(zenBtn);
        }

        if (!document.getElementById('sm-zen-exit-btn')) {
            const exitBtn = document.createElement('button');
            exitBtn.id = 'sm-zen-exit-btn';
            exitBtn.innerHTML = '<i class="fa-solid fa-compress"></i> Sair do Modo Zen';
            exitBtn.onclick = window.toggleZenMode;
            document.body.appendChild(exitBtn);
        }
    }

    // ---------- 5. Atalhos de Teclado ----------
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyZ') {
            e.preventDefault();
            window.toggleZenMode();
            return;
        }
        if (e.key === 'Escape' && document.body.classList.contains('zen-mode')) {
            e.preventDefault();
            window.toggleZenMode();
            return;
        }
    }, true);

    // ---------- 6. Init ----------
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { injectCSS(); injectUI(); });
    } else {
        injectCSS(); injectUI();
    }
})();