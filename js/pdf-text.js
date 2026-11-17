// 從 PDF 的文字座標還原帳單交易：純函式，瀏覽器與 Node 測試共用。
// 輸入 pages：每頁是一組 { str, x, y, w }（y 為 PDF 座標，越大越靠上）。

const AMOUNT = /(?:^|\s)([+\-−]?)\s?((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s?(-|−|\+|S|H|CR)?$/;
const DATE = /^(\d{1,2})[./](\d{1,2})[./]((?:\d{4}|\d{2})(?!\d))?\s*/;
// 餘額、小計等不是交易的列
const NOT_A_TRANSACTION = /saldo|kontostand|übertrag|uebertrag|summe|gesamt|zwischensumme|neuer stand|alter stand|rechnungsbetrag|mindestbetrag|kreditrahmen|verfügungsrahmen|verfügbar|abschluss/i;

/** 把同一水平位置的文字合併成一列，由上到下、由左到右。 */
export function groupLines(items) {
  const sorted = items.filter((it) => it.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - it.y) <= 2.5) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const it of line.items) {
      if (end != null && it.x - end > 1 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      end = it.x + (it.w ?? 0);
    }
    line.text = text.replace(/\s+/g, ' ').trim();
    line.x = line.items[0].x;
    line.right = Math.max(...line.items.map((it) => it.x + (it.w ?? 0)));
  }
  return lines;
}

function parseAmountToken(text) {
  const m = text.replace(/\s?(EUR|€)$/, '').match(AMOUNT);
  if (!m) return null;
  const value = Number(m[2].replace(/\./g, '').replace(',', '.'));
  const negative = m[1] === '-' || m[1] === '−' || m[3] === '-' || m[3] === '−' || m[3] === 'S';
  const positive = m[1] === '+' || m[3] === '+' || m[3] === 'H' || m[3] === 'CR';
  return { value, negative, positive, rest: text.slice(0, m.index).trim() };
}

/** 找出「借方／貸方」兩個金額欄的位置（舊版 DKB 對帳單的金額不帶正負號，靠欄位區分）。 */
function findColumns(lines) {
  for (const line of lines) {
    const debit = line.items.find((it) => /^(soll|belastung(en)?)\b/i.test(it.str.trim()));
    const credit = line.items.find((it) => /^(haben|gutschrift(en)?)\b/i.test(it.str.trim()));
    if (debit && credit) return { debit: debit.x + (debit.w ?? 0), credit: credit.x + (credit.w ?? 0) };
  }
  return null;
}

/** 文件中最晚的完整日期，用來補上「12.10.」這類沒有年份的日期。 */
function statementDate(lines) {
  let latest = null;
  for (const line of lines) {
    for (const m of line.text.matchAll(/(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/g)) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const mo = Number(m[2]);
      if (mo < 1 || mo > 12 || y < 2000 || y > 2100) continue;
      const key = y * 100 + mo;
      if (!latest || key > latest.key) latest = { key, year: y, month: mo };
    }
  }
  return latest;
}

const pad = (n) => String(n).padStart(2, '0');

export const pagesText = (pages) => pages.flatMap(groupLines).map((l) => l.text).join('\n');

/**
 * 回傳 { transactions: [{ date, desc, amount }], signed }，amount 一律「負數 = 支出」。
 * 銀行帳戶對帳單：有負號／S／位於借方欄 → 支出，其餘為入帳。
 * 信用卡帳單（card: true）：沒有標記的金額是消費（支出）；帶 CR、H、+ 或 - 的是退款或繳款（入帳）。
 * signed：正負號是否有依據（明確標記、借貸欄位或信用卡慣例）；false 表示全部沒標記、只能猜。
 */
export function extractTransactions(pages, { card = false } = {}) {
  const pageLines = pages.map(groupLines);
  const all = pageLines.flat();
  const ref = statementDate(all);
  const transactions = [];
  let signed = false;

  for (const lines of pageLines) {
    const columns = findColumns(lines) ?? findColumns(all);
    let current = null;
    let lastY = null;
    for (const line of lines) {
      const dateMatch = line.text.match(DATE);
      const body = dateMatch ? line.text.slice(dateMatch[0].length).replace(DATE, '') : line.text;
      const amount = dateMatch ? parseAmountToken(body) : null;

      if (dateMatch && amount && !NOT_A_TRANSACTION.test(amount.rest)) {
        const d = Number(dateMatch[1]);
        const mo = Number(dateMatch[2]);
        let y = dateMatch[3] ? Number(dateMatch[3]) : null;
        if (y != null && y < 100) y += 2000;
        if (y == null && ref) y = mo > ref.month + 1 ? ref.year - 1 : ref.year;
        if (y != null && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          let value = amount.value;
          if (card) {
            if (!amount.negative && !amount.positive) value = -value;
          } else if (amount.negative) value = -value;
          else if (!amount.positive && columns) {
            // 金額靠右對齊在欄位標題下方：離借方欄較近就是支出
            if (Math.abs(line.right - columns.debit) < Math.abs(line.right - columns.credit)) value = -value;
          }
          if (card || amount.negative || amount.positive || columns) signed = true;
          current = { date: `${y}-${pad(mo)}-${pad(d)}`, desc: amount.rest, amount: value, extra: 0 };
          transactions.push(current);
          lastY = line.y;
          continue;
        }
      }
      // 交易說明的續行：緊接在交易列下方、沒有日期也沒有金額
      const isContinuation = current && !dateMatch && current.extra < 3 && lastY - line.y <= 16
        && !parseAmountToken(line.text) && !NOT_A_TRANSACTION.test(line.text) && line.text.length <= 90;
      if (isContinuation) {
        current.desc = `${current.desc} ${line.text}`.trim();
        current.extra++;
        lastY = line.y;
      } else {
        current = null;
      }
    }
  }
  for (const t of transactions) {
    delete t.extra;
    t.desc = t.desc.replace(/\s+/g, ' ').trim() || '(無說明)';
  }
  return { transactions, signed };
}

/** 依對帳單文字判斷來源：先看第一頁開頭的抬頭，再看全文。 */
export function detectPdfSource(text, filename = '') {
  const f = filename.toLowerCase();
  const pick = (s) => {
    if (/zinia|amazon\s*(\.de\s*)?visa|open bank/i.test(s)) return 'amazon';
    if (/american express|amex/i.test(s)) return 'amex';
    if (/deutsche kreditbank|\bdkb\b/i.test(s)) return 'dkb';
    return '';
  };
  const head = text.split('\n').slice(0, 15).join('\n');
  // 「Kontoauszug」只會出現在銀行帳戶對帳單；DKB 帳單裡常有繳給 AMEX 的交易，所以要先判斷
  if (/kontoauszug/i.test(head) || /kontoauszug/.test(f)) return 'dkb';
  return pick(head) || pick(f) || pick(text);
}
