import { busyDays, nowPercent, renderMiniMonth, renderMonth, renderTimeGrid, renderYear, weekStart } from './calendar-view.js';
import { findClashes } from './clashes.js';
import { bindEditor, readEditor, renderEditor, showEditorErrors } from './editor.js';
import {
    createEvent, draftFromEvent, draftFromOccurrence, eventFromApi, fieldsFromDraft, newDraft, planChanges,
    removeOccurrence, updateOccurrence, updateSeries
} from './events.js';
import { describeRecurrence, escapeHtml, formatCalendarDate, formatIsoDate, formatReminders, formatTime, formatWhen } from './format.js';
import { generateICS } from './ics.js';
import { eventStartDate, expandEvent, occurrenceOn } from './recurrence.js';
import {
    addDays, addMonths, dayKeyOf, formatTime24, formatWallTime, fromDayKey, getBrowserTimeZone, getWallTime,
    isValidTimeZone, parseIsoDate, toDayKey, todayIn, toIsoDate, wallTimeToDate
} from './time.js';
import { ask, closeDialog, eventColorStyle, icon, openDialog, showToast } from './ui.js';

// Events follow the shape described in events.js
const state = {
    events: [],
    view: 'month',
    // Time zone the calendar is displayed in, and new events are created in
    timeZone: getBrowserTimeZone(),
    // Plain date the calendar is showing, in state.timeZone
    cursor: null,
    // Month shown in the sidebar's mini calendar: { year, month }
    miniMonth: null,
    use24Hour: false,
    // What the form dialog is editing: null (a new event), { eventId, date: null }
    // (the whole event) or { eventId, date } (one occurrence of a series)
    editing: null,
    // AI results waiting for confirmation:
    //   { kind: 'create', items: [{ event, open }] }  new events (open = editor shown)
    //   { kind: 'change', changes: [...] }            changes to existing events
    preview: null,
    // Clashes already shown in the form; saving again with the same ones goes ahead
    acknowledgedClashes: null,
    // Occurrence shown in the details dialog: { eventId, date }
    modalTarget: null,
    // Which day/week the time grid was last scrolled for
    scrollKey: null
};
state.cursor = todayIn(state.timeZone);
state.miniMonth = { year: state.cursor.year, month: state.cursor.month };

const $ = (id) => document.getElementById(id);
const MAX_CLASH_LINES = 3;
const MAX_CONTEXT_EVENTS = 50;
const DAY_START_MINUTES = 7 * 60;

let timeZoneList = [];
let idCounter = 0;
function newId() {
    idCounter += 1;
    return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function findEvent(id) {
    return state.events.find(event => event.id === id);
}

function replaceEvent(id, next) {
    state.events = next
        ? state.events.map(event => (event.id === id ? next : event))
        : state.events.filter(event => event.id !== id);
}

function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function render() {
    renderEventsList();
    renderCalendar();
    if (state.preview) renderPreview();
}

// Applies a change to the events, with an Undo action in a toast
function changeWithUndo(message, apply) {
    const before = state.events;
    apply();
    render();
    showToast(message, {
        actionLabel: 'Undo',
        onAction: () => {
            state.events = before;
            render();
        }
    });
}

// --- Occurrences in the display time zone ---

// Every occurrence of the given events, with the display days it covers:
// { event, occurrence, allDay, title, start, end, firstDay, lastDay }.
// A timed event ending exactly at midnight does not spill into the next day.
function displayOccurrences(events = state.events) {
    return events
        .flatMap(event => expandEvent(event).map(occurrence => toDisplay(event, occurrence)))
        .sort((a, b) => a.firstDay - b.firstDay || b.allDay - a.allDay || a.start - b.start);
}

function toDisplay(event, occurrence) {
    const base = { event, occurrence, allDay: occurrence.allDay, title: occurrence.title };
    if (occurrence.allDay) {
        const first = parseIsoDate(occurrence.startDate);
        const last = parseIsoDate(occurrence.endDate);
        return {
            ...base,
            firstDay: toDayKey(first),
            lastDay: toDayKey(last),
            start: wallTimeToDate({ ...first, hour: 0, minute: 0 }, state.timeZone),
            end: wallTimeToDate({ ...addDays(last, 1), hour: 0, minute: 0 }, state.timeZone)
        };
    }
    return {
        ...base,
        start: occurrence.start,
        end: occurrence.end,
        firstDay: dayKeyOf(occurrence.start, state.timeZone),
        lastDay: dayKeyOf(new Date(occurrence.end.getTime() - 1), state.timeZone)
    };
}

function when(occurrence, timeZone = state.timeZone) {
    return formatWhen(occurrence, timeZone, state.use24Hour);
}

// Shorter form for the sidebar, e.g. "Mon, Oct 19 · 7:00 PM – 8:00 PM" (the year only when it isn't this year)
function compactWhen(occurrence) {
    const thisYear = todayIn(state.timeZone).year;
    const dateOptions = (year) => ({ weekday: 'short', month: 'short', day: 'numeric', ...(year !== thisYear ? { year: 'numeric' } : {}) });
    if (occurrence.allDay) {
        const [first, last] = [parseIsoDate(occurrence.startDate), parseIsoDate(occurrence.endDate)];
        const range = occurrence.startDate === occurrence.endDate
            ? formatCalendarDate(first, dateOptions(first.year))
            : `${formatCalendarDate(first, dateOptions(first.year))} – ${formatCalendarDate(last, dateOptions(last.year))}`;
        return `${range} · All day`;
    }
    const { start, end } = occurrence;
    const day = (date) => formatCalendarDate(getWallTime(date, state.timeZone), dateOptions(getWallTime(date, state.timeZone).year));
    const time = (date) => formatTime(date, state.timeZone, state.use24Hour);
    if (dayKeyOf(start, state.timeZone) === dayKeyOf(new Date(end.getTime() - 1), state.timeZone)) {
        return `${day(start)} · ${time(start)} – ${time(end)}`;
    }
    return `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`;
}

function ruleText(event) {
    return describeRecurrence(event.recurrence, { startMonth: eventStartDate(event).month });
}

// --- Clashes ---

// Overlaps between the candidates' occurrences and everything else in `others`
function clashesBetween(candidates, others) {
    const ids = new Set(candidates.map(event => event.id));
    return findClashes(displayOccurrences(candidates), displayOccurrences(others.filter(event => !ids.has(event.id))));
}

function describeClashes(clashes) {
    const lines = clashes.slice(0, MAX_CLASH_LINES).map(({ occurrence, other }) =>
        `"${occurrence.title}" overlaps "${other.title}" (${when(other.occurrence)})`);
    if (clashes.length > MAX_CLASH_LINES) lines.push(`and ${clashes.length - MAX_CLASH_LINES} more`);
    return lines;
}

function clashBoxes(clashes) {
    return describeClashes(clashes).map(line => `<div class="clash">${icon('warning')}<span>${escapeHtml(line)}</span></div>`).join('');
}

// --- Sidebar: events list and mini month ---

function renderEventsList() {
    const listEl = $('events-list');
    $('event-count').textContent = state.events.length;
    $('download-btn').disabled = state.events.length === 0;
    $('ai-change-btn').disabled = state.events.length === 0;

    if (state.events.length === 0) {
        listEl.innerHTML = `<div class="empty-state">
            <img src="images/empty-events.svg" alt="" width="180" height="120">
            <strong>No events yet</strong>
            <span>Ask AI above, or press Create.</span>
        </div>`;
        return;
    }

    const rows = state.events
        .map(event => ({ event, first: toDisplay(event, expandEvent(event)[0]) }))
        .sort((a, b) => a.first.start - b.first.start);

    listEl.innerHTML = rows.map(({ event, first }) => {
        const id = escapeHtml(event.id);
        const title = escapeHtml(event.title);
        const count = event.recurrence ? expandEvent(event).length : 0;
        return `<div class="event-row" role="button" tabindex="0" data-action="open-event" data-event-id="${id}"
                data-date="${first.occurrence.date}" style="${eventColorStyle(event.id)}" aria-label="${title}">
            <span class="event-dot"></span>
            <div>
                <div class="event-row-title">${title}</div>
                <div class="event-row-when">${escapeHtml(compactWhen(first.occurrence))}</div>
                ${event.recurrence ? `<div class="event-row-meta">${icon('repeat')}<span>${escapeHtml(`${ruleText(event)} · ${plural(count, 'occurrence')}`)}</span></div>` : ''}
            </div>
            <div class="event-row-actions">
                <button type="button" class="icon-btn icon-btn-sm" data-action="edit-event" data-event-id="${id}" aria-label="Edit ${title}" title="Edit">${icon('edit')}</button>
                <button type="button" class="icon-btn icon-btn-sm" data-action="delete-event" data-event-id="${id}" aria-label="Delete ${title}" title="Delete">${icon('trash')}</button>
            </div>
        </div>`;
    }).join('');
}

function renderMiniMonthPanel() {
    $('mini-month').innerHTML = renderMiniMonth({
        month: state.miniMonth,
        selectedKey: toDayKey(state.cursor),
        todayKey: toDayKey(todayIn(state.timeZone)),
        busy: busyDays(displayOccurrences())
    });
}

// --- Calendar ---

function setCursor(date) {
    state.cursor = date;
    state.miniMonth = { year: date.year, month: date.month };
}

function changePeriod(direction) {
    if (state.view === 'day') setCursor(addDays(state.cursor, direction));
    else if (state.view === 'week') setCursor(addDays(state.cursor, direction * 7));
    else if (state.view === 'month') setCursor(addMonths(state.cursor, direction));
    else setCursor(addMonths(state.cursor, direction * 12));
    renderCalendar();
}

function setView(view) {
    state.view = view;
    for (const button of document.querySelectorAll('[data-view]')) {
        button.classList.toggle('active', button.dataset.view === view);
        button.setAttribute('aria-pressed', String(button.dataset.view === view));
    }
    renderCalendar();
}

function goToDay(dayKey) {
    setCursor(fromDayKey(dayKey));
    setView('day');
}

function renderCalendar() {
    const container = $('calendar-container');
    const items = displayOccurrences();
    const todayKey = toDayKey(todayIn(state.timeZone));
    const ctx = { items, cursor: state.cursor, timeZone: state.timeZone, use24Hour: state.use24Hour, todayKey, now: new Date() };
    const previousScroll = container.querySelector('[data-scroll]')?.scrollTop;

    $('current-period').textContent = periodTitle();
    if (state.view === 'day' || state.view === 'week') {
        const days = state.view === 'day' ? [state.cursor] : Array.from({ length: 7 }, (_, i) => addDays(weekStart(state.cursor), i));
        container.innerHTML = renderTimeGrid(ctx, days);
        restoreScroll(container, days, todayKey, previousScroll);
    } else {
        container.innerHTML = state.view === 'month' ? renderMonth(ctx) : renderYear(ctx);
        state.scrollKey = null;
    }
    renderMiniMonthPanel();
}

// Keeps the time grid's scroll position while re-rendering the same days;
// otherwise starts at 7:00, or just before the current time when today is shown
function restoreScroll(container, days, todayKey, previousScroll) {
    const scroller = container.querySelector('[data-scroll]');
    const key = `${state.view}:${toDayKey(days[0])}`;
    if (key === state.scrollKey && previousScroll !== undefined) {
        scroller.scrollTop = previousScroll;
        return;
    }
    state.scrollKey = key;
    let minutes = DAY_START_MINUTES;
    if (days.some(day => toDayKey(day) === todayKey)) {
        const { hour, minute } = getWallTime(new Date(), state.timeZone);
        minutes = Math.max(0, hour * 60 + minute - 90);
    }
    // A little higher, so the first hour's label is not cut off
    scroller.scrollTop = Math.max(0, (minutes / (24 * 60)) * scroller.scrollHeight - 12);
}

// e.g. "October 2026", "Oct 18 – 24, 2026", "Monday, October 19, 2026"
function periodTitle() {
    const { view, cursor } = state;
    if (view === 'day') return formatCalendarDate(cursor, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (view === 'month') return formatCalendarDate(cursor, { month: 'long', year: 'numeric' });
    if (view === 'year') return String(cursor.year);

    const first = weekStart(cursor);
    const last = addDays(first, 6);
    const short = { month: 'short', day: 'numeric' };
    if (first.year !== last.year) {
        return `${formatCalendarDate(first, { ...short, year: 'numeric' })} – ${formatCalendarDate(last, { ...short, year: 'numeric' })}`;
    }
    const end = first.month === last.month ? String(last.day) : formatCalendarDate(last, short);
    return `${formatCalendarDate(first, short)} – ${end}, ${last.year}`;
}

// Keeps the "now" line in place, and redraws when the day changes
let renderedToday = null;
function tick() {
    const todayKey = toDayKey(todayIn(state.timeZone));
    if (renderedToday !== null && renderedToday !== todayKey) {
        render();
    } else {
        const top = nowPercent(getWallTime(new Date(), state.timeZone));
        for (const line of document.querySelectorAll('[data-now-line]')) line.style.top = `${top}%`;
    }
    renderedToday = todayKey;
}

// --- Form dialog (new event, edit, AI review) ---

function openFormDialog() {
    openDialog($('form-dialog'), { onClose: closeForm, initialFocus: $('form-dialog').querySelector('[data-field="title"]') ?? $('close-form-btn') });
}

function closeForm() {
    closeDialog($('form-dialog'));
    $('manual-editor').innerHTML = '';
    $('ai-preview-list').innerHTML = '';
    state.preview = null;
    state.editing = null;
    clearFormWarning();
}

function clearFormWarning() {
    state.acknowledgedClashes = null;
    $('form-warning').hidden = true;
}

// Shows the editor in the form dialog
function showEditor(draft, { mode = 'event', title, note = '' }) {
    state.preview = null;
    clearFormWarning();
    $('form-title').textContent = title;
    $('edit-note').textContent = note;
    $('edit-note').hidden = !note;
    $('manual-section').hidden = false;
    $('preview-section').hidden = true;
    $('form-cancel-btn').textContent = 'Cancel';
    $('form-submit-btn').textContent = 'Save';
    $('form-submit-btn').disabled = false;

    const container = $('manual-editor');
    container.innerHTML = renderEditor(draft, { mode, timeZones: timeZoneList });
    bindEditor(container.firstElementChild);
    openFormDialog();
}

function startNewEvent(draft = newDraft(state.timeZone)) {
    state.editing = null;
    showEditor(draft, { title: 'New event' });
}

// A new event starting at a clicked time slot (minutes from midnight), one hour long
function startNewEventAt(dayKey, minutes) {
    const day = fromDayKey(dayKey);
    const start = wallTimeToDate({ ...day, hour: Math.floor(minutes / 60), minute: minutes % 60 }, state.timeZone);
    const end = getWallTime(new Date(start.getTime() + 60 * 60 * 1000), state.timeZone);
    startNewEvent({
        ...newDraft(state.timeZone),
        startDate: toIsoDate(day),
        startTime: formatTime24({ hour: Math.floor(minutes / 60), minute: minutes % 60 }),
        endDate: toIsoDate(end),
        endTime: formatTime24(end)
    });
}

// Opens the editor on a whole event (date = null) or one occurrence
function startEditing(eventId, date = null) {
    const event = findEvent(eventId);
    if (!event) return;
    const occurrence = date ? occurrenceOn(event, date) : null;
    if (date && !occurrence) return;

    state.editing = { eventId, date: occurrence ? date : null };
    let note = '';
    if (occurrence) note = `Only the ${formatIsoDate(date)} occurrence will change.`;
    else if (event.recurrence) note = 'Changes apply to every occurrence of this event.';
    showEditor(occurrence ? draftFromOccurrence(event, occurrence) : draftFromEvent(event), {
        mode: occurrence ? 'occurrence' : 'event',
        title: 'Edit event',
        note
    });
}

// Reads an editor and validates it; shows errors and returns null if invalid
function fieldsFromEditor(root) {
    const { draft, errors } = readEditor(root);
    const result = fieldsFromDraft(draft);
    const allErrors = { ...errors, ...(result.errors ?? {}) };
    showEditorErrors(root, allErrors);
    return Object.keys(allErrors).length ? null : result.fields;
}

function submitForm() {
    if (state.preview) confirmPreview();
    else submitManualForm();
}

function submitManualForm() {
    const fields = fieldsFromEditor($('manual-editor').firstElementChild);
    if (!fields) return;

    // The edited event may have been deleted while the form was open
    const editing = state.editing;
    const existing = editing && findEvent(editing.eventId);
    let next;
    if (existing && editing.date) next = updateOccurrence(existing, editing.date, fields);
    else if (existing) next = updateSeries(existing, fields);
    else next = createEvent(fields, newId());

    let clashes = clashesBetween([next], state.events);
    if (existing && editing.date) clashes = clashes.filter(c => c.occurrence.occurrence.date === editing.date);
    const signature = describeClashes(clashes).join('\n');
    if (clashes.length && signature !== state.acknowledgedClashes) {
        state.acknowledgedClashes = signature;
        $('form-warning').innerHTML = `${icon('warning')}<div>This overlaps other events:<ul>${
            describeClashes(clashes).map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul></div>`;
        $('form-warning').hidden = false;
        $('form-submit-btn').textContent = 'Save anyway';
        $('form-warning').scrollIntoView({ block: 'nearest' });
        return;
    }

    if (existing) replaceEvent(existing.id, next);
    else state.events.push(next);
    closeForm();
    render();
    showToast(existing ? 'Event updated' : `Added "${next.title}"`);
}

// --- AI ---

const AI_BUTTONS = { create: 'ai-submit-btn', edit: 'ai-change-btn' };

// Asks the AI to create events ('create') or change existing ones ('edit'),
// then shows the result for review
async function submitAI(mode) {
    const textarea = $('ai-event-input');
    const input = textarea.value.trim();
    textarea.classList.toggle('error', !input);
    if (!input) {
        textarea.focus();
        return;
    }

    const button = $(AI_BUTTONS[mode]);
    const label = button.textContent;
    button.textContent = 'Thinking...';
    for (const id of Object.values(AI_BUTTONS)) $(id).disabled = true;

    try {
        const body = { input, timeZone: state.timeZone, mode };
        // Events the AI can refer to, by their 1-based position in this list
        const context = mode === 'edit' ? contextEvents() : [];
        if (mode === 'edit') body.events = context.map(toContext);

        const response = await fetch('/api/parse-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

        if (mode === 'create') {
            const events = (data.events ?? []).map(raw => eventFromApi(raw, newId(), state.timeZone)).filter(Boolean);
            if (!events.length) throw new Error("Sorry, I couldn't understand that. Please try rephrasing.");
            state.preview = { kind: 'create', items: events.map(event => ({ event, open: false })) };
        } else {
            const changes = (data.changes ?? [])
                .map(change => ({ ...change, eventId: context[change.ref - 1]?.id }))
                .filter(change => change.eventId);
            if (!changes.length) throw new Error("Sorry, I couldn't match that to any of your events.");
            state.preview = { kind: 'change', changes };
        }
        showPreview();
    } catch (error) {
        console.error('AI request error:', error);
        textarea.classList.add('error');
        showToast(error.message || "Sorry, I couldn't understand that. Please try rephrasing.");
    } finally {
        button.textContent = label;
        $('ai-submit-btn').disabled = false;
        $('ai-change-btn').disabled = state.events.length === 0;
    }
}

// Events sent with a change request: the next ones first
function contextEvents() {
    const now = Date.now();
    const upcoming = (event) => displayOccurrences([event]).find(item => item.end.getTime() > now)?.start.getTime() ?? Infinity;
    return [...state.events]
        .map(event => ({ event, next: upcoming(event) }))
        .sort((a, b) => a.next - b.next)
        .slice(0, MAX_CONTEXT_EVENTS)
        .map(({ event }) => event);
}

// How an event is described to the AI: series start, in its own time zone
function toContext(event) {
    const base = { title: event.title, allDay: event.allDay, recurrence: event.recurrence };
    if (event.allDay) return { ...base, startDate: event.startDate, endDate: event.endDate };
    return {
        ...base,
        start: formatWallTime(getWallTime(event.start, event.timeZone)),
        end: formatWallTime(getWallTime(event.end, event.timeZone)),
        timeZone: event.timeZone
    };
}

function showPreview() {
    setSidebarOpen(false);
    state.editing = null;
    clearFormWarning();
    $('manual-editor').innerHTML = '';
    $('edit-note').hidden = true;
    $('manual-section').hidden = true;
    $('preview-section').hidden = false;
    $('form-title').textContent = state.preview.kind === 'create' ? 'Review new events' : 'Review changes';
    renderPreview();
    openFormDialog();
}

function renderPreview() {
    const preview = state.preview;
    const list = $('ai-preview-list');
    const submit = $('form-submit-btn');
    const emptyState = `<div class="empty-state">
        <img src="images/empty-review.svg" alt="" width="160" height="104">
        <strong>Nothing left to review</strong>
        <span>Close this window to go back.</span>
    </div>`;

    if (preview.kind === 'create') {
        const count = preview.items.length;
        $('ai-preview-title').textContent = count ? 'Check the details, then add them to your calendar.' : '';
        submit.textContent = `Add ${plural(count, 'event')}`;
        submit.disabled = count === 0;
        list.innerHTML = count ? preview.items.map((item, index) => {
            const earlier = preview.items.slice(0, index).map(other => other.event);
            return renderCreateCard(item, index, [...state.events, ...earlier]);
        }).join('') : emptyState;
        for (const root of list.querySelectorAll('[data-editor]')) bindEditor(root);
        return;
    }

    const { results, events } = planChanges(state.events, preview.changes, {
        now: new Date(),
        display: { timeZone: state.timeZone, use24Hour: state.use24Hour }
    });
    const valid = results.filter(result => !result.error).length;
    $('ai-preview-title').textContent = results.length ? 'Nothing changes until you apply.' : '';
    submit.textContent = `Apply ${plural(valid, 'change')}`;
    submit.disabled = valid === 0;
    list.innerHTML = results.length ? results.map((result, index) => {
        const after = events.find(event => event.id === result.change.eventId);
        const clashes = !result.error && after ? clashesBetween([after], events) : [];
        return `<div class="preview-card${result.error ? ' preview-error' : ''}" style="${eventColorStyle(result.change.eventId)}">
            <span class="event-dot"></span>
            <div class="preview-card-body">
                <p class="change-summary">${escapeHtml(result.error ?? result.summary)}</p>
                ${clashBoxes(clashes)}
                <div class="card-actions">
                    <button type="button" class="btn btn-text btn-danger" data-action="preview-remove" data-index="${index}">Remove</button>
                </div>
            </div>
        </div>`;
    }).join('') : emptyState;
}

function metaRow(iconName, text) {
    return text ? `<div class="meta-row">${icon(iconName)}<span>${escapeHtml(text)}</span></div>` : '';
}

function renderCreateCard(item, index, others) {
    const { event } = item;
    const occurrences = expandEvent(event);
    const first = occurrences[0];
    const zone = !event.allDay && event.timeZone !== state.timeZone ? `${event.timeZone}: ${when(first, event.timeZone)}` : '';
    const rule = event.recurrence ? `${ruleText(event)} · ${plural(occurrences.length, 'occurrence')}` : '';

    let body = `<h3>${escapeHtml(event.title)}</h3>
        ${metaRow('clock', when(first))}
        ${metaRow('globe', zone)}
        ${metaRow('repeat', rule)}
        ${metaRow('bell', formatReminders(event.reminders))}
        ${metaRow('pin', event.location)}
        ${metaRow('notes', event.description)}
        ${clashBoxes(clashesBetween([event], others))}`;

    if (item.open) {
        body += renderEditor(draftFromEvent(event), { timeZones: timeZoneList });
        body += `<div class="card-actions"><button type="button" class="btn btn-tonal" data-action="preview-save" data-index="${index}">Done</button></div>`;
    } else {
        body += `<div class="card-actions">
            <button type="button" class="btn btn-text" data-action="preview-edit" data-index="${index}">Edit</button>
            <button type="button" class="btn btn-text btn-danger" data-action="preview-remove" data-index="${index}">Remove</button>
        </div>`;
    }
    return `<div class="preview-card" style="${eventColorStyle(event.id)}"><span class="event-dot"></span><div class="preview-card-body">${body}</div></div>`;
}

// Applies an open preview editor; returns false if it has errors
function savePreviewEditor(index) {
    const item = state.preview.items[index];
    const root = $('ai-preview-list').querySelectorAll('.preview-card')[index]?.querySelector('[data-editor]');
    if (!root) return true;
    const fields = fieldsFromEditor(root);
    if (!fields) return false;
    item.event = updateSeries(item.event, fields);
    item.open = false;
    return true;
}

function handlePreviewClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target || !state.preview) return;
    const index = Number(target.dataset.index);
    const { action } = target.dataset;

    if (action === 'preview-remove') {
        if (state.preview.kind === 'create') state.preview.items.splice(index, 1);
        else state.preview.changes.splice(index, 1);
    } else if (action === 'preview-edit') {
        state.preview.items[index].open = true;
    } else if (action === 'preview-save') {
        if (!savePreviewEditor(index)) return;
    } else {
        return;
    }
    renderPreview();
}

function confirmPreview() {
    const preview = state.preview;
    if (!preview) return;

    if (preview.kind === 'create') {
        // Apply editors that are still open; stop if one is invalid
        for (let i = 0; i < preview.items.length; i++) {
            if (preview.items[i].open && !savePreviewEditor(i)) return;
        }
        const added = preview.items.map(item => item.event);
        closeForm();
        changeWithUndo(`Added ${plural(added.length, 'event')}`, () => {
            state.events = [...state.events, ...added];
        });
    } else {
        const { results, events } = planChanges(state.events, preview.changes, {
            now: new Date(),
            display: { timeZone: state.timeZone, use24Hour: state.use24Hour }
        });
        const applied = results.filter(result => !result.error).length;
        closeForm();
        changeWithUndo(`Applied ${plural(applied, 'change')}`, () => {
            state.events = events;
        });
    }
    $('ai-event-input').value = '';
}

// --- Delete ---

function deleteEvent(id) {
    const event = findEvent(id);
    if (!event) return;
    if (state.editing?.eventId === id) closeForm();
    changeWithUndo(`Deleted "${event.title}"`, () => replaceEvent(id, null));
}

function deleteOneOccurrence(id, date) {
    const event = findEvent(id);
    if (!event) return;
    const next = removeOccurrence(event, date);
    if (!next) {
        deleteEvent(id);
        return;
    }
    changeWithUndo(`Deleted "${event.title}" on ${formatIsoDate(date)}`, () => replaceEvent(id, next));
}

async function confirmDeleteFromList(id) {
    const event = findEvent(id);
    if (!event) return;
    if (event.recurrence) {
        const count = expandEvent(event).length;
        const ok = await ask({ title: 'Delete recurring event', message: `All ${plural(count, 'occurrence')} of "${event.title}" will be deleted.`, confirmLabel: 'Delete' });
        if (!ok) return;
    }
    deleteEvent(id);
}

// --- Event details dialog ---

function openEventModal(eventId, date) {
    const event = findEvent(eventId);
    if (!event) return;

    const occurrence = occurrenceOn(event, date) ?? expandEvent(event)[0];
    state.modalTarget = { eventId, date: occurrence.date };

    $('modal-color').style.cssText = eventColorStyle(event.id);
    $('modal-title').textContent = occurrence.title;
    $('modal-time').textContent = when(occurrence);

    const rule = event.recurrence ? ruleText(event) : '';
    showRow('modal-recurrence-row', 'modal-recurrence', rule && occurrence.isOverride ? `${rule} (this occurrence was edited)` : rule);
    showRow('modal-tz-row', 'modal-tz', !event.allDay && event.timeZone !== state.timeZone
        ? `${event.timeZone}: ${when(occurrence, event.timeZone)}`
        : '');
    showRow('modal-reminders-row', 'modal-reminders', formatReminders(occurrence.reminders));
    showRow('modal-loc-row', 'modal-location', occurrence.location);
    showRow('modal-desc-row', 'modal-description', occurrence.description);

    openDialog($('event-modal'), { onClose: closeEventModal, initialFocus: $('modal-close-btn') });
}

function showRow(rowId, textId, text) {
    $(rowId).hidden = !text;
    $(textId).textContent = text || '';
}

function closeEventModal() {
    closeDialog($('event-modal'));
    state.modalTarget = null;
}

// "This event" or "All events" for recurring events; null if cancelled
async function chooseScope(event, action) {
    if (!event.recurrence) return 'all';
    return ask({
        title: `${action} recurring event`,
        options: [{ value: 'one', label: 'This event' }, { value: 'all', label: 'All events' }],
        confirmLabel: action
    });
}

async function editFromModal() {
    const { eventId, date } = state.modalTarget;
    closeEventModal();
    const scope = await chooseScope(findEvent(eventId), 'Edit');
    if (!scope) return;
    startEditing(eventId, scope === 'one' ? date : null);
}

async function deleteFromModal() {
    const { eventId, date } = state.modalTarget;
    closeEventModal();
    const scope = await chooseScope(findEvent(eventId), 'Delete');
    if (!scope) return;
    if (scope === 'one') deleteOneOccurrence(eventId, date);
    else deleteEvent(eventId);
}

// --- Misc ---

function downloadCalendar() {
    if (state.events.length === 0) return;
    const blob = new Blob([generateICS(state.events)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `my-calendar-${Date.now()}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`Exported ${plural(state.events.length, 'event')}`);
}

function populateTimeZones() {
    const select = $('timezone-select');
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    timeZoneList = [...new Set([state.timeZone, 'UTC', ...zones])].sort();
    select.innerHTML = timeZoneList
        .map(zone => `<option value="${escapeHtml(zone)}">${escapeHtml(zone.replace(/_/g, ' '))}</option>`)
        .join('');
    select.value = state.timeZone;
}

function setTimeZone(timeZone) {
    if (!isValidTimeZone(timeZone)) return;
    state.timeZone = timeZone;
    render();
}

function setSidebarOpen(open) {
    $('app').classList.toggle('sidebar-open', open);
    $('sidebar-toggle').setAttribute('aria-expanded', String(open));
}

// --- Wiring ---

// Clicks on generated markup (list rows, calendar cells, event chips, mini month)
function handleDelegatedClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const { action, eventId, date, day, year, month } = target.dataset;

    if (action === 'open-event') openEventModal(eventId, date);
    else if (action === 'open-day') goToDay(Number(day));
    else if (action === 'open-month') {
        setCursor({ year: Number(year), month: Number(month), day: 1 });
        setView('month');
    } else if (action === 'edit-event') startEditing(eventId);
    else if (action === 'delete-event') confirmDeleteFromList(eventId);
    else if (action === 'create-at') {
        // Half-hour slot under the pointer
        const rect = target.getBoundingClientRect();
        const minutes = Math.floor(((e.clientY - rect.top) / rect.height) * 48) * 30;
        startNewEventAt(Number(day), Math.min(Math.max(minutes, 0), 23 * 60 + 30));
    } else if (action === 'mini-day') {
        setCursor(fromDayKey(Number(day)));
        renderCalendar();
        setSidebarOpen(false);
    } else if (action === 'mini-prev' || action === 'mini-next') {
        const next = addMonths({ ...state.miniMonth, day: 1 }, action === 'mini-next' ? 1 : -1);
        state.miniMonth = { year: next.year, month: next.month };
        renderMiniMonthPanel();
    }
}

// Single-key shortcuts, as in Google Calendar
const SHORTCUTS = {
    c: () => startNewEvent(),
    t: () => {
        setCursor(todayIn(state.timeZone));
        renderCalendar();
    },
    d: () => setView('day'),
    w: () => setView('week'),
    m: () => setView('month'),
    y: () => setView('year'),
    j: () => changePeriod(1),
    n: () => changePeriod(1),
    k: () => changePeriod(-1),
    p: () => changePeriod(-1)
};

function handleShortcut(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.dialog-backdrop:not([hidden])')) return;
    const shortcut = SHORTCUTS[e.key.toLowerCase()];
    if (shortcut) {
        e.preventDefault();
        shortcut();
    }
}

function init() {
    $('download-btn').addEventListener('click', downloadCalendar);
    $('create-btn').addEventListener('click', () => {
        setSidebarOpen(false);
        startNewEvent();
    });
    $('today-btn').addEventListener('click', SHORTCUTS.t);
    $('prev-btn').addEventListener('click', () => changePeriod(-1));
    $('next-btn').addEventListener('click', () => changePeriod(1));
    for (const button of document.querySelectorAll('[data-view]')) {
        button.addEventListener('click', () => setView(button.dataset.view));
    }

    $('ai-submit-btn').addEventListener('click', () => submitAI('create'));
    $('ai-change-btn').addEventListener('click', () => submitAI('edit'));
    $('ai-event-input').addEventListener('input', e => e.target.classList.remove('error'));
    $('ai-event-input').addEventListener('keydown', e => {
        // Ctrl/Cmd + Enter adds events
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submitAI('create');
        }
    });

    $('time-format-toggle').addEventListener('change', e => {
        state.use24Hour = e.target.checked;
        render();
    });
    $('timezone-select').addEventListener('change', e => setTimeZone(e.target.value));

    $('sidebar-toggle').addEventListener('click', () => setSidebarOpen(!$('app').classList.contains('sidebar-open')));
    $('sidebar-scrim').addEventListener('click', () => setSidebarOpen(false));

    for (const id of ['events-list', 'calendar-container', 'mini-month']) {
        $(id).addEventListener('click', handleDelegatedClick);
    }
    $('events-list').addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.event-row')) {
            e.preventDefault();
            handleDelegatedClick(e);
        }
    });

    $('close-form-btn').addEventListener('click', closeForm);
    $('form-cancel-btn').addEventListener('click', closeForm);
    $('form-submit-btn').addEventListener('click', submitForm);
    $('ai-preview-list').addEventListener('click', handlePreviewClick);

    $('modal-close-btn').addEventListener('click', closeEventModal);
    $('modal-edit-btn').addEventListener('click', editFromModal);
    $('modal-delete-btn').addEventListener('click', deleteFromModal);

    document.addEventListener('keydown', handleShortcut);

    populateTimeZones();
    render();
    tick();
    setInterval(tick, 60 * 1000);
}

init();
