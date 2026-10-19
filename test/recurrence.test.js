import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_COUNT, expandEvent, firstOccurrenceDate, normalizeRecurrence, occurrenceDates, occurrenceOn, parseByDay
} from '../src/recurrence.js';
import { getWallTime, toIsoDate, wallTimeToDate } from '../src/time.js';

const isoDates = (dates) => dates.map(toIsoDate);
const datesFor = (raw, start) => isoDates(occurrenceDates(normalizeRecurrence(raw), start));

test('normalizeRecurrence cleans rules and defaults to 4 occurrences', () => {
    assert.deepEqual(normalizeRecurrence({ frequency: 'weekly', byDay: ['we', 'MO', 'xx', 'MO', '1TU'] }),
        { frequency: 'WEEKLY', interval: 1, byDay: ['MO', 'WE'], count: DEFAULT_COUNT });
    assert.deepEqual(normalizeRecurrence({ frequency: 'DAILY', interval: 2, until: '2027-01-10', count: 3 }),
        { frequency: 'DAILY', interval: 2, until: '2027-01-10' });
    assert.deepEqual(normalizeRecurrence({ frequency: 'MONTHLY', byDay: ['MO'], count: 0 }),
        { frequency: 'MONTHLY', interval: 1, count: DEFAULT_COUNT });
    assert.deepEqual(normalizeRecurrence({ frequency: 'MONTHLY', byDay: ['-1FR', '1MO', '3MO'], count: 2 }),
        { frequency: 'MONTHLY', interval: 1, byDay: ['1MO', '3MO', '-1FR'], count: 2 });
    assert.deepEqual(normalizeRecurrence({ frequency: 'MONTHLY', byMonthDay: [15, 1, -1, 0, 40], byDay: ['1MO'], count: 2 }),
        { frequency: 'MONTHLY', interval: 1, byMonthDay: [-1, 1, 15], count: 2 });
    assert.equal(normalizeRecurrence({ frequency: 'HOURLY' }), null);
    assert.equal(normalizeRecurrence(null), null);
});

test('parseByDay', () => {
    assert.deepEqual(parseByDay('mo'), { ordinal: 0, day: 'MO' });
    assert.deepEqual(parseByDay('-1FR'), { ordinal: -1, day: 'FR' });
    assert.deepEqual(parseByDay('+2TU'), { ordinal: 2, day: 'TU' });
    assert.equal(parseByDay('6MO'), null);
    assert.equal(parseByDay('Monday'), null);
});

test('weekly rule on several days, with an inclusive until date', () => {
    assert.deepEqual(datesFor({ frequency: 'WEEKLY', byDay: ['MO', 'WE'], until: '2026-11-02' }, { year: 2026, month: 10, day: 19 }),
        ['2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28', '2026-11-02']);
});

test('every weekday', () => {
    // Starts on a Friday
    assert.deepEqual(datesFor({ frequency: 'WEEKLY', byDay: ['MO', 'TU', 'WE', 'TH', 'FR'], count: 4 }, { year: 2026, month: 10, day: 23 }),
        ['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28']);
});

test('every other week', () => {
    assert.deepEqual(datesFor({ frequency: 'WEEKLY', interval: 2, count: 3 }, { year: 2026, month: 10, day: 22 }),
        ['2026-10-22', '2026-11-05', '2026-11-19']);
});

test('"from January to March" covers all of March', () => {
    const dates = datesFor({ frequency: 'WEEKLY', byDay: ['TU'], until: '2027-03-31' }, { year: 2027, month: 1, day: 5 });
    assert.equal(dates[0], '2027-01-05');
    assert.equal(dates.at(-1), '2027-03-30');
    assert.equal(dates.length, 13);
});

test('monthly on the 31st skips shorter months', () => {
    assert.deepEqual(datesFor({ frequency: 'MONTHLY', count: 4 }, { year: 2027, month: 1, day: 31 }),
        ['2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31']);
});

test('monthly on the last Friday and on the first and third Monday', () => {
    assert.deepEqual(datesFor({ frequency: 'MONTHLY', byDay: ['-1FR'], count: 3 }, { year: 2026, month: 10, day: 19 }),
        ['2026-10-30', '2026-11-27', '2026-12-25']);
    assert.deepEqual(datesFor({ frequency: 'MONTHLY', byDay: ['1MO', '3MO'], count: 4 }, { year: 2026, month: 10, day: 19 }),
        ['2026-10-19', '2026-11-02', '2026-11-16', '2026-12-07']);
});

test('fifth weekday skips months that do not have one', () => {
    assert.deepEqual(datesFor({ frequency: 'MONTHLY', byDay: ['5FR'], count: 2 }, { year: 2026, month: 10, day: 1 }),
        ['2026-10-30', '2027-01-29']);
});

test('monthly on days of the month, including the last day', () => {
    assert.deepEqual(datesFor({ frequency: 'MONTHLY', byMonthDay: [1, 15], count: 4 }, { year: 2026, month: 10, day: 19 }),
        ['2026-11-01', '2026-11-15', '2026-12-01', '2026-12-15']);
    assert.deepEqual(datesFor({ frequency: 'MONTHLY', byMonthDay: [-1], count: 3 }, { year: 2027, month: 1, day: 5 }),
        ['2027-01-31', '2027-02-28', '2027-03-31']);
});

test('yearly on the fourth Thursday of the start month', () => {
    assert.deepEqual(datesFor({ frequency: 'YEARLY', byDay: ['4TH'], count: 3 }, { year: 2026, month: 11, day: 1 }),
        ['2026-11-26', '2027-11-25', '2028-11-23']);
});

test('yearly on Feb 29 only lands on leap years', () => {
    assert.deepEqual(datesFor({ frequency: 'YEARLY', count: 2 }, { year: 2028, month: 2, day: 29 }), ['2028-02-29', '2032-02-29']);
});

test('firstOccurrenceDate moves to the first matching day', () => {
    const rule = normalizeRecurrence({ frequency: 'WEEKLY', byDay: ['MO'] });
    // 2026-10-18 is a Sunday
    assert.equal(toIsoDate(firstOccurrenceDate(rule, { year: 2026, month: 10, day: 18 })), '2026-10-19');
    const ended = normalizeRecurrence({ frequency: 'WEEKLY', byDay: ['MO'], until: '2026-10-18' });
    assert.equal(firstOccurrenceDate(ended, { year: 2026, month: 10, day: 18 }), null);
});

function weeklyParisEvent(overrides = {}) {
    const timeZone = 'Europe/Paris';
    const start = wallTimeToDate({ year: 2026, month: 10, day: 19, hour: 19, minute: 0 }, timeZone);
    return {
        title: 'Gym',
        location: '',
        description: '',
        reminders: [30],
        allDay: false,
        start,
        end: new Date(start.getTime() + 90 * 60 * 1000),
        timeZone,
        recurrence: normalizeRecurrence({ frequency: 'WEEKLY', count: 3 }),
        exdates: [],
        overrides: {},
        ...overrides
    };
}

test('expandEvent keeps local time across a DST change and skips exdates', () => {
    const occurrences = expandEvent(weeklyParisEvent({ exdates: ['2026-11-02'] }));
    assert.equal(occurrences.length, 2);
    // Clocks go back on 2026-10-25; the second occurrence is still 19:00 local, one hour later in UTC
    assert.equal(occurrences[0].start.toISOString(), '2026-10-19T17:00:00.000Z');
    assert.equal(occurrences[1].start.toISOString(), '2026-10-26T18:00:00.000Z');
    assert.equal(occurrences[1].date, '2026-10-26');
    assert.equal(getWallTime(occurrences[1].end, 'Europe/Paris').hour, 20);
    assert.deepEqual(occurrences[1].reminders, [30]);
});

test('expandEvent applies overrides to single occurrences', () => {
    const moved = new Date('2026-10-27T18:00:00Z');
    const event = weeklyParisEvent({ overrides: { '2026-10-26': { title: 'Gym (moved)', start: moved } } });
    const [, second] = expandEvent(event);
    assert.equal(second.date, '2026-10-26');
    assert.equal(second.title, 'Gym (moved)');
    assert.equal(second.isOverride, true);
    assert.equal(second.start.toISOString(), '2026-10-27T18:00:00.000Z');
    // Keeps the series length
    assert.equal(second.end.toISOString(), '2026-10-27T19:30:00.000Z');
    assert.equal(occurrenceOn(event, '2026-10-26', { applyOverride: false }).title, 'Gym');
    assert.equal(occurrenceOn(event, '2026-10-20'), null);
});

test('expandEvent returns the event itself when it does not repeat', () => {
    const event = { title: 'x', allDay: false, start: new Date('2026-10-19T10:00:00Z'), end: new Date('2026-10-19T11:00:00Z'), timeZone: 'UTC', recurrence: null };
    const [occurrence] = expandEvent(event);
    assert.equal(occurrence.start.getTime(), event.start.getTime());
    assert.equal(occurrence.end.getTime(), event.end.getTime());
    assert.equal(occurrence.date, '2026-10-19');
});

test('all-day events expand by date, keeping their length', () => {
    const event = {
        title: 'Market', allDay: true, startDate: '2026-10-24', endDate: '2026-10-25', timeZone: 'Europe/Paris',
        recurrence: normalizeRecurrence({ frequency: 'WEEKLY', count: 2 }), exdates: [], overrides: {}
    };
    assert.deepEqual(expandEvent(event).map(o => [o.startDate, o.endDate, o.start]),
        [['2026-10-24', '2026-10-25', null], ['2026-10-31', '2026-11-01', null]]);
});
