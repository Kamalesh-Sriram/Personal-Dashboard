/* The view registry. Adding a tab = one file here, one line in tabs.js,
   and its id in ALL_TABS (store.js). */
import home from './home.js';
import board from './board.js';
import track from './track.js';
import habits from './habits.js';
import goals from './goals.js';
import calendar from './calendar.js';
import subs from './subs.js';
import review from './review.js';
import settings from './settings.js';

export { TAB_META } from './tabs.js';
export const VIEWS = { home, board, track, habits, goals, calendar, subs, review, settings };
