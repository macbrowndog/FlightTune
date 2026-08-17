/// <reference types="vite/client" />

type Hardware = {
  cpu: string;
  gpu: string;
  vramGb: number;
  display: string;
  headsetDetected: boolean;
  openXrRuntime: string;
  detectedAt: string;
  source: string;
};

type DetectionResult = { ok: true; hardware: Hardware } | { ok: false; error: string };

type ManualProfileSummary = {
  id: string;
  name: string;
  createdAt: string;
  sourceName: string;
  flightMode: "vfr" | "ifr";
  antiAliasing: "TAA" | "DLSS";
  dlssMode: "Auto" | "DLAA" | "Quality" | "Balanced" | "Performance" | "Ultra Performance";
};

type ManualProfile = ManualProfileSummary & {
  sourcePath: string;
  content: string;
};

interface Window {
  flightTune?: {
    detectHardware: () => Promise<DetectionResult>;
    pickConfig: () => Promise<{ canceled: true } | { canceled: false; name: string; path: string; content: string }>;
    saveConfig: (payload: { defaultName: string; content: string }) => Promise<{ canceled: true } | { canceled: false; path: string }>;
    listManualProfiles: () => Promise<{ ok: true; profiles: ManualProfileSummary[] } | { ok: false; error: string }>;
    saveManualProfile: (payload: { name: string; content: string; sourceName: string; sourcePath: string; flightMode: string; antiAliasing: string; dlssMode: string }) => Promise<
      { ok: true; profile: ManualProfileSummary } | { ok: false; error: string }
    >;
    loadManualProfile: (id: string) => Promise<
      { ok: true; canceled: true }
      | { ok: true; canceled: false; profile: ManualProfile; appliedPath: string; backupPath: string }
      | { ok: false; error: string }
    >;
    deleteManualProfile: (id: string) => Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }>;
    reviewConfig: (payload: { config: string; cpu: string; gpu: string; vram: number; display: string; flightMode: string; antiAliasing: string; dlssMode: string }) => Promise<
      { ok: true; summary: string; changes: Array<{ line: number; setting: string; from: string; to: string; reason: string; impact: "CPU" | "GPU" | "VRAM" | "VR" }> }
      | { ok: false; reason: string }
    >;
    getApiStatus: () => Promise<{ configured: boolean; source: string | null }>;
    saveApiKey: (key: string) => Promise<
      { ok: true; configured: true; source: string }
      | { ok: false; error: string }
    >;
    clearApiKey: () => Promise<{ ok: true; configured: boolean; source: string | null }>;
    testApiKey: (key?: string) => Promise<{ ok: boolean; message: string }>;
    getAppVersion: () => Promise<string>;
  };
}
