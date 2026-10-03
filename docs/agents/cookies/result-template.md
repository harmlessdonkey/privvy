---
schemaVersion: 1
checkId: tracking-vs-consent            # copy from the run folder name
scopeId: example.com--uk                # copy from the run folder name
runId: 20261003T073612Z-a1b2c3          # copy from the run folder name
author: cookies-review-agent            # agent name or person
createdAt: "2026-10-03T09:15:00Z"       # UTC, ISO 8601, in quotes
outcome: issues-proposed                # no-issues | issues-proposed | inconclusive
summary: One sentence a person can scan on the dashboard.
items:                                  # use `items: []` when there is nothing to report
  - id: short-stable-slug               # unique within this file
    title: Short description of the finding
    severity: high                      # info | low | medium | high
    evidence:                           # relative to the run's evidence/ folder; must exist
      - pre-interaction/cookies.yml
    detail: Facts first. What was seen, where, set by whom, lifespan, which journey.
plugin:                                 # optional; the cookies plugin uses this shape
  journeys:
    pre-interaction:
      state: analysed                   # analysed | not-implemented | failed | absent
      cookies_total: 0
      storage_entries_total: 0
      third_party_hosts: 0
      classified:                       # counts of cookies and storage entries by category
        necessary: 0
        functional: 0
        analytics: 0
        marketing: 0
        unknown: 0
    reject:
      state: not-implemented
    accept:
      state: not-implemented
  consent_platform:
    detected: false                     # true | false | unknown
    vendor: unknown
  consent_mode_signals: unknown         # present-denied | present-granted | absent | unknown
  integrity_verified: true              # did you recompute the hashes and they matched
---

## Summary

Two or three sentences. State which journeys were analysed and the headline finding. Say plainly if only pre-interaction evidence exists.

## Findings

| Severity | Item | Journey | Evidence |
| --- | --- | --- | --- |
| high | Short description | pre-interaction | `pre-interaction/cookies.yml` |

Add a short paragraph under the table for any finding that needs more explanation.

## Classification

| Name or host | Type | Category | Basis |
| --- | --- | --- | --- |
| example_cookie | cookie, first party, 400 days | functional | Stores locale; set by Set-Cookie header |

## Considered necessary

List the items you judged necessary and why, so a reviewer can disagree.

## Limits of this review

What the evidence cannot show: for example that only the landing page was visited, that the scan ran from a Gibraltar connection, that filter lists are heuristics, or that consent signals were not visible.

## Questions for the reviewer

Open points for the DPO. Questions only; no decisions.
