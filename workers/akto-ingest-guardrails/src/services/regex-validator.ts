import type { ValidationResult, Policy, FilterRule } from "../types/mcp";

/**
 * Validator for regex pattern rules
 */
export class RegexValidator {
  /**
   * Validate text against regex pattern rule
   */
  validate(
    text: string,
    rule: FilterRule,
    policy: Policy
  ): ValidationResult {
    if (!rule.pattern) {
      return { allowed: true, modified: false };
    }

    try {
      const regex = new RegExp(rule.pattern, "i"); // Case-insensitive by default
      const match = regex.test(text);

      if (match) {
        const action = rule.action || "block";

        if (action === "block") {
          console.log(`[RegexValidator] Pattern matched (blocking): ${rule.pattern}`);
          return {
            allowed: false,
            modified: false,
            reason: `Blocked by regex pattern: ${rule.pattern}`,
            metadata: {
              policy_id: policy.id,
              rule_type: "regex",
              pattern: rule.pattern,
            },
          };
        } else if (action === "redact") {
          // Redact matched content
          const redactedText = text.replace(regex, "[REDACTED]");
          console.log(`[RegexValidator] Pattern matched (redacting): ${rule.pattern}`);
          return {
            allowed: true,
            modified: true,
            modifiedPayload: redactedText,
          };
        }
      }

      return { allowed: true, modified: false };
    } catch (error) {
      console.error(`[RegexValidator] Invalid regex pattern: ${rule.pattern}`, error);
      return { allowed: true, modified: false };
    }
  }
}
