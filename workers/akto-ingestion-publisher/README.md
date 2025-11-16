# Akto Ingestion Publisher Worker - Deployment

## Prerequisites

- Node.js 18+
- Wrangler CLI: `npm install -g wrangler`
- Authenticated: `wrangler login`

## Deployment Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Deploy

```bash
npx wrangler deploy
```

## Configuration

Service bindings (in `wrangler.jsonc`):
- `AKTO_INGESTION_WORKER`: Points to `akto-ingest-guardrails` worker

## Notes

- Deploy `akto-ingest-guardrails` worker first (required service binding)
- Traffic collection happens asynchronously using `ctx.waitUntil()`
- Only captures allowed content types (JSON, XML, GRPC, etc.)
- Worker uses service binding for internal worker-to-worker communication (no API key needed)
