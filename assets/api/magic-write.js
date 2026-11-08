/* ============================================================
   StoryMind — proxy de IA (Vercel Serverless Function)
   Caminho no projeto:  api/magic-write.js   →  POST /api/magic-write

   A chave NUNCA vai para o navegador. Configure na Vercel:
     Project → Settings → Environment Variables → GROQ_API_KEY
   (depois faça um novo deploy para a variável valer).
   ============================================================ */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Só estes modelos podem ser pedidos pelo navegador
const ALLOWED_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

const MAX_MESSAGES = 6;
const MAX_TOTAL_CHARS = 30000;   // tamanho máximo somado das mensagens
const MAX_OUTPUT_TOKENS = 3000;  // teto, mesmo que o cliente peça mais

function fail(res, status, message) {
    return res.status(status).json({ error: { message } });
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

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        return fail(res, 500, 'GROQ_API_KEY não está configurada no servidor (Vercel → Settings → Environment Variables).');
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = null; }
    }
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
        return fail(res, 400, 'Requisição inválida: "messages" ausente ou grande demais.');
    }

    const messages = [];
    let total = 0;
    for (const m of body.messages) {
        if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
            return fail(res, 400, 'Requisição inválida: formato de mensagem incorreto.');
        }
        total += m.content.length;
        messages.push({ role: m.role, content: m.content });
    }
    if (total > MAX_TOTAL_CHARS) return fail(res, 413, 'Contexto grande demais. Reduza as notas do nó.');

    const model = ALLOWED_MODELS.includes(body.model) ? body.model : DEFAULT_MODEL;
    const requested = Number(body.max_tokens);
    const maxTokens = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 2048, MAX_OUTPUT_TOKENS);
    const temperature = Math.min(Math.max(Number(body.temperature) || 0.7, 0), 1.2);

    try {
        const upstream = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model,
                messages,
                temperature,
                max_completion_tokens: maxTokens,
                reasoning_effort: 'low'   // modelos gpt-oss "pensam" antes de responder; "low" é mais rápido
            })
        });

        const text = await upstream.text();
        let data;
        try { data = JSON.parse(text); } catch (_) { data = null; }

        if (!upstream.ok) {
            const msg = data && data.error && data.error.message ? data.error.message : 'Erro ' + upstream.status + ' na API de IA.';
            return fail(res, upstream.status, msg);
        }
        return res.status(200).json(data);
    } catch (err) {
        return fail(res, 502, 'Falha ao contatar a API de IA: ' + (err && err.message ? err.message : 'erro desconhecido'));
    }
};
