import assert from "node:assert/strict";
import { test } from "node:test";
import { parseResult } from "../src/core/results.js";

const expect = { checkId: "c1", scopeId: "s1", runId: "20261003T073612Z-abcdef" };
const good = `---
schemaVersion: 1
checkId: c1
scopeId: s1
runId: 20261003T073612Z-abcdef
author: agent
createdAt: "2026-10-03T09:15:00Z"
outcome: issues-proposed
summary: Analytics cookie set before interaction
items:
  - id: ga-before-consent
    title: _ga set pre-interaction
    severity: high
    evidence: [pre-interaction/inspection.json]
---
Details here.
`;

test("a valid result parses", () => {
  const r = parseResult("a.md", good, expect);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.frontMatter.items[0]?.severity, "high");
    assert.equal(r.body.trim(), "Details here.");
  }
});

test("missing front matter, bad fields and misfiled results are flagged, not hidden", () => {
  assert.equal(parseResult("a.md", "just text", expect).ok, false);
  assert.equal(parseResult("a.md", good.replace("high", "catastrophic"), expect).ok, false);
  const misfiled = parseResult("a.md", good.replace("scopeId: s1", "scopeId: other"), expect);
  assert.equal(misfiled.ok, false);
  if (!misfiled.ok) assert.match(misfiled.error, /does not match/);
});
