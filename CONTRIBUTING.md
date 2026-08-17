# Contributing to FlightTune

Thanks for helping improve FlightTune.

## Development setup

Use Windows 10 or 11, Node.js 22, and pnpm 11.

```powershell
pnpm install --frozen-lockfile
pnpm run lint
pnpm run test
pnpm run build
```

Run `pnpm run test:hardware` when changing Windows hardware detection. Build an
installer with `pnpm run dist:win` when changing Electron, packaging, preload,
or configuration-file behavior.

## Pull requests

- Keep changes focused and explain the user-visible effect.
- Add or update tests for behavior changes.
- Do not weaken the AI setting allowlist, numeric ranges, IPC validation,
  renderer isolation, CSP, or atomic `UserCfg.opt` replacement.
- Never commit API keys, certificates, certificate passwords, private paths,
  generated installers, or personal configuration files.
- Update `CHANGELOG.md` for notable changes.

## Security reports

Do not open a public issue for a suspected vulnerability. Follow
`SECURITY.md` instead.
