// Finds timed occurrences that overlap. All-day events (holidays, trips) are
// not treated as clashing with anything, as in most calendar apps.

export const MAX_CLASHES = 20;

// Pairs { occurrence, other } where an occurrence from `candidates` overlaps
// one from `others`. Occurrences need { allDay, start, end }; `others` should
// not include the candidates themselves. At most MAX_CLASHES pairs are returned.
export function findClashes(candidates, others) {
    const timedOthers = others.filter(o => !o.allDay).sort((a, b) => a.start - b.start);
    const clashes = [];

    for (const occurrence of candidates) {
        if (occurrence.allDay) continue;
        for (const other of timedOthers) {
            if (other.start >= occurrence.end) break;
            if (other.end > occurrence.start) {
                clashes.push({ occurrence, other });
                if (clashes.length >= MAX_CLASHES) return clashes;
            }
        }
    }
    return clashes;
}
