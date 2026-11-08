/* ============================================================
   STORYMIND PRO — MÓDULO: MAGIC WRITE (IA Simulada)
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_MAGIC_WRITE_LOADED) return;
    window.SM_MAGIC_WRITE_LOADED = true;

    function injectCSS() {
        if (document.getElementById('sm-magic-css')) return;
        const style = document.createElement('style');
        style.id = 'sm-magic-css';
        style.textContent = `
            #sm-magic-modal {
                position: fixed; inset: 0; z-index: 9999;
                background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px);
                display: none; align-items: center; justify-content: center; padding: 20px;
            }
            #sm-magic-modal.active { display: flex; }
            
            .sm-magic-panel {
                background: white; width: 100%; max-width: 600px; border-radius: 16px;
                box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); overflow: hidden;
                display: flex; flex-direction: column;
                animation: sm-magic-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes sm-magic-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

            body.app-theme-dark .sm-magic-panel { background: #1e293b; border: 1px solid #334155; }

            .sm-magic-header {
                padding: 16px 20px; border-bottom: 1px solid #e2e8f0;
                display: flex; justify-content: space-between; align-items: center;
                background: linear-gradient(135deg, #f0fdf4, #dcfce7);
            }
            body.app-theme-dark .sm-magic-header { background: #064e3b; border-bottom-color: #334155; }
            
            .sm-magic-title {
                font-weight: 800; font-size: 14px; color: #166534;
                display: flex; align-items: center; gap: 8px; text-transform: uppercase; letter-spacing: 0.05em;
            }
            body.app-theme-dark .sm-magic-title { color: #6ee7b7; }
            .sm-magic-title i { font-size: 18px; animation: sm-magic-pulse 2s infinite; }
            @keyframes sm-magic-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.1); } }

            .sm-magic-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
            
            .sm-magic-field label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 6px; letter-spacing: 0.05em; }
            .sm-magic-field input, .sm-magic-field select {
                width: 100%; padding: 10px 14px; border-radius: 8px; border: 1px solid #cbd5e1;
                font-size: 13px; outline: none; background: #f8fafc; color: #1e293b;
            }
            .sm-magic-field input:focus, .sm-magic-field select:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.15); }
            
            .sm-magic-result {
                width: 100%; min-height: 150px; max-height: 300px; padding: 14px;
                border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc;
                font-size: 13px; line-height: 1.6; color: #1e293b; resize: vertical; outline: none;
            }
            body.app-theme-dark .sm-magic-result { background: #0f172a; border-color: #475569; color: #e2e8f0; }

            .sm-magic-footer {
                padding: 16px 20px; border-top: 1px solid #e2e8f0;
                display: flex; justify-content: flex-end; gap: 10px; background: #f8fafc;
            }
            body.app-theme-dark .sm-magic-footer { background: #0f172a; border-top-color: #334155; }
            
            .sm-magic-btn {
                padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s;
            }
            .sm-magic-btn.primary { background: #10b981; color: white; display: flex; align-items: center; gap: 6px; }
            .sm-magic-btn.primary:hover { background: #059669; }
            .sm-magic-btn.primary:disabled { background: #a7f3d0; cursor: wait; }
            .sm-magic-btn.secondary { background: #e2e8f0; color: #475569; }
            .sm-magic-btn.secondary:hover { background: #cbd5e1; }
            body.app-theme-dark .sm-magic-btn.secondary { background: #334155; color: #cbd5e1; }

            /* Botão no Inspector */
            #sm-magic-trigger-btn {
                width: 100%; margin-top: 8px; padding: 8px; border-radius: 8px;
                background: linear-gradient(135deg, #ecfdf5, #d1fae5); border: 1px solid #a7f3d0;
                color: #047857; font-size: 12px; font-weight: 700; cursor: pointer;
                display: flex; align-items: center; justify-content: center; gap: 8px;
                transition: all 0.2s;
            }
            #sm-magic-trigger-btn:hover { background: #a7f3d0; box-shadow: 0 2px 8px rgba(16,185,129,0.2); }
            body.app-theme-dark #sm-magic-trigger-btn { background: #064e3b; border-color: #065f46; color: #6ee7b7; }
        `;
        document.head.appendChild(style);
    }

    function injectModal() {
        if (document.getElementById('sm-magic-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'sm-magic-modal';
        modal.innerHTML = `
            <div class="sm-magic-panel">
                <div class="sm-magic-header">
                    <div class="sm-magic-title"><i class="fa-solid fa-wand-magic-sparkles"></i> Magic Write</div>
                    <button onclick="document.getElementById('sm-magic-modal').classList.remove('active')" style="background:none;border:none;font-size:18px;color:#166534;cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="sm-magic-body">
                    <div class="sm-magic-field">
                        <label>O que você quer gerar?</label>
                        <select id="sm-magic-type">
                            <option value="description">Descrição completa do nó</option>
                            <option value="scene">Detalhes de cena (objetivo, conflito)</option>
                            <option value="character">Aprofundar personagem (arco)</option>
                        </select>
                    </div>
                    <div class="sm-magic-field">
                        <label>Instruções extras (opcional)</label>
                        <input type="text" id="sm-magic-prompt" placeholder="Ex: Foque em um tom sombrio e misterioso...">
                    </div>
                    <div class="sm-magic-field">
                        <label>Resultado gerado</label>
                        <textarea id="sm-magic-result" class="sm-magic-result" placeholder="O texto gerado pela IA aparecerá aqui..."></textarea>
                    </div>
                </div>
                <div class="sm-magic-footer">
                    <button class="sm-magic-btn secondary" onclick="document.getElementById('sm-magic-modal').classList.remove('active')">Cancelar</button>
                    <button class="sm-magic-btn primary" id="sm-magic-generate-btn" onclick="window.executeMagicWrite()"><i class="fa-solid fa-bolt"></i> Gerar Texto</button>
                    <button class="sm-magic-btn primary" id="sm-magic-apply-btn" onclick="window.applyMagicWrite()" style="background:#4f46e5; display:none;"><i class="fa-solid fa-check"></i> Aplicar no Nó</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // --- Lógica do Magic Write ---
    let activeMagicNodeId = null;

    window.openMagicWrite = function (nodeId) {
        activeMagicNodeId = nodeId;
        const modal = document.getElementById('sm-magic-modal');
        document.getElementById('sm-magic-result').value = '';
        document.getElementById('sm-magic-prompt').value = '';
        document.getElementById('sm-magic-apply-btn').style.display = 'none';
        document.getElementById('sm-magic-generate-btn').style.display = 'flex';
        
        // Pré-seleciona o tipo baseado no nó
        const node = getNode(nodeId);
        const typeSelect = document.getElementById('sm-magic-type');
        if (node && node.type === 'scene') typeSelect.value = 'scene';
        else if (node && node.type === 'character') typeSelect.value = 'character';
        else typeSelect.value = 'description';

        modal.classList.add('active');
    };

    window.executeMagicWrite = async function () {
        const node = getNode(activeMagicNodeId);
        if (!node) return;

        const type = document.getElementById('sm-magic-type').value;
        const prompt = document.getElementById('sm-magic-prompt').value;
        const resultEl = document.getElementById('sm-magic-result');
        const genBtn = document.getElementById('sm-magic-generate-btn');

        genBtn.disabled = true;
        genBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Gerando...';
        resultEl.value = '';

        // =====================================================================
        // SIMULAÇÃO DE IA (Substitua este bloco por uma chamada real à OpenAI)
        // =====================================================================
        await new Promise(r => setTimeout(r, 1500)); // Simula o delay da rede

        let generatedText = '';
        const title = node.title;

        if (type === 'description') {
            generatedText = `A cena se desenrola em um ambiente onde ${title} assume papel central. Há uma tensão palpável no ar, sugerindo que escolhas importantes precisam ser feitas. ${prompt ? prompt + '. ' : ''}A atmosfera é densa, e cada detalhe parece carregar um significado oculto, preparando o terreno para o próximo grande conflito da narrativa.`;
        } else if (type === 'scene') {
            generatedText = `**Objetivo:** O protagonista busca ${title}. \n**Conflito:** Um obstáculo inesperado surge, testando a determinação do personagem. \n**Ação:** O personagem tenta contornar a situação usando seus recursos, mas o custo é alto. ${prompt ? '\n**Subtexto:** ' + prompt : ''}`;
        } else if (type === 'character') {
            generatedText = `${title} carrega um fardo invisível. Seu desejo externo de alcançar seus objetivos conflita diretamente com sua necessidade interna de aceitação. ${prompt ? 'Sob a superfície: ' + prompt : ''} O arco deste personagem exige que ele sacrifique algo valioso para descobrir sua verdadeira força.`;
        }

        // =====================================================================
        // FIM DA SIMULAÇÃO
        // =====================================================================

        resultEl.value = generatedText;
        genBtn.disabled = false;
        genBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Gerar Novamente';
        
        document.getElementById('sm-magic-generate-btn').style.display = 'none';
        document.getElementById('sm-magic-apply-btn').style.display = 'flex';
    };

    window.applyMagicWrite = function () {
        const node = getNode(activeMagicNodeId);
        if (!node) return;

        const resultText = document.getElementById('sm-magic-result').value;
        if (!resultText) return;

        pushHistory();
        
        // Atualiza o nó com o texto gerado
        node.content = (node.content ? node.content + '\n\n' : '') + resultText;
        
        // Fecha o modal ANTES de mexer no inspector
        document.getElementById('sm-magic-modal').classList.remove('active');
        
        // ⬇️ CORREÇÃO: Atualiza o textarea do inspector diretamente
        // para evitar que o saveCurrentNodeChanges sobrescreva com o valor antigo
        const textarea = document.getElementById('edit-node-content');
        if (textarea) {
            textarea.value = node.content;
        }
        
        saveStoriesStorage();
        renderApp();
        
        // Reabre o inspector com o texto atualizado
        setTimeout(() => {
            if (typeof openInspectorFor === 'function') openInspectorFor(node.id);
        }, 30);

        if (typeof showToast === 'function') showToast('Texto mágico aplicado ao nó!', 'success', 2500);
    };

    // --- Integração com o Inspector ---
    // Sobrescreve a função openInspectorFor original para injetar o botão
    const originalOpenInspector = window.openInspectorFor;
    if (typeof originalOpenInspector === 'function') {
        window.openInspectorFor = function (nodeId) {
            originalOpenInspector.apply(this, arguments);
            
            // Injeta o botão do Magic Write perto do campo de conteúdo
            const contentArea = document.getElementById('edit-node-content');
            if (contentArea && !document.getElementById('sm-magic-trigger-btn')) {
                const btn = document.createElement('button');
                btn.id = 'sm-magic-trigger-btn';
                btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Gerar com IA (Magic Write)';
                btn.onclick = () => window.openMagicWrite(nodeId);
                
                // Coloca logo após o textarea de conteúdo
                contentArea.parentNode.insertBefore(btn, contentArea.nextSibling);
            }
        };
    }

    // Init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { injectCSS(); injectModal(); });
    } else {
        injectCSS(); injectModal();
    }
})();