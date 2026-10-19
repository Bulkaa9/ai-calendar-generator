import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChanges } from '../src/change-schema.js';

test('keeps valid changes and maps short keys', () => {
    const changes = normalizeChanges({
        changes: [
            { op: 'update', event: 1, set: { time: '20:00', loc: 'New gym', remind: [15], tz: 'Asia/Tokyo' } },
            { op: 'DELETE', event: 2, on: '2026-10-21' },
            { op: 'update', event: 1, on: '2026-10-26', set: { date: '2026-10-27', notes: '' } }
        ]
    }, 2);
    assert.deepEqual(changes, [
        { op: 'update', ref: 1, on: null, set: { time: '20:00', location: 'New gym', reminders: [15], timeZone: 'Asia/Tokyo' } },
        { op: 'delete', ref: 2, on: '2026-10-21' },
        { op: 'update', ref: 1, on: '2026-10-26', set: { date: '2026-10-27', description: '' } }
    ]);
});

test('drops changes with bad references, ops or empty updates', () => {
    assert.deepEqual(normalizeChanges({
        changes: [
            { op: 'update', event: 3, set: { title: 'x' } },
            { op: 'update', event: 0, set: { title: 'x' } },
            { op: 'rename', event: 1 },
            { op: 'update', event: 1, set: { time: '25:00', date: 'friday', tz: 'Mars' } },
            { op: 'update', event: 1 },
            null
        ]
    }, 2), []);
    assert.deepEqual(normalizeChanges(null, 2), []);
});

test('repeat: a rule, or null to stop repeating', () => {
    const [weekly, stop, invalid] = normalizeChanges({
        changes: [
            { op: 'update', event: 1, set: { repeat: { freq: 'WEEKLY', days: ['TU'], until: '2026-12-31' } } },
            { op: 'update', event: 1, set: { repeat: null } },
            { op: 'update', event: 1, set: { repeat: { freq: 'HOURLY' }, title: 'Gym' } }
        ]
    }, 1);
    assert.deepEqual(weekly.set.recurrence, { frequency: 'WEEKLY', interval: 1, byDay: ['TU'], until: '2026-12-31' });
    assert.equal(stop.set.recurrence, null);
    assert.ok('recurrence' in stop.set);
    assert.deepEqual(invalid.set, { title: 'Gym' });
});

test('an invalid "on" date targets the whole event', () => {
    const [change] = normalizeChanges({ changes: [{ op: 'delete', event: 1, on: 'next wednesday' }] }, 1);
    assert.equal(change.on, null);
});
