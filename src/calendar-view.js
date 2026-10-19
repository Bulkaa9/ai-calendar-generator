// HTML for the calendar views. Every function receives display items:
//   { event, occurrence, allDay, title, start, end, firstDay, lastDay }
// (see displayOccurrences() in app.js) and returns a string of markup.
// Clickable parts carry data-action attributes handled in app.js.

import { escapeHtml, formatCalendarDate, formatHourLabel, formatTime } from './format.js';
import { addDays, dayKeyOf, dayOfWeek, fromDayKey, getWallTime, toDayKey } from './time.js';
import { eventColorStyle, icon } from './ui.js';

const MINUTES_PER_DAY = 24 * 60;
// Short events still get enough height to click and read
const MIN_EVENT_MINUTES = 20;
// Below this length an event shows on one line
const COMPACT_EVENT_MINUTES = 45;
const MAX_MONTH_CHIPS = 3;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Weeks start on Sunday
export function weekStart(date) {
    return addDays(date, -dayOfWeek(date));
}

export function onDay(items, dayKey) {
    return items.filter(item => item.firstDay <= dayKey && dayKey <= item.lastDay);
}

// Day keys covered by any item
export function busyDays(items) {
    const days = new Set();
    for (const item of items) {
        for (let date = fromDayKey(item.firstDay); toDayKey(date) <= item.lastDay; date = addDays(date, 1)) {
            days.add(toDayKey(date));
        }
    }
    return days;
}

function itemAttributes(item, extraStyle = '') {
    return `data-action="open-event" data-event-id="${escapeHtml(item.event.id)}" data-date="${item.occurrence.date}" style="${eventColorStyle(item.event.id)} ${extraStyle}"`;
}

function dayLabel(date) {
    return formatCalendarDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// e.g. "7pm", "7:30pm" or "19:30"
function shortTime(date, timeZone, use24Hour) {
    if (use24Hour) return formatTime(date, timeZone, true);
    const { hour, minute } = getWallTime(date, timeZone);
    return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${hour >= 12 ? 'pm' : 'am'}`;
}

// e.g. "GMT+2"
function zoneLabel(timeZone) {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date())
        .find(p => p.type === 'timeZoneName');
    return part ? part.value : timeZone;
}

// --- Day and week: time grid ---

// `ctx` is { items, timeZone, use24Hour, todayKey, now }
export function renderTimeGrid(ctx, days) {
    const { items, timeZone, use24Hour, todayKey } = ctx;
    const columns = `grid-template-columns: var(--gutter) repeat(${days.length}, minmax(0, 1fr));`;
    const minWidth = days.length > 1 ? '--min-width: 720px;' : '';
    const keys = days.map(toDayKey);
    const allDayByDay = keys.map(key => onDay(items, key).filter(item => item.allDay));

    let html = `<div class="time-grid" style="${minWidth}">`;

    html += `<div class="tg-head" style="${columns}"><div class="tg-zone">${escapeHtml(zoneLabel(timeZone))}</div>`;
    days.forEach((date, i) => {
        html += `<div class="tg-day-head${keys[i] === todayKey ? ' today' : ''}">
            <span class="tg-weekday">${WEEKDAY_SHORT[dayOfWeek(date)]}</span>
            <button type="button" class="tg-date" data-action="open-day" data-day="${keys[i]}" aria-label="${escapeHtml(dayLabel(date))}">${date.day}</button>
        </div>`;
    });
    html += '</div>';

    if (allDayByDay.some(list => list.length)) {
        html += `<div class="tg-allday" style="${columns}"><div class="tg-allday-label">All day</div>`;
        for (const list of allDayByDay) {
            html += `<div class="tg-allday-cell">${list.map(item =>
                `<div class="chip" title="${escapeHtml(item.title)}" ${itemAttributes(item)}>${escapeHtml(item.title)}</div>`).join('')}</div>`;
        }
        html += '</div>';
    }

    html += `<div class="tg-scroll" data-scroll style="${minWidth}"><div class="tg-body" style="${columns}">`;
    html += '<div class="tg-hours">';
    for (let hour = 1; hour < 24; hour++) {
        html += `<span class="tg-hour-label" style="top: ${(hour / 24) * 100}%">${formatHourLabel(hour, use24Hour)}</span>`;
    }
    html += '</div>';

    days.forEach((date, i) => {
        const key = keys[i];
        const isToday = key === todayKey;
        html += `<div class="tg-col${isToday ? ' today' : ''}" data-action="create-at" data-day="${key}">`;
        const timed = onDay(items, key).filter(item => !item.allDay);
        for (const placed of layoutDay(timed, key, timeZone)) {
            html += renderTimedEvent(placed, ctx);
        }
        if (isToday) {
            const wall = getWallTime(ctx.now, timeZone);
            html += `<div class="now-line" data-now-line style="top: ${nowPercent(wall)}%"></div>`;
        }
        html += '</div>';
    });

    html += '</div></div></div>';
    return html;
}

export function nowPercent({ hour, minute }) {
    return ((hour * 60 + minute) / MINUTES_PER_DAY) * 100;
}

function renderTimedEvent({ item, top, bottom, column, totalColumns }, { timeZone, use24Hour }) {
    const length = Math.max(bottom - top, MIN_EVENT_MINUTES);
    const startMinute = Math.min(top, MINUTES_PER_DAY - length);
    const width = 100 / totalColumns;
    const compact = bottom - top < COMPACT_EVENT_MINUTES;
    const time = `${formatTime(item.start, timeZone, use24Hour)} – ${formatTime(item.end, timeZone, use24Hour)}`;
    const location = item.occurrence.location;
    const style = `top: ${(startMinute / MINUTES_PER_DAY) * 100}%; height: ${(length / MINUTES_PER_DAY) * 100}%; ` +
        `left: calc(${column * width}% + 2px); width: calc(${width}% - 4px);`;

    return `<div class="tg-event${compact ? ' compact' : ''}" ${itemAttributes(item, style)}
        title="${escapeHtml(`${item.title}, ${time}`)}">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${compact ? escapeHtml(formatTime(item.start, timeZone, use24Hour)) : escapeHtml(time)}</span>
        ${!compact && location ? `<span>${escapeHtml(location)}</span>` : ''}
    </div>`;
}

// Minutes from the start of the day to the instant, clamped to the day
function minutesIntoDay(date, dayKey, timeZone) {
    const key = dayKeyOf(date, timeZone);
    if (key < dayKey) return 0;
    if (key > dayKey) return MINUTES_PER_DAY;
    const { hour, minute } = getWallTime(date, timeZone);
    return hour * 60 + minute;
}

// Places overlapping occurrences side by side. Each group of overlapping
// occurrences shares its column count, so an event that overlaps nothing
// keeps the full width.
function layoutDay(items, dayKey, timeZone) {
    const placed = items
        .map(item => ({ item, top: minutesIntoDay(item.start, dayKey, timeZone), bottom: minutesIntoDay(item.end, dayKey, timeZone) }))
        .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

    let group = [];
    let columnEnds = [];
    let groupEnd = -Infinity;
    const closeGroup = () => {
        for (const entry of group) entry.totalColumns = columnEnds.length;
        group = [];
        columnEnds = [];
    };

    for (const entry of placed) {
        const visualBottom = entry.top + Math.max(entry.bottom - entry.top, MIN_EVENT_MINUTES);
        if (entry.top >= groupEnd) {
            closeGroup();
            groupEnd = -Infinity;
        }
        let column = columnEnds.findIndex(end => end <= entry.top);
        if (column === -1) {
            column = columnEnds.length;
            columnEnds.push(visualBottom);
        } else {
            columnEnds[column] = visualBottom;
        }
        entry.column = column;
        group.push(entry);
        groupEnd = Math.max(groupEnd, visualBottom);
    }
    closeGroup();
    return placed;
}

// --- Month ---

// `ctx` is { items, cursor, timeZone, use24Hour, todayKey }
export function renderMonth(ctx) {
    const { items, cursor, timeZone, use24Hour, todayKey } = ctx;
    const gridStart = weekStart({ year: cursor.year, month: cursor.month, day: 1 });

    let html = '<div class="month">';
    for (const name of WEEKDAY_SHORT) {
        html += `<div class="month-weekday">${name}</div>`;
    }

    for (let i = 0; i < 42; i++) {
        const date = addDays(gridStart, i);
        const key = toDayKey(date);
        const weekday = dayOfWeek(date);
        const dayItems = onDay(items, key);
        const visible = dayItems.length > MAX_MONTH_CHIPS ? dayItems.slice(0, MAX_MONTH_CHIPS - 1) : dayItems;

        let classes = 'month-cell';
        if (key === todayKey) classes += ' today';
        if (date.month !== cursor.month) classes += ' other-month';

        html += `<div class="${classes}" data-action="open-day" data-day="${key}">`;
        html += `<button type="button" class="day-number" data-action="open-day" data-day="${key}" aria-label="${escapeHtml(dayLabel(date))}">${date.day}</button>`;

        for (const item of visible) {
            const title = escapeHtml(item.title);
            if (item.allDay || item.firstDay !== item.lastDay) {
                // A bar that visually joins across the days it covers, labelled at its start and on each new week
                const before = item.firstDay < key && weekday !== 0;
                const after = item.lastDay > key && weekday !== 6;
                const label = item.firstDay === key || weekday === 0 ? title : '&nbsp;';
                const classNames = `chip${before ? ' continues-before' : ''}${after ? ' continues-after' : ''}`;
                html += `<div class="${classNames}" title="${title}" ${itemAttributes(item)}>${label}</div>`;
            } else {
                html += `<div class="chip-timed" title="${title}" ${itemAttributes(item)}>
                    <span class="event-dot"></span>
                    <span class="chip-time">${shortTime(item.start, timeZone, use24Hour)}</span>
                    <span class="chip-title">${title}</span>
                </div>`;
            }
        }

        if (dayItems.length > visible.length) {
            html += `<button type="button" class="more-link" data-action="open-day" data-day="${key}">${dayItems.length - visible.length} more</button>`;
        }
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// --- Year ---

// `ctx` is { items, cursor, todayKey }
export function renderYear(ctx) {
    const { cursor, todayKey } = ctx;
    const busy = busyDays(ctx.items);

    let html = '<div class="year">';
    for (let month = 1; month <= 12; month++) {
        const first = { year: cursor.year, month, day: 1 };
        html += '<section>';
        html += `<button type="button" class="year-month-name" data-action="open-month" data-year="${cursor.year}" data-month="${month}">${formatCalendarDate(first, { month: 'long' })}</button>`;
        html += '<div class="year-grid">';
        for (const name of WEEKDAY_SHORT) html += `<span class="mini-weekday">${name[0]}</span>`;
        for (let i = 0; i < dayOfWeek(first); i++) html += '<span></span>';
        for (let date = first; date.month === month; date = addDays(date, 1)) {
            const key = toDayKey(date);
            let classes = 'year-day';
            if (busy.has(key)) classes += ' busy';
            if (key === todayKey) classes += ' today';
            html += `<button type="button" class="${classes}" data-action="open-day" data-day="${key}" aria-label="${escapeHtml(dayLabel(date))}">${date.day}</button>`;
        }
        html += '</div></section>';
    }
    html += '</div>';
    return html;
}

// --- Mini month (sidebar) ---

// `month` is { year, month }; `selectedKey` is the calendar's current day
export function renderMiniMonth({ month, selectedKey, todayKey, busy }) {
    const first = { year: month.year, month: month.month, day: 1 };
    const gridStart = weekStart(first);

    let html = `<div class="mini-month-header">
        <span class="mini-month-title">${formatCalendarDate(first, { month: 'long', year: 'numeric' })}</span>
        <span>
            <button type="button" class="icon-btn icon-btn-sm" data-action="mini-prev" aria-label="Previous month">${icon('chevron-left')}</button>
            <button type="button" class="icon-btn icon-btn-sm" data-action="mini-next" aria-label="Next month">${icon('chevron-right')}</button>
        </span>
    </div><div class="mini-month-grid">`;
    for (const name of WEEKDAY_SHORT) html += `<span class="mini-weekday">${name[0]}</span>`;
    for (let i = 0; i < 42; i++) {
        const date = addDays(gridStart, i);
        const key = toDayKey(date);
        let classes = 'mini-day';
        if (date.month !== month.month) classes += ' other-month';
        if (key === selectedKey) classes += ' selected';
        if (key === todayKey) classes += ' today';
        if (busy.has(key)) classes += ' busy';
        html += `<button type="button" class="${classes}" data-action="mini-day" data-day="${key}" aria-label="${escapeHtml(dayLabel(date))}">${date.day}</button>`;
    }
    html += '</div>';
    return html;
}
