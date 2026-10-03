---
schemaVersion: 1
checkId: tracking-vs-consent
scopeId: example.com--uk
runId: 20261003T085743Z-d8175f
author: cookies-review-agent
createdAt: "2026-10-03T09:15:00Z"
outcome: issues-proposed
summary: EXAMPLE ONLY, fictional data. An analytics cookie and a marketing script appear before any banner interaction.
items:
  - id: analytics-cookie-before-consent
    title: Analytics cookies set before interaction
    severity: high
    evidence:
      - pre-interaction/cookies.yml
      - pre-interaction/beacons.yml
    detail: Two cookies named _ga and _ga_ABC123 on example.com, 400 days, set by a script from the tag manager container during the first page load, before any banner interaction. A request to the analytics collection endpoint carries a client identifier.
  - id: marketing-pixel-requested
    title: Advertising pixel requested before interaction
    severity: high
    evidence:
      - pre-interaction/beacons.yml
      - pre-interaction/requests.har
    detail: Third-party request to an advertising pixel host, matched by the easyprivacy list, with an identifier in the query string. Seen twice on the landing page.
  - id: tag-manager-container
    title: Tag manager container loads on first paint
    severity: medium
    evidence:
      - pre-interaction/requests.har
    detail: The container loads before interaction and appears to load the two items above. No Consent Mode parameters were visible on the Google requests, so whether the tags treated consent as denied is unknown.
  - id: consent-platform-detected
    title: Consent platform present
    severity: info
    evidence:
      - pre-interaction/screenshot-top.png
      - pre-interaction/beacons.yml
    detail: A consent banner is visible in the top screenshot and the platform's own geolocation request appears in beacons.yml. Treated as necessary.
plugin:
  journeys:
    pre-interaction:
      state: analysed
      cookies_total: 7
      storage_entries_total: 3
      pages_visited: 3
      third_party_hosts: 9
      classified:
        necessary: 4
        functional: 1
        analytics: 3
        marketing: 2
        unknown: 0
    reject:
      state: not-implemented
    accept:
      state: not-implemented
  consent_platform:
    detected: true
    vendor: unknown
  consent_mode_signals: unknown
  integrity_verified: true
---

## Summary

EXAMPLE ONLY. Only the pre-interaction journey was collected, so there is no comparison with reject or accept. Before the banner was touched, analytics cookies were set and an advertising pixel was requested.

## Findings

| Severity | Item | Journey | Evidence |
| --- | --- | --- | --- |
| high | Analytics cookies set before interaction | pre-interaction | `pre-interaction/cookies.yml` |
| high | Advertising pixel requested before interaction | pre-interaction | `pre-interaction/beacons.yml` |
| medium | Tag manager container loads on first paint | pre-interaction | `pre-interaction/requests.har` |

## Considered necessary

Four cookies were judged necessary: the consent platform's own cookies and a session cookie needed to serve the page.

## Limits of this review

Landing page only. The scan ran from a Gibraltar connection, so it shows what a visitor there sees. Filter-list matches are heuristics. Consent Mode signals were not visible.

## Questions for the reviewer

Is the tag manager configured to wait for consent before firing analytics and advertising tags?
