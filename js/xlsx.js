// 極簡 .xlsx 讀取器：只讀第一張工作表，輸出字串二維陣列（與 CSV 解析結果相同形狀）。
// xlsx 是 zip 包著 XML；用瀏覽器／Node 內建的 DecompressionStream 解壓，不需要第三方函式庫。

const decoder = new TextDecoder('utf-8');

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 讀取 zip 的中央目錄，回傳 檔名 → 讀取函式。 */
function zipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 檔');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count && view.getUint32(p, true) === 0x02014b50; n++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return decoder.decode(data);
      if (method === 8) return decoder.decode(await inflateRaw(data));
      throw new Error('不支援的 xlsx 壓縮方式');
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e] ?? m;
});
const attr = (attrs, name) => attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
const textOf = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));
}

/** 回傳每個 cell style 是否為日期格式。 */
function parseDateStyles(xml) {
  const custom = new Map();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) custom.set(Number(attr(m[1], 'numFmtId')), unescapeXml(attr(m[1], 'formatCode') ?? ''));
  const xfs = xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? '';
  return [...xfs.matchAll(/<xf\b([^>]*)/g)].map((m) => {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
    const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return /[dy]/i.test(code);
  });
}

const pad = (n) => String(n).padStart(2, '0');

function serialToDate(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)?.[0] ?? '') n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export async function readXlsx(buffer) {
  const zip = zipEntries(buffer);
  const read = async (name) => (zip.has(name) ? zip.get(name)() : '');
  const sheetName = [...zip.keys()]
    .filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))[0];
  if (!sheetName) throw new Error('xlsx 檔裡找不到工作表');
  const strings = parseSharedStrings(await read('xl/sharedStrings.xml'));
  const dateStyles = parseDateStyles(await read('xl/styles.xml'));
  const sheet = await read(sheetName);
  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    let next = 0;
    for (const c of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], 'r');
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = attr(c[1], 't');
      const raw = c[2]?.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (type === 'inlineStr') value = textOf(c[2] ?? '');
      else if (raw == null) value = '';
      else if (type === 's') value = strings[Number(raw)] ?? '';
      else if (type === 'str' || type === 'b' || type === 'e') value = unescapeXml(raw);
      else {
        const n = Number(raw);
        if (!Number.isFinite(n)) value = raw;
        else if (dateStyles[Number(attr(c[1], 's') ?? 0)] && n > 0) value = serialToDate(n);
        else value = String(Math.round(n * 100) / 100);
      }
      row[col] = value;
    }
    rows.push(Array.from(row, (v) => v ?? ''));
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}
