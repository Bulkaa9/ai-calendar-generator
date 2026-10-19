import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { MAX_INPUT_LENGTH, RATE_LIMIT } from '../api/parse-event.js';

const realFetch = globalThis.fetch;
const realWarn = console.warn;
let ipCounter = 0;

function makeReq(body, { method = 'POST', ip } = {}) {
    ipCounter += 1;
    return { method, body, headers: { 'x-forwarded-for': ip ?? `10.0.0.${ipCounter}` } };
}

function makeRes() {
    return {
        statusCode: null,
        headers: {},
        body: null,
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

// Makes fetch answer like the OpenAI API, recording the requests it receives
function mockOpenAI(content, { status = 200 } = {}) {
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
    };
    return calls;
}

beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    console.warn = () => {};
});

afterEach(() => {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
});

test('rejects other methods', async () => {
    const res = makeRes();
    await handler(makeReq({}, { method: 'GET' }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'POST');
});

test('rejects empty and oversized input without calling OpenAI', async () => {
    const calls = mockOpenAI('{}');
    for (const input of [undefined, '   ', 'x'.repeat(MAX_INPUT_LENGTH + 1)]) {
        const res = makeRes();
        await handler(makeReq({ input }), res);
        assert.equal(res.statusCode, 400);
    }
    assert.equal(calls.length, 0);
});

test('returns validated events and sends user text as its own message', async () => {
    const calls = mockOpenAI(JSON.stringify({
        events: [{ title: 'Standup', date: '2026-10-20', time: '09:00', duration: 15, remind: [5] }]
    }));
    const res = makeRes();
    await handler(makeReq({ input: 'Standup tomorrow at 9 for 15 minutes', timeZone: 'America/New_York' }), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.events, [{
        title: 'Standup',
        allDay: false,
        start: '2026-10-20T13:00:00.000Z',
        end: '2026-10-20T13:15:00.000Z',
        timeZone: 'America/New_York',
        location: '',
        description: '',
        reminders: [5],
        recurrence: null
    }]);

    const request = calls[0].body;
    assert.equal(request.model, 'gpt-3.5-turbo');
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.equal(request.messages[0].role, 'system');
    assert.doesNotMatch(request.messages[0].content, /Standup/);
    assert.deepEqual(request.messages[1], { role: 'user', content: 'Standup tomorrow at 9 for 15 minutes' });
});

test('an event without a date or time starts at the closest half hour to the request', async () => {
    mockOpenAI(JSON.stringify({ events: [{ title: 'Call mom' }] }));
    const requestTime = Date.now();
    const res = makeRes();
    await handler(makeReq({ input: 'call mom', timeZone: 'UTC' }), res);
    const start = new Date(res.body.events[0].start).getTime();
    assert.equal(start % (30 * 60 * 1000), 0);
    assert.ok(Math.abs(start - requestTime) <= 15 * 60 * 1000);
    assert.equal(new Date(res.body.events[0].end).getTime() - start, 60 * 60 * 1000);
});

test('an event with a date but no time is all-day', async () => {
    mockOpenAI(JSON.stringify({ events: [{ title: 'Dentist', date: '2026-10-23' }] }));
    const res = makeRes();
    await handler(makeReq({ input: 'dentist on friday', timeZone: 'UTC' }), res);
    assert.deepEqual([res.body.events[0].allDay, res.body.events[0].startDate], [true, '2026-10-23']);
});

test('edit mode sends the events and returns validated changes', async () => {
    const calls = mockOpenAI(JSON.stringify({
        changes: [{ op: 'update', event: 1, set: { time: '20:00' } }, { op: 'delete', event: 7 }]
    }));
    const res = makeRes();
    await handler(makeReq({
        input: 'move the gym to 8pm',
        timeZone: 'Europe/Paris',
        mode: 'edit',
        events: [{ title: 'Gym', allDay: false, start: '2026-10-19T19:00', end: '2026-10-19T20:00', timeZone: 'Europe/Paris' }]
    }), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.changes, [{ op: 'update', ref: 1, on: null, set: { time: '20:00' } }]);
    assert.match(calls[0].body.messages[0].content, /1\. Gym \| 2026-10-19 19:00-20:00/);
});

test('edit mode needs events', async () => {
    const calls = mockOpenAI('{}');
    const res = makeRes();
    await handler(makeReq({ input: 'move the gym', mode: 'edit', events: [] }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
});

test('edit mode returns 422 when nothing matches', async () => {
    mockOpenAI('{"changes":[]}');
    const res = makeRes();
    await handler(makeReq({ input: 'move the dentist', mode: 'edit', events: [{ title: 'Gym', allDay: true, startDate: '2026-10-19' }] }), res);
    assert.equal(res.statusCode, 422);
});

test('returns 422 when the model finds no usable event', async () => {
    mockOpenAI('not json');
    const res = makeRes();
    await handler(makeReq({ input: 'hello' }), res);
    assert.equal(res.statusCode, 422);
});

test('returns 502 without leaking details when OpenAI fails', async () => {
    mockOpenAI('{"error":"secret details"}', { status: 500 });
    const res = makeRes();
    const originalError = console.error;
    console.error = () => {};
    try {
        await handler(makeReq({ input: 'Lunch tomorrow' }), res);
    } finally {
        console.error = originalError;
    }
    assert.equal(res.statusCode, 502);
    assert.doesNotMatch(JSON.stringify(res.body), /secret/);
});

test('rate limits repeated requests from one IP', async () => {
    mockOpenAI(JSON.stringify({ events: [{ title: 'x', date: '2026-10-20' }] }));
    const statuses = [];
    for (let i = 0; i < RATE_LIMIT.max + 1; i++) {
        const res = makeRes();
        await handler(makeReq({ input: 'Lunch' }, { ip: '192.168.1.1' }), res);
        statuses.push(res.statusCode);
    }
    assert.equal(statuses.filter(s => s === 200).length, RATE_LIMIT.max);
    assert.equal(statuses.at(-1), 429);
});
