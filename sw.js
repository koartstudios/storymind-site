/* StoryMind — service worker
 *
 * >>> A CADA PUBLICAÇÃO, MUDE O NÚMERO ABAIXO (v1 -> v2 -> v3...) <<<
 * É isso que faz os aparelhos baixarem a versão nova e apagarem o cache antigo.
 */
const SM_VERSION = 'v1';

const SHELL_CACHE = 'sm-shell-' + SM_VERSION;   // páginas e arquivos do próprio site (trocam a cada versão)
const LIB_CACHE = 'sm-libs-v1';                  // bibliotecas de CDN (a versão já vai na URL; só mude se trocar a lista)
const NAV_TIMEOUT = 4000;                        // se a rede demorar mais que isso e houver cópia guardada, usa a cópia

const SCOPE = self.registration.scope;
const abs = p => new URL(p, SCOPE).href;

// Páginas (URLs "limpas", como no Vercel com cleanUrls)
const PAGES = ['./', 'login', 'dashboard', 'app'];
// Arquivos do site
const ASSETS = [
  'assets/style.css', 'assets/config.js', 'assets/auth.js', 'assets/cloud.js',
  'assets/dashboard.js', 'assets/pwa.js', 'manifest.webmanifest',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png', 'assets/icons/favicon-32.png'
];
// Bibliotecas externas que as páginas usam (sem elas o app.html abre em branco offline)
const LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
  'https://cdn.tailwindcss.com',
  'https://d3js.org/d3.v7.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];
// Hosts de CDN que também são guardados "de carona" (ex.: arquivos de fonte que o CSS pede depois)
const CDN_HOSTS = new Set(['cdn.jsdelivr.net', 'cdn.tailwindcss.com', 'd3js.org', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);
// NUNCA interceptar: login e sincronização precisam sempre ir direto para a rede
const NEVER = [/\.supabase\.(co|in)$/i];

/* ---------- utilidades ---------- */
// "/dashboard", "/dashboard.html" e "/dashboard?x=1" viram a mesma chave de cache
function pageKey(url) {
  const u = new URL(url);
  let p = u.pathname.replace(/\.html$/i, '');
  if (p.length > 1) p = p.replace(/\/$/, '');
  if (p === '/index') p = '/';
  return u.origin + p;
}
// Resposta que veio de redirecionamento não pode ser entregue a uma navegação; recria sem a marca de redirect
async function cleanResponse(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
const delay = ms => new Promise(r => setTimeout(r, ms));

async function precachePage(cache, page) {
  const clean = abs(page);
  for (const url of [clean, clean.replace(/\/?$/, '.html')]) {       // tenta /dashboard e, se não houver, /dashboard.html
    if (page === './' && url !== clean) break;
    try {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (res.ok) { await cache.put(pageKey(clean), await cleanResponse(res)); return; }
    } catch (_) { /* tenta a próxima */ }
  }
}
async function fetchLib(url) {
  try { const r = await fetch(url, { mode: 'cors' }); if (r.ok) return r; } catch (_) {}
  return fetch(new Request(url, { mode: 'no-cors' }));               // CDN sem CORS: guarda como resposta opaca
}

/* ---------- ciclo de vida ---------- */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    const libs = await caches.open(LIB_CACHE);
    await Promise.allSettled([
      ...PAGES.map(p => precachePage(shell, p)),
      ...ASSETS.map(a => shell.add(new Request(abs(a), { cache: 'reload' }))),
      ...LIBS.map(async u => { if (!(await libs.match(u))) await libs.put(u, await fetchLib(u)); })
    ]);
    // Não chama skipWaiting aqui: a página avisa "Nova versão disponível" e o usuário escolhe quando atualizar.
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('sm-') && k !== SHELL_CACHE && k !== LIB_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'VERSION', version: SM_VERSION });
});

/* ---------- requisições ---------- */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (NEVER.some(re => re.test(url.hostname))) return;                       // Supabase: direto pra rede
  if (req.headers.has('range') || /\.(mp4|webm|mov|m4v)$/i.test(url.pathname)) return;   // vídeos: deixa o navegador

  if (req.mode === 'navigate') return e.respondWith(navigate(e));
  if (url.origin === self.location.origin) return e.respondWith(staleWhileRevalidate(e, SHELL_CACHE));
  if (CDN_HOSTS.has(url.hostname)) return e.respondWith(staleWhileRevalidate(e, LIB_CACHE));
});

// Páginas: rede primeiro (você sempre vê a versão mais nova), cópia guardada se estiver offline ou lento
async function navigate(e) {
  const req = e.request, key = pageKey(req.url);
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(key);

  const network = fetch(req).then(async res => {
    if (res.ok) await cache.put(key, await cleanResponse(res.clone()));
    return res;
  });
  if (!cached) return network.catch(offlinePage);
  e.waitUntil(network.catch(() => {}));                                       // deixa atualizar a cópia em segundo plano
  return Promise.race([network, delay(NAV_TIMEOUT).then(() => cached)]).catch(() => cached);
}

// Arquivos: entrega a cópia na hora e atualiza em segundo plano
async function staleWhileRevalidate(e, cacheName) {
  const req = e.request, cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) { e.waitUntil(net); return hit; }
  return (await net) || Response.error();
}

function offlinePage() {
  const html = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Offline — StoryMind</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1020;color:#e8e9ff;font:16px system-ui,sans-serif;text-align:center;padding:24px">' +
    '<div style="max-width:380px"><div style="font-size:44px">📡</div><h1 style="font-size:1.4rem;margin:14px 0 8px">Você está offline</h1>' +
    '<p style="color:#9a9dc9;line-height:1.5;margin:0 0 22px">Esta página ainda não foi guardada neste aparelho. Abra o StoryMind uma vez com internet e ela passa a funcionar offline.</p>' +
    '<button onclick="location.reload()" style="background:#6366f1;color:#fff;border:0;border-radius:10px;padding:12px 20px;font:inherit;font-weight:600;cursor:pointer">Tentar de novo</button></div></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
