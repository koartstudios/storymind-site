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
  _isPulling: false,
   _pullingPromise: null,

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
    // 1. Pega a sessão atual (se o cara já estava logado)
    sb.auth.getSession().then(({ data }) => { 
      this._token = data.session ? data.session.access_token : null; 
      if (this._token) this.initSync(); // Se já tem token, conecta!
    });

    // 2. Fica escutando o login/logout
    sb.auth.onAuthStateChange((_ev, session) => { 
      this._token = session ? session.access_token : null; 
      if (this._token) {
        // Quando o usuário logar, avisa o app inteiro para puxar os dados
        this.initSync();
        this.pull(); // Puxa os dados assim que logar
      }
    });
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
    // Se já está puxando, retorna a MESMA promise para quem aguarda
    if (this._isPulling && this._pullingPromise) return this._pullingPromise;
    this._isPulling = true;
    
    this._pullingPromise = (async () => {
        try {
            const { data, error } = await sb.from('stories')
                .select('key,data,updated_at,deleted');
            if (error) throw error;

            const db = this.local();
            const dirty = this.dirty();
            const localTombstones = new Set(this.tombstones());

            // ... todo o código do try original fica aqui sem alteração ...
            // (1. aplicar exclusões, 2. tombstones, 3. merge, 4. up, 5. aplicar)
            
            // ============= AQUI MUDOU =============
            // 5. Aplicar o que veio da nuvem — PRESERVANDO isFavorite local
            Object.keys(take).forEach(k => { delete dirty[k]; });
            Object.keys(take).forEach(k => {
                const cloudStory = take[k];
                const localStory = db[k];
                if (localStory && typeof localStory.isFavorite !== 'undefined') {
                    cloudStory.isFavorite = localStory.isFavorite;
                }
                db[k] = cloudStory;
            });
            localStorage.setItem(this.DB_KEY, JSON.stringify(db));
            localStorage.setItem(this.DIRTY_KEY, JSON.stringify(dirty));
            Object.keys(take).forEach(k => { this.synced[k] = JSON.stringify(db[k]); });
            window.dispatchEvent(new CustomEvent('cloud:pull:done'));
            // ======================================
        } catch (e) {
            console.warn('Sincronização (pull) falhou, usando dados locais:', e);
        } finally {
            this._isPulling = false;
            this._pullingPromise = null;
        }
    })();
    
    return this._pullingPromise;
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
  key, data: story, updated_at: new Date(ts).toISOString(), user_id: user.id
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
    keys.forEach(key => this._send(key));
  },

    async remove(key) {
    clearTimeout(this.timers[key]);
    delete this.timers[key]; delete this.queue[key]; delete this.synced[key];
    this.clearDirty(key);

    // 1. SOFT DELETE na nuvem (a linha continua existindo, mas marcada)
    const { error } = await sb.from('stories')
  .update({ deleted: true, updated_at: new Date().toISOString() })
  .eq('key', key);
    if (error) throw error;

    // 2. Remover do localStorage local imediatamente
    const db = this.local();
    if (db[key]) {
      delete db[key];
      localStorage.setItem(this.DB_KEY, JSON.stringify(db));
    }

    // 3. Manter tombstone local (compatibilidade + defesa extra)
    this.addTombstone(key);
  }
};

SM_CLOUD._initAuth();

