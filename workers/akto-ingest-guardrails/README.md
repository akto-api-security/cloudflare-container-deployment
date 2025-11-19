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

### 4. Setup KV Namespace for Rate Limiting (Optional)

**Note**: Rate limiting is controlled by this KV namespace binding. To disable rate limiting, skip this step or comment out the `kv_namespaces` block.

Create KV namespace (if not already exists):
```bash
npx wrangler kv namespace create "AKTO_GUARDRAILS_RATE_LIMIT_KV"
```

Uncomment and update the `kv_namespaces` block in `wrangler.jsonc` with the generated ID:
```jsonc
"kv_namespaces": [
  {
    "binding": "AKTO_GUARDRAILS_RATE_LIMIT_KV",
    "id": "<GENERATED_KV_ID>"
  }
]
```

If the namespace already exists, get the ID from Cloudflare UI:
**Storage & Databases > Workers KV > AKTO_GUARDRAILS_RATE_LIMIT_KV**

### 5. Set Secrets

```bash
# Database Abstractor Service Token
wrangler secret put DATABASE_ABSTRACTOR_SERVICE_TOKEN

# Threat Backend Token
wrangler secret put THREAT_BACKEND_TOKEN
```

### 6. Deploy

```bash
npx wrangler deploy
```

## Configuration

Environment variables (already set in `wrangler.jsonc`):
- `DATABASE_ABSTRACTOR_SERVICE_URL`: https://cyborg.akto.io
- `THREAT_BACKEND_URL`: https://tbs.akto.io
- `ENABLE_MCP_GUARDRAILS`: "true" (set to "false" to disable)

### Rate Limiting Configuration

Rate limiting is applied globally across all MCP tool calls.

**Enabling/Disabling:**

Rate limiting is controlled by the KV namespace binding. To disable, comment out the `kv_namespaces` block in `wrangler.jsonc`.

**Configuration Source:**

Rate limit rules are automatically fetched from the backend. Configure via:

**Akto Dashboard**: Settings > Threat Configuration

The worker uses the first STATIC rule configuration:
- `maxRequests` - Maximum number of requests allowed
- `period` - Time window in minutes

Rate limits are tracked per IP per tool by default.

**Fallback Configuration:**

If the backend is unavailable or no static rule is found, defaults are used:
- Limit: 100 requests
- Window: 300 seconds (5 minutes)
- Tracking: Per IP per tool

## Notes

- Deploy `akto-guardrails-executor` worker first (required service binding)
- Worker is private (no public HTTP URL) - set via `workers_dev: false`
- Rate limiting requires KV namespace to be set up
- Rate limits are distributed across Cloudflare edge locations via KV
