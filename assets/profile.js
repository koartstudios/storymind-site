/**
 * StoryMind Pro - Perfil do Usuário
 * Localizado em: assets/profile.js
 */
(function() {
    window.SM_PROFILE = window.SM_PROFILE || {};

    let currentUser = null;
    let currentProfile = null;

    // ── Inicialização ──────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        injectProfileButton();
        injectModal();
        bindEvents();
    });

       function injectProfileButton() {
        // 🔽 Procura o slot que criamos no dashboard.html, senão usa o header do app.html 🔽
        const header = document.getElementById('profile-slot') || document.querySelector('body > header > div:nth-child(2)');
        if (!header || document.getElementById('sm-profile-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'sm-profile-btn';
        btn.title = 'Meu perfil';
        btn.innerHTML = '<i class="fa-solid fa-user"></i>';
        header.appendChild(btn);
    }

    function injectModal() {
        if (document.getElementById('sm-profile-modal')) return;

        document.body.insertAdjacentHTML('beforeend', `
            <div id="sm-profile-backdrop"></div>
            <div id="sm-profile-modal" role="dialog" aria-modal="true">
                <div class="sm-prof-header">
                    <div class="sm-prof-avatar-wrap">
                        <div class="sm-prof-avatar" id="sm-prof-avatar">
                            <span id="sm-prof-initials">?</span>
                        </div>
                        <label class="sm-prof-avatar-edit" title="Trocar foto">
                            <i class="fa-solid fa-camera"></i>
                            <input type="file" id="sm-prof-avatar-input" accept="image/*" style="display:none">
                        </label>
                    </div>
                    <div class="sm-prof-info">
                        <div class="sm-prof-name" id="sm-prof-name-display">Carregando...</div>
                        <div class="sm-prof-email" id="sm-prof-email-display"></div>
                    </div>
                    <button class="sm-prof-close" id="sm-prof-close" aria-label="Fechar">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="sm-prof-tabs">
                    <button class="sm-prof-tab active" data-tab="profile"><i class="fa-solid fa-user"></i> Perfil</button>
                    <button class="sm-prof-tab" data-tab="preferences"><i class="fa-solid fa-sliders"></i> Preferências</button>
                    <button class="sm-prof-tab" data-tab="account"><i class="fa-solid fa-shield-halved"></i> Conta</button>
                    <button class="sm-prof-tab" data-tab="stats"><i class="fa-solid fa-chart-simple"></i> Estatísticas</button>
                </div>

                <div class="sm-prof-body">
                    <!-- PERFIL -->
                    <div class="sm-prof-pane active" data-pane="profile">
                        <div class="sm-prof-field">
                            <label>Nome de exibição</label>
                            <input type="text" id="sm-prof-name-input" placeholder="Seu nome">
                        </div>
                        <div class="sm-prof-field">
                            <label>Bio</label>
                            <textarea id="sm-prof-bio-input" rows="3" placeholder="Conte um pouco sobre você e seus projetos..."></textarea>
                            <div class="sm-prof-hint">Aparece para colaboradores nas histórias compartilhadas.</div>
                        </div>
                        <div class="sm-prof-footer">
                            <button class="sm-prof-btn primary" id="sm-prof-save-profile">
                                <i class="fa-solid fa-floppy-disk"></i> Salvar Perfil
                            </button>
                        </div>
                    </div>

                    <!-- PREFERÊNCIAS -->
                    <div class="sm-prof-pane" data-pane="preferences">
                        <div class="sm-prof-row">
                            <div class="sm-prof-field">
                                <label>Tema padrão</label>
                                <select id="sm-prof-theme-select">
                                    <option value="default">Claro</option>
                                    <option value="dark">Escuro</option>
                                    <option value="paper">Papel</option>
                                </select>
                            </div>
                            <div class="sm-prof-field">
                                <label>Layout padrão</label>
                                <select id="sm-prof-layout-select">
                                    <option value="tree">🌳 Árvore</option>
                                    <option value="radial">🎯 Radial</option>
                                    <option value="org">🏢 Organograma</option>
                                </select>
                            </div>
                        </div>
                        <div class="sm-prof-field">
                            <label>Idioma da interface</label>
                            <select id="sm-prof-lang-select">
                                <option value="pt">🇧🇷 Português</option>
                                <option value="en">🇺🇸 English</option>
                                <option value="de">🇩🇪 Deutsch</option>
                                <option value="ja">🇯🇵 日本語</option>
                                <option value="zh">🇨🇳 中文</option>
                            </select>
                        </div>
                        <div class="sm-prof-footer">
                            <button class="sm-prof-btn primary" id="sm-prof-save-prefs">
                                <i class="fa-solid fa-floppy-disk"></i> Salvar Preferências
                            </button>
                        </div>
                    </div>

                    <!-- CONTA -->
                    <div class="sm-prof-pane" data-pane="account">
                        <div class="sm-prof-field">
                            <label>Email</label>
                            <input type="email" id="sm-prof-email-account" readonly>
                        </div>
                        <div class="sm-prof-field">
                            <label>Alterar senha</label>
                            <input type="password" id="sm-prof-password" placeholder="Nova senha (mín. 6 caracteres)">
                        </div>
                        <div class="sm-prof-footer" style="border:0;background:transparent;padding:0">
                            <button class="sm-prof-btn secondary" id="sm-prof-change-pass">
                                <i class="fa-solid fa-key"></i> Alterar Senha
                            </button>
                            <button class="sm-prof-btn secondary" id="sm-prof-logout">
                                <i class="fa-solid fa-right-from-bracket"></i> Sair
                            </button>
                        </div>
                        <div class="sm-prof-danger">
                            <h4><i class="fa-solid fa-triangle-exclamation"></i> Zona de Perigo</h4>
                            <p>Esta ação apaga sua conta e todas as histórias permanentemente.</p>
                            <button class="sm-prof-btn danger" id="sm-prof-delete-account">
                                <i class="fa-solid fa-trash"></i> Excluir Conta
                            </button>
                        </div>
                    </div>

                    <!-- ESTATÍSTICAS -->
                    <div class="sm-prof-pane" data-pane="stats">
                        <div class="sm-prof-stats" id="sm-prof-stats-grid">
                            <div class="sm-prof-stat-card">
                                <div class="sm-prof-stat-label">Histórias</div>
                                <div class="sm-prof-stat-value" id="sm-stat-stories">—</div>
                            </div>
                            <div class="sm-prof-stat-card">
                                <div class="sm-prof-stat-label">Nós criados</div>
                                <div class="sm-prof-stat-value" id="sm-stat-nodes">—</div>
                            </div>
                            <div class="sm-prof-stat-card">
                                <div class="sm-prof-stat-label">Comentários</div>
                                <div class="sm-prof-stat-value" id="sm-stat-comments">—</div>
                            </div>
                            <div class="sm-prof-stat-card">
                                <div class="sm-prof-stat-label">Membro desde</div>
                                <div class="sm-prof-stat-value" id="sm-stat-since" style="font-size:13px">—</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `);
    }

    // ── Eventos ──────────────────────────────────────────────
    function bindEvents() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('#sm-profile-btn')) openModal();
            if (e.target.closest('#sm-prof-close') || e.target.id === 'sm-profile-backdrop') closeModal();

            const tab = e.target.closest('.sm-prof-tab');
            if (tab) switchTab(tab.dataset.tab);
        });

        document.addEventListener('click', (e) => {
            if (e.target.closest('#sm-prof-save-profile')) saveProfile();
            if (e.target.closest('#sm-prof-save-prefs')) savePreferences();
            if (e.target.closest('#sm-prof-change-pass')) changePassword();
            if (e.target.closest('#sm-prof-logout')) logout();
            if (e.target.closest('#sm-prof-delete-account')) deleteAccount();
        });

        document.addEventListener('change', (e) => {
            if (e.target.id === 'sm-prof-avatar-input') uploadAvatar(e.target.files[0]);
        });

        // ESC fecha
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });
    }

    // ── Modal ────────────────────────────────────────────────
    async function openModal() {
        document.getElementById('sm-profile-backdrop').classList.add('open');
        document.getElementById('sm-profile-modal').classList.add('open');
        await loadUserData();
    }
    function closeModal() {
        document.getElementById('sm-profile-backdrop').classList.remove('open');
        document.getElementById('sm-profile-modal').classList.remove('open');
    }
    function switchTab(name) {
        document.querySelectorAll('.sm-prof-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        document.querySelectorAll('.sm-prof-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
        if (name === 'stats') loadStats();
    }

    // ── Dados ────────────────────────────────────────────────
    async function loadUserData() {
        if (typeof supabase === 'undefined') return;

        const { data: { user } } = await supabase.auth.getUser();
        currentUser = user;
        if (!user) return;

        const { data: profile } = await supabase
            .from('profiles').select('*').eq('id', user.id).maybeSingle();

        currentProfile = profile || {};

        // Atualiza header
        document.getElementById('sm-prof-email-display').textContent = user.email || '';
        document.getElementById('sm-prof-email-account').value = user.email || '';
        updateHeaderBtn();

        // Perfil
        const name = currentProfile.display_name || user.email?.split('@')[0] || 'Usuário';
        document.getElementById('sm-prof-name-display').textContent = name;
        document.getElementById('sm-prof-name-input').value = name;
        document.getElementById('sm-prof-bio-input').value = currentProfile.bio || '';
        renderAvatar(currentProfile.avatar_url, name);

        // Preferências
        document.getElementById('sm-prof-theme-select').value = currentProfile.default_theme || 'default';
        document.getElementById('sm-prof-layout-select').value = currentProfile.default_layout || 'tree';
        document.getElementById('sm-prof-lang-select').value = currentProfile.ui_language || 'pt';
    }

    function updateHeaderBtn() {
        const btn = document.getElementById('sm-profile-btn');
        if (!btn) return;
        const name = currentProfile?.display_name || currentUser?.email?.split('@')[0] || 'U';
        if (currentProfile?.avatar_url) {
            btn.innerHTML = `<img src="${currentProfile.avatar_url}" alt="">`;
        } else {
            btn.innerHTML = initials(name);
        }
    }

    function renderAvatar(url, name) {
        const el = document.getElementById('sm-prof-avatar');
        if (url) {
            el.innerHTML = `<img src="${url}" alt="">`;
        } else {
            el.innerHTML = `<span id="sm-prof-initials">${initials(name)}</span>`;
        }
    }

    function initials(str) {
        if (!str) return '?';
        const p = str.trim().split(/\s+/);
        return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
    }

    // ── Ações ────────────────────────────────────────────────
    async function saveProfile() {
        if (!currentUser) return;
        const name = document.getElementById('sm-prof-name-input').value.trim();
        const bio = document.getElementById('sm-prof-bio-input').value.trim();

        const { error } = await supabase.from('profiles').upsert({
            id: currentUser.id,
            display_name: name,
            bio: bio,
            updated_at: new Date().toISOString()
        });

        if (error) return alert('Erro ao salvar: ' + error.message);

        currentProfile.display_name = name;
        currentProfile.bio = bio;
        document.getElementById('sm-prof-name-display').textContent = name || 'Usuário';
        renderAvatar(currentProfile.avatar_url, name);
        updateHeaderBtn();
        toast('Perfil atualizado!');
    }

    async function savePreferences() {
        if (!currentUser) return;
        const theme = document.getElementById('sm-prof-theme-select').value;
        const layout = document.getElementById('sm-prof-layout-select').value;
        const lang = document.getElementById('sm-prof-lang-select').value;

        const { error } = await supabase.from('profiles').upsert({
            id: currentUser.id,
            default_theme: theme,
            default_layout: layout,
            ui_language: lang,
            updated_at: new Date().toISOString()
        });

        if (error) return alert('Erro ao salvar: ' + error.message);

        currentProfile.default_theme = theme;
        currentProfile.default_layout = layout;
        currentProfile.ui_language = lang;

        // Aplica tema imediatamente, se a função existir no app
        if (typeof changeTheme === 'function') changeTheme(theme);
        if (typeof changeLayout === 'function') changeLayout(layout);

        toast('Preferências salvas!');
    }

    async function uploadAvatar(file) {
        if (!file || !currentUser) return;
        if (file.size > 2 * 1024 * 1024) return alert('Imagem muito grande (máx. 2MB).');

        const ext = file.name.split('.').pop();
        const path = `${currentUser.id}/avatar.${ext}`;

        const { error: upErr } = await supabase.storage
            .from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' });
        if (upErr) return alert('Erro no upload: ' + upErr.message);

        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
        // Cache-buster
        const url = publicUrl + '?t=' + Date.now();

        await supabase.from('profiles').upsert({
            id: currentUser.id,
            avatar_url: url,
            updated_at: new Date().toISOString()
        });

        currentProfile.avatar_url = url;
        renderAvatar(url, currentProfile.display_name);
        updateHeaderBtn();
        toast('Foto atualizada!');
    }

    async function changePassword() {
        const pass = document.getElementById('sm-prof-password').value;
        if (pass.length < 6) return alert('Senha precisa ter no mínimo 6 caracteres.');

        const { error } = await supabase.auth.updateUser({ password: pass });
        if (error) return alert('Erro: ' + error.message);
        document.getElementById('sm-prof-password').value = '';
        toast('Senha alterada!');
    }

    async function logout() {
        if (!confirm('Sair da conta?')) return;
        await supabase.auth.signOut();
        location.reload();
    }

    async function deleteAccount() {
        const confirmText = prompt('Digite "EXCLUIR" para confirmar a exclusão permanente da conta:');
        if (confirmText !== 'EXCLUIR') return;

        // Requer função RPC no Supabase (veja nota abaixo)
        const { error } = await supabase.rpc('delete_own_account');
        if (error) return alert('Erro: ' + error.message + '\n\n(Verifique se a função RPC foi criada no Supabase)');
        await supabase.auth.signOut();
        location.reload();
    }

    async function loadStats() {
        if (!currentUser) return;
        try {
            const [storiesRes, commentsRes] = await Promise.all([
                supabase.from('stories').select('id', { count: 'exact', head: true }),
                supabase.from('node_comments').select('id', { count: 'exact', head: true }).eq('user_id', currentUser.id)
            ]);
            document.getElementById('sm-stat-stories').textContent = storiesRes.count ?? '—';
            document.getElementById('sm-stat-comments').textContent = commentsRes.count ?? '—';
            document.getElementById('sm-stat-since').textContent = new Date(currentUser.created_at)
                .toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
            document.getElementById('sm-stat-nodes').textContent = '—'; // plugue sua query aqui
        } catch (e) { console.warn(e); }
    }

    function toast(msg) {
        // Reaproveita a função de toast do app, se existir
        if (typeof showToast === 'function') return showToast(msg, 'success');
        console.log('[Profile]', msg);
    }

    // Permite abrir via console/atalho
    window.SM_PROFILE.open = openModal;
})();