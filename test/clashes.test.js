import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findClashes, MAX_CLASHES } from '../src/clashes.js';

const at = (start, end, extra = {}) => ({ allDay: false, start: new Date(`2026-10-19T${start}:00Z`), end: new Date(`2026-10-19T${end}:00Z`), ...extra });

test('finds overlapping timed occurrences', () => {
    const lunch = at('12:00', '13:00', { title: 'Lunch' });
    const call = at('12:30', '13:30', { title: 'Call' });
    const gym = at('18:00', '19:00', { title: 'Gym' });
    const clashes = findClashes([lunch], [gym, call]);
    assert.equal(clashes.length, 1);
    assert.equal(clashes[0].other.title, 'Call');
});

test('back-to-back events do not clash', () => {
    assert.deepEqual(findClashes([at('12:00', '13:00')], [at('13:00', '14:00'), at('11:00', '12:00')]), []);
});

test('all-day events never clash', () => {
    const holiday = { allDay: true, startDate: '2026-10-19', endDate: '2026-10-19' };
    assert.deepEqual(findClashes([holiday], [at('12:00', '13:00')]), []);
    assert.deepEqual(findClashes([at('12:00', '13:00')], [holiday]), []);
});

test('a long event clashes with everything inside it', () => {
    const others = [at('09:00', '10:00'), at('11:00', '12:00'), at('20:00', '21:00')];
    assert.equal(findClashes([at('08:00', '18:00')], others).length, 2);
});

test('the number of clashes is capped', () => {
    const others = Array.from({ length: 50 }, () => at('12:00', '13:00'));
    assert.equal(findClashes([at('12:00', '13:00')], others).length, MAX_CLASHES);
});
