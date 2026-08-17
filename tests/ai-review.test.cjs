const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  apiFailure,
  buildAiReviewInput,
  redactSensitiveText,
  validateAiChanges,
} = require("../electron/ai-review.cjs");

const CONFIG = `Version 1.1
{Video
  Adapter "NVIDIA GeForce RTX 4090"
  SecondaryScaling 1.000000
  AntiAliasing TAA
  DLSSMode Quality
}
InstalledPackagesPath "C:\\Users\\Andrew\\AppData\\Packages"
{Graphics
  {Terrain
    LoDFactor 2.000000
  }
  {ObjectsLoD
    LoDFactor 1.500000
  }
}`;

test("AI input contains only minimized recognized settings", () => {
  const input = buildAiReviewInput({
    config: CONFIG,
    cpu: "Intel Core i9-13900K",
    gpu: "NVIDIA RTX 4090",
    vram: 24,
    display: "Pimax Crystal",
    flightMode: "vfr",
    antiAliasing: "DLSS",
    dlssMode: "Quality",
  });

  assert.match(input, /line 3 \| Video · SecondaryScaling/);
  assert.match(input, /line 10 \| Terrain · LoDFactor/);
  assert.match(input, /line 13 \| ObjectsLoD · LoDFactor/);
  assert.doesNotMatch(input, /InstalledPackagesPath|AppData|Adapter|Version 1\.1|Andrew/);
});

test("privacy redaction removes user paths, URLs, keys, and control characters", () => {
  const fakeKey = `sk-${"exampleSecret123456"}`;
  const redacted = redactSensitiveText(`C:\\Users\\Andrew\\secret https://example.com ${fakeKey}\nnext`);
  assert.equal(redacted, "[redacted-user] [redacted-url] [redacted-key] next");
});

test("AI validation accepts only matching allowlisted values within range", () => {
  const accepted = validateAiChanges(CONFIG, [
    { line: 3, setting: "Video · SecondaryScaling", from: "1.000000", to: "1.1", reason: "Safe scaling", impact: "VR" },
    { line: 10, setting: "Terrain · LoDFactor", from: "2.000000", to: "2.5", reason: "Safe terrain", impact: "CPU" },
    { line: 13, setting: "ObjectsLoD · LoDFactor", from: "1.500000", to: "4", reason: "Out of range", impact: "CPU" },
    { line: 3, setting: "Video · SecondaryScaling", from: "1.000000", to: "0.9", reason: "Duplicate line", impact: "VR" },
    { line: 2, setting: "Video · SecondaryScaling", from: "RTX 4090", to: "1", reason: "Adapter injection", impact: "VR" },
    { line: 4, setting: "Video · DLSSMode", from: "TAA", to: "DLSS", reason: "Wrong declared setting", impact: "VR" },
  ]);

  assert.deepEqual(accepted.map(({ line, to }) => ({ line, to })), [
    { line: 3, to: "1.1" },
    { line: 10, to: "2.5" },
  ]);
});

test("API failures provide actionable messages", () => {
  assert.equal(apiFailure(401).reason, "invalid_key");
  assert.equal(apiFailure(403).reason, "model_access");
  assert.equal(apiFailure(429).reason, "rate_limit");
  assert.equal(apiFailure(503).reason, "service_error");
});
