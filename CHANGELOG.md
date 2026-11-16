# Changelog

## 5.2.0

### Added

- **Gym tab.** Your training history from Hevy (synced through the site's own function, which holds the API key) or from a Hevy or Strong export file. It shows progress per exercise as an estimated one-rep max, records, weekly volume, and what to try next session, worked out by double progression: more reps at the same weight until every set reaches the top of your rep range, then more weight.
- **Finance tab.** Transactions from a statement file of any bank (CSV, ABN AMRO's TXT, Revolut's CSV, CAMT.053) or from a linked bank, sorted into categories by month and by year. Correct one transaction, choose "Always", and that merchant is sorted for you from then on.
- **Bank link.** Read-only access to your own accounts through Enable Banking, for most European banks. Optional, and set up with your own Enable Banking application. It cannot move money.
- **Days that run past midnight.** Set working hours such as 07:00 to 01:00 and the day runs with them: it turns over halfway between the end of one window and the start of the next, and anything before that still counts for the day before.
- **Motion.** Panels rise in when a tab opens, a ticked box swells, fills with colour and draws its tick while rays leave it, and anything that changes place glides there. Windows, sheets and toasts ease in and out. Full, Subtle or Off under Settings > Look. Your device's "reduce motion" setting is respected.
- **Sound.** A soft tick, two notes for a finished task, a chord for the big moments, a pulse when a timer starts. Synthesised in the browser: no audio files. On or off, with a volume, under Settings > Look.
- **Dragging, everywhere.** One engine for the board, Track, habits and Home's top tasks. What you drag lifts off the page, the slot opens under it and the neighbours move aside. A short column on the board now takes a drop held below its last card.
- **Habits can be reordered**, and a habit you tick moves down to a "Done today" section after its tick has drawn.
- **A task can name its own activity**, which takes precedence over the one its tag is linked to.
- **The XP dial fills** from empty each time Home opens, with the number counting up beside it.
- **Day left** on Home: how much of your working day remains, as hours and minutes and as a share.
- **Goals, milestones and their tasks can be dragged** into order.
- **Backups carry gym history and transactions** stored on the device, and restore them on import.

### Changed

- The top bar stays in place while the page scrolls, on every screen size. It no longer shows the time left in the day: that is on Home now.
- The month's line reads "9/16 days needed to win."
- Lock in's finish button is larger, centred, and says "Mark task as done".

### Fixed

- **On an iPhone, the installed app drew under the camera cut-out**, so the menu, sync and notification buttons could not be pressed. The top bar, the side menu, the focus screen, windows and the welcome screens now keep clear of the cut-out and of the home bar.
- **Something typed could vanish when you pressed Add.** If an update arrived from another device or another tab while you were typing, pressing a button with the mouse redrew the page between the press and the release, so the click landed on nothing. The redraw now waits for the click, and unsaved typing is carried across any redraw.

## 5.1.0

### Added

- **Time on goals.** Every task inside a goal has a timer. The time shows on the task, adds up on its milestone and adds up again on the goal. Each goal can name the activity its time is logged under. A task sent to the board keeps its link: time on the card counts toward the goal, and finishing the card ticks the task off.
- **Goals side panel.** Overall progress, time spent in total and in the last 7 days, time per goal, and the next open task of each goal.
- **The month's record.** Wins and losses are now counted per calendar month and start again on the 1st. Home shows one cell per day and how many more days win the month. The calendar colours each day by its result. When a month ends you are told how it went.
- **Brief and debrief times.** Both can be set under Settings > Notifications. Left alone they follow your working hours as before. The brief now also sends a notification at its time.
- **Reorder activities.** Drag a block on the Track tab (press and hold on a phone).
- **Add goal** button on Home's main goals.

### Changed

- The Track ribbon for a running timer is one button: press anywhere on it to stop.
- The clock in the top bar shows seconds.
- Timers read mm:ss for the first hour, then hh:mm:ss.
- The running-timer notification is titled with the task (or the activity when there is no task) and says how long it has run. It refreshes about once a minute.
- Goals start closed.
- Background images are kept at up to 4K instead of 2400 pixels, and the file limit is 150 MB instead of 25 MB.
- Home's lower row shares one bottom edge. The logbook is a single column and shows the sleep and efficacy you logged.

### Fixed

- The first of Home's top tasks was filled with the accent colour, which read as an error in the red campaign theme.

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
