// Cookie notice: the site sets no cookies and loads no trackers, so this informs rather than
// asks for consent. Dismissing it is remembered on this device.

const STORAGE_KEY = 'ai-calendar.notice-dismissed';

function isDismissed() {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function dismiss(notice) {
    try {
        localStorage.setItem(STORAGE_KEY, '1');
    } catch {
        // Storage blocked: the notice simply shows again next visit
    }
    notice.remove();
}

function showNotice() {
    if (isDismissed()) return;
    const notice = document.createElement('section');
    notice.className = 'cookie-notice';
    notice.setAttribute('aria-label', 'Cookie notice');
    notice.innerHTML = `
        <p>AI Calendar uses no cookies and no trackers. We only keep two small settings on this device, such as your sidebar width.</p>
        <div class="cookie-notice-actions">
            <a class="btn btn-quiet" href="cookies.html">Cookie policy</a>
            <button type="button" class="btn btn-primary">OK</button>
        </div>`;
    notice.querySelector('button').addEventListener('click', () => dismiss(notice));
    document.body.append(notice);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showNotice);
} else {
    showNotice();
}
