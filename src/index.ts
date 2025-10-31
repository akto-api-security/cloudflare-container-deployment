import { Container, loadBalance, getContainer, getRandom } from "@cloudflare/containers";
import { Hono } from "hono";

const INSTANCE_COUNT = 3;

export class MiniRuntimeServiceContainer extends Container {
  // Port the container listens on (default: 8080)
  defaultPort = 8080;
  // Time before container sleeps due to inactivity (default: 30s)

  // Environment variables passed to the container
  envVars = {
    MESSAGE: "I was passed in via the container class!",
    AKTO_LOG_LEVEL: "DEBUG",
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

export class McpGuardrailsContainer extends Container {
  defaultPort = 8081;

  envVars = {
    SERVER_PORT: "8081",
    DATABASE_ABSTRACTOR_SERVICE_URL: "https://cyborg.akto.io",
    DATABASE_ABSTRACTOR_SERVICE_TOKEN: "<akto-api-token>",
    AGENT_GUARD_ENGINE_URL: "https://akto-agent-guard-engine.billing-53a.workers.dev",
    THREAT_BACKEND_URL: "https://tbs.akto.io",
    THREAT_BACKEND_TOKEN: "<akto-api-token>",
    LOG_LEVEL: "info",
    GIN_MODE: "release"
  };
}

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
  Bindings: {
    MINI_RUNTIME_SERVICE_CONTAINER: DurableObjectNamespace<MiniRuntimeServiceContainer>;
    MCP_GUARDRAILS_CONTAINER: DurableObjectNamespace<McpGuardrailsContainer>;
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

// Get a single container instance (singleton pattern)
app.post("/api/ingestData", async (c) => {

  //const id = 1;
  const containerInstance = getRandom(c.env.MINI_RUNTIME_SERVICE_CONTAINER, INSTANCE_COUNT);
  const containerId = c.env.MINI_RUNTIME_SERVICE_CONTAINER.idFromName(`/container/${containerInstance}`);
  const container = c.env.MINI_RUNTIME_SERVICE_CONTAINER.get(containerId);

  // Get MCP Guardrails container instance
  const mcpGuardrailsInstance = getRandom(c.env.MCP_GUARDRAILS_CONTAINER, INSTANCE_COUNT);
  const mcpGuardrailsContainerId = c.env.MCP_GUARDRAILS_CONTAINER.idFromName(`/container/${mcpGuardrailsInstance}`);
  const mcpGuardrailsContainer = c.env.MCP_GUARDRAILS_CONTAINER.get(mcpGuardrailsContainerId);

  // Send requests to both containers in parallel
  const [mainResponse] = await Promise.all([
    container.fetch(c.req.raw.clone()),
    mcpGuardrailsContainer.fetch(c.req.raw.clone())
  ]);

  return mainResponse;

});


export default app;
