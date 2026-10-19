import { normalizeChanges } from '../src/change-schema.js';
import { normalizeEvents } from '../src/event-schema.js';
import { buildCreatePrompt, buildEditPrompt, describeContextEvents, MAX_CONTEXT_EVENTS } from '../src/prompt.js';
import { isValidTimeZone } from '../src/time.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
const OPENAI_TIMEOUT_MS = 20_000;
export const MAX_INPUT_LENGTH = 1000;

// Best effort only: counts live in this function instance's memory, so they
// reset on cold starts and are not shared between instances.
export const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 20 };
const requestCounts = new Map();

// POST { input, timeZone, mode: 'create' }                → { events }
// POST { input, timeZone, mode: 'edit', events: [...] }   → { changes }
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let body;
    try {
        body = req.body ?? {};
    } catch {
        return res.status(400).json({ error: 'Invalid JSON body.' });
    }

    const input = typeof body.input === 'string' ? body.input.trim() : '';
    if (!input) {
        return res.status(400).json({ error: 'Please describe an event.' });
    }
    if (input.length > MAX_INPUT_LENGTH) {
        return res.status(400).json({ error: `Please keep the description under ${MAX_INPUT_LENGTH} characters.` });
    }

    const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : 'UTC';
    const isEdit = body.mode === 'edit';
    let eventLines = null;
    if (isEdit) {
        eventLines = describeContextEvents(body.events, timeZone);
        if (!eventLines) {
            return res.status(400).json({ error: `Send between 1 and ${MAX_CONTEXT_EVENTS} valid events to change.` });
        }
    }

    if (!process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY is not set');
        return res.status(500).json({ error: 'The server is not configured.' });
    }
    if (isRateLimited(clientIp(req))) {
        return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
    }

    // Events without a time start at the moment the request was received
    const now = new Date();
    const systemPrompt = isEdit ? buildEditPrompt(now, timeZone, eventLines) : buildCreatePrompt(now, timeZone);

    let reply;
    try {
        reply = await requestCompletion(systemPrompt, input, isEdit ? 600 : 1000);
    } catch (err) {
        console.error('OpenAI request failed:', err);
        return res.status(502).json({ error: 'The AI service is unavailable right now. Please try again.' });
    }

    if (isEdit) {
        const changes = normalizeChanges(reply, eventLines.length);
        if (changes.length === 0) {
            return res.status(422).json({ error: "Sorry, I couldn't match that to any of your events. Please try rephrasing." });
        }
        return res.status(200).json({ changes });
    }

    const events = normalizeEvents(reply, { timeZone, now });
    if (events.length === 0) {
        return res.status(422).json({ error: "Sorry, I couldn't find an event in that. Please try rephrasing." });
    }
    return res.status(200).json({ events });
}

function clientIp(req) {
    const forwarded = req.headers?.['x-forwarded-for'];
    return (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) ||
        req.socket?.remoteAddress ||
        'unknown';
}

function isRateLimited(ip, now = Date.now()) {
    if (requestCounts.size > 10_000) {
        for (const [key, entry] of requestCounts) {
            if (now - entry.windowStart >= RATE_LIMIT.windowMs) requestCounts.delete(key);
        }
    }
    let entry = requestCounts.get(ip);
    if (!entry || now - entry.windowStart >= RATE_LIMIT.windowMs) {
        entry = { windowStart: now, count: 0 };
        requestCounts.set(ip, entry);
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT.max;
}

// Returns the parsed JSON reply, or null if the model did not return valid JSON
async function requestCompletion(systemPrompt, input, maxTokens) {
    const response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
        body: JSON.stringify({
            model: MODEL,
            temperature: 0,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                // Kept separate from the instructions so it is treated as data
                { role: 'user', content: input }
            ]
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI responded ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    try {
        return JSON.parse(content);
    } catch {
        console.warn('Model returned invalid JSON:', content);
        return null;
    }
}
