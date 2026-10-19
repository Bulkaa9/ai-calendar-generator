// Generate ICS (iCalendar, RFC 5545) file content
//
// Timed events are written in their own time zone (DTSTART;TZID=...), with a
// VTIMEZONE block describing that zone's UTC offsets over the exported range.
// All-day events use dates (DTSTART;VALUE=DATE). Recurring events are written
// once with an RRULE and EXDATEs; each edited occurrence gets its own VEVENT
// with the same UID and a RECURRENCE-ID. Reminders become VALARMs.

import { reminderTrigger } from './reminders.js';
import { eventStartDate, expandEvent } from './recurrence.js';
import { addDaysIso, getOffsetMs, getWallTime, parseIsoDate, wallTimeToDate } from './time.js';

const UTC_ZONES = new Set(['UTC', 'Etc/UTC']);
const DAY_MS = 24 * 60 * 60 * 1000;

export function generateICS(events, { now = new Date() } = {}) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//AI Calendar Generator//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:My Calendar'
    ];

    for (const [timeZone, range] of zoneRanges(events)) {
        lines.push(...buildTimeZone(timeZone, range.from, range.to));
    }
    for (const event of events) {
        lines.push(...buildEvent(event, now));
        for (const occurrence of expandEvent(event).filter(o => o.isOverride)) {
            lines.push(...buildOverride(event, occurrence, now));
        }
    }

    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
}

// Earliest and latest instant each (non-UTC) time zone of a timed event needs to cover
function zoneRanges(events) {
    const ranges = new Map();
    for (const event of events) {
        if (event.allDay || UTC_ZONES.has(event.timeZone)) continue;
        const occurrences = expandEvent(event);
        const from = Math.min(event.start.getTime(), ...occurrences.map(o => o.start.getTime()));
        const to = Math.max(event.end.getTime(), ...occurrences.map(o => o.end.getTime()));
        const range = ranges.get(event.timeZone);
        ranges.set(event.timeZone, range
            ? { from: Math.min(range.from, from), to: Math.max(range.to, to) }
            : { from, to });
    }
    return ranges;
}

function buildEvent(event, now) {
    const lines = [
        'BEGIN:VEVENT',
        `UID:${event.id}@ai-calendar-generator`,
        `DTSTAMP:${formatUtc(now)}`,
        ...timeProperties(event, event)
    ];

    if (event.recurrence) {
        lines.push(`RRULE:${formatRule(event)}`);
        if (event.exdates?.length) {
            lines.push(dateListProperty('EXDATE', event, event.exdates));
        }
    }

    lines.push(...detailProperties(event));
    lines.push('STATUS:CONFIRMED', 'SEQUENCE:0', 'TRANSP:OPAQUE');
    lines.push(...alarms(event.reminders, event.title));
    lines.push('END:VEVENT');
    return lines;
}

// A single edited occurrence of a recurring event
function buildOverride(event, occurrence, now) {
    return [
        'BEGIN:VEVENT',
        `UID:${event.id}@ai-calendar-generator`,
        `DTSTAMP:${formatUtc(now)}`,
        dateListProperty('RECURRENCE-ID', event, [occurrence.date]),
        ...timeProperties(event, occurrence),
        ...detailProperties(occurrence),
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        'TRANSP:OPAQUE',
        ...alarms(occurrence.reminders, occurrence.title),
        'END:VEVENT'
    ];
}

// DTSTART/DTEND of an event or occurrence. All-day DTEND is exclusive.
function timeProperties(event, source) {
    if (event.allDay) {
        return [
            `DTSTART;VALUE=DATE:${formatDate(source.startDate)}`,
            `DTEND;VALUE=DATE:${formatDate(addDaysIso(source.endDate, 1))}`
        ];
    }
    return [instantProperty('DTSTART', source.start, event.timeZone), instantProperty('DTEND', source.end, event.timeZone)];
}

function detailProperties(source) {
    const lines = [`SUMMARY:${escapeText(source.title)}`];
    if (source.location) lines.push(`LOCATION:${escapeText(source.location)}`);
    if (source.description) lines.push(`DESCRIPTION:${escapeText(source.description)}`);
    return lines;
}

function alarms(reminders, title) {
    return (reminders ?? []).flatMap(minutes => [
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(title)}`,
        `TRIGGER:${reminderTrigger(minutes)}`,
        'END:VALARM'
    ]);
}

// e.g. "DTSTART;TZID=Europe/Paris:20261019T140000" or "DTSTART:20261019T120000Z"
function instantProperty(name, date, timeZone) {
    if (UTC_ZONES.has(timeZone)) return `${name}:${formatUtc(date)}`;
    return `${name};TZID=${timeZone}:${formatWall(getWallTime(date, timeZone))}`;
}

// EXDATE / RECURRENCE-ID for occurrence dates, at the series' start time
function dateListProperty(name, event, dates) {
    if (event.allDay) return `${name};VALUE=DATE:${dates.map(formatDate).join(',')}`;
    const { hour, minute, second } = getWallTime(event.start, event.timeZone);
    const instants = dates.map(date => wallTimeToDate({ ...parseIsoDate(date), hour, minute, second }, event.timeZone));
    if (UTC_ZONES.has(event.timeZone)) return `${name}:${instants.map(formatUtc).join(',')}`;
    return `${name};TZID=${event.timeZone}:${instants.map(date => formatWall(getWallTime(date, event.timeZone))).join(',')}`;
}

function formatRule(event) {
    const rule = event.recurrence;
    const parts = [`FREQ=${rule.frequency}`];
    if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
    if (rule.frequency === 'YEARLY' && rule.byDay?.length) parts.push(`BYMONTH=${eventStartDate(event).month}`);
    if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(',')}`);
    if (rule.byMonthDay?.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
    if (rule.until) {
        if (event.allDay) {
            // With a date DTSTART, UNTIL is a date too
            parts.push(`UNTIL=${formatDate(rule.until)}`);
        } else {
            // UNTIL is inclusive and must be in UTC when DTSTART has a TZID
            const endOfDay = wallTimeToDate({ ...parseIsoDate(rule.until), hour: 23, minute: 59, second: 59 }, event.timeZone);
            parts.push(`UNTIL=${formatUtc(endOfDay)}`);
        }
    } else if (rule.count) {
        parts.push(`COUNT=${rule.count}`);
    }
    return parts.join(';');
}

// VTIMEZONE listing every UTC offset change between the start of the first
// year and the end of the last year the events touch
function buildTimeZone(timeZone, fromMs, toMs) {
    const rangeStart = Date.UTC(new Date(fromMs).getUTCFullYear(), 0, 1);
    const rangeEnd = Date.UTC(new Date(toMs).getUTCFullYear() + 1, 0, 1);
    const transitions = findTransitions(timeZone, rangeStart, rangeEnd);
    const initialOffset = getOffsetMs(new Date(rangeStart), timeZone);
    const standardOffset = Math.min(initialOffset, ...transitions.map(t => t.offsetTo));

    const lines = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`];
    lines.push(...observance('STANDARD', rangeStart, initialOffset, initialOffset));
    for (const { time, offsetFrom, offsetTo } of transitions) {
        const kind = offsetTo > standardOffset ? 'DAYLIGHT' : 'STANDARD';
        lines.push(...observance(kind, time, offsetFrom, offsetTo));
    }
    lines.push('END:VTIMEZONE');
    return lines;
}

function observance(kind, time, offsetFrom, offsetTo) {
    return [
        `BEGIN:${kind}`,
        // Local time of the change, as read on clocks before it
        `DTSTART:${formatWall(getWallTime(new Date(time + offsetFrom), 'UTC'))}`,
        `TZOFFSETFROM:${formatOffset(offsetFrom)}`,
        `TZOFFSETTO:${formatOffset(offsetTo)}`,
        `END:${kind}`
    ];
}

// Scans day by day, then narrows each change down to the minute
function findTransitions(timeZone, fromMs, toMs) {
    const transitions = [];
    let previous = getOffsetMs(new Date(fromMs), timeZone);
    for (let time = fromMs + DAY_MS; time <= toMs; time += DAY_MS) {
        const offset = getOffsetMs(new Date(time), timeZone);
        if (offset === previous) continue;

        let low = time - DAY_MS;
        let high = time;
        while (high - low > 60 * 1000) {
            const mid = low + Math.floor((high - low) / 2 / 60000) * 60000;
            if (getOffsetMs(new Date(mid), timeZone) === previous) low = mid;
            else high = mid;
        }
        transitions.push({ time: high, offsetFrom: previous, offsetTo: offset });
        previous = offset;
    }
    return transitions;
}

const pad = (n) => String(n).padStart(2, '0');

function formatWall({ year, month, day, hour, minute, second }) {
    return `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(minute)}${pad(second)}`;
}

// "YYYY-MM-DD" → "YYYYMMDD"
function formatDate(isoDate) {
    return isoDate.replace(/-/g, '');
}

function formatUtc(date) {
    return `${formatWall(getWallTime(date, 'UTC'))}Z`;
}

function formatOffset(offsetMs) {
    const totalMinutes = Math.round(Math.abs(offsetMs) / 60000);
    return `${offsetMs < 0 ? '-' : '+'}${pad(Math.floor(totalMinutes / 60))}${pad(totalMinutes % 60)}`;
}

// Escape special characters for ICS TEXT values
function escapeText(text) {
    return String(text ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n');
}

// Lines longer than 75 octets are split, continuing with a leading space
const encoder = new TextEncoder();
function foldLine(line) {
    if (encoder.encode(line).length <= 75) return line;
    const chunks = [];
    let chunk = '';
    let size = 0;
    for (const char of line) {
        const charSize = encoder.encode(char).length;
        const limit = chunks.length === 0 ? 75 : 74;
        if (size + charSize > limit) {
            chunks.push(chunk);
            chunk = '';
            size = 0;
        }
        chunk += char;
        size += charSize;
    }
    chunks.push(chunk);
    return chunks.join('\r\n ');
}
