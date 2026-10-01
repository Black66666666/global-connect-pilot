---
name: global-connect-routing
description: Create, inspect, distribute, and evaluate a real Global Connect request through measurable human or community routes.
---

# Global Connect routing

Use this skill when the user wants to create, inspect, distribute, or evaluate a Global Connect request.

## Core principle

Global Connect routes a real request to people, communities, services, or agents that may help. The request card is the primary object. Do not invent a problem merely to exercise the system when a real source request is available.

## Workflow

1. If the user supplied a real request, preserve its meaning, constraints, location, timing, and definition of success.
2. If the request is incomplete, use `draft_request` first. Ask only for information that materially changes routing.
3. Before creating a duplicate, use `list_requests` only when that authorized operator tool is available. Anonymous users cannot enumerate all requests.
4. Create a card only when the user explicitly wants a new request or asks to publish it.
5. Return the public request URL after creation and state that creating a card does not distribute it.
6. Before an external distribution attempt, register a unique route with `register_route` when that authorized operator tool is available. Use a non-sensitive target label and never store private email addresses as route labels.
7. Use the returned tracked URL for that route. Every external route must have its own `source_ref`.
8. Before judging whether routing worked, call `get_request_stats` and, when authorized, `list_routes`. Distinguish routes sent, opens, responses, directions, named-person referrals and direct helpers.
9. When an authorized operator needs to act on a response, use `get_responses`. Contact fields are private and should be requested only when actually needed.
10. Prefer a few highly relevant routes over broad indiscriminate distribution.
11. Never expose private responder contact fields to an anonymous/public user. Use public profiles or consented contact details only.
12. Do not claim a request is solved merely because somebody clicked “I can help”. Confirm the real-world success criterion first.
13. When the real-world result becomes known and `record_outcome` is available, record `succeeded`, `failed`, `expired`, or keep `pending`, with a concise operator note. Public users may see only the outcome state, never the private note.

## Distribution policy

Prioritize places where relevant attention already exists: a recent related discussion, a live local/community board, a specific person with adjacent experience, or an active specialist group. Cold generic company inboxes are a fallback, not the default.

Register the route before sending or posting when possible. `register_route` only records the route and produces a tracked URL; it does not itself contact the external person or community.

## Safety and privacy

Do not create or distribute requests that expose unnecessary personal data. For third-party source requests, preserve a public source URL and state clearly when the requester has agreed to broader sharing. Do not imply that a source author is a Global Connect user unless they actually are.

The public plugin deliberately cannot enumerate all requests, inspect individual route targets, read response notes, read contact fields, or read private outcome notes. Those are operator-only capabilities.
