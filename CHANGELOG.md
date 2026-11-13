# Changelog

## 5.0.1

### Fixed

- **Sync never uploaded a real dashboard.** Uploads were sent in a mode browsers cap at 64 KB, so anything larger failed with "Failed to fetch" while a small, empty dashboard from another device went through.
- **A second device started from scratch.** The welcome screen now offers "I already have a dashboard. Sign in", which loads your dashboard instead of making a new one.
- **Two different dashboards on one account.** The first time a device meets an account that already holds a dashboard, it asks which one to keep. Settings > Sync has buttons to put the right copy everywhere later.
- **Test notifications were invisible** when the app was on screen. A test is now always shown.
- The tick in small checkboxes sat off-centre.

### Changed

- Home is built around four blocks: you against the rival, the mission, Lock in, and top tasks. Habits are a single count that links to the Habits tab.
- Quieter text on the board, a single-column Goals list, green XP on the calendar, and habit names in the reading typeface.
- Habit levels are now Starting, Building, Consistent, Established and Mastered.

## 5.0.0

A rebuild. The single 300 KB page of version 4 becomes a small modular app that anyone can fork and run as their own.

### For everyone

- **Welcome setup.** Name the dashboard, pick a look, set your day.
- **Sidebar navigation.** Tabs move from the bottom bar to a slim strip on the left that expands to show names, or hides entirely. Number keys jump between tabs.
- **Themes.** Light, dark or system. Any accent colour, with the whole backdrop tinted to match. Five typefaces. Your own background image with dimming, blur and panel opacity, kept readable by built-in limits.
- **Everything renameable.** The rival, the Lock in button, the mission panel, rank, reputation, the rank ladder, board columns, and every sentence the notifications use.
- **Installable everywhere.** Windows, macOS, Android and iOS, with notifications in Chrome, Edge, Firefox and Safari.

### Home

- **Main goals.** Your lasting goals, written out fresh each morning. What you wrote last time shows as a faint prompt, there is no limit on how many, and writing them earns XP.
- **Top tasks.** The first three tasks from the board's Today column, ready to lock in on.
- **The Day Dial.** One gauge for your XP, the rival's pace right now, and where he will finish.
- **Logbook.** Sleep, session ratings, efficacy and the debrief each earn XP for being recorded.

### The rival

- **He now adapts every day.** His bar is 60% of your seven-day average plus 40% of your last day, plus an adjustable edge. In version 4 he was a fixed 90% of your best day in 30.
- He never exceeds your 30-day best, drops at most 8% a day, and ignores rest days.

### Rest days

- A rest day is not scored: no win, no loss, no reputation change, and habit streaks freeze instead of breaking. A weekly allowance keeps it honest. Works in normal and campaign mode, for today or a past day.

### Board

- **Tags decide the timer.** Each tag links to an activity, so locking in on a task logs time in the right place.
- **Duplicate** a task with its name, tag, estimate, deadline, notes and steps.
- **Steps** (sub-tasks) with a progress bar on the card.
- Tasks are coloured by their tag, and a new tag picks its own colour from the palette. Columns can be renamed, added, removed and reordered.
- The Done column empties each morning (optional). The day a task was finished keeps the credit.

### Track

- Activities grouped by weight, a 24-hour ring of the day, a lane timeline, and one-tap focus ratings.
- A timer running past midnight is split so each day owns its own time.

### Habits

- Streak and XP level are large and always visible, with what today's check-off will earn.
- **Clean-sweep chain.** Doing every due habit pays a bonus that grows with each consecutive day.
- A combined habit map plus one per habit. Past days can be corrected.
- Streak and XP are computed from history, so they cannot drift between devices.

### Under the hood

- No build step and no dependencies.
- **Sync now needs a login.** Version 4 kept everything in a database table readable by anyone who viewed the page source. Version 5 uses Supabase sign-in with row level security.
- A strict Content-Security-Policy, with no inline scripts and no third-party scripts.
- Push notifications are tied to the signed-in user.
- Works offline.
- Tests for the scoring engine and the merge logic.

### Moving from version 4

Settings > Data > Import from v4 brings over activities, sessions, habits, the board, goals, subscriptions and the journal. See the last section of HOW-TO-USE.md.
