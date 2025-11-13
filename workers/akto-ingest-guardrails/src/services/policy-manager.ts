import type { Policy, AuditPolicy, GuardrailsPolicy, FilterRule } from "../types/mcp";

/**
 * Convert GuardrailsPolicy to Policy by building filter rules
 */
export function convertGuardrailsToPolicy(gp: GuardrailsPolicy): Policy {
  const requestRules: FilterRule[] = [];
  const responseRules: FilterRule[] = [];

  // 1. Harmful Categories Filtering
  if (gp.contentFiltering?.harmfulCategories) {
    const rule: FilterRule = {
      type: "harmfulCategories",
      action: "block",
    };
    if (gp.applyOnRequest) requestRules.push(rule);
    // Note: Don't add to responseRules - scanner doesn't support "output" type
  }

  // 2. Prompt Attacks
  if (gp.contentFiltering?.promptAttacks) {
    const rule: FilterRule = {
      type: "promptAttacks",
      action: "block",
      config: {
        threshold: 0.5,
      },
    };
    if (gp.applyOnRequest) requestRules.push(rule);
    // Note: Don't add to responseRules - scanner doesn't support "output" type
  }

  // 3. Denied Topics
  if (gp.deniedTopics && gp.deniedTopics.length > 0) {
    const topics: string[] = [];
    const substrings: string[] = [];

    for (const dt of gp.deniedTopics) {
      topics.push(dt.topic);
      substrings.push(...dt.samplePhrases);
    }

    if (topics.length > 0) {
      const topicRule: FilterRule = {
        type: "banTopics",
        action: "block",
        config: { topics },
      };
      if (gp.applyOnRequest) requestRules.push(topicRule);
      if (gp.applyOnResponse) responseRules.push(topicRule);
    }

    if (substrings.length > 0) {
      const substringRule: FilterRule = {
        type: "banSubstrings",
        action: "block",
        config: { substrings },
      };
      if (gp.applyOnRequest) requestRules.push(substringRule);
      if (gp.applyOnResponse) responseRules.push(substringRule);
    }
  }

  // 4. PII Types (matches Go guardrails_converter.go:189-205)
  if (gp.piiTypes && gp.piiTypes.length > 0) {
    for (const piiType of gp.piiTypes) {
      // Determine action based on behavior: "mask" → "redact", otherwise "block"
      const action = piiType.behavior === "mask" ? "redact" : "block";

      const piiRule: FilterRule = {
        type: "pii",
        pattern: piiType.type, // PII type name (e.g., "phone", "email", "password")
        action,
      };

      if (gp.applyOnRequest) requestRules.push(piiRule);
      if (gp.applyOnResponse) responseRules.push(piiRule);
    }
  }

  // 5. Regex Patterns (matches Go guardrails_converter.go:207-217)
  if (gp.regexPatternsV2 && gp.regexPatternsV2.length > 0) {
    for (const regexPattern of gp.regexPatternsV2) {
      // Use provided action or default to "block"
      const action = regexPattern.action || "block";

      const regexRule: FilterRule = {
        type: "regex",
        pattern: regexPattern.pattern,
        action,
      };

      if (gp.applyOnRequest) requestRules.push(regexRule);
      if (gp.applyOnResponse) responseRules.push(regexRule);
    }
  }

  return {
    id: "MCPGuardrails", // Use consistent ID like Go implementation
    name: gp.name || "",
    active: gp.active || false,
    action: "block",
    filters: {
      requestPayload: requestRules,
      responsePayload: responseRules,
    },
  };
}

/**
 * Fetch guardrail policies from database abstractor
 */
export async function fetchGuardrailPolicies(
  baseUrl: string,
  token: string
): Promise<Policy[]> {
  // baseUrl includes /api suffix like Go implementation
  const url = `${baseUrl}/api/fetchGuardrailPolicies`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch guardrail policies: ${response.statusText}`
    );
  }

  const data = (await response.json()) as {
    guardrailPolicies: GuardrailsPolicy[];
  };

  // Convert GuardrailsPolicy to Policy
  const policies: Policy[] = [];
  for (const gp of data.guardrailPolicies || []) {
    if (gp.active) {
      const policy = convertGuardrailsToPolicy(gp);
      console.log(
        `[PolicyManager] Converted policy: ${policy.name}, ` +
        `request rules: ${policy.filters.requestPayload?.length || 0}, ` +
        `response rules: ${policy.filters.responsePayload?.length || 0}`
      );
      policies.push(policy);
    }
  }

  console.log(`[PolicyManager] Fetched ${policies.length} active guardrail policies`);
  return policies;
}

/**
 * Fetch MCP audit info from database abstractor
 */
export async function fetchMcpAuditInfo(
  baseUrl: string,
  token: string
): Promise<Record<string, AuditPolicy>> {
  try {
    // baseUrl includes /api suffix like Go implementation
    const url = `${baseUrl}/api/fetchMcpAuditInfo`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        remarksList: ["Conditionally Approved", "Rejected"],
      }),
    });

    if (!response.ok) {
      console.warn("[PolicyManager] Failed to fetch MCP audit info:", response.statusText);
      return {};
    }

    const data = (await response.json()) as {
      mcpAuditInfoList: AuditPolicy[];
    };

    // Convert array to map keyed by resourceName
    const auditPolicies: Record<string, AuditPolicy> = {};
    for (const policy of data.mcpAuditInfoList || []) {
      if (policy && policy.resourceName) {
        auditPolicies[policy.resourceName] = policy;
      }
    }

    console.log(`[PolicyManager] Fetched ${Object.keys(auditPolicies).length} audit policies`);
    return auditPolicies;
  } catch (error) {
    console.warn("[PolicyManager] Error fetching MCP audit info:", error);
    return {};
  }
}
