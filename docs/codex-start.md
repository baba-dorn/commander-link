# Codex start prompt

Use this after opening the repository in Codex:

> Implement this repository to MVP completion. First read AGENTS.md, README.md, docs/* and TASKS.md. Work through TASKS.md in order. Do not build custom WebRTC signalling in Cloudflare and do not expose Metered secrets. Verify current official Metered and Cloudflare APIs before implementing P0. Keep browser and Electron on one shared product/WebRTC core. Every push-to-talk failure path must fail closed to muted. Run tests/typecheck/build after each milestone, update TASKS.md truthfully, and continue until all locally achievable MVP acceptance criteria pass. For hardware/network-specific manual tests you cannot execute, leave an explicit release-checklist item rather than claiming success.
