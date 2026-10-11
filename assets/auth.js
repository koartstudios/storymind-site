// Sessão local (sem servidor). Serve para demonstração: NÃO é segurança real.
const SM_AUTH = {
  KEY: 'storymind_session',
  get() { try { return JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { return null; } },
  login(name, email) { localStorage.setItem(this.KEY, JSON.stringify({ name, email, at: Date.now() })); },
  logout() { localStorage.removeItem(this.KEY); location.href = 'login.html'; },
  require() { if (!this.get()) location.replace('login.html'); },   // páginas privadas
  redirectIfLogged() { if (this.get()) location.replace('dashboard.html'); } // login/index
};
