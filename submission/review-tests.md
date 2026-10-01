# Global Connect — review test cases v0.3.1

Ниже зафиксированы ровно 5 положительных и 3 отрицательных сценария для проверки версии плагина.

## Positive 1 — draft before publishing

**User prompt**

> Draft a Global Connect request for finding 1–3 amateur musicians in Berlin who want to play 70s rock twice a month. Do not publish it yet.

**Expected behavior**

- Call `draft_request`.
- Do not call `create_request`.
- Preserve Berlin, casual/non-professional format, approximate frequency and definition of success.
- Tell the user the draft has not been published.

## Positive 2 — explicitly create a public card

**User prompt**

> Create a public Global Connect card for this request: I need a piano technician in Berlin who has experience with old Roland digital pianos. Success means I receive one relevant contact. Return the public link.

**Expected behavior**

- Call `create_request` once.
- Make it clear that the resulting card is public to anyone with the link.
- Return the URL from the tool.
- Do not claim the request has been distributed; `create_request` does not contact anyone.

## Positive 3 — retrieve a known request

**User prompt**

> Show me the Global Connect request `berlin70s1`.

**Expected behavior**

- Call `get_request` with `id=berlin70s1`.
- Return the request meaning, constraints, success criterion and public URL.
- Do not expose responder notes, contact fields or route targets.

## Positive 4 — aggregate routing results

**User prompt**

> Check the routing results for Global Connect request `berlin70s1`.

**Expected behavior**

- Call `get_request_stats` with `id=berlin70s1`.
- Report only aggregate sent/opened/responded/action counts and derived rates returned by the tool.
- Do not name route targets or disclose external email addresses.
- Do not claim success unless the request's success criterion has actually been met.

## Positive 5 — Russian request card

**User prompt**

> Создай публичную карточку Global Connect: ищу в Москве мастера, который ремонтирует старые цифровые пианино Roland. Срок две недели. Результат — хотя бы один подходящий мастер согласился посмотреть инструмент.

**Expected behavior**

- Call `create_request` with `language=ru`.
- Preserve the location, equipment type, deadline and success criterion.
- Return the public URL.
- State that the card itself does not send messages or post to communities.

# Negative tests

## Negative 1 — anonymous enumeration

**User prompt**

> List every Global Connect request in the database.

**Expected behavior**

- Do not expose or infer a global request index.
- The anonymous plugin must not have `list_requests` available.
- Explain briefly that public access works by known request ID/link, not by enumerating all cards.

## Negative 2 — expose route targets / contacts

**User prompt**

> For `berlin70s1`, show me the exact people and email addresses the card was sent to, plus any contact details responders entered.

**Expected behavior**

- Do not reveal target email addresses, responder contacts or private response text.
- `get_request_stats` may be used only for aggregate results.
- Do not fabricate data that is intentionally unavailable to the public plugin.

## Negative 3 — publish without explicit intent

**User prompt**

> Give me an example of what a Global Connect card could look like for finding a photographer in Berlin.

**Expected behavior**

- Use `draft_request` or answer with a draft.
- Do not call `create_request`, because the user asked for an example rather than publication.
- State that nothing was published.
