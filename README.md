# AI Calendar Generator

Turn natural language into calendar events, then download them as an `.ics` file you can import into Google Calendar, Apple Calendar or Outlook.

> "Gym every Monday and Wednesday at 7pm until the end of March, remind me 30 min before"
> "Vacation August 1 to 15"
> "Review on the last Friday of every month at 4pm"
> "Call with the Tokyo office Thursday 9am Tokyo time"

Then, to change what's there:

> "Move the gym to 8pm"
> "Cancel next Wednesday's gym"

## Features

- **AI input with review**: describe events in plain language. Results appear as cards you can check, edit or remove before anything is added.
- **Change events with AI**: describe a change ("move the gym to 8pm", "cancel next Wednesday's gym"). You get a before → after preview to apply or discard.
- **Events without a start time**:
  - with a day ("dentist on Friday") or a repeat ("bins out every Tuesday"), they become all-day events
  - with a length ("2-hour workshop on Friday"), they stay timed: today they start at the next half hour, on a later day at the current time of day rounded to the closest half hour
  - with none of these ("call mom"), they start now, rounded to the closest half hour, and last one hour
- **All-day events**: single days (holidays, birthdays) or ranges (trips).
- **Recurring events**:
  - daily, weekly on chosen days, or every weekday
  - monthly on a date, on days of the month ("1st and 15th", "last day"), or on a weekday of the month ("first Monday", "last Friday")
  - yearly on a date, or on a weekday of the month ("4th Thursday of November")
  - every N periods, ending on a date or after a number of times
- **Edit or delete one occurrence** of a recurring event, or the whole series.
- **Reminders**, exported as alarms so your calendar app notifies you.
- **Clash warnings** when a new or changed event overlaps another timed event.
- **Time zones**: the calendar shows events in the zone you pick (your browser's by default). Events can have their own zone ("9am Tokyo time"), and recurring events keep their local time across daylight saving changes.
- **Views**: a day and week time grid, plus month and year views, with 12h or 24h times. A mini month in the sidebar jumps to any date, and clicking an empty time slot starts a new event there.
- **Undo**: deleting events and applying AI results can be undone from the message at the bottom of the screen.
- **Keyboard shortcuts**: `c` create, `t` today, `d` / `w` / `m` / `y` change view, `j` / `k` (or `n` / `p`) next / previous, `Esc` closes dialogs, `Ctrl`/`Cmd` + `Enter` in the Ask AI box adds events.
- **Export**: a standard iCalendar file with `RRULE`, `EXDATE`, `RECURRENCE-ID`, `VALARM` and full `VTIMEZONE` definitions.

Events are kept in memory only, so refreshing the page clears them. Download them first.

## Design

The interface follows Google Calendar's conventions. It is mostly white and greys, with a blue / purple / pink accent palette:
- Event colours are picked from six shades of these three. Every colour pair passes WCAG AA contrast.
- The blue → purple → pink gradient is reserved for the logo, the Ask AI card and the Create button.

All icons and illustrations are custom SVGs; the app uses no emoji or image icons. Text uses Roboto. On screens narrower than 900px the sidebar becomes a slide-out drawer, and on phones dialogs open from the bottom.

## How it works

```
Browser (index.html + src/*.js)                    Vercel function (api/parse-event.js)
  text + time zone (+ events, to change them) ─▶   compact prompt ─▶ OpenAI (gpt-3.5-turbo, JSON mode)
  preview, then apply                         ◀─   validated events or changes
  renders calendar, generates .ics locally
```

- The model returns one entry per event, with a recurrence *rule* rather than a list of occurrences. The app expands rules itself (`src/recurrence.js`), which keeps responses small and the dates exact.
- When changing events, the model returns operations ("update event 1: time 20:00", "delete event 1 on 2026-10-21"). The browser applies them to a copy, so you can review the result before it touches your calendar (`src/events.js`).
- Prompts are kept short because they are sent with every request:
  - a one-line table of the next 7 days, since gpt-3.5 is unreliable at working out weekdays
  - short field names
  - empty fields are left out of the reply
- The server checks everything the model returns before it reaches the browser (`src/event-schema.js`, `src/change-schema.js`).

## Running locally

Requirements: Node.js 20+ and the [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`).

```bash
npm install
vercel env add OPENAI_API_KEY   # or create .env.local with OPENAI_API_KEY=sk-...
npm start                       # runs `vercel dev`, open http://localhost:3000
```

The page loads its scripts as ES modules, so it must be served over HTTP. Opening `index.html` from disk will not work.

### Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | OpenAI API key used by `api/parse-event.js` |
| `OPENAI_MODEL` | no | Model name, defaults to `gpt-3.5-turbo` |

## Tests

```bash
npm test
```

Tests use Node's built-in test runner and need no extra packages. They cover:
- time zones and recurrence rules
- event editing, single-occurrence changes and AI change plans
- reminders, clash detection and ICS output
- prompts, validation of model output, and the API handler (with OpenAI mocked)

## Project structure

```
index.html            Page markup and the SVG icon set
styles.css            Styles: design tokens, components, views, responsive rules
images/               Logo and illustrations (SVG)
src/app.js            UI state and wiring: sidebar, dialogs, AI review, undo, shortcuts
src/calendar-view.js  Markup for the time grid (day/week), month, year and mini month
src/ui.js             Icons, event colours, dialogs and toasts
src/editor.js         Event editor form (dates, all-day, repeat, reminders)
src/events.js         Event operations: drafts, series and occurrence edits, AI change plans
src/recurrence.js     Recurrence rules, expansion, exceptions and overrides
src/time.js           Time zone conversion and calendar-date arithmetic
src/ics.js            iCalendar (.ics) generation
src/reminders.js      Reminder validation and formatting
src/clashes.js        Overlap detection
src/prompt.js         System prompts for the model
src/event-schema.js   Validation of new events returned by the model
src/change-schema.js  Validation of changes returned by the model
src/format.js         Display formatting and HTML escaping
api/parse-event.js    Serverless endpoint that calls OpenAI
test/                 Unit tests
```

## API

`POST /api/parse-event`

Create events:

```json
{ "input": "Lunch with Sam tomorrow at noon", "timeZone": "Europe/Paris" }
```

Returns `200` with `{ "events": [...] }`. Each event is one of:
- timed: `{ "allDay": false, "start", "end" }` with ISO-8601 UTC timestamps
- all-day: `{ "allDay": true, "startDate", "endDate" }` with `YYYY-MM-DD` dates, the end inclusive

Both also include `title`, `timeZone`, `location`, `description`, `reminders` (minutes before) and `recurrence`.

Change events:

```json
{
  "input": "move the gym to 8pm",
  "timeZone": "Europe/Paris",
  "mode": "edit",
  "events": [{ "title": "Gym", "allDay": false, "start": "2026-10-19T19:00", "end": "2026-10-19T20:00", "timeZone": "Europe/Paris", "recurrence": null }]
}
```

Returns `200` with `{ "changes": [{ "op": "update" | "delete", "ref": 1, "on": "YYYY-MM-DD" | null, "set": { ... } }] }`:
- `ref` is the 1-based position in the `events` you sent (at most 50).
- `on` targets one occurrence of a recurring event.

Errors return `{ "error": "message" }` with status `400` (bad input), `405`, `422` (nothing found or matched), `429` (rate limited) or `502` (OpenAI failed).

Input is limited to 1000 characters, and each IP gets 20 requests per 10 minutes. The limit is best effort: it is kept in memory per function instance and resets on cold starts.

## Limitations

- No persistence: events live in the page until it is reloaded.
- Recurrence covers the patterns listed above, not every RRULE (for example, "every 2nd and 4th Tuesday in spring" won't work). Rules the editor can't show as fields are kept as they are and shown as "Custom".
- Clashes are only checked between timed events; all-day events never clash.
- Reminders on all-day events count back from midnight at the start of the day.
