/* ============================================================
   StoryMind — proxy de IA (Vercel Serverless Function) · Google Gemini
   Caminho no projeto:  api/magic-write.js   →  POST /api/magic-write

   A chave NUNCA vai para o navegador. Configure na Vercel:
     Project → Settings → Environment Variables
       GEMINI_API_KEY   (obrigatória — gere em aistudio.google.com/apikey)
       GEMINI_MODELS    (opcional — lista separada por vírgula, em ordem de preferência)
   Depois de criar/alterar variáveis, faça um novo deploy.

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

function fail(res, status, message) {
    return res.status(status).json({ error: { message } });
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

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        return fail(res, 500, 'GEMINI_API_KEY não está configurada no servidor (Vercel → Settings → Environment Variables).');
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

    return fail(res, (last && last.status) || 502, (last && last.msg) || 'Falha ao contatar a API de IA.');
};
