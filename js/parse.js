// 帳單 CSV 解析：純函式，瀏覽器與 Node 測試共用。

export const SOURCES = {
  dkb: 'DKB',
  amazon: 'VISA Amazon',
  amex: 'AMEX',
};

/** 先試 UTF-8，失敗則退回 Windows-1252（舊版 DKB 匯出）。 */
export function decodeBytes(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).slice(0, 40);
  let best = ';';
  let bestCount = 0;
  for (const d of [';', ',', '\t']) {
    let max = 0;
    for (const line of lines) {
      let n = 0;
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === d && !quoted) n++;
      }
      if (n > max) max = n;
    }
    if (max > bestCount) {
      bestCount = max;
      best = d;
    }
  }
  return best;
}

export function parseCSV(text, delimiter = detectDelimiter(text)) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

// 信用卡優先採用消費日（而非入帳日），月份歸屬才符合實際消費時間
const DATE_HEADERS = ['transaktionsdatum', 'belegdatum', 'kaufdatum', 'umsatzdatum', 'buchungsdatum', 'buchungstag', 'datum', 'date', 'wertstellung', 'valuta'];
const AMOUNT_HEADERS = ['betrag (€)', 'betrag (eur)', 'betrag', 'amount', 'umsatz', 'summe'];
const DESC_HEADERS = ['verwendungszweck', 'beschreibung', 'description', 'buchungstext', 'händler', 'merchant', 'text'];
const PAYEE_HEADERS = ['zahlungsempfänger', 'begünstigter', 'empfänger', 'auftraggeber'];
const PAYER_HEADERS = ['zahlungspflichtige'];
const STATUS_HEADERS = ['status'];

function findColumn(headers, candidates, mode = 'prefix') {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i !== -1) return i;
  }
  for (const c of candidates) {
    const i = headers.findIndex((h) => (mode === 'includes' ? h.includes(c) : h.startsWith(c)));
    if (i !== -1) return i;
  }
  return -1;
}

export function guessMapping(headerRow) {
  const headers = headerRow.map(norm);
  return {
    date: findColumn(headers, DATE_HEADERS),
    amount: findColumn(headers, AMOUNT_HEADERS),
    desc: findColumn(headers, DESC_HEADERS),
    payee: findColumn(headers, PAYEE_HEADERS, 'includes'),
    payer: findColumn(headers, PAYER_HEADERS, 'includes'),
    status: findColumn(headers, STATUS_HEADERS),
  };
}

/** 找出真正的欄位標題列（DKB 的 CSV 開頭有幾行帳戶資訊）。 */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const m = guessMapping(rows[i]);
    if (m.date !== -1 && m.amount !== -1) return i;
  }
  return -1;
}

export function detectSource(headerRow, filename = '') {
  const h = headerRow.map(norm).join('|');
  const f = filename.toLowerCase();
  if (/zahlungspflichtige|gläubiger-id|buchungstag|mandatsreferenz/.test(h)) return 'dkb';
  if (/karteninhaber|konto #|erscheint auf ihrer abrechnung|card member/.test(h)) return 'amex';
  if (/amex|american.?express/.test(f)) return 'amex';
  if (/amazon|zinia|visa/.test(f)) return 'amazon';
  if (/dkb|girokonto|umsatzliste/.test(f)) return 'dkb';
  return '';
}

export function detectDecimal(values) {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    if (/,\d{1,2}\D*$/.test(v)) comma++;
    else if (/\.\d{1,2}\D*$/.test(v)) dot++;
  }
  return dot > comma ? '.' : ',';
}

export function parseAmount(raw, decimal = ',') {
  let s = String(raw ?? '').trim();
  if (!/\d/.test(s)) return NaN;
  let negative = /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /^[^\d]*[-−]/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round((negative ? -n : n) * 100) / 100;
}

/** 回傳 ISO 日期 (YYYY-MM-DD)，無法解析則回傳 null。 */
export function parseDate(raw) {
  const s = String(raw ?? '').trim();
  let y, m, d;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    [, y, m, d] = match.map(Number);
  } else {
    match = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/);
    if (!match) return null;
    [, d, m, y] = match.map(Number);
    if (y < 100) y += 2000;
    if (m > 12 && d <= 12) [d, m] = [m, d];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function analyzeFile(text, filename = '') {
  return analyzeRows(parseCSV(text), filename);
}

/** 分析已拆成二維陣列的表格（CSV、Excel 或從 PDF 還原的列）。sourceHint：已知來源時覆蓋自動判斷。 */
export function analyzeRows(rows, filename = '', sourceHint = '') {
  let headerIdx = findHeaderRow(rows);
  const detected = headerIdx !== -1;
  if (!detected) headerIdx = Math.max(0, rows.findIndex((r) => r.length >= 3));
  const headers = rows[headerIdx] ?? [];
  const mapping = guessMapping(headers);
  const source = sourceHint || detectSource(headers, filename);
  const analysis = { filename, rows, headerIdx, headers, mapping, source, detected };
  analysis.flip = suggestFlip(analysis, source);
  return analysis;
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * 轉成統一格式的交易。amount 一律以「負數 = 支出、正數 = 入帳」表示。
 * flip：信用卡匯出通常把消費記為正數，需要反轉。
 */
export function buildTransactions(analysis, { source, mapping = analysis.mapping, flip = false } = {}) {
  const data = analysis.rows.slice(analysis.headerIdx + 1);
  const decimal = detectDecimal(data.map((r) => r[mapping.amount] ?? ''));
  const txs = [];
  let skipped = 0;
  let pending = 0;
  for (const r of data) {
    const date = parseDate(r[mapping.date]);
    let amount = parseAmount(r[mapping.amount], decimal);
    if (!date || Number.isNaN(amount)) {
      skipped++;
      continue;
    }
    if (mapping.status >= 0 && /vorgemerkt|pending/i.test(r[mapping.status] ?? '')) {
      pending++;
      continue;
    }
    if (flip) amount = -amount;
    const rawAmount = flip ? -amount : amount;
    const party = rawAmount > 0 && mapping.payer >= 0 ? r[mapping.payer] : r[mapping.payee];
    const parts = [clean(party), clean(r[mapping.desc])].filter(Boolean);
    const desc = parts[0] === parts[1] ? parts[0] : parts.join(' · ');
    txs.push({ date, amount: amount === 0 ? 0 : amount, desc: desc || '(無說明)', source });
  }
  return { txs, skipped, pending };
}

/** 信用卡檔案若多數金額為正，推測正數代表消費，建議反轉。 */
export function suggestFlip(analysis, source) {
  if (source === 'dkb') return false;
  const { txs } = buildTransactions(analysis, { source });
  const pos = txs.filter((t) => t.amount > 0).length;
  return pos > txs.length - pos;
}
