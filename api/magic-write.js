/* ============================================================
   StoryMind — proxy de IA (Vercel Serverless Function) · Google Gemini
   ------------------------------------------------------------
   Carregar DEPOIS do script principal do app:
     <script src="assets/magic-write.js"></script>

   A chamada à IA (Google Gemini) passa pelo proxy /api/magic-write
   (pasta api/ do projeto na Vercel). A chave fica SOMENTE na variável
   de ambiente GEMINI_API_KEY do servidor — nunca neste arquivo.
   O modelo também é escolhido no servidor (variável GEMINI_MODELS).

   Opcional (console ou outro script, antes de gerar):
     window.SM_MAGIC_ENDPOINT = '/api/magic-write';
   ============================================================ */
(function () {
    'use strict';
    if (window.SM_MAGIC_WRITE_LOADED) return;
    window.SM_MAGIC_WRITE_LOADED = true;

    const DEFAULT_ENDPOINT = '/api/magic-write';
    const MAX_NOTES_CHARS = 6000;
    const MAX_OUTPUT_TOKENS = 4096;   // modelos "pensantes" gastam parte disso raciocinando

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
                background: white; width: 100%; max-width: 650px; border-radius: 16px;
                box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); overflow: hidden;
                display: flex; flex-direction: column;
                animation: sm-magic-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                max-height: 90vh;
            }
            @keyframes sm-magic-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

            body.app-theme-dark .sm-magic-panel { background: #1e293b; border: 1px solid #334155; }

            .sm-magic-header {
                padding: 16px 20px; border-bottom: 1px solid #e2e8f0;
                display: flex; justify-content: space-between; align-items: center;
                background: linear-gradient(135deg, #f0fdf4, #dcfce7); flex-shrink: 0;
            }
            body.app-theme-dark .sm-magic-header { background: #064e3b; border-bottom-color: #334155; }

            .sm-magic-title {
                font-weight: 800; font-size: 14px; color: #166534;
                display: flex; align-items: center; gap: 8px; text-transform: uppercase; letter-spacing: 0.05em;
            }
            body.app-theme-dark .sm-magic-title { color: #6ee7b7; }
            .sm-magic-title i { font-size: 18px; animation: sm-magic-pulse 2s infinite; }
            @keyframes sm-magic-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.1); } }

            .sm-magic-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }

            /* Painel de Contexto */
            .sm-magic-context-box {
                background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 12px;
                font-size: 11px; color: #475569; max-height: 120px; overflow-y: auto;
            }
            body.app-theme-dark .sm-magic-context-box { background: #0f172a; border-color: #475569; color: #cbd5e1; }
            .sm-magic-context-title { font-weight: 700; color: #3b82f6; margin-bottom: 6px; display: flex; align-items: center; gap: 4px; text-transform: uppercase; letter-spacing: 0.05em;}
            .sm-magic-context-item { margin-bottom: 3px; }
            .sm-magic-context-item b { color: #1e293b; }
            body.app-theme-dark .sm-magic-context-item b { color: #f1f5f9; }

            .sm-magic-field label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 6px; letter-spacing: 0.05em; }
            .sm-magic-field input, .sm-magic-field select {
                width: 100%; padding: 10px 14px; border-radius: 8px; border: 1px solid #cbd5e1;
                font-size: 13px; outline: none; background: #f8fafc; color: #1e293b;
            }
            .sm-magic-field input:focus, .sm-magic-field select:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.15); }

            .sm-magic-result {
                width: 100%; min-height: 150px; padding: 14px;
                border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc;
                font-size: 13px; line-height: 1.6; color: #1e293b; resize: vertical; outline: none;
            }
            .sm-magic-result.is-error { border-color: #fca5a5; background: #fef2f2; color: #991b1b; }
            body.app-theme-dark .sm-magic-result { background: #0f172a; border-color: #475569; color: #e2e8f0; }
            body.app-theme-dark .sm-magic-result.is-error { background: #450a0a; border-color: #7f1d1d; color: #fecaca; }

            .sm-magic-footer {
                padding: 16px 20px; border-top: 1px solid #e2e8f0;
                display: flex; justify-content: flex-end; gap: 10px; background: #f8fafc; flex-shrink: 0;
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

    function closeModal() {
        const m = document.getElementById('sm-magic-modal');
        if (m) m.classList.remove('active');
    }

    function injectModal() {
        if (document.getElementById('sm-magic-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'sm-magic-modal';
        modal.innerHTML = `
            <div class="sm-magic-panel">
                <div class="sm-magic-header">
                    <div class="sm-magic-title"><i class="fa-solid fa-wand-magic-sparkles"></i> Magic Write</div>
                    <button type="button" id="sm-magic-close" style="background:none;border:none;font-size:18px;color:#166534;cursor:pointer;" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="sm-magic-body">

                    <div class="sm-magic-context-box">
                        <div class="sm-magic-context-title"><i class="fa-solid fa-brain"></i> Contexto detectado no nó:</div>
                        <div id="sm-magic-context-content"></div>
                    </div>

                    <div class="sm-magic-field">
                        <label>O que você quer gerar?</label>
                        <select id="sm-magic-type">
                            <option value="description">Descrição expandida do nó</option>
                            <option value="scene">Desenvolver a Cena (com base nos campos)</option>
                            <option value="character">Aprofundar o Personagem (Arco)</option>
                            <option value="dialogue">Criar Diálogo (baseado no subtexto)</option>
                            <option value="worldbuilding">Expandir Cenário / Atmosfera</option>
                            <option value="object">Desenvolver o Objeto (história, regras e custo)</option>
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
                    <button type="button" class="sm-magic-btn secondary" id="sm-magic-cancel-btn">Cancelar</button>
                    <button type="button" class="sm-magic-btn primary" id="sm-magic-generate-btn"><i class="fa-solid fa-bolt"></i> Gerar Texto</button>
                    <button type="button" class="sm-magic-btn primary" id="sm-magic-apply-btn" style="background:#4f46e5; display:none;"><i class="fa-solid fa-check"></i> Aplicar no Nó</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('sm-magic-close').addEventListener('click', closeModal);
        document.getElementById('sm-magic-cancel-btn').addEventListener('click', closeModal);
        document.getElementById('sm-magic-generate-btn').addEventListener('click', () => window.executeMagicWrite());
        document.getElementById('sm-magic-apply-btn').addEventListener('click', () => window.applyMagicWrite());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) { e.stopPropagation(); closeModal(); }
        }, true);
    }

    // --- Lógica ---
    let activeMagicNodeId = null;

    const GEN_BTN_HTML = '<i class="fa-solid fa-bolt"></i> Gerar Texto';
    const REGEN_BTN_HTML = '<i class="fa-solid fa-rotate"></i> Gerar novamente';

    // Instruções específicas por tipo de geração (o valor do <select>)
    const TYPE_INSTRUCTIONS = {
        description:   { label: 'Descrição expandida', how: 'Escreva uma descrição expandida e evocativa deste elemento da história, em 2 a 4 parágrafos curtos, sem contradizer os dados fornecidos.' },
        scene:         { label: 'Desenvolvimento de cena', how: 'Desenvolva esta cena como um tratamento dramático: o que o protagonista da cena quer, o que o impede, como o valor em jogo vira de uma carga para outra e como a cena termina. Mostre ações e escolhas, não apenas descrição. Use parágrafos curtos.' },
        character:     { label: 'Aprofundamento de personagem', how: 'Aprofunde o personagem: a tensão entre o desejo externo e a necessidade interna, a falha ou ferida que o move, o que ele teme perder e como o arco de transformação aparece em ações concretas, não em explicações.' },
        dialogue:      { label: 'Diálogo', how: 'Escreva um diálogo curto e natural entre falante e alvo. O que é dito deve diferir do que cada um realmente quer (subtexto); respeite a emoção dominante e a ação da fala. Formato: NOME: fala, uma por linha, com rubricas mínimas entre parênteses.' },
        worldbuilding: { label: 'Expansão de cenário', how: 'Expanda o cenário e a atmosfera: detalhes sensoriais, a época, o clima e, principalmente, as pressões do ambiente que forçam os personagens a escolher. Mostre como o lugar afeta a história.' },
        object:        { label: 'Desenvolvimento de objeto', how: 'Desenvolva o objeto: sua história, as regras e os limites do que ele faz, o custo que o usuário paga para usá-lo, seu simbolismo e a diferença entre o que se espera dele e o que ele realmente causa. Sugira uma situação em que essa diferença vire uma cena.' }
    };

    const SYSTEM_PROMPT = 'Você é um roteirista e escritor profissional. Sua tarefa é ajudar o autor a expandir seu mapa mental de histórias. ' +
        'Use os dados fornecidos, seja criativo, direto e escreva em português do Brasil. ' +
        'Responda em texto corrido, SEM Markdown (sem #, **, listas com hífen ou tabelas), porque o texto será colado em notas de texto simples. ' +
        'Não repita os dados fornecidos nem explique o que está fazendo: entregue apenas o texto pedido. ' +
        'Se faltar informação, invente com coerência em vez de perguntar.';

    // Extrai todos os campos preenchidos do nó
    function buildNodeContext(node) {
        const context = [];

        context.push({ label: 'Título', value: node.title });
        if (node.type && typeof NODE_TYPES !== 'undefined' && NODE_TYPES[node.type]) context.push({ label: 'Tipo', value: NODE_TYPES[node.type].label });
        if (node.pov) context.push({ label: 'POV', value: node.pov });
        if (node.tension > 0) context.push({ label: 'Tensão', value: node.tension + '/10' });

        if (node.beatId && typeof findBeatById === 'function') {
            const beat = findBeatById(node.beatId);
            if (beat) context.push({ label: 'Beat', value: beat.name });
        }

        if (node.type && node.typeData && typeof TYPE_FIELDS !== 'undefined') {
            const fields = TYPE_FIELDS[node.type] || [];
            fields.forEach(f => {
                const val = node.typeData[f.key];
                if (val && String(val).trim() !== '') {
                    context.push({ label: f.label, value: val });
                }
            });
        }

        if (node.content && node.content.trim()) {
            let notes = node.content.trim();
            if (notes.length > MAX_NOTES_CHARS) notes = notes.slice(-MAX_NOTES_CHARS); // mantém o trecho mais recente
            context.push({ label: 'Notas atuais', value: notes });
        }

        return context;
    }

    function esc(s) {
        return (typeof escapeHTML === 'function') ? escapeHTML(String(s)) :
            String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function setResult(text, isError) {
        const el = document.getElementById('sm-magic-result');
        el.value = text;
        el.classList.toggle('is-error', !!isError);
    }

    window.openMagicWrite = function (nodeId) {
        if (!nodeId) {
            const hid = document.getElementById('edit-node-id');
            nodeId = hid && hid.value;
        }
        const node = nodeId ? getNode(nodeId) : null;
        if (!node) return;
        activeMagicNodeId = nodeId;

        const modal = document.getElementById('sm-magic-modal');
        if (!modal) return;
        setResult('', false);
        document.getElementById('sm-magic-prompt').value = '';
        document.getElementById('sm-magic-apply-btn').style.display = 'none';
        const genBtn = document.getElementById('sm-magic-generate-btn');
        genBtn.style.display = 'flex';
        genBtn.disabled = false;
        genBtn.innerHTML = GEN_BTN_HTML;

        // Painel de contexto visual
        const ctx = buildNodeContext(node);
        const ctxContainer = document.getElementById('sm-magic-context-content');
        if (ctx.length <= 1) {
            ctxContainer.innerHTML = '<em style="color:#94a3b8">Poucos dados preenchidos. O resultado pode ser genérico.</em>';
        } else {
            ctxContainer.innerHTML = ctx.map(c => `<div class="sm-magic-context-item"><b>${esc(c.label)}:</b> ${esc(c.value)}</div>`).join('');
        }

        // Pré-seleciona o tipo de geração baseado no nó
        const typeSelect = document.getElementById('sm-magic-type');
        const map = { scene: 'scene', character: 'character', location: 'worldbuilding', dialogue: 'dialogue', object: 'object' };
        typeSelect.value = map[node.type] || 'description';

        modal.classList.add('active');
    };

    // Traduz falhas de rede/HTTP em mensagens que o autor consiga agir
    function explainError(status, apiMessage) {
        if (status === 404) return 'O endpoint de IA não foi encontrado (/api/magic-write). Confirme que a pasta api/ foi publicada na Vercel — ela não funciona abrindo o arquivo direto no navegador.';
        if (status === 401 || status === 403) return 'A chave do Google foi recusada. Gere uma nova em aistudio.google.com/apikey, atualize GEMINI_API_KEY na Vercel e faça um novo deploy.' + (apiMessage ? ' Detalhe: ' + apiMessage : '');
        if (status === 429) return 'Limite gratuito de uso da IA atingido (por minuto ou por dia). Aguarde um pouco e tente de novo.';
        if (status === 500 && /GEMINI_API_KEY/.test(apiMessage || '')) return apiMessage;
        if (status === 504) return 'A IA demorou demais para responder. Tente novamente.';
        if (status === 400 || status === 404) return 'O Google recusou o pedido ou o modelo não existe mais. Confira GEMINI_MODELS na Vercel. Detalhe: ' + (apiMessage || 'sem detalhe');
        return apiMessage || ('Erro ' + status + ' ao chamar a IA.');
    }

    window.executeMagicWrite = async function () {
        const node = getNode(activeMagicNodeId);
        if (!node) return;

        const type = document.getElementById('sm-magic-type').value;
        const extraPrompt = document.getElementById('sm-magic-prompt').value.trim();
        const genBtn = document.getElementById('sm-magic-generate-btn');
        const applyBtn = document.getElementById('sm-magic-apply-btn');

        genBtn.disabled = true;
        genBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Lendo contexto e gerando...';
        applyBtn.style.display = 'none';
        setResult('', false);

        let ok = false;
        try {
            const ctx = buildNodeContext(node);
            const dict = {};
            ctx.forEach(c => { dict[c.label] = c.value; });

            const instr = TYPE_INSTRUCTIONS[type] || TYPE_INSTRUCTIONS.description;
            const storyTitle = (typeof currentStory !== 'undefined' && currentStory && currentStory.title) ? currentStory.title : '';

            const userPrompt =
`${storyTitle ? 'História: ' + storyTitle + '\n\n' : ''}Dados do nó atual:
${JSON.stringify(dict, null, 2)}

Tarefa: ${instr.label}.
${instr.how}

Instruções adicionais do autor: ${extraPrompt || 'Nenhuma.'}`;

            const response = await fetch(window.SM_MAGIC_ENDPOINT || DEFAULT_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.7,
                    max_tokens: MAX_OUTPUT_TOKENS
                })
            });

            // O corpo pode não ser JSON (ex.: página 404 da Vercel)
            let data = null;
            try { data = await response.json(); } catch (_) { data = null; }

            if (!response.ok) {
                throw new Error(explainError(response.status, data && data.error && data.error.message));
            }

            const choice = data && data.choices && data.choices[0];
            const text = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content.trim() : '';
            if (!text) {
                if (choice && choice.finish_reason === 'content_filter') {
                    throw new Error('O filtro de segurança do Google bloqueou este trecho. Reformule as instruções extras ou suavize a descrição do nó e tente de novo.');
                }
                if (choice && choice.finish_reason === 'length') {
                    throw new Error('A IA gastou todo o limite de tokens "pensando" e não chegou a escrever. Tente de novo, ou reduza as instruções extras.');
                }
                throw new Error('A IA respondeu vazio. Tente gerar novamente.');
            }

            setResult(text, false);
            ok = true;
        } catch (error) {
            console.error('[Magic Write] Erro na geração:', error);
            // fetch() lança TypeError quando não consegue nem chegar ao servidor (sem internet, bloqueio etc.)
            const isNetworkError = !!error && error.name === 'TypeError';
            const msg = isNetworkError ? 'Não foi possível conectar. Verifique sua internet.' : error.message;
            setResult('❌ Não foi possível gerar o texto.\n\n' + msg, true);
        } finally {
            genBtn.disabled = false;
            genBtn.style.display = 'flex';
            genBtn.innerHTML = ok ? REGEN_BTN_HTML : GEN_BTN_HTML;
            // "Aplicar" só aparece quando há texto gerado de verdade (nunca com mensagem de erro)
            applyBtn.style.display = ok ? 'flex' : 'none';
        }
    };

    window.applyMagicWrite = function () {
        const node = getNode(activeMagicNodeId);
        if (!node) return;

        const resultEl = document.getElementById('sm-magic-result');
        const resultText = resultEl.value.trim();
        if (!resultText || resultEl.classList.contains('is-error')) return;

        pushHistory();
        node.content = (node.content ? node.content + '\n\n' : '') + resultText;
        if (typeof domCache !== 'undefined' && domCache && typeof domCache.invalidateHeight === 'function') domCache.invalidateHeight(node.id);

        closeModal();

        const textarea = document.getElementById('edit-node-content');
        if (textarea) textarea.value = node.content;

        saveStoriesStorage();
        renderApp();

        setTimeout(() => {
            if (typeof openInspectorFor === 'function') openInspectorFor(node.id);
        }, 30);

        if (typeof showToast === 'function') showToast('Texto gerado aplicado ao nó!', 'success', 2500);
    };

    // --- Integração com o Inspector ---
    // O botão é criado uma única vez, mas seu nó-alvo é atualizado a cada abertura
    // (antes, o clique ficava preso ao primeiro nó aberto).
    function syncTriggerButton(nodeId) {
        const contentArea = document.getElementById('edit-node-content');
        if (!contentArea) return;
        const node = nodeId ? getNode(nodeId) : null;
        const show = !!(node && node.type);   // só para nós com tipo (cena, personagem, objeto...)

        let btn = document.getElementById('sm-magic-trigger-btn');
        if (!btn && show) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'sm-magic-trigger-btn';
            btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Gerar com IA (Magic Write)';
            btn.addEventListener('click', () => {
                const hid = document.getElementById('edit-node-id');
                window.openMagicWrite((hid && hid.value) || btn.dataset.nodeId);
            });
            contentArea.parentNode.insertBefore(btn, contentArea.nextSibling);
        }
        if (btn) {
            btn.dataset.nodeId = nodeId || '';
            btn.style.display = show ? 'flex' : 'none';
        }
    }

    const originalOpenInspector = window.openInspectorFor;
    if (typeof originalOpenInspector === 'function' && !originalOpenInspector.__smMagic) {
        const wrapped = function (nodeId) {
            const result = originalOpenInspector.apply(this, arguments);
            try { syncTriggerButton(nodeId); } catch (e) { console.warn('[Magic Write] botão não instalado:', e); }
            return result;
        };
        wrapped.__smMagic = true;
        window.openInspectorFor = wrapped;
    } else if (typeof originalOpenInspector !== 'function') {
        console.warn('[Magic Write] openInspectorFor não encontrado — carregue este script depois do script principal do app.');
    }

    function init() {
        injectCSS();
        injectModal();
        // Se o inspetor já estiver aberto quando o módulo carregar, instala o botão agora
        const hid = document.getElementById('edit-node-id');
        if (hid && hid.value) syncTriggerButton(hid.value);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
