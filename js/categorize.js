// 分類與規則：純函式。

/**
 * type:
 *  - expense  計入「實際開銷」（正數金額視為退款，會抵減開銷）
 *  - income   計入收入
 *  - excluded 不計入（信用卡繳款等內部轉帳、儲蓄投資）
 */
export const BASE_CATEGORIES = [
  { id: 'housing', name: '住房水電', type: 'expense' },
  { id: 'mortgage', name: '房貸', type: 'expense' },
  { id: 'groceries', name: '超市食品', type: 'expense' },
  { id: 'dining', name: '餐飲外食', type: 'expense' },
  { id: 'household', name: '日用品', type: 'expense' },
  { id: 'transport', name: '交通', type: 'expense' },
  { id: 'shopping', name: '購物', type: 'expense' },
  { id: 'subscriptions', name: '訂閱與娛樂', type: 'expense' },
  { id: 'telecom', name: '電信網路', type: 'expense' },
  { id: 'insurance', name: '保險', type: 'expense' },
  { id: 'health', name: '健康運動', type: 'expense' },
  { id: 'childcare', name: '育兒托育', type: 'expense' },
  { id: 'travel', name: '旅遊', type: 'expense' },
  { id: 'cash', name: '現金提領', type: 'expense' },
  { id: 'loan', name: '貸款與分期', type: 'expense' },
  { id: 'fees', name: '手續費與利息', type: 'expense' },
  { id: 'other', name: '其他', type: 'expense' },
  { id: 'uncat', name: '未分類', type: 'expense' },
  { id: 'income', name: '收入', type: 'income' },
  { id: 'transfer', name: '內部轉帳（不計入）', type: 'excluded' },
  { id: 'saving', name: '儲蓄投資（不計入）', type: 'excluded' },
];

const group = (category, source, keywords) => keywords.map((keyword) => ({ keyword, category, source }));

/** 內建規則有更動時遞增：已儲存的交易會在下次開啟時自動重新套用規則（手動改過的分類不受影響）。 */
export const RULES_VERSION = 3;

// 順序即優先序：先比對到的規則勝出。source: '' 全部 | 'dkb' | 'amazon' | 'amex' | 'cards'
export const DEFAULT_RULES = [
  // DKB 帳戶扣繳信用卡帳單 → 消費已在信用卡明細中計算，避免重複
  ...group('transfer', 'dkb', ['american express', 'amex', 'zinia', 'open bank', 'amazon visa', 'kreditkartenabrechnung']),
  // 信用卡端收到的繳款
  ...group('transfer', 'cards', ['zahlung erhalten', 'zahlung/überweisung erhalten', 'besten dank', 'lastschrift', 'payment received', 'ihre zahlung', 'einzug']),
  ...group('saving', 'dkb', ['trade republic', 'scalable', 'sparplan', 'depot', 'tagesgeld']),
  // 房貸扣款（本金＋利息）；要排在「手續費與利息」的 zinsen 之前
  ...group('mortgage', '', ['darl.-leistung', 'darlehensleistung', 'darlehensrate', 'baufinanzierung', 'immobiliendarlehen', 'tilgung', 'annuität', 'annuitaet', 'hypothek']),
  ...group('income', 'dkb', ['gehalt', 'lohn', 'bezüge', 'salary']),
  ...group('housing', '', ['miete', 'hausverwaltung', 'stadtwerke', 'vattenfall', 'e.on', 'eon energie', 'rundfunk', 'nebenkosten', 'strom', 'ostrom', 'tibber']),
  ...group('telecom', '', ['telekom', 'vodafone', 'o2', 'telefonica', '1&1', 'congstar', 'aldi talk', 'fraenk', 'pyur']),
  ...group('groceries', '', ['rewe', 'edeka', 'lidl', 'aldi', 'penny', 'netto', 'kaufland', 'denns', 'bio company', 'alnatura', 'go asia', 'asia markt', 'flink', 'picnic', 'tegut', 'nahkauf']),
  ...group('household', '', ['dm-drogerie', 'dm drogerie', 'dm fil', 'rossmann', 'budni', 'müller drogerie']),
  ...group('dining', '', ['restaurant', 'lieferando', 'wolt', 'uber eats', 'ubereats', 'mcdonald', 'burger king', 'starbucks', 'cafe', 'café', 'bäckerei', 'baeckerei', 'kfc', 'subway', 'pizza', 'sushi', 'ramen', 'imbiss', 'bistro', 'kantine', 'mensa']),
  ...group('subscriptions', '', ['netflix', 'spotify', 'disney', 'youtube', 'apple.com/bill', 'google', 'prime video', 'amazon prime', 'audible', 'openai', 'chatgpt', 'anthropic', 'claude.ai', 'github', 'icloud', 'dazn', 'kino', 'cinema', 'steam', 'playstation', 'nintendo', 'eventim', 'ticketmaster']),
  ...group('transport', '', ['db vertrieb', 'deutsche bahn', 'db fernverkehr', 'bvg', 'mvg', 'hvv', 'rmv', 'vvs', 'kvb', 'deutschlandticket', 'uber', 'bolt', 'free now', 'tier', 'lime', 'miles', 'share now', 'sixt', 'flixbus', 'aral', 'shell', 'esso', 'tankstelle', 'nextbike']),
  ...group('travel', '', ['lufthansa', 'ryanair', 'easyjet', 'eurowings', 'booking.com', 'airbnb', 'hotel', 'hostel', 'expedia', 'trip.com', 'eva air', 'china airlines']),
  ...group('insurance', '', ['versicherung', 'allianz', 'huk', 'techniker krankenkasse', 'aok', 'barmer', 'getsafe', 'feather', 'ergo', 'axa', 'haftpflicht']),
  ...group('health', '', ['apotheke', 'arzt', 'praxis', 'zahnarzt', 'urban sports', 'fitness', 'mcfit', 'john reed', 'fitx', 'docmorris', 'optiker', 'fielmann']),
  ...group('shopping', '', ['amazon', 'amzn', 'zalando', 'ikea', 'mediamarkt', 'media markt', 'saturn', 'h&m', 'zara', 'uniqlo', 'decathlon', 'ebay', 'otto', 'apple store', 'tk maxx', 'galeria', 'obi', 'bauhaus', 'hornbach', 'temu', 'aliexpress', 'etsy', 'kleinanzeigen', 'thalia', 'about you']),
  ...group('cash', '', ['bargeld', 'geldautomat', 'atm']),
  ...group('fees', '', ['entgelt', 'zinsen', 'gebühr', 'auslandseinsatz', 'kontoführung', 'jahresbeitrag', 'mitgliedsbeitrag']),
  // 補充規則：優先序低於上面所有規則
  ...group('housing', '', ['gasag', 'enbw', 'naturstrom', 'lichtblick', 'yello', 'octopus energy', 'vonovia', 'deutsche wohnen', 'gewobag', 'degewo', 'howoge', 'wohnungsbau', 'wohnungsgesellschaft', 'beitragsservice']),
  ...group('telecom', '', ['drillisch', 'winsim', 'simyo', 'lebara', 'lycamobile', 'freenet', 'unitymedia']),
  ...group('groceries', '', ['norma', 'globus', 'famila', 'marktkauf', 'combi', 'wochenmarkt', 'metro c &', 'metro cash', 'supermarkt', 'lebensmittel', 'biomarkt', 'getränke', 'getraenke']),
  ...group('household', '', ['drogerie']),
  ...group('dining', '', ['backwerk', 'back-factory', 'kamps', 'dunkin', 'vapiano', 'dean & david', 'nordsee', 'döner', 'doener', 'kebab', 'kebap', 'coffee', 'kaffee', 'espresso', 'brauhaus', 'biergarten', 'grill', 'burger', 'thai', 'curry', 'five guys', 'peter pane', 'hans im glück', "l'osteria", 'trattoria', 'pizzeria', 'gaststätte', 'gasthaus', 'eiscafe', 'eiscafé', 'bakery', 'bäcker', 'baecker', 'konditorei', 'bubble tea', 'noodle', 'dumpling', 'wok', 'taverna', 'tapas', 'steakhouse', 'lieferservice']),
  ...group('subscriptions', '', ['adobe', 'microsoft', 'dropbox', 'notion', 'paramount', 'crunchyroll', 'twitch', 'patreon', 'kindle', 'nytimes', 'spiegel', 'linkedin', 'duolingo', 'cinemaxx', 'cinestar', 'uci kino', 'museum', 'theater', 'konzert', 'xbox']),
  ...group('transport', '', ['db bahn', 'bahn.de', 'vrr', 'vbb', 'mvv', 'rheinbahn', 'deutschland-ticket', 'voi', 'parken', 'parkhaus', 'apcoa', 'easypark', 'adac', 'taxi', 'freenow', 'flixtrain', 'tanken', 'star tankstelle', 'total energies', 'totalenergies', 'fahrrad', 'swapfiets']),
  ...group('travel', '', ['klm', 'air france', 'turkish airlines', 'wizz', 'condor', 'tuifly', 'hostelworld', 'hrs', 'agoda', 'marriott', 'hilton', 'ibis', 'motel one', 'b&b hotel']),
  ...group('insurance', '', ['krankenversicherung', 'debeka', 'signal iduna', 'hansemerkur', 'cosmosdirekt', 'wgv', 'lemonade', 'rechtsschutz']),
  ...group('childcare', '', ['kita', 'kitas', 'kindergarten', 'kinderbetreuung', 'tagespflege', 'betreuungskosten', 'essensgeld', 'kinderwelt']),
  ...group('loan', '', ['ratenzahlung', 'darlehen', 'targobank', 'rate per']),
  ...group('cash', 'dkb', ['sparkasse', 'stadtsparkasse', 'volksbank', 'raiffeisenbank']),
  ...group('fees', '', ['monatsgebühr', 'monatsgebuehr', 'teilnahmegebuehr', 'teilnahmegebühr']),
  ...group('insurance', '', ['barmenia', 'krankenvers']),
  ...group('housing', '', ['eprimo', 'hausgeld']),
  ...group('groceries', '', ['edk', 'albert heijn', 'jumbo', 'carrefour', 'migross', 'hanaro', 'dae yang', 'dae-yang', 'amazing oriental', 'andronaco', 'feinkost', 'feinekost', 'superbiomarkt', 'supermaket', 'supermarket', 'markthalle', 'asiamarkt', 'toogoodtogo', 'tgtg', 'bauerngarten']),
  ...group('dining', '', ['gastronomie', 'gastro', 'caffetteria', 'caffe', 'gelateria', 'gelater', 'popeyes', 'losteria', 'le crobag', 'pret a manger', 'backhaus', 'landbaeckerei', 'landbäckerei', 'zeit für brot', 'patisserie', 'cookies', 'churros', 'steakhaus', 'dim sum', 'tonkatsu', 'katsu', 'shawarma', 'doner', 'cuisine', 'meetfresh', 'meet fresh', 'irish pub', 'hofbraeu', 'hofbräu', 'wegrestaurant', 'autogrill', 'snack', 'snackautomat', 'catering', 'food', 'focacceria', 'ravioli', 'pasta', 'kiosk', 'osteria', 'ristorante', 'brasserie', 'bakery', 'cake', 'cakes']),
  ...group('subscriptions', '', ['itunes', 'miniatur wunderland', 'miniaturwunderland', 'pathe', 'freizeitbad', 'erlebnisbad', 'schwimmbad', 'amusement', 'zoo', 'tierpark']),
  ...group('transport', '', ['deutschebahn', 'dbvertrieb', 'verkehrsverbund', 'transports metropolitans', 'high speed rail', 'trenord', 'q-park', 'parking', 'parkeren', 'parkgebuehr', 'parkgebühr', 'a.t.u', 'tankst', 'bft', 'terravision']),
  ...group('travel', '', ['airlines', 'lastminute', 'lastminutecom', 'moxy', 'stow your bags', 'tourismus']),
  ...group('shopping', '', ['smyths', 'baby-walz', 'ernsting', 'segmüller', 'segmueller', 'hema', 'euroshop', 'bijou brigitte', 'joybuy', 'klarna', 'refurbed', 'bialetti', 'blume', 'blumen', 'gartencenter', 'baufuchs', 'heimwerk', 'fairkaufhaus', 'outlet', 'oxfam', 'lindt', 'deutsche post', 'fedex', 'dhl']),
  ...group('health', '', ['physio', 'klinik', 'krankenhaus', 'zahn', 'sanitätshaus', 'mister spex', 'apollo', 'hausarzt', 'orthop', 'dermat', 'labor', 'friseur', 'frisör', 'barber']),
  ...group('shopping', '', ['tedi', 'action', 'woolworth', 'kik', 'primark', 'c&a', 'douglas', 'rituals', 'butlers', 'muji', 'nike', 'adidas', 'apple', 'conrad', 'notebooksbilliger', 'alternate', 'cyberport', 'shein', 'vinted', 'zooplus', 'fressnapf', 'buchhandlung', 'hugendubel', 'dussmann', 'peek & cloppenburg', 'snipes', 'foot locker', 'jysk', 'xxxlutz', 'höffner', 'toom', 'globetrotter']),
];

const regexCache = new Map();

/** 關鍵字必須出現在「單字開頭」，避免 "tier" 命中 "Metier" 之類的誤判。 */
/**
 * 比對前先正規化：小寫，並把商家名稱裡當作分隔的符號換成空白。
 * 例如 "UBER *EATS"、"PAYPAL *SHOP"，以及 DKB Visa 卡的 "Dae.Yang.Lebensmittel/Dusseldorf"。
 * 關鍵字也經過同樣處理，所以 "booking.com" 仍能比對到 "BOOKING.COM"。
 */
const normalize = (s) => s.toLowerCase().replace(/[*_./]+/g, ' ').replace(/\s+/g, ' ').trim();

function keywordRegex(keyword) {
  let re = regexCache.get(keyword);
  if (!re) {
    const escaped = normalize(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const desc = normalize(tx.desc);
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

// 交易說明開頭常見、但不代表商家的字（交易類型、支付平台）
const NOISE = /^(kartenzahlung|lastschrift|basislastschrift|folgelastschrift|überweisung|ueberweisung|echtzeitüberweisung|dauerauftrag|gutschrift|sepa|visa|debitkartenumsatz|onlinezahlung|pp|paypal|sumup|sq|zettle|izettle|ec|girocard|google|pay|apple|ls|sp|cko|ccv|tgtg|www|com|de|3cpayment)$/;

/** 從交易說明猜一個適合當規則的關鍵字（商家名稱的前兩個字）。 */
export function suggestKeyword(desc) {
  let head = desc.split(' · ')[0];
  // DKB Visa 卡的格式是「商家/城市」：只取商家，同一家店才不會因城市寫法不同被拆開
  const beforeSlash = head.split('/')[0];
  if (beforeSlash.replace(/[^\p{L}]/gu, '').length >= 3) head = beforeSlash;
  const all = normalize(head.replace(/[()]/g, ' ')).split(' ').filter((w) => w && !/\d{3,}/.test(w) && !/^\d+$/.test(w));
  const words = all.filter((w) => !NOISE.test(w.replace(/[,:]/g, '')));
  return (words.length ? words : all).slice(0, 2).join(' ').replace(/[,;:]+$/, '');
}
