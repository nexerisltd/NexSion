/* NexSion storage layer
 * -----------------------------------------------------------------------
 * Performance notes (v3.1 optimization pass):
 *  - getMergedBucket() used to hit chrome.storage.sync.get(null) AND
 *    chrome.storage.local.get(null) on every single call. A normal
 *    refresh() called it 3x back-to-back (getPages/getBoards/getAllItems)
 *    = 6 full-storage reads per screen refresh. We now cache the merged
 *    bucket in memory for the lifetime of one "tick" and invalidate it
 *    immediately on any write, or when storage changes from another
 *    context (popup, background, other open tabs, cloud sync).
 *  - This does not change any external behavior/API — Store.* still
 *    returns the same data, just without redundant round-trips.
 * -----------------------------------------------------------------------
 */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const SYNCED_SETTINGS_KEYS = [
  "theme", "accentColor", "accentColorSecondary", "textColor", "mutedTextColor",
  "accentHueDeg", "accentMood", "openInNewTab", "wallpaperType", "wallpaperPreset",
  "wallpaperCloudUrl", "wallpaperGalleryId", "wallpaperYoutubeId", "quickSaveBoardId",
  "widgets", "widgetNotepad", "widgetLayout"
];
const LOCAL_SETTINGS_KEYS = ["performanceMode", "privacyMode", "wallpaperLocal"];

const SETTINGS_DEFAULTS = {
  theme: "dark",
  accentColor: "#3b9eff",
  accentColorSecondary: "",
  textColor: "",
  mutedTextColor: "",
  accentHueDeg: null,
  accentMood: "",
  openInNewTab: false,
  wallpaperType: "preset",
  wallpaperPreset: "blue",
  wallpaperCloudUrl: "",
  wallpaperGalleryId: "",
  wallpaperYoutubeId: "",
  quickSaveBoardId: "board-quick",
  performanceMode: false,
  privacyMode: false,
  wallpaperLocal: false,
  widgets: { clock: false, weather: false, quote: false, notepad: false },
  widgetNotepad: "",
  widgetLayout: {}
};

/* ---------------- in-memory bucket cache ---------------- */
let _bucketCache = null;   // resolved merged bucket
let _bucketPromise = null; // in-flight fetch (dedupes concurrent callers)

function invalidateBucketCache() {
  _bucketCache = null;
  _bucketPromise = null;
}

// Bust the cache if another context (background worker, popup, another
// open tab, or an incoming cloud-sync pull) writes to storage directly.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener(() => invalidateBucketCache());
}

async function migrateWallpaperBlobIfNeeded() {
  const { local_settings: e } = await chrome.storage.local.get("local_settings");
  const t = e?.wallpaperDataUrl;
  if (!t) return;
  try {
    const res = await fetch(t);
    const blob = await res.blob();
    await self.WallpaperDB.saveBlob(blob);
    const { wallpaperDataUrl, ...rest } = e;
    await chrome.storage.local.set({ local_settings: { ...rest, wallpaperLocal: true } });
    console.log("[NexSion] Migrated wallpaper to IndexedDB — this should noticeably cut RAM use.");
  } catch (err) {
    console.warn("[NexSion] Wallpaper migration failed, resetting to default wallpaper:", err);
    const { wallpaperDataUrl, ...rest } = e;
    await chrome.storage.local.set({ local_settings: { ...rest, wallpaperLocal: false } });
  }
}

async function getMergedBucket() {
  if (_bucketCache) return _bucketCache;
  if (_bucketPromise) return _bucketPromise;
  _bucketPromise = (async () => {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get(null)
    ]);
    const merged = { ...syncData };
    for (const key of Object.keys(localData)) {
      if (key.startsWith("ovf_")) merged[key.slice(4)] = localData[key];
    }
    _bucketCache = merged;
    return merged;
  })();
  return _bucketPromise;
}

async function readRecord(key) {
  // Cheap path: served from the in-memory bucket cache when warm.
  if (_bucketCache) return _bucketCache[key];
  const synced = await chrome.storage.sync.get(key);
  if (synced[key] !== undefined) return synced[key];
  const local = await chrome.storage.local.get("ovf_" + key);
  return local["ovf_" + key];
}

function notifyCloud() {
  try { self.CloudSync?.notifyChange(); } catch { /* no-op: cloud sync optional */ }
}

async function writeRecordSafe(key, value) {
  invalidateBucketCache();
  try {
    await chrome.storage.sync.set({ [key]: value });
    await chrome.storage.local.remove("ovf_" + key).catch(() => {});
    notifyCloud();
    return true;
  } catch (err) {
    console.warn(`[NexSion] Sync quota hit — "${key}" kept on this device only.`, err);
    await chrome.storage.local.set({ ["ovf_" + key]: value });
    notifyCloud();
    return false;
  }
}

async function removeRecord(key) {
  invalidateBucketCache();
  await Promise.all([
    chrome.storage.sync.remove(key).catch(() => {}),
    chrome.storage.local.remove("ovf_" + key).catch(() => {})
  ]);
  notifyCloud();
}

async function writeManySafe(entries) {
  let overflow = 0;
  // Written sequentially to respect chrome.storage.sync's per-minute write
  // quota; batching further would need a MAX_WRITE_OPERATIONS_PER_MINUTE
  // aware queue, which is out of scope for this pass.
  for (const [key, value] of entries) {
    if (!(await writeRecordSafe(key, value))) overflow++;
  }
  return overflow;
}

async function migrateFromLocalArraysIfPresent() {
  const e = await chrome.storage.local.get(["lb_pages", "lb_boards", "lb_items", "lb_settings"]);
  if (!e.lb_pages || e.lb_pages.length === 0) return false;
  console.log("[NexSion] Migrating existing bookmarks to the new sync-enabled storage…");
  const pages = e.lb_pages || [], boards = e.lb_boards || [], items = e.lb_items || [];
  const overflow = await writeManySafe([
    ...pages.map(p => ["sp:" + p.id, p]),
    ...boards.map(b => ["sb:" + b.id, b]),
    ...items.map(i => ["si:" + i.id, i])
  ]);
  if (e.lb_settings) {
    const src = e.lb_settings, synced = {}, local = {};
    for (const key of Object.keys(src)) {
      if (LOCAL_SETTINGS_KEYS.includes(key)) local[key] = src[key];
      else if (SYNCED_SETTINGS_KEYS.includes(key)) synced[key] = src[key];
    }
    if (Object.keys(synced).length) await chrome.storage.sync.set({ sync_settings: synced }).catch(() => {});
    if (Object.keys(local).length) await chrome.storage.local.set({ local_settings: local });
  }
  await chrome.storage.local.set({ lb_pages_backup_v1: pages, lb_boards_backup_v1: boards, lb_items_backup_v1: items });
  await chrome.storage.local.remove(["lb_pages", "lb_boards", "lb_items", "lb_settings"]);
  invalidateBucketCache();
  console.log(`[NexSion] Migration done: ${pages.length} pages, ${boards.length} boards, ${items.length} items` +
    (overflow ? ` (${overflow} kept device-local — sync quota was full).` : "."));
  return true;
}

async function ensureSeeded() {
  await migrateWallpaperBlobIfNeeded();
  if (await migrateFromLocalArraysIfPresent()) return;

  const bucket = await getMergedBucket();
  if (!Object.keys(bucket).some(k => k.startsWith("sp:"))) {
    const pageId = "page-home", quickId = "board-quick", readingId = "board-reading";
    await writeManySafe([
      ["sp:" + pageId, { id: pageId, name: "Home", order: 0 }],
      ["sb:" + quickId, { id: quickId, pageId, name: "Quick Saves", order: 0, column: 0, color: "#2F6F62" }],
      ["sb:" + readingId, { id: readingId, pageId, name: "Reading List", order: 0, column: 1, color: "#D9A441" }]
    ]);
  }

  const local = await chrome.storage.local.get(["lb_trash", "local_settings"]);
  const patch = {};
  if (!local.lb_trash) patch.lb_trash = [];
  if (!local.local_settings) {
    patch.local_settings = {
      performanceMode: SETTINGS_DEFAULTS.performanceMode,
      privacyMode: SETTINGS_DEFAULTS.privacyMode,
      wallpaperLocal: SETTINGS_DEFAULTS.wallpaperLocal
    };
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}

let overflowNotified = false;
function notifyOverflow() {
  if (overflowNotified) return;
  overflowNotified = true;
  try { self.dispatchEvent(new CustomEvent("nexsion-sync-overflow")); } catch { /* no listener yet */ }
}

const Store = {
  uid,
  ensureSeeded,

  async getPages() {
    const bucket = await getMergedBucket();
    return Object.keys(bucket).filter(k => k.startsWith("sp:")).map(k => bucket[k]).sort((a, b) => a.order - b.order);
  },

  async getBoards(pageId) {
    const bucket = await getMergedBucket();
    return Object.keys(bucket).filter(k => k.startsWith("sb:")).map(k => bucket[k])
      .filter(b => !pageId || b.pageId === pageId).sort((a, b) => a.order - b.order);
  },

  async getItems(boardId) {
    const bucket = await getMergedBucket();
    return Object.keys(bucket).filter(k => k.startsWith("si:")).map(k => bucket[k])
      .filter(i => !boardId || i.boardId === boardId).sort((a, b) => a.order - b.order);
  },

  async getAllItems() { return this.getItems(null); },

  async addPage(name) {
    const pages = await this.getPages();
    const page = { id: "page-" + uid(), name, order: pages.length };
    if (!(await writeRecordSafe("sp:" + page.id, page))) notifyOverflow();
    return page;
  },

  async renamePage(id, name) {
    const page = await readRecord("sp:" + id);
    if (page) await writeRecordSafe("sp:" + id, { ...page, name });
  },

  async deletePage(id) {
    const bucket = await getMergedBucket();
    const boardKeys = Object.keys(bucket).filter(k => k.startsWith("sb:") && bucket[k].pageId === id);
    const boardIds = boardKeys.map(k => bucket[k].id);
    const itemKeys = Object.keys(bucket).filter(k => k.startsWith("si:") && boardIds.includes(bucket[k].boardId));
    await Promise.all(["sp:" + id, ...boardKeys, ...itemKeys].map(removeRecord));
  },

  async addBoard(pageId, name, color, column, kind) {
    const col = column ?? 0;
    const boards = await this.getBoards(pageId);
    const board = {
      id: "board-" + uid(), pageId, name,
      order: boards.filter(b => b.column === col).length,
      column: col, color: color || "#2F6F62",
      type: kind === "checklist" ? "checklist" : "links"
    };
    if (!(await writeRecordSafe("sb:" + board.id, board))) notifyOverflow();
    return board;
  },

  async renameBoard(id, name) {
    const board = await readRecord("sb:" + id);
    if (board) await writeRecordSafe("sb:" + id, { ...board, name });
  },

  async deleteBoard(id) {
    const bucket = await getMergedBucket();
    const itemKeys = Object.keys(bucket).filter(k => k.startsWith("si:") && bucket[k].boardId === id);
    await Promise.all(["sb:" + id, ...itemKeys].map(removeRecord));
  },

  async reorderBoards(pageId, orderedIds) {
    const boards = await this.getBoards(pageId);
    const writes = [];
    orderedIds.forEach((id, order) => {
      const board = boards.find(b => b.id === id);
      if (board && board.order !== order) writes.push(["sb:" + id, { ...board, order }]);
    });
    if (writes.length) await writeManySafe(writes);
  },

  async applyBoardLayout(pageId, columns) {
    const boards = await this.getBoards(pageId);
    const writes = [];
    columns.forEach((col, colIndex) => {
      col.forEach((id, order) => {
        const board = boards.find(b => b.id === id);
        if (board && !(board.column === colIndex && board.order === order)) {
          writes.push(["sb:" + id, { ...board, column: colIndex, order }]);
        }
      });
    });
    if (writes.length) await writeManySafe(writes);
  },

  async addItem({ boardId, title, url, favicon, description, checked, remindAt, tags }) {
    const items = await this.getItems(boardId);
    const item = {
      id: "item-" + uid(), boardId, title: title || url, url: url || "",
      favicon: favicon || "", description: description || "", checked: !!checked,
      remindAt: remindAt || null, tags: tags || [], order: items.length, createdAt: Date.now()
    };
    if (!(await writeRecordSafe("si:" + item.id, item))) notifyOverflow();
    return item;
  },

  async updateItem(id, patch) {
    const item = await readRecord("si:" + id);
    if (item) await writeRecordSafe("si:" + id, { ...item, ...patch });
  },

  async deleteItem(id) {
    const item = await readRecord("si:" + id);
    if (!item) return;
    await removeRecord("si:" + id);
    const { lb_trash } = await chrome.storage.local.get("lb_trash");
    const trash = [{ ...item, deletedAt: Date.now() }, ...(lb_trash || [])].slice(0, 20);
    await chrome.storage.local.set({ lb_trash: trash });
    notifyCloud();
  },

  async getTrash() {
    const { lb_trash } = await chrome.storage.local.get("lb_trash");
    return lb_trash || [];
  },

  async restoreFromTrash(id) {
    const trash = await this.getTrash();
    const entry = trash.find(t => t.id === id);
    if (!entry) return;
    const boards = await this.getBoards();
    const board = boards.find(b => b.id === entry.boardId) || boards[0];
    if (!board) return;
    const items = await this.getItems(board.id);
    const { deletedAt, ...rest } = entry;
    rest.boardId = board.id;
    rest.order = items.length;
    await writeRecordSafe("si:" + rest.id, rest);
    await chrome.storage.local.set({ lb_trash: trash.filter(t => t.id !== id) });
    notifyCloud();
  },

  async clearTrash() {
    await chrome.storage.local.set({ lb_trash: [] });
    notifyCloud();
  },

  async moveItem(id, boardId, order) {
    const bucket = await getMergedBucket();
    const moving = bucket["si:" + id];
    if (!moving) return;
    const siblings = Object.keys(bucket)
      .filter(k => k.startsWith("si:") && bucket[k].boardId === boardId && k !== "si:" + id)
      .map(k => bucket[k]).sort((a, b) => a.order - b.order);
    siblings.splice(order, 0, { ...moving, boardId });
    const writes = siblings
      .map((item, idx) => [item, idx])
      .filter(([item, idx]) => item.order !== idx || item.boardId !== boardId)
      .map(([item, idx]) => ["si:" + item.id, { ...item, order: idx }]);
    if (writes.length) await writeManySafe(writes);
  },

  async getSettings() {
    const [sync, local] = await Promise.all([
      chrome.storage.sync.get("sync_settings"),
      chrome.storage.local.get("local_settings")
    ]);
    return { ...SETTINGS_DEFAULTS, ...(sync.sync_settings || {}), ...(local.local_settings || {}) };
  },

  async setSettings(patch) {
    const synced = {}, local = {};
    for (const key of Object.keys(patch)) {
      (LOCAL_SETTINGS_KEYS.includes(key) ? local : synced)[key] = patch[key];
    }
    const tasks = [];
    if (Object.keys(synced).length) {
      tasks.push((async () => {
        const existing = (await chrome.storage.sync.get("sync_settings")).sync_settings || {};
        try {
          await chrome.storage.sync.set({ sync_settings: { ...existing, ...synced } });
        } catch (err) {
          console.warn("[NexSion] Settings sync quota hit, saving locally instead:", err);
          const existingLocal = (await chrome.storage.local.get("local_settings")).local_settings || {};
          await chrome.storage.local.set({ local_settings: { ...existingLocal, ...synced } });
        }
      })());
    }
    if (Object.keys(local).length) {
      tasks.push((async () => {
        const existing = (await chrome.storage.local.get("local_settings")).local_settings || {};
        await chrome.storage.local.set({ local_settings: { ...existing, ...local } });
      })());
    }
    await Promise.all(tasks);
    notifyCloud();
  },

  async getUser() {
    const { lb_user } = await chrome.storage.local.get("lb_user");
    return lb_user || null;
  },

  async setUser(user) {
    await chrome.storage.local.set({ lb_user: user });
  },

  async exportPageData(pageId) {
    const page = (await this.getPages()).find(p => p.id === pageId);
    if (!page) return null;
    const boards = await this.getBoards(pageId);
    const items = await this.getAllItems();
    return {
      exportedFrom: "NexSion",
      page: { name: page.name },
      boards: boards.map(b => ({
        name: b.name,
        column: b.column ?? 0,
        order: b.order ?? 0,
        color: b.color || "",
        links: items.filter(i => i.boardId === b.id).sort((a, b2) => a.order - b2.order)
          .map(i => ({ title: i.title, url: i.url, description: i.description || "" }))
      }))
    };
  },

  async importFromChromeBookmarks() {
    const tree = await chrome.bookmarks.getTree();
    let importPage = (await this.getPages()).find(p => p.name === "Imported");
    if (!importPage) importPage = await this.addPage("Imported");
    let columnOrder = (await this.getBoards(importPage.id)).length;
    const writes = [];
    let boardsAdded = 0, itemsAdded = 0;
    (function walk(nodes) {
      for (const node of nodes) {
        if (node.children) {
          const links = node.children.filter(c => c.url);
          if (links.length > 0) {
            const boardId = "board-" + uid();
            writes.push(["sb:" + boardId, {
              id: boardId, pageId: importPage.id, name: node.title || "Untitled Folder",
              order: columnOrder++, column: 0, color: "#4A5568"
            }]);
            boardsAdded++;
            links.forEach((link, idx) => {
              const itemId = "item-" + uid();
              writes.push(["si:" + itemId, {
                id: itemId, boardId, title: link.title || link.url, url: link.url,
                favicon: "", description: "", order: idx, createdAt: Date.now()
              }]);
              itemsAdded++;
            });
          }
          walk(node.children);
        }
      }
    })(tree);
    if (writes.length === 0) return { boardsAdded: 0, itemsAdded: 0, overflowCount: 0 };
    const overflowCount = await writeManySafe(writes);
    return { boardsAdded, itemsAdded, overflowCount };
  },

  async exportAllData() {
    const [sync, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]);
    delete local.cs_session;
    delete local.cs_local_updated_at;
    delete local.lb_user;
    return { exportedFrom: "NexSion", exportedAt: Date.now(), sync, local };
  },

  async importAllData(data) {
    if (!data || typeof data !== "object" || !data.sync) {
      throw new Error("That doesn't look like a valid NexSion backup file.");
    }
    if (data.local) delete data.local.lb_user;
    await Promise.all([
      chrome.storage.sync.set(data.sync || {}),
      chrome.storage.local.set(data.local || {})
    ]);
    invalidateBucketCache();
    notifyCloud();
  },

  async deleteAllLocalData() {
    const bucket = await getMergedBucket();
    const keys = Object.keys(bucket).filter(k => k.startsWith("sp:") || k.startsWith("sb:") || k.startsWith("si:"));
    await Promise.all(keys.map(removeRecord));
    await chrome.storage.local.set({ lb_trash: [] });
    await (self.WallpaperDB?.clearBlob().catch(() => {}));
  },

  async clearBoardData() {
    const bucket = await getMergedBucket();
    const keys = Object.keys(bucket).filter(k => k.startsWith("sp:") || k.startsWith("sb:") || k.startsWith("si:"));
    await Promise.all(keys.map(removeRecord));
    await chrome.storage.local.set({ lb_trash: [] });
  }
};

self.Store = Store;
