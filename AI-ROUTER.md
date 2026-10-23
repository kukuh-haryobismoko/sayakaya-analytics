# AI router (9Router)

Every AI call in the dashboard (Ask, AI Insights, Portfolio note, Explain result) goes through one helper, `callAI`, in `supabase/functions/api/ask.ts` (mirrored in `server/ask.js`). It talks to any Anthropic-compatible endpoint, so it can use the 9Router gateway on the maintainer's Mac instead of api.anthropic.com.

## Environment

| Variable | Meaning | Default when unset |
|---|---|---|
| `AI_BASE_URL` | Gateway URL, no trailing slash | `https://api.anthropic.com` |
| `AI_API_KEY` | Key for that gateway | `ANTHROPIC_API_KEY` |
| `AI_MODEL` | Model or combo name | `ANTHROPIC_MODEL`, then `claude-sonnet-5` |

With none of them set, behaviour is the original Anthropic-direct path. On Supabase they are function secrets, locally they go in `.env`.

## Current setup (as of 2026-10-23)

- 9Router runs on the maintainer's Mac at `localhost:20128`. The model name is `combro`, a combo with fallback across several providers.
- A Supabase edge function runs in the cloud and cannot reach `localhost`, so 9Router is exposed with its built-in tunnel (Endpoint & Key page, Tunnel, Enable). `AI_BASE_URL` is the tunnel's address without the trailing `/v1`, because the code appends `/v1/messages` itself. Current address: `https://rh2fd4s.abc-tunnel.us`. A Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:20128`) also works as a fallback.
- The 9Router API key is on its **Endpoint & Key** page. 9Router rejects requests from outside localhost without it (the tunnel returns 401). Never paste the key into chat, commits or issues.

## When the AI features stop working

Symptom: an AI panel or Ask shows `Cannot reach the AI router ... Make sure 9Router is running`. Usual causes: the Mac slept, 9Router or cloudflared was closed, or cloudflared restarted and the URL changed (quick-tunnel URLs are not stable).

1. Make sure 9Router is running and its Tunnel is enabled (Endpoint & Key page). If the tunnel address changed, copy the new one. With the cloudflared fallback, restart it and read the URL from `curl localhost:20241/quicktunnel` (this version does not print it in the log; try ports 20241 to 20246).
2. Remove any trailing `/v1` from the address.
3. Test it. A 200 with text means the URL and key are good:
   ```
   curl <url>/v1/messages -H "x-api-key: <key>" -H "anthropic-version: 2023-06-01" \
     -H "content-type: application/json" \
     -d '{"model":"combro","max_tokens":20,"messages":[{"role":"user","content":"ok"}]}'
   ```
4. Point Supabase at it. The key is typed by the maintainer, not by an agent:
   ```
   supabase secrets set AI_BASE_URL=<new https url> AI_API_KEY=<9Router key> AI_MODEL=combro --project-ref josptpfisrsdjeggkqke
   ```
   Secrets apply on the next invocation, no redeploy needed.

A `401` from the router means the key is wrong or was rotated: set `AI_API_KEY` again.

## Revert to Anthropic directly

```
supabase secrets unset AI_BASE_URL AI_API_KEY AI_MODEL --project-ref josptpfisrsdjeggkqke
```

`ANTHROPIC_API_KEY` is then used again.

## Notes

- Locally (`server/`), set `AI_BASE_URL=http://localhost:20128` and no tunnel is needed.
- The `cc/` models in the combo are probably Claude Code subscription logins: account-bound, so moving 9Router to a server or sharing it widely may hit usage limits and terms. A 24/7 option (9Router in Docker on a small VPS, or a hosted router) was discussed and deferred.
- Prompts for the insight features carry aggregated figures only. Names, SIDs and emails are never sent to the model.
- The tunnel only works while the Mac is awake with 9Router running.
