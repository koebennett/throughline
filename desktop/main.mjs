// Throughline for Windows (and macOS/Linux): an Electron shell around the same local server.
// The API binds to 127.0.0.1 on a random free port; data lives in the user's AppData folder.
import { app, BrowserWindow, Menu, shell, dialog, Notification } from "electron";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let server = null;
let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

async function boot() {
  const dataDir = app.getPath("userData");
  mkdirSync(dataDir, { recursive: true });
  // Optional: a .env in the data folder (e.g. ANTHROPIC_API_KEY). Keys can also be saved in Settings (encrypted).
  const envFile = join(dataDir, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  process.env.CSA_LOG ??= "silent";
  const { loadConfig } = await import(pathToFileURL(join(root, "dist/server/server/config.js")).href);
  const { startServer } = await import(pathToFileURL(join(root, "dist/server/server/server.js")).href);
  const config = { ...loadConfig({ ...process.env, CSA_DB_PATH: join(dataDir, "throughline.sqlite") }), host: "127.0.0.1", port: 0 };
  server = await startServer(config, { clientDir: join(root, "dist/client") });
  // Lets the Throughline MCP server (Claude Desktop/Code) find this instance's random port.
  writeFileSync(join(dataDir, "runtime.json"), JSON.stringify({ url: server.url, pid: process.pid }));
  createWindow(server.url);
}

function createWindow(url) {
  const origin = new URL(url).origin;
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Throughline",
    backgroundColor: "#f6f5f2",
    icon: join(here, "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  // Open http(s) links in the system browser; never in-app, never other schemes.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target) && !target.startsWith(origin)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (!target.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    }
  });
  win.loadURL(url);
  buildMenu();
  // Automated smoke test: THROUGHLINE_SMOKE_SHOT=<png path> captures the loaded window and exits.
  const shot = process.env.THROUGHLINE_SMOKE_SHOT;
  if (shot)
    win.webContents.once("did-finish-load", () =>
      setTimeout(async () => {
        writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
        // Machine-checkable result: a blank window (e.g. assets failed to load) must fail the smoke test.
        const text = await win.webContents.executeJavaScript("document.body.innerText");
        writeFileSync(`${shot}.json`, JSON.stringify({ textLength: text.length, hasApp: /Throughline/.test(text) }));
        app.exit(text.length > 50 ? 0 : 3);
      }, 2500),
    );
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Open data folder", click: () => shell.openPath(app.getPath("userData")) },
        {
          label: "Back up database…",
          click: async () => {
            const dir = join(app.getPath("userData"), "backups");
            mkdirSync(dir, { recursive: true });
            const file = join(dir, `throughline-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
            server.ctx.db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
            const r = await dialog.showMessageBox(win, { type: "info", message: "Backup created", detail: `${file}\n\nKeep secret.key from the data folder alongside it to restore saved keys.`, buttons: ["Show in folder", "OK"] });
            if (r.response === 0) shell.showItemInFolder(file);
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }, ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }])] },
    {
      label: "Help",
      submenu: [
        { label: "About Throughline", click: () => dialog.showMessageBox(win, { type: "info", message: `Throughline ${app.getVersion()}`, detail: "Evidence-led content strategy agent. Local-first: your data stays in the data folder on this computer." }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Desktop notification when an agent run needs your approval (polls the local DB; cheap).
function watchApprovals() {
  const seen = new Set();
  setInterval(() => {
    if (!server || !Notification.isSupported()) return;
    const rows = server.ctx.db.all("SELECT id, task FROM agent_runs WHERE status = 'awaiting_approval'");
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const n = new Notification({ title: "Throughline needs your approval", body: `${r.task.replace(/_/g, " ")} is waiting for your decision.` });
      n.on("click", () => {
        win?.show();
        win?.loadURL(`${server.url}/agent?run=${r.id}`);
      });
      n.show();
    }
  }, 5000).unref();
}

app.whenReady().then(async () => {
  try {
    await boot();
    watchApprovals();
  } catch (e) {
    dialog.showErrorBox("Throughline could not start", String(e?.stack ?? e));
    app.quit();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  try {
    unlinkSync(join(app.getPath("userData"), "runtime.json"));
  } catch {
    /* already gone */
  }
  server?.close();
});
