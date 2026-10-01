# Global Connect v0.3.1 — release notes

## What this version does

Global Connect turns a real-world request into a public-link card and records aggregate routing outcomes without requiring the recipient to create an account.

Public plugin capabilities:

- draft a request without publishing;
- create a public request card;
- retrieve a known request by ID;
- retrieve aggregate sent/opened/responded/action statistics for a known request.

Authorized operator capabilities additionally include:

- list requests;
- inspect the internal per-route ledger;
- register a distribution route and generate a tracked `ref` link.

## Privacy and security changes

- Anonymous users cannot enumerate all requests.
- Anonymous users cannot inspect route targets.
- Public MCP statistics never return responder text or contact fields.
- Distribution routes store non-sensitive labels rather than recipient email addresses.
- Public card creation is globally rate-limited per hour.
- Creating a card has no external communication side effect: it does not email, message or post anywhere.

## Pilot measurement changes

The routing ledger now separates:

`registered/sent → opened → responded → response type`

This allows Global Connect to measure zero-response routes rather than recording only users who opened a card.

The existing `berlin70s1` pilot is seeded with six real targeted email routes so its baseline can be measured consistently.

## Infrastructure

- Cloudflare Workers + D1.
- MCP Streamable HTTP endpoint at `/mcp`.
- Public `/plugin`, `/privacy`, `/terms`, `/support` pages.
- Domain-verification endpoint prepared at `/.well-known/openai-apps-challenge`.
- GitHub CI performs a Cloudflare dry-run build and then waits for the deployed version before running a live public MCP smoke test.
