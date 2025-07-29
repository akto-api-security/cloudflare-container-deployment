import { Container, loadBalance, getContainer, getRandom } from "@cloudflare/containers";
import { Hono } from "hono";

const INSTANCE_COUNT = 3;

export class MyContainer extends Container {
  // Port the container listens on (default: 8080)
  defaultPort = 8080;
  // Time before container sleeps due to inactivity (default: 30s)
  
  // Environment variables passed to the container
  envVars = {
    MESSAGE: "I was passed in via the container class!",
    AKTO_LOG_LEVEL: "DEBUG",
    DATABASE_ABSTRACTOR_SERVICE_TOKEN: "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJBa3RvIiwic3ViIjoiaW52aXRlX3VzZXIiLCJhY2NvdW50SWQiOjE3NDg4MDU3NTQsImlhdCI6MTc1MjQ5NzA4NiwiZXhwIjoxNzY4Mzk0Njg2fQ.Z8tu1eOv9LQVpiMQp6L_P-VIyNtODAJIUtNWNOidwZ-AFcj1SBtJTc0G05UAoVxOCE1MsZQwOpbLB3Ci_b7S7OYco40opx3GumKLmOcTChplvGR8tMOEjut7B-j--y99r9g0i0UhCiuk64yDmVjBcLKRiX_0J9GBgMcy14lkFeIQQ5o6FnAXxQd27agireZPR6qQb0PZku5V_b-5E9Am65cLwmUmqyRzSshn1aL1RgXUb1Fo93x-XLtyn4UpYgSvCZEAyhzKMRc9HDH4UvW8Z44ctm25rGb8OAklTrhwfsoNQZoDPgoiffayCBFzEt1x9wmzCy3U0zFNZdiZgGyOPw",
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
  Bindings: { MY_CONTAINER: DurableObjectNamespace<MyContainer> };
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
  const containerId = c.env.MY_CONTAINER.idFromName(`/container/${id}`);
  const container = c.env.MY_CONTAINER.get(containerId);
  return await container.fetch(c.req.raw);
});

// Demonstrate error handling - this route forces a panic in the container
app.get("/error", async (c) => {
  const container = getContainer(c.env.MY_CONTAINER, "error-test");
  return await container.fetch(c.req.raw);
});

// Load balance requests across multiple containers
app.get("/lb", async (c) => {
  const container = await loadBalance(c.env.MY_CONTAINER, 3);
  return await container.fetch(c.req.raw);
});

// Get a single container instance (singleton pattern)
app.post("/api/ingestData", async (c) => {

  //const id = 1;
  const containerInstance = getRandom(c.env.MY_CONTAINER, INSTANCE_COUNT);
  const containerId = c.env.MY_CONTAINER.idFromName(`/container/${containerInstance}`);
  const container = c.env.MY_CONTAINER.get(containerId);

  
  return await container.fetch(c.req.raw);

});


export default app;
