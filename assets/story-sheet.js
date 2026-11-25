/**
 * StoryMind - Ficha da História (Story Sheet)
 * Localizado em: assets/story-sheet.js
 */
(function () {
    'use strict';
    if (window.SM_STORY_SHEET) return;

    const $ = id => document.getElementById(id);

    // Cria o HTML do modal dinamicamente para não poluir o app.html
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
                                <textarea id="ss-logline" rows="3" placeholder="Ex: Um ferreiro descobre ser o herdeiro de um império caído..."></textarea>
                            </div>
                        </div>

                        <!-- ABA: IDEIA GOVERNANTE -->
                        <div class="sm-ss-pane" data-pane="ideia">
                            <div class="sm-ss-field">
                                <label>Ideia Controladora (Robert McKee)</label>
                                <textarea id="ss-controlling" rows="6" placeholder="A história prova que [Valor] é alcançado/negado quando [Causa]...\nEx: O amor verdadeiro vence a morte quando o herói se sacrifica pelo outro."></textarea>
                            </div>
                        </div>

                        <!-- ABA: 6 PERGUNTAS -->
                        <div class="sm-ss-pane" data-pane="perguntas">
                            <div class="sm-ss-grid">
                                <div class="sm-ss-field">
                                    <label>1. Quem é o protagonista?</label>
                                    <input type="text" id="ss-q1" placeholder="Nome e breve descrição">
                                </div>
                                <div class="sm-ss-field">
                                    <label>2. Qual é o conflito?</label>
                                    <input type="text" id="ss-q2" placeholder="O que impede o protagonista?">
                                </div>
                                <div class="sm-ss-field">
                                    <label>3. Qual é o valor central em jogo?</label>
                                    <input type="text" id="ss-q3" placeholder="Ex: Liberdade vs. Tirania">
                                </div>
                                <div class="sm-ss-field">
                                    <label>4. Qual a condição antes da mudança?</label>
                                    <input type="text" id="ss-q4" placeholder="Como era o mundo/ele antes?">
                                </div>
                                <div class="sm-ss-field">
                                    <label>5. Qual a condição depois da mudança?</label>
                                    <input type="text" id="ss-q5" placeholder="Como é o mundo/ele no final?">
                                </div>
                                <div class="sm-ss-field">
                                    <label>6. Qual é a causa da mudança?</label>
                                    <input type="text" id="ss-q6" placeholder="O evento ou escolha que gerou a virada.">
                                </div>
                            </div>
                        </div>

                        <!-- ABA: STORY SPINE -->
                        <div class="sm-ss-pane" data-pane="spine">
                            <div class="sm-ss-spine">
                                <div class="sm-ss-field"><label>Era uma vez...</label><input type="text" id="ss-s1" placeholder="O status quo inicial."></div>
                                <div class="sm-ss-field"><label>Todos os dias...</label><input type="text" id="ss-s2" placeholder="A rotina do personagem."></div>
                                <div class="sm-ss-field"><label>Mas um dia...</label><input type="text" id="ss-s3" placeholder="O incidente incitante."></div>
                                <div class="sm-ss-field"><label>Por causa disso...</label><input type="text" id="ss-s4" placeholder="A primeira consequência."></div>
                                <div class="sm-ss-field"><label>Por causa disso...</label><input type="text" id="ss-s5" placeholder="O escalonamento do conflito."></div>
                                <div class="sm-ss-field"><label>Até que finalmente...</label><input type="text" id="ss-s6" placeholder="O clímax e a resolução."></div>
                            </div>
                        </div>
                    </div>

                    <div class="sm-ss-footer">
                        <button class="sm-ss-btn ghost" onclick="SM_STORY_SHEET.close()">Cancelar</button>
                        <button class="sm-ss-btn primary" onclick="SM_STORY_SHEET.save()"><i class="fa-solid fa-floppy-disk"></i> Salvar Ficha</button>
                    </div>
                </div>
            </div>
        `);

        // Lógica das Abas
        document.querySelectorAll('.sm-ss-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.sm-ss-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.sm-ss-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.querySelector(`.sm-ss-pane[data-pane="${tab.dataset.tab}"]`).classList.add('active');
            });
        });
    }

    // Abre o Modal e preenche os dados
    function open() {
        injectModal();
        
        // Verifica se a história está carregada no app
        if (typeof currentStory === 'undefined' || !currentStory) {
            if (typeof showToast === 'function') showToast('Nenhuma história aberta no momento.', 'error');
            return;
        }

        const meta = currentStory.meta || {};
        const six = meta.sixQuestions || {};
        const spine = meta.storySpine || {};

        // Preenche os campos
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

        $('ss-s1').value = spine.onceUpon || '';
        $('ss-s2').value = spine.everyday || '';
        $('ss-s3').value = spine.butOneDay || '';
        $('ss-s4').value = spine.becauseOfThat || '';
        $('ss-s5').value = spine.becauseOfThat2 || '';
        $('ss-s6').value = spine.untilFinally || '';

        // Abre com a primeira aba ativa
        document.querySelectorAll('.sm-ss-tab')[0].click();
        $('sm-ss-overlay').classList.add('open');
    }

    // Fecha o Modal
    function close() {
        const el = $('sm-ss-overlay');
        if (el) el.classList.remove('open');
    }

    // Salva os dados no objeto da história e sincroniza
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

        currentStory.meta.storySpine = {
            onceUpon: $('ss-s1').value.trim(),
            everyday: $('ss-s2').value.trim(),
            butOneDay: $('ss-s3').value.trim(),
            becauseOfThat: $('ss-s4').value.trim(),
            becauseOfThat2: $('ss-s5').value.trim(),
            untilFinally: $('ss-s6').value.trim()
        };

        // 1. Salva no localStorage (Banco local)
        if (typeof save === 'function') {
            const db = typeof load === 'function' ? load() : {};
            db[currentStoryKey] = currentStory;
            save(db);
        }

        // 2. Sincroniza com a Nuvem (Supabase)
        if (window.SM_CLOUD && typeof SM_CLOUD.push === 'function') {
            SM_CLOUD.push(currentStoryKey, currentStory);
            if (SM_CLOUD.flush) SM_CLOUD.flush();
        }

        close();
        if (typeof showToast === 'function') showToast('Ficha da História salva!', 'success');
    }

    // Expõe globalmente
    window.SM_STORY_SHEET = { open, close, save };

})();