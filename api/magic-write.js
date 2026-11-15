/* ============================================================
   StoryMind — proxy de IA (Vercel Serverless Function) · Google Gemini
   Caminho no projeto:  api/magic-write.js   →  POST /api/magic-write

   A chave NUNCA vai para o navegador. Configure na Vercel:
     Project → Settings → Environment Variables
       GEMINI_API_KEY   (obrigatória — gere em aistudio.google.com/apikey)
       GEMINI_MODELS    (opcional — lista separada por vírgula, em ordem de preferência)
       AI_DAILY_LIMIT   (opcional — máx. de gerações por usuário por dia; padrão 60)
       AI_BURST_LIMIT   (opcional — máx. de gerações por usuário por minuto; padrão 6)
       SUPABASE_URL / SUPABASE_ANON_KEY (opcionais — por padrão usa os mesmos valores públicos do config.js)
   Depois de criar/alterar variáveis, faça um novo deploy.

   SEGURANÇA: só atende usuários logados (token do Supabase no cabeçalho Authorization)
   e aplica limite por usuário. Para o limite diário ser durável, rode uma vez o arquivo
   supabase-ai-usage.sql no SQL Editor do Supabase; sem ele, o limite diário vale só por
   instância do servidor (menos preciso).

   O modelo é escolhido AQUI (servidor), não no navegador. Se o Google
   aposentar um modelo, basta trocar GEMINI_MODELS na Vercel — sem mexer
   no site. Se um modelo falhar (não existe mais, cota estourada,
   instabilidade), o proxy tenta o próximo da lista.

   Resposta: devolve no formato { choices: [{ message: { content }, finish_reason }] }
   para o front-end (magic-write.js) não depender do formato do Google.
   ============================================================ */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// Ordem de preferência padrão (verificado em nov/2026; sobrescreva com GEMINI_MODELS)
const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'];

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://pinndyuwryhybccdqxqt.supabase.co').replace(/\/+$/, '');
// Chave "publishable/anon" é pública por natureza (a proteção vem do RLS), a mesma do assets/config.js
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_7zAjIH1S_V-vb6DnBKJZ8g_nBFWEkws';

const DAILY_LIMIT = Math.max(1, Number(process.env.AI_DAILY_LIMIT) || 60);
const BURST_LIMIT = Math.max(1, Number(process.env.AI_BURST_LIMIT) || 6);
const BURST_WINDOW_MS = 60000;
const AUTH_TIMEOUT_MS = 6000;

const MAX_MESSAGES = 6;
const MAX_TOTAL_CHARS = 30000;   // tamanho máximo somado das mensagens
const MAX_OUTPUT_TOKENS = 6000;  // teto (os modelos 3.x "pensam" e isso conta no limite)
const REQUEST_TIMEOUT_MS = 22000;
const TIME_BUDGET_MS = 40000;    // não inicia nova tentativa depois disso

// Ficção tem violência e temas sombrios; o filtro padrão do Google bloqueia demais.
const SAFETY_SETTINGS = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT'
].map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

function fail(res, status, message, code) {
    return res.status(status).json({ error: { message, code: code || 'error' } });
}

// ---------- Autenticação (valida o token do Supabase) ----------
function getBearer(req) {
    const h = req.headers.authorization || req.headers.Authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1].trim() : '';
}

async function verifyUser(token) {
    try {
        const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
            signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
        });
        if (!r.ok) return null;
        const u = await r.json();
        return u && u.id ? u : null;
    } catch (_) {
        return null;
    }
}

// ---------- Limites de uso por usuário ----------
// Rajada (por minuto): em memória, por instância — barra cliques repetidos/scripts simples.
const burstHits = new Map();   // userId -> [timestamps]
function burstExceeded(userId) {
    const now = Date.now();
    const arr = (burstHits.get(userId) || []).filter(t => now - t < BURST_WINDOW_MS);
    if (arr.length >= BURST_LIMIT) { burstHits.set(userId, arr); return true; }
    arr.push(now);
    burstHits.set(userId, arr);
    if (burstHits.size > 5000) {            // evita crescer sem fim
        for (const [k, v] of burstHits) if (!v.some(t => now - t < BURST_WINDOW_MS)) burstHits.delete(k);
    }
    return false;
}

// Diário: durável no Supabase (função sm_ai_hit). Se ainda não foi criada, cai para memória.
const dailyMem = new Map();    // "userId|YYYY-MM-DD" -> contagem (por instância)
let warnedNoRpc = false;
async function dailyExceeded(userId, token) {
    try {
        const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/sm_ai_hit', {
            method: 'POST',
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ max_per_day: DAILY_LIMIT }),
            signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
        });
        if (r.ok) return (await r.json()) === false;
    } catch (_) { /* cai para memória */ }
    if (!warnedNoRpc) {
        warnedNoRpc = true;
        console.warn('[magic-write] sm_ai_hit indisponível — usando limite diário em memória. Rode supabase-ai-usage.sql no Supabase.');
    }
    const key = userId + '|' + new Date().toISOString().slice(0, 10);
    const n = (dailyMem.get(key) || 0) + 1;
    dailyMem.set(key, n);
    if (dailyMem.size > 5000) dailyMem.clear();
    return n > DAILY_LIMIT;
}

function getModels() {
    const env = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || '')
        .split(',').map(s => s.trim()).filter(m => /^[a-z0-9][a-z0-9.\-_]*$/i.test(m));
    return env.length ? env : DEFAULT_MODELS;
}

async function callGemini(model, payload, apiKey) {
    const upstream = await fetch(GEMINI_BASE + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const text = await upstream.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = null; }
    return { ok: upstream.ok, status: upstream.status, data };
}

// Converte a resposta do Gemini para o formato que o front-end espera
function toClientShape(data, model) {
    const cand = data && data.candidates && data.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const content = parts.filter(p => p && typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();

    const blocked = !!(data && data.promptFeedback && data.promptFeedback.blockReason) ||
        (cand && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(cand.finishReason));

    let finish = 'stop';
    if (blocked) finish = 'content_filter';
    else if (cand && cand.finishReason === 'MAX_TOKENS') finish = 'length';

    return { model, choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return fail(res, 405, 'Método não permitido.');
    }

    // Barreira simples: só aceita chamadas vindas do próprio site
    const origin = req.headers.origin;
    if (origin) {
        let originHost = '';
        try { originHost = new URL(origin).host; } catch (_) { /* ignora */ }
        if (originHost !== req.headers.host) return fail(res, 403, 'Origem não permitida.');
    }

    // Só usuários logados: o front-end manda o token da sessão do Supabase
    const token = getBearer(req);
    if (!token) return fail(res, 401, 'Entre na sua conta para usar a IA.', 'auth');
    const user = await verifyUser(token);
    if (!user) return fail(res, 401, 'Sua sessão expirou. Entre novamente para usar a IA.', 'auth');

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error('[magic-write] GEMINI_API_KEY não configurada (Vercel → Settings → Environment Variables).');
        return fail(res, 500, 'A IA não está configurada no servidor (GEMINI_API_KEY).', 'config');
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = null; }
    }
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
        return fail(res, 400, 'Requisição inválida: "messages" ausente ou grande demais.');
    }

    // OpenAI-style → Gemini
    const systemParts = [];
    const contents = [];
    let total = 0;
    for (const m of body.messages) {
        if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
            return fail(res, 400, 'Requisição inválida: formato de mensagem incorreto.');
        }
        total += m.content.length;
        if (m.role === 'system') systemParts.push({ text: m.content });
        else contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
    if (total > MAX_TOTAL_CHARS) return fail(res, 413, 'Contexto grande demais. Reduza as notas do nó.');
    if (contents.length === 0) return fail(res, 400, 'Requisição inválida: nenhuma mensagem do usuário.');

    // Limites por usuário (só depois de validar o pedido, para erros de formato não gastarem a cota)
    if (burstExceeded(user.id)) {
        return fail(res, 429, 'Muitas gerações em sequência. Aguarde um minuto e tente de novo.', 'rate_limit');
    }
    if (await dailyExceeded(user.id, token)) {
        return fail(res, 429, 'Você atingiu o limite diário de gerações com IA. Volte amanhã.', 'rate_limit');
    }

    const requested = Number(body.max_tokens);
    const maxOutputTokens = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 4096, MAX_OUTPUT_TOKENS);
    const temperature = Math.min(Math.max(Number(body.temperature) || 0.7, 0), 1.5);

    const basePayload = {
        contents,
        generationConfig: { temperature, maxOutputTokens },
        safetySettings: SAFETY_SETTINGS
    };
    if (systemParts.length) basePayload.systemInstruction = { parts: systemParts };

    // 1ª tentativa pede raciocínio curto (mais rápido); se o modelo não aceitar, repete sem isso
    const withThinking = Object.assign({}, basePayload, {
        generationConfig: Object.assign({}, basePayload.generationConfig, { thinkingConfig: { thinkingLevel: 'low' } })
    });

    const started = Date.now();
    let last = null;

    for (const model of getModels()) {
        if (last && Date.now() - started > TIME_BUDGET_MS) break;
        try {
            let r = await callGemini(model, withThinking, apiKey);
            if (r.status === 400) r = await callGemini(model, basePayload, apiKey);

            if (r.ok) return res.status(200).json(toClientShape(r.data, model));

            const msg = r.data && r.data.error && r.data.error.message ? r.data.error.message : 'Erro ' + r.status + ' na API de IA.';
            last = { status: r.status, msg: msg + ' [' + model + ']' };

            // Chave inválida/sem permissão ou pedido inválido: outro modelo não resolve
            if (r.status === 400 || r.status === 401 || r.status === 403) break;
            // 404 (modelo não existe mais), 429 (cota), 5xx: tenta o próximo modelo da lista
        } catch (err) {
            const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
            last = { status: timeout ? 504 : 502, msg: (timeout ? 'A IA demorou demais para responder' : 'Falha ao contatar a API de IA') + ' [' + model + ']' };
        }
    }

    const st = (last && last.status) || 502;
    if (st === 401 || st === 403) {
        console.error('[magic-write] Google recusou a chave:', last && last.msg);
        return fail(res, 502, 'O servidor de IA recusou a chave do Google. Avise o administrador do site.', 'upstream_auth');
    }
    return fail(res, st, (last && last.msg) || 'Falha ao contatar a API de IA.', 'upstream');
};
