import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RE2JS } from 're2js';
import { SCHEMA_DIR } from './validator.mjs';

// Policy patterns (Policy.match.patterns) run against model output, which an
// attacker can influence. Two layers keep them from becoming a ReDoS vector
// (ADR-0010):
//   1. The schema's safeRegex subset rejects constructs that are exponential
//      in a backtracking engine (repeated groups, nested or unbounded repeats,
//      lookaround, backreferences).
//   2. Matching uses RE2 semantics, which is linear in the input. A subset
//      alone is not enough: adjacent bounded repeats such as
//      [^ ]{0,500}[^ ]{0,500}! are still polynomial in a backtracking engine.
//   3. A complexity cap (MAX_PROGRAM_SIZE compiled instructions) bounds the
//      linear constant. RE2 normally matches with a lazy DFA (milliseconds per
//      MB); patterns whose DFA explodes (e.g. [ab]{0,32}a[ab]{31}!) fall back
//      to the NFA, whose cost is proportional to program size.
// Runtimes must use a linear-time engine (this module in Node.js,
// RegexOptions.NonBacktracking in .NET) and apply the same cap.

export const MAX_PROGRAM_SIZE = 128;

const safeRegex = JSON.parse(readFileSync(join(SCHEMA_DIR, 'common.schema.json'), 'utf8')).$defs.safeRegex;
const FORBIDDEN = new RegExp(safeRegex.allOf[0].not.pattern, 'u');

/** True when the pattern is in the portable, ReDoS-safe subset. */
export function isSafePolicyPattern(pattern) {
  return typeof pattern === 'string' && pattern.length >= 1 && pattern.length <= safeRegex.maxLength && !FORBIDDEN.test(pattern);
}

/**
 * Compiles a policy pattern for linear-time matching. Returns
 * { ok: true, test(text) } or { ok: false, reason }. Never throws.
 */
export function compilePolicyPattern(pattern, { caseInsensitive = false } = {}) {
  if (!isSafePolicyPattern(pattern)) return { ok: false, reason: 'pattern is outside the safeRegex subset' };
  try {
    const re = RE2JS.compile(pattern, caseInsensitive ? RE2JS.CASE_INSENSITIVE : 0);
    const size = re.re2Input.prog.numInst();
    if (size > MAX_PROGRAM_SIZE) return { ok: false, reason: `pattern is too complex (${size} instructions; limit ${MAX_PROGRAM_SIZE})` };
    // test() needs no capture positions, so RE2 can use its lazy DFA.
    return { ok: true, size, test: (text) => re.test(text) };
  } catch (e) {
    return { ok: false, reason: `pattern does not compile: ${e?.message ?? e}` };
  }
}
