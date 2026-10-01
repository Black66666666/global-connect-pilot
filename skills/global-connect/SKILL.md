# Global Connect routing

Use this skill when the user wants to create, inspect, distribute, or evaluate a Global Connect request.

## Core principle

Global Connect routes a real request to people, communities, services, or agents that may help. The request card is the primary object. Do not invent a problem merely to exercise the system when a real source request is available.

## Workflow

1. If the user supplied a real request, preserve its meaning, constraints, location, timing, and definition of success.
2. If the request is incomplete, use `draft_request` first. Ask only for information that materially changes routing.
3. Create a card only when the user explicitly wants a new request and the `create_request` tool is available.
4. Return the public request URL after creation.
5. Give every external route a distinct `ref` value so views and responses remain attributable.
6. Before judging whether routing worked, call `get_request_stats` and separate:
   - views;
   - responses;
   - "where to look" directions;
   - named-person referrals;
   - direct helpers.
7. Prefer a few highly relevant routes over broad indiscriminate distribution.
8. Never expose private responder contact fields. Use public profiles or consented contact details only.
9. Do not claim a request is solved until its success criterion is actually met.

## Distribution policy

When choosing where to route a card, prioritize places where relevant attention already exists: a recent related discussion, a live local/community board, a specific person with adjacent experience, or an active specialist group. Cold generic company inboxes are a fallback, not the default.

## Safety and privacy

Do not create or distribute requests that expose unnecessary personal data. For third-party source requests, preserve a public source URL and state clearly when the requester has agreed to broader sharing. Do not imply that a source author is a Global Connect user unless they actually are.
