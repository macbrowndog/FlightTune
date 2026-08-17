const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const {
  atomicReplaceWithBackup,
  decodeConfigBuffer,
  encodeConfigText,
} = require("../electron/config-file.cjs");

const temporaryDirectories = [];

async function makeTemporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "flighttune-config-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const directory = temporaryDirectories.pop();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

test("preserves UTF-8 BOM, CRLF line endings, and the final newline", () => {
  const original = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("Version 1\r\nSecondaryScalingVR 80\r\n", "utf8"),
  ]);
  const { format, text } = decodeConfigBuffer(original);

  assert.equal(text, "Version 1\r\nSecondaryScalingVR 80\r\n");
  const replacement = encodeConfigText("Version 1\nSecondaryScalingVR 90", format);
  assert.deepEqual(
    replacement,
    Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("Version 1\r\nSecondaryScalingVR 90\r\n", "utf8"),
    ]),
  );
});

test("preserves UTF-16 LE configuration encoding", () => {
  const original = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("Version 1\r\n", "utf16le"),
  ]);
  const { format, text } = decodeConfigBuffer(original);

  assert.equal(text, "Version 1\r\n");
  assert.deepEqual(encodeConfigText("Version 2", format), Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("Version 2\r\n", "utf16le"),
  ]));
});

test("atomically replaces the target and keeps a byte-identical backup", async () => {
  const directory = await makeTemporaryDirectory();
  const targetPath = path.join(directory, "UserCfg.opt");
  const original = Buffer.from("Version 1\r\nSecondaryScalingVR 80\r\n", "utf8");
  await fs.writeFile(targetPath, original);

  const result = await atomicReplaceWithBackup(targetPath, "Version 1\nSecondaryScalingVR 90", {
    now: new Date("2026-08-17T06:00:00.000Z"),
  });

  assert.deepEqual(await fs.readFile(result.backupPath), original);
  assert.equal(await fs.readFile(targetPath, "utf8"), "Version 1\r\nSecondaryScalingVR 90\r\n");
  assert.deepEqual(
    (await fs.readdir(directory)).filter((name) => name.endsWith(".tmp") || name.endsWith(".rollback")),
    [],
  );
});

test("leaves the target unchanged when replacement fails before rename", async () => {
  const directory = await makeTemporaryDirectory();
  const targetPath = path.join(directory, "UserCfg.opt");
  const original = Buffer.from("Version 1\r\n", "utf8");
  await fs.writeFile(targetPath, original);

  await assert.rejects(
    atomicReplaceWithBackup(targetPath, "Version 2", {
      beforeReplace: async () => { throw new Error("simulated pre-rename failure"); },
    }),
    /simulated pre-rename failure/,
  );

  assert.deepEqual(await fs.readFile(targetPath), original);
});

test("does not overwrite a configuration changed by another process", async () => {
  const directory = await makeTemporaryDirectory();
  const targetPath = path.join(directory, "UserCfg.opt");
  const original = Buffer.from("Version 1\r\n", "utf8");
  const externalChange = Buffer.from("Version changed externally\r\n", "utf8");
  await fs.writeFile(targetPath, original);

  await assert.rejects(
    atomicReplaceWithBackup(targetPath, "Version 2", {
      beforeReplace: async () => { await fs.writeFile(targetPath, externalChange); },
    }),
    /changed while FlightTune was preparing/,
  );

  assert.deepEqual(await fs.readFile(targetPath), externalChange);
});

test("restores the original bytes when verification fails after rename", async () => {
  const directory = await makeTemporaryDirectory();
  const targetPath = path.join(directory, "UserCfg.opt");
  const original = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("Version 1\r\n", "utf8"),
  ]);
  await fs.writeFile(targetPath, original);

  await assert.rejects(
    atomicReplaceWithBackup(targetPath, "Version 2", {
      afterReplace: async () => { throw new Error("simulated post-rename failure"); },
    }),
    /simulated post-rename failure/,
  );

  assert.deepEqual(await fs.readFile(targetPath), original);
  assert.deepEqual(
    (await fs.readdir(directory)).filter((name) => name.endsWith(".tmp") || name.endsWith(".rollback")),
    [],
  );
});
