# Real-time Incident AI Assistant on Cloudflare

This repository contains a working Cloudflare AI app that helps debug production incidents in real time.

## Live deployment

- Frontend (Pages): `https://c4b95b9b.incident-ai-assistant-ui.pages.dev`
- API (Worker): `https://incident-ai-worker.rozolennon4.workers.dev`

Cloudflare keeps this serverless app available without managing your own server.

## What this includes

- **Workers**: API + orchestration routes
- **Durable Objects**: per-incident memory (timeline, context, chat history)
- **Workers AI**: LLM inference using **Llama 3.3** (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- **Pages**: chat/voice frontend for log ingest + Q&A

## Architecture

1. User sends logs/events from the frontend
2. Worker route `/api/incident/:id/logs` stores them in a Durable Object session
3. User asks incident questions (chat or voice)
4. Worker fetches incident context from Durable Object
5. Worker calls Workers AI (or optional external LLM)
6. Worker returns response (JSON or streamed SSE)
7. Durable Object stores timeline + summaries + conversation

## Repository layout

- `worker/` Cloudflare Worker + Durable Object
- `frontend/` Cloudflare Pages static UI

## Prerequisites

- Node.js 20+
- `npm`
- Cloudflare account with Workers + Workers AI access
- Wrangler login (`npx wrangler login`)

## 1) Run Worker locally

```bash
cd worker
npm install
npm run dev
```

The Worker runs at `http://127.0.0.1:8787`.

## 2) Run frontend locally

Serve the frontend as static files (recommended), then open it in your browser:

```bash
cd frontend
npx serve .
```

Then open the local URL printed by `serve`, set API base URL to `http://127.0.0.1:8787`, and use:

- **Stream Logs** to ingest events
- **Ask (stream)** for live answer streaming
- **🎤 Voice input** for speech-to-text question entry

## 3) Deploy Worker

```bash
cd worker
npm run deploy
```

After deploy, note your Worker URL (for example `https://incident-ai-worker.<subdomain>.workers.dev`).

## 4) Deploy frontend to Cloudflare Pages

Use `frontend/` as your Pages project root.

- Build command: _(none)_
- Output directory: `.`

CLI deploy (used for current live site):

```bash
npx wrangler pages project create incident-ai-assistant-ui --production-branch main
npx wrangler pages deploy frontend --project-name incident-ai-assistant-ui
```

The default API base in `frontend/index.html` is already set to the deployed Worker URL.

## 5) GitHub + auto deploy to Cloudflare

This repo includes GitHub Actions workflow `.github/workflows/deploy-cloudflare.yml`.

Add these GitHub repository secrets:

- `CF_API_TOKEN` (Cloudflare API token with Workers + Pages deploy permissions)
- `CF_ACCOUNT_ID` (your Cloudflare account ID)

After that, every push to `main` auto-deploys Worker and Pages.

## 6) Optional external LLM

If you want to use an external LLM endpoint instead of Workers AI, set Worker secrets/vars:

```bash
cd worker
npx wrangler secret put EXTERNAL_LLM_API_KEY
npx wrangler secret put EXTERNAL_LLM_URL
```

When both are configured, the Worker uses external LLM first; otherwise it falls back to Workers AI.

## 7) Push to GitHub

```bash
git init
git add .
git commit -m "Initial Cloudflare incident AI assistant"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## Example questions

- "What changed before latency spike?"
- "Summarize errors by service"
- "Which service shows the earliest anomaly?"
- "What should I check next in the next 10 minutes?"
