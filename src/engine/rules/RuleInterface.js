/**
 * RuleInterface — formal contract for all validation rules.
 *
 * Every built-in or custom rule must conform to this shape.
 * Because the project is currently JavaScript (not TypeScript), this
 * file serves as living documentation and provides a runtime validator
 * (assertValidRule) so user-supplied rules fail early with clear messages.
 *
 * ─────────────────────────────────────────────────────────────
 * Rule shape
 * ─────────────────────────────────────────────────────────────
 * {
 *   id:          string      — unique identifier, e.g. "V25" or "CUSTOM_01"
 *   category:    string      — one of: "GEO" | "CHN" | "BRN" | "DAT" | "AGG" | "SPA" | "SUPPORT"
 *   description: string      — human-readable explanation (shown in Config tooltips)
 *   appliesTo:   string[]    — component types this rule targets, e.g. ["BEND", "PIPE"]
 *                              Use ["*"] to target all types.
 *   tier:        1|2|3|4     — severity if the rule fires
 *                              1=auto-silent, 2=auto-logged, 3=warning, 4=error
 *   execute:     function    — see signature below
 * }
 *
 * execute(element, context, prevElement, elemAxis, elemDir, config, log)
 * ─────────────────────────────────────────────────────────────
 *   element     ComponentRow    — current row being evaluated
 *   context     WalkContext     — accumulated chain state at this element
 *   prevElement ComponentRow|null — previous row in the chain (null if first)
 *   elemAxis    "X"|"Y"|"Z"|null  — dominant axis of this element
 *   elemDir     1|-1|null        — direction along that axis
 *   config      Config           — full app config
 *   log         Logger           — push log entries here
 *
 * The function must NOT mutate element or context.
 * It should call log.push({ type, ruleId, tier, row, message, stage:"VALIDATION" })
 * for each issue found.
 */

/**
 * Validate that a rule object conforms to the RuleInterface.
 * Throws a descriptive Error if the shape is wrong.
 * @param {object} rule
 */
export function assertValidRule(rule) {
  if (!rule || typeof rule !== 'object') throw new Error('Rule must be a plain object.');
  if (typeof rule.id !== 'string' || !rule.id) throw new Error('Rule must have a non-empty string "id".');
  const validCategories = ['GEO', 'CHN', 'BRN', 'DAT', 'AGG', 'SPA', 'SUPPORT'];
  if (!validCategories.includes(rule.category))
    throw new Error(`Rule "${rule.id}": "category" must be one of ${validCategories.join(', ')}.`);
  if (typeof rule.description !== 'string')
    throw new Error(`Rule "${rule.id}": "description" must be a string.`);
  if (!Array.isArray(rule.appliesTo) || rule.appliesTo.length === 0)
    throw new Error(`Rule "${rule.id}": "appliesTo" must be a non-empty array.`);
  if (![1, 2, 3, 4].includes(rule.tier))
    throw new Error(`Rule "${rule.id}": "tier" must be 1, 2, 3, or 4.`);
  if (typeof rule.execute !== 'function')
    throw new Error(`Rule "${rule.id}": "execute" must be a function.`);
}
