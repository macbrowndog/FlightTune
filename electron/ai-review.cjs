const MAX_CONFIG_BYTES = 2 * 1024 * 1024;
const MAX_CHANGES = 12;
const DLSS_MODES = ["Auto", "DLAA", "Quality", "Balanced", "Performance", "Ultra Performance"];

const NUMERIC_SETTINGS = {
  SecondaryScaling: {
    setting: "Video · SecondaryScaling",
    min: 0.6,
    max: 1.1,
    impact: "VR",
  },
};

const SECTION_NUMERIC_SETTINGS = {
  terrain: {
    setting: "Terrain · LoDFactor",
    min: 0.5,
    max: 3,
    impact: "CPU",
  },
  objectslod: {
    setting: "ObjectsLoD · LoDFactor",
    min: 0.5,
    max: 3,
    impact: "CPU",
  },
};

const ENUM_SETTINGS = {
  AntiAliasing: {
    setting: "Video · AntiAliasing",
    values: ["TAA", "DLSS"],
    impact: "VR",
  },
  DLSSMode: {
    setting: "Video · DLSSMode",
    values: DLSS_MODES,
    impact: "GPU",
  },
};

function cleanSingleLine(value, maxLength = 160) {
  const printable = Array.from(String(value ?? ""), (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function redactSensitiveText(value) {
  return cleanSingleLine(value)
    .replace(/\b[A-Za-z]:\\Users\\[^\s;"']+/gi, "[redacted-user]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\b(?:file|https?):\/\/\S+/gi, "[redacted-url]");
}

function closeSections(line, sections) {
  const closingCount = (line.match(/}/g) || []).length;
  for (let index = 0; index < closingCount; index += 1) sections.pop();
}

function inspectReviewableConfig(config) {
  const source = String(config ?? "");
  if (Buffer.byteLength(source, "utf8") > MAX_CONFIG_BYTES) {
    throw new Error("UserCfg.opt is larger than FlightTune's 2 MB AI review limit.");
  }

  const lines = source.split(/\r\n|\r|\n/);
  const sections = [];
  const settings = [];

  lines.forEach((line, lineNumber) => {
    const opening = line.match(/^\s*\{([^\s}]+)/);
    if (opening) sections.push(opening[1].toLowerCase());

    const match = line.match(/^\s*(SecondaryScaling|LoDFactor|AntiAliasing|DLSSMode)\s+(\S+)\s*$/);
    if (match) {
      const [, key, current] = match;
      let rule = NUMERIC_SETTINGS[key] || ENUM_SETTINGS[key];
      if (key === "LoDFactor") {
        const section = [...sections].reverse().find((name) => SECTION_NUMERIC_SETTINGS[name]);
        rule = section ? SECTION_NUMERIC_SETTINGS[section] : null;
      }
      if (rule) settings.push({ line: lineNumber, key, current, ...rule });
    }

    closeSections(line, sections);
  });

  return { lines, settings };
}

function reviewableConfigForPrompt(config) {
  const { settings } = inspectReviewableConfig(config);
  return settings.map((item) => {
    const allowed = item.values
      ? item.values.join(" | ")
      : `${item.min} to ${item.max}`;
    return `line ${item.line} | ${item.setting} | current ${item.current} | allowed ${allowed} | impact ${item.impact}`;
  }).join("\n");
}

function normalizeCandidate(item, value) {
  const candidate = cleanSingleLine(value, 48);
  if (item.values) {
    return item.values.find((allowed) => allowed.toLowerCase() === candidate.toLowerCase()) || null;
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(candidate)) return null;
  const number = Number(candidate);
  if (!Number.isFinite(number) || number < item.min || number > item.max) return null;
  return candidate;
}

function validateAiChanges(config, changes) {
  const { settings } = inspectReviewableConfig(config);
  const byLine = new Map(settings.map((item) => [item.line, item]));
  const seen = new Set();
  const accepted = [];

  for (const change of Array.isArray(changes) ? changes : []) {
    if (!Number.isInteger(change?.line) || seen.has(change.line)) continue;
    const item = byLine.get(change.line);
    if (!item || cleanSingleLine(change.setting) !== item.setting) continue;
    if (String(change.from) !== item.current) continue;
    const next = normalizeCandidate(item, change.to);
    if (!next || next === item.current || change.impact !== item.impact) continue;

    seen.add(change.line);
    accepted.push({
      line: change.line,
      setting: item.setting,
      from: item.current,
      to: next,
      reason: cleanSingleLine(change.reason, 240) || "Conservative adjustment within FlightTune's supported range.",
      impact: item.impact,
    });
    if (accepted.length >= MAX_CHANGES) break;
  }

  return accepted;
}

function buildAiReviewInput(payload) {
  const reviewableConfig = reviewableConfigForPrompt(payload?.config);
  if (!reviewableConfig) throw new Error("No supported settings were found for AI review.");
  const hardware = [
    `CPU: ${redactSensitiveText(payload?.cpu) || "Unknown"}`,
    `GPU: ${redactSensitiveText(payload?.gpu) || "Unknown"}`,
    `VRAM GB: ${Math.max(0, Math.min(128, Number(payload?.vram) || 0))}`,
    `Headset: ${redactSensitiveText(payload?.display) || "Unknown"}`,
    `Flight profile: ${payload?.flightMode === "ifr" ? "VR IFR" : "VR VFR"}`,
    `Requested anti-aliasing: ${payload?.antiAliasing === "TAA" ? "TAA" : "DLSS"}`,
    `Requested DLSS preset: ${DLSS_MODES.includes(payload?.dlssMode) ? payload.dlssMode : "Quality"}`,
  ].join("\n");
  return `${hardware}\n\nRecognized settings only:\n${reviewableConfig}`;
}

function apiFailure(status) {
  if (status === 401) return { reason: "invalid_key", error: "The OpenAI API key was rejected. Update it in API settings." };
  if (status === 403 || status === 404) return { reason: "model_access", error: "This OpenAI project does not have access to GPT-5.6 Luna." };
  if (status === 429) return { reason: "rate_limit", error: "OpenAI rate or usage limits were reached. Check billing and try again." };
  if (status >= 500) return { reason: "service_error", error: "OpenAI is temporarily unavailable. The local profile was used instead." };
  return { reason: "api_error", error: `OpenAI returned status ${status}. The local profile was used instead.` };
}

module.exports = {
  DLSS_MODES,
  MAX_CONFIG_BYTES,
  apiFailure,
  buildAiReviewInput,
  inspectReviewableConfig,
  redactSensitiveText,
  reviewableConfigForPrompt,
  validateAiChanges,
};
