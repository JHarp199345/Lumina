# Lumina free-tier OpenRouter proxy

A tiny Cloudflare Worker that lets keyless Lumina users generate for free, safely:

- Holds **one OpenRouter API key server-side** — never shipped to the browser.
- Holds an optional **registered AI Horde key server-side** for faster image queue
  priority. Anonymous Horde still works, but it can be extremely slow.
- Restricts every call to a **free-model allowlist** (edit `FREE_MODELS` in `worker.js`).
- **Fails over** across those free models automatically (OpenRouter `models` routing).
- **Per-IP rate limit** (optional, via Workers KV) so one user can't hog the shared tier.
- Costs **$0** (Cloudflare Workers free tier ~100k requests/day; OpenRouter free models cost nothing).

The browser only ever sees this Worker's URL — the key cannot leak.

---

## Step-by-step setup (do these in order)

### 1. Create the OpenRouter key (free, restricted)
1. Sign up at https://openrouter.ai .
2. **Privacy setting (important for free models):** Settings → Privacy → enable
   *"Free model training / prompt logging"*. Many `:free` models refuse requests
   unless this is on. (Public-domain / non-sensitive use only — see caveats.)
3. **Keep $0 credit.** With no credit balance, paid models are refused upstream —
   a second guard on top of the allowlist.
4. Keys → **Create Key**. Name it `lumina-free-proxy`. Optionally set a credit
   limit of `0`. Copy the key (starts with `sk-or-...`). You'll paste it as a
   Worker *secret* in step 4 — do **not** put it in any file.

### 2. Pick your free models
- Browse https://openrouter.ai/models?max_price=0 — these are the free ones.
- Choose an ordered list (best/most-reliable first). Open `worker.js`, replace the
  `FREE_MODELS` array with your exact ids. Failover tries them top-to-bottom.

### 3. Install Wrangler + log in
```bash
npm install -g wrangler        # Cloudflare's CLI
wrangler login                 # opens a browser to authorize your Cloudflare account
```
(No Cloudflare account yet? `wrangler login` will walk you through creating one — free, no card.)

### 4. Set the key as a secret + deploy
```bash
cd cloudflare-openrouter-proxy
wrangler secret put OPENROUTER_API_KEY    # paste the sk-or-... key when prompted
wrangler secret put HORDE_API_KEY         # paste the registered AI Horde key when prompted
wrangler deploy
```
Deploy prints your Worker URL, e.g. `https://lumina-openrouter-free.<you>.workers.dev`.
**Copy it** — Lumina's client points at this URL.

### 5. (Optional) Turn on per-IP rate limiting
```bash
wrangler kv namespace create RATE_LIMIT_KV
```
Paste the printed `id` into `wrangler.toml` under `[[kv_namespaces]]` (uncomment),
then `wrangler deploy` again. Without this, the Worker still runs; it just relies
on OpenRouter's own limits.

### 6. Tell the app where the Worker is
Set the Worker URL in the Lumina client (the `openrouter-free` provider — wired in
`src/api/llmClient.ts`; exact config field added in the client task).

---

## Test it
```bash
curl -X POST https://lumina-openrouter-free.<you>.workers.dev \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"messages":[{"role":"user","content":"Say hello in 5 words."}]}'
```
Expect an OpenAI-style `choices[0].message.content`. A `429` means the free tier
is busy (the client backs off and retries — that's expected under load).

---

## Honest caveats
- **Free models are globally rate-limited and will 429 under load.** The proxy +
  client backoff turn that into "slower, retried, usually-eventually-works," not
  "reliable." The pre-baked library (PLANxvi Part One) is the guaranteed floor.
- **Free-tier daily caps:** OpenRouter limits free-model requests per account per
  day (more with a small credit balance). This is shared across all your users —
  the per-IP limit keeps any one user from draining it.
- **Privacy:** free models may log prompts upstream. Keep keyless free generation
  to non-sensitive / public-domain text; gate anything private behind BYO-key.
- **Allowlist drift:** free model ids change over time. Update `FREE_MODELS` and
  redeploy when one is retired.
