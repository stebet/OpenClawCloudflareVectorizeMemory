---
name: cloudflare-memory-bootstrap
description: "Adds packaged bootstrap guidance for the Cloudflare memory plugin when enabled."
metadata:
  { "openclaw": { "events": ["agent:bootstrap"] } }
---

# Cloudflare Memory Bootstrap

When enabled, this hook injects a packaged `BOOTSTRAP.md` file during agent bootstrap so the agent can see that the Cloudflare Vectorize memory plugin is installed and how to validate it.
