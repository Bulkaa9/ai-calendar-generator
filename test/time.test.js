import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addDays, addMonths, dayKeyOf, dayOfWeek, diffDays, getWallTime, isValidTimeZone,
    parseIsoDate, parseWallTime, wallTimeToDate
} from '../src/time.js';

test('wallTimeToDate converts a wall time to the right instant', () => {
    const date = wallTimeToDate({ year: 2026, month: 7, day: 1, hour: 9, minute: 30 }, 'Europe/Paris');
    assert.equal(date.toISOString(), '2026-07-01T07:30:00.000Z');
    assert.deepEqual(getWallTime(date, 'Europe/Paris'), { year: 2026, month: 7, day: 1, hour: 9, minute: 30, second: 0 });
});

test('wallTimeToDate moves times skipped by DST forward', () => {
    // Clocks jump from 02:00 to 03:00 in New York on 2026-03-08
    const date = wallTimeToDate({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
    assert.equal(date.toISOString(), '2026-03-08T07:30:00.000Z');
});

test('wallTimeToDate picks the earlier instant for repeated times', () => {
    // 01:30 happens twice in London on 2026-10-25 (BST then GMT)
    const date = wallTimeToDate({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, 'Europe/London');
    assert.equal(date.toISOString(), '2026-10-25T00:30:00.000Z');
});

test('dayKeyOf uses the given time zone', () => {
    const date = new Date('2026-10-19T23:30:00Z');
    assert.equal(dayKeyOf(date, 'UTC'), 20261019);
    assert.equal(dayKeyOf(date, 'Europe/Paris'), 20261020);
    assert.equal(dayKeyOf(date, 'America/Los_Angeles'), 20261019);
});

test('addMonths clamps to the end of shorter months', () => {
    assert.deepEqual(addMonths({ year: 2027, month: 1, day: 31 }, 1), { year: 2027, month: 2, day: 28 });
    assert.deepEqual(addMonths({ year: 2026, month: 12, day: 15 }, 1), { year: 2027, month: 1, day: 15 });
    assert.deepEqual(addMonths({ year: 2026, month: 1, day: 15 }, -1), { year: 2025, month: 12, day: 15 });
    assert.deepEqual(addMonths({ year: 2028, month: 2, day: 29 }, 12), { year: 2029, month: 2, day: 28 });
});

test('plain date arithmetic', () => {
    assert.deepEqual(addDays({ year: 2026, month: 12, day: 31 }, 1), { year: 2027, month: 1, day: 1 });
    assert.equal(diffDays({ year: 2026, month: 10, day: 19 }, { year: 2026, month: 11, day: 2 }), 14);
    assert.equal(dayOfWeek({ year: 2026, month: 10, day: 19 }), 1);
});

test('parsers reject malformed and impossible values', () => {
    assert.deepEqual(parseWallTime('2026-10-19T14:05'), { year: 2026, month: 10, day: 19, hour: 14, minute: 5, second: 0 });
    assert.equal(parseWallTime('2026-02-30T10:00'), null);
    assert.equal(parseWallTime('2026-10-19T24:00'), null);
    assert.equal(parseWallTime('2026-10-19T10:00Z'), null);
    assert.equal(parseWallTime(undefined), null);
    assert.deepEqual(parseIsoDate('2028-02-29'), { year: 2028, month: 2, day: 29 });
    assert.equal(parseIsoDate('2027-02-29'), null);
});

test('isValidTimeZone', () => {
    assert.equal(isValidTimeZone('Asia/Tokyo'), true);
    assert.equal(isValidTimeZone('Mars/Olympus'), false);
    assert.equal(isValidTimeZone(''), false);
    assert.equal(isValidTimeZone(null), false);
});
