import { randomBytes } from "node:crypto";
import { SEGMENT } from "./types.js";

export function assertSegment(value: string, what: string): void {
  if (!SEGMENT.test(value)) {
    throw new Error(`Invalid ${what} "${value}": use lowercase letters, digits, . _ - (max 100, must start with a letter or digit)`);
  }
}

/** UTC, sortable, no colons (safe on SMB shares and Windows): 20261003T073612Z-a1b2c3 */
export function newRunId(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${p(now.getUTCFullYear(), 4)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export const RUN_ID = /^(\d{4})(\d{2})(\d{2})T\d{6}Z-[0-9a-f]{6}$/;

export function parseRunDate(runId: string): { yyyy: string; mm: string; dd: string } {
  const m = RUN_ID.exec(runId);
  if (!m) throw new Error(`Invalid run id "${runId}"`);
  return { yyyy: m[1]!, mm: m[2]!, dd: m[3]! };
}
