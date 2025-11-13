# Akto Cloudflare Workers

This repository contains two Cloudflare Workers for Akto's API security platform:

1. **akto-ingest-guardrails** - Ingests MCP traffic and applies guardrails validation
2. **akto-guardrails-executor** - Executes Python-based security scanning at the edge

## Prerequisites

- Node.js 18+ and npm
- Cloudflare account with Workers enabled
- Wrangler CLI installed globally: `npm install -g wrangler`
- Authenticated with Wrangler: `wrangler login`

## Deployment

### 1. Deploy akto-guardrails-executor

```bash
cd workers/akto-guardrails-executor
npm install
wrangler deploy
```

### 2. Deploy akto-ingest-guardrails

```bash
cd workers/akto-ingest-guardrails
npm install

# Set secrets
wrangler secret put DATABASE_ABSTRACTOR_SERVICE_TOKEN
wrangler secret put THREAT_BACKEND_TOKEN

# Deploy
wrangler deploy
```

## Configuration

### akto-ingest-guardrails

Environment variables in `wrangler.jsonc`:
- `DATABASE_ABSTRACTOR_SERVICE_URL` - Cyborg API URL (default: https://cyborg.akto.io)
- `THREAT_BACKEND_URL` - TBS API URL (default: https://tbs.akto.io)
- `ENABLE_MCP_GUARDRAILS` - Enable/disable guardrails (default: "true")

Secrets (set via CLI):
- `DATABASE_ABSTRACTOR_SERVICE_TOKEN` - Authentication token for Cyborg API
- `THREAT_BACKEND_TOKEN` - Authentication token for TBS API

### akto-guardrails-executor

Configuration in `wrangler.jsonc`:
- Container instance type: `standard-3`
- Max instances: 10
- Default port: 8092

## Service Bindings

The `akto-ingest-guardrails` worker depends on `akto-guardrails-executor` via service binding.

Update the service binding in `workers/akto-ingest-guardrails/wrangler.jsonc`:
```jsonc
"services": [
  {
    "binding": "MODEL_EXECUTOR",
    "service": "akto-agent-guard-executor"
  }
]
```

## Development

Run locally with:
```bash
wrangler dev
```

## Architecture

```
┌─────────────────────────┐
│ akto-ingest-guardrails  │ (Main Worker)
│  - Receives MCP traffic │
│  - Validates requests   │
│  - Forwards to container│
└───────┬─────────────────┘
        │
        ├──► Service Binding
        │
        ▼
┌─────────────────────────┐
│akto-guardrails-executor │ (Executor Worker)
│  - Python container     │
│  - Security scanning    │
│  - LLM-based validation │
└─────────────────────────┘
```
