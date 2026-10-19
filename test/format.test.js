import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRecurrence, escapeHtml, formatHourLabel, formatTime, formatWhen } from '../src/format.js';

test('escapeHtml escapes quotes so values are safe in attributes', () => {
    assert.equal(escapeHtml(`<b>"Tom" & 'Jerry'</b>`), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
    assert.equal(escapeHtml(null), '');
});

test('formatTime uses the given time zone', () => {
    const date = new Date('2026-10-19T13:05:00Z');
    assert.equal(formatTime(date, 'Europe/Paris', false), '3:05 PM');
    assert.equal(formatTime(date, 'Europe/Paris', true), '15:05');
    assert.equal(formatTime(new Date('2026-10-19T00:00:00Z'), 'UTC', false), '12:00 AM');
});

test('formatHourLabel', () => {
    assert.equal(formatHourLabel(0, false), '12 AM');
    assert.equal(formatHourLabel(13, false), '1 PM');
    assert.equal(formatHourLabel(7, true), '07:00');
});

test('formatWhen for timed, overnight and all-day occurrences', () => {
    const timed = { allDay: false, start: new Date('2026-10-19T17:00:00Z'), end: new Date('2026-10-19T18:00:00Z') };
    assert.equal(formatWhen(timed, 'Europe/Paris', false), 'Mon, Oct 19, 2026 • 7:00 PM - 8:00 PM');
    const midnight = { allDay: false, start: new Date('2026-10-19T20:00:00Z'), end: new Date('2026-10-19T22:00:00Z') };
    assert.equal(formatWhen(midnight, 'Europe/Paris', true), 'Mon, Oct 19, 2026 • 22:00 - 00:00');
    const overnight = { allDay: false, start: new Date('2026-10-19T20:00:00Z'), end: new Date('2026-10-20T00:00:00Z') };
    assert.equal(formatWhen(overnight, 'Europe/Paris', true), 'Mon, Oct 19, 2026 22:00 → Tue, Oct 20, 2026 02:00');
    assert.equal(formatWhen({ allDay: true, startDate: '2026-12-24', endDate: '2026-12-24' }), 'Thu, Dec 24, 2026 • All day');
    assert.equal(formatWhen({ allDay: true, startDate: '2027-08-01', endDate: '2027-08-15' }), 'Sun, Aug 1, 2027 → Sun, Aug 15, 2027 • All day');
});

test('describeRecurrence', () => {
    assert.equal(describeRecurrence({ frequency: 'WEEKLY', interval: 1, byDay: ['MO', 'WE'], until: '2027-03-31' }),
        'Weekly on Mon, Wed, until Mar 31, 2027');
    assert.equal(describeRecurrence({ frequency: 'DAILY', interval: 2, count: 10 }), 'Every 2 days, 10 times');
    assert.equal(describeRecurrence({ frequency: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'], count: 5 }),
        'Every weekday, 5 times');
    assert.equal(describeRecurrence({ frequency: 'MONTHLY', interval: 1, byDay: ['-1FR'], count: 6 }),
        'Monthly on the last Friday, 6 times');
    assert.equal(describeRecurrence({ frequency: 'MONTHLY', interval: 1, byDay: ['1MO', '3MO'], count: 6 }),
        'Monthly on the first Monday and third Monday, 6 times');
    assert.equal(describeRecurrence({ frequency: 'MONTHLY', interval: 1, byMonthDay: [1, 15, -1], count: 1 }),
        'Monthly on the 1st, 15th and last day, 1 time');
    assert.equal(describeRecurrence({ frequency: 'YEARLY', interval: 1, byDay: ['4TH'], count: 3 }, { startMonth: 11 }),
        'Yearly on the fourth Thursday of November, 3 times');
});
