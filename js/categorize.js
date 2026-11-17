// 分類與規則：純函式。

/**
 * type:
 *  - expense  計入「實際開銷」（正數金額視為退款，會抵減開銷）
 *  - income   計入收入
 *  - excluded 不計入（信用卡繳款等內部轉帳、儲蓄投資）
 */
export const BASE_CATEGORIES = [
  { id: 'housing', name: '住房水電', type: 'expense' },
  { id: 'groceries', name: '超市食品', type: 'expense' },
  { id: 'dining', name: '餐飲外食', type: 'expense' },
  { id: 'household', name: '日用品', type: 'expense' },
  { id: 'transport', name: '交通', type: 'expense' },
  { id: 'shopping', name: '購物', type: 'expense' },
  { id: 'subscriptions', name: '訂閱與娛樂', type: 'expense' },
  { id: 'telecom', name: '電信網路', type: 'expense' },
  { id: 'insurance', name: '保險', type: 'expense' },
  { id: 'health', name: '健康運動', type: 'expense' },
  { id: 'travel', name: '旅遊', type: 'expense' },
  { id: 'cash', name: '現金提領', type: 'expense' },
  { id: 'fees', name: '手續費與利息', type: 'expense' },
  { id: 'other', name: '其他', type: 'expense' },
  { id: 'uncat', name: '未分類', type: 'expense' },
  { id: 'income', name: '收入', type: 'income' },
  { id: 'transfer', name: '內部轉帳（不計入）', type: 'excluded' },
  { id: 'saving', name: '儲蓄投資（不計入）', type: 'excluded' },
];

const group = (category, source, keywords) => keywords.map((keyword) => ({ keyword, category, source }));

// 順序即優先序：先比對到的規則勝出。source: '' 全部 | 'dkb' | 'amazon' | 'amex' | 'cards'
export const DEFAULT_RULES = [
  // DKB 帳戶扣繳信用卡帳單 → 消費已在信用卡明細中計算，避免重複
  ...group('transfer', 'dkb', ['american express', 'amex', 'zinia', 'open bank', 'amazon visa', 'kreditkartenabrechnung']),
  // 信用卡端收到的繳款
  ...group('transfer', 'cards', ['zahlung erhalten', 'zahlung/überweisung erhalten', 'besten dank', 'lastschrift', 'payment received', 'ihre zahlung', 'einzug']),
  ...group('saving', 'dkb', ['trade republic', 'scalable', 'sparplan', 'depot', 'tagesgeld']),
  ...group('income', 'dkb', ['gehalt', 'lohn', 'bezüge', 'salary']),
  ...group('housing', '', ['miete', 'hausverwaltung', 'stadtwerke', 'vattenfall', 'e.on', 'eon energie', 'rundfunk', 'nebenkosten', 'strom', 'ostrom', 'tibber']),
  ...group('telecom', '', ['telekom', 'vodafone', 'o2', 'telefonica', '1&1', 'congstar', 'aldi talk', 'fraenk', 'pyur']),
  ...group('groceries', '', ['rewe', 'edeka', 'lidl', 'aldi', 'penny', 'netto', 'kaufland', 'denns', 'bio company', 'alnatura', 'go asia', 'asia markt', 'flink', 'picnic', 'tegut', 'nahkauf']),
  ...group('household', '', ['dm-drogerie', 'dm drogerie', 'dm fil', 'rossmann', 'budni', 'müller drogerie']),
  ...group('dining', '', ['restaurant', 'lieferando', 'wolt', 'uber eats', 'uber *eats', 'ubereats', 'mcdonald', 'burger king', 'starbucks', 'cafe', 'café', 'bäckerei', 'baeckerei', 'kfc', 'subway', 'pizza', 'sushi', 'ramen', 'imbiss', 'bistro', 'kantine', 'mensa']),
  ...group('subscriptions', '', ['netflix', 'spotify', 'disney', 'youtube', 'apple.com/bill', 'google', 'prime video', 'amazon prime', 'audible', 'openai', 'chatgpt', 'anthropic', 'claude.ai', 'github', 'icloud', 'dazn', 'kino', 'cinema', 'steam', 'playstation', 'nintendo', 'eventim', 'ticketmaster']),
  ...group('transport', '', ['db vertrieb', 'deutsche bahn', 'db fernverkehr', 'bvg', 'mvg', 'hvv', 'rmv', 'vvs', 'kvb', 'deutschlandticket', 'uber', 'bolt', 'free now', 'tier', 'lime', 'miles', 'share now', 'sixt', 'flixbus', 'aral', 'shell', 'esso', 'tankstelle', 'nextbike']),
  ...group('travel', '', ['lufthansa', 'ryanair', 'easyjet', 'eurowings', 'booking.com', 'airbnb', 'hotel', 'hostel', 'expedia', 'trip.com', 'eva air', 'china airlines']),
  ...group('insurance', '', ['versicherung', 'allianz', 'huk', 'techniker krankenkasse', 'aok', 'barmer', 'getsafe', 'feather', 'ergo', 'axa', 'haftpflicht']),
  ...group('health', '', ['apotheke', 'arzt', 'praxis', 'zahnarzt', 'urban sports', 'fitness', 'mcfit', 'john reed', 'fitx', 'docmorris', 'optiker', 'fielmann']),
  ...group('shopping', '', ['amazon', 'amzn', 'zalando', 'ikea', 'mediamarkt', 'media markt', 'saturn', 'h&m', 'zara', 'uniqlo', 'decathlon', 'ebay', 'otto', 'apple store', 'tk maxx', 'galeria', 'obi', 'bauhaus', 'hornbach', 'temu', 'aliexpress', 'etsy', 'kleinanzeigen', 'thalia', 'about you']),
  ...group('cash', '', ['bargeld', 'geldautomat', 'atm']),
  ...group('fees', '', ['entgelt', 'zinsen', 'gebühr', 'auslandseinsatz', 'kontoführung', 'jahresbeitrag', 'mitgliedsbeitrag']),
];

const regexCache = new Map();

/** 關鍵字必須出現在「單字開頭」，避免 "tier" 命中 "Metier" 之類的誤判。 */
function keywordRegex(keyword) {
  let re = regexCache.get(keyword);
  if (!re) {
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(^|[^a-z0-9äöüß])${escaped}`);
    regexCache.set(keyword, re);
  }
  return re;
}

function sourceMatches(ruleSource, txSource) {
  if (!ruleSource) return true;
  if (ruleSource === 'cards') return txSource !== 'dkb';
  return ruleSource === txSource;
}

export function matchRule(tx, rules) {
  const desc = tx.desc.toLowerCase();
  return rules.find((r) => r.keyword && sourceMatches(r.source, tx.source) && keywordRegex(r.keyword).test(desc));
}

/** 使用者規則優先於內建規則；都沒命中時，DKB 的入帳視為收入，其餘為未分類。 */
export function categorize(tx, userRules = []) {
  const rule = matchRule(tx, userRules) ?? matchRule(tx, DEFAULT_RULES);
  if (rule) return rule.category;
  return tx.amount > 0 && tx.source === 'dkb' ? 'income' : 'uncat';
}

/** 重新套用規則；手動指定過分類的交易不動。回傳變動筆數。 */
export function applyRules(transactions, userRules = []) {
  let changed = 0;
  for (const tx of transactions) {
    if (tx.manual) continue;
    const category = categorize(tx, userRules);
    if (category !== tx.category) {
      tx.category = category;
      changed++;
    }
  }
  return changed;
}

/** 從交易說明猜一個適合當規則的關鍵字（商家名稱的前幾個字）。 */
export function suggestKeyword(desc) {
  const head = desc.split(' · ')[0].toLowerCase();
  const words = head
    .replace(/[*#]\S*/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^\d+$/.test(w));
  return words.slice(0, 2).join(' ');
}
