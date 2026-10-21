/* ============================================================
   StoryMind Pro — Service Worker
   Estratégia: "app shell + rede-fallback"
   ============================================================ */

const SW_VERSION = 'v1.0.0';
const CACHE_SHELL = `storymind-shell-${SW_VERSION}`;
const CACHE_RUNTIME = `storymind-runtime-${SW_VERSION}`;

/* Arquivos essenciais para o app abrir offline.
   NÃO inclua arquivos que mudam com frequência (dados) nem
   os que vêm de CDN (Google Fonts, Font Awesome, Tailwind). */
const SHELL_FILES = [
    './',
    './app.html',
    './dashboard.html',
    './manifest.json',
    './assets/style.css',
    './assets/config.js',
    './assets/auth.js',
    './assets/cloud.js',
    './assets/dashboard.js',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png',
    './assets/icons/icon-apple-touch-180.png'
];

/* ---------- INSTALL ---------- */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_SHELL).then((cache) => {
            // addAll falha se UM arquivo não existir — usamos add individual
            // para que um arquivo ausente não impeça a instalação inteira.
            return Promise.all(
                SHELL_FILES.map((url) =>
                    cache.add(url).catch((err) => {
                        console.warn('[SW] Falha ao cachear (ignorado):', url, err.message);
                    })
                )
            );
        }).then(() => self.skipWaiting())
    );
});

/* ---------- ACTIVATE ---------- */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((k) => k !== CACHE_SHELL && k !== CACHE_RUNTIME)
                    .map((k) => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Ignora requisições que não sejam GET (Supabase, POST etc.)
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Nunca intercepta Supabase (auth, realtime, REST) — é a fonte de verdade
    if (url.hostname.includes('supabase.co')) return;

    // Nunca intercepta CDNs externos (deixa o navegador gerenciar)
    const externalHosts = [
        'fonts.googleapis.com',
        'fonts.gstatic.com',
        'cdnjs.cloudflare.com',
        'cdn.jsdelivr.net',
        'cdn.tailwindcss.com',
        'd3js.org',
        'cdn.skypack.dev',
        'unpkg.com'
    ];
    if (externalHosts.some((h) => url.hostname.includes(h))) return;

    // ----- 1. Navegação (HTML pages): network-first, cache-fallback -----
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    // Guarda uma cópia atualizada no cache
                    const copy = res.clone();
                    caches.open(CACHE_RUNTIME).then((c) => c.put(req, copy));
                    return res;
                })
                .catch(() => {
                    // Sem rede: tenta o cache (runtime → shell → dashboard)
                    return caches.match(req)
                        .then((cached) => cached
                            || caches.match('./dashboard.html')
                            || caches.match('./app.html')
                        );
                })
        );
        return;
    }

    // ----- 2. Assets locais (CSS, JS, ícones): cache-first -----
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(req).then((cached) => {
                if (cached) return cached;
                return fetch(req).then((res) => {
                    if (res && res.status === 200) {
                        const copy = res.clone();
                        caches.open(CACHE_RUNTIME).then((c) => c.put(req, copy));
                    }
                    return res;
                });
            })
        );
        return;
    }
});

/* ---------- MENSAGENS DO APP ---------- */
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
    if (event.data === 'CLEAR_CACHE') {
        caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    }
});