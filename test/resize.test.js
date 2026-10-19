import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampSidebarWidth, MIN_SIDEBAR_WIDTH, sidebarLimits } from '../src/resize.js';

test('the sidebar is never narrower than its original width', () => {
    assert.equal(clampSidebarWidth(120, 1440), MIN_SIDEBAR_WIDTH);
    assert.equal(clampSidebarWidth(-50, 1440), MIN_SIDEBAR_WIDTH);
});

test('the calendar keeps at least two thirds of the layout', () => {
    assert.deepEqual(sidebarLimits(1440), { min: 300, max: 480 });
    assert.equal(clampSidebarWidth(900, 1440), 480);
    assert.equal(clampSidebarWidth(410.6, 1440), 411);
});

test('on narrow layouts the minimum wins', () => {
    assert.deepEqual(sidebarLimits(800), { min: 300, max: 300 });
    assert.equal(clampSidebarWidth(400, 800), 300);
});
