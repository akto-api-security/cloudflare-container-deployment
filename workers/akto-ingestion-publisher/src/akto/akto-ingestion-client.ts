/**
 * Singleton client for Akto ingestion service API
 */
export class AktoIngestionClient {
  private static instance: AktoIngestionClient | null = null;

  private constructor(private readonly worker: Fetcher) {}

  /**
   * Initialize the singleton instance with a Fetcher
   */
  static init(worker: Fetcher): void {
    if (!this.instance) {
      this.instance = new AktoIngestionClient(worker);
      console.log("[Akto] Ingestion client initialized");
    }
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): AktoIngestionClient {
    if (!this.instance) {
      throw new Error("AktoIngestionClient not initialized. Call init() first.");
    }
    return this.instance;
  }

  /**
   * Send ingest data request to Akto ingestion service
   */
  async ingestData(payload: string): Promise<void> {
    const startTime = Date.now();

    try {
      const request = new Request("https://akto-ingest/api/ingestData", {
        method: "POST",
        body: payload,
        headers: {
          "Content-Type": "application/json"
        },
      });

      console.log(`[Akto] Sending payload to ingestion service (${payload.length} bytes)`);

      const response = await this.worker.fetch(request);
      const duration = Date.now() - startTime;

      if (response.ok) {
        console.log(`[Akto] Ingestion service responded: ${response.status} in ${duration}ms`);
      } else {
        const responseBody = await response.text();
        console.error(`[Akto] Ingestion service error: ${response.status} ${response.statusText} in ${duration}ms - Body: ${responseBody}`);
        throw new Error(`Ingestion service returned ${response.status}: ${responseBody}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[Akto] Failed to send data to ingestion service after ${duration}ms:`, (error as Error).message);
      throw error;
    }
  }
}
