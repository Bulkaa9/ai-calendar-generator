import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../src/events.js';
import { generateICS } from '../src/ics.js';
import { normalizeRecurrence } from '../src/recurrence.js';

const now = new Date('2026-10-19T12:00:00Z');

function makeEvent(overrides = {}) {
    return createEvent({
        title: 'Team meeting',
        start: new Date('2026-10-19T13:00:00Z'),
        end: new Date('2026-10-19T14:00:00Z'),
        timeZone: 'Europe/Paris',
        ...overrides
    }, 'abc');
}

// Unfolds continuation lines and splits into an array
function unfold(ics) {
    return ics.replace(/\r\n /g, '').split('\r\n');
}

// Lines of the n-th VEVENT
function vevent(lines, n = 0) {
    const starts = lines.flatMap((line, i) => (line === 'BEGIN:VEVENT' ? [i] : []));
    return lines.slice(starts[n], lines.indexOf('END:VEVENT', starts[n]) + 1);
}

test('writes events in their time zone with a matching VTIMEZONE', () => {
    const lines = unfold(generateICS([makeEvent()], { now }));
    assert.ok(lines.includes('DTSTART;TZID=Europe/Paris:20261019T150000'));
    assert.ok(lines.includes('DTEND;TZID=Europe/Paris:20261019T160000'));
    assert.ok(lines.includes('DTSTAMP:20261019T120000Z'));
    assert.ok(lines.includes('TZID:Europe/Paris'));

    // 2026 transitions: summer time from 2026-03-29 02:00, winter time from 2026-10-25 03:00
    const ics = lines.join('\n');
    assert.match(ics, /BEGIN:DAYLIGHT\nDTSTART:20260329T020000\nTZOFFSETFROM:\+0100\nTZOFFSETTO:\+0200\nEND:DAYLIGHT/);
    assert.match(ics, /BEGIN:STANDARD\nDTSTART:20261025T030000\nTZOFFSETFROM:\+0200\nTZOFFSETTO:\+0100\nEND:STANDARD/);
});

test('UTC events use UTC times and no VTIMEZONE', () => {
    const ics = generateICS([makeEvent({ timeZone: 'UTC' })], { now });
    assert.match(ics, /DTSTART:20261019T130000Z\r\n/);
    assert.doesNotMatch(ics, /VTIMEZONE/);
});

test('all-day events use dates with an exclusive end, and no VTIMEZONE', () => {
    const trip = makeEvent({ allDay: true, start: null, end: null, startDate: '2027-08-01', endDate: '2027-08-15' });
    const lines = unfold(generateICS([trip], { now }));
    assert.ok(lines.includes('DTSTART;VALUE=DATE:20270801'));
    assert.ok(lines.includes('DTEND;VALUE=DATE:20270816'));
    assert.ok(!lines.some(line => line.startsWith('BEGIN:VTIMEZONE')));
});

test('all-day recurring events use date UNTIL and EXDATE values', () => {
    const event = makeEvent({
        allDay: true, start: null, end: null, startDate: '2026-12-24', endDate: '2026-12-24',
        recurrence: normalizeRecurrence({ frequency: 'YEARLY', until: '2030-12-31' }),
        exdates: ['2027-12-24']
    });
    const lines = unfold(generateICS([event], { now }));
    assert.ok(lines.includes('RRULE:FREQ=YEARLY;UNTIL=20301231'));
    assert.ok(lines.includes('EXDATE;VALUE=DATE:20271224'));
});

test('includes an escaped description and location', () => {
    const lines = unfold(generateICS([makeEvent({ description: 'Bring: laptop, notes; snacks\nRoom 2', location: 'HQ, floor 3' })], { now }));
    assert.ok(lines.includes('DESCRIPTION:Bring: laptop\\, notes\\; snacks\\nRoom 2'));
    assert.ok(lines.includes('LOCATION:HQ\\, floor 3'));
});

test('reminders become VALARMs', () => {
    const lines = vevent(unfold(generateICS([makeEvent({ reminders: [0, 30, 1440] })], { now })));
    const ics = lines.join('\n');
    assert.match(ics, /BEGIN:VALARM\nACTION:DISPLAY\nDESCRIPTION:Team meeting\nTRIGGER:PT0M\nEND:VALARM/);
    assert.match(ics, /TRIGGER:-PT30M/);
    assert.match(ics, /TRIGGER:-P1D/);
    // Alarms sit inside the VEVENT
    assert.equal(lines.at(-1), 'END:VEVENT');
});

test('recurring events get an RRULE with a UTC UNTIL, and EXDATEs', () => {
    const event = makeEvent({
        recurrence: normalizeRecurrence({ frequency: 'WEEKLY', byDay: ['MO', 'WE'], until: '2026-12-31' }),
        exdates: ['2026-10-21']
    });
    const lines = unfold(generateICS([event], { now }));
    assert.ok(lines.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T225959Z'));
    assert.ok(lines.includes('EXDATE;TZID=Europe/Paris:20261021T150000'));
});

test('ordinal weekdays, days of the month and yearly weekday rules', () => {
    const rule = (raw) => unfold(generateICS([makeEvent({ recurrence: normalizeRecurrence(raw) })], { now }))
        .find(line => line.startsWith('RRULE:'));
    assert.equal(rule({ frequency: 'MONTHLY', byDay: ['-1FR'], count: 6 }), 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=6');
    assert.equal(rule({ frequency: 'MONTHLY', byMonthDay: [1, 15], count: 6 }), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=6');
    assert.equal(rule({ frequency: 'YEARLY', byDay: ['4TH'], count: 3 }), 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=4TH;COUNT=3');
    assert.equal(rule({ frequency: 'DAILY', interval: 2, count: 5 }), 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5');
});

test('edited occurrences get their own VEVENT with a RECURRENCE-ID', () => {
    const event = makeEvent({
        reminders: [30],
        recurrence: normalizeRecurrence({ frequency: 'WEEKLY', count: 3 }),
        overrides: { '2026-10-26': { title: 'Moved meeting', start: new Date('2026-10-27T15:00:00Z') } }
    });
    const lines = unfold(generateICS([event], { now }));
    const override = vevent(lines, 1);
    assert.ok(override.includes('UID:abc@ai-calendar-generator'));
    // Original start: 15:00 Paris on Oct 26 (after the DST change)
    assert.ok(override.includes('RECURRENCE-ID;TZID=Europe/Paris:20261026T150000'));
    assert.ok(override.includes('DTSTART;TZID=Europe/Paris:20261027T160000'));
    assert.ok(override.includes('DTEND;TZID=Europe/Paris:20261027T170000'));
    assert.ok(override.includes('SUMMARY:Moved meeting'));
    assert.ok(override.includes('TRIGGER:-PT30M'));
    assert.ok(!override.some(line => line.startsWith('RRULE')));
});

test('folds long lines to 75 octets without splitting characters', () => {
    const description = 'Café ☕ '.repeat(40);
    const ics = generateICS([makeEvent({ description })], { now });
    for (const line of ics.split('\r\n')) {
        assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line too long: ${line}`);
    }
    assert.ok(unfold(ics).includes(`DESCRIPTION:${description}`));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});
