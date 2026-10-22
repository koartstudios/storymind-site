/* StoryMind — PWA: registra o service worker, avisa de nova versão, oferece "Instalar" e avisa offline/online.
 *
 * Uso: uma linha no <head> de cada página.
 *   <script src="assets/pwa.js" defer></script>               (login.html e app.html)
 *   <script src="assets/pwa.js" data-prompt defer></script>   (index.html e dashboard.html: também mostra o convite de instalação)
 */
(function () {
  'use strict';
  const me = document.currentScript || document.querySelector('script[src*="pwa.js"]');
  const wantPrompt = !!(me && me.hasAttribute('data-prompt'));
  const root = me && me.src ? new URL('../', me.src).href : location.origin + '/';   // assets/pwa.js -> raiz do site
  const DISMISS_KEY = 'storymind_pwa_dismissed', DISMISS_DAYS = 14;

  /* ---------- tags do <head> (só cria se a página ainda não tiver) ---------- */
  function ensure(sel, tag, attrs) {
    if (document.head.querySelector(sel)) return;
    const el = document.createElement(tag); Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k])); document.head.appendChild(el);
  }
  ensure('link[rel="manifest"]', 'link', { rel: 'manifest', href: root + 'manifest.webmanifest' });
  ensure('meta[name="theme-color"]', 'meta', { name: 'theme-color', content: '#0f1020' });
  ensure('link[rel="apple-touch-icon"]', 'link', { rel: 'apple-touch-icon', href: root + 'assets/icons/apple-touch-icon.png' });
  ensure('link[rel="icon"]', 'link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: root + 'assets/icons/favicon-32.png' });
  ensure('meta[name="mobile-web-app-capable"]', 'meta', { name: 'mobile-web-app-capable', content: 'yes' });
  ensure('meta[name="apple-mobile-web-app-capable"]', 'meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  ensure('meta[name="apple-mobile-web-app-title"]', 'meta', { name: 'apple-mobile-web-app-title', content: 'StoryMind' });
  ensure('meta[name="apple-mobile-web-app-status-bar-style"]', 'meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' });

  /* ---------- avisos (topo da tela, não atrapalham o botão flutuante do celular) ---------- */
  const css = document.createElement('style'); css.id = 'sm-pwa-style';
  css.textContent = `
    #sm-pwa-stack{position:fixed;z-index:2147483000;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 10px);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;padding:0 12px}
    .sm-pwa-card{pointer-events:auto;width:100%;max-width:460px;display:flex;align-items:center;gap:12px;background:#181a33;color:#e8e9ff;border:1px solid #2a2d52;border-radius:14px;padding:12px 14px;font:500 .9rem/1.35 Inter,system-ui,sans-serif;box-shadow:0 14px 34px rgba(0,0,0,.5);animation:sm-pwa-in .22s ease}
    .sm-pwa-card span{flex:1;min-width:0}
    .sm-pwa-card button{flex:none;font:inherit;font-weight:600;border-radius:10px;padding:8px 13px;cursor:pointer;border:1px solid #2a2d52;background:transparent;color:#e8e9ff;min-height:38px}
    .sm-pwa-card button.p{background:#6366f1;border-color:#6366f1;color:#fff}
    @keyframes sm-pwa-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
    @media (prefers-reduced-motion:reduce){.sm-pwa-card{animation:none}}`;
  document.head.appendChild(css);

  let stack;
  function card(html, buttons, autoHideMs) {
    if (!stack) { stack = document.createElement('div'); stack.id = 'sm-pwa-stack'; stack.setAttribute('role', 'status'); stack.setAttribute('aria-live', 'polite'); (document.body || document.documentElement).appendChild(stack); }
    const c = document.createElement('div'); c.className = 'sm-pwa-card';
    const s = document.createElement('span'); s.textContent = html; c.appendChild(s);
    (buttons || []).forEach(b => { const el = document.createElement('button'); el.type = 'button'; el.textContent = b.label; if (b.primary) el.className = 'p'; el.onclick = () => { c.remove(); b.onClick && b.onClick(); }; c.appendChild(el); });
    stack.appendChild(c);
    if (autoHideMs) setTimeout(() => c.remove(), autoHideMs);
    return c;
  }

  /* ---------- service worker + atualização ---------- */
  let refreshing = false, updateCard = null;
  function showUpdate(worker) {
    if (updateCard && updateCard.isConnected) return;
    updateCard = card('Nova versão do StoryMind disponível.', [{
      label: 'Atualizar', primary: true,
      onClick: () => { refreshing = true; worker.postMessage({ type: 'SKIP_WAITING' }); }
    }, { label: 'Depois' }]);
  }
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && secure) {
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) location.reload(); });   // só recarrega se o usuário pediu
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(root + 'sw.js', { scope: root }).then(reg => {
        if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing; if (!nw) return;
          nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw); });
        });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
        window.SM_PWA.registration = reg;
      }).catch(err => console.warn('PWA: falha ao registrar o service worker', err));
    });
  }

  /* ---------- instalar ---------- */
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const dismissed = () => { try { const t = +localStorage.getItem(DISMISS_KEY); return t && Date.now() - t < DISMISS_DAYS * 864e5; } catch (e) { return false; } };
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {} };
  let deferred = null, installCard = null;

  function showInstall() {
    if (!wantPrompt || standalone() || dismissed() || !deferred || (installCard && installCard.isConnected)) return;
    installCard = card('Instale o StoryMind para abrir como aplicativo, em tela cheia.', [
      { label: 'Instalar', primary: true, onClick: () => window.SM_PWA.install() },
      { label: 'Agora não', onClick: dismiss }
    ]);
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; showInstall(); });
  window.addEventListener('appinstalled', () => { deferred = null; if (installCard) installCard.remove(); });

  // iPhone/iPad não têm o evento acima: mostramos o passo a passo uma vez
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (wantPrompt && isIOS && !standalone() && !dismissed()) {
    window.addEventListener('load', () => setTimeout(() => card('Para instalar: toque em Compartilhar e depois em “Adicionar à Tela de Início”.', [{ label: 'Entendi', primary: true, onClick: dismiss }]), 2500));
  }

  /* ---------- offline / online ---------- */
  window.addEventListener('offline', () => card('Sem internet. Você pode continuar; o envio para a nuvem acontece quando a conexão voltar.', [], 6000));
  window.addEventListener('online', () => card('Conexão restaurada.', [], 3000));

  /* ---------- gancho público (ex.: para um botão "Instalar app" próprio) ---------- */
  window.SM_PWA = {
    registration: null,
    canInstall: () => !!deferred && !standalone(),
    isInstalled: standalone,
    install: async function () {
      if (!deferred) return false;
      deferred.prompt(); const r = await deferred.userChoice; deferred = null;
      if (r && r.outcome !== 'accepted') dismiss();
      return !!r && r.outcome === 'accepted';
    }
  };
})();
