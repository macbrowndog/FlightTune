import { useEffect, useMemo, useState } from "react";

type FlightMode = "vfr" | "ifr";
type AntiAliasing = "TAA" | "DLSS";
type DlssMode = "Auto" | "DLAA" | "Quality" | "Balanced" | "Performance" | "Ultra Performance";
type Change = {
  line: number;
  setting: string;
  from: string;
  to: string;
  reason: string;
  impact: "CPU" | "GPU" | "VRAM" | "VR";
};

const SAMPLE_CONFIG = `Version 1.1
{Video
    Adapter "NVIDIA GeForce RTX 4070"
    PrimaryScaling 1.000000
    SecondaryScaling 1.000000
    AntiAliasing TAA
    DLSSMode Quality
}
{Graphics
    Preset Custom
    {Terrain
        LoDFactor 2.000000
    }
    {ObjectsLoD
        LoDFactor 2.000000
    }
}
InstalledPackagesPath "D:\\MSFS 2024\\Packages"`;

const knownDisplays = [
  "Meta Quest 2",
  "Meta Quest 3 / 3S",
  "Meta Quest Pro",
  "Pimax headset",
  "HP Reverb / Windows Mixed Reality",
  "Bigscreen Beyond",
  "Pico headset",
  "Varjo headset",
  "HTC Vive headset",
  "SteamVR / OpenXR headset",
  "Other OpenXR headset",
];

function scoreCpu(cpu: string) {
  const value = cpu.toLowerCase();
  if (/x3d|ultra 9|i9|ryzen 9|9950|9900|9800|7950|7800|14900|13900/.test(value)) return 3;
  if (/i7|ryzen 7|9700|7700|14700|13700|12700/.test(value)) return 2;
  return 1;
}

function fixedLike(value: string, next: number) {
  return value.includes(".") ? next.toFixed(6) : String(Math.round(next));
}

function createPlan(
  config: string,
  cpu: string,
  vram: number,
  display: string,
  flightMode: FlightMode,
  antiAliasing: AntiAliasing,
  dlssMode: DlssMode,
) {
  const cpuTier = scoreCpu(cpu);
  const scaleBase = vram >= 20 ? 0.98 : vram >= 12 ? 0.9 : vram >= 8 ? 0.8 : 0.7;
  const terrain = (flightMode === "vfr" ? [1.25, 1.65, 2.05] : [1.05, 1.3, 1.55])[cpuTier - 1];
  const objects = Math.max(0.8, terrain - (flightMode === "vfr" ? 0.15 : 0.3));
  const lines = config.split(/\r?\n/);
  const changes: Change[] = [];
  let section = "";

  lines.forEach((line, index) => {
    const opening = line.match(/^\s*\{([^\s}]+)/);
    if (opening) section = opening[1];
    const valueMatch = line.match(/^(\s*)(PrimaryScaling|SecondaryScaling|LoDFactor|AntiAliasing|DLSSMode)\s+(.+?)(\s*)$/);
    if (!valueMatch) return;

    const key = valueMatch[2];
    const current = valueMatch[3];
    let next: number | null = null;
    let reason = "";
    let impact: Change["impact"] = "GPU";

    if (key === "SecondaryScaling") {
      next = Math.max(0.6, Math.min(1.1, scaleBase + (antiAliasing === "DLSS" ? 0.03 : 0)));
      reason = flightMode === "ifr"
        ? "Keeps cockpit instruments readable while protecting VR frame-time."
        : "Balances per-eye scenery clarity against detected VRAM.";
      impact = "VR";
    } else if (key === "LoDFactor" && /terrain/i.test(section)) {
      next = terrain;
      reason = "Terrain detail is matched to the detected CPU and performance target.";
      impact = "CPU";
    } else if (key === "LoDFactor" && /objects/i.test(section)) {
      next = objects;
      reason = flightMode === "ifr"
        ? "Reduces distant object load so glass-cockpit avionics retain CPU headroom."
        : "Keeps nearby VFR landmarks detailed without matching the full terrain load.";
      impact = "CPU";
    } else if (key === "AntiAliasing") {
      const replacement = antiAliasing;
      if (replacement !== current.toUpperCase()) {
        changes.push({
          line: index,
          setting: "Video · AntiAliasing",
          from: current,
          to: replacement,
          reason: antiAliasing === "TAA"
            ? "TAA is preferred for crisp glass-cockpit and avionics text."
            : "DLSS can recover GPU headroom for scenery-heavy VR VFR flying.",
          impact: "VR",
        });
      }
      return;
    } else if (key === "DLSSMode") {
      if (antiAliasing === "DLSS" && dlssMode !== current) {
        changes.push({
          line: index,
          setting: "Video · DLSSMode",
          from: current,
          to: dlssMode,
          reason: `${dlssMode} matches the selected MSFS DLSS Super Resolution preset.`,
          impact: "GPU",
        });
      }
      return;
    }

    if (next === null) return;
    const replacement = fixedLike(current, next);
    if (replacement !== current) {
      changes.push({ line: index, setting: `${section || "Video"} · ${key}`, from: current, to: replacement, reason, impact });
    }
  });

  return {
    changes,
    summary: `${flightMode === "vfr" ? "VR VFR scenery" : "VR IFR glass-cockpit"} profile for ${display}, using ${antiAliasing}${antiAliasing === "DLSS" ? ` ${dlssMode}` : ""}`,
  };
}

function applyChanges(config: string, changes: Change[]) {
  const lines = config.split(/\r?\n/);
  for (const change of changes) {
    const line = lines[change.line];
    if (!line) continue;
    const escaped = change.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const replaced = line.replace(
      new RegExp(`(\\s)${escaped}(\\s*)$`),
      (_match, space: string, trailing: string) => `${space}${change.to}${trailing}`,
    );
    if (replaced !== line) lines[change.line] = replaced;
  }
  return lines.join("\n");
}

export default function App() {
  const [cpu, setCpu] = useState("Detecting processor…");
  const [gpu, setGpu] = useState("Detecting graphics adapter…");
  const [vram, setVram] = useState(8);
  const [display, setDisplay] = useState("Detecting VR headset…");
  const [hardware, setHardware] = useState<Hardware | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [detectionError, setDetectionError] = useState("");
  const [flightMode, setFlightMode] = useState<FlightMode>("vfr");
  const [antiAliasing, setAntiAliasing] = useState<AntiAliasing>("DLSS");
  const [dlssMode, setDlssMode] = useState<DlssMode>("Quality");
  const [config, setConfig] = useState(SAMPLE_CONFIG);
  const [fileName, setFileName] = useState("UserCfg.opt");
  const [filePath, setFilePath] = useState("");
  const [changes, setChanges] = useState<Change[]>([]);
  const [optimized, setOptimized] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "done">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [engine, setEngine] = useState<"Local" | "AI">("Local");
  const [apiOpen, setApiOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiConfigured, setApiConfigured] = useState(false);
  const [apiSource, setApiSource] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState("");
  const [apiBusy, setApiBusy] = useState(false);
  const [appVersion, setAppVersion] = useState("1.1.1");
  const [manualProfiles, setManualProfiles] = useState<ManualProfileSummary[]>([]);
  const [profileName, setProfileName] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);

  const refreshManualProfiles = async (preferredId = "") => {
    if (!window.flightTune) return;
    const result = await window.flightTune.listManualProfiles();
    if (!result.ok) {
      setProfileMessage(result.error);
      return;
    }
    setManualProfiles(result.profiles);
    setSelectedProfileId((current) => {
      const next = preferredId || current;
      return result.profiles.some((profile) => profile.id === next) ? next : (result.profiles[0]?.id || "");
    });
  };

  const detect = async () => {
    setDetecting(true);
    setDetectionError("");
    if (!window.flightTune) {
      setDetectionError("Native Windows detection is available in the installed app.");
      setDetecting(false);
      return;
    }
    const result = await window.flightTune.detectHardware();
    if (result.ok) {
      setHardware(result.hardware);
      setCpu(result.hardware.cpu);
      setGpu(result.hardware.gpu);
      if (result.hardware.vramGb > 0) setVram(Math.max(4, Math.min(32, Math.round(result.hardware.vramGb))));
      setDisplay(result.hardware.display);
    } else {
      setDetectionError(result.error);
    }
    setDetecting(false);
  };

  useEffect(() => {
    void detect();
    if (window.flightTune) {
      void window.flightTune.getAppVersion().then(setAppVersion);
      void window.flightTune.getApiStatus().then((result) => {
        setApiConfigured(result.configured);
        setApiSource(result.source);
      });
      void refreshManualProfiles();
    }
  }, []);

  const profile = useMemo(() => {
    const tier = vram >= 16 ? "Enthusiast" : vram >= 10 ? "High" : vram >= 8 ? "Balanced" : "Lean";
    return { tier, fps: flightMode === "vfr" ? "45–72" : "45–60" };
  }, [vram, flightMode]);

  const displayOptions = useMemo(
    () => Array.from(new Set([display, ...knownDisplays])).filter(Boolean),
    [display],
  );

  const selectedManualProfile = useMemo(
    () => manualProfiles.find((profile) => profile.id === selectedProfileId),
    [manualProfiles, selectedProfileId],
  );

  const pickConfig = async () => {
    if (!window.flightTune) return;
    const picked = await window.flightTune.pickConfig();
    if (picked.canceled) return;
    setConfig(picked.content);
    setFileName(picked.name);
    setFilePath(picked.path);
    setChanges([]);
    setOptimized("");
    setStatus("idle");
    setSaveMessage("");
    setProfileMessage("UserCfg.opt loaded. Enter a profile name to save this manual setup.");
  };

  const saveManualProfile = async () => {
    if (!window.flightTune) return;
    setProfileBusy(true);
    setProfileMessage("");
    const result = await window.flightTune.saveManualProfile({
      name: profileName,
      content: config,
      sourceName: fileName,
      sourcePath: filePath,
      flightMode,
      antiAliasing,
      dlssMode,
    });
    if (!result.ok) {
      setProfileMessage(result.error);
      setProfileBusy(false);
      return;
    }
    setProfileName("");
    setProfileMessage(`Saved \"${result.profile.name}\" to the local profile library.`);
    await refreshManualProfiles(result.profile.id);
    setProfileBusy(false);
  };

  const loadManualProfile = async () => {
    if (!window.flightTune || !selectedProfileId) return;
    setProfileBusy(true);
    setProfileMessage("");
    const result = await window.flightTune.loadManualProfile(selectedProfileId);
    if (!result.ok) {
      setProfileMessage(result.error);
      setProfileBusy(false);
      return;
    }
    if (result.canceled) {
      setProfileMessage("Profile load cancelled. UserCfg.opt was not changed.");
      setProfileBusy(false);
      return;
    }
    const saved = result.profile;
    setConfig(saved.content);
    setFileName(saved.sourceName || "UserCfg.opt");
    setFilePath(result.appliedPath);
    setFlightMode(saved.flightMode);
    setAntiAliasing(saved.antiAliasing);
    setDlssMode(saved.dlssMode);
    setChanges([]);
    setOptimized("");
    setStatus("idle");
    setSaveMessage("");
    setProfileMessage(`Applied \"${saved.name}\" to UserCfg.opt. Backup saved to ${result.backupPath}`);
    setProfileBusy(false);
  };

  const deleteManualProfile = async () => {
    if (!window.flightTune || !selectedProfileId) return;
    setProfileBusy(true);
    setProfileMessage("");
    const result = await window.flightTune.deleteManualProfile(selectedProfileId);
    if (!result.ok) {
      setProfileMessage(result.error);
      setProfileBusy(false);
      return;
    }
    if (result.deleted) {
      setProfileMessage("Profile deleted. The live MSFS UserCfg.opt was not changed.");
      await refreshManualProfiles();
    }
    setProfileBusy(false);
  };

  const optimize = async () => {
    setStatus("working");
    let result = createPlan(config, cpu, vram, display, flightMode, antiAliasing, dlssMode);
    let selectedEngine: "Local" | "AI" = "Local";
    if (window.flightTune) {
      const ai = await window.flightTune.reviewConfig({ config, cpu, gpu, vram, display, flightMode, antiAliasing, dlssMode });
      if (ai.ok) {
        result = { changes: ai.changes, summary: ai.summary };
        selectedEngine = "AI";
      }
    }
    setChanges(result.changes);
    setOptimized(applyChanges(config, result.changes));
    setSummary(result.summary);
    setEngine(selectedEngine);
    setStatus("done");
  };

  const save = async () => {
    if (!window.flightTune) return;
    const result = await window.flightTune.saveConfig({ defaultName: fileName, content: optimized || config });
    if (!result.canceled) setSaveMessage(`Saved to ${result.path}`);
  };

  const saveAndTestApi = async () => {
    if (!window.flightTune || !apiKey.trim()) return;
    setApiBusy(true);
    setApiMessage("");
    const saved = await window.flightTune.saveApiKey(apiKey);
    if (!saved.ok) {
      setApiMessage(saved.error);
      setApiBusy(false);
      return;
    }
    const tested = await window.flightTune.testApiKey();
    setApiConfigured(true);
    setApiSource(saved.source);
    setApiKey("");
    setApiMessage(tested.message);
    setApiBusy(false);
  };

  const clearApi = async () => {
    if (!window.flightTune) return;
    setApiBusy(true);
    const result = await window.flightTune.clearApiKey();
    setApiConfigured(result.configured);
    setApiSource(result.source);
    setApiKey("");
    setApiMessage(result.source === "environment"
      ? "The saved key was cleared. OPENAI_API_KEY is still active."
      : "Saved API key removed.");
    setApiBusy(false);
  };

  return (
    <main>
      <header className="titlebar">
        <a className="brand" href="#top" aria-label="FlightTune home">
          <span className="brand-mark">FT</span>
          <span>FLIGHT<span>TUNE</span></span>
          <small className="app-version">v{appVersion}</small>
        </a>
        <div className="title-actions">
          <button
            className={`api-button ${apiConfigured ? "connected" : ""}`}
            type="button"
            onClick={() => setApiOpen((open) => !open)}
          >
            <i />
            ChatGPT API
          </button>
          <button className="detect-button" type="button" onClick={detect} disabled={detecting}>
            {detecting ? <i className="spinner" /> : <i className="scan-dot" />}
            {detecting ? "Detecting hardware" : "Detect again"}
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">VR CONFIG LAB / MSFS 2024</p>
          <h1>Built for VR.<br /><em>Tuned by flight.</em></h1>
          <p className="lede">Choose a scenery-first VFR profile or a glass-cockpit IFR profile. FlightTune matches it to your detected headset, CPU, GPU and VRAM.</p>
        </div>
        <div className="flight-card" aria-label="Current optimization target">
          <div className="flight-card-top">
            <span>VR FLIGHT PROFILE</span>
            <b>{flightMode.toUpperCase()}</b>
          </div>
          <div className="gauge">
            <span style={{ "--gauge": `${Math.min(92, 46 + vram * 2)}%` } as React.CSSProperties} />
            <div><strong>{profile.fps}</strong><small>target fps</small></div>
          </div>
          <div className="profile-meta">
            <div><small>CLASS</small><strong>{profile.tier}</strong></div>
            <div><small>ANTI-ALIASING</small><strong>{antiAliasing === "DLSS" ? `DLSS ${dlssMode}` : antiAliasing}</strong></div>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="steps" aria-label="Optimization steps">
          <p className="eyebrow">SYSTEM SCAN</p>
          {[
            ["CPU", detecting ? "Scanning processor" : cpu],
            ["GPU", detecting ? "Scanning adapter" : gpu],
            ["VRAM", detecting ? "Reading memory" : `${vram} GB detected`],
            ["HEADSET", detecting ? "Checking OpenXR" : display],
          ].map(([item, detail], i) => (
            <div className={`step ${!detecting ? "active" : ""}`} key={item}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div><strong>{item}</strong><small>{detail}</small></div>
            </div>
          ))}
          <div className="safe-note">
            <span>✓</span>
            <p><strong>Local detection</strong>Hardware inventory stays on this PC. Manual fields remain editable.</p>
          </div>
        </aside>

        <div className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">01 / DETECTED VR HARDWARE</p><h2>Windows found your VR cockpit.</h2></div>
            <span className={`profile-chip ${detectionError || display.startsWith("No VR") ? "warning" : ""}`}>{detectionError || display.startsWith("No VR") ? "Needs headset" : detecting ? "Scanning…" : "VR detected"}</span>
          </div>

          {detectionError && <div className="detection-alert"><strong>Automatic detection needs attention.</strong><span>{detectionError}</span> You can enter the values manually below.</div>}

          <div className="form-grid">
            <label>Processor <span>{hardware ? "AUTO" : "MANUAL"}</span>
              <input value={cpu} onChange={(event) => setCpu(event.target.value)} aria-label="Processor" />
            </label>
            <label>Graphics card <span>{hardware ? "AUTO" : "MANUAL"}</span>
              <input value={gpu} onChange={(event) => setGpu(event.target.value)} aria-label="Graphics card" />
            </label>
            <label>Video memory <span>{hardware?.vramGb ? `${hardware.vramGb} GB RAW` : "MANUAL"}</span>
              <div className="range-row">
                <input type="range" min="4" max="32" value={vram} onChange={(event) => setVram(Number(event.target.value))} aria-label="Video memory" />
                <output>{vram} GB</output>
              </div>
            </label>
            <label>VR headset / OpenXR <span>{hardware?.headsetDetected ? "HEADSET FOUND" : "SELECT VR"}</span>
              <select value={display} onChange={(event) => setDisplay(event.target.value)} aria-label="VR headset">
                {displayOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          </div>

          <div className="hardware-foot">
            <span><i className="scan-dot" /> {hardware?.source || "Windows hardware inventory"}</span>
            {hardware?.openXrRuntime && <span title={hardware.openXrRuntime}>OpenXR runtime found</span>}
          </div>

          {apiOpen && (
            <section className="api-settings" aria-label="ChatGPT API settings">
              <div className="api-settings-head">
                <div>
                  <p className="eyebrow">CHATGPT API</p>
                  <h3>{apiConfigured ? "AI review is connected" : "Add optional AI review"}</h3>
                </div>
                <span className={apiConfigured ? "api-status connected" : "api-status"}>
                  {apiConfigured ? (apiSource === "environment" ? "Environment key" : "Key secured") : "Not connected"}
                </span>
              </div>
              <p>Enter an OpenAI API key to let GPT review the local hardware plan. Optimization still works without it.</p>
              <div className="api-key-row">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={apiConfigured ? "Enter a new key to replace the saved key" : "sk-..."}
                  aria-label="OpenAI API key"
                  autoComplete="off"
                />
                <button type="button" onClick={saveAndTestApi} disabled={apiBusy || !apiKey.trim()}>
                  {apiBusy ? "Checking…" : "Save & test"}
                </button>
                {apiConfigured && apiSource !== "environment" && (
                  <button className="api-clear" type="button" onClick={clearApi} disabled={apiBusy}>Remove</button>
                )}
              </div>
              <small>Saved keys are encrypted by Windows and never written into UserCfg.opt.</small>
              {apiMessage && <p className="api-message">{apiMessage}</p>}
            </section>
          )}

          <fieldset className="flight-profile-fieldset">
            <legend>VR flight profile</legend>
            <div className="goal-picker">
              {([
                ["vfr", "VR VFR flying", "Scenery detail, landmarks and terrain clarity"],
                ["ifr", "VR IFR flying", "Stable glass cockpit and readable avionics"],
              ] as const).map(([value, title, copy]) => (
                <button
                  type="button"
                  className={flightMode === value ? "selected" : ""}
                  onClick={() => { setFlightMode(value); if (value === "ifr") setAntiAliasing("TAA"); }}
                  key={value}
                >
                  <span>{flightMode === value ? "●" : "○"}</span><strong>{title}</strong><small>{copy}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="aa-fieldset">
            <legend>Anti-aliasing</legend>
            <div className="aa-picker">
              {([
                ["TAA", "TAA", "Best cockpit text clarity", "IFR preferred"],
                ["DLSS", "DLSS", "More GPU headroom", "VFR scenery option"],
              ] as const).map(([value, title, copy, badge]) => (
                <button type="button" className={antiAliasing === value ? "selected" : ""} onClick={() => setAntiAliasing(value)} key={value}>
                  <span>{antiAliasing === value ? "●" : "○"}</span>
                  <div><strong>{title}</strong><small>{copy}</small></div>
                  <b>{badge}</b>
                </button>
              ))}
            </div>
            {antiAliasing === "DLSS" && (
              <label className="dlss-mode">
                DLSS Super Resolution preset <span>MSFS OPTION</span>
                <select value={dlssMode} onChange={(event) => setDlssMode(event.target.value as DlssMode)}>
                  {(["Auto", "DLAA", "Quality", "Balanced", "Performance", "Ultra Performance"] as const)
                    .map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
            )}
            {flightMode === "ifr" && antiAliasing === "DLSS" && (
              <p className="aa-note">TAA is recommended for VR IFR flying because glass-cockpit and avionics text is usually clearer.</p>
            )}
          </fieldset>

          <div className="config-block">
            <div className="config-head">
              <div><p className="eyebrow">02 / USERCFG.OPT</p><h3>{fileName}</h3>{filePath && <small>{filePath}</small>}</div>
              <div>
                <button className="secondary" type="button" onClick={pickConfig}>Choose file</button>
                <button className="text-button" type="button" onClick={() => { setConfig(SAMPLE_CONFIG); setFileName("UserCfg.opt"); setFilePath(""); }}>Use sample</button>
              </div>
            </div>
            <textarea aria-label="UserCfg.opt contents" value={config} onChange={(event) => setConfig(event.target.value)} spellCheck={false} />
            <div className="config-footer"><span>{config.split(/\r?\n/).length} lines</span><span>Original file is not overwritten</span></div>
          </div>

          <section className="manual-profiles" aria-label="Manual UserCfg profile library">
            <div className="manual-profiles-head">
              <div>
                <p className="eyebrow">03 / MANUAL PROFILE LIBRARY</p>
                <h3>Save your own MSFS setups</h3>
              </div>
              <span>{manualProfiles.length} saved</span>
            </div>
            <p className="profile-instructions">
              Set your options manually in MSFS, close the simulator completely, choose its UserCfg.opt above, then name and save the snapshot. Loading a profile backs up and overwrites that live file.
            </p>
            <div className="profile-save-row">
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="Profile name, e.g. Pimax VFR"
                aria-label="Manual profile name"
                maxLength={60}
              />
              <button type="button" onClick={saveManualProfile} disabled={profileBusy || !profileName.trim() || !config.trim() || !filePath}>
                Save current profile
              </button>
            </div>
            {manualProfiles.length > 0 && (
              <div className="profile-load-row">
                <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} aria-label="Saved manual profile">
                  {manualProfiles.map((savedProfile) => (
                    <option key={savedProfile.id} value={savedProfile.id}>
                      {savedProfile.name} - {savedProfile.flightMode.toUpperCase()} / {savedProfile.antiAliasing}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={loadManualProfile} disabled={profileBusy || !selectedProfileId}>Load &amp; apply</button>
                <button className="profile-delete" type="button" onClick={deleteManualProfile} disabled={profileBusy || !selectedProfileId}>Delete</button>
              </div>
            )}
            {selectedManualProfile && (
              <small className="profile-meta-line">
                Saved {new Date(selectedManualProfile.createdAt).toLocaleString()} from {selectedManualProfile.sourceName}
              </small>
            )}
            {profileMessage && <p className="profile-message">{profileMessage}</p>}
          </section>

          <button className="optimize" type="button" onClick={optimize} disabled={!config.trim() || status === "working" || detecting}>
            <span>{status === "working" ? "ANALYSING PROFILE…" : detecting ? "WAITING FOR SYSTEM SCAN…" : "OPTIMIZE MY CONFIG"}</span>
            <b>→</b>
          </button>
        </div>
      </section>

      {status === "done" && (
        <section className="results">
          <div className="results-head">
            <div><p className="eyebrow">04 / REVIEW</p><h2>{changes.length ? `${changes.length} focused adjustments` : "No safe changes found"}</h2><p>{summary}. Review every change before replacing your file.</p></div>
            <span className="engine">{engine === "AI" ? "AI reviewed" : "Local hardware profile"}</span>
          </div>
          <div className="change-list">
            {changes.map((change) => (
              <article key={`${change.line}-${change.setting}`}>
                <span className={`impact ${change.impact.toLowerCase()}`}>{change.impact}</span>
                <div><h3>{change.setting}</h3><p>{change.reason}</p></div>
                <code><del>{change.from}</del><span>→</span><ins>{change.to}</ins></code>
              </article>
            ))}
            {!changes.length && <p className="empty">This file does not contain recognised numeric scaling or LOD settings. No lines were changed.</p>}
          </div>
          <div className="download-row">
            <div><p><strong>Before installing:</strong> close MSFS 2024 and back up your current UserCfg.opt.</p>{saveMessage && <small>{saveMessage}</small>}</div>
            <button type="button" onClick={save}>Save optimized file ↓</button>
          </div>
        </section>
      )}

      <footer><span>FLIGHTTUNE / WINDOWS / v{appVersion}</span><p>© 2026 Andrew Brown · Independent tool. Not affiliated with Microsoft or Asobo Studio.</p></footer>
    </main>
  );
}
