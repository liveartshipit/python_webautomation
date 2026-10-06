# Worksmarto Chatbot

A free AI chat assistant for worksmarto.com. It is trained on every post and page on the site, answers in about 1 second, and has no credit limits.

## How it works

```
Visitor -> widget/chatbot.js -> Cloudflare Worker -> OpenRouter (free model)
                  |                      |
         instant FAQ answers     searches data/knowledge.json
         (data/faq.json)         and sends the top 5 chunks to the AI
```

- **Knowledge:** `data/knowledge.json` holds all worksmarto posts and pages, split into paragraph chunks.
- **Daily sync:** a GitHub Action rebuilds the knowledge file from the WordPress API every night, so new posts are learned automatically.
- **Instant answers:** common questions in `data/faq.json` are answered in the browser with no AI call.
- **Security:** the OpenRouter key lives only in the Cloudflare Worker. Only worksmarto.com is allowed to call it, and each IP is rate-limited.

## Setup (one time, about 10 minutes)

### 1. Deploy the Worker
1. Sign up for free at dash.cloudflare.com.
2. Go to **Workers & Pages -> Create -> Create Worker**, name it `worksmarto-chatbot`, and tap **Deploy**.
3. Tap **Edit code**, delete everything, paste in `worker/worker.js`, and tap **Deploy**.
4. Go to **Settings -> Variables and Secrets** and add:
   - `OPENROUTER_API_KEY` as a **Secret**, set to your OpenRouter key
   - `ALLOWED_ORIGINS` set to `https://worksmarto.com,https://www.worksmarto.com`
5. Copy the Worker URL, for example `https://worksmarto-chatbot.yourname.workers.dev`.
6. Check that it works: open `<worker-url>/health`. It should show `{"ok":true,...}`.

### 2. Add the widget to WordPress
Add this through WPCode (or another header/footer plugin), placed in the site footer:

```html
<script src="https://cdn.jsdelivr.net/gh/liveartshipit/python_webautomation@main/widget/chatbot.js"
  data-api="https://worksmarto-chatbot.yourname.workers.dev" defer></script>
```

Optional attributes: `data-color="#4f46e5"` and `data-title="Worksmarto Assistant"`.

### 3. Run the first full sync
Go to GitHub, then **Actions -> Sync chatbot knowledge -> Run workflow**. This replaces the starter knowledge file with the full content of every post.

## Retraining
- **New posts** are picked up automatically every night.
- **Fixing a wrong answer:** add a Q&A to `data/faq.json`. The bot re-syncs on push.
- **Changing the AI model:** edit the `MODELS` variable on the Worker. Models are tried in order, so if one is busy the next one answers.

## Files
| File | Purpose |
|---|---|
| `worker/worker.js` | Backend: search, prompt, and streaming the AI reply |
| `widget/chatbot.js` | Chat bubble shown on the site |
| `data/knowledge.json` | Everything the bot knows (auto-generated) |
| `data/faq.json` | Instant answers and hand-written Q&A |
| `scripts/build-knowledge.mjs` | Pulls the site content and builds knowledge.json |
| `.github/workflows/sync-knowledge.yml` | Daily auto-sync |
