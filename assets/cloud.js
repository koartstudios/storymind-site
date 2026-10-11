// Sincroniza as histórias (localStorage) com a tabela "stories" do Supabase.
const SM_CLOUD = {
  DB_KEY: 'storymind_database_v2', timers: {},
  local() { try { return JSON.parse(localStorage.getItem(this.DB_KEY)) || {}; } catch (e) { return {}; } },
  // Baixa da nuvem; o que só existe neste navegador sobe para a nuvem (migração inicial).
  async pull() {
    try {
      const { data, error } = await sb.from('stories').select('key,data');
      if (error) throw error;
      const db = this.local(), cloud = {};
      data.forEach(r => { cloud[r.key] = r.data; });
      const up = Object.keys(db).filter(k => !(k in cloud)).map(k => ({ key: k, data: db[k] }));
      if (up.length) await sb.from('stories').upsert(up);
      Object.assign(db, cloud);
      localStorage.setItem(this.DB_KEY, JSON.stringify(db));
    } catch (e) { console.warn('Sincronização falhou (usando dados locais):', e); }
  },
  // Envia uma história (com espera de 1,5 s para não enviar a cada tecla).
  push(key, story) {
    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(async () => {
      const { error } = await sb.from('stories').upsert({ key, data: story, updated_at: new Date().toISOString() });
      if (error) console.warn('Falha ao salvar na nuvem:', error);
    }, 1500);
  },
  async remove(key) { await sb.from('stories').delete().eq('key', key); }
};
