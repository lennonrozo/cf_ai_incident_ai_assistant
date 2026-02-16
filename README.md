# Real-time Incident AI Assistant
This repository contains a Cloudflare-native AI assistant that helps debug incidents using real-time logs/events, LLM analysis, and persistent incident memory.

## Live deployment

- Frontend (Pages): `https://c4b95b9b.incident-ai-assistant-ui.pages.dev`
- API (Worker): `https://incident-ai-worker.rozolennon4.workers.dev`

## High-level design
### Goal
Provide a real-time assistant for incident response that can answer questions like:

- "What changed before latency spike?"
- "Summarize errors by service"

### Core components

- **Cloudflare Workers**: API routes + orchestration layer.
- **Durable Objects**: per-incident state and timeline memory.
- **Workers AI (Llama 3.3)**: analysis and summarization of incident context.
- **Cloudflare Pages**: chat/voice frontend.

### Data flow

1. User streams logs/events from the frontend to Worker API.
2. Worker routes data to a Durable Object keyed by incident ID.
3. Durable Object stores timeline events, summaries, and chat turns.
4. User asks a question via chat/voice.
5. Worker builds a prompt from incident memory and calls Workers AI (or optional external LLM).
6. Worker returns answer (JSON or SSE stream) and writes Q&A summary back to Durable Object.

### State model
Each incident keeps:

- Event timeline
- Chat history
- Rolling summaries
- Created/updated timestamps

## Repository layout

- `worker/` Cloudflare Worker + Durable Object implementation
- `frontend/` Cloudflare Pages static UI

## Prerequisites

- Node.js 20+
- `npm`
- Cloudflare account with Workers + Workers AI + Pages access
- Wrangler login (`npx wrangler login`)

## Recreate from scratch (clone to production)
### 1) Clone and install

```bash
git clone https://github.com/lennonrozo/cf_ai_incident_ai_assistant.git
cd cf_ai_incident_ai_assistant
cd worker
npm install
```
### 2) Run locally
Start backend:
```bash
cd worker
npm run dev
```
Start frontend (in another terminal):
```bash
cd frontend
npx serve .
```
Then open the local URL printed by `serve` and set API base URL to `http://127.0.0.1:8787`.
### 3) Deploy Worker to Cloudflare

```bash
cd worker
npm run deploy
```
This publishes your Worker and Durable Object migration using `worker/wrangler.toml`.
### 4) Deploy frontend to Cloudflare Pages
```bash
npx wrangler pages project create incident-ai-assistant-ui --production-branch main
npx wrangler pages deploy frontend --project-name incident-ai-assistant-ui
```
## Runtime endpoints

- Health: `GET /api/health`
- Ingest logs: `POST /api/incident/:id/logs`
- Ask question: `POST /api/incident/:id/ask`
- Ask question (stream): `POST /api/incident/:id/ask-stream`
- Incident timeline: `GET /api/incident/:id/timeline`

## Example log line format
Use one event per line in the frontend:

```text
api-gateway ERROR timeout upstream in 2130ms
payments WARN retrying transaction tokenization
```
## Example questions
- "What changed before latency spike?"
- "Summarize errors by service"
- "Which service shows the earliest anomaly?"
- "What should I check next in the next 10 minutes?"
