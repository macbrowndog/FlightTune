const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);

function decodeUtf16Be(buffer) {
  const body = Buffer.from(buffer);
  if (body.length % 2 !== 0) throw new Error("The configuration has an invalid UTF-16 encoding.");
  body.swap16();
  return body.toString("utf16le");
}

function encodeUtf16Be(text) {
  const body = Buffer.from(text, "utf16le");
  body.swap16();
  return body;
}

function detectLineEnding(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  const cr = (text.match(/\r(?!\n)/g) || []).length;
  if (crlf >= lf && crlf >= cr && crlf > 0) return "\r\n";
  if (lf >= cr && lf > 0) return "\n";
  if (cr > 0) return "\r";
  return "\r\n";
}

function decodeConfigBuffer(buffer) {
  const input = Buffer.from(buffer);
  let encoding = "utf8";
  let bom = false;
  let text;

  if (input.subarray(0, 3).equals(UTF8_BOM)) {
    bom = true;
    text = input.subarray(3).toString("utf8");
  } else if (input.subarray(0, 2).equals(UTF16_LE_BOM)) {
    encoding = "utf16le";
    bom = true;
    text = input.subarray(2).toString("utf16le");
  } else if (input.subarray(0, 2).equals(UTF16_BE_BOM)) {
    encoding = "utf16be";
    bom = true;
    text = decodeUtf16Be(input.subarray(2));
  } else {
    text = input.toString("utf8");
    if (text.includes("\u0000")) {
      throw new Error("This UserCfg.opt encoding is not supported. Save it as UTF-8 and try again.");
    }
  }

  return {
    text,
    format: {
      encoding,
      bom,
      lineEnding: detectLineEnding(text),
      finalNewline: /(?:\r\n|\r|\n)$/.test(text),
    },
  };
}

function encodeConfigText(text, format) {
  const lineEnding = format.lineEnding || "\r\n";
  let normalized = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n|\r|\n/g, "\n");
  normalized = normalized.replace(/\n+$/, "").replace(/\n/g, lineEnding);
  if (format.finalNewline) normalized += lineEnding;

  if (format.encoding === "utf16le") {
    const body = Buffer.from(normalized, "utf16le");
    return format.bom ? Buffer.concat([UTF16_LE_BOM, body]) : body;
  }
  if (format.encoding === "utf16be") {
    const body = encodeUtf16Be(normalized);
    return format.bom ? Buffer.concat([UTF16_BE_BOM, body]) : body;
  }
  const body = Buffer.from(normalized, "utf8");
  return format.bom ? Buffer.concat([UTF8_BOM, body]) : body;
}

async function writeNewFileDurably(filePath, content, mode = 0o600) {
  const handle = await fs.open(filePath, "wx", mode);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directoryPath) {
  let handle;
  try {
    handle = await fs.open(directoryPath, "r");
    await handle.sync();
  } catch {
    // Windows does not consistently allow directory handles to be flushed.
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

async function atomicReplaceWithBackup(targetPath, replacementText, options = {}) {
  const originalStat = await fs.stat(targetPath);
  const original = await fs.readFile(targetPath);
  const { format } = decodeConfigBuffer(original);
  const replacement = encodeConfigText(replacementText, format);
  if (replacement.length > 2 * 1024 * 1024) {
    throw new Error("The replacement configuration is larger than FlightTune's 2 MB safety limit.");
  }

  const directory = path.dirname(targetPath);
  const suffix = `${process.pid}-${crypto.randomUUID()}`;
  const backupPath = `${targetPath}.flighttune-backup-${timestampForFile(options.now)}`;
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.flighttune-${suffix}.tmp`);
  const rollbackPath = path.join(directory, `.${path.basename(targetPath)}.flighttune-${suffix}.rollback`);
  let replacementCommitted = false;

  await writeNewFileDurably(backupPath, original, originalStat.mode);
  const backup = await fs.readFile(backupPath);
  if (!backup.equals(original)) throw new Error(`FlightTune could not verify the backup at ${backupPath}.`);

  try {
    await writeNewFileDurably(temporaryPath, replacement, originalStat.mode);
    const staged = await fs.readFile(temporaryPath);
    if (!staged.equals(replacement)) throw new Error("FlightTune could not verify the temporary configuration file.");

    await options.beforeReplace?.();
    const current = await fs.readFile(targetPath);
    if (!current.equals(original)) {
      throw new Error("UserCfg.opt changed while FlightTune was preparing the update. Nothing was overwritten; try again after closing MSFS.");
    }
    await fs.rename(temporaryPath, targetPath);
    replacementCommitted = true;
    await syncDirectory(directory);
    await options.afterReplace?.();

    const applied = await fs.readFile(targetPath);
    if (!applied.equals(replacement)) throw new Error("The applied configuration did not pass verification.");
    return { backupPath, format };
  } catch (error) {
    if (replacementCommitted) {
      try {
        await writeNewFileDurably(rollbackPath, original, originalStat.mode);
        await fs.rename(rollbackPath, targetPath);
        await syncDirectory(directory);
        const restored = await fs.readFile(targetPath);
        if (!restored.equals(original)) throw new Error("Rollback verification failed.");
      } catch (rollbackError) {
        throw new Error(
          `FlightTune could not restore UserCfg.opt automatically. Restore the verified backup manually from ${backupPath}. ${rollbackError instanceof Error ? rollbackError.message : "Rollback failed."}`,
          { cause: error },
        );
      }
    }
    throw error;
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
    await fs.unlink(rollbackPath).catch(() => {});
  }
}

module.exports = {
  atomicReplaceWithBackup,
  decodeConfigBuffer,
  detectLineEnding,
  encodeConfigText,
};
