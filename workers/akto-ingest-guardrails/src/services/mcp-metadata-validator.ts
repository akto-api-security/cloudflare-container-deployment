import type { ValidationContext, ValidationResult } from "../types/mcp";
import { reportThreat } from "./threat-reporter";

/**
 * MCP method constants
 */
const MCP_LIST_TOOLS = "tools/list";
const MCP_LIST_PROMPTS = "prompts/list";
const MCP_LIST_RESOURCES = "resources/list";

/**
 * Cyborg LLM API path (appended to database abstractor URL)
 */
const LLM_VALIDATOR_API_PATH = "/api/getLLMResponseV2";

/**
 * LLM validation response from Cyborg API
 */
interface LLMValidationResponse {
  isMalicious: boolean;
  maliciousMatchScore: number;
  toolNameDescriptionMatchScore: number;
  reason: string;
}

/**
 * Tool metadata validation prompt template
 */
const TOOL_METADATA_VALIDATION_PROMPT = `You are a security analyst tasked with analyzing MCP (Model Context Protocol) component metadata for potential security risks.

Analyze the following MCP component:
- Name: %s
- Description: %s
- Input Schema: %s

Evaluate this component based on the following criteria:

1. **Malicious Intent Score (maliciousMatchScore)**: Does the component's name and description suggest potentially harmful, malicious, or dangerous capabilities? Score from 0.0 (clearly benign) to 1.0 (clearly malicious).

2. **Name-Description Match Score (toolNameDescriptionMatchScore)**: How well does the component's description align with its name? Score from 0.0 (completely mismatched/misleading) to 1.0 (perfectly aligned).

3. **Overall Assessment (isMalicious)**: Based on the above scores, is this component potentially malicious or suspicious?

4. **Reason**: Provide a brief explanation of your assessment.

**Examples of concerning patterns:**
- Name suggests one functionality but description indicates something else (e.g., "get_weather" but description talks about executing system commands)
- Descriptions that mention file system access, network operations, or system commands when the name doesn't clearly indicate this
- Vague or misleading descriptions
- Names that hide potentially dangerous operations

Respond ONLY with a valid JSON object in this exact format (no additional text):
{
  "isMalicious": true/false,
  "maliciousMatchScore": 0.0-1.0,
  "toolNameDescriptionMatchScore": 0.0-1.0,
  "reason": "brief explanation"
}`;

/**
 * Extract method from MCP request payload
 */
function extractMethodFromRequest(requestPayload: string): string | null {
  try {
    const request = JSON.parse(requestPayload);
    return request.method || null;
  } catch {
    return null;
  }
}

/**
 * Check if method is a list method
 */
function isListMethod(method: string | null): boolean {
  return method === MCP_LIST_TOOLS; // Only tools/list for now
  // Could extend to: || method === MCP_LIST_PROMPTS || method === MCP_LIST_RESOURCES
}

/**
 * Extract input schema from tool metadata
 * Format: propName=<prop description> | propName2=<description>
 */
function extractInputSchema(tool: Record<string, any>): string {
  const inputSchema = tool.inputSchema as Record<string, any> | undefined;
  if (!inputSchema) return "(none)";

  const properties = inputSchema.properties as Record<string, any> | undefined;
  if (!properties || Object.keys(properties).length === 0) return "(none)";

  const schemaParts: string[] = [];
  extractProperties(properties, "", schemaParts, 0);

  return schemaParts.length > 0 ? schemaParts.join(" | ") : "(none)";
}

/**
 * Recursively extract properties from schema
 */
function extractProperties(
  properties: Record<string, any>,
  prefix: string,
  schemaParts: string[],
  depth: number
): void {
  const MAX_DEPTH = 5;
  if (depth >= MAX_DEPTH) return;

  for (const [propName, propValue] of Object.entries(properties)) {
    const propMap = propValue as Record<string, any>;
    if (typeof propMap !== "object" || propMap === null) continue;

    const fullName = prefix ? `${prefix}.${propName}` : propName;
    const description = (propMap.description as string) || "No description";

    schemaParts.push(`${fullName}=${description}`);

    const propType = propMap.type as string | undefined;
    if (propType === "object" && propMap.properties) {
      extractProperties(propMap.properties, fullName, schemaParts, depth + 1);
    } else if (propType === "array" && propMap.items?.properties) {
      extractProperties(
        propMap.items.properties,
        `${fullName}[]`,
        schemaParts,
        depth + 1
      );
    }
  }
}

/**
 * Clean JSON from LLM response (remove markdown code blocks)
 */
function cleanJSON(content: string): string {
  let cleaned = content.trim();

  // Truncate at the last closing brace to remove any trailing notes
  const lastBrace = cleaned.lastIndexOf("}");
  if (lastBrace !== -1) {
    cleaned = cleaned.substring(0, lastBrace + 1);
  }

  // Start at the first opening brace to remove any forward notes
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace !== -1) {
    cleaned = cleaned.substring(firstBrace);
  }

  return cleaned.trim();
}

/**
 * Call Cyborg LLM API for validation
 * URL is constructed as: databaseAbstractorUrl + LLM_VALIDATOR_API_PATH
 */
async function callLLM(
  databaseAbstractorUrl: string,
  aktoApiToken: string,
  prompt: string
): Promise<string> {
  const requestPayload = {
    temperature: 0.1,
    top_p: 0.9,
    max_tokens: 10000,
    frequency_penalty: 0,
    presence_penalty: 0.6,
    messages: [
      {
        role: "system",
        content: prompt,
      },
    ],
  };

  // Wrap with llmPayload key as required by API
  const wrappedPayload = {
    llmPayload: requestPayload,
  };

  const apiUrl = databaseAbstractorUrl + LLM_VALIDATOR_API_PATH;

  console.log(`[LLM] Calling API: ${apiUrl}`);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": aktoApiToken,
    },
    body: JSON.stringify(wrappedPayload),
  });

  console.log(`[LLM] Response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    console.error(`[LLM] API call failed: ${response.status} ${response.statusText} - ${errorText}`);
    throw new Error(`LLM API call failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  console.log(`[LLM] Response received, parsing...`);

  // Parse Azure OpenAI response format
  const content = data.choices?.[0]?.message?.content as string | undefined;
  if (!content) {
    console.error(`[LLM] No content in response:`, JSON.stringify(data));
    throw new Error("No content in LLM response");
  }

  console.log(`[LLM] Successfully extracted content (${content.length} chars)`);
  return content;
}

/**
 * MCP Metadata Validator
 * Validates tool/prompt/resource metadata using LLM
 */
export class McpMetadataValidator {
  private databaseAbstractorUrl: string;
  private aktoApiToken: string;

  constructor(databaseAbstractorUrl: string, aktoApiToken: string) {
    this.databaseAbstractorUrl = databaseAbstractorUrl;
    this.aktoApiToken = aktoApiToken;
  }

  /**
   * Validate MCP metadata asynchronously (non-blocking)
   * This is called from the policy validator when processing responses
   * Returns a promise that should be passed to ctx.waitUntil() to ensure it completes
   */
  validateMcpMetadataAsync(valCtx: ValidationContext): Promise<void> | null {
    const method = extractMethodFromRequest(valCtx.requestPayload || "");

    if (!isListMethod(method)) {
      return null; // Not a list method, skip validation
    }

    // Return the promise so it can be passed to ctx.waitUntil()
    return this.validateToolsAsync(valCtx).catch((error) => {
      console.error("[McpMetadataValidator] Async validation failed:", error);
    });
  }

  /**
   * Validate tools asynchronously
   */
  private async validateToolsAsync(valCtx: ValidationContext): Promise<void> {
    const startTime = Date.now();

    try {
      const responseData = JSON.parse(valCtx.responsePayload || "{}");
      const result = responseData.result as Record<string, any> | undefined;

      if (!result) {
        console.error("[McpMetadataValidator] No result field in response");
        return;
      }

      const tools = result.tools as any[] | undefined;
      if (!tools || tools.length === 0) {
        console.log("[McpMetadataValidator] No tools to validate");
        return;
      }

      console.log(`[McpMetadataValidator] Starting validation of ${tools.length} tools`);

      // Validate up to 5 tools in parallel
      const MAX_CONCURRENT = 5;
      const validationPromises: Promise<void>[] = [];

      for (const tool of tools) {
        if (validationPromises.length >= MAX_CONCURRENT) {
          // Wait for one to complete before starting next
          await Promise.race(validationPromises);
        }

        const promise = this.validateTool(tool, valCtx).finally(() => {
          const index = validationPromises.indexOf(promise);
          if (index > -1) {
            validationPromises.splice(index, 1);
          }
        });

        validationPromises.push(promise);
      }

      // Wait for all remaining validations
      await Promise.all(validationPromises);

      const elapsed = Date.now() - startTime;
      console.log(`[McpMetadataValidator] Validation completed in ${elapsed}ms`);
    } catch (error) {
      console.error("[McpMetadataValidator] Validation error:", error);
    }
  }

  /**
   * Validate a single tool
   */
  private async validateTool(
    tool: Record<string, any>,
    valCtx: ValidationContext
  ): Promise<void> {
    const toolName = tool.name as string | undefined;
    if (!toolName) return;

    const toolDescription = (tool.description as string) || "";
    const toolInputSchema = extractInputSchema(tool);

    try {
      const validationResp = await this.validateMCPComponent(
        toolName,
        toolDescription,
        toolInputSchema
      );

      console.log(
        `[McpMetadataValidator] Tool validation result: ${toolName}`,
        `malicious=${validationResp.isMalicious}`,
        `matchScore=${validationResp.toolNameDescriptionMatchScore}`
      );

      // Report threat if malicious score is high or match score is low
      if (
        validationResp.maliciousMatchScore > 0.75 ||
        validationResp.toolNameDescriptionMatchScore < 0.7
      ) {
        await this.reportToolThreat(tool, validationResp, valCtx);
      }
    } catch (error) {
      console.error(`[McpMetadataValidator] Failed to validate tool ${toolName}:`, error);
    }
  }

  /**
   * Validate MCP component using LLM
   */
  private async validateMCPComponent(
    name: string,
    description: string,
    inputSchema: string
  ): Promise<LLMValidationResponse> {
    const prompt = TOOL_METADATA_VALIDATION_PROMPT
      .replace("%s", name)
      .replace("%s", description)
      .replace("%s", inputSchema);

    const content = await callLLM(this.databaseAbstractorUrl, this.aktoApiToken, prompt);
    const cleanedContent = cleanJSON(content);

    const validationResp = JSON.parse(cleanedContent) as LLMValidationResponse;
    return validationResp;
  }

  /**
   * Report tool threat to Akto dashboard using existing threat reporter
   */
  private async reportToolThreat(
    toolData: Record<string, any>,
    validationResp: LLMValidationResponse,
    valCtx: ValidationContext
  ): Promise<void> {
    // Create filtered response with only the malicious tool
    const filteredResponse = {
      result: {
        tools: [toolData],
      },
    };

    const toolName = toolData.name as string;
    const customEndpoint = `${valCtx.endpoint}/tools/list/${toolName}`;

    console.log(
      `[McpMetadataValidator] Reporting threat for tool: ${toolName}`,
      `maliciousScore=${validationResp.maliciousMatchScore}`,
      `matchScore=${validationResp.toolNameDescriptionMatchScore}`
    );

    // Create validation result for threat reporter
    const validationResult: ValidationResult = {
      allowed: false,
      modified: false,
      reason: `Malicious MCP component detected: ${validationResp.reason}`,
      metadata: {
        policy_id: "MCPMaliciousComponent",
        validation: validationResp,
      },
    };

    // Create modified validation context with filtered response and custom endpoint
    const modifiedValCtx: ValidationContext = {
      ...valCtx,
      endpoint: customEndpoint,
      responsePayload: JSON.stringify(filteredResponse),
    };

    // Use existing threat reporter
    await reportThreat(validationResult, modifiedValCtx, this.aktoApiToken);
  }
}
