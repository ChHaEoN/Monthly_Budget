// 資料狀態、去重合併與月結計算。資料只存在瀏覽器的 localStorage。
import { BASE_CATEGORIES, categorize } from './categorize.js';

export const STORAGE_KEY = 'monthly-budget-v1';

export function emptyState() {
  return { version: 1, transactions: [], userRules: [], customCategories: [], importedFiles: [] };
}

export function normalizeState(raw) {
  const s = { ...emptyState(), ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!Array.isArray(s.transactions) || !Array.isArray(s.userRules) || !Array.isArray(s.customCategories)) {
    throw new Error('備份檔格式不正確');
  }
  if (!Array.isArray(s.importedFiles)) s.importedFiles = [];
  s.transactions = s.transactions.filter(
    (t) => t && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isFinite(t.amount) && typeof t.desc === 'string',
  );
  return s;
}

export function loadState(storage) {
  try {
    return normalizeState(JSON.parse(storage.getItem(STORAGE_KEY)));
  } catch {
    return emptyState();
  }
}

export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function allCategories(state) {
  return [...BASE_CATEGORIES, ...state.customCategories];
}

const baseKey = (t) => `${t.source}|${t.date}|${t.amount.toFixed(2)}|${t.desc.toLowerCase()}`;

/**
 * 合併匯入的交易並去重。同一天同金額同說明的交易可能真的有多筆，
 * 所以以「出現次數」比較：檔案中第 n 筆相同交易，只有在既有資料少於 n 筆時才新增。
 * 重複匯入同一份或期間重疊的帳單都不會重複計算。
 */
export function mergeTransactions(state, incoming) {
  const existing = new Map();
  for (const t of state.transactions) existing.set(baseKey(t), (existing.get(baseKey(t)) ?? 0) + 1);
  const seen = new Map();
  let added = 0;
  let duplicates = 0;
  for (const t of incoming) {
    const key = baseKey(t);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n <= (existing.get(key) ?? 0)) {
      duplicates++;
      continue;
    }
    state.transactions.push({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      ...t,
      category: categorize(t, state.userRules),
      manual: false,
    });
    added++;
  }
  return { added, duplicates };
}

export const monthOf = (tx) => tx.date.slice(0, 7);

export function listMonths(transactions) {
  return [...new Set(transactions.map(monthOf))].sort();
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * 月結：
 *  spend  = 支出類交易的淨額（退款會抵減）
 *  income = 收入類交易合計
 *  內部轉帳／儲蓄投資不計入任何一邊
 */
export function summarizeMonth(state, month) {
  const types = new Map(allCategories(state).map((c) => [c.id, c.type]));
  const byCategory = new Map();
  const bySource = {};
  let spend = 0;
  let income = 0;
  let excluded = 0;
  let count = 0;
  for (const t of state.transactions) {
    if (monthOf(t) !== month) continue;
    count++;
    const type = types.get(t.category) ?? 'expense';
    if (type === 'income') income += t.amount;
    else if (type === 'excluded') excluded += t.amount;
    else {
      spend -= t.amount;
      bySource[t.source] = (bySource[t.source] ?? 0) - t.amount;
      const c = byCategory.get(t.category) ?? { id: t.category, total: 0, count: 0 };
      c.total -= t.amount;
      c.count++;
      byCategory.set(t.category, c);
    }
  }
  for (const k of Object.keys(bySource)) bySource[k] = round(bySource[k]);
  return {
    month,
    count,
    spend: round(spend),
    income: round(income),
    excluded: round(excluded),
    net: round(income - spend),
    bySource,
    byCategory: [...byCategory.values()].map((c) => ({ ...c, total: round(c.total) })).sort((a, b) => b.total - a.total),
  };
}

export function toCSV(state, transactions) {
  const names = new Map(allCategories(state).map((c) => [c.id, c.name]));
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['日期', '來源', '說明', '分類', '金額'].map(esc).join(';')];
  for (const t of transactions) {
    lines.push([t.date, t.source, t.desc, names.get(t.category) ?? t.category, t.amount.toFixed(2).replace('.', ',')].map(esc).join(';'));
  }
  return '﻿' + lines.join('\r\n');
}
