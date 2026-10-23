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
- A Supabase edge function runs in the cloud and cannot reach `localhost`, so 9Router is exposed with Tailscale Funnel: `tailscale funnel --bg 20128` (once; it keeps running in the background and survives restarts). The address is stable: `https://kukuhs-macbook-pro.tail284225.ts.net`. `AI_BASE_URL` is that address without a trailing `/v1`, because the code appends `/v1/messages` itself. Funnel needs MagicDNS and HTTPS Certificates enabled in the Tailscale admin console and the Funnel permission approved once. 9Router's own Tunnel (Endpoint & Key page) and a Cloudflare quick tunnel are fallbacks, but their addresses can change.
- The 9Router API key is on its **Endpoint & Key** page. 9Router rejects requests from outside localhost without it (the tunnel returns 401). Never paste the key into chat, commits or issues.

## When the AI features stop working

Symptom: an AI panel or Ask shows `Cannot reach the AI router ... Make sure 9Router is running`. Usual causes: the Mac slept or is offline, 9Router is not running, or Tailscale is disconnected.

1. Make sure 9Router is running and the Tailscale app shows Connected. Check Funnel with `tailscale funnel status`; if it is off, run `tailscale funnel --bg 20128` again.
2. The address does not change, so Supabase normally needs nothing. Only if you switch to another address, remove any trailing `/v1` from it.
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

## Checklist when "Cannot reach the AI router" shows up

Funnel is part of the Tailscale app, so all three must be running on the Mac (logged in): 9Router, the Tailscale app, and Funnel.

1. `pgrep -fl 9router`: if empty, start 9Router.
2. `tailscale status`: "failed to connect to local Tailscale service" means the app is not running, so `open -a Tailscale`. Turn on Start at login in its settings.
3. `tailscale funnel status` must show Funnel on. If not, `tailscale funnel --bg 20128`.
4. A request without a key to the Funnel address must return 401.

An answer the router sends back but the dashboard cannot read is reported separately ("answered, but not with valid JSON"), not as "cannot reach".

## Usage tracking

9Router's Usage page only records `/v1/chat/completions` calls; `/v1/messages` calls are served but never logged. So when `AI_BASE_URL` is set, `callAI` talks to `/v1/chat/completions` (OpenAI format, `stream: false`) and rewraps the answer in the Anthropic shape. With `AI_BASE_URL` unset it still calls api.anthropic.com `/v1/messages`.

9Router also showed ~2,000 extra prompt tokens on tiny requests and a clipped, ungrammatical writing style: that is its Token Saver. Turn it off for the dashboard's key if the answers should read normally.

## Notes

- Locally (`server/`), set `AI_BASE_URL=http://localhost:20128` and no tunnel is needed.
- The `cc/` models in the combo are probably Claude Code subscription logins: account-bound, so moving 9Router to a server or sharing it widely may hit usage limits and terms. A 24/7 option (9Router in Docker on a small VPS, or a hosted router) was discussed and deferred.
- Prompts for the insight features carry aggregated figures only. Names, SIDs and emails are never sent to the model.
- Only the 9Router API is exposed through Funnel. Keep **Require API key** on, and turn off "Allow dashboard access via tunnel" in 9Router so the admin pages are not reachable from the internet.
- This works only while the Mac is awake and online with 9Router running.
