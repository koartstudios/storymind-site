/* ============================================================
   STORYMIND PRO — MÓDULO: PITCH MODE (Slide Deck v3)
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_PITCH_MODE_LOADED) return;
    window.SM_PITCH_MODE_LOADED = true;

    let pitchSlides = [];
    let pitchIndex = 0;
    let isPitchActive = false;
    const MAX_CHILDREN_PER_SLIDE = 4; // Define quantos filhos cabem em uma tela antes de paginar

    function injectCSS() {
        if (document.getElementById('sm-pitch-css')) return;
        const style = document.createElement('style');
        style.id = 'sm-pitch-css';
        style.textContent = `
            #sm-pitch-overlay {
                position: fixed; inset: 0; z-index: 10000;
                background: #f8fafc;
                display: none; flex-direction: column;
                font-family: 'Inter', sans-serif;
                animation: sm-pitch-fade 0.3s ease;
            }
            #sm-pitch-overlay.active { display: flex; }
            @keyframes sm-pitch-fade { from { opacity: 0; } to { opacity: 1; } }

            body.app-theme-dark #sm-pitch-overlay { background: #0f172a; color: white; }

            .sm-pitch-header {
                padding: 30px 50px; display: flex; justify-content: space-between; align-items: center;
                border-bottom: 1px solid #e2e8f0; background: white;
            }
            body.app-theme-dark .sm-pitch-header { background: #1e293b; border-bottom-color: #334155; }
            
            .sm-pitch-brand { font-size: 12px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #6366f1; display: flex; align-items: center; gap: 8px; }
            
            .sm-pitch-close-btn {
                background: transparent; border: 1px solid #cbd5e1; color: #64748b; padding: 8px 16px;
                border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
            }
            .sm-pitch-close-btn:hover { background: #f1f5f9; color: #0f172a; }
            body.app-theme-dark .sm-pitch-close-btn { border-color: #475569; color: #cbd5e1; }
            body.app-theme-dark .sm-pitch-close-btn:hover { background: #334155; color: white; }

            .sm-pitch-body {
                flex: 1; overflow-y: auto; padding: 40px 50px;
                display: flex; flex-direction: column; align-items: center;
            }

            .sm-pitch-container {
                width: 100%; max-width: 1100px; display: flex; flex-direction: column; gap: 30px;
            }

            /* Cabeçalho do Slide (Pai) */
            .sm-pitch-parent {
                text-align: center; padding-bottom: 20px;
            }
            .sm-pitch-parent-title {
                font-size: 36px; font-weight: 900; color: #0f172a; line-height: 1.2; margin-bottom: 12px;
            }
            body.app-theme-dark .sm-pitch-parent-title { color: #f8fafc; }
            
            .sm-pitch-parent-desc {
                font-size: 16px; color: #475569; max-width: 800px; margin: 0 auto; line-height: 1.6;
                background: #f1f5f9; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0;
            }
            body.app-theme-dark .sm-pitch-parent-desc { background: #1e293b; color: #cbd5e1; border-color: #334155; }

            /* Grid de Filhos */
            .sm-pitch-grid {
                display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;
                margin-top: 20px;
            }
            @media (max-width: 900px) { .sm-pitch-grid { grid-template-columns: 1fr; } }

            .sm-pitch-card {
                background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;
                box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); position: relative;
                display: flex; flex-direction: column; gap: 10px;
            }
            body.app-theme-dark .sm-pitch-card { background: #1e293b; border-color: #334155; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2); }

            .sm-pitch-card-title { font-size: 18px; font-weight: 700; color: #0f172a; }
            body.app-theme-dark .sm-pitch-card-title { color: #f1f5f9; }
            
            .sm-pitch-card-meta { display: flex; gap: 8px; flex-wrap: wrap; }
            .sm-pitch-badge {
                padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 700; color: white;
            }
            
            .sm-pitch-card-content {
                font-size: 13px; color: #64748b; line-height: 1.5; flex: 1;
                display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
            }
            body.app-theme-dark .sm-pitch-card-content { color: #94a3b8; }

            /* Controles inferiores */
            .sm-pitch-controls {
                padding: 20px 50px; background: white; border-top: 1px solid #e2e8f0;
                display: flex; justify-content: space-between; align-items: center;
            }
            body.app-theme-dark .sm-pitch-controls { background: #1e293b; border-top-color: #334155; }

            .sm-pitch-nav { display: flex; gap: 10px; }
            .sm-pitch-btn {
                background: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; padding: 10px 20px;
                border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;
                display: flex; align-items: center; gap: 8px;
            }
            .sm-pitch-btn:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
            .sm-pitch-btn:disabled { opacity: 0.4; cursor: not-allowed; }
            body.app-theme-dark .sm-pitch-btn { background: #334155; border-color: #475569; color: #cbd5e1; }
            body.app-theme-dark .sm-pitch-btn:hover:not(:disabled) { background: #475569; color: white; }

            .sm-pitch-counter {
                font-size: 14px; font-weight: 700; color: #94a3b8; font-family: ui-monospace, monospace;
            }
            .sm-pitch-page-info { font-size: 12px; color: #6366f1; font-weight: 600; background: #e0e7ff; padding: 4px 12px; border-radius: 99px; }
            body.app-theme-dark .sm-pitch-page-info { background: #312e81; color: #c7d2fe; }
        `;
        document.head.appendChild(style);
    }

    function injectUI() {
        if (document.getElementById('sm-pitch-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'sm-pitch-overlay';
        overlay.innerHTML = `
            <div class="sm-pitch-header">
                <div class="sm-pitch-brand"><i class="fa-solid fa-play"></i> Pitch Mode</div>
                <button class="sm-pitch-close-btn" onclick="window.exitPitchMode()"><i class="fa-solid fa-xmark mr-1"></i> Sair (Esc)</button>
            </div>
            
            <div class="sm-pitch-body">
                <div class="sm-pitch-container" id="sm-pitch-slide-content">
                    <!-- O slide é injetado aqui -->
                </div>
            </div>

            <div class="sm-pitch-controls">
                <div class="sm-pitch-nav">
                    <button class="sm-pitch-btn" id="sm-pitch-prev" onclick="window.pitchNavigate(-1)"><i class="fa-solid fa-arrow-left"></i> Anterior</button>
                    <button class="sm-pitch-btn" id="sm-pitch-next" onclick="window.pitchNavigate(1)">Próximo <i class="fa-solid fa-arrow-right"></i></button>
                </div>
                <span class="sm-pitch-counter" id="sm-pitch-counter">1 / 1</span>
            </div>
        `;
        document.body.appendChild(overlay);

        // Botão no header do app para iniciar
        const headerActions = document.querySelector('body > header > div:nth-child(2)');
        if (headerActions && !document.getElementById('sm-pitch-header-btn')) {
            const btn = document.createElement('button');
            btn.id = 'sm-pitch-header-btn';
            btn.className = 'bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium transition shadow-sm flex items-center gap-1.5';
            btn.title = 'Iniciar Modo Apresentação';
            btn.innerHTML = '<i class="fa-solid fa-play"></i><span class="hidden md:inline">Pitch</span>';
            btn.onclick = window.startPitchMode;
            
            const exportWrap = document.getElementById('export-menu-wrap');
            if (exportWrap) headerActions.insertBefore(btn, exportWrap);
            else headerActions.appendChild(btn);
        }
    }

    // --- Lógica de Construção dos Slides ---
    function buildPitchSlides() {
        const roots = mindMapData.nodes.filter(n => !n.parentId);
        const slides = [];
        
        roots.forEach(root => {
            const children = mindMapData.nodes.filter(n => n.parentId === root.id);
            
            if (children.length === 0) {
                // Se não tem filhos, é um slide só com ele
                slides.push({ root, children: [], part: 1, totalParts: 1 });
            } else {
                // Se tem filhos, pagina de MAX_CHILDREN_PER_SLIDE em MAX_CHILDREN_PER_SLIDE
                const totalParts = Math.ceil(children.length / MAX_CHILDREN_PER_SLIDE);
                for (let i = 0; i < totalParts; i++) {
                    const chunk = children.slice(i * MAX_CHILDREN_PER_SLIDE, (i + 1) * MAX_CHILDREN_PER_SLIDE);
                    slides.push({ 
                        root, 
                        children: chunk, 
                        part: i + 1, 
                        totalParts 
                    });
                }
            }
        });
        return slides;
    }

    window.startPitchMode = function () {
        pitchSlides = buildPitchSlides();
        if (pitchSlides.length === 0) {
            if (typeof showToast === 'function') showToast('Não há nós para apresentar.', 'warn');
            return;
        }
        pitchIndex = 0;
        isPitchActive = true;
        document.getElementById('sm-pitch-overlay').classList.add('active');
        updatePitchView();
    };

    window.exitPitchMode = function () {
        isPitchActive = false;
        document.getElementById('sm-pitch-overlay').classList.remove('active');
    };

    window.pitchNavigate = function (dir) {
        if (!isPitchActive) return;
        const nextIndex = pitchIndex + dir;
        if (nextIndex >= 0 && nextIndex < pitchSlides.length) {
            pitchIndex = nextIndex;
            updatePitchView();
            document.querySelector('.sm-pitch-body').scrollTop = 0; // Volta pro topo no novo slide
        }
    };

    function updatePitchView() {
        const slide = pitchSlides[pitchIndex];
        if (!slide) return;
        const { root, children, part, totalParts } = slide;

        const contentEl = document.getElementById('sm-pitch-slide-content');
        const counterEl = document.getElementById('sm-pitch-counter');
        const prevBtn = document.getElementById('sm-pitch-prev');
        const nextBtn = document.getElementById('sm-pitch-next');

        counterEl.textContent = `Slide ${pitchIndex + 1} de ${pitchSlides.length}`;
        prevBtn.disabled = pitchIndex === 0;
        nextBtn.disabled = pitchIndex === pitchSlides.length - 1;

        // Badge do Pai
        let parentBadges = '';
        if (root.type && NODE_TYPES[root.type]) {
            parentBadges += `<span class="sm-pitch-badge" style="background:${NODE_TYPES[root.type].color}">${NODE_TYPES[root.type].label}</span>`;
        }
        if (totalParts > 1) {
            parentBadges += `<span class="sm-pitch-page-info">Parte ${part} de ${totalParts}</span>`;
        }

        // HTML do Cabeçalho (Pai)
        let html = `
            <div class="sm-pitch-parent">
                <div class="sm-pitch-card-meta" style="justify-content:center; margin-bottom:12px;">${parentBadges}</div>
                <h1 class="sm-pitch-parent-title">${escapeHTML(root.title)}</h1>
                ${root.content ? `<div class="sm-pitch-parent-desc">${escapeHTML(root.content)}</div>` : ''}
            </div>
        `;

        // HTML dos Filhos (Grid)
        if (children.length > 0) {
            html += `<div class="sm-pitch-grid">`;
            children.forEach(child => {
                let childBadges = '';
                if (child.type && NODE_TYPES[child.type]) {
                    childBadges += `<span class="sm-pitch-badge" style="background:${NODE_TYPES[child.type].color}">${NODE_TYPES[child.type].label}</span>`;
                }
                if (child.tension > 0) {
                    childBadges += `<span class="sm-pitch-badge" style="background:${tensionColor(child.tension)}">Tensão ${child.tension}/10</span>`;
                }

                html += `
                    <div class="sm-pitch-card">
                        <div class="sm-pitch-card-meta">${childBadges}</div>
                        <div class="sm-pitch-card-title">${escapeHTML(child.title)}</div>
                        <div class="sm-pitch-card-content">
                            ${child.content ? escapeHTML(child.content) : '<em>Sem detalhes...</em>'}
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
        }

        contentEl.innerHTML = html;
    }

    document.addEventListener('keydown', function(e) {
        if (!isPitchActive) return;
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); window.pitchNavigate(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); window.pitchNavigate(-1); }
        else if (e.key === 'Escape') { e.preventDefault(); window.exitPitchMode(); }
    }, true);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { injectCSS(); injectUI(); });
    else { injectCSS(); injectUI(); }
})();