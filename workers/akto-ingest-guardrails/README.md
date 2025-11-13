# Akto Ingest Guardrails Worker - Deployment

## Prerequisites

- Node.js 18+
- Wrangler CLI: `npm install -g wrangler`
- Authenticated: `wrangler login`
- Docker with buildx (for container image)

## Deployment Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Push Mini Runtime Service Container Image

```bash
# Pull base image
docker pull --platform linux/amd64 <YOUR_MRS_IMAGE>

# Rebuild for linux/amd64 (required)
docker buildx build --platform linux/amd64 --load -t mrs:testing9 - <<'EOF'
FROM <YOUR_MRS_IMAGE>
EOF

# Push to Cloudflare
npx wrangler containers push mrs:testing9
```

### 3. Update wrangler.jsonc

Set the container image path (replace with your Cloudflare account ID):
```jsonc
"containers": [
  {
    "class_name": "AktoMiniRuntimeServiceContainer",
    "image": "registry.cloudflare.com/<YOUR_CLOUDFLARE_ACCOUNT_ID>/mrs:testing9",
    "max_instances": 10,
    "instance_type": "standard",
    "name": "akto-mini-runtime-service-container"
  }
]
```

Update service binding to point to the executor worker:
```jsonc
"services": [
  {
    "binding": "AKTO_GUARDRAILS_EXECUTOR",
    "service": "akto-guardrails-executor"
  }
]
```

### 4. Set Secrets

```bash
# Database Abstractor Service Token
wrangler secret put DATABASE_ABSTRACTOR_SERVICE_TOKEN

# Threat Backend Token
wrangler secret put THREAT_BACKEND_TOKEN
```

### 5. Deploy

```bash
npx wrangler deploy
```

## Configuration

Environment variables (already set in `wrangler.jsonc`):
- `DATABASE_ABSTRACTOR_SERVICE_URL`: https://cyborg.akto.io
- `THREAT_BACKEND_URL`: https://tbs.akto.io
- `ENABLE_MCP_GUARDRAILS`: "true" (set to "false" to disable)

## Notes

- Deploy `akto-guardrails-executor` worker first (required service binding)
- Worker is private (no public HTTP URL) - set via `workers_dev: false`
