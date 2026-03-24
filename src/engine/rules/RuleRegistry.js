/**
 * RuleRegistry
 *
 * Central store for all validation rules. Built-in rules are registered
 * automatically on import. User-defined rules can be added at runtime via
 * registerRule() — no recompile needed.
 *
 * The registry is consumed by RuleRunner.runElementRules() so that every
 * call site automatically picks up custom rules alongside the built-ins.
 *
 * Usage (custom rule example):
 *
 *   import { registerRule } from './rules/RuleRegistry.js';
 *
 *   registerRule({
 *     id: 'CUSTOM_01',
 *     category: 'DAT',
 *     description: 'Flag components with a bore > 600mm (non-standard for this project)',
 *     appliesTo: ['PIPE', 'BEND', 'FLANGE'],
 *     tier: 3,
 *     execute(element, _ctx, _prev, _axis, _dir, _cfg, log) {
 *       if (element.bore > 600) {
 *         log.push({
 *           stage: 'VALIDATION',
 *           type: 'Warning',
 *           ruleId: 'CUSTOM_01',
 *           tier: 3,
 *           row: element._rowIndex,
 *           message: `WARNING [CUSTOM_01] Bore ${element.bore}mm exceeds project limit of 600mm.`,
 *         });
 *       }
 *     },
 *   });
 */

import { assertValidRule } from './RuleInterface.js';

// The registry: Map<id, Rule>
const _registry = new Map();

/**
 * Register a rule. Overwrites any existing rule with the same id.
 * Throws if the rule does not conform to RuleInterface.
 * @param {object} rule
 */
export function registerRule(rule) {
  assertValidRule(rule);
  _registry.set(rule.id, rule);
}

/**
 * Unregister a rule by id. No-op if the rule is not registered.
 * Useful for disabling individual built-in rules at runtime.
 * @param {string} id
 */
export function unregisterRule(id) {
  _registry.delete(id);
}

/**
 * Get all registered rules, optionally filtered by category.
 * @param {string|null} category
 * @returns {object[]}
 */
export function getRules(category = null) {
  const all = Array.from(_registry.values());
  return category ? all.filter(r => r.category === category) : all;
}

/**
 * Run all registered rules that apply to a given element.
 * This is called by RuleRunner after the built-in category runners.
 *
 * @param {object} element
 * @param {object} context
 * @param {object|null} prevElement
 * @param {string|null} elemAxis
 * @param {number|null} elemDir
 * @param {object} config
 * @param {object} log  — Logger instance (has .push method)
 */
export function runRegisteredRules(element, context, prevElement, elemAxis, elemDir, config, log) {
  const type = (element.type || '').toUpperCase();
  for (const rule of _registry.values()) {
    // Only run if the rule targets this component type or '*'
    if (!rule.appliesTo.includes('*') && !rule.appliesTo.includes(type)) continue;
    // Skip if the rule's check-id is explicitly disabled in config
    if (config?.enabledChecks && config.enabledChecks[rule.id] === false) continue;
    try {
      rule.execute(element, context, prevElement, elemAxis, elemDir, config, log);
    } catch (err) {
      log.push({
        stage: 'VALIDATION',
        type: 'Error',
        ruleId: rule.id,
        tier: 4,
        row: element._rowIndex,
        message: `[${rule.id}] Rule threw an exception: ${err?.message || String(err)}`,
      });
    }
  }
}
