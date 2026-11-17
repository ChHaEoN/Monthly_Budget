import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeFile, buildTransactions, parseAmount, parseDate, detectDelimiter, decodeBytes } from '../js/parse.js';
import { categorize, applyRules, suggestKeyword } from '../js/categorize.js';
import { emptyState, mergeTransactions, summarizeMonth, shiftMonth, normalizeState } from '../js/store.js';

const sample = (name) => readFileSync(new URL(`./samples/${name}`, import.meta.url), 'utf8');
const load = (name) => {
  const a = analyzeFile(sample(name), name);
  return { a, ...buildTransactions(a, { source: a.source, flip: a.flip }) };
};

test('parseAmount handles German and English formats', () => {
  assert.equal(parseAmount('-1.234,56', ','), -1234.56);
  assert.equal(parseAmount('1.150,00 €', ','), 1150);
  assert.equal(parseAmount('1,234.56', '.'), 1234.56);
  assert.equal(parseAmount('12,50-', ','), -12.5);
  assert.equal(parseAmount('(8.99)', '.'), -8.99);
  assert.ok(Number.isNaN(parseAmount('', ',')));
});

test('parseDate handles common formats', () => {
  assert.equal(parseDate('30.10.26'), '2026-10-30');
  assert.equal(parseDate('01.09.2026'), '2026-09-01');
  assert.equal(parseDate('28/10/2026'), '2026-10-28');
  assert.equal(parseDate('2026-10-05'), '2026-10-05');
  assert.equal(parseDate('Zeitraum'), null);
});

test('decodeBytes falls back to windows-1252', () => {
  assert.equal(decodeBytes(new Uint8Array([0x47, 0x65, 0x62, 0xfc, 0x68, 0x72])), 'Gebühr');
});

test('DKB: skips preamble and pending rows, picks counterparty', () => {
  const { a, txs, pending } = load('dkb.csv');
  assert.equal(a.source, 'dkb');
  assert.equal(a.flip, false);
  assert.equal(pending, 1);
  assert.equal(txs.length, 12);
  assert.deepEqual(txs[0], { date: '2026-10-30', amount: 3200, desc: 'Beispiel GmbH · Gehalt Oktober 2026', source: 'dkb' });
  assert.equal(txs.find((t) => t.amount === -1150).desc, 'Hausverwaltung Nord · Miete Oktober');
});

test('AMEX: comma-delimited, charges flipped to negative', () => {
  const { a, txs } = load('amex.csv');
  assert.equal(detectDelimiter(sample('amex.csv')), ',');
  assert.equal(a.source, 'amex');
  assert.equal(a.flip, true);
  assert.equal(txs.length, 6);
  assert.equal(txs[1].amount, -289);
  assert.equal(txs[0].amount, 412.3);
});

test('Amazon Visa: detected by filename, already-negative charges not flipped', () => {
  const { a, txs } = load('amazon-visa.csv');
  assert.equal(a.source, 'amazon');
  assert.equal(a.flip, false);
  assert.equal(txs[1].amount, -34.99);
  assert.equal(txs[1].date, '2026-10-22');
});

test('categorize: default rules, source scoping, fallbacks', () => {
  const c = (desc, source = 'dkb', amount = -1) => categorize({ desc, source, amount });
  assert.equal(c('REWE Markt GmbH · REWE SAGT DANKE'), 'groceries');
  assert.equal(c('AMERICAN EXPRESS EUROPE S.A. · Abrechnung'), 'transfer');
  assert.equal(c('ZAHLUNG/ÜBERWEISUNG ERHALTEN BESTEN DANK', 'amex', 400), 'transfer');
  assert.equal(c('UBER *EATS HELP.UBER.COM', 'amex'), 'dining');
  assert.equal(c('UBER *TRIP HELP.UBER.COM', 'amex'), 'transport');
  assert.equal(c('Uber Eats Berlin', 'amex'), 'dining');
  assert.equal(c('Amazon Prime*AB12CD', 'amazon'), 'subscriptions');
  assert.equal(c('AMZN Mktp DE*2K4LM0AB5', 'amazon'), 'shopping');
  assert.equal(c('Metier Studio', 'amex'), 'uncat');
  assert.equal(c('Erika Musterfrau · Danke', 'dkb', 20), 'income');
  assert.equal(c('Unbekannt', 'amex', 20), 'uncat');
  assert.equal(categorize({ desc: 'KLEINER LADEN', source: 'amex', amount: -1 }, [{ keyword: 'kleiner laden', category: 'groceries', source: '' }]), 'groceries');
});

test('categorize: DKB Visa debit format (Merchant.Name/City) and real-world patterns', () => {
  const c = (desc, source = 'dkb', amount = -1) => categorize({ desc, source, amount });
  const visa = ' · VISA Debitkartenumsatz vom 13.02.2026';
  assert.equal(c(`LEBENSMITTEL.ASIA.MARKT/Berlin${visa}`), 'groceries');
  assert.equal(c(`EDK.FOODCONCEPT/BERLIN${visa}`), 'groceries');
  assert.equal(c(`SumUp...Coffee.Shop/Berlin${visa}`), 'dining');
  assert.equal(c(`Bio.Company/Berlin${visa}`), 'groceries');
  assert.equal(c(`Parkhaus Mitte${visa}`), 'transport');
  assert.equal(c(`Transports Metropolitans de Barcelona${visa}`), 'transport');
  assert.equal(c('WWW.DEUTSCHEBAHN.COM (N BERLIN', 'amex'), 'transport');
  assert.equal(c('BOOKING.COM AMSTERDAM', 'amex'), 'travel');
  assert.equal(c(`APPLE.COM.BILL/ITUNES.COM${visa}`), 'subscriptions');
  assert.equal(c('eprimo GmbH Flughafenstrase 20 · eprimo sagt danke'), 'housing');
  assert.equal(c('Stadtkasse Musterstadt · 123/Kita freie Traeger Beitrag'), 'childcare');
  assert.equal(c(`PayPal - Ratenzahlung${visa}`), 'loan');
  assert.equal(c(`Sparkasse Musterstadt${visa}`), 'cash');
  assert.equal(suggestKeyword(`LS.Kugel.UG/Musterstadt${visa}`), 'kugel ug');
  assert.equal(suggestKeyword(`SumUp...Kugel.UG..haft/Musterstadt${visa}`), 'kugel ug');
  assert.equal(suggestKeyword(`Hitchcoq/Musterstadt${visa}`), 'hitchcoq');
});

test('suggestKeyword', () => {
  assert.equal(suggestKeyword('KLEINER LADEN BERLIN'), 'kleiner laden');
  assert.equal(suggestKeyword('REWE Markt GmbH · REWE SAGT DANKE 1234'), 'rewe markt');
  assert.equal(suggestKeyword('PAYPAL *KLEINERLADEN 35314369001'), 'kleinerladen');
  assert.equal(suggestKeyword('Kartenzahlung Blumen Schmidt Berlin'), 'blumen schmidt');
  assert.equal(suggestKeyword('UBER *EATS HELP.UBER.COM'), 'uber eats');
  // 建議的關鍵字一定要能比對回原本的交易
  for (const desc of ['PAYPAL *KLEINERLADEN 35314369001', 'SUMUP *Cafe_Luna Berlin', 'Kartenzahlung Blumen Schmidt Berlin']) {
    assert.equal(categorize({ desc, source: 'amex', amount: -1 }, [{ keyword: suggestKeyword(desc), category: 'other', source: '' }]), 'other', desc);
  }
  assert.equal(categorize({ desc: 'PAYPAL *NETFLIX', source: 'amex', amount: -1 }), 'subscriptions');
});

test('merge dedupes re-imports but keeps genuine same-day duplicates', () => {
  const state = emptyState();
  const { txs } = load('dkb.csv');
  assert.deepEqual(mergeTransactions(state, txs), { added: 12, duplicates: 0 });
  assert.equal(state.transactions.filter((t) => t.desc.startsWith('Baeckerei')).length, 2);
  assert.deepEqual(mergeTransactions(state, txs), { added: 0, duplicates: 12 });
  assert.equal(state.transactions.length, 12);
});

test('monthly summary excludes card settlements and nets refunds', () => {
  const state = emptyState();
  for (const f of ['dkb.csv', 'amex.csv', 'amazon-visa.csv']) mergeTransactions(state, load(f).txs);
  const s = summarizeMonth(state, '2026-10');
  // DKB: 54.20 + 4.10*2 + 39.95 + 1150 = 1252.35
  // AMEX: 289 + 42.50 + 23.90 + 17 + 13.99 = 386.39
  // Amazon: 34.99 - 12 + 8.99 + 58 = 89.98
  assert.equal(s.bySource.dkb, 1252.35);
  assert.equal(s.bySource.amex, 386.39);
  assert.equal(s.bySource.amazon, 89.98);
  assert.equal(s.spend, 1728.72);
  assert.equal(s.income, 3220);
  assert.equal(s.net, 1491.28);
  assert.equal(s.byCategory[0].id, 'housing');
  assert.equal(summarizeMonth(state, '2026-09').spend, 1211.75);
});

test('manual categories survive rule re-application', () => {
  const state = emptyState();
  mergeTransactions(state, load('amex.csv').txs);
  const tx = state.transactions.find((t) => t.desc.startsWith('KLEINER'));
  assert.equal(tx.category, 'uncat');
  const netflix = state.transactions.find((t) => t.desc.startsWith('NETFLIX'));
  netflix.category = 'other';
  netflix.manual = true;
  state.userRules.unshift({ keyword: 'kleiner laden', category: 'groceries', source: '' });
  assert.equal(applyRules(state.transactions, state.userRules), 1);
  assert.equal(tx.category, 'groceries');
  assert.equal(netflix.category, 'other');
});

test('shiftMonth and normalizeState', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.throws(() => normalizeState({ transactions: 'x' }));
  assert.equal(normalizeState(null).transactions.length, 0);
});
