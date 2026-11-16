/* ══════════════════════════════════════════════════════════════════════
   FINANCE: reading statements and sorting transactions into categories.
   No DOM and no storage, so it runs under node --test (the one exception,
   the CAMT reader, takes the XML parser as an argument).

   A transaction, wherever it came from, is kept as

     { id, d: 'YYYY-MM-DD', a: amount, cur, n: name, m: memo, acc: account,
       cat: category id, man: true if you chose the category, src }

   Money out is negative, money in is positive.
   ══════════════════════════════════════════════════════════════════════ */
import { parseCsv, parseAmount } from './csv.js';

/* ── categories ── */
export const DEFAULT_CATS = [
  { id: 'groceries', name: 'Groceries', color: '#5FCB8B' },
  { id: 'eating', name: 'Eating out', color: '#F2793A' },
  { id: 'transport', name: 'Transport', color: '#6FB1F0' },
  { id: 'housing', name: 'Housing', color: '#8B7CF6' },
  { id: 'utilities', name: 'Bills and utilities', color: '#2BC4E0' },
  { id: 'subs', name: 'Subscriptions', color: '#EE5D8C' },
  { id: 'health', name: 'Health and fitness', color: '#56CFB2' },
  { id: 'shopping', name: 'Shopping', color: '#E0B25A' },
  { id: 'fun', name: 'Entertainment', color: '#C58AF9' },
  { id: 'travel', name: 'Travel', color: '#F26D63' },
  { id: 'education', name: 'Education', color: '#A3C94F' },
  { id: 'other', name: 'Other', color: '#9AA0A8' },
  { id: 'income', name: 'Income', color: '#2BF0A0', kind: 'income' },
  { id: 'transfer', name: 'Transfers and savings', color: '#7C86C8', kind: 'transfer' }
];
/* Words that give a merchant away. Deliberately short: your own rules
   (made by correcting a transaction) come first and do the real work. */
const HINTS = [
  ['groceries', /albert heijn|\bah to go\b|\bah \d|jumbo|lidl|aldi|\bplus\b|dirk|\bspar\b|picnic|ekoplaza|\bcoop\b|tesco|sainsbury|carrefour|rewe|edeka|kaufland|mercadona|supermar|grocer|whole foods|trader joe|walmart/],
  ['eating', /thuisbezorgd|uber ?eats|deliveroo|just ?eat|doordash|mcdonald|burger king|\bkfc\b|subway|domino|new york pizza|starbucks|restaurant|\bcafe\b|café|bakker|bakery|pizzeria|sushi|kebab|\bbar\b|brasserie|lunch|flink|gorillas/],
  ['transport', /\bns\b|ns groep|ns reizigers|ov-?chip|\bgvb\b|\bret\b|\bhtm\b|connexxion|arriva|\buber\b|bolt\.eu|\blyft\b|shell|\bbp\b|esso|total ?energies|tango|tinq|q-?park|parking|parkeren|swapfiets|flixbus|trainline|\btfl\b|tankstation|felyx|check technologies/],
  ['housing', /\bhuur\b|\brent\b|hypotheek|mortgage|woning|landlord|vve|housing/],
  ['utilities', /vattenfall|eneco|essent|greenchoice|budget energie|\bkpn\b|ziggo|odido|t-mobile|vodafone|tele2|simyo|lebara|waterbedrijf|vitens|evides|dunea|waternet|gemeente|belasting|verzekering|insurance|\bcjib\b|\bduo\b|internet|electric|energy|council tax/],
  ['subs', /netflix|spotify|disney|youtube|apple\.com\/bill|google \*|icloud|amazon prime|\bhbo\b|videoland|audible|patreon|github|openai|anthropic|notion|dropbox|adobe|microsoft|nintendo|playstation|xbox|hevy|strava|duolingo/],
  ['health', /apotheek|pharmacy|huisarts|tandarts|dentist|fysio|physio|ziekenhuis|hospital|basic-?fit|fit for free|sportcity|trainmore|anytime fitness|\bgym\b|sportschool|decathlon|myprotein|bodylab|zilveren kruis|\bvgz\b|\bcz\b zorg|menzis|zorgverzekering/],
  ['shopping', /bol\.com|amazon|zalando|coolblue|mediamarkt|ikea|\bhema\b|action|kruidvat|etos|h&m|zara|uniqlo|primark|\bnike\b|adidas|aliexpress|temu|vinted|marktplaats|ebay|apple store|wehkamp|bijenkorf|blokker|xenos|\bgamma\b|praxis|hornbach/],
  ['fun', /pathe|pathé|cinema|bioscoop|kinepolis|ticketmaster|eventim|steam|museum|concert|theater|theatre|festival|bowling|escape room/],
  ['travel', /booking\.com|airbnb|\bklm\b|transavia|ryanair|easyjet|lufthansa|british airways|eurostar|thalys|hotel|hostel|expedia|skyscanner|schiphol|\bsixt\b|hertz|europcar/],
  ['education', /universit|\btu delft\b|studielink|collegegeld|tuition|coursera|udemy|bookstore|boekhandel|studystore/],
  ['transfer', /spaarrekening|savings|\bsparen\b|own account|eigen rekening|to pocket|to vault|degiro|trade republic|bitvavo|\bbux\b|revolut top-?up|top-?up by|exchanged to|tikkie terug/],
  ['income', /salaris|salary|payroll|\bloon\b|toeslag|uitkering|stufi|studiefinanciering|dividend|refund|terugbetaling|rente\b|interest/]
];

/** The category for a transaction: your rules first, then the built-in hints. */
export function categorise(tx, rules = []) {
  const hay = `${tx.n || ''} ${tx.m || ''}`.toLowerCase();
  for (const r of rules) if (r.match && hay.includes(r.match)) return r.cat;
  for (const [cat, re] of HINTS) {
    if (cat === 'income' && tx.a < 0) continue;
    if (re.test(hay)) return cat === 'income' && tx.a <= 0 ? '' : cat;
  }
  return tx.a > 0 ? 'income' : '';
}
/** Apply the rules to everything you have not sorted by hand. Returns the changed ones. */
export function recategorise(txs, rules) {
  const changed = [];
  txs.forEach(t => { if (t.man) return; const c = categorise(t, rules); if (c !== (t.cat || '')) { t.cat = c; changed.push(t); } });
  return changed;
}
/** The text a rule should look for: the merchant, without the noise banks add. */
export const ruleKey = tx => String(tx.n || tx.m || '').toLowerCase().replace(/\s+/g, ' ').replace(/[*#]\S*$|\b\d{3,}\b/g, '').trim().slice(0, 40);

/* ── ids and dates ── */
/** A stable id from the content, so importing the same statement twice adds nothing. */
export function txId(parts) {
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519) + 0x7f4a7c15 | 0; }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
const pad = n => String(n).padStart(2, '0');
/** Most date spellings a bank uses → YYYY-MM-DD, or ''. Day comes first when in doubt (Europe). */
export function parseDate(v) {
  const s = String(v ?? '').trim();
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s))) return +m[2] > 12 ? `${m[3]}-${pad(m[1])}-${pad(m[2])}` : `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/.exec(s))) return `20${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  const t = Date.parse(s);
  if (isFinite(t)) { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  return '';
}
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const finish = (rows, src, rules) => {
  const seen = new Map();
  return rows.filter(r => r.d && r.a != null && r.a !== 0).map(r => {
    const base = [r.d, r.a.toFixed(2), r.cur || '', clean(r.n), clean(r.m), r.acc || ''];
    const k = base.join('|'), n = (seen.get(k) || 0) + 1; seen.set(k, n);            // two identical coffees on one day are two rows
    const tx = { id: r.id || txId([...base, n]), d: r.d, a: Math.round(r.a * 100) / 100, cur: (r.cur || 'EUR').toUpperCase().slice(0, 3), n: clean(r.n).slice(0, 120), m: clean(r.m).slice(0, 300), acc: clean(r.acc).slice(0, 40), cat: '', man: false, src };
    tx.cat = categorise(tx, rules);
    return tx;
  });
};

/* ── statement readers ── */
/** ABN AMRO packs the counterparty into the description. Pull it out. */
export function abnName(desc) {
  const s = String(desc || '');
  let m;
  if ((m = /\/NAME\/([^/]+)/i.exec(s))) return clean(m[1]);
  if ((m = /Naam:\s*(.+?)\s{2,}|Naam:\s*(.+?)(?:Omschrijving:|IBAN:|Kenmerk:|$)/i.exec(s))) return clean(m[1] || m[2]);
  if ((m = /^(?:BEA|GEA|eCom|iDEAL)[,:]?\s+(?:Betaalpas|Apple Pay|Google Pay)?\s*(.+?)(?:,PAS|\s{2,}|$)/i.exec(s))) return clean(m[1]);
  return clean(s).slice(0, 60);
}
const abnMemo = desc => { const m = /\/REMI\/([^/]+)/i.exec(desc) || /Omschrijving:\s*(.+?)(?:IBAN:|Kenmerk:|$)/i.exec(desc); return m ? clean(m[1]) : ''; };

const COLS = {
  date: ['completed date', 'booking date', 'transaction date', 'transactiedatum', 'boekdatum', 'boekingsdatum', 'datum', 'date', 'started date', 'value date', 'valutadatum', 'buchungstag', 'fecha', 'data'],
  amount: ['amount', 'bedrag', 'bedrag (eur)', 'transactiebedrag', 'betrag', 'importe', 'montant', 'amount (eur)', 'value'],
  debit: ['debit', 'af', 'withdrawal', 'paid out', 'money out', 'uitgaven'],
  credit: ['credit', 'bij', 'deposit', 'paid in', 'money in', 'inkomsten'],
  sign: ['af bij', 'af/bij', 'credit/debit', 'debit/credit', 'type'],
  name: ['counterparty', 'naam / omschrijving', 'naam/omschrijving', 'name', 'naam', 'naam tegenpartij', 'merchant', 'payee', 'description', 'omschrijving', 'beguenstigter/zahlungspflichtiger'],
  memo: ['reference', 'mededelingen', 'omschrijving', 'description', 'details', 'memo', 'notes', 'verwendungszweck', 'remittance information'],
  currency: ['currency', 'valuta', 'munt', 'mutatiesoort'],
  account: ['account', 'rekening', 'rekeningnummer', 'iban', 'product', 'accountnumber']
};
/** Which column is which, guessed from the header names. */
export function guessMap(header) {
  const h = header.map(x => String(x).trim().toLowerCase()), map = {};
  Object.keys(COLS).forEach(k => { for (const name of COLS[k]) { const i = h.indexOf(name); if (i >= 0 && !Object.values(map).includes(i)) { map[k] = i; break; } } });
  if (map.name == null && map.memo != null) { map.name = map.memo; }
  if (map.sign != null && !/af|bij|credit|debit|cr|dr/i.test(h[map.sign])) delete map.sign;
  return map;
}
export const mapUsable = m => m && m.date != null && (m.amount != null || m.debit != null || m.credit != null);

function fromTable(rows, map, src, rules) {
  const out = [];
  rows.forEach(r => {
    let a = map.amount != null ? parseAmount(r[map.amount]) : null;
    if (a == null && (map.debit != null || map.credit != null)) {
      const de = map.debit != null ? parseAmount(r[map.debit]) : null, cr = map.credit != null ? parseAmount(r[map.credit]) : null;
      a = (cr ? Math.abs(cr) : 0) - (de ? Math.abs(de) : 0);
    }
    if (a == null) return;
    if (map.sign != null && map.amount != null) { const sg = String(r[map.sign] || '').toLowerCase(); if (/^(af|debit|dr|d)$/.test(sg)) a = -Math.abs(a); else if (/^(bij|credit|cr|c)$/.test(sg)) a = Math.abs(a); }
    const name = map.name != null ? r[map.name] : '', memo = map.memo != null && map.memo !== map.name ? r[map.memo] : '';
    out.push({ d: parseDate(r[map.date]), a, cur: map.currency != null ? r[map.currency] : '', n: name, m: memo, acc: map.account != null ? r[map.account] : '' });
  });
  return finish(out, src, rules);
}

/** A statement file → { txs, format } or { needMap, rows, header } when the
 *  columns cannot be told apart and you have to say which is which.
 *  `xml` is a function (text → Document), passed in by the browser. */
export function readStatement(text, { rules = [], map = null, xml = null } = {}) {
  const t = String(text || '').replace(/^﻿/, '');
  if (/^\s*<\?xml|<Document[\s>]/.test(t.slice(0, 400))) {
    if (!xml) throw new Error('This browser cannot read XML statements.');
    return { txs: fromCamt(xml(t), rules), format: 'CAMT.053' };
  }
  const rows = parseCsv(t);
  if (!rows.length) throw new Error('That file is empty.');
  // ABN AMRO's TXT download: eight tab-separated columns and no header row
  if (rows[0].length === 8 && /^\d{6,}$/.test(rows[0][0]) && /^\d{8}$/.test(rows[0][2])) {
    return { format: 'ABN AMRO', txs: finish(rows.map(r => ({ d: parseDate(r[2]), a: parseAmount(r[6]), cur: r[1], n: abnName(r[7]), m: abnMemo(r[7]), acc: r[0] })), 'file', rules) };
  }
  const header = rows[0], body = rows.slice(1);
  const h = header.map(x => String(x).trim().toLowerCase());
  // Revolut: only completed rows count, and the fee is part of what left the account
  if (h.includes('completed date') && h.includes('state') && h.includes('amount')) {
    const ix = k => h.indexOf(k);
    const list = body.filter(r => !/revert|declin|fail|pending/i.test(r[ix('state')] || '')).map(r => {
      const fee = ix('fee') >= 0 ? parseAmount(r[ix('fee')]) || 0 : 0, type = (r[ix('type')] || '').toLowerCase();
      return { d: parseDate(r[ix('completed date')] || r[ix('started date')]), a: (parseAmount(r[ix('amount')]) || 0) - Math.abs(fee), cur: r[ix('currency')], n: r[ix('description')], m: /transfer|topup|exchange/.test(type) ? type.replace('topup', 'top-up') : '', acc: ix('product') >= 0 ? 'Revolut ' + r[ix('product')] : 'Revolut' };
    });
    return { txs: finish(list, 'file', rules), format: 'Revolut' };
  }
  // ABN AMRO's spreadsheet export: a header row, and the same packed description as its TXT
  if (h.includes('transactiondate') && h.includes('description') && h.includes('amount')) {
    const ix = k => h.indexOf(k);
    return { format: 'ABN AMRO', txs: finish(body.map(r => ({ d: parseDate(r[ix('transactiondate')]), a: parseAmount(r[ix('amount')]), cur: ix('mutationcode') >= 0 ? r[ix('mutationcode')] : 'EUR', n: abnName(r[ix('description')]), m: abnMemo(r[ix('description')]), acc: ix('accountnumber') >= 0 ? r[ix('accountnumber')] : '' })), 'file', rules) };
  }
  const m = map || guessMap(header);
  if (!mapUsable(m)) return { needMap: true, header, rows: body, guess: m };
  return { txs: fromTable(body, m, 'file', rules), format: 'CSV' };
}

/** ISO 20022 CAMT.053 (most European banks can export it). */
export function fromCamt(doc, rules = []) {
  const text = (el, sel) => { const n = el && el.getElementsByTagName(sel)[0]; return n ? n.textContent.trim() : ''; };
  const out = [];
  [...doc.getElementsByTagName('Stmt'), ...doc.getElementsByTagName('Rpt')].forEach(st => {
    const acc = text(st.getElementsByTagName('Acct')[0], 'IBAN') || text(st.getElementsByTagName('Acct')[0], 'Id');
    [...st.getElementsByTagName('Ntry')].forEach(e => {
      const amtEl = e.getElementsByTagName('Amt')[0];
      const debit = text(e, 'CdtDbtInd') === 'DBIT';
      const amt = parseFloat(amtEl ? amtEl.textContent : '');
      if (!isFinite(amt)) return;
      const who = debit ? e.getElementsByTagName('Cdtr')[0] : e.getElementsByTagName('Dbtr')[0];
      const memo = [...e.getElementsByTagName('Ustrd')].map(x => x.textContent.trim()).join(' ') || text(e, 'AddtlNtryInf');
      const name = text(who, 'Nm') || abnName(text(e, 'AddtlNtryInf')) || memo;
      out.push({ id: text(e, 'AcctSvcrRef') ? 'c-' + text(e, 'AcctSvcrRef') : '', d: parseDate(text(e.getElementsByTagName('BookgDt')[0], 'Dt') || text(e.getElementsByTagName('BookgDt')[0], 'DtTm') || text(e.getElementsByTagName('ValDt')[0], 'Dt')),
        a: debit ? -amt : amt, cur: amtEl.getAttribute('Ccy') || 'EUR', n: name, m: memo, acc });
    });
  });
  if (!out.length) throw new Error('No transactions were found in that statement.');
  return finish(out, 'file', rules);
}

/** One transaction from the bank link (Enable Banking's shape), same form as the rest. */
export function fromBank(t, account, rules = []) {
  const amt = parseFloat((t.transaction_amount || {}).amount);
  if (!isFinite(amt)) return null;
  const debit = t.credit_debit_indicator === 'DBIT';
  const memo = Array.isArray(t.remittance_information) ? t.remittance_information.join(' ') : String(t.remittance_information || '');
  const name = ((debit ? t.creditor : t.debtor) || {}).name || abnName(memo);
  const d = parseDate(t.booking_date || t.value_date || t.transaction_date);
  if (!d) return null;
  const ref = t.entry_reference || t.transaction_id;
  return finish([{ id: ref ? 'b-' + txId([account, ref]) : '', d, a: debit ? -Math.abs(amt) : Math.abs(amt), cur: (t.transaction_amount || {}).currency, n: name, m: memo, acc: account }], 'bank', rules)[0] || null;
}

/* ── the numbers on the page ── */
const kindOf = (cats, id) => (cats.find(c => c.id === id) || {}).kind || 'spend';
/** Totals for a set of transactions. Transfers are left out of both sides. */
export function totals(txs, cats) {
  let spent = 0, income = 0;
  const by = new Map();
  txs.forEach(t => {
    const k = kindOf(cats, t.cat);
    if (k === 'transfer') return;
    if (t.a > 0 && k === 'income') { income += t.a; return; }
    // a refund lowers the category it came back to
    spent -= t.a;
    by.set(t.cat || '', (by.get(t.cat || '') || 0) - t.a);
  });
  const rows = [...by.entries()].map(([id, v]) => ({ id, v })).filter(r => Math.abs(r.v) >= 0.005).sort((a, b) => b.v - a.v);
  return { spent, income, net: income - spent, rows };
}
export const inMonth = (txs, ym) => txs.filter(t => t.d.slice(0, 7) === ym);
export const inYear = (txs, y) => txs.filter(t => t.d.slice(0, 4) === String(y));
/** Twelve months of a year: [{ ym, spent, income }]. */
export function yearMonths(txs, y, cats) {
  return Array.from({ length: 12 }, (_, i) => { const ym = `${y}-${pad(i + 1)}`, t = totals(inMonth(txs, ym), cats); return { ym, spent: t.spent, income: t.income, rows: t.rows }; });
}
