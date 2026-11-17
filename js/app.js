import { SOURCES, analyzeFile, buildTransactions, decodeBytes, suggestFlip } from './parse.js';
import { DEFAULT_RULES, applyRules, suggestKeyword } from './categorize.js';
import {
  allCategories, emptyState, listMonths, loadState, mergeTransactions, monthOf, normalizeState,
  saveState, shiftMonth, summarizeMonth, toCSV,
} from './store.js';

let state = loadState(localStorage);
const ui = { tab: 'overview', month: null, filter: { q: '', source: '', category: '' } };

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmt = (n) => eur.format(n);
const monthLabel = (m) => `${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月`;

/** 建立 DOM 節點；所有資料都走 textContent，不使用 innerHTML。 */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function persist() {
  try {
    saveState(localStorage, state);
  } catch {
    toast('儲存失敗：瀏覽器儲存空間不足，請先匯出備份。');
  }
}

const catName = (id) => allCategories(state).find((c) => c.id === id)?.name ?? id;
const catType = (id) => allCategories(state).find((c) => c.id === id)?.type ?? 'expense';

function categorySelect(value, onchange, extra = []) {
  const groups = [['支出', 'expense'], ['收入', 'income'], ['不計入', 'excluded']];
  return h('select', { onchange: (e) => onchange(e.target.value), 'aria-label': '分類' },
    extra.map(([v, label]) => h('option', { value: v, selected: v === value }, label)),
    groups.map(([label, type]) => h('optgroup', { label },
      allCategories(state).filter((c) => c.type === type).map((c) => h('option', { value: c.id, selected: c.id === value }, c.name)))),
  );
}

function sourceSelect(value, onchange, emptyLabel) {
  return h('select', { onchange: (e) => onchange(e.target.value), 'aria-label': '來源' },
    emptyLabel != null && h('option', { value: '', selected: !value }, emptyLabel),
    Object.entries(SOURCES).map(([id, name]) => h('option', { value: id, selected: id === value }, name)),
  );
}

let toastTimer;
function toast(message, action) {
  const el = $('toast');
  el.replaceChildren(message, action ? h('button', { onclick: () => { el.hidden = true; action.run(); } }, action.label) : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 9000 : 4500);
}

function tip(el, text) {
  const t = $('tooltip');
  el.addEventListener('mousemove', (e) => {
    t.textContent = text;
    t.hidden = false;
    t.style.left = `${Math.min(e.clientX + 12, innerWidth - t.offsetWidth - 8)}px`;
    t.style.top = `${e.clientY - 34}px`;
  });
  el.addEventListener('mouseleave', () => { t.hidden = true; });
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  h('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ───────────────────────── 版面 ─────────────────────────

const TABS = [['overview', '總覽'], ['transactions', '交易明細'], ['rules', '分類規則'], ['data', '匯入與備份']];

function render() {
  const months = listMonths(state.transactions);
  if (!ui.month || (months.length && !months.includes(ui.month) && (ui.month < months[0] || ui.month > months.at(-1)))) {
    ui.month = months.at(-1) ?? null;
  }
  $('tabs').replaceChildren(...TABS.map(([id, label]) =>
    h('button', { 'aria-current': ui.tab === id ? 'page' : null, onclick: () => { ui.tab = id; render(); } }, label)));
  renderMonthNav(months);
  const view = $('view');
  if (!state.transactions.length && ui.tab !== 'rules') {
    view.replaceChildren(...dataView(true));
  } else {
    view.replaceChildren(...{ overview: overviewView, transactions: transactionsView, rules: rulesView, data: dataView }[ui.tab]());
  }
}

function renderMonthNav(months) {
  const nav = $('month-nav');
  if (!months.length) return nav.replaceChildren();
  const go = (m) => { ui.month = m; render(); };
  const range = [];
  for (let m = months[0]; m <= months.at(-1); m = shiftMonth(m, 1)) range.push(m);
  nav.replaceChildren(
    h('button', { class: 'btn icon', 'aria-label': '上個月', disabled: ui.month <= months[0], onclick: () => go(shiftMonth(ui.month, -1)) }, '‹'),
    h('select', { 'aria-label': '月份', onchange: (e) => go(e.target.value) },
      range.reverse().map((m) => h('option', { value: m, selected: m === ui.month }, monthLabel(m)))),
    h('button', { class: 'btn icon', 'aria-label': '下個月', disabled: ui.month >= months.at(-1), onclick: () => go(shiftMonth(ui.month, 1)) }, '›'),
  );
}

// ───────────────────────── 總覽 ─────────────────────────

function overviewView() {
  const s = summarizeMonth(state, ui.month);
  const prev = summarizeMonth(state, shiftMonth(ui.month, -1));
  let delta = '上個月沒有資料';
  if (prev.count) {
    const diff = s.spend - prev.spend;
    const pct = prev.spend > 0 ? `（${diff >= 0 ? '+' : '−'}${Math.abs(Math.round((diff / prev.spend) * 100))}%）` : '';
    delta = `較上月 ${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))}${pct}`;
  }
  const uncat = s.byCategory.find((c) => c.id === 'uncat');
  const showCategory = (id) => { ui.filter = { q: '', source: '', category: id }; ui.tab = 'transactions'; render(); };

  const tiles = h('div', { class: 'grid tiles' },
    h('div', { class: 'card tile hero' },
      h('div', { class: 'label' }, `${monthLabel(ui.month)} 實際開銷`),
      h('div', { class: 'value num' }, fmt(s.spend)),
      h('div', { class: 'sub' }, delta)),
    h('div', { class: 'card tile' },
      h('div', { class: 'label' }, '收入'),
      h('div', { class: 'value num' }, fmt(s.income)),
      h('div', { class: 'sub' }, `${s.count} 筆交易`)),
    h('div', { class: 'card tile' },
      h('div', { class: 'label' }, '結餘（收入 − 開銷）'),
      h('div', { class: `value num ${s.net >= 0 ? 'pos' : 'neg'}` }, `${s.net >= 0 ? '+' : '−'}${fmt(Math.abs(s.net))}`),
      h('div', { class: 'sub' }, `不計入的內部轉帳／儲蓄：${fmt(Math.abs(s.excluded))}`)),
  );

  const sources = h('div', { class: 'card srcrow' },
    h('span', {}, '各來源開銷'),
    Object.entries(SOURCES).map(([id, name]) => h('span', {}, `${name} `, h('b', { class: 'num' }, fmt(s.bySource[id] ?? 0)))));

  const max = Math.max(...s.byCategory.map((c) => c.total), 0);
  const cats = h('div', { class: 'card' },
    h('h2', {}, '分類開銷'),
    s.byCategory.length
      ? h('div', { class: 'catlist' }, s.byCategory.map((c) => {
        const row = h('button', { class: 'catrow', onclick: () => showCategory(c.id) },
          h('span', {}, catName(c.id)),
          h('span', { class: 'track' }, h('span', { class: 'bar', style: `display:block;width:${max > 0 ? Math.max(0, (c.total / max) * 100) : 0}%` })),
          h('span', { class: 'amt num' }, fmt(c.total),
            h('span', { class: 'pct' }, s.spend > 0 ? `${Math.round((c.total / s.spend) * 100)}%` : '')));
        tip(row, `${catName(c.id)}：${c.count} 筆，點擊查看明細`);
        return row;
      }))
      : h('div', { class: 'empty' }, '這個月沒有支出資料'),
    uncat && h('p', { class: 'notice' }, `有 ${uncat.count} 筆交易尚未分類。`,
      h('button', { class: 'link', onclick: () => showCategory('uncat') }, '前往分類')),
  );

  return [tiles, sources, h('div', { class: 'grid two' }, cats, trendCard())];
}

function trendCard() {
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(shiftMonth(ui.month, -i));
  const data = months.map((m) => ({ m, s: summarizeMonth(state, m) }));
  const max = Math.max(...data.map((d) => d.s.spend), 1);
  return h('div', { class: 'card' },
    h('h2', {}, '近 12 個月實際開銷'),
    h('div', { class: 'trend' }, data.map(({ m, s }) => {
      const selected = m === ui.month;
      const col = h('button', {
        class: 'col', 'aria-pressed': String(selected), 'aria-label': `${monthLabel(m)} ${fmt(s.spend)}`,
        disabled: !s.count, onclick: () => { ui.month = m; render(); },
      },
      selected && s.count ? h('span', { class: 'v num', style: `bottom:${Math.max(0, (s.spend / max) * 100)}%` }, eur0.format(s.spend)) : null,
      s.count ? h('span', { class: 'b', style: `height:${Math.max(0, (s.spend / max) * 100)}%` }) : null);
      if (s.count) tip(col, `${monthLabel(m)}：${fmt(s.spend)}`);
      return col;
    })),
    h('div', { class: 'trend-x' }, data.map(({ m }) =>
      h('span', { class: m === ui.month ? 'sel' : '' }, m.slice(5) === '01' ? `${m.slice(2, 4)}/1` : String(Number(m.slice(5)))))),
  );
}

// ───────────────────────── 交易明細 ─────────────────────────

function transactionsView() {
  const body = h('div');
  const update = () => {
    const q = ui.filter.q.trim().toLowerCase();
    const list = state.transactions
      .filter((t) => monthOf(t) === ui.month
        && (!ui.filter.source || t.source === ui.filter.source)
        && (!ui.filter.category || t.category === ui.filter.category)
        && (!q || t.desc.toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.desc.localeCompare(b.desc));
    const total = list.reduce((sum, t) => sum + t.amount, 0);
    summary.textContent = `${list.length} 筆，合計 ${fmt(total)}`;
    body.replaceChildren(list.length
      ? h('div', { class: 'tablewrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, '日期'), h('th', {}, '說明'), h('th', {}, '來源'), h('th', {}, '分類'), h('th', { class: 'amount' }, '金額'))),
        h('tbody', {}, list.map(txRow))))
      : h('div', { class: 'empty' }, '沒有符合條件的交易'));
  };
  const txRow = (t) => h('tr', {},
    h('td', { class: 'num' }, t.date.slice(5).replace('-', '/')),
    h('td', { class: 'desc', title: t.desc }, t.desc),
    h('td', {}, h('span', { class: 'badge' }, SOURCES[t.source] ?? t.source)),
    h('td', {}, categorySelect(t.category, (v) => setCategory(t, v, update))),
    h('td', { class: `amount num ${catType(t.category) === 'excluded' ? 'dim' : t.amount > 0 ? 'pos' : ''}` }, fmt(t.amount)),
  );
  const summary = h('span', { class: 'summary num' });
  const filters = h('div', { class: 'filters' },
    h('input', { type: 'search', placeholder: '搜尋說明…', value: ui.filter.q, 'aria-label': '搜尋', oninput: (e) => { ui.filter.q = e.target.value; update(); } }),
    sourceSelect(ui.filter.source, (v) => { ui.filter.source = v; update(); }, '全部來源'),
    categorySelect(ui.filter.category, (v) => { ui.filter.category = v; update(); }, [['', '全部分類']]),
    h('button', { class: 'btn', onclick: () => { ui.filter = { q: '', source: '', category: '' }; render(); } }, '清除篩選'),
    summary,
  );
  update();
  return [h('div', { class: 'card' }, filters, body)];
}

function setCategory(tx, category, refresh) {
  tx.category = category;
  tx.manual = true;
  persist();
  refresh();
  toast(`已改為「${catName(category)}」`, { label: '建立規則，自動套用到類似交易', run: () => ruleDialog({ keyword: suggestKeyword(tx.desc), category, source: '' }) });
}

// ───────────────────────── 規則 ─────────────────────────

function addRule(rule) {
  state.userRules.unshift(rule);
  const changed = applyRules(state.transactions, state.userRules);
  persist();
  render();
  toast(`已新增規則，${changed} 筆交易重新分類`);
}

function ruleDialog(draft) {
  const dlg = $('dialog');
  const keyword = h('input', { type: 'text', value: draft.keyword, required: true });
  dlg.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => {
    e.preventDefault();
    const kw = keyword.value.trim().toLowerCase();
    if (!kw) return;
    dlg.close();
    addRule({ keyword: kw, category: draft.category, source: draft.source });
  } },
  h('h2', {}, '新增分類規則'),
  h('p', { class: 'hint' }, '交易說明中出現此關鍵字（不分大小寫，需位於單字開頭）時，自動歸入指定分類。'),
  h('div', { class: 'fields' },
    h('label', {}, '關鍵字', keyword),
    h('label', {}, '分類', categorySelect(draft.category, (v) => { draft.category = v; })),
    h('label', {}, '適用來源', sourceSelect(draft.source, (v) => { draft.source = v; }, '全部來源'))),
  h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, '取消'),
    h('button', { type: 'submit', class: 'btn primary' }, '儲存規則'))));
  dlg.showModal();
  keyword.select();
}

function rulesView() {
  const sourceLabel = (s) => (s === 'cards' ? '信用卡' : SOURCES[s] ?? '全部');
  const ruleTable = (rules, removable) => h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, '關鍵字'), h('th', {}, '分類'), h('th', {}, '來源'), removable && h('th', {}))),
    h('tbody', {}, rules.map((r, i) => h('tr', {},
      h('td', {}, r.keyword), h('td', {}, catName(r.category)), h('td', {}, sourceLabel(r.source)),
      removable && h('td', { class: 'amount' }, h('button', { class: 'btn danger', onclick: () => {
        state.userRules.splice(i, 1);
        applyRules(state.transactions, state.userRules);
        persist();
        render();
      } }, '刪除')))))));

  const newCat = { name: '', type: 'expense' };
  const nameInput = h('input', { type: 'text', placeholder: '新分類名稱', 'aria-label': '新分類名稱', oninput: (e) => { newCat.name = e.target.value; } });
  const custom = state.customCategories;

  return [
    h('div', { class: 'card' },
      h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' },
        h('h2', { style: 'margin:0' }, '我的規則'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => {
            const changed = applyRules(state.transactions, state.userRules);
            persist();
            render();
            toast(`已重新套用規則，${changed} 筆交易變動`);
          } }, '重新套用規則'),
          h('button', { class: 'btn primary', onclick: () => ruleDialog({ keyword: '', category: 'other', source: '' }) }, '新增規則'))),
      state.userRules.length ? ruleTable(state.userRules, true) : h('div', { class: 'empty' }, '尚未建立自訂規則。在交易明細更改分類後，可以直接把它存成規則。'),
      h('p', { class: 'hint' }, '我的規則優先於內建規則；越上面的規則越優先。手動改過分類的交易不會被規則覆蓋。')),
    h('div', { class: 'card' },
      h('h2', {}, '自訂分類'),
      custom.length ? h('div', { class: 'row', style: 'margin-bottom:12px' }, custom.map((c) => h('span', { class: 'badge' }, c.name))) : null,
      h('div', { class: 'row' },
        nameInput,
        h('select', { 'aria-label': '分類類型', onchange: (e) => { newCat.type = e.target.value; } },
          h('option', { value: 'expense' }, '支出'), h('option', { value: 'income' }, '收入'), h('option', { value: 'excluded' }, '不計入')),
        h('button', { class: 'btn', onclick: () => {
          const name = newCat.name.trim();
          if (!name) return nameInput.focus();
          if (allCategories(state).some((c) => c.name === name)) return toast('已有同名分類');
          custom.push({ id: `c-${Date.now().toString(36)}`, name, type: newCat.type });
          persist();
          render();
        } }, '新增分類'))),
    h('details', { class: 'card' },
      h('summary', {}, `內建規則（${DEFAULT_RULES.length} 條）`),
      ruleTable(DEFAULT_RULES, false)),
  ];
}

// ───────────────────────── 匯入與備份 ─────────────────────────

function dataView(firstRun = false) {
  const input = h('input', { type: 'file', multiple: true, accept: '.csv,.txt,.json,text/csv', hidden: true, onchange: (e) => { importFiles([...e.target.files]); e.target.value = ''; } });
  const drop = h('label', { class: 'drop' },
    h('strong', {}, '把帳單 CSV 拖曳到這裡，或點擊選擇檔案'),
    '支援 DKB、VISA Amazon、AMEX 的 CSV 匯出，可一次選多個檔案。重複匯入不會重複計算。',
    input);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); importFiles([...e.dataTransfer.files]); });

  const counts = Object.entries(SOURCES).map(([id, name]) => `${name} ${state.transactions.filter((t) => t.source === id).length} 筆`).join('、');
  const stamp = new Date().toISOString().slice(0, 10);
  const privacy = h('p', { class: 'hint' }, '所有資料只儲存在這台裝置的瀏覽器裡，不會上傳到任何伺服器。清除瀏覽器資料會一併刪除，建議定期匯出備份。');

  if (firstRun) {
    return [h('div', { class: 'card' }, h('h2', {}, '開始使用'), drop, privacy,
      h('p', { class: 'hint' }, '已有備份？直接把備份的 .json 檔拖進來即可還原。'))];
  }
  return [
    h('div', { class: 'card' }, h('h2', {}, '匯入帳單'), drop, h('p', { class: 'hint' }, `目前共有：${counts}`)),
    h('div', { class: 'card' },
      h('h2', {}, '備份與匯出'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => download(`monthly-budget-backup-${stamp}.json`, JSON.stringify(state, null, 1), 'application/json') }, '匯出完整備份 (JSON)'),
        h('button', { class: 'btn', onclick: () => download(`transactions-${ui.month}.csv`, toCSV(state, state.transactions.filter((t) => monthOf(t) === ui.month)), 'text/csv') }, `匯出 ${monthLabel(ui.month)} 明細 (CSV)`),
        h('button', { class: 'btn', onclick: () => download('transactions-all.csv', toCSV(state, state.transactions), 'text/csv') }, '匯出全部明細 (CSV)')),
      h('p', { class: 'hint' }, '還原備份：把備份的 .json 檔拖到上方的匯入區。'),
      privacy),
    h('div', { class: 'card' },
      h('h2', {}, '清除資料'),
      h('div', { class: 'row' },
        h('button', { class: 'btn danger', onclick: () => {
          if (!confirm(`確定刪除 ${monthLabel(ui.month)} 的所有交易？此動作無法復原。`)) return;
          state.transactions = state.transactions.filter((t) => monthOf(t) !== ui.month);
          persist();
          render();
        } }, `刪除 ${monthLabel(ui.month)} 的交易`),
        h('button', { class: 'btn danger', onclick: () => {
          if (!confirm('確定刪除所有交易、規則與自訂分類？此動作無法復原。')) return;
          state = emptyState();
          persist();
          render();
        } }, '刪除全部資料'))),
  ];
}

async function importFiles(files) {
  let added = 0;
  let duplicates = 0;
  let lastMonth = null;
  for (const file of files) {
    if (/\.pdf$/i.test(file.name)) {
      toast(`${file.name}：目前只支援 CSV，請從網銀匯出 CSV 檔。`);
      continue;
    }
    const text = decodeBytes(await file.arrayBuffer());
    if (/\.json$/i.test(file.name)) {
      restoreBackup(text);
      return;
    }
    const analysis = analyzeFile(text, file.name);
    const txs = await importDialog(analysis);
    if (!txs) continue;
    const r = mergeTransactions(state, txs);
    added += r.added;
    duplicates += r.duplicates;
    if (txs.length) lastMonth = txs.map((t) => t.date).sort().at(-1).slice(0, 7);
  }
  if (added || duplicates) {
    persist();
    if (added && lastMonth) ui.month = lastMonth;
    if (added) ui.tab = 'overview';
    render();
    toast(`新增 ${added} 筆交易${duplicates ? `，略過 ${duplicates} 筆重複` : ''}`);
  }
}

function restoreBackup(text) {
  try {
    const next = normalizeState(JSON.parse(text));
    if (state.transactions.length && !confirm(`還原備份會取代目前的 ${state.transactions.length} 筆交易，確定嗎？`)) return;
    state = next;
    ui.month = null;
    persist();
    render();
    toast(`已還原備份：${state.transactions.length} 筆交易`);
  } catch {
    toast('無法讀取備份檔：格式不正確');
  }
}

/** 匯入預覽：確認來源、欄位對應與正負號。回傳交易陣列，取消則回傳 null。 */
function importDialog(analysis) {
  return new Promise((resolve) => {
    const dlg = $('dialog');
    const opts = { source: analysis.source || 'amazon', mapping: { ...analysis.mapping }, flip: analysis.flip };
    if (!analysis.source) opts.flip = suggestFlip(analysis, opts.source);
    let result = null;
    const preview = h('div');
    const flipBox = h('input', { type: 'checkbox', checked: opts.flip, onchange: (e) => { opts.flip = e.target.checked; refresh(); } });
    const confirmBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => { result = buildTransactions(analysis, opts).txs; dlg.close(); } }, '匯入');

    const columnSelect = (key, optional) => h('select', { onchange: (e) => { opts.mapping[key] = Number(e.target.value); refresh(); } },
      optional && h('option', { value: -1 }, '（無）'),
      !optional && opts.mapping[key] === -1 && h('option', { value: -1, selected: true }, '請選擇…'),
      analysis.headers.map((name, i) => h('option', { value: i, selected: i === opts.mapping[key] }, name || `第 ${i + 1} 欄`)));

    function refresh() {
      const { txs, skipped, pending } = buildTransactions(analysis, opts);
      confirmBtn.disabled = !txs.length;
      const spend = txs.filter((t) => t.amount < 0).length;
      preview.replaceChildren(
        h('p', { class: 'notice' },
          `讀到 ${txs.length} 筆交易（${spend} 筆支出、${txs.length - spend} 筆入帳）`,
          txs.length ? `，期間 ${txs.map((t) => t.date).sort()[0]} ～ ${txs.map((t) => t.date).sort().at(-1)}` : '',
          pending ? `；略過 ${pending} 筆尚未入帳 (Vorgemerkt)` : '',
          skipped ? `；${skipped} 列無法解析` : '', '。'),
        txs.length
          ? h('div', { class: 'tablewrap' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, '日期'), h('th', {}, '說明'), h('th', { class: 'amount' }, '金額'))),
            h('tbody', {}, txs.slice(0, 6).map((t) => h('tr', {},
              h('td', { class: 'num' }, t.date), h('td', { class: 'desc', title: t.desc }, t.desc),
              h('td', { class: `amount num ${t.amount > 0 ? 'pos' : ''}` }, fmt(t.amount)))))))
          : h('div', { class: 'empty' }, '找不到可匯入的交易，請確認上方的欄位對應。'),
        h('p', { class: 'hint' }, '支出應顯示為負數。如果消費顯示成正數（綠色），請切換「反轉正負號」。'));
    }

    dlg.replaceChildren(
      h('h2', {}, `匯入 ${analysis.filename}`),
      analysis.detected ? '' : h('p', { class: 'notice' }, '無法自動辨識欄位，請手動選擇日期與金額欄位。'),
      h('div', { class: 'fields' },
        h('label', {}, '帳單來源', sourceSelect(opts.source, (v) => {
          opts.source = v;
          opts.flip = flipBox.checked = suggestFlip({ ...analysis, mapping: opts.mapping }, v);
          refresh();
        })),
        h('label', {}, '日期欄位', columnSelect('date')),
        h('label', {}, '金額欄位', columnSelect('amount')),
        h('label', {}, '說明欄位', columnSelect('desc', true)),
        h('label', {}, '對象欄位', columnSelect('payee', true))),
      h('label', { class: 'check' }, flipBox, '反轉正負號（信用卡匯出檔把消費記為正數時勾選）'),
      preview,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, '略過此檔'),
        confirmBtn));
    dlg.addEventListener('close', () => resolve(result), { once: true });
    refresh();
    dlg.showModal();
  });
}

render();
