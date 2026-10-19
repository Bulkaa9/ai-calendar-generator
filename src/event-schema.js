// Validates and cleans up events produced by the language model.
//
// Input (model output, untrusted; short keys keep the reply small):
//   { events: [{ title, date, time, endDate, endTime, duration, allDay, tz, loc, notes, remind, repeat }] }
//   repeat: { freq, interval, days, monthDays, until, count }
// Output (sent to the browser), timed:
//   { title, allDay: false, start: ISO-8601 UTC, end: ISO-8601 UTC, timeZone, location, description, reminders, recurrence }
// or all-day (endDate inclusive):
//   { title, allDay: true, startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD', timeZone, location, description, reminders, recurrence }

import { normalizeReminders } from './reminders.js';
import { firstOccurrenceDate, normalizeRecurrence } from './recurrence.js';
import {
    addDays, diffDays, getWallTime, isValidTimeZone, parseIsoDate, parseTime, toDayKey, toIsoDate, toPlainDate, wallTimeToDate
} from './time.js';

export const MAX_EVENTS = 20;
export const MAX_TITLE_LENGTH = 200;
export const MAX_TEXT_LENGTH = 1000;
export const DEFAULT_DURATION_MINUTES = 60;
const MAX_DURATION_MINUTES = 14 * 24 * 60;
const MAX_ALL_DAY_SPAN_DAYS = 366;
const MINUTE_MS = 60 * 1000;
const HALF_HOUR_MINUTES = 30;

// Events without a start time are all-day events when a date or a repeat is
// given ("dentist on Friday", "every Monday"), unless they have a length
// ("2-hour workshop on Friday"). Otherwise they start around `now`, when the
// request was received: see timedRange().
export function normalizeEvents(raw, { timeZone, now = new Date() }) {
    const list = Array.isArray(raw?.events) ? raw.events : [];
    return list.slice(0, MAX_EVENTS)
        .map(event => normalizeEvent(event, timeZone, now))
        .filter(Boolean);
}

function normalizeEvent(raw, defaultTimeZone, now) {
    if (!raw || typeof raw !== 'object') return null;

    const timeZone = isValidTimeZone(raw.tz) ? raw.tz : defaultTimeZone;
    const givenDate = parseIsoDate(raw.date);
    const date = givenDate ?? toPlainDate(getWallTime(now, timeZone));
    let recurrence = recurrenceFromModel(raw.repeat);
    const hasStart = !!parseTime(raw.time) || !!durationMinutes(raw.duration);
    const allDay = raw.allDay === true || (!hasStart && (!!givenDate || !!recurrence));

    // The first occurrence must be the event start (e.g. "every Monday" said on a Sunday)
    let shift = 0;
    if (recurrence) {
        const first = firstOccurrenceDate(recurrence, date);
        if (first) shift = diffDays(date, first);
        else recurrence = null;
    }

    const common = {
        title: cleanText(raw.title, MAX_TITLE_LENGTH) || 'Untitled event',
        timeZone,
        location: cleanText(raw.loc, MAX_TEXT_LENGTH),
        description: cleanText(raw.notes, MAX_TEXT_LENGTH),
        reminders: normalizeReminders(raw.remind),
        recurrence
    };

    if (allDay) {
        const startDate = addDays(date, shift);
        const lastDate = parseIsoDate(raw.endDate);
        const span = lastDate ? diffDays(date, lastDate) : 0;
        const endDate = addDays(startDate, span >= 0 && span <= MAX_ALL_DAY_SPAN_DAYS ? span : 0);
        return { ...common, allDay: true, startDate: toIsoDate(startDate), endDate: toIsoDate(endDate) };
    }

    // Times are worked out on the first occurrence's date, so "today" means the day it really happens
    const lastDate = parseIsoDate(raw.endDate);
    const shifted = { ...raw, endDate: lastDate ? toIsoDate(addDays(lastDate, shift)) : undefined };
    const { start, end } = timedRange(shifted, addDays(date, shift), timeZone, now);
    return { ...common, allDay: false, start: start.toISOString(), end: end.toISOString() };
}

// Start and end instants of a timed event; without an end it lasts
// DEFAULT_DURATION_MINUTES. Without a start time it starts at `now`'s time of
// day rounded to the closest half hour, except for an event with a length on
// the current day ("2-hour workshop today"), which starts at the next half hour.
export function timedRange({ time, endDate, endTime, duration }, date, timeZone, now) {
    const given = parseTime(time);
    let startDay = date;
    let startTime = given;
    if (!given) {
        const today = toPlainDate(getWallTime(now, timeZone));
        const roundUp = !!durationMinutes(duration) && toDayKey(date) === toDayKey(today);
        const rounded = roundedNow(now, timeZone, roundUp ? 'up' : 'closest');
        startDay = addDays(date, rounded.dayOffset);
        startTime = rounded;
    }
    const start = wallTimeToDate({ ...startDay, hour: startTime.hour, minute: startTime.minute, second: 0 }, timeZone);

    const endClock = parseTime(endTime);
    if (endClock) {
        const endDay = parseIsoDate(endDate);
        let end = wallTimeToDate({ ...(endDay ?? date), ...endClock, second: 0 }, timeZone);
        // "10pm to 2am" ends the next day
        if (end <= start && !endDay) end = wallTimeToDate({ ...addDays(date, 1), ...endClock, second: 0 }, timeZone);
        if (end > start) return { start, end };
    }

    const length = durationMinutes(duration) ?? DEFAULT_DURATION_MINUTES;
    return { start, end: new Date(start.getTime() + length * MINUTE_MS) };
}

// A valid event length in minutes, or null
function durationMinutes(value) {
    const minutes = Number(value);
    return value != null && Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_DURATION_MINUTES ? minutes : null;
}

// Current time of day in the time zone, rounded to a half hour ('closest' or
// 'up'): { hour, minute, dayOffset } where dayOffset is 1 when it rounds to midnight
export function roundedNow(now, timeZone, mode = 'closest') {
    const wall = getWallTime(now, timeZone);
    const round = mode === 'up' ? Math.ceil : Math.round;
    const minutes = round((wall.hour * 60 + wall.minute + wall.second / 60) / HALF_HOUR_MINUTES) * HALF_HOUR_MINUTES;
    return { hour: Math.floor(minutes / 60) % 24, minute: minutes % 60, dayOffset: minutes >= 24 * 60 ? 1 : 0 };
}

// Converts the model's short repeat format into a recurrence rule (or null)
export function recurrenceFromModel(repeat) {
    if (!repeat || typeof repeat !== 'object') return null;
    return normalizeRecurrence({
        frequency: repeat.freq,
        interval: repeat.interval,
        byDay: repeat.days,
        byMonthDay: repeat.monthDays,
        until: repeat.until,
        count: repeat.count
    });
}

export function cleanText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
