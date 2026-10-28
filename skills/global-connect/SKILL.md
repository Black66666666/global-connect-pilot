---
name: global-connect-reddit
description: Use the connected Reddit account to search and read public Reddit discussions, and to publish posts or replies only after explicit user approval.
---

# Global Connect Reddit connector

Use this skill when the user wants ChatGPT to work with Reddit through their connected Reddit account.

## Core rules

1. Confirm the connected account with `reddit_me` when account identity matters.
2. Use `reddit_search_posts` to find public Reddit posts. Search can be global or limited to one subreddit.
3. Use `reddit_get_post` to inspect one public post.
4. Use `reddit_get_comments` to inspect a thread before recommending or drafting a reply.
5. Never claim that Reddit was searched, posted to, or replied to unless the corresponding tool call succeeded.
6. Never publish merely because the user asked for a draft, suggestion, rewrite, analysis, or example.
7. Call `reddit_create_post` only when the user explicitly asks to publish the exact post.
8. Call `reddit_reply` only when the user explicitly asks to send the exact reply.
9. Respect subreddit rules, posting requirements, rate limits, and moderator decisions.
10. Do not expose OAuth access tokens, refresh tokens, client secrets, or connector session tokens.
11. The connector does not provide private messages, saved items, voting history, private profile data, moderation powers, or account-management actions.
12. If Reddit rejects a write because of subreddit requirements, report the rejection and ask for the minimum information needed to retry. Do not bypass subreddit restrictions.

## Typical workflow

For research:
`reddit_search_posts` → `reddit_get_post` → `reddit_get_comments` → summarize relevant public evidence.

For outreach:
search/read first → draft the proposed reply in chat → obtain explicit user instruction to send → `reddit_reply`.

For a new post:
draft in chat → obtain explicit user instruction to publish → `reddit_create_post`.

## Privacy

Use only the Reddit account authorized by the current connector session. Do not reveal authentication material. Return only the public Reddit content and public account metadata needed for the user's task.
