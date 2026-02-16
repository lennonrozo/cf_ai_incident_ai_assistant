# Prompts used in this project

This file captures the key prompts provided during development and deployment of this repository.

## Build prompt

"""
build a type of AI-powered application on Cloudflare. An AI-powered application should include the following components: LLM (recommend using Llama 3.3 on Workers AI), or an external LLM of your choice Workflow / coordination (recommend using Workflows, Workers or Durable Objects) User input via chat or voice (recommend using Pages or Realtime) Memory or state
"""A real-time AI assistant that helps debug incidents using logs/events.
How it works
User streams logs or events
LLM summarizes anomalies
Durable Object maintains incident timeline
Chat interface asks questions like:
“What changed before latency spike?”
“Summarize errors by service”
"""
"""
Core flow
User sends logs → API (Worker)
Worker routes to Durable Object (incident session)
Durable Object stores timeline + context
Worker calls LLM (Workers AI or external)
UI streams insights back
Key components on Cloudflare:
Workers → API + orchestration
Durable Objects → incident memory
Workers AI → LLM inference
Pages → frontend
"""

i want to have it on github and it should be working well

## Debugging prompt

I ran the frontend but the buttons are not working

## Deployment + GitHub prompt

let's host this on cloudflare first, then commit to github. I want it to be able to run if someone accesses from github and cloudflare keeps server live

## GitHub repository prompt

https://github.com/lennonrozo/cf_ai_incident_ai_assistant this is the github repo

## Secrets prompt

can you add the repo secrets directly

## Security verification prompts

are there api keys in the code base published now

is the current code base safe and there is no information that can be stolen that is sensitive like API keys etc

## Documentation prompt

edit the readme file to make sure someone can clone the repo and recreate this. Also, add a prompt.md file that includes prompts I made in this. In the readme, also discuss high level design
