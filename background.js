/* ==========================================
   CONFIG & STATE
   ========================================== */
let restoring = false;

const log = (label, message) => {
  const timestamp = new Date().toLocaleTimeString();
  console.log(
    `%c[${timestamp}] %c${label.toUpperCase()}: %c${message}`,
    "color: gray",
    "color: #F44336; font-weight: bold",
    "color: #4CAF50",
  );
};

/* ==========================================
   SNAPSHOT & RESTORE LOGIC
   ========================================== */

async function takeSnapshot() {
  log("storage", "Capturing layout snapshot...");
  const tree = await browser.bookmarks.getTree();

  const normalize = (node) => ({
    type: node.type,
    title: node.title || "",
    url: node.url || "",
    children: node.children ? node.children.map(normalize) : [],
  });

  const newSnapshot = {};
  for (const root of tree[0].children) {
    newSnapshot[root.id] = root.children ? root.children.map(normalize) : [];
  }

  await browser.storage.local.set({ snapshot: newSnapshot });
  log("storage", "Snapshot synchronized.");
}

async function restoreSnapshot() {
  if (restoring) return;

  const data = await browser.storage.local.get(["locked", "snapshot"]);
  const isLocked = data.locked ?? false;
  const currentSnapshot = data.snapshot ?? {};

  if (!isLocked) return;

  restoring = true;
  log("guard", "Unauthorized change detected. Reverting...");

  for (const rootId of Object.keys(currentSnapshot)) {
    try {
      const currentItems = await browser.bookmarks.getChildren(rootId);
      await diffAndFix(rootId, currentItems, currentSnapshot[rootId]);
    } catch (e) {
      log("error", `Failed to restore root: ${rootId}`);
    }
  }

  restoring = false;
  log("guard", "Layout verified and restored.");
}

async function diffAndFix(parentId, current, desired) {
  const used = new Set();

  for (let i = 0; i < desired.length; i++) {
    const want = desired[i];
    let found = current.find(
      (cur) =>
        !used.has(cur.id) &&
        cur.title === want.title &&
        (cur.url || "") === (want.url || ""),
    );

    if (!found) {
      const newNode = await createNode(parentId, want, i);
      used.add(newNode.id);
      continue;
    }

    used.add(found.id);
    if (found.index !== i) {
      await browser.bookmarks.move(found.id, { index: i });
    }

    if (want.type === "folder") {
      const kids = await browser.bookmarks.getChildren(found.id);
      await diffAndFix(found.id, kids, want.children);
    }
  }

  for (const cur of current) {
    if (!used.has(cur.id)) await browser.bookmarks.removeTree(cur.id);
  }
}

async function createNode(parentId, node, index) {
  const data = { parentId, index, title: node.title };
  if (node.type === "separator") data.type = "separator";
  else if (node.type === "folder") {
    const f = await browser.bookmarks.create(data);
    for (const c of node.children) await createNode(f.id, c);
    return f;
  } else data.url = node.url;
  return browser.bookmarks.create(data);
}

/* ==========================================
   LISTENERS
   ========================================== */

browser.bookmarks.onCreated.addListener(restoreSnapshot);
browser.bookmarks.onMoved.addListener(restoreSnapshot);
browser.bookmarks.onChanged.addListener(restoreSnapshot);
browser.bookmarks.onRemoved.addListener(restoreSnapshot);

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === "updateLock") {
    await browser.storage.local.set({ locked: msg.value });
    if (msg.value) await takeSnapshot();

    browser.action.setBadgeText({ text: msg.value ? "🔒" : "" });
    log("event", `Protection ${msg.value ? "Enabled" : "Disabled"}`);
  } else if (msg.action === "getState") {
    const data = await browser.storage.local.get("locked");
    return { locked: data.locked ?? false };
  }
});

/* ==========================================
   INITIALIZATION & STARTUP
   ========================================== */

(async () => {
  const data = await browser.storage.local.get(["locked"]);
  let isLocked = data.locked;

  if (isLocked === undefined) {
    log("init", "First run detected. Initializing to Unlocked.");
    isLocked = false;
    await browser.storage.local.set({ locked: false });
  }

  browser.action.setBadgeText({ text: isLocked ? "🔒" : "" });
  log("init", `Session started. Mode: ${isLocked ? "Locked" : "Unlocked"}`);
})();
