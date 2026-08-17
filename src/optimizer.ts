export type FlightMode = "vfr" | "ifr";
export type AntiAliasing = "TAA" | "DLSS";
export type DlssMode = "Auto" | "DLAA" | "Quality" | "Balanced" | "Performance" | "Ultra Performance";
export type CpuTier = 1 | 2 | 3;
export type Change = {
  line: number;
  setting: string;
  from: string;
  to: string;
  reason: string;
  impact: "CPU" | "GPU" | "VRAM" | "VR";
};

const CPU_FAMILY_TIERS: Readonly<Record<string, CpuTier>> = {
  "3": 1,
  "5": 1,
  "7": 2,
  "9": 3,
};

export function scoreCpu(cpu: string): CpuTier {
  const value = cpu.toLowerCase().replace(/[®™]/g, " ").replace(/\s+/g, " ");
  if (/threadripper|epyc/.test(value)) return 3;

  const ultra = value.match(/core\s+ultra\s+([579])/);
  if (ultra) return CPU_FAMILY_TIERS[ultra[1]];

  const ryzen = value.match(/ryzen\s+([3579])/);
  if (ryzen) {
    if (/x3d/.test(value)) return 3;
    return CPU_FAMILY_TIERS[ryzen[1]];
  }

  const intelCore = value.match(/\bi([3579])[-\s]?(\d{4,5})?/);
  if (intelCore) {
    const familyTier = CPU_FAMILY_TIERS[intelCore[1]];
    const model = Number(intelCore[2] || 0);
    if (intelCore[1] === "9" && model > 0 && model < 12000) return 2;
    return familyTier;
  }

  if (/\bxeon\b/.test(value)) return 2;
  return 1;
}

function fixedLike(value: string, next: number) {
  return value.includes(".") ? next.toFixed(6) : String(Math.round(next));
}

export function createPlan(
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
  const lines = config.split(/\r\n|\r|\n/);
  const changes: Change[] = [];
  const sections: string[] = [];

  lines.forEach((line, index) => {
    const opening = line.match(/^\s*\{([^\s}]+)/);
    if (opening) sections.push(opening[1]);
    const section = sections.at(-1) || "";
    const valueMatch = line.match(/^\s*(PrimaryScaling|SecondaryScaling|LoDFactor|AntiAliasing|DLSSMode)\s+(.+?)\s*$/);
    if (valueMatch) {
      const key = valueMatch[1];
      const current = valueMatch[2];
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
        if (antiAliasing !== current.toUpperCase()) {
          changes.push({
            line: index,
            setting: "Video · AntiAliasing",
            from: current,
            to: antiAliasing,
            reason: antiAliasing === "TAA"
              ? "TAA is preferred for crisp glass-cockpit and avionics text."
              : "DLSS can recover GPU headroom for scenery-heavy VR VFR flying.",
            impact: "VR",
          });
        }
      } else if (key === "DLSSMode" && antiAliasing === "DLSS" && dlssMode !== current) {
        changes.push({
          line: index,
          setting: "Video · DLSSMode",
          from: current,
          to: dlssMode,
          reason: `${dlssMode} matches the selected MSFS DLSS Super Resolution preset.`,
          impact: "GPU",
        });
      }

      if (next !== null) {
        const replacement = fixedLike(current, next);
        if (replacement !== current) {
          changes.push({ line: index, setting: `${section || "Video"} · ${key}`, from: current, to: replacement, reason, impact });
        }
      }
    }

    const closingCount = (line.match(/}/g) || []).length;
    for (let close = 0; close < closingCount; close += 1) sections.pop();
  });

  return {
    changes,
    summary: `${flightMode === "vfr" ? "VR VFR scenery" : "VR IFR glass-cockpit"} profile for ${display}, using ${antiAliasing}${antiAliasing === "DLSS" ? ` ${dlssMode}` : ""}`,
  };
}

export function applyChanges(config: string, changes: Change[]) {
  const lineEnding = config.includes("\r\n") ? "\r\n" : config.includes("\r") ? "\r" : "\n";
  const lines = config.split(/\r\n|\r|\n/);
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
  return lines.join(lineEnding);
}
