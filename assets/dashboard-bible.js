/**
 * StoryMind - Bíblia Global do Universo (Categorias e Layouts Separados)
 */
(function () {
    'use strict';
    if (window.SM_BIBLE) return;

    const DB_KEY = 'storymind_database_v2';

    const DEFAULT_TYPES = {
        'scene':      { label: 'Cenas',       icon: 'fa-film',             color: '#6366f1' },
        'character':  { label: 'Personagens', icon: 'fa-user',             color: '#10b981' },
        'location':   { label: 'Cenários',    icon: 'fa-location-dot',     color: '#14b8a6' },
        'event':      { label: 'Eventos',     icon: 'fa-bolt',             color: '#f59e0b' },
        'dialogue':   { label: 'Diálogos',    icon: 'fa-comments',         color: '#0ea5e9' },
        'theme':      { label: 'Temas',       icon: 'fa-masks-theater',    color: '#f43f5e' },
        'note':       { label: 'Notas',       icon: 'fa-note-sticky',      color: '#94a3b8' },
        'timeline':   { label: 'Timelines',   icon: 'fa-timeline',         color: '#8b5cf6' },
        'object':     { label: 'Objetos',     icon: 'fa-flask',            color: '#f97316' }
    };

    let allItems = []; 
    let activeCat = 'all';
    let activeStory = 'all';
    let activeSearch = '';
    let viewGroup = 'type';    // 'type' | 'story'
    let viewLayout = 'grid';   // 'grid' | 'gallery' | 'list'

    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function getTypes() { return window.SM_NODE_TYPES || DEFAULT_TYPES; }
    function typeConf(t) { return getTypes()[t] || { label: t || 'Outro', icon: 'fa-circle', color: '#94a3b8' }; }

    // ---------- Extração e FUSÃO de dados ----------
    function extractAllItems() {
        let db = {};
        try { db = JSON.parse(localStorage.getItem(DB_KEY)) || {}; } catch (_) { return []; }

        const mergedMap = new Map();

        Object.keys(db).forEach(storyKey => {
            const story = db[storyKey];
            const storyTitle = story.title || 'Sem título';
            
            (story.sheets || []).forEach(sheet => {
                (sheet.nodes || []).forEach(node => {
                    if (!node.type || node.type === 'sem') return;
                    const nodeTitle = String(node.title || node.name || '').trim();
                    if (!nodeTitle) return; 

                    const nodeDesc = String(node.description || node.content || node.text || '').trim();
                    const normKey = `${node.type}::${nodeTitle.toLowerCase()}`;

                    if (!mergedMap.has(normKey)) {
                        mergedMap.set(normKey, {
                            type: node.type,
                            title: nodeTitle,
                            description: nodeDesc,
                            image: null,
                            tags: new Set(),
                            stories: new Map()
                        });
                    }

                    const entry = mergedMap.get(normKey);
                    
                    if (nodeDesc.length > entry.description.length) entry.description = nodeDesc;

                    // Usa as imagens cadastradas no inspetor do nó (Ícones por URL).
                    // node.icons é um array de URLs; a galeria utiliza a primeira imagem disponível.
                    const nodeIcons = Array.isArray(node.icons)
                        ? node.icons.filter(url => typeof url === 'string' && url.trim())
                        : [];
                    const imgUrl = nodeIcons[0] || node.image || node.imageUrl || node.avatar ||
                        (node.meta && (node.meta.image || node.meta.imageUrl));
                    if (imgUrl && !entry.image) entry.image = imgUrl;

                    entry.stories.set(storyKey, storyTitle);

                    if (Array.isArray(node.tags)) node.tags.forEach(t => entry.tags.add(t.trim()));
                    if (node.meta && Array.isArray(node.meta.tags)) node.meta.tags.forEach(t => entry.tags.add(t.trim()));
                });
            });
        });

        return Array.from(mergedMap.values()).map(item => ({
            ...item,
            tags: Array.from(item.tags).filter(Boolean),
            stories: Array.from(item.stories.entries()).map(([key, title]) => ({ key, title }))
        }));
    }

    // ---------- Injeção do botão + overlay ----------
    function injectButton() {
        if ($('sm-bible-btn')) return;
        const heroActions = document.querySelector('.hero-actions');
        if (!heroActions) return;
        const btn = document.createElement('button');
        btn.id = 'sm-bible-btn';
        btn.className = 'btn-hero';
        btn.style.cssText = 'background:linear-gradient(135deg,#8b5cf6,#6366f1); color:#fff; border-color:transparent; box-shadow:0 6px 16px -8px rgba(139,92,246,.55);';
        btn.innerHTML = '<i class="fa-solid fa-book-skull"></i> Bíblia do Universo';
        btn.addEventListener('click', open);
        heroActions.prepend(btn);
    }

       function injectOverlay() {
        if ($('sm-bible-overlay')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="sm-bible-overlay" role="dialog" aria-modal="true">
                <div id="sm-bible-header">
                    <div class="sm-bible-topline">
                        <div class="sm-bible-title-wrap">
                            <h2 class="sm-bible-title"><i class="fa-solid fa-book-skull" style="background:linear-gradient(135deg,#a5b4fc,#c7d2fe);-webkit-background-clip:text;background-clip:text;color:transparent;"></i> Bíblia do Universo</h2>
                            <p class="sm-bible-subtitle" id="sm-bible-subtitle">Consolidando seu acervo...</p>
                        </div>
                        <button class="sm-bible-close" id="sm-bible-close" title="Fechar (ESC)"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    
                    <!-- Estatísticas (Serão ocultadas no mobile via CSS) -->
                    <div class="sm-bible-stats" id="sm-bible-stats"></div>
                    
                    <!-- Botão que abre a gaveta no mobile -->
                    <button id="sm-bible-filter-toggle" class="sm-bible-filter-toggle-mobile">
                        <span><i class="fa-solid fa-filter"></i> Filtros e Categorias</span>
                        <i class="fa-solid fa-chevron-down" id="sm-bible-filter-chevron"></i>
                    </button>

                    <!-- Gaveta de Filtros -->
                    <div class="sm-bible-filters-wrapper" id="sm-bible-filters-wrapper">
                        <div class="sm-bible-toolbar">
                            <div class="sm-bible-search">
                                <i class="fa-solid fa-magnifying-glass"></i>
                                <input id="sm-bible-search" type="search" placeholder="Buscar por nome, tag, descrição…">
                            </div>
                            <select id="sm-bible-story-filter" class="sm-bible-select">
                                <option value="all">Todas as histórias</option>
                            </select>
                            <div class="sm-bible-control-group">
                                <span class="sm-bible-control-label">Agrupar:</span>
                                <div class="sm-bible-view-toggle" id="sm-bible-group-toggle">
                                    <button data-mode="type" class="on" title="Agrupar por Tipo"><i class="fa-solid fa-layer-group"></i> Tipos</button>
                                    <button data-mode="story" title="Agrupar por História"><i class="fa-solid fa-book"></i> Histórias</button>
                                </div>
                            </div>
                            <div class="sm-bible-control-group">
                                <span class="sm-bible-control-label">Visualizar:</span>
                                <div class="sm-bible-view-toggle" id="sm-bible-layout-toggle">
                                    <button data-mode="grid" class="on" title="Grade"><i class="fa-solid fa-table-cells-large"></i> Grade</button>
                                    <button data-mode="gallery" title="Galeria"><i class="fa-solid fa-image"></i> Galeria</button>
                                    <button data-mode="list" title="Lista"><i class="fa-solid fa-list"></i> Lista</button>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Categorias (Cena, Personagem, etc) agora ficam aqui dentro -->
                        <div id="sm-bible-cats"></div>
                    </div>
                </div>
                <div id="sm-bible-content"></div>
            </div>
        `);

        $('sm-bible-close').addEventListener('click', close);
        $('sm-bible-search').addEventListener('input', e => { activeSearch = e.target.value.trim().toLowerCase(); renderContent(); });
        $('sm-bible-story-filter').addEventListener('change', e => { activeStory = e.target.value; renderContent(); });
        
        // Lógica para abrir/fechar a gaveta no mobile
        const filterToggle = $('sm-bible-filter-toggle');
        const filterWrapper = $('sm-bible-filters-wrapper');
        if (filterToggle && filterWrapper) {
            filterToggle.addEventListener('click', () => {
                filterToggle.classList.toggle('open');
                filterWrapper.classList.toggle('open');
            });
        }

        // Controle de Agrupamento
        document.querySelectorAll('#sm-bible-group-toggle button').forEach(b => {
            b.addEventListener('click', () => {
                document.querySelectorAll('#sm-bible-group-toggle button').forEach(x => x.classList.remove('on'));
                b.classList.add('on'); viewGroup = b.dataset.mode; renderContent();
            });
        });
        // Controle de Layout
        document.querySelectorAll('#sm-bible-layout-toggle button').forEach(b => {
            b.addEventListener('click', () => {
                document.querySelectorAll('#sm-bible-layout-toggle button').forEach(x => x.classList.remove('on'));
                b.classList.add('on'); viewLayout = b.dataset.mode; renderContent();
            });
        });
        
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && $('sm-bible-overlay').classList.contains('open')) close();
        });
    }

    // ---------- Abertura e Stats ----------
    function open() {
        injectOverlay();
        $('sm-bible-overlay').classList.add('open');
        document.body.style.overflow = 'hidden';
        refresh();
    }
    function close() {
        $('sm-bible-overlay').classList.remove('open');
        document.body.style.overflow = '';
    }
    function refresh() {
        allItems = extractAllItems();
        activeCat = 'all'; activeStory = 'all'; activeSearch = '';
        if ($('sm-bible-search')) $('sm-bible-search').value = '';
        populateStoryFilter();
        renderStats();
        renderCategories();
        renderContent();
    }

    function populateStoryFilter() {
        const sel = $('sm-bible-story-filter');
        if (!sel) return;
        const storyMap = new Map();
        allItems.forEach(it => it.stories.forEach(s => storyMap.set(s.key, s.title)));
        
        const opts = ['<option value="all">Todas as histórias</option>'];
        storyMap.forEach((title, key) => opts.push(`<option value="${esc(key)}">${esc(title)}</option>`));
        sel.innerHTML = opts.join('');
        sel.value = storyMap.has(activeStory) ? activeStory : 'all';
    }

    function renderStats() {
        const totalEntidades = allItems.length;
        const totalAparicoes = allItems.reduce((acc, it) => acc + it.stories.length, 0);
        const totalTags = new Set(allItems.flatMap(it => it.tags)).size;
        
        if ($('sm-bible-subtitle')) {
            $('sm-bible-subtitle').textContent = `${totalEntidades} entidades únicas · ${totalAparicoes} aparições globais`;
        }

        const counts = {};
        allItems.forEach(it => { counts[it.type] = (counts[it.type] || 0) + 1; });
        const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        
        const main = sorted.slice(0, 4).map(t => {
            const c = typeConf(t);
            return `<div class="sm-bible-stat"><i class="fa-solid ${c.icon}" style="color:${c.color}"></i> ${esc(c.label)} <b>${counts[t]}</b></div>`;
        }).join('');

        $('sm-bible-stats').innerHTML = `
            <div class="sm-bible-stat"><i class="fa-solid fa-database"></i> Entidades <b>${totalEntidades}</b></div>
            ${main}
            ${totalTags > 0 ? `<div class="sm-bible-stat" style="background:rgba(251,191,36,.15);border-color:rgba(251,191,36,.3);color:#fcd34d"><i class="fa-solid fa-tags"></i> Tags <b>${totalTags}</b></div>` : ''}
        `;
    }

    function renderCategories() {
        const el = $('sm-bible-cats');
        if (!el) return;
        const filteredByStory = activeStory === 'all' ? allItems : allItems.filter(i => i.stories.some(s => s.key === activeStory));
        const counts = {};
        filteredByStory.forEach(it => { counts[it.type] = (counts[it.type] || 0) + 1; });

        const pills = [`<button class="sm-bible-cat ${activeCat === 'all' ? 'active' : ''}" data-cat="all"><i class="fa-solid fa-star"></i> Tudo <span class="sm-bible-cat-count">${filteredByStory.length}</span></button>`];
        Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(t => {
            const c = typeConf(t);
            pills.push(`<button class="sm-bible-cat ${activeCat === t ? 'active' : ''}" data-cat="${esc(t)}"><i class="fa-solid ${c.icon}" style="color:${c.color}"></i> ${esc(c.label)} <span class="sm-bible-cat-count">${counts[t]}</span></button>`);
        });

        el.innerHTML = pills.join('');
        el.querySelectorAll('.sm-bible-cat').forEach(btn => {
            btn.addEventListener('click', () => {
                activeCat = btn.dataset.cat;
                el.querySelectorAll('.sm-bible-cat').forEach(b => b.classList.toggle('active', b === btn));
                renderContent();
            });
        });
    }

    function applyFilters() {
        return allItems.filter(it => {
            if (activeCat !== 'all' && it.type !== activeCat) return false;
            if (activeStory !== 'all' && !it.stories.some(s => s.key === activeStory)) return false;
            if (activeSearch) {
                const hay = (it.title + ' ' + it.description + ' ' + it.tags.join(' ') + ' ' + it.stories.map(s=>s.title).join(' ')).toLowerCase();
                if (!hay.includes(activeSearch)) return false;
            }
            return true;
        });
    }

    // ---------- RENDERIZAÇÃO (Combinação de Categoria + Layout) ----------
    function renderContent() {
        const content = $('sm-bible-content');
        if (!content) return;
        const items = applyFilters();

        if (!items.length) {
            content.innerHTML = `<div class="sm-bible-empty"><i class="fa-solid fa-magnifying-glass"></i><h3>Nenhuma entidade encontrada</h3><p>Ajuste os filtros ou busque por outro termo.</p></div>`;
            return;
        }

        if (viewGroup === 'story') {
            // Agrupar por História + aplicar o layout selecionado
            const groups = {};
            items.forEach(it => {
                it.stories.forEach(s => {
                    if (activeStory !== 'all' && s.key !== activeStory) return;
                    if (!groups[s.key]) groups[s.key] = { title: s.title, items: [] };
                    groups[s.key].items.push(it);
                });
            });
            
            content.innerHTML = Object.keys(groups).map(k => {
                const g = groups[k];
                return `<div class="sm-bible-story-group">
                    <div class="sm-bible-story-head"><i class="fa-solid fa-book"></i><span class="sm-bible-story-name">${esc(g.title)}</span><span class="sm-bible-story-count">${g.items.length} entidades</span></div>
                    ${renderLayoutBlock(g.items)}
                </div>`;
            }).join('');
        } else {
            // Agrupar por Tipo (lista plana) + aplicar o layout selecionado
            content.innerHTML = renderLayoutBlock(items);
        }
        
        bindClicks(content);
    }

    // Escolhe o HTML do layout correto para um conjunto de itens
    function renderLayoutBlock(items) {
        if (viewLayout === 'gallery') {
            return `<div class="sm-bible-gallery-grid">${items.map(galleryHTML).join('')}</div>`;
        } else if (viewLayout === 'list') {
            return `<div class="sm-bible-list">${items.map(listHTML).join('')}</div>`;
        } else {
            return `<div class="sm-bible-grid">${items.map(cardHTML).join('')}</div>`;
        }
    }

    // --- HTML do Layout: Grade (original) ---
    function cardHTML(it) {
        const conf = typeConf(it.type);
        const descHTML = it.description ? `<div class="sm-bible-card-desc">${esc(it.description)}</div>` : `<div class="sm-bible-card-desc empty">Sem descrição.</div>`;
        const tagsHTML = it.tags.length > 0 ? `<div class="sm-bible-tags">${it.tags.map(t => `<span class="sm-bible-tag">#${esc(t)}</span>`).join('')}</div>` : '';
        const storiesHTML = it.stories.map(s => `<span class="sm-bible-story-pill" data-story="${esc(s.key)}"><i class="fa-solid fa-book"></i> ${esc(s.title)}</span>`).join('');

        return `
            <div class="sm-bible-card" style="--card-color:${conf.color}">
                <div class="sm-bible-card-header">
                    <span class="sm-bible-card-type" style="color:${conf.color}"><i class="fa-solid ${conf.icon}"></i> ${esc(conf.label)}</span>
                </div>
                <div class="sm-bible-card-title">${esc(it.title)}</div>
                ${tagsHTML}
                ${descHTML}
                <div class="sm-bible-stories-box">
                    <div class="sm-bible-stories-title"><i class="fa-solid fa-link"></i> Backlinks Globais (${it.stories.length})</div>
                    <div class="sm-bible-stories-list">${storiesHTML}</div>
                </div>
            </div>`;
    }

    // --- HTML do Layout: Galeria ---
    function galleryHTML(it) {
        const conf = typeConf(it.type);
        const imgHtml = it.image 
            ? `<img src="${esc(it.image)}" alt="${esc(it.title)}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div class="sm-bible-gallery-placeholder" style="color:${conf.color};background:${conf.color}15;"><i class="fa-solid ${conf.icon}"></i></div>`;
        
        return `
            <div class="sm-bible-gallery-card" data-story="${esc(it.stories[0]?.key || '')}" data-node="${esc(it.title)}">
                <div class="sm-bible-gallery-img">
                    ${imgHtml}
                    <span class="sm-bible-gallery-type" style="background:${conf.color}"><i class="fa-solid ${conf.icon}"></i> ${esc(conf.label)}</span>
                </div>
                <div class="sm-bible-gallery-info">
                    <div class="sm-bible-gallery-title">${esc(it.title)}</div>
                    <div class="sm-bible-gallery-sub">${it.stories.length} história(s)</div>
                </div>
            </div>`;
    }

    // --- HTML do Layout: Lista ---
    function listHTML(it) {
        const conf = typeConf(it.type);
        const imgHtml = it.image 
            ? `<img src="${esc(it.image)}" alt="${esc(it.title)}" class="sm-bible-list-thumb">`
            : `<div class="sm-bible-list-thumb sm-bible-list-placeholder" style="color:${conf.color};background:${conf.color}15;"><i class="fa-solid ${conf.icon}"></i></div>`;
        
        return `
            <div class="sm-bible-list-item" data-story="${esc(it.stories[0]?.key || '')}">
                ${imgHtml}
                <div class="sm-bible-list-content">
                    <div class="sm-bible-list-title">${esc(it.title)}</div>
                    <div class="sm-bible-list-desc">${esc(it.description || 'Sem descrição.')}</div>
                </div>
                <div class="sm-bible-list-meta">
                    <span class="sm-bible-card-type" style="color:${conf.color};background:${conf.color}15;border-color:${conf.color}30;">
                        <i class="fa-solid ${conf.icon}"></i> ${esc(conf.label)}
                    </span>
                    <span class="sm-bible-list-stories"><i class="fa-solid fa-book"></i> ${it.stories.length}</span>
                </div>
            </div>`;
    }

    // ---------- Bind de Cliques ----------
    function bindClicks(content) {
        // Backlinks (pílulas de história)
        content.querySelectorAll('.sm-bible-story-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                e.stopPropagation();
                location.href = 'app.html?story=' + encodeURIComponent(pill.dataset.story);
            });
        });
        // Galeria e Lista - clicar no item inteiro
        content.querySelectorAll('.sm-bible-gallery-card, .sm-bible-list-item').forEach(card => {
            card.addEventListener('click', () => {
                if (card.dataset.story) location.href = 'app.html?story=' + encodeURIComponent(card.dataset.story);
            });
        });
    }

    // ---------- Init ----------
    function init() {
        injectButton();
        injectOverlay();
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyB') {
                if (!$('sm-bible-overlay').classList.contains('open')) { e.preventDefault(); open(); }
            }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.SM_BIBLE = { open, close, refresh };
})();