import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applySet, createEvent, draftFromEvent, draftFromOccurrence, eventFromApi, fieldsFromDraft, newDraft, planChanges,
    removeOccurrence, updateOccurrence, updateSeries
} from '../src/events.js';
import { expandEvent, normalizeRecurrence, occurrenceOn } from '../src/recurrence.js';

const now = new Date('2026-10-19T12:37:25Z');
const display = { timeZone: 'Europe/Paris', use24Hour: true };

// Gym, Mondays and Wednesdays 19:00-20:00 Paris time, Oct 19 to Nov 30
function gym(extra = {}) {
    return createEvent({
        title: 'Gym',
        timeZone: 'Europe/Paris',
        start: new Date('2026-10-19T17:00:00Z'),
        end: new Date('2026-10-19T18:00:00Z'),
        reminders: [30],
        recurrence: normalizeRecurrence({ frequency: 'WEEKLY', byDay: ['MO', 'WE'], until: '2026-11-30' }),
        ...extra
    }, 'gym');
}

function lunch() {
    return createEvent({
        title: 'Lunch',
        timeZone: 'Europe/Paris',
        start: new Date('2026-10-20T10:00:00Z'),
        end: new Date('2026-10-20T11:00:00Z')
    }, 'lunch');
}

test('eventFromApi builds timed and all-day events', () => {
    const timed = eventFromApi({ title: 'x', allDay: false, start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T11:00:00.000Z', timeZone: 'Mars/Base', reminders: [10] }, 'a', 'UTC');
    assert.equal(timed.timeZone, 'UTC');
    assert.deepEqual(timed.reminders, [10]);
    const allDay = eventFromApi({ title: 'Trip', allDay: true, startDate: '2027-08-01', endDate: '2027-07-01' }, 'b', 'UTC');
    assert.equal(allDay.endDate, '2027-08-01');
    assert.equal(eventFromApi({ allDay: false, start: 'x', end: 'y' }, 'c', 'UTC'), null);
});

test('drafts round-trip through fieldsFromDraft', () => {
    const draft = draftFromEvent(gym(), now);
    assert.equal(draft.startDate, '2026-10-19');
    assert.equal(draft.startTime, '19:00');
    assert.equal(draft.endTime, '20:00');
    const { fields } = fieldsFromDraft(draft);
    assert.equal(fields.start.toISOString(), '2026-10-19T17:00:00.000Z');
    assert.equal(fields.end.toISOString(), '2026-10-19T18:00:00.000Z');
    assert.deepEqual(fields.recurrence, gym().recurrence);
});

test('newDraft starts now, rounded to the closest half hour, and lasts an hour', () => {
    const draft = newDraft('Europe/Paris', now);
    assert.deepEqual([draft.startDate, draft.startTime, draft.endDate, draft.endTime], ['2026-10-19', '14:30', '2026-10-19', '15:30']);
    const late = newDraft('UTC', new Date('2026-10-19T23:50:00Z'));
    assert.deepEqual([late.startDate, late.startTime, late.endDate, late.endTime], ['2026-10-20', '00:00', '2026-10-20', '01:00']);
});

test('fieldsFromDraft reports every problem', () => {
    const { errors } = fieldsFromDraft({ ...newDraft('UTC', now), title: ' ', endTime: '10:00', startTime: '11:00' });
    assert.ok(errors.title);
    assert.ok(errors.endTime);
    const allDay = fieldsFromDraft({ ...newDraft('UTC', now), title: 'x', allDay: true, startDate: '2026-10-20', endDate: '2026-10-19' });
    assert.ok(allDay.errors.endDate);
    const repeat = fieldsFromDraft({
        ...newDraft('UTC', now), title: 'x', recurrence: normalizeRecurrence({ frequency: 'WEEKLY', byDay: ['MO'], until: '2026-10-01' })
    });
    assert.ok(repeat.errors.recurrence);
});

test('updateSeries moves the series to its first occurrence and keeps matching exceptions', () => {
    const event = gym({
        exdates: ['2026-10-21', '2026-10-26'],
        overrides: { '2026-10-28': { title: 'Gym (late)' } }
    });
    // Start on Tuesday Oct 20; the series is Mon/Wed, so it starts Wednesday Oct 21
    const { fields } = fieldsFromDraft({ ...draftFromEvent(event, now), startDate: '2026-10-20', endDate: '2026-10-20' });
    const next = updateSeries(event, fields);
    assert.equal(next.start.toISOString(), '2026-10-21T17:00:00.000Z');
    assert.deepEqual(next.exdates, ['2026-10-21', '2026-10-26']);
    assert.deepEqual(Object.keys(next.overrides), ['2026-10-28']);
});

test('updateSeries with followWeekday moves a single-day weekly series', () => {
    const event = gym({ recurrence: normalizeRecurrence({ frequency: 'WEEKLY', byDay: ['MO'], count: 4 }), exdates: ['2026-10-26'] });
    const { fields } = fieldsFromDraft({ ...draftFromEvent(event, now), startDate: '2026-10-20', endDate: '2026-10-20' });
    const next = updateSeries(event, fields, { followWeekday: true });
    assert.deepEqual(next.recurrence.byDay, ['TU']);
    assert.equal(next.start.toISOString(), '2026-10-20T17:00:00.000Z');
    assert.deepEqual(next.exdates, []);
});

test('updateOccurrence stores only what differs, and series changes still flow through', () => {
    const event = gym();
    const occurrence = occurrenceOn(event, '2026-10-21');
    const draft = { ...draftFromOccurrence(event, occurrence, now), startTime: '20:00', endTime: '21:00' };
    const next = updateOccurrence(event, '2026-10-21', fieldsFromDraft(draft).fields);
    assert.deepEqual(Object.keys(next.overrides['2026-10-21']).sort(), ['end', 'start']);

    const renamed = updateSeries(next, { title: 'Workout' });
    const moved = occurrenceOn(renamed, '2026-10-21');
    assert.equal(moved.title, 'Workout');
    assert.equal(moved.start.toISOString(), '2026-10-21T18:00:00.000Z');

    // Editing it back to the series values removes the override
    const restored = updateOccurrence(next, '2026-10-21', fieldsFromDraft(draftFromOccurrence(event, occurrence, now)).fields);
    assert.deepEqual(restored.overrides, {});
});

test('removeOccurrence excludes a date, and removes the event when nothing is left', () => {
    const event = gym({ overrides: { '2026-10-21': { title: 'x' } } });
    const next = removeOccurrence(event, '2026-10-21');
    assert.deepEqual(next.exdates, ['2026-10-21']);
    assert.deepEqual(next.overrides, {});
    assert.equal(expandEvent(next).length, expandEvent(event).length - 1);

    const single = gym({ recurrence: normalizeRecurrence({ frequency: 'WEEKLY', count: 1 }) });
    assert.equal(removeOccurrence(single, '2026-10-19'), null);
    assert.equal(removeOccurrence(lunch(), '2026-10-20'), null);
});

test('applySet keeps the length when only the time changes', () => {
    const draft = draftFromEvent(gym(), now);
    const moved = applySet(draft, { time: '20:00' }, now);
    assert.deepEqual([moved.startTime, moved.endTime], ['20:00', '21:00']);
    const longer = applySet(draft, { duration: 90 }, now);
    assert.deepEqual([longer.startTime, longer.endTime], ['19:00', '20:30']);
    const toAllDay = applySet(draft, { allDay: true }, now);
    assert.deepEqual([toAllDay.allDay, toAllDay.startDate, toAllDay.endDate], [true, '2026-10-19', '2026-10-19']);
    const tokyo = applySet(draft, { timeZone: 'Asia/Tokyo' }, now);
    assert.deepEqual([tokyo.timeZone, tokyo.startTime], ['Asia/Tokyo', '19:00']);
});

test('applySet on an all-day event moves its whole range', () => {
    const trip = createEvent({ title: 'Trip', allDay: true, startDate: '2027-08-01', endDate: '2027-08-15', timeZone: 'UTC' }, 'trip');
    const moved = applySet(draftFromEvent(trip, now), { date: '2027-08-03' }, now);
    assert.deepEqual([moved.startDate, moved.endDate], ['2027-08-03', '2027-08-17']);
    // Turning it into a timed event without a time uses the current time, rounded
    const timed = applySet(draftFromEvent(trip, now), { allDay: false, date: '2027-08-03' }, now);
    assert.deepEqual([timed.allDay, timed.startTime, timed.endTime], [false, '12:30', '13:30']);
});

test('planChanges: "move the gym to 8pm" changes every occurrence', () => {
    const { results, events } = planChanges([gym(), lunch()], [{ op: 'update', eventId: 'gym', on: null, set: { time: '20:00' } }], { now, display });
    assert.match(results[0].summary, /^Change "Gym" \(every occurrence\): Mon, Oct 19, 2026 • 19:00 - 20:00 → Mon, Oct 19, 2026 • 20:00 - 21:00$/);
    assert.equal(events[0].start.toISOString(), '2026-10-19T18:00:00.000Z');
    assert.equal(events[1].id, 'lunch');
    assert.equal(events[1].start.toISOString(), '2026-10-20T10:00:00.000Z');
});

test('planChanges: "cancel next Wednesday\'s gym" deletes one occurrence', () => {
    const { results, events } = planChanges([gym()], [{ op: 'delete', eventId: 'gym', on: '2026-10-21' }], { now, display });
    assert.equal(results[0].summary, 'Delete "Gym" on Wed, Oct 21, 2026 • 19:00 - 20:00');
    assert.deepEqual(events[0].exdates, ['2026-10-21']);
});

test('planChanges: move one occurrence to another day', () => {
    const { results, events } = planChanges([gym()], [{ op: 'update', eventId: 'gym', on: '2026-10-21', set: { date: '2026-10-22', recurrence: null } }], { now, display });
    assert.match(results[0].summary, /on Wed, Oct 21, 2026 only: Wed, Oct 21, 2026 • 19:00 - 20:00 → Thu, Oct 22, 2026 • 19:00 - 20:00/);
    // The repeat belongs to the series and is ignored for a single occurrence
    assert.ok(events[0].recurrence);
    assert.equal(occurrenceOn(events[0], '2026-10-21').start.toISOString(), '2026-10-22T17:00:00.000Z');
});

test('planChanges reports problems instead of applying them', () => {
    const { results, events } = planChanges([gym(), lunch()], [
        { op: 'delete', eventId: 'gym', on: '2026-10-20' },
        { op: 'delete', eventId: 'lunch', on: '2026-10-21' },
        { op: 'delete', eventId: 'lunch', on: null },
        { op: 'update', eventId: 'lunch', on: null, set: { title: 'x' } }
    ], { now, display });
    assert.match(results[0].error, /no occurrence on Tue, Oct 20, 2026/);
    assert.match(results[1].error, /is not on Wed, Oct 21, 2026/);
    assert.equal(results[2].summary, 'Delete "Lunch"');
    assert.match(results[3].error, /already deleted/);
    assert.deepEqual(events.map(e => e.id), ['gym']);
});

test('planChanges describes repeat, reminder and stop-repeating changes', () => {
    const { results } = planChanges([gym()], [
        { op: 'update', eventId: 'gym', on: null, set: { reminders: [10, 60] } },
        { op: 'update', eventId: 'gym', on: null, set: { recurrence: null } }
    ], { now, display });
    assert.match(results[0].summary, /reminders: 10 min before, 1 hour before/);
    assert.match(results[1].summary, /no longer repeats/);
});
