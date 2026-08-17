# FlightTune for Windows

FlightTune is a Windows desktop application for VR flying in Microsoft
Flight Simulator 2024. It builds conservative `UserCfg.opt` recommendations
from the hardware and OpenXR headset installed in the current PC.

## VR profiles

- **VR VFR:** prioritizes scenery, terrain detail, and nearby landmarks.
- **VR IFR:** protects headroom for avionics and glass-cockpit aircraft.
- **TAA:** preferred for crisp glass-cockpit displays.
- **DLSS:** includes the MSFS presets Auto, DLAA, Quality, Balanced,
  Performance, and Ultra Performance.

## Manual profile library

FlightTune can keep multiple local snapshots of manually tuned MSFS 2024
configurations. Set the graphics and VR options in MSFS, close the simulator,
load its `UserCfg.opt` into FlightTune, enter a profile name, and choose
**Save current profile**. Selecting **Load & apply** later creates a timestamped
and byte-verified backup, then atomically restores the snapshot to the same live
`UserCfg.opt`, after explicit confirmation. FlightTune refuses to apply a
profile while an MSFS process is running and preserves the file's original BOM,
encoding, and line endings. Deleting a profile removes only FlightTune's
snapshot and never changes the live MSFS configuration.

## Automatic detection

At startup, FlightTune reads:

- CPU model from Windows hardware inventory, with a registry fallback
- Primary NVIDIA, AMD, or Intel GPU
- Dedicated VRAM from the 64-bit Windows display-adapter registry value
- Connected VR headset from Plug and Play devices
- Active OpenXR runtime for Meta, SteamVR, Pimax, Varjo, Vive, or WMR
- Active monitor when no headset is found

All detected values can be manually corrected in the interface.

## Development

Requirements: Windows 10/11, Node.js 22+, and pnpm.

```powershell
pnpm install
pnpm run lint
pnpm run test
pnpm run test:hardware
pnpm run dev
```

## Build

```powershell
pnpm run build
pnpm run dist:win
```

Installers are written to `release/`.

CI builds an unsigned installer for validation. Public releases must use the
certificate-gated signed release workflow with `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD` configured as GitHub Actions secrets. The workflow fails
if Authenticode signing is unavailable or invalid; certificates and passwords
must never be committed.

## Optional AI review

Open **OpenAI API** in the app to save and test an OpenAI API key. FlightTune
encrypts the saved key with Windows secure storage. `OPENAI_API_KEY` is also
supported and takes priority. Without a key, the deterministic local hardware
profile remains fully available.

AI review is disabled until the user explicitly consents. When enabled,
FlightTune uses GPT-5.6 Luna and sends only sanitized CPU, GPU, VRAM and headset
labels plus recognized tunable settings. It does not send the complete
`UserCfg.opt`, file paths, or the API key. Every
returned change is checked locally against an allowlist and safe range before
it can appear in the review. API errors are shown and the local profile is used
as a fallback.

## Project policy

FlightTune is available under the MIT License. See `SECURITY.md` for private
vulnerability reporting, `CONTRIBUTING.md` for development guidance, and
`CHANGELOG.md` for notable changes.
