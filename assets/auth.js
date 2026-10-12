// Login real via Supabase. Depende de: supabase-js (CDN) + config.js
const sb = supabase.createClient(SM_CONFIG.SUPABASE_URL, SM_CONFIG.SUPABASE_ANON_KEY);
const SM_AUTH = {
  async user() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
  async require() { const u = await this.user(); if (!u) location.replace('login.html'); return u; },
  async redirectIfLogged() { if (await this.user()) location.replace('dashboard.html'); },
  signIn(email, password) { return sb.auth.signInWithPassword({ email, password }); },
  signUp(email, password) { return sb.auth.signUp({ email, password }); },
  async logout() { await sb.auth.signOut(); localStorage.removeItem('storymind_database_v2'); localStorage.removeItem('storymind_meta'); location.href = 'login.html'; }
};
