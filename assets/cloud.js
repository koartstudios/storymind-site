// Sincroniza as histórias (localStorage) com a tabela "stories" do Supabase.
// Depende de: auth.js (variável global "sb") + config.js
//
// Regras de sincronização:
//  - Toda edição local vira "suja" (storymind_dirty: chave -> hora da edição) no mesmo instante,
//    antes de qualquer espera. Se a aba fechar antes do envio, a marca continua no navegador.
//  - No pull, a versão mais NOVA vence (hora da edição local x updated_at da nuvem).
//    Edição local ainda não enviada e mais nova que a nuvem nunca é sobrescrita.
//  - Exclusões deixam uma "lápide" que só some quando a nuvem confirma que a linha não existe mais.
//  - Ao esconder/fechar a página, flush() envia o que estiver pendente com fetch keepalive.
const SM_CLOUD = {
  DB_KEY: 'storymind_database_v2',
  TOMBSTONE_KEY: 'storymind_tombstones',
  DIRTY_KEY: 'storymind_dirty',
  DEBOUNCE_MS: 1500,
  timers: {},
  queue: {},    // chave -> história aguardando envio
  synced: {},   // chave -> JSON da última versão confirmada (evita reenviar o que não mudou)
  _token: null,

  /* ---------- armazenamento local ---------- */
  local() {
    try { return JSON.parse(localStorage.getItem(this.DB_KEY)) || {}; }
    catch (e) { return {}; }
  },

  tombstones() {
    try { return JSON.parse(localStorage.getItem(this.TOMBSTONE_KEY)) || []; }
    catch (e) { return []; }
  },
  addTombstone(key) {
    const t = this.tombstones();
    if (!t.includes(key)) t.push(key);
    localStorage.setItem(this.TOMBSTONE_KEY, JSON.stringify(t));
  },
  clearTombstone(key) {
    const t = this.tombstones().filter(k => k !== key);
    localStorage.setItem(this.TOMBSTONE_KEY, JSON.stringify(t));
  },

  dirty() {
    try { return JSON.parse(localStorage.getItem(this.DIRTY_KEY)) || {}; }
    catch (e) { return {}; }
  },
  markDirty(key, ts) {
    const d = this.dirty(); d[key] = ts;
    localStorage.setItem(this.DIRTY_KEY, JSON.stringify(d));
  },
  // Só limpa se não houve edição mais nova enquanto o envio estava em andamento.
  clearDirty(key, ts) {
    const d = this.dirty();
    if (ts === undefined || d[key] === ts) { delete d[key]; localStorage.setItem(this.DIRTY_KEY, JSON.stringify(d)); return true; }
    return false;
  },

  /* ---------- sessão (token usado pelo envio keepalive) ---------- */
  _initAuth() {
    try {
      sb.auth.getSession().then(({ data }) => { this._token = data.session ? data.session.access_token : null; });
      sb.auth.onAuthStateChange((_ev, session) => { this._token = session ? session.access_token : null; });
    } catch (e) { /* sem sessão: o envio normal ainda funciona pelo supabase-js */ }
  },

  /* ---------- nuvem -> local ---------- */
  async pull() {
    try {
      const { data, error } = await sb.from('stories').select('key,data,updated_at');
      if (error) throw error;

      const db = this.local();
      const dirty = this.dirty();
      const tombstones = this.tombstones();
      const cloudKeys = new Set(data.map(r => r.key));

      // 1. Lápides: a nuvem ainda tem a linha? Tenta apagar de novo e mantém a lápide.
      //    Só esquece a lápide quando a linha não aparece mais na nuvem.
      const stillInCloud = tombstones.filter(k => cloudKeys.has(k));
      for (const k of stillInCloud) {
        try { await sb.from('stories').delete().eq('key', k); } catch (_) {}
      }
      localStorage.setItem(this.TOMBSTONE_KEY, JSON.stringify(stillInCloud));
      tombstones.forEach(k => { delete db[k]; delete dirty[k]; });

      // 2. A versão mais nova vence. Edição local ainda não enviada e mais nova que a nuvem fica.
      const take = {};
      data.forEach(r => {
        if (tombstones.includes(r.key)) return;
        const cloudTs = Date.parse(r.updated_at) || 0;
        const localTs = dirty[r.key];
        if (db[r.key] && localTs && localTs > cloudTs) return;
        take[r.key] = r.data;
      });

      // 3. Sobe o que só existe aqui ou que é mais novo aqui.
      const up = Object.keys(db)
        .filter(k => !(k in take) && !tombstones.includes(k))
        .map(k => ({ key: k, data: db[k], updated_at: new Date(dirty[k] || Date.now()).toISOString() }));
      if (up.length) {
        const { error: upErr } = await sb.from('stories').upsert(up);
        if (upErr) console.warn('Falha ao subir histórias locais:', upErr);
        else up.forEach(u => { delete dirty[u.key]; this.synced[u.key] = JSON.stringify(db[u.key]); });
      }

      Object.keys(take).forEach(k => { delete dirty[k]; });
      Object.assign(db, take);
      localStorage.setItem(this.DB_KEY, JSON.stringify(db));
      localStorage.setItem(this.DIRTY_KEY, JSON.stringify(dirty));
      Object.keys(take).forEach(k => { this.synced[k] = JSON.stringify(db[k]); });
    } catch (e) {
      console.warn('Sincronização falhou (usando dados locais):', e);
    }
  },

  /* ---------- local -> nuvem ---------- */
  push(key, story) {
    if (this.tombstones().includes(key)) return;          // nunca empurra algo apagado
    if (this.synced[key] === JSON.stringify(story)) return; // nada mudou desde a última sincronização

    this.markDirty(key, Date.now());                      // marca ANTES de esperar
    this.queue[key] = story;
    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(() => this._send(key), this.DEBOUNCE_MS);
  },

  async _send(key) {
    delete this.timers[key];
    const story = this.queue[key];
    if (!story || this.tombstones().includes(key)) return;
    const ts = this.dirty()[key] || Date.now();
    const json = JSON.stringify(story);
    try {
      const { error } = await sb.from('stories')
        .upsert({ key, data: story, updated_at: new Date(ts).toISOString() });
      if (error) throw error;
      this.synced[key] = json;
      if (this.clearDirty(key, ts)) delete this.queue[key];
    } catch (e) {
      // Continua marcada como suja: será reenviada no próximo flush/pull.
      console.warn('Falha ao salvar na nuvem:', e);
    }
  },

  // Envia já o que estiver pendente. Chamado ao esconder/fechar a página.
  // keepalive deixa a requisição terminar mesmo depois que a página some (limite ~64 KB por corpo;
  // se passar disso ou falhar, a marca "suja" garante que o próximo pull não perca a edição).
  flush() {
    const keys = Object.keys(this.queue);
    keys.forEach(k => { clearTimeout(this.timers[k]); delete this.timers[k]; });
    if (!this._token) return;
    keys.forEach(key => {
      if (this.tombstones().includes(key)) return;
      const story = this.queue[key], ts = this.dirty()[key] || Date.now();
      const json = JSON.stringify(story);
      try {
        fetch(SM_CONFIG.SUPABASE_URL + '/rest/v1/stories?on_conflict=key', {
          method: 'POST', keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            apikey: SM_CONFIG.SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + this._token,
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify({ key, data: story, updated_at: new Date(ts).toISOString() })
        }).then(r => {
          if (r.ok) { this.synced[key] = json; if (this.clearDirty(key, ts)) delete this.queue[key]; }
        }).catch(() => {});
      } catch (_) { /* corpo grande demais para keepalive: fica suja */ }
    });
  },

  // Deleta de verdade e AGUARDA confirmação. Lança erro se a nuvem não removeu.
  async remove(key) {
    clearTimeout(this.timers[key]);
    delete this.timers[key]; delete this.queue[key]; delete this.synced[key];
    this.clearDirty(key);

    // Lápide ANTES de tocar no Supabase: qualquer push/pull posterior ignora a chave,
    // e ela só é esquecida quando uma sincronização confirmar que a linha sumiu.
    this.addTombstone(key);

    const { error } = await sb.from('stories').delete().eq('key', key);
    if (error) throw error;

    const { data, error: err2 } = await sb.from('stories')
      .select('key').eq('key', key).maybeSingle();
    if (err2) throw err2;
    if (data) throw new Error('DELETE não removeu a linha (verifique RLS na tabela stories).');
  }
};
SM_CLOUD._initAuth();
