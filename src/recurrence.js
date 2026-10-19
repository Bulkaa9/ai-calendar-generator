// Recurrence rules: a small, RFC 5545 compatible subset of RRULE.
//
// A rule looks like:
//   { frequency: 'WEEKLY', interval: 1, byDay: ['MO', 'WE'], until: '2027-03-31' }
//   { frequency: 'MONTHLY', interval: 1, byDay: ['-1FR'], count: 6 }      last Friday of the month
//   { frequency: 'MONTHLY', interval: 1, byMonthDay: [1, 15], count: 6 }  1st and 15th
//   { frequency: 'YEARLY', interval: 1, byDay: ['4TH'], count: 3 }        4th Thursday of the start's month
// It always has exactly one of `until` (inclusive, in the event's time zone) or `count`.
//
// byDay entries are weekdays ('MO') for WEEKLY rules, and ordinal weekdays
// ('1MO' first Monday, '-1FR' last Friday) for MONTHLY and YEARLY rules.

import {
    addDays, daysInMonth, dayOfWeek, diffDays, getWallTime, parseIsoDate, toDayKey, toIsoDate, toPlainDate, wallTimeToDate
} from './time.js';

export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
// Index matches dayOfWeek() (0 = Sunday)
export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// Occurrences generated when the user gives no end ("every Monday")
export const DEFAULT_COUNT = 4;
export const MAX_OCCURRENCES = 500;

const MAX_INTERVAL = 99;
// Upper bound on periods scanned, so rules that rarely match (Feb 29) still terminate
const MAX_PERIODS = 5000;

// Parses 'MO', '1MO', '-1FR' into { ordinal, day } (ordinal 0 = every such weekday)
export function parseByDay(entry) {
    const match = /^([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/.exec(String(entry ?? '').trim().toUpperCase());
    return match ? { ordinal: match[1] ? Number(match[1]) : 0, day: match[2] } : null;
}

// Returns a clean rule, or null when `raw` does not describe a supported rule
export function normalizeRecurrence(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const frequency = String(raw.frequency ?? '').toUpperCase();
    if (!FREQUENCIES.includes(frequency)) return null;

    const rule = { frequency, interval: toInt(raw.interval, 1, MAX_INTERVAL) ?? 1 };
    const byDay = (Array.isArray(raw.byDay) ? raw.byDay : []).map(parseByDay).filter(Boolean);

    if (frequency === 'WEEKLY') {
        const days = [...new Set(byDay.filter(d => d.ordinal === 0).map(d => d.day))];
        if (days.length) rule.byDay = days.sort((a, b) => mondayIndex(a) - mondayIndex(b));
    } else if (frequency === 'MONTHLY' || frequency === 'YEARLY') {
        const monthDays = frequency === 'MONTHLY' && Array.isArray(raw.byMonthDay)
            ? [...new Set(raw.byMonthDay.map(Number))].filter(n => Number.isInteger(n) && n !== 0 && Math.abs(n) <= 31)
            : [];
        const ordinals = [...new Set(byDay.filter(d => d.ordinal !== 0).map(d => `${d.ordinal}${d.day}`))];
        if (monthDays.length) {
            rule.byMonthDay = monthDays.sort((a, b) => a - b);
        } else if (ordinals.length) {
            rule.byDay = ordinals.sort((a, b) => ordinalSortKey(a) - ordinalSortKey(b));
        }
    }

    const until = parseIsoDate(raw.until);
    if (until) {
        rule.until = toIsoDate(until);
    } else {
        rule.count = toInt(raw.count, 1, MAX_OCCURRENCES) ?? DEFAULT_COUNT;
    }
    return rule;
}

function toInt(value, min, max) {
    const n = Number(value);
    if (value === null || value === '' || !Number.isInteger(n) || n < min) return null;
    return Math.min(n, max);
}

// Position in a Monday-first week (RRULE's default week start)
function mondayIndex(day) {
    return (WEEKDAYS.indexOf(day) + 6) % 7;
}

// Sorts first..fifth, then last..fifth-to-last, then by weekday
function ordinalSortKey(entry) {
    const { ordinal, day } = parseByDay(entry);
    return (ordinal > 0 ? ordinal : 10 - ordinal) * 10 + mondayIndex(day);
}

// Plain dates (in the event's time zone) on which the rule's occurrences start,
// beginning on or after `startDate`
export function occurrenceDates(rule, startDate) {
    const dates = [];
    const limit = Math.min(rule.count ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
    const startKey = toDayKey(startDate);
    const untilKey = rule.until ? toDayKey(parseIsoDate(rule.until)) : Infinity;

    for (let period = 0; period < MAX_PERIODS; period++) {
        for (const date of datesInPeriod(rule, startDate, period)) {
            const key = toDayKey(date);
            if (key < startKey) continue;
            if (key > untilKey) return dates;
            dates.push(date);
            if (dates.length >= limit) return dates;
        }
    }
    return dates;
}

function datesInPeriod(rule, start, period) {
    const step = period * rule.interval;
    switch (rule.frequency) {
        case 'DAILY':
            return [addDays(start, step)];
        case 'WEEKLY': {
            const weekStart = addDays(start, -mondayIndex(WEEKDAYS[dayOfWeek(start)]) + step * 7);
            const days = rule.byDay ?? [WEEKDAYS[dayOfWeek(start)]];
            return days.map(day => addDays(weekStart, mondayIndex(day)));
        }
        case 'MONTHLY': {
            const total = start.year * 12 + (start.month - 1) + step;
            const year = Math.floor(total / 12);
            const month = total - year * 12 + 1;
            return datesInMonth(rule, year, month, start.day);
        }
        case 'YEARLY':
            return datesInMonth(rule, start.year + step, start.month, start.day);
        default:
            return [];
    }
}

// Matching dates within one month, in order. Without byDay/byMonthDay the
// start's day of month is used, and months without that day are skipped, as RRULE does.
function datesInMonth(rule, year, month, startDay) {
    const length = daysInMonth(year, month);
    let days;
    if (rule.byMonthDay) {
        days = rule.byMonthDay.map(n => (n > 0 ? n : length + n + 1));
    } else if (rule.byDay) {
        days = rule.byDay.map(entry => nthWeekday(year, month, parseByDay(entry)));
    } else {
        days = [startDay];
    }
    return [...new Set(days)]
        .filter(day => day >= 1 && day <= length)
        .sort((a, b) => a - b)
        .map(day => ({ year, month, day }));
}

// Day of month of e.g. the 2nd Tuesday (ordinal 2) or last Friday (ordinal -1); may fall outside the month
function nthWeekday(year, month, { ordinal, day }) {
    const target = WEEKDAYS.indexOf(day);
    if (ordinal > 0) {
        const first = 1 + ((target - dayOfWeek({ year, month, day: 1 }) + 7) % 7);
        return first + (ordinal - 1) * 7;
    }
    const length = daysInMonth(year, month);
    const last = length - ((dayOfWeek({ year, month, day: length }) - target + 7) % 7);
    return last + (ordinal + 1) * 7;
}

// Date of the first occurrence on or after `startDate`, or null if the rule has none
export function firstOccurrenceDate(rule, startDate) {
    return occurrenceDates({ ...rule, count: 1 }, startDate)[0] ?? null;
}

// Plain date the event (or series) starts on, in its own time zone
export function eventStartDate(event) {
    return event.allDay ? parseIsoDate(event.startDate) : toPlainDate(getWallTime(event.start, event.timeZone));
}

// Dates of every occurrence before exclusions and overrides ("YYYY-MM-DD")
export function seriesDates(event) {
    const start = eventStartDate(event);
    const dates = event.recurrence ? occurrenceDates(event.recurrence, start) : [start];
    return dates.map(toIsoDate);
}

// Every occurrence of an event, without excluded dates, with single-occurrence
// overrides applied. Each occurrence is:
//   { date, allDay, start, end, startDate, endDate, title, location, description, reminders, isOverride }
// `date` is the occurrence's original date ("YYYY-MM-DD", in the event's time
// zone), which identifies it even after an override moves it.
// Timed occurrences keep the event's wall-clock time in its own time zone, so
// a "7pm every Monday" event stays at 7pm across daylight saving changes.
export function expandEvent(event) {
    if (!event.recurrence) return [buildOccurrence(event, eventStartDate(event), null)];

    const excluded = new Set(event.exdates ?? []);
    return seriesDates(event)
        .filter(date => !excluded.has(date))
        .map(date => buildOccurrence(event, parseIsoDate(date), event.overrides?.[date] ?? null));
}

// The occurrence on an original date, or null if the series has none there
export function occurrenceOn(event, date, { applyOverride = true } = {}) {
    if (!seriesDates(event).includes(date) || (event.exdates ?? []).includes(date)) return null;
    return buildOccurrence(event, parseIsoDate(date), applyOverride ? event.overrides?.[date] ?? null : null);
}

function buildOccurrence(event, date, override) {
    const occurrence = {
        date: toIsoDate(date),
        allDay: !!event.allDay,
        start: null,
        end: null,
        startDate: null,
        endDate: null,
        title: override?.title ?? event.title,
        location: override?.location ?? event.location ?? '',
        description: override?.description ?? event.description ?? '',
        reminders: override?.reminders ?? event.reminders ?? [],
        isOverride: !!override
    };

    if (event.allDay) {
        const span = diffDays(parseIsoDate(event.startDate), parseIsoDate(event.endDate));
        occurrence.startDate = override?.startDate ?? occurrence.date;
        occurrence.endDate = override?.endDate ?? toIsoDate(addDays(parseIsoDate(occurrence.startDate), span));
        if (occurrence.endDate < occurrence.startDate) occurrence.endDate = occurrence.startDate;
        return occurrence;
    }

    const duration = event.end.getTime() - event.start.getTime();
    const wall = getWallTime(event.start, event.timeZone);
    const seriesStart = event.recurrence
        ? wallTimeToDate({ ...date, hour: wall.hour, minute: wall.minute, second: wall.second }, event.timeZone)
        : event.start;
    occurrence.start = override?.start ?? seriesStart;
    occurrence.end = override?.end ?? new Date(occurrence.start.getTime() + duration);
    if (occurrence.end <= occurrence.start) occurrence.end = new Date(occurrence.start.getTime() + duration);
    return occurrence;
}
