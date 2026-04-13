# OpenClaw Cloudflare Vectorize Memory

OpenClaw memory plugin backed by **Cloudflare Vectorize** for storage/search and **Workers AI** for embeddings.

## What it provides

- `kind: "memory"` OpenClaw plugin
- Cloudflare Workers AI embedding provider adapter: `cloudflare-workers-ai`
- Cloudflare-backed memory tools:
  - `cloudflare_memory_search`
  - `cloudflare_memory_get`
  - `cloudflare_memory_upsert`
  - `cloudflare_memory_delete`
- CLI commands under `cf-memory`
- Two storage modes:
  - `vectorize-inline` (default): stores retrievable text directly in Vectorize metadata
  - `companion-store`: stores vectors in Vectorize and full payloads in a local JSON sidecar
- Migration support for legacy markdown-based memory corpora

## Requirements

- Node 22+
- OpenClaw 2026.4.11+
- A Cloudflare API token with the permissions needed for:
  - **Workers AI**
  - **Vectorize**

If you want the plugin to create the index for you, the token must include write permissions.

## Install

### npm

```bash
openclaw plugins install openclaw-cloudflare-vectorize-memory
```

### ClawHub

Publish the package with the included `openclaw.plugin.json` manifest and install it through normal ClawHub/OpenClaw plugin flows.

OpenClaw uses the plugin manifest id `memory-cloudflare-vectorize` as the config key, so plugin config stays under `plugins.entries.memory-cloudflare-vectorize`.

## Optional bootstrap hook

This package also ships an optional managed hook named `cloudflare-memory-bootstrap`.

Enable it after installation with:

```bash
openclaw hooks enable cloudflare-memory-bootstrap
```

When enabled, the hook injects packaged bootstrap guidance so agents know the Cloudflare memory plugin is installed and can point operators at `openclaw cf-memory doctor`.

## Publishing to npmjs

After authenticating with npm for the target package owner, publish with:

```bash
npm run publish:npmjs
```

The script runs `check`, `test`, and `build` before calling `npm publish --access public`.

## Recommended environment variables

Cloudflare-standard variables:

```bash
set CLOUDFLARE_ACCOUNT_ID=your-account-id
set CLOUDFLARE_API_TOKEN=your-api-token
```

Plugin-specific variables:

```bash
set CLOUDFLARE_VECTORIZE_INDEX_NAME=openclaw-memory
set CLOUDFLARE_WORKERS_AI_EMBEDDING_MODEL=@cf/baai/bge-base-en-v1.5
set CLOUDFLARE_VECTORIZE_TOP_K=5
```

Optional:

```bash
set CLOUDFLARE_VECTORIZE_NAMESPACE=my-shared-namespace
set OPENCLAW_CF_MEMORY_STORAGE_MODE=companion-store
set OPENCLAW_CF_MEMORY_COMPANION_PATH=C:\path\to\companion-store.json
```

If `CLOUDFLARE_VECTORIZE_NAMESPACE` is omitted, the plugin derives namespaces from the active OpenClaw agent/session when possible.

## Example plugin config

```json
{
  "plugins": {
    "entries": {
      "memory-cloudflare-vectorize": {
        "vectorize": {
          "indexName": "openclaw-memory",
          "topK": 8,
          "createIndex": {
            "metric": "cosine"
          },
          "metadataIndexedFields": ["topic", "tenant"]
        },
        "embeddings": {
          "model": "@cf/baai/bge-base-en-v1.5"
        },
        "storage": {
          "mode": "vectorize-inline"
        }
      }
    }
  }
}
```

You can also store `cloudflare.apiToken` as an OpenClaw secret ref instead of plaintext.

## Setup and validation

Run:

```bash
openclaw cf-memory init
```

to create or repair the configured Vectorize index so it matches the active embedding model dimensions.

Validate configuration without changing infrastructure:

```bash
openclaw cf-memory doctor
```

Validate configuration and create the Vectorize index when missing:

```bash
openclaw cf-memory doctor --create-index
```

Run an end-to-end smoke test that verifies embedding, write, search, and cleanup:

```bash
openclaw cf-memory test
```

The doctor flow checks:

- Cloudflare credentials
- Vectorize index reachability
- Workers AI embedding dimensions
- embedding/index dimension compatibility
- metadata-index guidance for filter-heavy queries

## CLI usage

Initialize or repair the Vectorize index:

```bash
openclaw cf-memory init
```

Run a smoke test:

```bash
openclaw cf-memory test
```

Migrate the default OpenClaw markdown memory corpus from the current workspace:

```bash
openclaw cf-memory migrate
```

Preview a migration without writing anything:

```bash
openclaw cf-memory migrate --dry-run
```

Migrate specific markdown directories or glob patterns:

```bash
openclaw cf-memory migrate memories docs\notes\*.md
```

Import everything into a single namespace override:

```bash
openclaw cf-memory migrate memories --namespace imported-legacy
```

Derive namespaces from the first relative path segment instead:

```bash
openclaw cf-memory migrate memories --derive-namespace-from-path
```

Control duplicate handling on reruns:

```bash
openclaw cf-memory migrate memories --if-exists skip
```

By default, `migrate` overwrites records with the same derived logical id so reruns refresh previously imported content. Supported v1 sources are:

- explicit markdown files, directories, and glob patterns
- the default OpenClaw memory provider's readable markdown corpus when no sources are passed

The migration command stores the original source path in record metadata and reuses the normal Cloudflare upsert pipeline so embeddings, namespace handling, and storage-mode behavior stay consistent.

Search:

```bash
openclaw cf-memory search "preferred coding style" --limit 5
```

Upsert:

```bash
openclaw cf-memory upsert "Use Vitest for plugin tests." --id testing-style --metadata "{\"topic\":\"testing\"}"
```

Delete:

```bash
openclaw cf-memory delete testing-style
```

## Notes

- `vectorize-inline` is the easiest mode, but it is limited by Vectorize metadata size limits.
- Use `companion-store` when memory payloads are too large to fit comfortably in metadata.
- Metadata filters in Vectorize require metadata indexes on the Cloudflare side. Configure those before relying on filter-heavy recall.
