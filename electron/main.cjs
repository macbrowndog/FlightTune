const { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, shell } = require("electron");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { atomicReplaceWithBackup, decodeConfigBuffer } = require("./config-file.cjs");

const execFileAsync = promisify(execFile);
const MSFS_PROCESS_IMAGES = ["FlightSimulator2024.exe", "FlightSimulator.exe"];

// The interface is deliberately CPU-rendered so it also starts reliably on
// systems with broken, remote, or recently changed graphics drivers.
app.disableHardwareAcceleration();

function detectionScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "electron", "detect-hardware.ps1")
    : path.join(__dirname, "detect-hardware.ps1");
}

async function detectHardware() {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", detectionScriptPath()],
    { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
  );
  const result = JSON.parse(stdout.trim());
  return { ...result, source: "Windows hardware inventory" };
}

async function isMsfsRunning() {
  for (const image of MSFS_PROCESS_IMAGES) {
    const { stdout } = await execFileAsync(
      "tasklist.exe",
      ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"],
      { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 },
    );
    const firstField = stdout.trim().match(/^"([^"]+)"/i)?.[1];
    if (firstField?.toLowerCase() === image.toLowerCase()) return true;
  }
  return false;
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function profilesPath() {
  return path.join(app.getPath("userData"), "manual-profiles");
}

function profileFilePath(id) {
  const safeId = String(id || "");
  if (!/^[a-f0-9-]{36}$/i.test(safeId)) throw new Error("Invalid profile identifier.");
  return path.join(profilesPath(), `${safeId}.json`);
}

function profileSummary(profile) {
  return {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    sourceName: profile.sourceName,
    flightMode: profile.flightMode,
    antiAliasing: profile.antiAliasing,
    dlssMode: profile.dlssMode,
  };
}

async function readManualProfile(id) {
  const profile = JSON.parse(await fs.readFile(profileFilePath(id), "utf8"));
  if (profile.id !== id || typeof profile.name !== "string" || typeof profile.content !== "string") {
    throw new Error("This saved profile is invalid.");
  }
  return profile;
}

async function listManualProfiles() {
  await fs.mkdir(profilesPath(), { recursive: true });
  const entries = await fs.readdir(profilesPath(), { withFileTypes: true });
  const profiles = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9-]{36}\.json$/i.test(entry.name)) continue;
    try {
      const profile = JSON.parse(await fs.readFile(path.join(profilesPath(), entry.name), "utf8"));
      if (profile.id && profile.name && typeof profile.content === "string") profiles.push(profileSummary(profile));
    } catch {
      // Ignore damaged profile files so one bad snapshot cannot stop the library loading.
    }
  }
  return profiles.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function saveManualProfile(payload) {
  const name = String(payload?.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const content = String(payload?.content || "");
  if (!name) return { ok: false, error: "Enter a name for this manual profile." };
  if (!content.trim()) return { ok: false, error: "Load a UserCfg.opt file before saving a profile." };
  if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) {
    return { ok: false, error: "This configuration is too large to save as a profile." };
  }
  const existing = await listManualProfiles();
  if (existing.some((profile) => profile.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: "A profile with this name already exists. Choose another name." };
  }
  const id = crypto.randomUUID();
  const profile = {
    id,
    name,
    createdAt: new Date().toISOString(),
    sourceName: path.basename(String(payload?.sourceName || "UserCfg.opt")),
    sourcePath: String(payload?.sourcePath || ""),
    flightMode: payload?.flightMode === "ifr" ? "ifr" : "vfr",
    antiAliasing: payload?.antiAliasing === "TAA" ? "TAA" : "DLSS",
    dlssMode: ["Auto", "DLAA", "Quality", "Balanced", "Performance", "Ultra Performance"].includes(payload?.dlssMode)
      ? payload.dlssMode
      : "Quality",
    content,
  };
  await fs.mkdir(profilesPath(), { recursive: true });
  await fs.writeFile(profileFilePath(id), JSON.stringify(profile, null, 2), { encoding: "utf8", flag: "wx" });
  return { ok: true, profile: profileSummary(profile) };
}

async function applyManualProfile(id) {
  const profile = await readManualProfile(id);
  const targetPath = String(profile.sourcePath || "");
  if (!path.isAbsolute(targetPath) || path.basename(targetPath).toLowerCase() !== "usercfg.opt") {
    return {
      ok: false,
      error: "This profile is not linked to a live UserCfg.opt. Import the live MSFS file and save the profile again.",
    };
  }
  const target = await fs.stat(targetPath).catch(() => null);
  if (!target?.isFile()) {
    return { ok: false, error: "The original UserCfg.opt can no longer be found. Import it again before applying this profile." };
  }
  if (await isMsfsRunning()) {
    return { ok: false, error: "MSFS is currently running. Close the simulator completely before applying a profile." };
  }
  const confirmation = await dialog.showMessageBox({
    type: "warning",
    title: "Load profile into MSFS",
    message: `Apply \"${profile.name}\" to the live UserCfg.opt?`,
    detail: `FlightTune will verify MSFS is closed, create and verify a backup, then atomically replace:\n\n${targetPath}`,
    buttons: ["Cancel", "Back up and apply"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (confirmation.response !== 1) return { ok: true, canceled: true };
  if (await isMsfsRunning()) {
    return { ok: false, error: "MSFS started while FlightTune was waiting. Close it completely and try again." };
  }

  const { backupPath } = await atomicReplaceWithBackup(targetPath, profile.content);
  return { ok: true, canceled: false, profile, appliedPath: targetPath, backupPath };
}

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}

async function writeSettings(settings) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

async function getApiCredential() {
  if (process.env.OPENAI_API_KEY) {
    return { key: process.env.OPENAI_API_KEY, source: "environment" };
  }
  if (!safeStorage.isEncryptionAvailable()) return { key: "", source: null };
  const settings = await readSettings();
  if (!settings.encryptedApiKey) return { key: "", source: null };
  try {
    const key = safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, "base64"));
    return { key, source: "windows-secure-storage" };
  } catch {
    return { key: "", source: null };
  }
}

async function saveApiKey(key) {
  const trimmed = String(key || "").trim();
  if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(trimmed)) {
    return { ok: false, error: "Enter a valid OpenAI API key beginning with sk-." };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: "Windows secure storage is not available on this PC." };
  }
  const settings = await readSettings();
  settings.encryptedApiKey = safeStorage.encryptString(trimmed).toString("base64");
  await writeSettings(settings);
  return { ok: true, configured: true, source: "windows-secure-storage" };
}

async function clearApiKey() {
  const settings = await readSettings();
  delete settings.encryptedApiKey;
  await writeSettings(settings);
  const environmentConfigured = Boolean(process.env.OPENAI_API_KEY);
  return {
    ok: true,
    configured: environmentConfigured,
    source: environmentConfigured ? "environment" : null,
  };
}

async function testApiKey(candidate) {
  const credential = candidate
    ? { key: String(candidate).trim(), source: "pending" }
    : await getApiCredential();
  if (!credential.key) return { ok: false, message: "No OpenAI API key is configured." };
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${credential.key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) return { ok: true, message: "OpenAI API connection verified." };
    if (response.status === 401) return { ok: false, message: "The API key was rejected. Check or replace it." };
    return { ok: false, message: `OpenAI returned status ${response.status}.` };
  } catch {
    return { ok: false, message: "Could not reach the OpenAI API. Check your connection." };
  }
}

function validateAiChanges(config, changes) {
  const lines = config.split(/\r?\n/);
  const seen = new Set();
  const dlssModes = ["Auto", "DLAA", "Quality", "Balanced", "Performance", "Ultra Performance"];
  return (Array.isArray(changes) ? changes : []).filter((change) => {
    if (!Number.isInteger(change.line) || change.line < 0 || change.line >= lines.length || seen.has(change.line)) return false;
    const line = lines[change.line];
    const numericChange = /^-?\d+(?:\.\d+)?$/.test(change.from) && /^-?\d+(?:\.\d+)?$/.test(change.to);
    const antiAliasingChange = /^\s*AntiAliasing\s+/i.test(line)
      && /^(TAA|DLSS)$/i.test(change.from)
      && /^(TAA|DLSS)$/i.test(change.to);
    const dlssModeChange = /^\s*DLSSMode\s+/i.test(line)
      && dlssModes.includes(change.from)
      && dlssModes.includes(change.to);
    if (!numericChange && !antiAliasingChange && !dlssModeChange) return false;
    if (!line.trimEnd().endsWith(change.from)) return false;
    if (/InstalledPackagesPath|Adapter|Version/i.test(line)) return false;
    seen.add(change.line);
    return true;
  }).slice(0, 12);
}

async function reviewWithOpenAI(payload) {
  const { key: apiKey } = await getApiCredential();
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const numberedConfig = payload.config.split(/\r?\n/).map((line, index) => `${index}: ${line}`).join("\n");
  const identifier = crypto.createHash("sha256").update(`${payload.cpu}|${payload.gpu}`).digest("hex").slice(0, 24);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-sol",
      reasoning: { effort: "low" },
      safety_identifier: `flighttune_${identifier}`,
      instructions: [
        "You are a conservative Microsoft Flight Simulator 2024 configuration reviewer.",
        "Propose a small set of performance changes based on detected Windows hardware.",
        "Only change the final numeric value on an existing numbered line.",
        "Exceptions: an existing AntiAliasing line may switch only between TAA and DLSS, and an existing DLSSMode line may use only Auto, DLAA, Quality, Balanced, Performance, or Ultra Performance.",
        "Never invent keys, add or delete lines, or alter syntax, paths, adapter names, versions, or non-numeric values.",
        "Use the requested anti-aliasing mode and DLSS preset. For VR IFR and glass-cockpit aircraft, prefer TAA for text clarity.",
        "For VR VFR, prioritize scenery and terrain detail. For VR IFR, preserve CPU and GPU headroom for avionics and glass displays.",
        "Prefer stable VR frame times over extreme settings. If uncertain, omit the change.",
      ].join(" "),
      input: `CPU ${payload.cpu}; GPU ${payload.gpu}; VRAM ${payload.vram} GB; headset ${payload.display}; flight profile VR ${payload.flightMode}; anti-aliasing ${payload.antiAliasing}; DLSS preset ${payload.dlssMode}.\n\n${numberedConfig}`,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "msfs_config_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              changes: {
                type: "array",
                maxItems: 12,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    line: { type: "integer" },
                    setting: { type: "string" },
                    from: { type: "string" },
                    to: { type: "string" },
                    reason: { type: "string" },
                    impact: { type: "string", enum: ["CPU", "GPU", "VRAM", "VR"] },
                  },
                  required: ["line", "setting", "from", "to", "reason", "impact"],
                },
              },
            },
            required: ["summary", "changes"],
          },
        },
      },
    }),
  });
  if (!response.ok) return { ok: false, reason: "api_error" };
  const data = await response.json();
  const outputText = data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!outputText) return { ok: false, reason: "empty_response" };
  const parsed = JSON.parse(outputText);
  return { ok: true, summary: parsed.summary, changes: validateAiChanges(payload.config, parsed.changes) };
}

function createWindow() {
  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workAreaSize;
  const desktopMargin = workHeight <= 900 ? 24 : 10;
  const width = Math.min(1080, workWidth - desktopMargin * 2);
  const height = Math.min(1440, workHeight - desktopMargin * 2);
  const zoomFactor = workHeight <= 800 ? 0.78 : workHeight <= 1080 ? 0.82 : 0.86;
  const window = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(760, width),
    minHeight: Math.min(560, height),
    center: true,
    backgroundColor: "#f4f1e9",
    show: false,
    title: "FlightTune",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("did-finish-load", () => window.webContents.setZoomFactor(zoomFactor));
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("hardware:detect", async () => {
  try {
    return { ok: true, hardware: await detectHardware() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Hardware detection failed." };
  }
});

ipcMain.handle("config:pick", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose MSFS 2024 UserCfg.opt",
    properties: ["openFile"],
    filters: [
      { name: "MSFS configuration", extensions: ["opt", "cfg"] },
      { name: "Text files", extensions: ["txt"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const { text } = decodeConfigBuffer(await fs.readFile(filePath));
  return { canceled: false, name: path.basename(filePath), path: filePath, content: text };
});

ipcMain.handle("config:save", async (_event, payload) => {
  const result = await dialog.showSaveDialog({
    title: "Save optimized UserCfg.opt",
    defaultPath: payload.defaultName || "UserCfg.opt",
    filters: [{ name: "MSFS configuration", extensions: ["opt"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, payload.content, "utf8");
  return { canceled: false, path: result.filePath };
});

ipcMain.handle("profiles:list", async () => {
  try {
    return { ok: true, profiles: await listManualProfiles() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not read saved profiles." };
  }
});

ipcMain.handle("profiles:save", async (_event, payload) => {
  try {
    return await saveManualProfile(payload);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save this profile." };
  }
});

ipcMain.handle("profiles:load", async (_event, id) => {
  try {
    return await applyManualProfile(id);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not apply this profile." };
  }
});

ipcMain.handle("profiles:delete", async (_event, id) => {
  try {
    const profile = await readManualProfile(id);
    const confirmation = await dialog.showMessageBox({
      type: "warning",
      title: "Delete manual profile",
      message: `Delete \"${profile.name}\"?`,
      detail: "This removes FlightTune's saved snapshot. It does not change the live MSFS UserCfg.opt file.",
      buttons: ["Cancel", "Delete profile"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { ok: true, deleted: false };
    await fs.unlink(profileFilePath(id));
    return { ok: true, deleted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not delete this profile." };
  }
});

ipcMain.handle("optimizer:review", async (_event, payload) => {
  try {
    return await reviewWithOpenAI(payload);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
});

ipcMain.handle("settings:api-status", async () => {
  const credential = await getApiCredential();
  return { configured: Boolean(credential.key), source: credential.source };
});

ipcMain.handle("settings:save-api-key", async (_event, key) => saveApiKey(key));
ipcMain.handle("settings:clear-api-key", async () => clearApiKey());
ipcMain.handle("settings:test-api-key", async (_event, key) => testApiKey(key));
ipcMain.handle("app:version", () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
