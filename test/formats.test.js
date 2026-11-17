import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readXlsx } from '../js/xlsx.js';
import { analyzeRows, buildTransactions } from '../js/parse.js';
import { extractTransactions, detectPdfSource, groupLines, pagesText } from '../js/pdf-text.js';

test('xlsx: reads strings, date cells and numbers; imports like the CSV', async () => {
  const buf = readFileSync(new URL('./samples/amex.xlsx', import.meta.url));
  const rows = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.deepEqual(rows[2], ['Datum', 'Beschreibung', 'Karteninhaber', 'Konto #', 'Betrag']);
  assert.deepEqual(rows[4], ['21.10.2026', 'LUFTHANSA 2201234567 FRANKFURT', 'MAX MUSTERMANN', '-12345', '289']);
  assert.equal(rows[5][1], 'RESTAURANT SAIGON & CO BERLIN');
  const a = analyzeRows(rows, 'activity.xlsx');
  assert.equal(a.source, 'amex');
  assert.equal(a.flip, true);
  const { txs, skipped } = buildTransactions(a, { source: a.source, flip: a.flip });
  assert.equal(skipped, 0);
  assert.deepEqual(txs.map((t) => t.amount), [412.3, -289, -42.5, -23.9, -13.99]);
  assert.equal(txs[1].date, '2026-10-21');
});

test('xlsx: rejects non-zip input', async () => {
  await assert.rejects(readXlsx(new TextEncoder().encode('not a zip file at all, just text').buffer));
});

// 以座標模擬 PDF 文字：每列 [y, [x, 文字, 寬度]...]
const page = (rows) => rows.flatMap(([y, ...cells]) => cells.map(([x, str, w = str.length * 5]) => ({ str, x, y, w })));

test('pdf: groups split text items into lines', () => {
  const lines = groupLines(page([[700, [50, 'REWE'], [75, 'SAGT'], [100.5, 'DANKE']], [688.4, [50, 'Berlin']], [700.8, [500, '54,20']]]));
  assert.deepEqual(lines.map((l) => l.text), ['REWE SAGT DANKE 54,20', 'Berlin']);
});

test('pdf: signed amounts, continuation lines, balance rows skipped', () => {
  const { transactions, signed } = extractTransactions([page([
    [800, [50, 'Deutsche Kreditbank AG']],
    [780, [50, 'Kontoauszug 10/2026 vom 31.10.2026']],
    [740, [50, 'Datum'], [120, 'Erläuterung'], [500, 'Betrag EUR']],
    [720, [50, '30.09.2026'], [120, 'Alter Kontostand'], [500, '2.000,00']],
    [700, [50, '01.10.2026'], [120, 'Dauerauftrag Hausverwaltung Nord'], [495, '-1.150,00']],
    [688, [120, 'Miete Oktober']],
    [668, [50, '12.10.2026'], [120, 'Kartenzahlung REWE Markt GmbH'], [510, '-54,20']],
    [648, [50, '30.10.2026'], [120, 'Gehalt Beispiel GmbH'], [495, '+3.200,00']],
    [620, [50, '31.10.2026'], [120, 'Neuer Kontostand'], [500, '3.995,80']],
    [100, [50, 'Seite 1 von 1']],
  ])]);
  assert.equal(signed, true);
  assert.deepEqual(transactions, [
    { date: '2026-10-01', desc: 'Dauerauftrag Hausverwaltung Nord Miete Oktober', amount: -1150 },
    { date: '2026-10-12', desc: 'Kartenzahlung REWE Markt GmbH', amount: -54.2 },
    { date: '2026-10-30', desc: 'Gehalt Beispiel GmbH', amount: 3200 },
  ]);
});

test('pdf: unsigned amounts take their sign from the debit/credit column; year-less dates', () => {
  const { transactions, signed } = extractTransactions([page([
    [780, [50, 'Kontoauszug Nummer 001 / 2027 vom 04.01.2027']],
    [740, [50, 'Bu.Tag'], [90, 'Wert'], [130, 'Wir haben für Sie gebucht'], [380, 'Belastung in EUR', 80], [480, 'Gutschrift in EUR', 80]],
    [700, [50, '28.12.'], [90, '28.12.'], [130, 'Lastschrift Telekom Deutschland'], [430, '39,95', 30]],
    [680, [50, '02.01.'], [90, '02.01.'], [130, 'Überweisung Erika Musterfrau'], [530, '20,00', 30]],
  ])]);
  assert.equal(signed, true);
  assert.deepEqual(transactions, [
    { date: '2026-12-28', desc: 'Lastschrift Telekom Deutschland', amount: -39.95 },
    { date: '2027-01-02', desc: 'Überweisung Erika Musterfrau', amount: 20 },
  ]);
});

test('pdf: card statement with two dates, CR credits and large amounts', () => {
  const amexPages = [page([
    [800, [50, 'American Express Europe S.A.']],
    [780, [50, 'Abrechnung vom 31.10.26']],
    [700, [50, '21.10.26'], [100, '22.10.26'], [150, 'LUFTHANSA 2201234567 FRANKFURT'], [500, '1289,00']],
    [680, [50, '18.10.26'], [100, '19.10.26'], [150, 'RESTAURANT SAIGON BERLIN'], [500, '42,50']],
    [660, [50, '28.10.26'], [100, '28.10.26'], [150, 'ZAHLUNG ERHALTEN. BESTEN DANK'], [500, '412,30 CR']],
    [640, [150, 'Saldo des laufenden Monats'], [500, '919,20']],
  ])];
  assert.equal(detectPdfSource(pagesText(amexPages), 'statement.pdf'), 'amex');
  const { transactions, signed } = extractTransactions(amexPages, { card: true });
  assert.equal(signed, true);
  assert.deepEqual(transactions.map((t) => [t.date, t.desc, t.amount]), [
    ['2026-10-21', 'LUFTHANSA 2201234567 FRANKFURT', -1289],
    ['2026-10-18', 'RESTAURANT SAIGON BERLIN', -42.5],
    ['2026-10-28', 'ZAHLUNG ERHALTEN. BESTEN DANK', 412.3],
  ]);
  assert.equal(detectPdfSource('Kontoauszug\nDeutsche Kreditbank AG\nLastschrift AMERICAN EXPRESS', 'x.pdf'), 'dkb');
  assert.equal(detectPdfSource('Abrechnung', 'Zinia_2026_10.pdf'), 'amazon');
});
