import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReminder, normalizeReminders, reminderTrigger } from '../src/reminders.js';

test('normalizeReminders keeps valid, unique minutes in order', () => {
    assert.deepEqual(normalizeReminders([60, 10, '30', 10, -1, 1.5, null, 999999]), [10, 30, 60]);
    assert.deepEqual(normalizeReminders(15), [15]);
    assert.deepEqual(normalizeReminders(undefined), []);
    assert.deepEqual(normalizeReminders([1, 2, 3, 4, 5, 6, 7]), [1, 2, 3, 4, 5]);
});

test('formatReminder', () => {
    assert.equal(formatReminder(0), 'At start time');
    assert.equal(formatReminder(30), '30 min before');
    assert.equal(formatReminder(60), '1 hour before');
    assert.equal(formatReminder(1440), '1 day before');
    assert.equal(formatReminder(1590), '1 day 2 hours 30 min before');
    assert.equal(formatReminder(10080), '1 week before');
});

test('reminderTrigger produces iCalendar durations', () => {
    assert.equal(reminderTrigger(0), 'PT0M');
    assert.equal(reminderTrigger(30), '-PT30M');
    assert.equal(reminderTrigger(120), '-PT2H');
    assert.equal(reminderTrigger(1440), '-P1D');
    assert.equal(reminderTrigger(1590), '-P1DT2H30M');
});
