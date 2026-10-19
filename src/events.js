// Operations on events. Nothing here touches the DOM or mutates its inputs:
// every function returns new objects, so changes can be previewed before they
// are applied.
//
// An event is:
//   { id, title, location, description, timeZone, reminders, recurrence,
//     allDay: false, start: Date, end: Date }                     timed, or
//     allDay: true, startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD'  all-day (end inclusive)
//   plus, for recurring events:
//     exdates: ['YYYY-MM-DD']               deleted occurrences
//     overrides: { 'YYYY-MM-DD': {...} }    single-occurrence edits, holding only the
//                                           fields that differ (title, location, description,
//                                           reminders, start/end or startDate/endDate)
// Occurrence dates are the original dates, in the event's time zone.
//
// A draft is what the editor shows, as strings in the event's time zone:
//   { title, allDay, startDate, startTime, endDate, endTime, timeZone, location, description, reminders, recurrence }

import { roundedNow, timedRange } from './event-schema.js';
import { describeRecurrence, formatIsoDate, formatReminders, formatWhen } from './format.js';
import { normalizeReminders } from './reminders.js';
import {
    eventStartDate, expandEvent, firstOccurrenceDate, normalizeRecurrence, occurrenceOn, seriesDates, WEEKDAYS
} from './recurrence.js';
import {
    addDays, addDaysIso, dayOfWeek, diffDays, formatTime24, getWallTime, isValidTimeZone, parseIsoDate, parseTime,
    toDayKey, toIsoDate, wallTimeToDate
} from './time.js';

const HOUR_MS = 60 * 60 * 1000;

export function createEvent(fields, id) {
    return {
        id,
        title: '',
        location: '',
        description: '',
        timeZone: 'UTC',
        reminders: [],
        recurrence: null,
        allDay: false,
        start: null,
        end: null,
        startDate: null,
        endDate: null,
        exdates: [],
        overrides: {},
        ...fields
    };
}

// Converts an event from /api/parse-event into an event, or null if it is unusable
export function eventFromApi(raw, id, fallbackTimeZone) {
    if (!raw || typeof raw !== 'object') return null;
    const common = {
        title: String(raw.title || 'Untitled event'),
        timeZone: isValidTimeZone(raw.timeZone) ? raw.timeZone : fallbackTimeZone,
        location: String(raw.location || ''),
        description: String(raw.description || ''),
        reminders: normalizeReminders(raw.reminders),
        recurrence: normalizeRecurrence(raw.recurrence)
    };

    if (raw.allDay) {
        const start = parseIsoDate(raw.startDate);
        if (!start) return null;
        const end = parseIsoDate(raw.endDate);
        const startDate = toIsoDate(start);
        const endDate = end && toDayKey(end) >= toDayKey(start) ? toIsoDate(end) : startDate;
        return createEvent({ ...common, allDay: true, startDate, endDate }, id);
    }

    const start = new Date(raw.start);
    const end = new Date(raw.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
    return createEvent({ ...common, allDay: false, start, end }, id);
}

// --- Drafts (editor values) ---

// A new event starting now (rounded to the closest half hour), one hour long
export function newDraft(timeZone, now = new Date()) {
    const rounded = roundedNow(now, timeZone);
    const day = addDays(getWallTime(now, timeZone), rounded.dayOffset);
    const startInstant = wallTimeToDate({ ...day, hour: rounded.hour, minute: rounded.minute }, timeZone);
    const start = getWallTime(startInstant, timeZone);
    const end = getWallTime(new Date(startInstant.getTime() + HOUR_MS), timeZone);
    return {
        title: '',
        allDay: false,
        startDate: toIsoDate(start),
        startTime: formatTime24(start),
        endDate: toIsoDate(end),
        endTime: formatTime24(end),
        timeZone,
        location: '',
        description: '',
        reminders: [],
        recurrence: null
    };
}

export function draftFromEvent(event, now = new Date()) {
    return draftFrom(event, event, now);
}

// Draft for editing one occurrence; it has no recurrence of its own
export function draftFromOccurrence(event, occurrence, now = new Date()) {
    return { ...draftFrom(event, occurrence, now), recurrence: null };
}

function draftFrom(event, source, now) {
    const draft = {
        title: source.title,
        allDay: !!event.allDay,
        timeZone: event.timeZone,
        location: source.location ?? '',
        description: source.description ?? '',
        reminders: [...(source.reminders ?? [])],
        recurrence: event.recurrence ?? null
    };
    if (event.allDay) {
        // Times used if the editor switches the event to a timed one
        const fallback = newDraft(event.timeZone, now);
        return { ...draft, startDate: source.startDate, endDate: source.endDate, startTime: fallback.startTime, endTime: fallback.endTime };
    }
    const start = getWallTime(source.start, event.timeZone);
    const end = getWallTime(source.end, event.timeZone);
    return {
        ...draft,
        startDate: toIsoDate(start),
        startTime: formatTime24(start),
        endDate: toIsoDate(end),
        endTime: formatTime24(end)
    };
}

// Turns a draft into event fields, or returns { errors: { field: message } }
export function fieldsFromDraft(draft) {
    const errors = {};
    const title = String(draft.title ?? '').trim();
    if (!title) errors.title = 'Enter a title.';

    const startDate = parseIsoDate(draft.startDate);
    const endDate = parseIsoDate(draft.endDate);
    if (!startDate) errors.startDate = 'Pick a start date.';
    if (!endDate) errors.endDate = 'Pick an end date.';

    const common = {
        title,
        allDay: !!draft.allDay,
        timeZone: draft.timeZone,
        location: String(draft.location ?? '').trim(),
        description: String(draft.description ?? '').trim(),
        reminders: normalizeReminders(draft.reminders),
        recurrence: draft.recurrence ?? null
    };
    let range;

    if (draft.allDay) {
        if (startDate && endDate && toDayKey(endDate) < toDayKey(startDate)) {
            errors.endDate = 'The end date is before the start date.';
        }
        range = { start: null, end: null, startDate: draft.startDate, endDate: draft.endDate };
    } else {
        const startTime = parseTime(draft.startTime);
        const endTime = parseTime(draft.endTime);
        if (!startTime) errors.startTime = 'Pick a start time.';
        if (!endTime) errors.endTime = 'Pick an end time.';
        if (!isValidTimeZone(draft.timeZone)) errors.timeZone = 'Pick a time zone.';
        if (startDate && endDate && startTime && endTime && !errors.timeZone) {
            const start = wallTimeToDate({ ...startDate, ...startTime, second: 0 }, draft.timeZone);
            const end = wallTimeToDate({ ...endDate, ...endTime, second: 0 }, draft.timeZone);
            if (end <= start) errors.endTime = 'The event must end after it starts.';
            range = { start, end, startDate: null, endDate: null };
        }
    }

    if (common.recurrence && startDate && !firstOccurrenceDate(common.recurrence, startDate)) {
        errors.recurrence = 'The repeat ends before the event starts.';
    }

    if (Object.keys(errors).length) return { errors };
    return { fields: { ...common, ...range } };
}

// --- Editing ---

// Applies new fields to a whole event (or series). The series start is moved
// to its first real occurrence, and deleted or edited occurrences that no
// longer exist are dropped. With `followWeekday`, a weekly series on a single
// weekday moves to the new start's weekday ("move the gym to Tuesday").
export function updateSeries(event, fields, { followWeekday = false } = {}) {
    let next = { ...event, ...fields };
    const oldStart = eventStartDate(event);
    const newStart = eventStartDate(next);
    const rule = next.recurrence;

    if (followWeekday && rule?.frequency === 'WEEKLY' && rule.byDay?.length === 1 &&
        rule.byDay[0] === WEEKDAYS[dayOfWeek(oldStart)] && toDayKey(oldStart) !== toDayKey(newStart)) {
        next.recurrence = { ...rule, byDay: [WEEKDAYS[dayOfWeek(newStart)]] };
    }

    if (next.recurrence) {
        const first = firstOccurrenceDate(next.recurrence, newStart);
        if (!first) next.recurrence = null;
        else next = shiftEvent(next, diffDays(newStart, first));
    }

    if (!next.recurrence || next.allDay !== event.allDay) {
        return { ...next, exdates: [], overrides: {} };
    }
    const valid = new Set(seriesDates(next));
    return {
        ...next,
        exdates: (next.exdates ?? []).filter(date => valid.has(date)),
        overrides: Object.fromEntries(Object.entries(next.overrides ?? {}).filter(([date]) => valid.has(date)))
    };
}

// Moves an event by whole days, keeping its times of day
function shiftEvent(event, days) {
    if (days === 0) return event;
    if (event.allDay) {
        return { ...event, startDate: addDaysIso(event.startDate, days), endDate: addDaysIso(event.endDate, days) };
    }
    const move = (date) => {
        const wall = getWallTime(date, event.timeZone);
        return wallTimeToDate({ ...wall, ...addDays(wall, days) }, event.timeZone);
    };
    return { ...event, start: move(event.start), end: move(event.end) };
}

// Edits one occurrence of a recurring event (identified by its original date).
// Only fields that differ from the series are stored.
export function updateOccurrence(event, date, fields) {
    const base = occurrenceOn(event, date, { applyOverride: false });
    if (!base) return event;

    const override = {};
    for (const key of ['title', 'location', 'description']) {
        if (fields[key] !== undefined && fields[key] !== base[key]) override[key] = fields[key];
    }
    if (fields.reminders && fields.reminders.join() !== base.reminders.join()) override.reminders = fields.reminders;
    if (event.allDay) {
        if (fields.startDate && fields.startDate !== base.startDate) override.startDate = fields.startDate;
        if (fields.endDate && fields.endDate !== base.endDate) override.endDate = fields.endDate;
    } else {
        if (fields.start && fields.start.getTime() !== base.start.getTime()) override.start = fields.start;
        if (fields.end && fields.end.getTime() !== base.end.getTime()) override.end = fields.end;
    }

    const overrides = { ...event.overrides };
    if (Object.keys(override).length) overrides[date] = override;
    else delete overrides[date];
    return { ...event, overrides };
}

// Deletes one occurrence. Returns the updated event, or null when nothing
// would remain (or the event does not repeat), meaning the whole event goes.
export function removeOccurrence(event, date) {
    if (!event.recurrence) return null;
    const overrides = { ...event.overrides };
    delete overrides[date];
    const next = { ...event, exdates: [...new Set([...(event.exdates ?? []), date])], overrides };
    return expandEvent(next).length ? next : null;
}

// The occurrence originally on `date`, or else the one currently starting on it (after an override moved it)
export function findOccurrence(event, date) {
    return occurrenceOn(event, date) ??
        expandEvent(event).find(o => (o.allDay ? o.startDate : toIsoDate(getWallTime(o.start, event.timeZone))) === date) ??
        null;
}

// --- Changes from the AI ---

// Applies one validated change ({ op, on, set }, see change-schema.js) to an event.
// Returns { event, summary } where event is null when it is deleted, or { error }.
// `display` is { timeZone, use24Hour } for the summary text.
export function applyChange(event, change, { now = new Date(), display }) {
    const name = `"${event.title}"`;
    const when = (occurrence) => formatWhen(occurrence, display.timeZone, display.use24Hour);

    if (change.on && event.recurrence) {
        const occurrence = findOccurrence(event, change.on);
        if (!occurrence) return { error: `${name} has no occurrence on ${formatIsoDate(change.on)}.` };

        if (change.op === 'delete') {
            return { event: removeOccurrence(event, occurrence.date), summary: `Delete ${name} on ${when(occurrence)}` };
        }
        // Repeat, all-day and time zone belong to the series, not one occurrence
        const { recurrence, allDay, timeZone, ...set } = change.set;
        const result = fieldsFromDraft(applySet(draftFromOccurrence(event, occurrence, now), set, now));
        if (result.errors) return { error: `Can't change ${name}: ${Object.values(result.errors)[0]}` };
        const next = updateOccurrence(event, occurrence.date, result.fields);
        const after = occurrenceOn(next, occurrence.date);
        return { event: next, summary: `Change ${name} on ${formatIsoDate(occurrence.date)} only: ${describeDifferences(occurrence, after, display)}` };
    }

    if (change.on && toIsoDate(eventStartDate(event)) !== change.on) {
        return { error: `${name} is not on ${formatIsoDate(change.on)}.` };
    }
    if (change.op === 'delete') {
        return { event: null, summary: event.recurrence ? `Delete ${name} (every occurrence)` : `Delete ${name}` };
    }

    const result = fieldsFromDraft(applySet(draftFromEvent(event, now), change.set, now));
    if (result.errors) return { error: `Can't change ${name}: ${Object.values(result.errors)[0]}` };
    const next = updateSeries(event, result.fields, { followWeekday: true });
    const scope = event.recurrence ? ' (every occurrence)' : '';
    return { event: next, summary: `Change ${name}${scope}: ${describeDifferences(firstOccurrence(event), firstOccurrence(next), display, event, next)}` };
}

function firstOccurrence(event) {
    return occurrenceOn(event, seriesDates(event)[0], { applyOverride: false });
}

// Applies a change's `set` to a draft. Times keep the event's length unless
// the change gives a new end or duration.
export function applySet(draft, set, now = new Date()) {
    const d = { ...draft };
    for (const key of ['title', 'location', 'description', 'reminders', 'recurrence', 'timeZone']) {
        if (key in set) d[key] = set[key];
    }

    const wasAllDay = d.allDay;
    if (typeof set.allDay === 'boolean') d.allDay = set.allDay;

    if (d.allDay) {
        const span = wasAllDay ? diffDays(parseIsoDate(draft.startDate), parseIsoDate(draft.endDate)) : 0;
        if (set.date) d.startDate = set.date;
        d.endDate = set.endDate ?? (set.date || !wasAllDay ? addDaysIso(d.startDate, Math.max(span, 0)) : d.endDate);
        return d;
    }

    const date = parseIsoDate(set.date ?? d.startDate);
    let range;
    if (wasAllDay) {
        range = timedRange(set, date, d.timeZone, now);
    } else {
        const oldStart = wallTimeToDate({ ...parseIsoDate(draft.startDate), ...parseTime(draft.startTime) }, draft.timeZone);
        const oldEnd = wallTimeToDate({ ...parseIsoDate(draft.endDate), ...parseTime(draft.endTime) }, draft.timeZone);
        const time = set.time ?? draft.startTime;
        if (set.endTime || set.duration) {
            range = timedRange({ ...set, time }, date, d.timeZone, now);
        } else {
            const start = wallTimeToDate({ ...date, ...parseTime(time), second: 0 }, d.timeZone);
            const end = set.endDate
                ? wallTimeToDate({ ...parseIsoDate(set.endDate), ...parseTime(draft.endTime), second: 0 }, d.timeZone)
                : new Date(start.getTime() + (oldEnd - oldStart));
            range = { start, end };
        }
    }

    const start = getWallTime(range.start, d.timeZone);
    const end = getWallTime(range.end, d.timeZone);
    return { ...d, startDate: toIsoDate(start), startTime: formatTime24(start), endDate: toIsoDate(end), endTime: formatTime24(end) };
}

// Human-readable list of what changed between two occurrences (and series)
function describeDifferences(before, after, display, beforeEvent, afterEvent) {
    const parts = [];
    const when = (o) => formatWhen(o, display.timeZone, display.use24Hour);
    if (when(before) !== when(after)) parts.push(`${when(before)} → ${when(after)}`);
    if (before.title !== after.title) parts.push(`renamed to "${after.title}"`);
    if (before.location !== after.location) parts.push(after.location ? `location: ${after.location}` : 'location removed');
    if (before.description !== after.description) parts.push(after.description ? 'notes updated' : 'notes removed');
    if (before.reminders.join() !== after.reminders.join()) {
        parts.push(after.reminders.length ? `reminders: ${formatReminders(after.reminders)}` : 'reminders removed');
    }
    if (beforeEvent && afterEvent) {
        if (beforeEvent.timeZone !== afterEvent.timeZone) parts.push(`time zone: ${afterEvent.timeZone}`);
        const describe = (event) => event.recurrence
            ? describeRecurrence(event.recurrence, { startMonth: eventStartDate(event).month })
            : null;
        const [oldRule, newRule] = [describe(beforeEvent), describe(afterEvent)];
        if (oldRule !== newRule) parts.push(newRule ? `repeats ${lowerFirst(newRule)}` : 'no longer repeats');
    }
    return parts.length ? parts.join('; ') : 'no visible change';
}

function lowerFirst(text) {
    return text.charAt(0).toLowerCase() + text.slice(1);
}

// Applies a list of changes, each with an `eventId`, in order. Returns the
// resulting events and one result per change: { change, summary } or { change, error }.
export function planChanges(events, changes, options) {
    const working = new Map(events.map(event => [event.id, event]));
    const results = changes.map(change => {
        const event = working.get(change.eventId);
        if (!event) return { change, error: 'That event was already deleted by an earlier change.' };
        const result = applyChange(event, change, options);
        if (result.error) return { change, error: result.error };
        if (result.event) working.set(event.id, result.event);
        else working.delete(event.id);
        return { change, summary: result.summary };
    });
    return { results, events: events.map(event => working.get(event.id)).filter(Boolean) };
}
