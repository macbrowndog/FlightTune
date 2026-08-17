# Changelog

Notable changes to FlightTune are recorded here.

## 2.0.0 - 2026-08-17

FlightTune 2.0.0 is a security, reliability, and release-readiness update for the
MSFS 2024 configuration optimizer.

### Added

- Explicit consent and a minimized-data disclosure before optional OpenAI review.
- An allowlist of AI-editable settings with validated numeric ranges.
- Privacy redaction for user paths, URLs, API keys, and control characters.
- Crash-safe configuration writes with byte-identical backups, atomic replacement,
  concurrent-change detection, verification, and automatic rollback.
- Content Security Policy enforcement, blocked webviews, navigation restrictions,
  external-URL allowlisting, and default-denied Electron permissions.
- Data-driven, tested CPU performance tiers for hardware recommendations.
- Automated coverage for configuration editing, encoding preservation, backups,
  rollback, AI validation, privacy redaction, optimizer behavior, and hardware detection.
- Windows CI for linting, tests, dependency auditing, production builds, installer
  creation, and build-artifact upload.
- A certificate-gated Windows release workflow that fails safely when signing
  credentials are unavailable.
- MIT licensing, a security policy, contribution guidance, and release notes.

### Changed

- Optional structured AI review now uses the lower-cost GPT-5.6 Luna model.
- OpenAI API failures are shown to the user instead of silently switching engines.
- CPU recommendations now use tested hardware tiers instead of hard-coded name scoring.
- The displayed FPS value is labelled as a profile target rather than a measured
  performance prediction.
- Build dependencies were upgraded and pinned to remove known audit findings.
- Windows installer builds explicitly disable implicit publishing and produce
  `FlightTune-Setup-2.0.0-x64.exe`.

### Security

- AI responses cannot modify unsupported settings or submit out-of-range values.
- Renderer navigation, new-window requests, webviews, and Electron permission
  requests are denied unless explicitly allowed.
- Sensitive configuration data is minimized and redacted before optional API use.

### Fixed

- Configuration updates no longer risk leaving a partially written `UserCfg.opt`.
- Original UTF-8 BOM, UTF-16 LE encoding, line endings, and final-newline behavior
  are preserved when editing configuration files.
- Installer packaging in GitHub Actions no longer attempts an unintended release.

## 1.1.1

- Initial FlightTune Windows release candidate with hardware detection, VR VFR/IFR recommendations, manual profile snapshots, and optional OpenAI review.
