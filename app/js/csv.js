/* A small CSV reader for the file imports (gym history, bank statements).
   Handles quoted fields, doubled quotes, a byte-order mark, and files that
   use semicolons or tabs instead of commas. No dependency, no DOM. */

/** Text → array of rows, each an array of strings. */
export function parseCsv(text, delimiter = null) {
  let s = String(text || '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const d = delimiter || guessDelimiter(s);
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === d) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
/** Whichever of , ; tab splits the first lines into the most columns. */
export function guessDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  let best = ',', n = 0;
  for (const d of [',', ';', '\t', '|']) {
    const k = head.split(d).length;
    if (k > n) { n = k; best = d; }
  }
  return best;
}
/** Rows → objects keyed by a normalised header ("Workout Name" → "workout name"). */
export function toObjects(rows) {
  if (!rows.length) return { header: [], items: [] };
  const header = rows[0].map(h => String(h).trim().toLowerCase());
  return { header, items: rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}
/** "1.234,56", "1,234.56", "-12,5", "€ 12.50", "(12.50)" → a number, or null. */
export function parseAmount(v) {
  let s = String(v ?? '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-|-$/.test(s.replace(/[^\d,.\-]/g, ''));
  s = s.replace(/[^\d,.]/g, '');
  if (!s) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > ld) s = s.replace(/\./g, '').replace(',', '.');           // comma is the decimal mark
  else s = s.replace(/,/g, '');                                      // dot is, or there is none
  const n = parseFloat(s);
  return isFinite(n) ? (neg ? -n : n) : null;
}
