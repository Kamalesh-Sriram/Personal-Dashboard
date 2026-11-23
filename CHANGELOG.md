# Changelog

Each entry may end with an **After updating** line: something to do once, after your copy has the new version.

## 5.6.0

### Fixed

- **Devices were signed out of sync for no reason, silently.** The page asked the site for its Supabase settings once; if that one request failed (offline for a moment, waking from sleep, a redeploy in progress), it took sync to be "not set up" until reloaded, and the next sign-in renewal then signed the device out. Nothing showed it, so changes made afterwards stayed on that device only. Now a failed request is simply tried again (with the last good settings standing in), only Supabase refusing the sign-in ends it, and a sign-out is never silent: a red cloud in the top bar, a message, and the device's own notification.
- **Break challenge.** It only ever appeared during a campaign and before 25 minutes of focus, so most breaks started unchallenged, and Lock in on a task tagged with a break skipped it altogether. It now asks every time by default (Settings > Game > Breaks), wherever the break is started from.
- **Rings stopping short.** The 24-hour ring and the finance ring were cut off part-way when they had many parts to draw. They now draw to the very last part, and a busy day still takes under two seconds.
- **Red icons in the top bar** showed grey.

### Added

- **Restore points**, kept on each device: one a day and one before anything replaces the dashboard. Settings > Data.
- **Warnings before a replace.** Load my account's here and Use this device's everywhere say what would be lost and offer Combine both. Combine both is now the first choice when a device first meets an account.
- **Every notification reaches the device**: records, levels, the month's result, pulling ahead of the rival, false starts, and the end of the 15 minutes after holding off a break are now pushed too.
- **Gym:** the weekly bars rise in, with the goal line drawing across them.
- **Pulling ahead of the rival** is worked out in advance while a timer runs, so it arrives with the app closed.

### Changed

- **Nothing is running** is spaced by how much you have done: at most every hour with little done (the new default), further apart as focus hours add up, none once the target is reached, at most five a day.
- **The break challenge** shows Stayed strong and Gave in side by side over a split bar, then the rival's line and today's focus.
- **Priority flags** are bigger and sit right after the task's name. Every task title has the same brightness; High tasks are bold.
- **The notification list** in Settings says how each one reaches you.

## 5.5.1

### Fixed

- **A breathing High task's left edge was dimmer than other tasks'.** The glow now leaves the left edge alone, so it keeps the tag's full colour like every other task.

## 5.5.0

### Fixed

- **Tab animations sometimes skipped.** Opening a tab within a second of another cut its entrance short, and a redraw during the entrance (a sync, a save, Finance or Gym finishing loading) made the content snap into place. Every tab now makes its full entrance each time it is opened.
- **Priority flags broke the task card layout.** A card now shows only the coloured flag, and a long tag name stays on one line. The Low, Medium and High names are in the task editor.
- **The top bar's Status was out of line** with Local time and Date.

### Changed

- **High tasks stand out on the Tasks tab.** A bold title (and a lighter one for Low), and a soft glow in the tag's colour that breathes; turn the glow off under Settings > Layout. A task goes to the top of its column when it is added as High, raised to High, or moved while High, and can be dragged anywhere after that.
- **Home's top tasks** show priority only as the flag, right after the task's name.
- **The running bar on Track** is filled with a soft tint of the activity's colour instead of near black, and stays opaque.
- **The Status dot** takes the running activity's own colour, in every theme.
- **Campaigns have their own icon**, a crosshair, so they no longer share the priority flag.

### Added

- **Start or end a campaign from Home**, with the Campaign button on the You vs The Shadow card.

## 5.4.0

### Fixed

- **"You won" kept appearing.** Yesterday's result was announced again whenever a sync re-scored a day, which happened after almost any change: writing goals, adding a task. Two devices that froze a day with the same result but stored it slightly differently made every sync throw the day away and score it again. A day is now only re-scored when the copies disagree on the result itself, and the result is announced once, the first time the dashboard opens on a new day, on any device.
- **Calendar lines going missing** on some screens. The lines were gaps between the days, and at a zoom such as 125% or 150% (most phones) a gap could round to nothing. They are borders now, which always draw.

### Changed

- **Board is now Tasks.** Same tab, same place, same shortcut.
- **Deep work pays by focus rating.** A 5/5 block pays in full, a 4/5 80%, and so on down; one not rated yet pays as a 3/5. Day XP and level XP both. Only blocks from 23 November 2026 on, so levels already earned stay where they are.
- **Home:** the combo sits in its own cell on the right of the Lock in block, split off by a thin line, and turns green above 1.0×. Its old place under the dial shows **Days to win** the month (6/8), and the sentence that said the same is gone. A picked top task is outlined in its tag's colour, in any theme.
- **Track:** the running timer is a solid bar with a live dot; press anywhere on it to stop. The 24-hour ring has rounded blocks that keep their exact times, glow in their colour, draw in from midnight one by one, and grow when pointed at or pressed, naming the session in the middle with an Edit button.
- **Finance:** the ring has rounded, gapped, glowing slices that grow in one after the next. Day by day moved to the top right: one column per date, each labelled, the bars almost touching, and the totals for the day you point at or press. Two views: **Mixed** (one bar a day shaded red for spending to green for income; spending sets the scale and a bigger day is cut with a break mark and its amount) and **Split** (spending above a line, income below, each on its own scale).
- **Finance, less text:** the uncategorised notice is just the count and Show, and the hints beside Where it went and under the chart are gone.
- **Calendar:** the legend line under the month is gone.

### Added

- **Task priority**, Low, Medium or High, shown as a small green, yellow or red flag.
- **Gym: a weekly goal.** Set how many workouts a week you aim for. The weekly bars now show the number of workouts, the goal is a line across them, and each week's bar is green when it met the goal and red when it fell short, and **Weeks won** (all the weeks that met it) replaces weeks in a row. Press any session in your split to lay that one out instead of the one due. The next workout shows each exercise's target as sets x reps | weight, and the explanations under it are gone.
- **Coloured columns on the Tasks tab:** each column takes a faint tint of its own colour. Turn it off under Settings > Layout.
- **Lock in hold time** is a setting (Settings > Day & scoring), from 0 seconds to an hour.
- **Activity colours:** nineteen, red included, plus a picker for any colour.
- **Habits can be ticked on a day they are not due**, and earn their XP.
- **Habit notes**, under each habit.
- **Goal and milestone notes and links.** A goal's notes and links fold away; folded or closed, the note's first line shows beside the name and the links as chips under the progress. A milestone's are edited from its pencil and shown the same way.
- **Finance:** pick several categories to see their total together; tick several transactions and give them one category at once.

- **Gym: openGym without a server.** openGym's automatic backups, copied by a sync app on your phone (FolderSync) into a private storage bucket such as Cloudflare R2, are read by the Gym tab: it checks for a newer backup each time you open the tab, and every device gets the same history. Set it up under Gym in HOW-TO-USE.md.
- **Gym: openGym's WebDAV backup**, for iPhone, where no sync app can copy the backup folder. openGym uploads a backup to a WebDAV drive such as Koofr once a day, and the Gym tab reads the newest one.

**After updating:** to use the WebDAV backup, add `OPENGYM_DAV_URL`, `OPENGYM_DAV_USER` and `OPENGYM_DAV_PASSWORD` in Netlify and redeploy. To use a bucket, add `OPENGYM_S3_ENDPOINT`, `OPENGYM_S3_KEY_ID` and `OPENGYM_S3_SECRET` (and `OPENGYM_S3_BUCKET` if the address does not end in it) in Netlify and redeploy.

## 5.3.0

### Fixed

- **Reminders stopped arriving after the first one of the day.** Once a planned notification had been sent, planning the same one again later that day was refused by the database, and that refusal threw away the whole batch with it: the running-timer notice, idle callouts, everything. Test notifications were unaffected, which made it look as if notifications worked. Planning no longer touches rows that have already gone out. A timer starting or stopping is now planned at once instead of a few seconds later, and Settings > Notifications shows what was scheduled or why it could not be.

### Added

- **A level, from 1 to 100.** It sits in the top bar on every tab and is kept apart from the day's XP against the rival. It grows from the mission (by objective weight), from doing half, four fifths or all of your habits, from habits you give their own level XP, from hours of Deep work, from milestones and goals cleared, and from days won; a lost day takes some back, but never a level you have reached. Levels cost what they do in Habitica (150 XP for the first, 3,580 for the last), and what you earn grows as you climb, so an ordinary day reaches level 100 in about two years. Press it for your stats. Every value is under Settings > Game.
- **Levelling up is a moment.** The page gives way for a few seconds: the old number leaves, the new one lands in your rank's colour with rays and a sound, and the bar fills. A new rank gets a longer one. It follows the motion setting, and a press ends it.
- **Ranks are bands of levels.** Novice from level 1 up to Grand Master from 76, each with its own colour, renameable, each with the level it begins at.
- **Finance: a ring instead of a bar.** Where it went is now the main display. Each slice lifts when you point at it, and pressing it shows that category's transactions. Day by day runs across the bottom.
- **Gym: sync from your own openGym server**, beside Hevy. Both can be set at once.
- **Shopping tab.** To buy and Bought, divided into your own lists. Ticking moves an item to Bought; unticking, or its expiry date passing, moves it back. The dashboard remembers how long each thing lasts.
- **Gym: next workout.** Set your split once and the Gym tab lays out your next session from the last time you did it: exercises, working sets, and the reps and weight to aim for.
- **Gym: your lifts.** Choose which exercises to follow instead of the automatic pick.
- **Gym: openGym backups** can be imported, alongside Hevy and Strong files. Importing a newer file updates workouts already here.
- **Dial colours.** The day ring, XP ring and rival ring can each have their own colour, from the dashboard's own colours or any you pick, kept during a campaign.
- Main goals: a cross beside each line removes it.

### Changed

- The share of the working day that is left is written above the dial. The separate Day left block is gone.
- Home's rank and momentum blocks are gone: the level in the top bar replaces them. Reputation is no longer shown.
- The Gym tab is laid out in the order you use it: the last 12 weeks across the top, the next workout under it, your lifts beside recent workouts, and the full exercise list folded away.
- Only sessions of Deep activities are rated, and "Sessions rated" on Home counts only those.
- Selecting a top task lights up its whole bar instead of playing the tick.
- On a narrow phone the top bar stays on one line.
- Main goals no longer add a blank line by themselves. Lines are added with Add goal.
- Log time by hand starts at the end of the last thing you tracked.
- The Gym tab's two columns end level.

**After updating:** nothing to do. Your level is worked out from the days already stored. To sync from an openGym server, add `OPENGYM_URL` and `OPENGYM_TOKEN` in Netlify and redeploy (HOW-TO-USE.md, Gym).

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

**After updating:** to keep transactions in your own database or link a bank, run `supabase/schema.sql` again in Supabase. The new environment variables (`HEVY_API_KEY`, `ENABLEBANKING_APP_ID`, `ENABLEBANKING_PRIVATE_KEY`) are optional.

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
