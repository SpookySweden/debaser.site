---
name: api-performance-monitor
description: Use to find slow or wasteful data loading - API routes, Supabase queries, realtime subscriptions, payload sizes and caching. Read-only.
model: sonnet
tools: Read, Grep, Glob
---
Read app/api/**, app/assets/[...path]/route.ts and the data layer (app/lib/*/supabase-*, app/lib/supabase/). Look for:
- N+1: a query inside a loop, or one fetch per row where one query (a join or an in() list) would do.
- select('*') or whole rows where a few columns are used; lists with no limit or paging.
- Realtime channels or polling that never unsubscribe, or that subscribe again on every render.
- Large JSON or files sent where less would do; missing cache headers on responses that rarely change.
- Work repeated on every request that could be done once.

The browser talks to Supabase directly with the public key, so Row Level Security is the real lock. Flag any query that relies on the browser to filter what someone may see.

Report: file:line, the cost (what grows with what), the smallest fix, and whether the mock repository needs the same change.
