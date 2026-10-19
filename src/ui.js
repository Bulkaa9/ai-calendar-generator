// Shared UI pieces: icons, event colours, dialogs and the toast

import { escapeHtml } from './format.js';

const $ = (id) => document.getElementById(id);

// A line icon from the sprite in index.html
export function icon(name, className = '') {
    return `<svg class="icon${className ? ` ${className}` : ''}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

// --- Event colours ---

// [solid, soft background, text on soft background]; each pair passes WCAG AA
const EVENT_COLORS = [
    ['#1a56db', '#e8effd', '#1a3f9c'], // blue
    ['#6d3fe0', '#efe8fd', '#4a22a8'], // purple
    ['#c8326e', '#fce8f0', '#9a1d50'], // pink
    ['#4f46e5', '#ebeafd', '#3730a3'], // indigo
    ['#9333ea', '#f4e9fe', '#6b21a8'], // violet
    ['#b5307f', '#fbe8f3', '#86185c'] // magenta
];

// Inline style setting --event, --event-soft and --event-text for an event (stable per id)
export function eventColorStyle(id) {
    let hash = 0;
    for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const [solid, soft, text] = EVENT_COLORS[hash % EVENT_COLORS.length];
    return `--event: ${solid}; --event-soft: ${soft}; --event-text: ${text};`;
}

// --- Dialogs ---

// Open dialogs, topmost last: { backdrop, onClose, previousFocus }
const openDialogs = [];

// Shows a dialog backdrop. Escape and clicks outside the dialog call `onClose`
// (which should close it), or close it directly.
export function openDialog(backdrop, { onClose = null, initialFocus = null } = {}) {
    // A toast would sit on top of the dialog's buttons (on phones dialogs open at the bottom)
    hideToast();
    if (!openDialogs.some(entry => entry.backdrop === backdrop)) {
        openDialogs.push({ backdrop, onClose, previousFocus: document.activeElement });
    }
    backdrop.hidden = false;
    const target = initialFocus ?? backdrop.querySelector('input:not([type="checkbox"]), textarea, select, button');
    target?.focus({ preventScroll: true });
}

export function closeDialog(backdrop) {
    const index = openDialogs.findIndex(entry => entry.backdrop === backdrop);
    backdrop.hidden = true;
    if (index === -1) return;
    const [entry] = openDialogs.splice(index, 1);
    if (entry.previousFocus && document.contains(entry.previousFocus)) entry.previousFocus.focus({ preventScroll: true });
}

function dismissTopDialog() {
    const top = openDialogs.at(-1);
    if (!top) return false;
    if (top.onClose) top.onClose();
    else closeDialog(top.backdrop);
    return true;
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dismissTopDialog()) e.preventDefault();
});

document.addEventListener('mousedown', (e) => {
    const top = openDialogs.at(-1);
    if (top && e.target === top.backdrop) dismissTopDialog();
});

// Small dialog asking to confirm, or to pick one of `options` ([{ value, label }]).
// Resolves with the chosen value (true when there are no options), or null if cancelled.
export function ask({ title, message = '', options = null, confirmLabel = 'OK' }) {
    const dialog = $('choice-dialog');
    const okButton = $('choice-ok-btn');
    const cancelButton = $('choice-cancel-btn');

    $('choice-title').textContent = title;
    $('choice-message').textContent = message;
    $('choice-message').hidden = !message;
    $('choice-options').innerHTML = (options ?? []).map((option, index) => `
        <label><input type="radio" name="choice" value="${escapeHtml(option.value)}"${index === 0 ? ' checked' : ''}> ${escapeHtml(option.label)}</label>`).join('');
    $('choice-options').hidden = !options;
    okButton.textContent = confirmLabel;

    return new Promise((resolve) => {
        const finish = (value) => {
            okButton.onclick = null;
            cancelButton.onclick = null;
            closeDialog(dialog);
            resolve(value);
        };
        okButton.onclick = () => finish(options ? dialog.querySelector('input[name="choice"]:checked').value : true);
        cancelButton.onclick = () => finish(null);
        openDialog(dialog, { onClose: () => finish(null), initialFocus: okButton });
    });
}

// --- Toast ---

let toastTimer = null;

// Short message at the bottom of the screen, with an optional action such as "Undo"
export function showToast(message, { actionLabel = null, onAction = null, duration = 6000 } = {}) {
    const toast = $('toast');
    const action = $('toast-action');
    $('toast-message').textContent = message;
    action.hidden = !actionLabel;
    action.textContent = actionLabel ?? '';
    action.onclick = () => {
        hideToast();
        onAction?.();
    };

    // Restart the entrance animation when a toast replaces another
    toast.hidden = true;
    void toast.offsetWidth;
    toast.hidden = false;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, duration);
}

export function hideToast() {
    clearTimeout(toastTimer);
    $('toast').hidden = true;
}
