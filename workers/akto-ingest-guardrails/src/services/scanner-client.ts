import type {
  ScannerInfo,
  ScanResult,
  ScanResponse,
  SingleScanRequest,
} from "../types/mcp";

// Scanner type constants
export const ScannerType = {
  PROMPT: "prompt",
  OUTPUT: "output",
} as const;

// Filter type constants
export const FilterType = {
  HARMFUL_CATEGORIES: "harmfulCategories",
  PROMPT_ATTACKS: "promptAttacks",
  DENIED_TOPICS: "deniedTopics",
  BAN_TOPICS: "banTopics",
  BAN_SUBSTRINGS: "banSubstrings",
  REGEX: "regex",
  AUDIT: "audit",
  PII: "piiFilter",
  COMPONENT_METADATA: "componentMetadata",
} as const;

// Scanner name mappings
const HarmfulContentScanners = ["Toxicity"];
const PromptInjectionScanners = ["PromptInjection"];
const BanSubstringsScanners = ["BanSubstrings"];
const BanTopicsScanners = ["BanTopics"];

const MAX_REQUEST_BODY_SIZE = 1 * 1024 * 1024; // 1MB
const SCAN_TIMEOUT_MS = 5000; // 5 seconds

export class ScannerClient {
  constructor(private modelExecutorBinding: Fetcher) {}

  /**
   * Get scanner names for a given filter type
   */
  static getScannersForFilterType(filterType: string): string[] {
    switch (filterType) {
      case FilterType.HARMFUL_CATEGORIES:
        return HarmfulContentScanners;
      case FilterType.PROMPT_ATTACKS:
        return PromptInjectionScanners;
      case FilterType.BAN_SUBSTRINGS:
        return BanSubstringsScanners;
      case FilterType.BAN_TOPICS:
        return BanTopicsScanners;
      default:
        return [];
    }
  }

  /**
   * Check if a filter type requires scanner API call
   */
  static isScannerFilterType(filterType: string): boolean {
    const scannerTypes = [
      FilterType.HARMFUL_CATEGORIES,
      FilterType.PROMPT_ATTACKS,
      FilterType.DENIED_TOPICS,
    ];
    return scannerTypes.includes(filterType as any);
  }

  /**
   * Scan text with multiple scanners in parallel
   */
  async scan(text: string, scanners: ScannerInfo[]): Promise<ScanResponse> {
    if (scanners.length === 0) {
      return {
        total_time_ms: 0,
        results: [],
        success_count: 0,
        failure_count: 0,
      };
    }

    const startTime = Date.now();

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      // Run all scanner calls in parallel
      const scanPromises = scanners.map((scanner) =>
        this.callSingleScanAPI(text, scanner, controller.signal)
      );

      const results = await Promise.allSettled(scanPromises);

      // Process results
      const successfulResults: ScanResult[] = [];
      let successCount = 0;
      let failureCount = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          successfulResults.push(result.value);
          if (result.value.is_valid) {
            successCount++;
          } else {
            failureCount++;
          }
        } else {
          console.error("[ScannerClient] Scanner failed:", result.reason);
          failureCount++;
        }
      }

      const totalTime = Date.now() - startTime;

      return {
        total_time_ms: totalTime,
        results: successfulResults,
        success_count: successCount,
        failure_count: failureCount,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Call the /scan API for a single scanner using service binding
   */
  private async callSingleScanAPI(
    text: string,
    scanner: ScannerInfo,
    signal: AbortSignal
  ): Promise<ScanResult> {
    // Validate input size
    if (text.length > MAX_REQUEST_BODY_SIZE) {
      throw new Error(
        `Payload size ${text.length} exceeds maximum ${MAX_REQUEST_BODY_SIZE} bytes`
      );
    }

    const reqBody: SingleScanRequest = {
      text,
      scanner_type: scanner.scanner_type,
      scanner_name: scanner.scanner_name,
      config: scanner.config,
    };

    const startTime = Date.now();

    try {
      // Use service binding to call model executor worker
      const response = await this.modelExecutorBinding.fetch(
        "https://model-executor/scan",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reqBody),
          signal,
        }
      );

      const elapsed = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error(
          `[ScannerClient] /scan API returned status ${response.status}: ${errorText}`
        );
        throw new Error(
          `Scan API returned status ${response.status}: ${errorText}`
        );
      }

      const scanResp: ScanResult = await response.json();

      console.log(
        `[ScannerClient] Scanner API response for ${scanner.scanner_name}: isValid=${scanResp.is_valid}, riskScore=${scanResp.risk_score}, elapsed=${elapsed}ms`
      );

      return scanResp;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(
        `[ScannerClient] Scanner ${scanner.scanner_name} failed after ${elapsed}ms:`,
        error
      );
      throw error;
    }
  }
}
