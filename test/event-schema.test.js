import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_EVENTS, normalizeEvents } from '../src/event-schema.js';

// Monday 2026-10-19 14:37:25 in Paris
const now = new Date('2026-10-19T12:37:25Z');
const paris = { timeZone: 'Europe/Paris', now };

test('converts wall times in the event time zone to UTC', () => {
    const [event] = normalizeEvents({
        events: [{ title: ' Lunch ', date: '2026-10-20', time: '12:00', endTime: '13:30', loc: 'Cafe', notes: 'Bring cash' }]
    }, paris);
    assert.deepEqual(event, {
        title: 'Lunch',
        allDay: false,
        start: '2026-10-20T10:00:00.000Z',
        end: '2026-10-20T11:30:00.000Z',
        timeZone: 'Europe/Paris',
        location: 'Cafe',
        description: 'Bring cash',
        reminders: [],
        recurrence: null
    });
});

test('without a date or time, the event starts now, rounded to the closest half hour, for 1 hour', () => {
    // 14:37 rounds down to 14:30
    const [callMom] = normalizeEvents({ events: [{ title: 'Call mom' }] }, paris);
    assert.equal(callMom.allDay, false);
    assert.equal(callMom.start, '2026-10-19T12:30:00.000Z');
    assert.equal(callMom.end, '2026-10-19T13:30:00.000Z');

    // 14:46 rounds up to 15:00
    const [later] = normalizeEvents({ events: [{ title: 'x' }] }, { timeZone: 'Europe/Paris', now: new Date('2026-10-19T12:46:00Z') });
    assert.equal(later.start, '2026-10-19T13:00:00.000Z');

    // 23:50 rounds to midnight, the next day
    const [lateNight] = normalizeEvents({ events: [{ title: 'x' }] }, { timeZone: 'UTC', now: new Date('2026-10-19T23:50:00Z') });
    assert.equal(lateNight.start, '2026-10-20T00:00:00.000Z');
});

test('a date without a time is an all-day event', () => {
    const [dentist, today] = normalizeEvents({
        events: [
            { title: 'Dentist', date: '2026-10-23' },
            // Only an end time is not a start time either
            { title: 'Call mom', date: '2026-10-19', endTime: '16:00' }
        ]
    }, paris);
    assert.deepEqual([dentist.allDay, dentist.startDate, dentist.endDate], [true, '2026-10-23', '2026-10-23']);
    assert.deepEqual([today.allDay, today.startDate], [true, '2026-10-19']);
});

test('a length without a start time: today rounds up, a later day rounds to the closest half hour', () => {
    // Now is 14:37 in Paris
    const [today, noDate, friday] = normalizeEvents({
        events: [
            { title: 'Workshop', date: '2026-10-19', duration: 120 },
            { title: 'Workshop', duration: 120 },
            { title: 'Workshop', date: '2026-10-23', duration: 120 }
        ]
    }, paris);
    assert.deepEqual([today.allDay, today.start, today.end], [false, '2026-10-19T13:00:00.000Z', '2026-10-19T15:00:00.000Z']);
    assert.equal(noDate.start, '2026-10-19T13:00:00.000Z');
    assert.deepEqual([friday.allDay, friday.start, friday.end], [false, '2026-10-23T12:30:00.000Z', '2026-10-23T14:30:00.000Z']);

    // Exactly on a half hour stays there
    const [onTheDot] = normalizeEvents({ events: [{ title: 'x', duration: 30 }] }, { timeZone: 'UTC', now: new Date('2026-10-19T14:30:00Z') });
    assert.equal(onTheDot.start, '2026-10-19T14:30:00.000Z');
    // Rounding up late in the evening moves to the next day
    const [late] = normalizeEvents({ events: [{ title: 'x', duration: 60 }] }, { timeZone: 'UTC', now: new Date('2026-10-19T23:40:00Z') });
    assert.equal(late.start, '2026-10-20T00:00:00.000Z');
});

test('a repeating event with a length but no start time is a timed series', () => {
    // Said on Monday at 14:37; the first Tuesday is a later day, so the closest half hour
    const [yoga] = normalizeEvents({ events: [{ title: 'Yoga', duration: 60, repeat: { freq: 'WEEKLY', days: ['TU'] } }] }, paris);
    assert.deepEqual([yoga.allDay, yoga.start, yoga.end], [false, '2026-10-20T12:30:00.000Z', '2026-10-20T13:30:00.000Z']);
});

test('a repeating event without a time is an all-day series', () => {
    // 2026-10-19 is a Monday; "every Tuesday" starts on the 20th
    const [event] = normalizeEvents({ events: [{ title: 'Bins out', repeat: { freq: 'WEEKLY', days: ['TU'] } }] }, paris);
    assert.deepEqual([event.allDay, event.startDate, event.endDate], [true, '2026-10-20', '2026-10-20']);
    assert.deepEqual(event.recurrence, { frequency: 'WEEKLY', interval: 1, byDay: ['TU'], count: 4 });
});

test('duration and overnight end times', () => {
    const [withDuration, overnight, badEnd] = normalizeEvents({
        events: [
            { title: 'Workshop', date: '2026-10-20', time: '09:00', duration: 150 },
            { title: 'Party', date: '2026-10-24', time: '22:00', endTime: '02:00' },
            { title: 'x', date: '2026-10-20', time: '09:00', endDate: '2026-10-20', endTime: '08:00' }
        ]
    }, { timeZone: 'UTC', now });
    assert.equal(withDuration.end, '2026-10-20T11:30:00.000Z');
    assert.equal(overnight.end, '2026-10-25T02:00:00.000Z');
    assert.equal(badEnd.end, '2026-10-20T10:00:00.000Z');
});

test('all-day events, single and multi-day', () => {
    const [holiday, vacation, backwards] = normalizeEvents({
        events: [
            { title: 'Holiday', date: '2026-12-24', allDay: true },
            { title: 'Vacation', date: '2027-08-01', endDate: '2027-08-15', allDay: true },
            { title: 'x', date: '2027-08-01', endDate: '2027-07-01', allDay: true }
        ]
    }, paris);
    assert.deepEqual(holiday, {
        title: 'Holiday', allDay: true, startDate: '2026-12-24', endDate: '2026-12-24',
        timeZone: 'Europe/Paris', location: '', description: '', reminders: [], recurrence: null
    });
    assert.equal(vacation.endDate, '2027-08-15');
    assert.equal(backwards.endDate, '2027-08-01');
});

test('reminders are cleaned', () => {
    const [event] = normalizeEvents({ events: [{ title: 'x', date: '2026-10-20', time: '09:00', remind: [30, '10', -5, 30, 'soon'] }] }, paris);
    assert.deepEqual(event.reminders, [10, 30]);
});

test('uses a time zone named by the model when it is valid', () => {
    const [tokyo, fallback] = normalizeEvents({
        events: [
            { title: 'Call', date: '2026-10-20', time: '15:00', tz: 'Asia/Tokyo' },
            { title: 'Call', date: '2026-10-20', time: '15:00', tz: 'Tokyo time' }
        ]
    }, { timeZone: 'UTC', now });
    assert.equal(tokyo.timeZone, 'Asia/Tokyo');
    assert.equal(tokyo.start, '2026-10-20T06:00:00.000Z');
    assert.equal(fallback.timeZone, 'UTC');
});

test('repeat rules: short keys, ordinals, and moving to the first occurrence', () => {
    const [gym, lastFriday, weekdays] = normalizeEvents({
        events: [
            // 2026-10-18 is a Sunday; the series is on Mondays
            { title: 'Gym', date: '2026-10-18', time: '19:00', repeat: { freq: 'WEEKLY', days: ['MO'] } },
            { title: 'Review', date: '2026-10-19', time: '16:00', repeat: { freq: 'MONTHLY', days: ['-1FR'], count: 3 } },
            { title: 'Standup', date: '2026-10-19', time: '09:00', repeat: { freq: 'WEEKLY', days: ['MO', 'TU', 'WE', 'TH', 'FR'], until: '2026-12-31' } }
        ]
    }, { timeZone: 'UTC', now });
    assert.equal(gym.start, '2026-10-19T19:00:00.000Z');
    assert.deepEqual(gym.recurrence, { frequency: 'WEEKLY', interval: 1, byDay: ['MO'], count: 4 });
    assert.equal(lastFriday.start, '2026-10-30T16:00:00.000Z');
    assert.deepEqual(lastFriday.recurrence, { frequency: 'MONTHLY', interval: 1, byDay: ['-1FR'], count: 3 });
    assert.deepEqual(weekdays.recurrence.byDay, ['MO', 'TU', 'WE', 'TH', 'FR']);
});

test('all-day repeating events move with their end date', () => {
    const [event] = normalizeEvents({
        events: [{ title: 'Market', date: '2026-10-18', endDate: '2026-10-19', allDay: true, repeat: { freq: 'WEEKLY', days: ['SA'] } }]
    }, paris);
    assert.equal(event.startDate, '2026-10-24');
    assert.equal(event.endDate, '2026-10-25');
});

test('drops a recurrence that has no occurrences', () => {
    const [event] = normalizeEvents({
        events: [{ title: 'x', date: '2026-10-18', time: '19:00', repeat: { freq: 'WEEKLY', days: ['MO'], until: '2026-10-18' } }]
    }, paris);
    assert.equal(event.recurrence, null);
});

test('drops malformed input and limits the number of events', () => {
    assert.deepEqual(normalizeEvents({ events: [null, 'text'] }, paris), []);
    assert.deepEqual(normalizeEvents(null, paris), []);
    assert.deepEqual(normalizeEvents({ events: 'nope' }, paris), []);
    const events = Array.from({ length: 50 }, () => ({ title: 'x', date: '2026-10-20' }));
    assert.equal(normalizeEvents({ events }, paris).length, MAX_EVENTS);
});

test('invalid dates fall back to today', () => {
    const [timed, untimed] = normalizeEvents({ events: [{ title: 'x', date: 'tomorrow', time: '09:00' }, { title: 'y', date: 'tomorrow' }] }, paris);
    assert.equal(timed.start, '2026-10-19T07:00:00.000Z');
    // Treated as no date at all, so it starts now
    assert.equal(untimed.start, '2026-10-19T12:30:00.000Z');
});
