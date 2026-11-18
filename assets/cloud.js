const SM_CLOUD = {
  DB_KEY: 'storymind_database_v2',
  TOMBSTONE_KEY: 'storymind_tombstones',
  DIRTY_KEY: 'storymind_dirty',
  DEBOUNCE_MS: 1500,
  timers: {},
  queue: {},
  synced: {},
  lastPushTs: {},
  knownTs: {},         // key -> updated_at (ms) da versão da nuvem que ESTE aparelho já conhece
  lastError: null,     // último erro de sync (para diagnóstico: digite SM_CLOUD.lastError no console)
  _lastCheck: 0,
  _inflightTs: {},      // key -> ts da gravação em andamento (para ignorar o "eco" do Realtime)
  _rtTimer: null,
  _channelPending: false,
  realtimeStatus: null,  // diagnóstico: SM_CLOUD.realtimeStatus deve ser 'SUBSCRIBED'
  lastRealtimeEvent: 0,  // diagnóstico: hora do último aviso recebido do Realtime
  _triggersBound: false,
  cloudCopy: {},        // key -> { data, ts }: última versão que sabemos estar na nuvem (base das mesclagens)
  _maxSeen: 0,          // maior carimbo visto em qualquer versão da nuvem: o relógio deste aparelho nunca fica atrás
  _casSupported: true,  // false se o SQL novo (p_expected) ainda não foi rodado no Supabase
  _sending: {}, _resend: {},
  revive: {},          // chaves que o store.js está restaurando (precisam sair do estado "excluída" na nuvem)
  _token: null,
  _channel: null,
  _tabChannel: null,
  _isPulling: false,
   _pullingPromise: null,

  _canon(v) {
    if (Array.isArray(v)) return '[' + v.map(x => this._canon(x)).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort()
        .map(k => JSON.stringify(k) + ':' + this._canon(v[k])).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  },

  // Etapa 2 (mesclagem por item). Desligar: localStorage.setItem('sm_merge_off','1') e recarregar.
  // Histórias compartilhadas COMIGO (de outra pessoa): { chave: { owner, role } } — guardado no aparelho
  SHARED_KEY: 'storymind_shared_v1',
  sharedMap() { try { return JSON.parse(localStorage.getItem(this.SHARED_KEY) || '{}') || {}; } catch (_) { return {}; } },
  setSharedMap(m) { try { localStorage.setItem(this.SHARED_KEY, JSON.stringify(m || {})); } catch (_) {} },
  // 'owner' (minha ou ainda desconhecida) | 'editor' | 'viewer'
  roleOf(key) { const s = this.sharedMap()[key]; return s ? (s.role === 'viewer' ? 'viewer' : 'editor') : 'owner'; },
  isShared(key) { return !!this.sharedMap()[key]; },

  mergeOn() { try { return !!window.SM_MERGE && localStorage.getItem('sm_merge_off') !== '1'; } catch (_) { return false; } },

  // Relógio "híbrido": nunca menor que qualquer carimbo já visto, mesmo que a hora deste aparelho esteja atrasada.
  _clock() { return Math.max(Date.now(), this._maxSeen + 1); },

  _seen(story, ts) {
    let m = ts || 0;
    const it = story && story._sync && story._sync.items;
    if (it) for (const k in it) { if (it[k].ts > m) m = it[k].ts; }
    if (m > this._maxSeen) this._maxSeen = m;
  },
  _remember(key, data, ts) { this.cloudCopy[key] = { data: data, ts: ts }; this._seen(data, ts); },
  _isMissingFn(err) {
    return !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message || ''));
  },

  // Carimba a história (o que mudou agora ganha o carimbo de agora) e, havendo tempo real, envia SÓ o que mudou
  // para quem está com a mesma história aberta (~0,1 s). A nuvem continua sendo a fonte de verdade: se um aviso
  // se perder, a mesclagem completa corrige.
  stampStory(key, story) {
    if (!story || !Array.isArray(story.sheets)) return;
    const legacy = !(story._sync && story._sync.items);
    const out = { changed: [], deleted: [] };
    SM_MERGE.stamp(story, { now: this._clock(), fallbackTs: legacy ? (this.knownTs[key] || undefined) : undefined, out: out });
    if (!legacy && (out.changed.length || out.deleted.length)) this._broadcast(key, story, out);
  },
  _broadcast(key, story, out) {
    try {
      if (!window.SM_COLLAB || typeof window.SM_COLLAB.broadcastDelta !== 'function') return;
      if (this.roleOf(key) === 'viewer') return;                         // leitora nunca transmite
      if (out.changed.length + out.deleted.length > 400) return;         // mudança enorme (ex.: duplicar página): a nuvem leva
      const d = SM_MERGE.makeDelta(story, out);
      if (JSON.stringify(d).length > 120000) return;                     // grande demais para o canal: a nuvem leva
      window.SM_COLLAB.broadcastDelta(key, d);
    } catch (e) { this.lastError = 'broadcast: ' + (e && e.message || e); }
  },

  // Busca UMA linha na nuvem (para mesclar antes de gravar). Devolve { none:true } se não existir.
  async _fetchRow(key) {
    const { data, error } = await sb.from('stories')
      .select('key,data,updated_at,deleted,user_id').eq('key', key)
      .order('updated_at', { ascending: false }).limit(1);
    if (error) throw error;
    const row = data && data[0];
    if (!row) return { none: true, ts: 0 };
    const ts = new Date(row.updated_at).getTime();
    if (row.data && this.mergeOn() && Array.isArray(row.data.sheets) && !(row.data._sync && row.data._sync.items)) {
      SM_MERGE.stamp(row.data, { now: ts, fallbackTs: ts });      // história antiga da nuvem, sem carimbos
    }
    if (!row.deleted && row.data) this._remember(key, row.data, ts);
    return { data: row.data, ts: ts, deleted: !!row.deleted };
  },

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

    // 1. Supabase Realtime (outros dispositivos) — um único canal por sessão
    if (!this._channel && !this._channelPending) {
      this._channelPending = true;
      sb.auth.getUser().then(({ data }) => {
        const id = data && data.user && data.user.id;
        if (!id || this._channel) { this._channelPending = false; return; }
        this._channel = sb.channel('stories:' + id)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' },   // sem filtro: o banco só envia o que esta conta pode ler (próprias + compartilhadas)
              (payload) => this._onRealtime(payload))
          .subscribe((status) => { this.realtimeStatus = status; });
        this._channelPending = false;
      }).catch(() => { this._channelPending = false; });
    }

    // 1b. Rede de segurança: se o Realtime não avisar (não habilitado no Supabase,
    //     ou história compartilhada cujo dono é outro), confere a nuvem ao voltar
    //     para o app, ao reconectar e a cada 30s com a aba visível.
    if (!this._triggersBound) {
      this._triggersBound = true;
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.checkRemote(true); });
      window.addEventListener('focus', () => this.checkRemote());
      window.addEventListener('online', () => { this.flush(); this.checkRemote(true); });
      setInterval(() => this.checkRemote(), 30000);
    }

    // 2. BroadcastChannel (outras abas no mesmo navegador)
    if ('BroadcastChannel' in window && !this._tabChannel) {
      this._tabChannel = new BroadcastChannel('storymind_sync');
      this._tabChannel.onmessage = (event) => {
        if (event.data === 'refresh') {
          this.pull();
        }
      };
    }
  },

  // Chegou um aviso do Realtime. Ignora o eco das nossas próprias gravações e agrupa avisos seguidos.
  _onRealtime(payload) {
    this.lastRealtimeEvent = Date.now();
    const r = payload && payload.new;
    if (r && r.key && r.updated_at && !r.deleted) {
      const ts = new Date(r.updated_at).getTime();
      if (ts === this.knownTs[r.key] || ts === this._inflightTs[r.key]) return;   // já temos essa versão
    }
    clearTimeout(this._rtTimer);
    this._rtTimer = setTimeout(() => this.pull(), 250);
  },

  // Consulta LEVE (só chave + data de atualização). Só faz o pull completo se algo mudou.
  async checkRemote(force) {
    if (!this._token || this._isPulling) return;
    if (document.visibilityState === 'hidden') return;
    if (Object.keys(this.queue).length) return;             // há edição local ainda não enviada: não mexe
    const now = Date.now();
    if (!force && now - this._lastCheck < 5000) return;
    this._lastCheck = now;
    try {
      const { data, error } = await sb.from('stories').select('key,updated_at,deleted');
      if (error) throw error;
      const tomb = new Set(this.tombstones());
      const local = this.local();
      const changed = (data || []).some(r => {
        if (r.deleted) return !!local[r.key];               // excluída em outro aparelho e ainda existe aqui
        if (tomb.has(r.key)) return false;
        return new Date(r.updated_at).getTime() > (this.knownTs[r.key] || 0);
      });
      if (changed) this.pull();
    } catch (e) { this.lastError = 'checkRemote: ' + (e && e.message || e); }
  },

    async pull() {
    if (this._isPulling && this._pullingPromise) return this._pullingPromise;
    this._isPulling = true;

    this._pullingPromise = (async () => {
        try {
            // 🔑 FILTRA POR user_id (Problema #2)
            const { data: { user } } = await sb.auth.getUser();
            if (!user) throw new Error('Usuário não autenticado');

            // 1) Histórias PRÓPRIAS — é o que sempre funcionou. Se isto falhar, o pull falha.
            const own = await sb.from('stories')
                .select('key,data,updated_at,deleted,user_id')
                .eq('user_id', user.id);
            if (own.error) throw own.error;
            const data = own.data || [];

            // 2) Histórias COMPARTILHADAS comigo — opcional.
            //    (O PostgREST não aceita subconsulta "select ..." dentro de .or()/.in(),
            //     por isso busco as chaves em story_members primeiro e depois uso .in('key', [...]).
            //     Se qualquer parte falhar, o compartilhamento é ignorado e a sync pessoal segue normal.)
            let memOk = false, sharedOk = true;
            const sharedNow = {};
            try {
                const mem = await sb.from('story_members')
                    .select('story_key,role')
                    .eq('member_id', user.id);
                if (!mem.error) {
                    memOk = true;
                    const roleByKey = {};
                    (mem.data || []).forEach(m => { if (m.story_key) roleByKey[m.story_key] = m.role === 'viewer' ? 'viewer' : 'editor'; });
                    const keys = Object.keys(roleByKey);
                    if (keys.length) {
                        const shared = await sb.from('stories')
                            .select('key,data,updated_at,deleted,user_id')
                            .in('key', keys);
                        if (!shared.error && shared.data) {
                            const have = new Set(data.map(r => r.key));
                            shared.data.forEach(r => {
                                if (!have.has(r.key)) data.push(r);
                                if (r.user_id !== user.id && !r.deleted) sharedNow[r.key] = { owner: r.user_id, role: roleByKey[r.key] };
                            });
                        } else {
                            sharedOk = false;
                            console.warn('Histórias compartilhadas indisponíveis:', shared.error && shared.error.message);
                        }
                    }
                } else {
                    console.warn('story_members indisponível:', mem.error.message);
                }
            } catch (e) {
                memOk = false;
                console.warn('Falha ao buscar histórias compartilhadas (ignorado):', e);
            }

            const db = this.local();
            const dirty = this.dirty();
            const tombstones = this.tombstones();

            // Recuperação: se a nuvem confirma que uma história está ativa
            // (deleted=false), uma tombstone local antiga não deve ocultá-la.
            const activeCloudKeys = new Set((data || [])
                .filter(row => !row.deleted && row.key)
                .map(row => row.key));
            for (let i = tombstones.length - 1; i >= 0; i--) {
                if (activeCloudKeys.has(tombstones[i])) tombstones.splice(i, 1);
            }
            const tombstoneSet = new Set(tombstones);

            // 1. Aplicar exclusões vindas da nuvem (deleted = true)
            const deletedKeys = [];
            (data || []).forEach(row => {
                if (row.deleted) {
                    if (db[row.key]) deletedKeys.push(row.key);
                    try { if (window.SM_STORE) SM_STORE.noteDeleted(row.key); } catch (_) {}   // guarda cópia antes de sumir
                    delete db[row.key];
                    if (!tombstoneSet.has(row.key)) {
                        tombstones.push(row.key);
                        tombstoneSet.add(row.key);
                    }
                }
            });

            // 1b. Acesso removido: uma história que era compartilhada comigo e não aparece mais.
            //     (Só vale se as duas consultas deram certo; senão uma falha de rede apagaria cópias locais.)
            const revokedKeys = [];
            if (memOk && sharedOk) {
                const prevShared = this.sharedMap();
                const present = new Set((data || []).map(r => r.key));
                Object.keys(prevShared).forEach(k => {
                    if (present.has(k)) return;
                    if (db[k]) {
                        revokedKeys.push(k);
                        try { if (window.SM_STORE) SM_STORE.noteDeleted(k); } catch (_) {}   // guarda cópia antes de sumir
                        delete db[k];
                    }
                    clearTimeout(this.timers[k]); delete this.timers[k]; delete this.queue[k]; this.clearDirty(k);
                });
                this.setSharedMap(sharedNow);
            }

            // 2. Aplicar tombstones locais (remover da nuvem? aqui só pula o merge)
            //    (tombstones = histórias apagadas localmente; não devem ressuscitar)

            // 3. Merge: só aplica da nuvem o que é mais recente que o local
            const take = {};
            const takeTs = {};
            const changedKeys = [];
            const mergeRows = [];     // Etapa 2: histórias com edições locais ainda não enviadas
            (data || []).forEach(row => {
                if (row.deleted) return;
                this.knownTs[row.key] = new Date(row.updated_at).getTime();
                if (tombstoneSet.has(row.key)) return;          // respeita tombstone local
                if (!row.data) return;

                const cloudTs = new Date(row.updated_at).getTime();
                const localTs = dirty[row.key] || 0;

                if (this.mergeOn() && row.data && Array.isArray(row.data.sheets)) {
                    if (!(row.data._sync && row.data._sync.items)) SM_MERGE.stamp(row.data, { now: cloudTs, fallbackTs: cloudTs });   // nuvem antiga, sem carimbos
                    this._remember(row.key, row.data, cloudTs);
                    if (localTs > 0 && db[row.key]) { mergeRows.push({ row: row, cloudTs: cloudTs, localTs: localTs }); return; }
                }

                // Se o local está sujo (não sincronizado) e é mais novo, não sobrescreve
                if (localTs > 0 && localTs > cloudTs) return;

                // Se não há local, ou o local está limpo, aplica o da nuvem
                if (!db[row.key] || localTs === 0) {
                    take[row.key] = row.data; takeTs[row.key] = cloudTs;
                } else if (localTs < cloudTs) {
                    take[row.key] = row.data; takeTs[row.key] = cloudTs;
                }
            });

            // 3b. Etapa 2: local com edições não enviadas + nuvem com versão nova => mescla item a item
            const mergedKeys = [];
            mergeRows.forEach(({ row, cloudTs, localTs }) => {
                const k = row.key, localStory = db[k];
                let merged = null;
                try { merged = SM_MERGE.merge(localStory, row.data, { now: this._clock(), localFallbackTs: localTs, remoteFallbackTs: cloudTs }); }
                catch (e) { this.lastError = 'merge: ' + (e && e.message || e); }
                if (!merged) {                                   // formato antigo: regra antiga (o mais novo vence)
                    if (localTs <= cloudTs) { take[k] = row.data; takeTs[k] = cloudTs; }
                    return;
                }
                if (localStory.isFavorite !== undefined) merged.isFavorite = localStory.isFavorite;
                if (SM_MERGE.same(merged, row.data)) { take[k] = row.data; takeTs[k] = cloudTs; return; }   // nada local a enviar
                if (!SM_MERGE.same(merged, localStory)) {
                    changedKeys.push(k);
                    try { if (window.SM_STORE) SM_STORE.beforeOverwrite(k, localStory); } catch (_) {}   // seguro extra
                }
                db[k] = merged;
                mergedKeys.push(k);
            });

            // 4. Aplicar o que veio da nuvem — PRESERVANDO isFavorite local
            Object.keys(take).forEach(k => { delete dirty[k]; });
            Object.keys(take).forEach(k => {
                const cloudStory = take[k];
                const localStory = db[k];
                if (localStory && typeof localStory.isFavorite !== 'undefined') {
                    cloudStory.isFavorite = localStory.isFavorite;
                }
                // Só conta como "mudou" se o CONTEÚDO for diferente (a ordem das chaves não importa)
                // (activeSheetId e isFavorite são estado de tela/local: não contam como mudança)
                const strip = (x) => { const c = Object.assign({}, x); delete c.activeSheetId; delete c.isFavorite; return c; };
                const same = !!localStory && this._canon(strip(localStory)) === this._canon(strip(cloudStory));
                if (!same) {
                    changedKeys.push(k);
                    try {
                        if (localStory && window.SM_STORE && this.lastPushTs[k] !== takeTs[k]) SM_STORE.beforeOverwrite(k, localStory);
                    } catch (_) {}
                }
                // A versão da nuvem venceu: cancela envio local pendente desta história (a cópia local fica no histórico de versões)
                clearTimeout(this.timers[k]); delete this.timers[k]; delete this.queue[k];
                db[k] = cloudStory;
            });

            // 5. Persistir
            localStorage.setItem(this.DB_KEY, JSON.stringify(db));
            localStorage.setItem(this.DIRTY_KEY, JSON.stringify(dirty));
            localStorage.setItem(this.TOMBSTONE_KEY, JSON.stringify(tombstones));
            Object.keys(take).forEach(k => { this.synced[k] = JSON.stringify(db[k]); });
            mergedKeys.forEach(k => {                      // a mescla ainda tem edições locais: envia
                this.queue[k] = db[k];
                clearTimeout(this.timers[k]);
                this.timers[k] = setTimeout(() => this._send(k), 300);
            });

            window.dispatchEvent(new CustomEvent('cloud:pull:done', { detail: { changed: changedKeys, deleted: deletedKeys, revoked: revokedKeys } }));
        } catch (e) {
            this.lastError = 'pull: ' + (e && e.message || e);
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
    if (this.roleOf(key) === 'viewer') return;        // só leitura: nunca grava na nuvem
    if (this.mergeOn() && story && Array.isArray(story.sheets)) {
      try { this.stampStory(key, story); }
      catch (e) { this.lastError = 'stamp: ' + (e && e.message || e); }
    }
    const json = JSON.stringify(story);
    if (this.synced[key] === json) return;

    this.markDirty(key, Date.now());
    this.queue[key] = story;
    
    // Notifica outras abas imediatamente
    if (this._tabChannel) this._tabChannel.postMessage('refresh');

    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(() => this._send(key), this.DEBOUNCE_MS);
  },

  _send(key) { return this.mergeOn() ? this._sendMerged(key) : this._sendLegacy(key); },

  // Etapa 2: antes de gravar, junta a versão local com a da nuvem (item a item) e só grava se a nuvem
  // ainda for a que conhecemos (p_expected). Se alguém gravou no meio, busca, mescla de novo e tenta outra vez.
  async _sendMerged(key) {
    delete this.timers[key];
    if (this._sending[key]) { this._resend[key] = true; return; }
    const first = this.queue[key];
    if (!first || this.tombstones().includes(key)) return;
    this._sending[key] = true;
    const ts = this.dirty()[key] || Date.now();
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      let base = this.cloudCopy[key] || null;
      let done = false;
      for (let attempt = 0; attempt < 4 && !done; attempt++) {
        const story = this.queue[key] || first;                 // sempre a versão local mais recente
        if (!base) base = await this._fetchRow(key);
        const revive = !!this.revive[key];
        if (base.deleted && !revive) { delete this._inflightTs[key]; this.pull(); return; }   // excluída em outro aparelho

        let payload = story;
        if (base.data && !revive) {
          const merged = SM_MERGE.merge(story, base.data, { now: this._clock(), remoteFallbackTs: base.ts });
          if (merged) payload = merged;                         // null = formato antigo: vale a versão local
          if (SM_MERGE.same(payload, base.data)) {              // a nuvem já tem tudo: não precisa gravar
            this.synced[key] = JSON.stringify(story);
            if (this.clearDirty(key, ts)) delete this.queue[key];
            delete this._inflightTs[key];
            done = true; break;
          }
        }

        const newTs = Math.max(this._clock(), (base.ts || 0) + 1);
        const args = { p_key: key, p_data: payload, p_updated_at: new Date(newTs).toISOString(), p_revive: revive };
        if (this._casSupported) args.p_expected = new Date(base.ts || 0).toISOString();
        this._inflightTs[key] = newTs;

        const { data: res, error } = await sb.rpc('sm_save_story', args);
        if (error) {
          if (this._casSupported && this._isMissingFn(error)) {   // o SQL novo ainda não foi rodado: segue sem a conferência
            this._casSupported = false; this.lastError = 'SQL da Etapa 2 ausente (rodando sem p_expected)'; base = null; continue;
          }
          throw error;
        }
        const status = typeof res === 'string' ? res : 'ok';
        if (status === 'conflict') { base = null; continue; }    // alguém gravou no meio: busca de novo e mescla
        if (status === 'deleted') { delete this._inflightTs[key]; this.pull(); return; }
        if (status === 'forbidden') {                          // sem permissão (acesso removido ou só leitura): para de insistir
          delete this._inflightTs[key];
          this.lastError = 'sem permissão para salvar esta história';
          clearTimeout(this.timers[key]); delete this.timers[key]; delete this.queue[key]; this.clearDirty(key);
          window.dispatchEvent(new CustomEvent('cloud:forbidden', { detail: { key: key } }));
          this.pull();                                         // descobre se o acesso foi removido
          return;
        }

        // gravado
        this.knownTs[key] = newTs;
        this.lastPushTs[key] = newTs;
        this._remember(key, JSON.parse(JSON.stringify(payload)), newTs);   // cópia independente: o app continua editando o objeto original
        this.synced[key] = JSON.stringify(story);
        this.lastError = null;
        delete this._inflightTs[key];
        delete this.revive[key];
        if (this.clearDirty(key, ts)) delete this.queue[key];

        if (payload !== story && !SM_MERGE.same(payload, story)) {
          // a mescla trouxe mudanças de outros aparelhos: guarda no banco local e avisa o app
          const db = this.local();
          if (db[key] && db[key].isFavorite !== undefined) payload.isFavorite = db[key].isFavorite;
          db[key] = payload;
          localStorage.setItem(this.DB_KEY, JSON.stringify(db));
          window.dispatchEvent(new CustomEvent('cloud:pull:done', { detail: { changed: [key], deleted: [], merged: true } }));
        }
        window.dispatchEvent(new CustomEvent('cloud:save:done', { detail: { key } }));
        done = true;
      }
      if (!done) throw new Error('conflito repetido ao salvar');
    } catch (e) {
      delete this._inflightTs[key];
      this.lastError = 'save: ' + (e && e.message || e);
      console.warn('Falha ao salvar na nuvem, tentando novamente em 5s:', e);
      setTimeout(() => this._send(key), 5000);
    } finally {
      delete this._sending[key];
      if (this._resend[key]) { delete this._resend[key]; this._send(key); }
    }
  },

  async _sendLegacy(key) {
    delete this.timers[key];
    const story = this.queue[key];
    if (!story || this.tombstones().includes(key)) return;
    const ts = this.dirty()[key] || Date.now();
    const json = JSON.stringify(story);
    this._inflightTs[key] = ts;

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

       // ⬇️ CÓDIGO NOVO (RPC) ⬇️
    const { error } = await sb.rpc('sm_save_story', { 
      p_key: key, 
      p_data: story, 
      p_updated_at: new Date(ts).toISOString(),
      p_revive: this.revive[key] ? true : false
    });
    // ⬆️ FIM DO CÓDIGO NOVO ⬆️
    
      if (error) throw error;
      
      this.synced[key] = json;
      this.lastPushTs[key] = ts;
      this.knownTs[key] = ts;
      this.lastError = null;
      delete this._inflightTs[key];
      delete this.revive[key];
      if (this.clearDirty(key, ts)) delete this.queue[key];
      
       window.dispatchEvent(new CustomEvent('cloud:save:done', { detail: { key } }));
    } catch (e) {
      delete this._inflightTs[key];
      this.lastError = 'save: ' + (e && e.message || e);
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
    try { if (window.SM_STORE) SM_STORE.noteDeleted(key); } catch (_) {}   // snapshot "antes de excluir"
    clearTimeout(this.timers[key]);
    delete this.timers[key]; delete this.queue[key]; delete this.synced[key];
    this.clearDirty(key);

    // Convidado: "excluir" significa SAIR da história (ela continua existindo para a dona e para os outros)
    if (this.isShared(key)) {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');
      const left = await sb.from('story_members').delete().eq('story_key', key).eq('member_id', user.id);
      if (left.error) throw left.error;
      const shared = this.sharedMap(); delete shared[key]; this.setSharedMap(shared);
      const dbl = this.local();
      if (dbl[key]) { delete dbl[key]; localStorage.setItem(this.DB_KEY, JSON.stringify(dbl)); }
      return;                                              // sem tombstone: se for convidada de novo, ela volta
    }

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

window.SM_CLOUD = SM_CLOUD;   // store.js/dashboard.js usam window.SM_CLOUD (const global não vira propriedade de window)
SM_CLOUD._initAuth();

