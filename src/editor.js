// Event editor: renders a draft (see events.js) as form fields, and reads it back.
// Several editors can be on the page at once (manual form, preview cards); each
// one is a container element holding fields marked with data-field attributes.

import { describeRecurrence, escapeHtml } from './format.js';
import { icon } from './ui.js';
import { formatReminder, REMINDER_PRESETS } from './reminders.js';
import { DEFAULT_COUNT, normalizeRecurrence, parseByDay, WEEKDAYS } from './recurrence.js';
import { dayOfWeek, daysInMonth, parseIsoDate, parseTime } from './time.js';

const MONDAY_FIRST = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const DAY_LABELS = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
const DAY_NAMES = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' };
const ORDINAL_CHOICES = [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [-1, 'Last']];
const FREQUENCY_CHOICES = [['DAILY', 'Daily'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly'], ['YEARLY', 'Yearly']];
const INTERVAL_UNITS = { DAILY: 'day(s)', WEEKLY: 'week(s)', MONTHLY: 'month(s)', YEARLY: 'year(s)' };

let editorCount = 0;

// `mode` is 'event' (all fields) or 'occurrence' (one occurrence of a series:
// no repeat, all-day or time zone fields)
export function renderEditor(draft, { mode = 'event', timeZones = [] } = {}) {
    editorCount += 1;
    const prefix = `editor${editorCount}`;
    const id = (field) => `${prefix}-${field}`;
    const isEvent = mode === 'event';
    const timedStyle = draft.allDay ? ' style="display: none;"' : '';

    let html = `<div class="event-editor" data-editor data-mode="${mode}" data-all-day="${draft.allDay}"
        data-time-zone="${escapeHtml(draft.timeZone)}" data-prev-start="${escapeHtml(`${draft.startDate}T${draft.startTime}`)}">`;

    html += `<div class="form-group editor-title">
        <label class="visually-hidden" for="${id('title')}">Title</label>
        <input type="text" id="${id('title')}" data-field="title" value="${escapeHtml(draft.title)}" placeholder="Add title" autocomplete="off">
    </div>`;

    if (isEvent) {
        html += `<label class="switch"><input type="checkbox" data-field="allDay"${draft.allDay ? ' checked' : ''}><span class="switch-track" aria-hidden="true"></span>All day</label>`;
    }

    html += '<div class="form-row">';
    html += field(id('startDate'), 'Starts', `<input type="date" id="${id('startDate')}" data-field="startDate" value="${escapeHtml(draft.startDate)}">`);
    html += field(id('startTime'), 'Start time', `<input type="time" id="${id('startTime')}" data-field="startTime" value="${escapeHtml(draft.startTime)}">`, `data-timed${timedStyle}`);
    html += '</div><div class="form-row">';
    html += field(id('endDate'), 'Ends', `<input type="date" id="${id('endDate')}" data-field="endDate" value="${escapeHtml(draft.endDate)}">`);
    html += field(id('endTime'), 'End time', `<input type="time" id="${id('endTime')}" data-field="endTime" value="${escapeHtml(draft.endTime)}">`, `data-timed${timedStyle}`);
    html += '</div>';

    if (isEvent) {
        const zones = [...new Set([draft.timeZone, ...timeZones])];
        const options = zones.map(zone =>
            `<option value="${escapeHtml(zone)}"${zone === draft.timeZone ? ' selected' : ''}>${escapeHtml(zone.replace(/_/g, ' '))}</option>`).join('');
        html += field(id('timeZone'), 'Time zone', `<select id="${id('timeZone')}" data-field="timeZone">${options}</select>`, `data-timed${timedStyle}`);
        html += renderRepeat(draft, id);
    }

    html += renderReminders(draft.reminders);
    html += field(id('location'), 'Location', `<input type="text" id="${id('location')}" data-field="location" value="${escapeHtml(draft.location)}" placeholder="Add location">`);
    html += field(id('description'), 'Description', `<textarea id="${id('description')}" data-field="description" rows="3" placeholder="Add description">${escapeHtml(draft.description)}</textarea>`);
    html += '<p class="editor-errors" data-role="errors" role="alert" style="display: none;"></p>';
    html += '</div>';
    return html;
}

function field(id, label, control, attributes = '') {
    return `<div class="form-group" ${attributes}><label for="${id}">${label}</label>${control}</div>`;
}

function sectionTitle(iconName, text) {
    return `<div class="editor-section-title">${icon(iconName)}${text}</div>`;
}

// --- Repeat section ---

// Editor state for a rule, or null when the editor cannot show it (it is then
// offered as a "Custom" choice and kept unchanged)
function repeatState(rule, startDate) {
    const start = parseIsoDate(startDate) ?? { year: 2000, month: 1, day: 1 };
    const startDay = WEEKDAYS[dayOfWeek(start)];
    const startOrdinal = start.day + 7 > daysInMonth(start.year, start.month) ? -1 : Math.ceil(start.day / 7);
    const state = {
        frequency: '',
        interval: 1,
        endMode: 'count',
        count: DEFAULT_COUNT,
        until: '',
        weekdays: [startDay],
        monthMode: 'date',
        monthDays: String(start.day),
        ordinals: [Math.min(startOrdinal, 4) === startOrdinal ? startOrdinal : -1],
        ordinalDay: startDay
    };
    if (!rule) return state;

    Object.assign(state, {
        frequency: rule.frequency,
        interval: rule.interval,
        endMode: rule.until ? 'until' : 'count',
        count: rule.count ?? DEFAULT_COUNT,
        until: rule.until ?? ''
    });
    if (rule.frequency === 'WEEKLY' && rule.byDay) state.weekdays = rule.byDay;
    if (rule.byMonthDay) {
        if (rule.byMonthDay.some(n => n < -1)) return null;
        state.monthMode = 'days';
        state.monthDays = rule.byMonthDay.map(n => (n === -1 ? 'last' : n)).join(', ');
    } else if (rule.byDay && rule.frequency !== 'WEEKLY') {
        const parsed = rule.byDay.map(parseByDay);
        const choices = ORDINAL_CHOICES.map(([n]) => n);
        if (new Set(parsed.map(p => p.day)).size !== 1 || parsed.some(p => !choices.includes(p.ordinal))) return null;
        state.monthMode = 'weekday';
        state.ordinals = parsed.map(p => p.ordinal);
        state.ordinalDay = parsed[0].day;
    }
    return state;
}

function renderRepeat(draft, id) {
    const rule = draft.recurrence;
    const state = repeatState(rule, draft.startDate);
    const custom = rule && !state;
    const s = state ?? repeatState(null, draft.startDate);
    const show = (visible) => (visible ? '' : ' style="display: none;"');
    const freq = custom ? 'CUSTOM' : s.frequency;

    let options = `<option value=""${freq === '' ? ' selected' : ''}>Does not repeat</option>`;
    options += FREQUENCY_CHOICES.map(([value, label]) =>
        `<option value="${value}"${freq === value ? ' selected' : ''}>${label}</option>`).join('');
    if (custom) {
        const text = describeRecurrence(rule, { startMonth: parseIsoDate(draft.startDate)?.month });
        options += `<option value="CUSTOM" selected>Custom: ${escapeHtml(text)}</option>`;
    }

    let html = `<div class="editor-section" data-repeat-section${custom ? ` data-custom-rule="${escapeHtml(JSON.stringify(rule))}"` : ''}>`;
    html += sectionTitle('repeat', 'Repeat');
    html += `<label class="visually-hidden" for="${id('frequency')}">Repeat</label><select id="${id('frequency')}" data-field="frequency">${options}</select>`;
    html += `<div class="editor-stack" data-repeat-options${show(s.frequency && !custom)}>`;

    html += '<div class="form-row">';
    html += field(id('interval'), `Every <span data-role="interval-unit">${INTERVAL_UNITS[s.frequency] ?? ''}</span>`,
        `<input type="number" id="${id('interval')}" data-field="interval" min="1" max="99" value="${s.interval}">`);
    html += field(id('endMode'), 'Ends', `<select id="${id('endMode')}" data-field="endMode">
        <option value="count"${s.endMode === 'count' ? ' selected' : ''}>After a number of times</option>
        <option value="until"${s.endMode === 'until' ? ' selected' : ''}>On a date</option></select>`);
    html += '</div>';
    html += field(id('count'), 'Number of times', `<input type="number" id="${id('count')}" data-field="count" min="1" max="500" value="${s.count}">`, `data-end="count"${show(s.endMode === 'count')}`);
    html += field(id('until'), 'Last date', `<input type="date" id="${id('until')}" data-field="until" value="${escapeHtml(s.until)}">`, `data-end="until"${show(s.endMode === 'until')}`);

    const weekdayBoxes = MONDAY_FIRST.map(day =>
        `<label class="checkbox-label"><input type="checkbox" data-field="weekday" value="${day}"${s.weekdays.includes(day) ? ' checked' : ''}> ${DAY_LABELS[day]}</label>`).join('');
    html += `<div class="form-group" data-show-for="WEEKLY"${show(s.frequency === 'WEEKLY')}><label>On</label><div class="checkbox-group">${weekdayBoxes}</div></div>`;

    const monthly = s.frequency === 'MONTHLY' || s.frequency === 'YEARLY';
    html += field(id('monthMode'), 'Pattern', `<select id="${id('monthMode')}" data-field="monthMode">
        <option value="date"${s.monthMode === 'date' ? ' selected' : ''}>On the start date's day</option>
        <option value="days" data-monthly-only${s.monthMode === 'days' ? ' selected' : ''}>On days of the month</option>
        <option value="weekday"${s.monthMode === 'weekday' ? ' selected' : ''}>On a weekday of the month</option></select>`,
    `data-show-for="MONTHLY YEARLY"${show(monthly)}`);
    html += field(id('monthDays'), 'Days of the month', `<input type="text" id="${id('monthDays')}" data-field="monthDays" value="${escapeHtml(s.monthDays)}" placeholder="e.g. 1, 15, last">`,
        `data-month-mode="days"${show(monthly && s.monthMode === 'days')}`);
    const ordinalBoxes = ORDINAL_CHOICES.map(([n, label]) =>
        `<label class="checkbox-label"><input type="checkbox" data-field="ordinal" value="${n}"${s.ordinals.includes(n) ? ' checked' : ''}> ${label}</label>`).join('');
    const dayOptions = MONDAY_FIRST.map(day => `<option value="${day}"${s.ordinalDay === day ? ' selected' : ''}>${DAY_NAMES[day]}</option>`).join('');
    html += `<div class="form-group" data-month-mode="weekday"${show(monthly && s.monthMode === 'weekday')}>
        <label>On the</label><div class="checkbox-group">${ordinalBoxes}</div>
        <select data-field="ordinalDay" aria-label="Weekday">${dayOptions}</select></div>`;

    html += '</div></div>';
    return html;
}

function renderReminders(reminders) {
    const choices = [...new Set([...REMINDER_PRESETS, ...reminders])].sort((a, b) => a - b);
    const boxes = choices.map(minutes =>
        `<label class="checkbox-label"><input type="checkbox" data-field="reminder" value="${minutes}"${reminders.includes(minutes) ? ' checked' : ''}> ${formatReminder(minutes)}</label>`).join('');
    return `<div class="editor-section" role="group" aria-label="Reminders">${sectionTitle('bell', 'Reminders')}<div class="checkbox-group">${boxes}</div></div>`;
}

// --- Behaviour ---

// Keeps the editor's visible fields in sync with its choices
export function bindEditor(root) {
    root.addEventListener('change', (e) => {
        const name = e.target.dataset.field;
        if (name === 'startDate' || name === 'startTime') followStart(root);
        refreshEditor(root);
    });
}

function refreshEditor(root) {
    const allDay = root.querySelector('[data-field="allDay"]')?.checked ?? root.dataset.allDay === 'true';
    for (const el of root.querySelectorAll('[data-timed]')) el.style.display = allDay ? 'none' : '';

    const section = root.querySelector('[data-repeat-section]');
    if (!section) return;
    const frequency = value(root, 'frequency');
    const active = frequency && frequency !== 'CUSTOM';
    section.querySelector('[data-repeat-options]').style.display = active ? '' : 'none';
    section.querySelector('[data-role="interval-unit"]').textContent = INTERVAL_UNITS[frequency] ?? '';

    for (const el of section.querySelectorAll('[data-show-for]')) {
        el.style.display = el.dataset.showFor.split(' ').includes(frequency) ? '' : 'none';
    }

    const modeSelect = section.querySelector('[data-field="monthMode"]');
    const daysOption = modeSelect.querySelector('[data-monthly-only]');
    daysOption.hidden = frequency !== 'MONTHLY';
    if (frequency !== 'MONTHLY' && modeSelect.value === 'days') modeSelect.value = 'date';
    const monthly = frequency === 'MONTHLY' || frequency === 'YEARLY';
    for (const el of section.querySelectorAll('[data-month-mode]')) {
        el.style.display = monthly && el.dataset.monthMode === modeSelect.value ? '' : 'none';
    }

    const endMode = value(root, 'endMode');
    for (const el of section.querySelectorAll('[data-end]')) el.style.display = el.dataset.end === endMode ? '' : 'none';
}

// When the start moves, the end moves with it (keeping the length), and a
// single repeat weekday that matched the old start follows the new one
function followStart(root) {
    const previous = parseStart(root.dataset.prevStart);
    const startDate = value(root, 'startDate');
    const startTime = value(root, 'startTime') || '00:00';
    const current = parseStart(`${startDate}T${startTime}`);
    if (!previous || !current) return;
    root.dataset.prevStart = `${startDate}T${startTime}`;

    const delta = current - previous;
    const end = parseStart(`${value(root, 'endDate')}T${value(root, 'endTime') || '00:00'}`);
    if (end !== null && delta !== 0) {
        const moved = new Date(end + delta);
        setValue(root, 'endDate', moved.toISOString().slice(0, 10));
        if (value(root, 'endTime')) setValue(root, 'endTime', moved.toISOString().slice(11, 16));
    }

    const oldDay = WEEKDAYS[new Date(previous).getUTCDay()];
    const newDay = WEEKDAYS[new Date(current).getUTCDay()];
    if (oldDay === newDay) return;
    const checked = [...root.querySelectorAll('[data-field="weekday"]:checked')];
    if (checked.length === 1 && checked[0].value === oldDay) {
        checked[0].checked = false;
        root.querySelector(`[data-field="weekday"][value="${newDay}"]`).checked = true;
    }
    const ordinalDay = root.querySelector('[data-field="ordinalDay"]');
    if (ordinalDay?.value === oldDay) ordinalDay.value = newDay;
}

// "YYYY-MM-DDTHH:mm" as milliseconds of a UTC clock (only differences matter), or null
function parseStart(text) {
    const [date, time] = String(text ?? '').split('T');
    const day = parseIsoDate(date);
    const clock = parseTime(time);
    return day && clock ? Date.UTC(day.year, day.month - 1, day.day, clock.hour, clock.minute) : null;
}

function value(root, name) {
    return root.querySelector(`[data-field="${name}"]`)?.value ?? '';
}

function setValue(root, name, newValue) {
    const el = root.querySelector(`[data-field="${name}"]`);
    if (el) el.value = newValue;
}

function checkedValues(root, name) {
    return [...root.querySelectorAll(`[data-field="${name}"]:checked`)].map(el => el.value);
}

// Reads the editor into { draft, errors }; errors only covers fields the
// draft cannot express (fieldsFromDraft checks the rest)
export function readEditor(root) {
    const errors = {};
    const allDayBox = root.querySelector('[data-field="allDay"]');
    const draft = {
        title: value(root, 'title'),
        allDay: allDayBox ? allDayBox.checked : root.dataset.allDay === 'true',
        startDate: value(root, 'startDate'),
        startTime: value(root, 'startTime'),
        endDate: value(root, 'endDate'),
        endTime: value(root, 'endTime'),
        timeZone: root.querySelector('[data-field="timeZone"]')?.value ?? root.dataset.timeZone,
        location: value(root, 'location'),
        description: value(root, 'description'),
        reminders: checkedValues(root, 'reminder').map(Number),
        recurrence: null
    };

    const frequency = value(root, 'frequency');
    if (frequency === 'CUSTOM') {
        draft.recurrence = JSON.parse(root.querySelector('[data-repeat-section]').dataset.customRule);
    } else if (frequency) {
        const raw = { frequency, interval: Number(value(root, 'interval')) || 1 };
        if (value(root, 'endMode') === 'until') {
            if (!parseIsoDate(value(root, 'until'))) errors.until = 'Pick the last date of the repeat.';
            raw.until = value(root, 'until');
        } else {
            const count = Number(value(root, 'count'));
            if (!Number.isInteger(count) || count < 1) errors.count = 'Enter how many times it repeats.';
            raw.count = count;
        }
        if (frequency === 'WEEKLY') raw.byDay = checkedValues(root, 'weekday');
        const monthMode = value(root, 'monthMode');
        if ((frequency === 'MONTHLY' || frequency === 'YEARLY') && monthMode === 'weekday') {
            const ordinals = checkedValues(root, 'ordinal');
            if (!ordinals.length) errors.ordinal = 'Pick which week of the month.';
            raw.byDay = ordinals.map(n => `${n}${value(root, 'ordinalDay')}`);
        }
        if (frequency === 'MONTHLY' && monthMode === 'days') {
            const days = parseMonthDays(value(root, 'monthDays'));
            if (!days) errors.monthDays = 'Enter days between 1 and 31, or "last".';
            raw.byMonthDay = days ?? [];
        }
        draft.recurrence = normalizeRecurrence(raw);
    }
    return { draft, errors };
}

// "1, 15, last" → [1, 15, -1], or null if any part is invalid
function parseMonthDays(text) {
    const parts = text.split(/[\s,]+/).filter(Boolean);
    const days = parts.map(part => (part.toLowerCase() === 'last' ? -1 : Number(part)));
    return days.length && days.every(n => n === -1 || (Number.isInteger(n) && n >= 1 && n <= 31)) ? days : null;
}

const ERROR_FIELDS = { recurrence: 'frequency' };

export function showEditorErrors(root, errors) {
    for (const el of root.querySelectorAll('.error')) el.classList.remove('error');
    const messages = Object.entries(errors);
    for (const [key] of messages) {
        root.querySelector(`[data-field="${ERROR_FIELDS[key] ?? key}"]`)?.classList.add('error');
    }
    const box = root.querySelector('[data-role="errors"]');
    box.textContent = messages.map(([, message]) => message).join(' ');
    box.style.display = messages.length ? '' : 'none';
}
