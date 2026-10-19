// Resizable sidebar: a draggable divider between the sidebar and the calendar.
// The sidebar never gets narrower than its original width, and the calendar
// always keeps at least two thirds of the space.

export const MIN_SIDEBAR_WIDTH = 300;
export const MAX_SIDEBAR_FRACTION = 1 / 3;
const KEYBOARD_STEP = 16;
const STORAGE_KEY = 'ai-calendar.sidebar-width';

// Width limits for a layout of the given width
export function sidebarLimits(layoutWidth) {
    const max = Math.max(MIN_SIDEBAR_WIDTH, Math.floor(layoutWidth * MAX_SIDEBAR_FRACTION));
    return { min: MIN_SIDEBAR_WIDTH, max };
}

export function clampSidebarWidth(width, layoutWidth) {
    const { min, max } = sidebarLimits(layoutWidth);
    return Math.round(Math.min(Math.max(width, min), max));
}

// Remembered per browser; storage can be unavailable (private mode, blocked site data)
function loadWidth() {
    try {
        const value = Number(localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
}

function saveWidth(width) {
    try {
        localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
        // Not remembered; the divider still works
    }
}

// `root` gets the --sidebar-width custom property; `layout` is the element whose width is shared
export function initSidebarResize({ root, layout, sidebar, handle }) {
    let width = loadWidth() ?? MIN_SIDEBAR_WIDTH;

    const apply = (next, { save = false } = {}) => {
        width = clampSidebarWidth(next, layout.clientWidth);
        const { min, max } = sidebarLimits(layout.clientWidth);
        root.style.setProperty('--sidebar-width', `${width}px`);
        handle.setAttribute('aria-valuenow', String(width));
        handle.setAttribute('aria-valuemin', String(min));
        handle.setAttribute('aria-valuemax', String(max));
        if (save) saveWidth(width);
    };

    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        document.body.classList.add('resizing');
        const left = sidebar.getBoundingClientRect().left;

        const move = (event) => apply(event.clientX - left);
        const stop = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', stop);
            handle.removeEventListener('pointercancel', stop);
            document.body.classList.remove('resizing');
            apply(width, { save: true });
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
    });

    handle.addEventListener('keydown', (e) => {
        const { min, max } = sidebarLimits(layout.clientWidth);
        const steps = { ArrowLeft: width - KEYBOARD_STEP, ArrowRight: width + KEYBOARD_STEP, Home: min, End: max };
        if (!(e.key in steps)) return;
        e.preventDefault();
        apply(steps[e.key], { save: true });
    });

    // Double-click goes back to the narrowest width
    handle.addEventListener('dblclick', () => apply(MIN_SIDEBAR_WIDTH, { save: true }));

    // Keep within limits when the window changes size (without forgetting the chosen width)
    const remembered = () => loadWidth() ?? width;
    window.addEventListener('resize', () => apply(remembered()));

    apply(width);
}
