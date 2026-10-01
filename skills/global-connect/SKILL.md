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
3. Before creating a duplicate, use `list_requests` when an existing request may already represent the same need.
4. Create a card only when the user explicitly wants a new request and `create_request` is available.
5. Return the public request URL after creation.
6. Before an external distribution attempt, register a unique route with `register_route` when that tool is available. Use a non-sensitive target label and do not store private email addresses as route labels.
7. Use the returned tracked URL for that route. Every external route must have its own `source_ref`.
8. Before judging whether routing worked, call `get_request_stats` or `list_routes` and distinguish:
   - routes sent;
   - card opens;
   - responses;
   - "where to look" directions;
   - named-person referrals;
   - direct helpers.
9. Prefer a few highly relevant routes over broad indiscriminate distribution.
10. Never expose private responder contact fields. Use public profiles or consented contact details only.
11. Do not claim a request is solved until its success criterion is actually met.

## Distribution policy

Prioritize places where relevant attention already exists: a recent related discussion, a live local/community board, a specific person with adjacent experience, or an active specialist group. Cold generic company inboxes are a fallback, not the default.

Register the route before sending or posting when possible. `register_route` only records the route and produces a tracked URL; it does not itself contact the external person or community.

## Safety and privacy

Do not create or distribute requests that expose unnecessary personal data. For third-party source requests, preserve a public source URL and state clearly when the requester has agreed to broader sharing. Do not imply that a source author is a Global Connect user unless they actually are.
