// Sincroniza as histórias (localStorage) com a tabela "stories" do Supabase.
const SM_CLOUD = {
  DB_KEY: 'storymind_database_v2',
  TOMBSTONE_KEY: 'storymind_tombstones',
  timers: {},

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

  // Baixa da nuvem; o que só existe neste navegador sobe (migração inicial).
  // Respeita tombstones (deleções locais ainda não refletidas na nuvem).
  async pull() {
    try {
      const { data, error } = await sb.from('stories').select('key,data');
      if (error) throw error;

      const db = this.local();
      const tombstones = this.tombstones();

      // 1. Remove dos dados locais qualquer chave que o usuário apagou
      tombstones.forEach(k => { delete db[k]; });

      const cloud = {};
      data.forEach(r => {
        if (!tombstones.includes(r.key)) cloud[r.key] = r.data;
      });

      // 2. Sobe o que só existe localmente (excluindo tombstones)
      const up = Object.keys(db)
        .filter(k => !(k in cloud) && !tombstones.includes(k))
        .map(k => ({ key: k, data: db[k] }));
      if (up.length) await sb.from('stories').upsert(up);

      Object.assign(db, cloud);
      localStorage.setItem(this.DB_KEY, JSON.stringify(db));

      // 3. Limpa tombstones já refletidos na nuvem
      const remaining = tombstones.filter(k => k in cloud);
      localStorage.setItem(this.TOMBSTONE_KEY, JSON.stringify(remaining));
    } catch (e) {
      console.warn('Sincronização falhou (usando dados locais):', e);
    }
  },

  push(key, story) {
    if (this.tombstones().includes(key)) return;   // ⛔ nunca empurra algo apagado

    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(async () => {
      if (this.tombstones().includes(key)) return;
      const { error } = await sb.from('stories')
        .upsert({ key, data: story, updated_at: new Date().toISOString() });
      if (error) console.warn('Falha ao salvar na nuvem:', error);
    }, 1500);
  },

  // Deleta de verdade e AGUARDA confirmação.
  async remove(key) {
    // 1. Cancela qualquer push pendente desta chave
    if (this.timers[key]) {
      clearTimeout(this.timers[key]);
      delete this.timers[key];
    }

    // 2. Marca o tombstone ANTES de tocar no Supabase,
    //    para que qualquer push/pull posterior ignore a chave.
    this.addTombstone(key);

    // 3. Executa o DELETE e espera resposta.
    const { error } = await sb.from('stories').delete().eq('key', key);
    if (error) throw error;

    // 4. Confirma que sumiu (defesa contra RLS silencioso).
    const { data, error: err2 } = await sb.from('stories')
      .select('key').eq('key', key).maybeSingle();
    if (err2) throw err2;
    if (data) {
      // O DELETE não removeu (provavelmente RLS). Não limpa o tombstone.
      throw new Error('DELETE não removeu a linha (verifique RLS na tabela stories).');
    }
  }
};
