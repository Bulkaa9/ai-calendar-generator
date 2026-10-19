// Time zone and calendar-date helpers.
//
// Three kinds of values are used across the app:
// - Instants: plain Date objects (a single moment, independent of time zone).
// - Wall times: { year, month, day, hour, minute, second } as read off a clock
//   in a given IANA time zone. `month` is 1-12.
// - Plain dates: { year, month, day } with no time zone attached.

const formatterCache = new Map();

function getFormatter(timeZone) {
    let formatter = formatterCache.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        });
        formatterCache.set(timeZone, formatter);
    }
    return formatter;
}

export function isValidTimeZone(timeZone) {
    if (typeof timeZone !== 'string' || !timeZone) return false;
    try {
        getFormatter(timeZone);
        return true;
    } catch {
        return false;
    }
}

export function getBrowserTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// Wall time of an instant in the given time zone
export function getWallTime(date, timeZone) {
    const parts = {};
    for (const { type, value } of getFormatter(timeZone).formatToParts(date)) {
        if (type !== 'literal') parts[type] = Number(value);
    }
    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour === 24 ? 0 : parts.hour,
        minute: parts.minute,
        second: parts.second
    };
}

// Milliseconds the time zone is ahead of UTC at the given instant
export function getOffsetMs(date, timeZone) {
    const wall = getWallTime(date, timeZone);
    const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    return wallAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Instant at which clocks in the time zone show the given wall time.
// Ambiguous times (clocks falling back) resolve to the earlier instant;
// times skipped by clocks springing forward move forward by the gap.
export function wallTimeToDate(wall, timeZone) {
    const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour ?? 0, wall.minute ?? 0, wall.second ?? 0);
    const day = 24 * 60 * 60 * 1000;
    const offsetBefore = getOffsetMs(new Date(wallAsUtc - day), timeZone);
    const offsetAfter = getOffsetMs(new Date(wallAsUtc + day), timeZone);

    const candidates = [wallAsUtc - offsetBefore, wallAsUtc - offsetAfter].sort((a, b) => a - b);
    const exact = candidates.find(time => isSameWallTime(getWallTime(new Date(time), timeZone), wall));
    return new Date(exact ?? wallAsUtc - offsetBefore);
}

function isSameWallTime(a, b) {
    return a.year === b.year && a.month === b.month && a.day === b.day &&
        a.hour === (b.hour ?? 0) && a.minute === (b.minute ?? 0) && a.second === (b.second ?? 0);
}

// Parses "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss" into a wall time, or null
export function parseWallTime(text) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(typeof text === 'string' ? text.trim() : '');
    if (!match) return null;
    const [year, month, day, hour, minute, second = 0] = match.slice(1).map(value => Number(value ?? 0));
    if (!isValidDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
    return { year, month, day, hour, minute, second };
}

// Parses "HH:mm" into { hour, minute }, or null
export function parseTime(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(typeof text === 'string' ? text.trim() : '');
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

// "HH:mm", the format used by <input type="time">
export function formatTime24({ hour, minute }) {
    return `${pad(hour)}:${pad(minute)}`;
}

// Parses "YYYY-MM-DD" into a plain date, or null
export function parseIsoDate(text) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof text === 'string' ? text.trim() : '');
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    return isValidDate(year, month, day) ? { year, month, day } : null;
}

function isValidDate(year, month, day) {
    return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

// "YYYY-MM-DD"
export function toIsoDate({ year, month, day }) {
    return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

// "YYYY-MM-DDTHH:mm", the format used by <input type="datetime-local">
export function formatWallTime(wall) {
    return `${toIsoDate(wall)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

// --- Plain date arithmetic ---

export function toPlainDate({ year, month, day }) {
    return { year, month, day };
}

// Sortable number such as 20261019
export function toDayKey({ year, month, day }) {
    return year * 10000 + month * 100 + day;
}

export function fromDayKey(key) {
    return { year: Math.floor(key / 10000), month: Math.floor(key / 100) % 100, day: key % 100 };
}

export function dayKeyOf(date, timeZone) {
    return toDayKey(getWallTime(date, timeZone));
}

export function todayIn(timeZone) {
    return toPlainDate(getWallTime(new Date(), timeZone));
}

export function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// addDays for "YYYY-MM-DD" strings
export function addDaysIso(isoDate, days) {
    return toIsoDate(addDays(parseIsoDate(isoDate), days));
}

export function addDays({ year, month, day }, days) {
    const d = new Date(Date.UTC(year, month - 1, day + days));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// Adds months, clamping the day to the target month's length (Jan 31 + 1 month = Feb 28)
export function addMonths({ year, month, day }, months) {
    const total = year * 12 + (month - 1) + months;
    const targetYear = Math.floor(total / 12);
    const targetMonth = total - targetYear * 12 + 1;
    return { year: targetYear, month: targetMonth, day: Math.min(day, daysInMonth(targetYear, targetMonth)) };
}

// Whole days from `from` to `to`
export function diffDays(from, to) {
    const ms = Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day);
    return Math.round(ms / (24 * 60 * 60 * 1000));
}

// 0 = Sunday ... 6 = Saturday
export function dayOfWeek({ year, month, day }) {
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
