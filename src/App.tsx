import { useEffect, useMemo, useState } from "react";
import { applyChanges, createPlan, type AntiAliasing, type Change, type DlssMode, type FlightMode } from "./optimizer";

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
  const [aiConsent, setAiConsent] = useState(false);
  const [reviewNotice, setReviewNotice] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiConfigured, setApiConfigured] = useState(false);
  const [apiSource, setApiSource] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState("");
  const [apiBusy, setApiBusy] = useState(false);
  const [appVersion, setAppVersion] = useState("2.0.0");
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
    setProfileMessage(`Saved "${result.profile.name}" to the local profile library.`);
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
    setProfileMessage(`Applied "${saved.name}" to UserCfg.opt. Backup saved to ${result.backupPath}`);
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
    setReviewNotice("");
    let result = createPlan(config, cpu, vram, display, flightMode, antiAliasing, dlssMode);
    let selectedEngine: "Local" | "AI" = "Local";
    if (window.flightTune && apiConfigured && aiConsent) {
      const ai = await window.flightTune.reviewConfig({ config, cpu, gpu, vram, display, flightMode, antiAliasing, dlssMode, consent: true });
      if (ai.ok) {
        result = { changes: ai.changes, summary: ai.summary };
        selectedEngine = "AI";
      } else {
        setReviewNotice(ai.error);
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
    setAiConsent(false);
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
            OpenAI API
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
            <span />
            <div><strong>{profile.fps}</strong><small>profile target</small></div>
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
            <p><strong>Local by default</strong>Hardware stays on this PC unless you explicitly enable the optional OpenAI review.</p>
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
            <section className="api-settings" aria-label="OpenAI API settings">
              <div className="api-settings-head">
                <div>
                  <p className="eyebrow">OPENAI API</p>
                  <h3>{apiConfigured ? "AI review is connected" : "Add optional AI review"}</h3>
                </div>
                <span className={apiConfigured ? "api-status connected" : "api-status"}>
                  {apiConfigured ? (apiSource === "environment" ? "Environment key" : "Key secured") : "Not connected"}
                </span>
              </div>
              <p>Optional GPT-5.6 Luna review. FlightTune sends only CPU/GPU/VRAM/headset labels and recognized tunable settings—never the complete file, file paths, or your API key.</p>
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
              <label className="api-consent">
                <input
                  type="checkbox"
                  checked={aiConsent}
                  onChange={(event) => setAiConsent(event.target.checked)}
                  disabled={!apiConfigured}
                />
                <span>I consent to sending the minimized fields described above to OpenAI when I optimize.</span>
              </label>
              <small>Saved keys are encrypted by Windows and never written into UserCfg.opt. You can optimize locally without enabling AI review.</small>
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
            <span className="engine">{engine === "AI" ? "AI reviewed · GPT-5.6 Luna" : "Local hardware profile"}</span>
          </div>
          {reviewNotice && <div className="review-notice" role="status"><strong>AI review unavailable.</strong> {reviewNotice}</div>}
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
