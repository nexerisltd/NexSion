/* NexSion self-updater
 * -----------------------------------------------------------------------
 * Chrome deliberately does not let an extension write into its own
 * "Load unpacked" folder on its own — there is no API for that, by
 * design, for security reasons. The one legitimate way to get real
 * read/write access to an arbitrary folder on disk is the File System
 * Access API, and that always requires one explicit user gesture (a
 * folder picker) the first time. Once granted, Chrome remembers the
 * permission for that folder handle, so every update after that first
 * link is fully silent: fetch -> unzip -> write -> reload -> swap tab.
 *
 * Release info lives in two small JSON files in a public GitHub repo:
 *   Release.json -> { "version": "3.1.0", "notes": "- Fixed X\n- Added Y" }
 *   Update.json  -> { "latestVersion": "3.1.0", "zipUrl": "https://…/NexSion.zip" }
 * Both must be fetched via raw.githubusercontent.com — the normal
 * github.com/.../blob/... URL returns an HTML viewer page, not JSON.
 * -----------------------------------------------------------------------
 */

const UPDATER_DB_NAME = "nexsion_updater_db";
const UPDATER_STORE = "handles";
const UPDATER_HANDLE_KEY = "updateFolder";
const RELEASE_NOTES_URL = "https://raw.githubusercontent.com/nexerisltd/NexSion/main/Release.json";
const UPDATE_CHECK_URL = "https://raw.githubusercontent.com/nexerisltd/NexSion/main/Update.json";

function openUpdaterDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(UPDATER_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(UPDATER_STORE)) req.result.createObjectStore(UPDATER_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(handle) {
  const db = await openUpdaterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPDATER_STORE, "readwrite");
    tx.objectStore(UPDATER_STORE).put(handle, UPDATER_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadDirHandle() {
  const db = await openUpdaterDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(UPDATER_STORE, "readonly").objectStore(UPDATER_STORE).get(UPDATER_HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function clearDirHandle() {
  const db = await openUpdaterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPDATER_STORE, "readwrite");
    tx.objectStore(UPDATER_STORE).delete(UPDATER_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Must be called directly inside a click handler — browsers require a user gesture. */
async function linkUpdateFolder() {
  if (!window.showDirectoryPicker) {
    throw new Error("This Chrome version doesn't support the File System Access API needed for auto-update. Please update Chrome.");
  }
  const handle = await window.showDirectoryPicker({ id: "nexsion-update-folder", mode: "readwrite" });
  let manifestHandle;
  try {
    manifestHandle = await handle.getFileHandle("manifest.json");
  } catch {
    throw new Error('That folder has no manifest.json in it — pick the exact folder you used for "Load unpacked".');
  }
  let manifestData;
  try {
    manifestData = JSON.parse(await (await manifestHandle.getFile()).text());
  } catch {
    throw new Error("Couldn't read manifest.json in that folder — it looks corrupted.");
  }
  if (manifestData.name !== "NexSion") {
    throw new Error("That folder's manifest.json isn't NexSion's — pick the right folder.");
  }
  await saveDirHandle(handle);
  return true;
}

async function isUpdateFolderLinked() {
  return !!(await loadDirHandle());
}

/** Re-confirms write permission on the saved handle. May itself need a user gesture on some platforms. */
async function getVerifiedDirHandle() {
  const handle = await loadDirHandle();
  if (!handle) return null;
  const current = await handle.queryPermission({ mode: "readwrite" });
  if (current === "granted") return handle;
  const requested = await handle.requestPermission({ mode: "readwrite" });
  return requested === "granted" ? handle : null;
}

async function fetchReleaseNotes() {
  const res = await fetch(RELEASE_NOTES_URL + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't reach the release notes (status " + res.status + ").");
  return res.json();
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

async function checkForUpdate() {
  const res = await fetch(UPDATE_CHECK_URL + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't reach the update server (status " + res.status + ").");
  const data = await res.json();
  const current = chrome.runtime.getManifest().version;
  return {
    current,
    latest: data.latestVersion,
    available: compareVersions(data.latestVersion, current) > 0,
    zipUrl: data.zipUrl,
    notes: data.notes || ""
  };
}

/* ---------------- minimal in-browser ZIP reader ----------------
 * Reads a ZIP's central directory and inflates each entry using the
 * browser's native DecompressionStream("deflate-raw") — no third
 * party library needed, which also keeps this safe under our strict
 * extension_pages CSP (script-src 'self').
 */
async function unzip(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);

  let eocdOffset = -1;
  const searchFloor = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= searchFloor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error("Not a valid ZIP file (no end-of-central-directory record found).");

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cdOffset, true) !== 0x02014b50) throw new Error("Corrupt ZIP central directory.");
    const compressionMethod = view.getUint16(cdOffset + 10, true);
    const compressedSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const name = new TextDecoder().decode(bytes.slice(cdOffset + 46, cdOffset + 46 + nameLen));
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue; // directory entry, no data to write
    const lh = entry.localHeaderOffset;
    if (view.getUint32(lh, true) !== 0x04034b50) throw new Error("Corrupt ZIP local header for " + entry.name);
    const nameLen = view.getUint16(lh + 26, true);
    const extraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + nameLen + extraLen;
    const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);

    let data;
    if (entry.compressionMethod === 0) {
      data = compressed;
    } else if (entry.compressionMethod === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error("Unsupported ZIP compression for " + entry.name + " — re-zip the release using standard Deflate or Store.");
    }
    files.push({ name: entry.name, data });
  }
  return files;
}

/** If every file sits under one shared top-level folder ("NexSion/js/app.js"), strip it. */
function stripTopFolder(files) {
  if (!files.length) return files;
  const roots = files.map(f => f.name.split("/")[0]);
  const singleRoot = files.every(f => f.name.includes("/")) && roots.every(r => r === roots[0]);
  if (!singleRoot) return files;
  return files.map(f => ({ name: f.name.split("/").slice(1).join("/"), data: f.data }));
}

async function writeFilesToDir(dirHandle, files) {
  for (const file of files) {
    if (!file.name) continue;
    const parts = file.name.split("/").filter(Boolean);
    const fileName = parts.pop();
    let dir = dirHandle;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file.data);
    await writable.close();
  }
}

/**
 * Downloads, extracts, and installs an update in place, then hands off
 * to background.js to reload the extension and swap the current tab
 * for a fresh one running the new code.
 * onProgress(stage) gets short status strings for UI feedback.
 */
async function installUpdate(zipUrl, onProgress) {
  const dirHandle = await getVerifiedDirHandle();
  if (!dirHandle) throw new Error("Update folder isn't linked (or permission was revoked) — link it again first.");

  onProgress?.("Downloading update…");
  const res = await fetch(zipUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("Download failed (status " + res.status + ").");
  const buffer = await res.arrayBuffer();

  onProgress?.("Extracting files…");
  let files = await unzip(buffer);
  files = stripTopFolder(files);
  if (!files.some(f => f.name === "manifest.json")) {
    throw new Error("That ZIP doesn't have a manifest.json at its root — check the release ZIP's folder structure.");
  }

  onProgress?.("Installing…");
  await writeFilesToDir(dirHandle, files);

  onProgress?.("Restarting NexSion…");
  await chrome.storage.local.set({ nexsion_pending_changelog: true });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: "prepare-post-update-swap", oldTabId: tab?.id ?? null });
  chrome.runtime.reload();
}

self.NexSionUpdater = {
  isUpdateFolderLinked, linkUpdateFolder, getVerifiedDirHandle, clearDirHandle,
  fetchReleaseNotes, checkForUpdate, installUpdate
};
