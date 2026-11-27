/**
 * StoryMind - Ficha da História (Story Sheet)
 * Localizado em: assets/story-sheet.js
 */
(function () {
    'use strict';
    if (window.SM_STORY_SHEET) return;

    const $ = id => document.getElementById(id);
    const DB_KEY = 'storymind_database_v2'; // Mesma chave do app

    // Função que ajusta a altura das textareas para o conteúdo
    function autoResizeTextareas() {
        const modal = $('sm-ss-modal');
        if (!modal) return;
        modal.querySelectorAll('textarea').forEach(ta => {
            if (ta.offsetParent !== null) {
                ta.style.height = 'auto';
                ta.style.height = ta.scrollHeight + 'px';
            }
        });
    }

    function injectModal() {
        if ($('sm-ss-overlay')) return;

        document.body.insertAdjacentHTML('beforeend', `
            <div id="sm-ss-overlay">
                <div id="sm-ss-modal">
                    <div class="sm-ss-header">
                        <h2 class="sm-ss-title"><i class="fa-solid fa-file-lines" style="color:#6366f1"></i> Ficha da História</h2>
                        <button class="sm-ss-close" onclick="SM_STORY_SHEET.close()"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    
                    <div class="sm-ss-tabs">
                        <button class="sm-ss-tab active" data-tab="geral">Visão Geral</button>
                        <button class="sm-ss-tab" data-tab="ideia">Ideia Governante</button>
                        <button class="sm-ss-tab" data-tab="perguntas">As 6 Perguntas</button>
                        <button class="sm-ss-tab" data-tab="spine">Story Spine</button>
                    </div>

                    <div class="sm-ss-body">
                        <!-- ABA: GERAL -->
                        <div class="sm-ss-pane active" data-pane="geral">
                            <div class="sm-ss-grid">
                                <div class="sm-ss-field">
                                    <label>Gênero Literário</label>
                                    <select id="ss-genre">
                                        <option value="">Não definido</option>
                                        <option value="Fantasia">Fantasia</option>
                                        <option value="Ficção Científica">Ficção Científica</option>
                                        <option value="Romance">Romance</option>
                                        <option value="Suspense/Mistério">Suspense/Mistério</option>
                                        <option value="Drama">Drama</option>
                                        <option value="Terror">Terror</option>
                                        <option value="Aventura">Aventura</option>
                                        <option value="Histórico">Histórico</option>
                                        <option value="Outro">Outro</option>
                                    </select>
                                </div>
                                <div class="sm-ss-field">
                                    <label>Status</label>
                                    <select id="ss-status">
                                        <option value="">Não definido</option>
                                        <option value="Ideia">Ideia / Brainstorm</option>
                                        <option value="Planejamento">Planejamento / Mapa</option>
                                        <option value="Rascunho">Rascunho</option>
                                        <option value="Revisão">Revisão</option>
                                        <option value="Concluído">Concluído</option>
                                    </select>
                                </div>
                            </div>
                            <div class="sm-ss-field">
                                <label>Logline / Sinopse Curta</label>
                                <textarea id="ss-logline" rows="3" placeholder="Nenhuma logline definida..."></textarea>
                            </div>
                        </div>

                        <!-- ABA: IDEIA GOVERNANTE -->
                        <div class="sm-ss-pane" data-pane="ideia">
                            <div class="sm-ss-field">
                                <label>Ideia Controladora (Robert McKee)</label>
                                <textarea id="ss-controlling" rows="6" placeholder="Nenhuma ideia controladora definida..."></textarea>
                            </div>
                        </div>

                        <!-- ABA: 6 PERGUNTAS (Com Tooltips) -->
                        <div class="sm-ss-pane" data-pane="perguntas">
                            <div class="sm-ss-grid">
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">1. Quem é o protagonista? <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="Quem é o personagem principal que guia a história?"></i></label>
                                    <textarea id="ss-q1" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">2. Qual é o conflito? <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="Qual é o principal obstáculo que impede o protagonista de atingir seu objetivo?"></i></label>
                                    <textarea id="ss-q2" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">3. Qual é o valor central em jogo? <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="O que está em jogo? (Ex: Amor vs. Ódio, Liberdade vs. Tirania)"></i></label>
                                    <textarea id="ss-q3" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">4. Qual a condição antes da mudança? <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="Qual é o estado inicial do mundo ou do personagem antes da jornada?"></i></label>
                                    <textarea id="ss-q4" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">5. Qual a condição depois da mudança? <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="Como o mundo ou o personagem mudou ao final da história?"></i></label>
                                    <textarea id="ss-q5" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">6. Qual é a causa da mudança? <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="Qual evento ou escolha chave desencadeou essa transformação?"></i></label>
                                    <textarea id="ss-q6" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                            </div>
                        </div>

                        <!-- ABA: STORY SPINE (Com novos campos e Tooltips) -->
                        <div class="sm-ss-pane" data-pane="spine">
                            <div class="sm-ss-spine">
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">Era uma vez... <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="Estabelece o cenário e o status quo inicial."></i></label>
                                    <textarea id="ss-s1" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">Todos os dias... <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="A rotina do personagem e como as coisas são normalmente."></i></label>
                                    <textarea id="ss-s2" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">Até que um dia... <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="O incidente incitante que quebra a rotina."></i></label>
                                    <textarea id="ss-s3" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">Por causa disso... <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="A primeira consequência do incidente incitante."></i></label>
                                    <textarea id="ss-s4" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">Por causa disso... <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="O conflito se intensifica e as apostas aumentam."></i></label>
                                    <textarea id="ss-s5" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">Por causa disso... <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="A crise final antes do clímax."></i></label>
                                    <textarea id="ss-s6" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">Até que finalmente... <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="O clímax e a resolução do conflito principal."></i></label>
                                    <textarea id="ss-s7" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                                <div class="sm-ss-field">
                                    <label class="flex items-center gap-1">Desde então... <i class="fa-solid fa-circle-question text-slate-400 text-[10px] cursor-help" title="O novo status quo, a lição aprendida ou a mudança permanente."></i></label>
                                    <textarea id="ss-s8" rows="1" placeholder="Não definido..."></textarea>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="sm-ss-footer">
                        <button class="sm-ss-btn ghost" onclick="SM_STORY_SHEET.close()">Fechar</button>
                        <button class="sm-ss-btn primary" id="sm-ss-btn-edit" onclick="SM_STORY_SHEET.setEditMode(true)">
                            <i class="fa-solid fa-pen"></i> Editar Ficha
                        </button>
                        <button class="sm-ss-btn primary" id="sm-ss-btn-save" onclick="SM_STORY_SHEET.save()">
                            <i class="fa-solid fa-floppy-disk"></i> Salvar Alterações
                        </button>
                    </div>
                </div>
            </div>
        `);

        document.querySelectorAll('.sm-ss-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.sm-ss-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.sm-ss-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.querySelector(`.sm-ss-pane[data-pane="${tab.dataset.tab}"]`).classList.add('active');
                
                if (!document.getElementById('sm-ss-modal').classList.contains('is-editing')) {
                    autoResizeTextareas();
                }
            });
        });
    }

    function open() {
        injectModal();
        
        if (typeof currentStory === 'undefined' || !currentStory) {
            if (typeof showToast === 'function') showToast('Nenhuma história aberta no momento.', 'error');
            return;
        }

        const meta = currentStory.meta || {};
        const six = meta.sixQuestions || {};
        const spine = meta.storySpine || {};

        $('ss-genre').value = meta.genre || '';
        $('ss-status').value = meta.status || '';
        $('ss-logline').value = meta.logline || '';
        $('ss-controlling').value = meta.controllingIdea || '';

        $('ss-q1').value = six.protagonist || '';
        $('ss-q2').value = six.conflict || '';
        $('ss-q3').value = six.value || '';
        $('ss-q4').value = six.before || '';
        $('ss-q5').value = six.after || '';
        $('ss-q6').value = six.cause || '';

        // Carrega Story Spine (com migração do campo 'butOneDay' antigo para 'untilOneDay')
        $('ss-s1').value = spine.onceUpon || '';
        $('ss-s2').value = spine.everyday || '';
        $('ss-s3').value = spine.untilOneDay || spine.butOneDay || ''; 
        $('ss-s4').value = spine.becauseOfThat || '';
        $('ss-s5').value = spine.becauseOfThat2 || '';
        $('ss-s6').value = spine.becauseOfThat3 || ''; 
        $('ss-s7').value = spine.untilFinally || '';
        $('ss-s8').value = spine.sinceThen || '';

        $('sm-ss-overlay').classList.add('open');
        setEditMode(false);
        document.querySelectorAll('.sm-ss-tab')[0].click();
    }

    function close() {
        const el = $('sm-ss-overlay');
        if (el) el.classList.remove('open');
    }

    function setEditMode(isEditing) {
        const modal = $('sm-ss-modal');
        if (!modal) return;

        if (isEditing) {
            modal.classList.add('is-editing');
            modal.querySelectorAll('textarea').forEach(ta => { ta.style.height = ''; });
            setTimeout(() => { $('ss-genre').focus(); }, 100);
        } else {
            modal.classList.remove('is-editing');
            setTimeout(autoResizeTextareas, 10); 
        }
    }

    function save() {
        if (typeof currentStory === 'undefined' || !currentStory) return;

        if (!currentStory.meta) currentStory.meta = {};
        
        currentStory.meta.genre = $('ss-genre').value;
        currentStory.meta.status = $('ss-status').value;
        currentStory.meta.logline = $('ss-logline').value.trim();
        currentStory.meta.controllingIdea = $('ss-controlling').value.trim();

        currentStory.meta.sixQuestions = {
            protagonist: $('ss-q1').value.trim(),
            conflict: $('ss-q2').value.trim(),
            value: $('ss-q3').value.trim(),
            before: $('ss-q4').value.trim(),
            after: $('ss-q5').value.trim(),
            cause: $('ss-q6').value.trim()
        };

        // Salva o novo Story Spine com os 8 campos
        currentStory.meta.storySpine = {
            onceUpon: $('ss-s1').value.trim(),
            everyday: $('ss-s2').value.trim(),
            untilOneDay: $('ss-s3').value.trim(),
            becauseOfThat: $('ss-s4').value.trim(),
            becauseOfThat2: $('ss-s5').value.trim(),
            becauseOfThat3: $('ss-s6').value.trim(),
            untilFinally: $('ss-s7').value.trim(),
            sinceThen: $('ss-s8').value.trim()
        };

        // 1. Salva no localStorage
        try {
            const db = JSON.parse(localStorage.getItem(DB_KEY)) || {};
            db[currentStoryKey] = currentStory;
            localStorage.setItem(DB_KEY, JSON.stringify(db));
        } catch (e) {
            console.error('Erro ao salvar localmente:', e);
        }

        // 2. Sincroniza com a Nuvem
        if (window.SM_CLOUD && typeof SM_CLOUD.push === 'function') {
            SM_CLOUD.push(currentStoryKey, currentStory);
            if (SM_CLOUD.flush) SM_CLOUD.flush();
        }

        // 3. Volta ao modo de leitura
        setEditMode(false);
        
        if (typeof showToast === 'function') showToast('Ficha da História atualizada!', 'success');
    }

    window.SM_STORY_SHEET = { open, close, save, setEditMode };
})();