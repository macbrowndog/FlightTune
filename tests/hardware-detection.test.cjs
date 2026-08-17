const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");
const { test } = require("node:test");

const execFileAsync = promisify(execFile);

test("Windows hardware detection returns the documented schema", { skip: process.platform !== "win32" }, async () => {
  const script = path.join(__dirname, "..", "electron", "detect-hardware.ps1");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
    { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const hardware = JSON.parse(stdout.trim());

  assert.equal(typeof hardware.cpu, "string");
  assert.ok(hardware.cpu.length > 0);
  assert.equal(typeof hardware.gpu, "string");
  assert.ok(hardware.gpu.length > 0);
  assert.equal(typeof hardware.vramGb, "number");
  assert.ok(hardware.vramGb >= 0);
  assert.equal(typeof hardware.display, "string");
  assert.equal(typeof hardware.headsetDetected, "boolean");
  assert.equal(typeof hardware.openXrRuntime, "string");
  assert.ok(!Number.isNaN(Date.parse(hardware.detectedAt)));
});
