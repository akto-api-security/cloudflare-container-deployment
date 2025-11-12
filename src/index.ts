import { Container, loadBalance, getContainer, getRandom } from "@cloudflare/containers";
import { Hono } from "hono";
import { fetchGuardrailPolicies, fetchMcpAuditInfo } from "./services/policy-manager";
import {
  handleBatchValidation,
  handleRequestValidation,
  handleResponseValidation,
} from "./handlers/validation-handler";
import type {
  IngestDataBatch,
} from "./types/mcp";

const INSTANCE_COUNT = 3;

export class MiniRuntimeServiceContainer extends Container {
  // Port the container listens on (default: 8080)
  defaultPort = 8080;
  // Time before container sleeps due to inactivity (default: 30s)
  sleepAfter = "1h";

  // Environment variables passed to the container
  envVars = {
    MESSAGE: "I was passed in via the container class!",
    AKTO_LOG_LEVEL: "DEBUG",
    DATABASE_ABSTRACTOR_SERVICE_URL: "https://cyborg.akto.io",
    DATABASE_ABSTRACTOR_SERVICE_TOKEN: "<data-abstractor-token>",
    AKTO_TRAFFIC_QUEUE_THRESHOLD: "100",
    AKTO_INACTIVE_QUEUE_PROCESSING_TIME: "5000",
    AKTO_TRAFFIC_PROCESSING_JOB_INTERVAL: "10",
    AKTO_CONFIG_NAME: "STAGING",
    RUNTIME_MODE: "HYBRID"
  };

  // Optional lifecycle hooks
  override onStart() {
    console.log("Container successfully started");
  }

  override onStop() {
    console.log("Container successfully shut down");
  }

  override onError(error: unknown) {
    console.log("Container error:", error);
  }

}

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
  Bindings: {
    MINI_RUNTIME_SERVICE_CONTAINER: DurableObjectNamespace<MiniRuntimeServiceContainer>;
    MODEL_EXECUTOR: Fetcher;
    DATABASE_ABSTRACTOR_SERVICE_URL: string;
    DATABASE_ABSTRACTOR_SERVICE_TOKEN: string;
    THREAT_BACKEND_URL: string;
    THREAT_BACKEND_TOKEN: string;
  };
}>();


// Home route with available endpoints
app.get("/", (c) => {
  return c.text(
    "Available endpoints:\n" +
      "GET /container/<ID> - Start a container for each ID with a 2m timeout\n" +
      "GET /lb - Load balance requests over multiple containers\n" +
      "GET /error - Start a container that errors (demonstrates error handling)\n" +
      "GET /singleton - Get a single specific container instance",
  );
});

// Route requests to a specific container using the container ID
app.get("/container/:id", async (c) => {
  const id = c.req.param("id");
  const containerId = c.env.MINI_RUNTIME_SERVICE_CONTAINER.idFromName(`/container/${id}`);
  const container = c.env.MINI_RUNTIME_SERVICE_CONTAINER.get(containerId);
  return await container.fetch(c.req.raw);
});

// Demonstrate error handling - this route forces a panic in the container
app.get("/error", async (c) => {
  const container = getContainer(c.env.MINI_RUNTIME_SERVICE_CONTAINER, "error-test");
  return await container.fetch(c.req.raw);
});

// Load balance requests across multiple containers
app.get("/lb", async (c) => {
  const container = await loadBalance(c.env.MINI_RUNTIME_SERVICE_CONTAINER, 3);
  return await container.fetch(c.req.raw);
});

// Main data ingestion endpoint with validation
app.post("/api/ingestData", async (c) => {
  const containerInstance = getRandom(c.env.MINI_RUNTIME_SERVICE_CONTAINER, INSTANCE_COUNT);
  const containerId = c.env.MINI_RUNTIME_SERVICE_CONTAINER.idFromName(`/container/${containerInstance}`);
  const container = c.env.MINI_RUNTIME_SERVICE_CONTAINER.get(containerId);

  // Clone the request first before reading body
  const clonedRequest = c.req.raw.clone();

  // Parse request body
  const requestBody = await c.req.json<any>();
  const batchData: IngestDataBatch[] = requestBody.batchData || [];

  if (!batchData || batchData.length === 0) {
    return c.json({
      success: false,
      result: "ERROR",
      errors: ["No batch data provided. Expected 'batchData' array."],
    });
  }

  // Run validation and container ingestion in parallel
  const dbUrl = c.env.DATABASE_ABSTRACTOR_SERVICE_URL || "https://cyborg.akto.io";
  const dbToken = c.env.DATABASE_ABSTRACTOR_SERVICE_TOKEN || "";
  const tbsToken = c.env.THREAT_BACKEND_TOKEN || "";

  const [results] = await Promise.all([
    // Validation (fetches policies internally)
    handleBatchValidation(batchData, {
      dbUrl,
      dbToken,
      modelExecutorBinding: c.env.MODEL_EXECUTOR,
      tbsToken,
      executionCtx: c.executionCtx,
    }),
    // Container ingestion (runs in parallel)
    container.fetch(clonedRequest),
  ]);

  // Return validation results
  return c.json({
    success: true,
    result: "SUCCESS",
    results,
  });
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ success: true, status: "healthy" });
});

// Validate single request endpoint
app.post("/api/validate/request", async (c) => {
  const { payload } = await c.req.json<{ payload: string }>();

  const dbUrl = c.env.DATABASE_ABSTRACTOR_SERVICE_URL || "https://cyborg.akto.io";
  const dbToken = c.env.DATABASE_ABSTRACTOR_SERVICE_TOKEN || "";

  const [policies, auditPolicies] = await Promise.all([
    fetchGuardrailPolicies(dbUrl, dbToken),
    fetchMcpAuditInfo(dbUrl, dbToken),
  ]);

  const hasAuditRules = Object.keys(auditPolicies).length > 0;
  const tbsToken = c.env.THREAT_BACKEND_TOKEN || "";

  const result = await handleRequestValidation(
    payload,
    {},
    policies,
    auditPolicies,
    hasAuditRules,
    c.env.MODEL_EXECUTOR,
    tbsToken,
    c.executionCtx,
    dbUrl,
    dbToken
  );

  return c.json(result);
});

// Validate single response endpoint
app.post("/api/validate/response", async (c) => {
  const { payload } = await c.req.json<{ payload: string }>();

  const dbUrl = c.env.DATABASE_ABSTRACTOR_SERVICE_URL || "https://cyborg.akto.io";
  const dbToken = c.env.DATABASE_ABSTRACTOR_SERVICE_TOKEN || "";

  const policies = await fetchGuardrailPolicies(dbUrl, dbToken);
  const tbsToken = c.env.THREAT_BACKEND_TOKEN || "";

  const result = await handleResponseValidation(
    payload,
    {},
    policies,
    c.env.MODEL_EXECUTOR,
    tbsToken,
    c.executionCtx,
    dbUrl,
    dbToken
  );

  return c.json(result);
});

export default app;
