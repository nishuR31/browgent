# Contributing

1. Open an issue for major behavior or architecture changes before implementing them.
2. Keep session state ephemeral by default and avoid adding persistent telemetry/history.
3. Treat web content and extensions as untrusted. Never expose unrestricted Node/Electron APIs to the renderer.
4. Include reproduction steps and tests for session isolation, destruction, downloads, and privacy-policy changes.
5. Do not claim anonymity or forensic deletion without evidence and a documented threat model.

## Local workflow

```bash
npm install
npm run dev
npm run build
```

Before submitting, test at least two simultaneous sessions and verify that cookies/storage do not cross session boundaries.
