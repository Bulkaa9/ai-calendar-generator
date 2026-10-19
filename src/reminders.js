// Reminders are stored as minutes before the event starts (0 = at start time).
// For all-day events they count back from midnight at the start of the day.

export const MAX_REMINDERS = 5;
const MAX_MINUTES = 4 * 7 * 24 * 60;

// Choices offered in the editor
export const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];

export function normalizeReminders(raw) {
    const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const minutes = list
        // Number(null), Number('') and Number(false) are 0, which would mean "at start time"
        .filter(value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
        .map(Number)
        .filter(n => Number.isInteger(n) && n >= 0 && n <= MAX_MINUTES);
    return [...new Set(minutes)].sort((a, b) => a - b).slice(0, MAX_REMINDERS);
}

// e.g. "At start time", "30 min before", "1 hour before", "2 days before", "1 day 2 hours before"
export function formatReminder(minutes) {
    if (minutes === 0) return 'At start time';
    const parts = [];
    const weeks = Math.floor(minutes / 10080);
    const days = Math.floor((minutes % 10080) / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (weeks) parts.push(`${weeks} ${weeks === 1 ? 'week' : 'weeks'}`);
    if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
    if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    if (mins) parts.push(`${mins} min`);
    return `${parts.join(' ')} before`;
}

// iCalendar duration for a VALARM trigger, e.g. -PT30M, -P1DT2H, PT0M
export function reminderTrigger(minutes) {
    if (minutes === 0) return 'PT0M';
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    let duration = '-P';
    if (days) duration += `${days}D`;
    if (hours || mins) duration += 'T';
    if (hours) duration += `${hours}H`;
    if (mins) duration += `${mins}M`;
    return duration;
}
