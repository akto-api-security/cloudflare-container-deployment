# Akto Ingestion Publisher Worker

## Overview

This worker is an **example web app / MCP server** that demonstrates how to enable traffic data ingestion to Akto.

**You would need to refer to this worker code to update your Cloudflare server code in order to enable traffic ingestion to Akto.**

## Project Structure

- **`akto/`** - Contains the TypeScript logic for traffic ingestion to Akto
  - `ingest-data.ts` - Main ingestion entry point
  - `akto-ingestion-client.ts` - Singleton client for Akto service communication
  - `models.ts` - Data models and payload builder
  - `validations.ts` - Traffic capture validation logic
  - `utils.ts` - Contains utilities for traffic ingestion to Akto

- **`index.ts`** - Refer to the `fetch` method and replace `yourRequestHandler` with your server's request handling logic

- **`wrangler.jsonc`** - Contains service binding to `akto-ingest-guardrails` worker, which is responsible for handling Akto ingestion data and guardrails (if enabled)

- **`package.json`** - Standard Cloudflare TypeScript packages configuration

- **`tsconfig.json`** - Standard Cloudflare TypeScript configuration

## Integration Guide

### 1. Copy the `akto/` directory to your project

### 2. Update your worker's `fetch` handler

```typescript
import { replicateRequest, replicateResponse } from "./akto/utils";
import { ingestTrafficToAkto } from "./akto/ingest-data";
import { AktoIngestionClient } from "./akto/akto-ingestion-client";

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    // Initialize Akto client on first request
    AktoIngestionClient.init(env.AKTO_INGESTION_WORKER);

    // Replicate the request at the start
    const [requestForMainExecution, requestForAktoIngestion] = await replicateRequest(request);

    // Forward to your application handler (replace with your logic)
    const response = await yourRequestHandler(requestForMainExecution, env, ctx);

    const [responseForMainExecution, responseForAktoIngestion] = replicateResponse(response);

    // Ingest traffic data to Akto in background (non-blocking)
    ctx.waitUntil(
      ingestTrafficToAkto(requestForAktoIngestion, responseForAktoIngestion)
    );

    // Return response to client
    return responseForMainExecution;
  },
};
```

### 3. Add service binding to your `wrangler.jsonc`

```json
{
  "services": [
    {
      "binding": "AKTO_INGESTION_WORKER",
      "service": "akto-ingest-guardrails"
    }
  ]
}
```

## Prerequisites

- Node.js 18+
- Wrangler CLI: `npm install -g wrangler`
- Authenticated: `wrangler login`

## Running the Example

### 1. Install Dependencies

```bash
npm install
```

### 2. Deploy

```bash
npx wrangler deploy
```

## Important Notes

- Deploy `akto-ingest-guardrails` worker first (required service binding)
- Traffic collection happens asynchronously using `ctx.waitUntil()` - it won't block your main response
- Only captures allowed content types (JSON, XML, GRPC, form-urlencoded, etc.)
- Replicates original server request and response to avoid conflict with main execution flow
- All Akto-related logs are prefixed with `[Akto]` for easy filtering
- Worker uses service binding for internal worker-to-worker communication (no API key needed)
