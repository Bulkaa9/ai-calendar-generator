// Validates changes to existing events produced by the language model.
//
// Input (model output, untrusted):
//   { changes: [{ op: 'update' | 'delete', event: <number>, on: 'YYYY-MM-DD', set: { ...fields } }] }
//   `event` is the 1-based number of the event in the list sent to the model;
//   `on` targets a single occurrence of a repeating event.
//   `set` uses the same short keys as new events: title, date, time, endDate,
//   endTime, duration, allDay, tz, loc, notes, remind, repeat (null stops repeating).
// Output:
//   [{ op, ref, on, set: { title, date, time, endDate, endTime, duration, allDay, timeZone, location, description, reminders, recurrence } }]
//   where `set` only has the keys the model provided with valid values.

import { cleanText, MAX_TEXT_LENGTH, MAX_TITLE_LENGTH, recurrenceFromModel } from './event-schema.js';
import { normalizeReminders } from './reminders.js';
import { formatTime24, isValidTimeZone, parseIsoDate, parseTime, toIsoDate } from './time.js';

export const MAX_CHANGES = 20;

export function normalizeChanges(raw, eventCount) {
    const list = Array.isArray(raw?.changes) ? raw.changes : [];
    return list.slice(0, MAX_CHANGES)
        .map(change => normalizeChange(change, eventCount))
        .filter(Boolean);
}

function normalizeChange(raw, eventCount) {
    if (!raw || typeof raw !== 'object') return null;

    const op = String(raw.op ?? '').toLowerCase();
    if (op !== 'update' && op !== 'delete') return null;

    const ref = Number(raw.event);
    if (!Number.isInteger(ref) || ref < 1 || ref > eventCount) return null;

    const on = parseIsoDate(raw.on);
    const change = { op, ref, on: on ? toIsoDate(on) : null };
    if (op === 'delete') return change;

    change.set = normalizeSet(raw.set);
    return Object.keys(change.set).length ? change : null;
}

function normalizeSet(raw) {
    const set = {};
    if (!raw || typeof raw !== 'object') return set;

    const title = cleanText(raw.title, MAX_TITLE_LENGTH);
    if (title) set.title = title;

    for (const key of ['date', 'endDate']) {
        const date = parseIsoDate(raw[key]);
        if (date) set[key] = toIsoDate(date);
    }
    for (const key of ['time', 'endTime']) {
        const time = parseTime(raw[key]);
        if (time) set[key] = formatTime24(time);
    }

    const duration = Number(raw.duration);
    if (Number.isInteger(duration) && duration > 0 && duration <= 14 * 24 * 60) set.duration = duration;

    if (typeof raw.allDay === 'boolean') set.allDay = raw.allDay;
    if (isValidTimeZone(raw.tz)) set.timeZone = raw.tz;
    if (typeof raw.loc === 'string') set.location = cleanText(raw.loc, MAX_TEXT_LENGTH);
    if (typeof raw.notes === 'string') set.description = cleanText(raw.notes, MAX_TEXT_LENGTH);
    if ('remind' in raw) set.reminders = normalizeReminders(raw.remind);

    if (raw.repeat === null || raw.repeat === 'none') {
        set.recurrence = null;
    } else if (raw.repeat !== undefined) {
        const recurrence = recurrenceFromModel(raw.repeat);
        if (recurrence) set.recurrence = recurrence;
    }
    return set;
}
