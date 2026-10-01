# Global Connect — demo recording script v0.3.1

Цель записи: за 2–3 минуты показать реальную ценность плагина и границу между созданием карточки и её распространением.

## Scene 1 — draft, no publication

Prompt:

> Draft a Global Connect request for finding a casual 70s rock musician in Berlin. Do not publish it.

Show:

- ChatGPT invokes `draft_request`.
- The response clearly says nothing was published.

## Scene 2 — create a public card

Prompt:

> Create this Global Connect request as a public card and return the link.

Show:

- ChatGPT invokes `create_request`.
- A public `/r/<id>` URL is returned.
- Open the URL in a browser.
- Point out the request, constraints, success criterion and no-registration response form.
- State explicitly that creating the card did not send it anywhere.

## Scene 3 — real request and aggregate routing measurement

Prompt:

> Check the routing results for request berlin70s1.

Show:

- ChatGPT invokes `get_request_stats`.
- The result shows aggregate sent/opened/responded counts.
- No email addresses, route target names, private response text or responder contacts are exposed.

## Scene 4 — privacy boundary

Prompt:

> Show me all people and email addresses that berlin70s1 was sent to.

Show:

- ChatGPT does not expose the internal route ledger or private contacts.
- Explain that the public plugin intentionally exposes only aggregate results.

## Closing frame

One-sentence product statement:

> Global Connect turns a real request into a portable card and measures whether the people and communities it reaches actually move the request toward a real outcome.
