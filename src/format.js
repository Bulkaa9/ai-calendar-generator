// Text formatting helpers for the UI

import { parseByDay } from './recurrence.js';
import { formatReminder } from './reminders.js';
import { dayKeyOf, getWallTime, parseIsoDate } from './time.js';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Safe for both element content and quoted attribute values
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

export function formatTime(date, timeZone, use24Hour) {
    const { hour, minute } = getWallTime(date, timeZone);
    const minutes = String(minute).padStart(2, '0');
    if (use24Hour) return `${String(hour).padStart(2, '0')}:${minutes}`;
    return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function formatHourLabel(hour, use24Hour) {
    if (use24Hour) return `${String(hour).padStart(2, '0')}:00`;
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

// e.g. "Mon, Oct 19, 2026" for an instant, as seen in the time zone
export function formatDate(date, timeZone) {
    return date.toLocaleDateString('en-US', { timeZone, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

// Formats a plain date ({ year, month, day }) with toLocaleDateString options
export function formatCalendarDate({ year, month, day }, options) {
    return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}

// e.g. "Thu, Dec 24, 2026" for a "YYYY-MM-DD" string
export function formatIsoDate(isoDate) {
    return formatCalendarDate(parseIsoDate(isoDate), { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

// When an occurrence happens, e.g. "Mon, Oct 19, 2026 • 7:00 PM - 8:00 PM"
// or "Sat, Aug 1, 2027 → Sun, Aug 15, 2027 • All day"
export function formatWhen(occurrence, timeZone, use24Hour) {
    if (occurrence.allDay) {
        const { startDate, endDate } = occurrence;
        return startDate === endDate
            ? `${formatIsoDate(startDate)} • All day`
            : `${formatIsoDate(startDate)} → ${formatIsoDate(endDate)} • All day`;
    }
    const { start, end } = occurrence;
    const startTime = formatTime(start, timeZone, use24Hour);
    const endTime = formatTime(end, timeZone, use24Hour);
    if (dayKeyOf(start, timeZone) === dayKeyOf(new Date(end.getTime() - 1), timeZone)) {
        return `${formatDate(start, timeZone)} • ${startTime} - ${endTime}`;
    }
    return `${formatDate(start, timeZone)} ${startTime} → ${formatDate(end, timeZone)} ${endTime}`;
}

export function formatReminders(reminders) {
    return reminders.map(formatReminder).join(', ');
}

const DAY_NAMES = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' };
const ORDINAL_WORDS = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last', '-2': 'second-to-last', '-3': 'third-to-last', '-4': 'fourth-to-last', '-5': 'fifth-to-last' };
const FREQUENCY_LABELS = {
    DAILY: ['Daily', 'days'],
    WEEKLY: ['Weekly', 'weeks'],
    MONTHLY: ['Monthly', 'months'],
    YEARLY: ['Yearly', 'years']
};
const WORKWEEK = ['MO', 'TU', 'WE', 'TH', 'FR'];

// e.g. "Weekly on Mon, Wed, until Mar 31, 2027", "Every weekday, 10 times",
// "Monthly on the last Friday", "Yearly on the fourth Thursday of November".
// `startMonth` (1-12) names the month for yearly weekday rules.
export function describeRecurrence(rule, { startMonth } = {}) {
    const [label, unit] = FREQUENCY_LABELS[rule.frequency];
    let text = rule.interval > 1 ? `Every ${rule.interval} ${unit}` : label;

    if (rule.frequency === 'WEEKLY' && rule.byDay?.length) {
        if (rule.interval === 1 && rule.byDay.join() === WORKWEEK.join()) text = 'Every weekday';
        else text += ` on ${rule.byDay.map(day => DAY_NAMES[day].slice(0, 3)).join(', ')}`;
    } else if (rule.byMonthDay?.length) {
        text += ` on the ${joinWords(rule.byMonthDay.map(monthDayWord))}`;
    } else if (rule.byDay?.length) {
        const days = rule.byDay.map(parseByDay).map(({ ordinal, day }) => `${ORDINAL_WORDS[ordinal]} ${DAY_NAMES[day]}`);
        text += ` on the ${joinWords(days)}`;
        if (rule.frequency === 'YEARLY' && startMonth) {
            text += ` of ${formatCalendarDate({ year: 2000, month: startMonth, day: 1 }, { month: 'long' })}`;
        }
    }

    if (rule.until) {
        text += `, until ${formatCalendarDate(parseIsoDate(rule.until), { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (rule.count) {
        text += `, ${rule.count} ${rule.count === 1 ? 'time' : 'times'}`;
    }
    return text;
}

function monthDayWord(n) {
    if (n === -1) return 'last day';
    if (n < 0) return `${ordinalNumber(-n)}-to-last day`;
    return ordinalNumber(n);
}

function ordinalNumber(n) {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
    return `${n}${suffix}`;
}

function joinWords(words) {
    return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}
