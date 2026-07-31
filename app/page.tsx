"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";

type Goal = "smooth" | "balanced" | "visuals";
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

const headsetOptions = [
  "Monitor / no VR",
  "Meta Quest 2",
  "Meta Quest 3 / 3S",
  "Meta Quest Pro",
  "Pimax Crystal / Light",
  "HP Reverb G2",
  "Bigscreen Beyond",
  "Pico 4 / Ultra",
  "Varjo Aero / XR",
  "Vive Pro 2 / Focus Vision",
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

function localPlan(config: string, cpu: string, vram: number, headset: string, goal: Goal) {
  const vr = headset !== "Monitor / no VR";
  const cpuTier = scoreCpu(cpu);
  const goalDelta = goal === "smooth" ? -0.25 : goal === "visuals" ? 0.3 : 0;
  const scaleBase = vr
    ? vram >= 20 ? 1 : vram >= 12 ? 0.9 : vram >= 8 ? 0.82 : 0.72
    : vram >= 12 ? 1 : vram >= 8 ? 0.9 : 0.8;
  const terrain = Math.max(1, (vr ? [1.15, 1.45, 1.8] : [1.35, 1.8, 2.25])[cpuTier - 1] + goalDelta);
  const objects = Math.max(0.8, terrain - (vr ? 0.25 : 0.2));
  const lines = config.split(/\r?\n/);
  const changes: Change[] = [];
  let section = "";

  lines.forEach((line, index) => {
    const opening = line.match(/^\s*\{([^\s}]+)/);
    if (opening) section = opening[1];
    const valueMatch = line.match(/^(\s*)(PrimaryScaling|SecondaryScaling|LoDFactor)\s+(-?\d+(?:\.\d+)?)(\s*)$/);
    if (!valueMatch) return;

    const key = valueMatch[2];
    const current = valueMatch[3];
    let next: number | null = null;
    let reason = "";
    let impact: Change["impact"] = "GPU";

    if ((vr && key === "SecondaryScaling") || (!vr && key === "PrimaryScaling")) {
      next = Math.max(0.6, Math.min(1.15, scaleBase + (goal === "visuals" ? 0.05 : goal === "smooth" ? -0.05 : 0)));
      reason = vr ? "Matches per-eye render load to headset and available VRAM." : "Balances output resolution against GPU headroom.";
      impact = vr ? "VR" : "GPU";
    } else if (key === "LoDFactor" && /terrain/i.test(section)) {
      next = terrain;
      reason = "Terrain detail is primarily tuned to the CPU target and performance goal.";
      impact = "CPU";
    } else if (key === "LoDFactor" && /objects/i.test(section)) {
      next = objects;
      reason = "Object distance is held slightly below terrain detail to reduce main-thread spikes.";
      impact = "CPU";
    }

    if (next === null) return;
    const replacement = fixedLike(current, next);
    if (replacement !== current) {
      changes.push({ line: index, setting: `${section || "Video"} · ${key}`, from: current, to: replacement, reason, impact });
    }
  });

  return { changes, summary: vr ? `VR baseline for ${headset}` : "2D display baseline" };
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

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [cpu, setCpu] = useState("AMD Ryzen 7 7800X3D");
  const [gpu, setGpu] = useState("NVIDIA GeForce RTX 4070");
  const [vram, setVram] = useState(12);
  const [headset, setHeadset] = useState("Meta Quest 3 / 3S");
  const [goal, setGoal] = useState<Goal>("balanced");
  const [config, setConfig] = useState(SAMPLE_CONFIG);
  const [fileName, setFileName] = useState("UserCfg.opt");
  const [changes, setChanges] = useState<Change[]>([]);
  const [optimized, setOptimized] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "done">("idle");
  const [engine, setEngine] = useState<"AI" | "Local">("Local");

  const profile = useMemo(() => {
    const vr = headset !== "Monitor / no VR";
    const tier = vram >= 16 ? "Enthusiast" : vram >= 10 ? "High" : vram >= 8 ? "Balanced" : "Lean";
    return { vr, tier, fps: vr ? (goal === "smooth" ? "72–90" : "45–72") : (goal === "smooth" ? "60+" : "40–60") };
  }, [headset, vram, goal]);

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setConfig(await file.text());
    setFileName(file.name);
    setChanges([]);
    setOptimized("");
    setStatus("idle");
  };

  const optimize = async () => {
    setStatus("working");
    const fallback = localPlan(config, cpu, vram, headset, goal);
    let result = fallback;
    let usedEngine: "AI" | "Local" = "Local";

    try {
      const session = localStorage.getItem("flighttune-session") || crypto.randomUUID();
      localStorage.setItem("flighttune-session", session);
      const response = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, cpu, gpu, vram, headset, goal, session }),
      });
      if (response.ok) {
        const ai = await response.json();
        if (Array.isArray(ai.changes)) {
          result = ai;
          usedEngine = ai.engine === "AI" ? "AI" : "Local";
        }
      }
    } catch {
      // The deterministic profile remains available when the API is not configured.
    }

    setChanges(result.changes);
    setOptimized(applyChanges(config, result.changes));
    setSummary(result.summary);
    setEngine(usedEngine);
    setStatus("done");
  };

  const download = () => {
    const blob = new Blob([optimized || config], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName.toLowerCase().endsWith(".opt") ? fileName : "UserCfg.opt";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="FlightTune home">
          <span className="brand-mark">FT</span>
          <span>FLIGHT<span>TUNE</span></span>
        </a>
        <div className="top-actions">
          <span className="status-dot"><i /> MSFS 2024</span>
          <a href="#safety">Safety notes</a>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">CONFIG LAB / AI-ASSISTED TUNING</p>
          <h1>More sky.<br /><em>Less stutter.</em></h1>
          <p className="lede">Build a safer Microsoft Flight Simulator 2024 profile around your CPU, GPU, VRAM and headset—not somebody else&apos;s PC.</p>
        </div>
        <div className="flight-card" aria-label="Current optimization target">
          <div className="flight-card-top">
            <span>PROFILE 01</span>
            <b>{profile.vr ? "VR" : "2D"}</b>
          </div>
          <div className="gauge">
            <span style={{ "--gauge": `${Math.min(92, 46 + vram * 2)}%` } as React.CSSProperties} />
            <div><strong>{profile.fps}</strong><small>target fps</small></div>
          </div>
          <div className="profile-meta">
            <div><small>CLASS</small><strong>{profile.tier}</strong></div>
            <div><small>PRIORITY</small><strong>{goal}</strong></div>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="steps" aria-label="Optimization steps">
          <p className="eyebrow">FLIGHT PLAN</p>
          {["Hardware", "Display", "Config file", "Review"].map((item, i) => (
            <div className={`step ${status === "done" || i === 0 ? "active" : ""}`} key={item}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div><strong>{item}</strong><small>{["CPU, GPU & memory", "Headset & target", "Upload or paste", "Inspect & export"][i]}</small></div>
            </div>
          ))}
          <div className="safe-note">
            <span>✓</span>
            <p><strong>Non-destructive</strong>Your original file stays on your device. Unknown settings are preserved.</p>
          </div>
        </aside>

        <div className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">01 / HARDWARE PROFILE</p><h2>Tell us what&apos;s in the cockpit.</h2></div>
            <span className="profile-chip">{profile.tier} build</span>
          </div>

          <div className="form-grid">
            <label>Processor <span>CPU</span>
              <input value={cpu} onChange={(e) => setCpu(e.target.value)} placeholder="e.g. Ryzen 7 7800X3D" />
            </label>
            <label>Graphics card <span>GPU</span>
              <input value={gpu} onChange={(e) => setGpu(e.target.value)} placeholder="e.g. RTX 4070" />
            </label>
            <label>Video memory <span>GB</span>
              <div className="range-row"><input type="range" min="4" max="32" value={vram} onChange={(e) => setVram(Number(e.target.value))} /><output>{vram} GB</output></div>
            </label>
            <label>Display / headset <span>OPENXR</span>
              <select value={headset} onChange={(e) => setHeadset(e.target.value)}>
                {headsetOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          </div>

          <fieldset>
            <legend>Optimization target</legend>
            <div className="goal-picker">
              {([
                ["smooth", "Smooth flight", "Prioritize frame-time stability"],
                ["balanced", "Balanced", "Clarity without sharp spikes"],
                ["visuals", "Best visuals", "Use available headroom"],
              ] as const).map(([value, title, copy]) => (
                <button type="button" className={goal === value ? "selected" : ""} onClick={() => setGoal(value)} key={value}>
                  <span>{goal === value ? "●" : "○"}</span><strong>{title}</strong><small>{copy}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="config-block">
            <div className="config-head">
              <div><p className="eyebrow">02 / USERCFG.OPT</p><h3>{fileName}</h3></div>
              <div>
                <input ref={fileInput} type="file" accept=".opt,.cfg,.txt" onChange={loadFile} hidden />
                <button className="secondary" type="button" onClick={() => fileInput.current?.click()}>Upload file</button>
                <button className="text-button" type="button" onClick={() => { setConfig(SAMPLE_CONFIG); setFileName("UserCfg.opt"); }}>Use sample</button>
              </div>
            </div>
            <textarea aria-label="UserCfg.opt contents" value={config} onChange={(e) => setConfig(e.target.value)} spellCheck={false} />
            <div className="config-footer"><span>{config.split(/\r?\n/).length} lines</span><span>Processed in this session only</span></div>
          </div>

          <button className="optimize" type="button" onClick={optimize} disabled={!config.trim() || status === "working"}>
            <span>{status === "working" ? "ANALYSING PROFILE…" : "OPTIMIZE MY CONFIG"}</span>
            <b>→</b>
          </button>
        </div>
      </section>

      {status === "done" && (
        <section className="results" id="results">
          <div className="results-head">
            <div><p className="eyebrow">03 / REVIEW</p><h2>{changes.length ? `${changes.length} focused adjustments` : "No safe changes found"}</h2><p>{summary}. Review every change before replacing your file.</p></div>
            <span className={`engine ${engine.toLowerCase()}`}>{engine === "AI" ? "AI reviewed" : "Local baseline"}</span>
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
            <p><strong>Before installing:</strong> close MSFS 2024 and back up your current UserCfg.opt.</p>
            <button type="button" onClick={download}>Download optimized file ↓</button>
          </div>
        </section>
      )}

      <section className="safety" id="safety">
        <p className="eyebrow">PREFLIGHT CHECK</p>
        <h2>Change one thing at a time.</h2>
        <div>
          <p><span>01</span><strong>Back up first</strong>Keep the original UserCfg.opt so you can return to known-good settings.</p>
          <p><span>02</span><strong>Close the sim</strong>MSFS can rewrite the file when it exits, so edit only while it is fully closed.</p>
          <p><span>03</span><strong>Test a repeatable flight</strong>Compare the same airport, weather and aircraft before tuning further.</p>
        </div>
      </section>

      <footer><span>FLIGHTTUNE / MSFS 2024 CONFIG LAB</span><p>Independent tool. Not affiliated with Microsoft or Asobo Studio.</p></footer>
    </main>
  );
}
