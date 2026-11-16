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
  habEdit: false,
  calMonth: null,         // Calendar: 'YYYY-MM'
  goalOpen: new Set(),
  journalDate: null,
  journalQuery: '',
  settingsTab: 'look',
  gymQuery: '', gymAll: false,          // Gym: exercise search, show the full list
  finMonth: null, finView: 'month', finQuery: '', finCat: ''   // Finance
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
