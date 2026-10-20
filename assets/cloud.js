const SM_CLOUD = {
  DB_KEY: 'storymind_database_v2',
  TOMBSTONE_KEY: 'storymind_tombstones',
  DIRTY_KEY: 'storymind_dirty',
  DEBOUNCE_MS: 1500,
  timers: {},
  queue: {},
  synced: {},
  _token: null,
  _channel: null,
  _tabChannel: null,

  local() { try { return JSON.parse(localStorage.getItem(this.DB_KEY)) || {}; } catch (e) { return {}; } },
  tombstones() { try { return JSON.parse(localStorage.getItem(this.TOMBSTONE_KEY)) || []; } catch (e) { return []; } },
  dirty() { try { return JSON.parse(localStorage.getItem(this.DIRTY_KEY)) || {}; } catch (e) { return {}; } },

  markDirty(key, ts) {
    const d = this.dirty(); d[key] = ts;
    localStorage.setItem(this.DIRTY_KEY, JSON.stringify(d));
  },
  clearDirty(key, ts) {
    const d = this.dirty();
    if (ts === undefined || d[key] === ts) { delete d[key]; localStorage.setItem(this.DIRTY_KEY, JSON.stringify(d)); return true; }
    return false;
  },
  addTombstone(key) {
    const t = this.tombstones(); if (!t.includes(key)) t.push(key);
    localStorage.setItem(this.TOMBSTONE_KEY, JSON.stringify(t));
  },
  clearTombstone(key) {
    const t = this.tombstones().filter(k => k !== key);
    localStorage.setItem(this.TOMBSTONE_KEY, JSON.stringify(t));
  },

  _initAuth() {
    sb.auth.getSession().then(({ data }) => { this._token = data.session ? data.session.access_token : null; });
    sb.auth.onAuthStateChange((_ev, session) => { this._token = session ? session.access_token : null; });
  },

  // Inicia canais de sincronização (Realtime e Cross-Tab)
  initSync() {
    if (!this._token) return;

    // 1. Supabase Realtime (outros dispositivos)
    const userId = sb.auth.getUser().then(({ data }) => data.user?.id);
    userId.then(id => {
      if (!id) return;
      this._channel = sb.channel('public:stories')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'stories', filter: `user_id=eq.${id}` }, () => {
          // Quando qualquer dispositivo alterar, este dispositivo faz um pull
          this.pull();
        })
        .subscribe();
    });

    // 2. BroadcastChannel (outras abas no mesmo navegador)
    if ('BroadcastChannel' in window) {
      this._tabChannel = new BroadcastChannel('storymind_sync');
      this._tabChannel.onmessage = (event) => {
        if (event.data === 'refresh') {
          this.pull();
        }
      };
    }
  },

  async pull() {
    try {
      const { data, error } = await sb.from('stories').select('key,data,updated_at');
      if (error) throw error;

      const db = this.local();
      const dirty = this.dirty();
      const tombstones = this.tombstones();
      const cloudKeys = new Set(data.map(r => r.key));

      // 1. Sincroniza tombstones da nuvem para o local (simplificado)
      // (Em uma implementação completa, você teria uma tabela de tombstones; aqui usamos uma chave especial)
      // ...

      // 2. Resolução de conflitos (Last Write Wins)
      const take = {};
      data.forEach(r => {
        if (tombstones.includes(r.key)) return;
        const cloudTs = Date.parse(r.updated_at) || 0;
        const localTs = dirty[r.key] || 0;
        // Se o local for mais novo, não sobrescreve
        if (db[r.key] && localTs > cloudTs) return;
        take[r.key] = r.data;
      });

      // 3. Envia o que só existe aqui ou é mais novo
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

      // Notifica a UI para renderizar novamente
      window.dispatchEvent(new CustomEvent('cloud:pull:done'));

    } catch (e) {
      console.warn('Sincronização (pull) falhou, usando dados locais:', e);
    }
  },

  push(key, story) {
    if (this.tombstones().includes(key)) return;
    const json = JSON.stringify(story);
    if (this.synced[key] === json) return;

    this.markDirty(key, Date.now());
    this.queue[key] = story;
    
    // Notifica outras abas imediatamente
    if (this._tabChannel) this._tabChannel.postMessage('refresh');

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
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const { error } = await sb.from('stories').upsert({ 
        key, 
        data: story, 
        updated_at: new Date(ts).toISOString(),
        user_id: user.id
      });
      if (error) throw error;
      
      this.synced[key] = json;
      if (this.clearDirty(key, ts)) delete this.queue[key];
      
       window.dispatchEvent(new CustomEvent('cloud:save:done', { detail: { key } }));
    } catch (e) {
      console.warn('Falha ao salvar na nuvem, tentando novamente em 5s:', e);
      // Retry automático
      setTimeout(() => this._send(key), 5000);
    }
  },

  flush() {
    const keys = Object.keys(this.queue);
    keys.forEach(k => { clearTimeout(this.timers[k]); delete this.timers[k]; });
    if (!this._token) return;
    keys.forEach(key => this._send(key));
  },

  async remove(key) {
    clearTimeout(this.timers[key]);
    delete this.timers[key]; delete this.queue[key]; delete this.synced[key];
    this.clearDirty(key);
    this.addTombstone(key);

    const { error } = await sb.from('stories').delete().eq('key', key);
    if (error) throw error;
  }
};

SM_CLOUD._initAuth();
// Inicia o Realtime após um pequeno delay para garantir o token
setTimeout(() => SM_CLOUD.initSync(), 1000);