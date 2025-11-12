# MCP Guardrails Refactor Summary

## Overview

Successfully refactored the MCP Guardrails validation logic from Go container to TypeScript Worker implementation. This eliminates the need for the Go container to make HTTP calls to external workers, solving the private worker communication constraint.

## Architecture Changes

### Before (Go Container Approach)
```
External Request → Hono Worker
                    ↓
                  MCP Guardrails Container (Go)
                    ↓ (HTTP - problematic!)
                  Model Executor Worker (needed to be public)
```

### After (TypeScript Worker Approach)
```
External Request → Hono Worker (TypeScript)
                    ↓ (Service Binding - private!)
                  Model Executor Worker (private)
```

## Files Created

### 1. Type Definitions
- **`src/types/mcp.ts`** - Complete TypeScript type definitions for:
  - Policies and filters
  - Validation contexts and results
  - Scanner interfaces
  - Request/response types

### 2. Core Services

- **`src/services/scanner-client.ts`** - Scanner client using service bindings
  - Communicates with model executor worker via `Fetcher` binding
  - Parallel scanner execution with timeout handling
  - Filter type mapping (harmful categories, prompt attacks, etc.)

- **`src/services/policy-validator.ts`** - Policy validation logic
  - Extracts user-controlled fields from MCP payloads
  - Safe method detection (skips protocol methods)
  - Request/response validation against policies
  - Blocked response generation

- **`src/services/mcp-processor.ts`** - Main processing orchestrator
  - Coordinates policy fetching and validation
  - Processes batch requests and responses
  - Threat reporting hooks (placeholder for future)

### 3. Worker Routes (src/index.ts)

Added three new endpoints:

1. **`POST /api/ingestData`** - Batch validation endpoint
   - Validates request/response pairs against policies
   - Sends data to runtime container for ingestion
   - Returns detailed validation results

2. **`POST /api/validate/request`** - Single request validation
   - Validates individual MCP request payload
   - Returns blocked/allowed status with reasons

3. **`POST /api/validate/response`** - Single response validation
   - Validates individual MCP response payload
   - Returns blocked/allowed status with reasons

### 4. Configuration

- **`wrangler.jsonc`** - Updated with:
  - Service binding for `MODEL_EXECUTOR` → `akto-agent-guard-executor`
  - Environment variable for `DATABASE_ABSTRACTOR_SERVICE_URL`
  - Documentation for setting `DATABASE_ABSTRACTOR_SERVICE_TOKEN` secret

## Key Features Implemented

### 1. MCP Protocol Awareness
- Detects safe protocol methods (initialize, ping, etc.)
- Extracts user-controlled content from:
  - `tools/call` - tool name and arguments
  - `sampling/createMessage` - message content
  - `prompts/get` - prompt text
  - `resources/read` - URI parameters

### 2. Policy-Based Validation
- Fetches guardrail policies from database abstractor
- Supports multiple filter types:
  - Harmful categories (toxicity)
  - Prompt injection attacks
  - Banned topics/substrings
  - Denied topics
- Parallel scanner execution for performance

### 3. Service Binding Integration
- Private worker-to-worker communication
- No public HTTP endpoints required
- Type-safe Fetcher interface
- Timeout and error handling

### 4. Batch Processing
- Validates multiple request/response pairs
- Parallel policy fetching
- Detailed per-item results
- Error isolation per batch item

## Configuration Required

### 1. Set the Database Abstractor Token
```bash
wrangler secret put DATABASE_ABSTRACTOR_SERVICE_TOKEN
```

### 2. Ensure Model Executor Worker Exists
The service binding references `akto-agent-guard-executor`. Make sure this worker is deployed in your Cloudflare account.

### 3. Deploy
```bash
npm install
npm run deploy
```

## Benefits

1. **✅ All workers remain private** - No HTTP exposure needed
2. **✅ Service bindings** - Fast, secure worker-to-worker communication
3. **✅ No Go container dependency** - Pure TypeScript implementation
4. **✅ Type safety** - Full TypeScript types throughout
5. **✅ Simplified architecture** - One less container to manage
6. **✅ Better performance** - Direct service binding calls vs HTTP
7. **✅ Easier testing** - TypeScript is easier to test than Go containers
8. **✅ Faster deployments** - Removed MCP Guardrails container saves deployment time

## Migration Notes

### Go Container (Removed)
The `McpGuardrailsContainer` has been **completely removed** from the deployment:
- ✅ Container definition removed from `wrangler.jsonc`
- ✅ Durable Object binding removed
- ✅ Migration configuration cleaned up
- ✅ TypeScript class definition removed from `src/index.ts`

**Result:** Faster deployments and reduced complexity with only one container (MiniRuntimeServiceContainer) remaining.

### API Compatibility
The new endpoints maintain compatibility with the original Go container API:
- Same request/response structure
- Same validation logic flow
- Same policy format

## Testing

Test the implementation with:

```bash
# Health check
curl https://your-worker.workers.dev/health

# Single request validation
curl -X POST https://your-worker.workers.dev/api/validate/request \
  -H "Content-Type: application/json" \
  -d '{"payload": "{\"method\":\"tools/call\",\"params\":{\"name\":\"test\"}}"}'

# Batch ingestion with validation
curl -X POST https://your-worker.workers.dev/api/ingestData \
  -H "Content-Type: application/json" \
  -d '{"batchData":[{"method":"POST","path":"/api/test","requestPayload":"..."}]}'
```

## Future Enhancements

- [ ] Implement threat reporting to backend
- [ ] Add caching for policy fetches
- [ ] Add metrics/observability
- [ ] Support for more MCP methods
- [ ] Response modification (redaction)
- [ ] Rate limiting per policy
