// 自動匯入資料夾：用 File System Access API 讀取使用者授權的本機資料夾（僅 Chrome／Edge 桌面版）。
// 資料夾 handle 無法放進 localStorage，所以存在 IndexedDB。

export const supported = typeof globalThis.showDirectoryPicker === 'function';

const DB_NAME = 'monthly-budget';
const STORE = 'handles';
const KEY = 'statements-folder';

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { open.result.close(); resolve(req.result); };
      tx.onerror = () => { open.result.close(); reject(tx.error); };
    };
  });
}

export const saveHandle = (handle) => withStore('readwrite', (s) => s.put(handle, KEY));
export const loadHandle = () => withStore('readonly', (s) => s.get(KEY));
export const clearHandle = () => withStore('readwrite', (s) => s.delete(KEY));

/** 列出資料夾（含兩層子資料夾）內的 CSV 檔。 */
export async function listCsvFiles(dir, depth = 2, prefix = '') {
  const out = [];
  for await (const entry of dir.values()) {
    const path = prefix + entry.name;
    if (entry.kind === 'file' && /\.csv$/i.test(entry.name)) out.push({ path, file: await entry.getFile() });
    else if (entry.kind === 'directory' && depth > 0 && !entry.name.startsWith('.')) out.push(...await listCsvFiles(entry, depth - 1, `${path}/`));
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** 檔案指紋：同一路徑、大小與修改時間視為已處理過。 */
export const fingerprint = (path, file) => `${path}|${file.size}|${file.lastModified}`;
