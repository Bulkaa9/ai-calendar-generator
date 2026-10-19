import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreatePrompt, buildEditPrompt, describeContextEvents, MAX_CONTEXT_EVENTS } from '../src/prompt.js';

test('create prompt has the local date, time and next days', () => {
    // Late on Oct 28 in UTC is already Oct 29 in Tokyo
    const prompt = buildCreatePrompt(new Date('2026-10-28T23:30:00Z'), 'Asia/Tokyo');
    assert.match(prompt, /Now: Thu 2026-10-29 08:30 \(Asia\/Tokyo\)\. Next days: Fri 30, Sat 31, Sun 1 Nov, Mon 2, Tue 3, Wed 4, Thu 5\./);
    assert.match(prompt, /\{"events":\[/);
});

test('create prompt stays small', () => {
    // Rough guard: about 4 characters per token
    assert.ok(buildCreatePrompt(new Date(), 'Europe/Paris').length < 1800);
});

test('describeContextEvents summarizes events on one line each', () => {
    const lines = describeContextEvents([
        { title: 'Gym', allDay: false, start: '2026-10-19T19:00', end: '2026-10-19T20:00', timeZone: 'Europe/Paris', recurrence: { frequency: 'WEEKLY', byDay: ['MO', 'WE'], until: '2026-11-30' } },
        { title: 'Trip', allDay: true, startDate: '2027-08-01', endDate: '2027-08-15' },
        { title: '  Late\nshow ', allDay: false, start: '2026-10-22T22:00', end: '2026-10-23T00:30', timeZone: 'Asia/Tokyo', recurrence: { frequency: 'MONTHLY', byDay: ['-1FR'], count: 3 } }
    ], 'Europe/Paris');
    assert.deepEqual(lines, [
        '1. Gym | 2026-10-19 19:00-20:00 | weekly MO,WE until 2026-11-30',
        '2. Trip | 2027-08-01 to 2027-08-15 all day',
        '3. Late show | 2026-10-22 22:00 to 2026-10-23 00:30 Asia/Tokyo | monthly -1FR x3'
    ]);
    const prompt = buildEditPrompt(new Date('2026-10-19T12:00:00Z'), 'Europe/Paris', lines);
    assert.ok(prompt.includes(lines.join('\n')));
    assert.match(prompt, /\{"changes":\[\]\}/);
});

test('describeContextEvents rejects unusable lists', () => {
    assert.equal(describeContextEvents([], 'UTC'), null);
    assert.equal(describeContextEvents('x', 'UTC'), null);
    assert.equal(describeContextEvents([{ title: 'x', start: 'soon', end: 'later' }], 'UTC'), null);
    const tooMany = Array.from({ length: MAX_CONTEXT_EVENTS + 1 }, () => ({ title: 'x', allDay: true, startDate: '2026-10-19' }));
    assert.equal(describeContextEvents(tooMany, 'UTC'), null);
});
