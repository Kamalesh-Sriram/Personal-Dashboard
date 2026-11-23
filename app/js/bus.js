/* Ephemeral UI state and the two functions every view needs. Kept in its
   own module so views never import main.js (which imports them). */

export const ui = {
  tab: 'home',
  day: null,              // the calendar day the app last rendered for
  drawer: false,          // sidebar open while in drawer mode
  selCard: null,          // task chosen on Home for Lock in
  sessView: 'list',       // Track: list | timeline
  trackDate: null,        // Track: day being viewed
  habOpen: new Set(),     // Habits: expanded maps
  habNotes: new Set(),    // Habits: notes open
  habEdit: false,
  calMonth: null,         // Calendar: 'YYYY-MM'
  goalOpen: new Set(),
  goalNotesShut: new Set(), // Goals: notes and links folded away
  journalDate: null,
  journalQuery: '',
  settingsTab: 'look',
  shopQuery: '', shopKind: '', shopAll: false,   // Shopping: search, the list new items go to
  gymQuery: '', gymAll: false,          // Gym: exercise search, show the full list
  finMonth: null, finView: 'month', finQuery: '', finCats: [], finSel: new Set(), finDay: null, finDraw: true, finScroll: false,   // Finance
  entering: false,        // the view being drawn is a tab just opened
  ringSel: null,          // Track: the block picked on the 24-hour ring
  gymExOpen: false, selPulse: null
};

let _refresh = () => {};
export const setRefresh = fn => { _refresh = fn; };
/** Re-render the current view. Saving state does this automatically; call
 *  it directly only after changing something in `ui`. */
export const refresh = () => _refresh();

export function go(tab) {
  if (location.hash === '#/' + tab) refresh();
  else location.hash = '#/' + tab;
}
