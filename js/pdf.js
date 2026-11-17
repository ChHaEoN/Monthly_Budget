// PDF 帳單讀取（僅瀏覽器）：用 pdf.js 在本機擷取文字，資料不會離開瀏覽器。
import { extractTransactions, detectPdfSource, pagesText } from './pdf-text.js';

let pdfjsPromise;

function loadPdfjs() {
  pdfjsPromise ??= import('../vendor/pdfjs/pdf.min.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return pdfjs;
  });
  return pdfjsPromise;
}

/** 回傳 { rows, source, signed }；rows 的形狀與 CSV 相同（含標題列）。 */
export async function readPdf(buffer, filename) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    throw new Error(err?.name === 'PasswordException' ? 'PDF 有密碼保護，請先移除密碼' : '無法開啟這個 PDF');
  }
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.filter((it) => it.str).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })));
  }
  await task.destroy();
  if (!pages.some((p) => p.length)) throw new Error('PDF 裡沒有可讀取的文字（可能是掃描檔）');
  const source = detectPdfSource(pagesText(pages), filename);
  const { transactions, signed } = extractTransactions(pages, { card: source === 'amex' || source === 'amazon' });
  return {
    rows: [['Datum', 'Beschreibung', 'Betrag'], ...transactions.map((t) => [t.date, t.desc, t.amount.toFixed(2)])],
    source,
    signed,
  };
}
