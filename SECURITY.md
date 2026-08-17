# Security policy

## Supported versions

Security fixes are provided for the latest published FlightTune release.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository.
Do not include API keys, `UserCfg.opt` contents, usernames, installation paths,
or other personal information in a public issue.

Include the affected version, reproduction steps, impact, and any suggested
mitigation. You should receive an acknowledgement within seven days. Please
allow reasonable time for investigation and a coordinated fix before public
disclosure.

## Sensitive data

FlightTune stores optional OpenAI API keys using Electron's Windows-backed
secure storage. Keys, signing certificates, certificate passwords, and local
MSFS configuration files must never be committed to this repository.
