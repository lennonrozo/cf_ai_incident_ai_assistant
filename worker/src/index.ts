type Role = "user" | "assistant";

type IncidentEvent = {
    timestamp: string;
    service: string;
    level: string;
    message: string;
    metadata?: Record<string, unknown>;
};

type ChatTurn = {
    at: string;
    role: Role;
    content: string;
};

type IncidentMemory = {
    incidentId: string;
    events: IncidentEvent[];
    chat: ChatTurn[];
    summaries: string[];
    createdAt: string;
    updatedAt: string;
};

interface Env {
    INCIDENT_SESSIONS: DurableObjectNamespace;
    AI: {
        run(model: string, inputs: Record<string, unknown>): Promise<any>;
    };
    AI_MODEL?: string;
    EXTERNAL_LLM_URL?: string;
    EXTERNAL_LLM_API_KEY?: string;
}

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
        "Content-Type": "application/json",
        ...corsHeaders
        }
    });
}

function eventStreamHeaders(): HeadersInit {
    return {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...corsHeaders
    };
}

function getIncidentIdFromPath(pathname: string): string | null {
    const match = pathname.match(/^\/api\/incident\/([^/]+)\//);
    return match?.[1] ?? null;
}

function normalizeEvent(event: Partial<IncidentEvent>): IncidentEvent {
    return {
        timestamp: event.timestamp || new Date().toISOString(),
        service: event.service || "unknown-service",
        level: event.level || "info",
        message: event.message || "",
        metadata: event.metadata || {}
    };
}

async function readJson<T>(request: Request): Promise<T> {
    try {
        return (await request.json()) as T;
    } catch {
        throw new Error("Invalid JSON body");
    }
}

async function callExternalLLM(
    env: Env,
    prompt: string
): Promise<string | null> {
    if (!env.EXTERNAL_LLM_URL || !env.EXTERNAL_LLM_API_KEY) {
        return null;
    }

    const response = await fetch(env.EXTERNAL_LLM_URL, {
        method: "POST",
        headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.EXTERNAL_LLM_API_KEY}`
        },
    body: JSON.stringify({
        model: "external",
        messages: [
            {
            role: "system",
            content:
                "You are an SRE incident copilot. Answer in concise bullet points and cite signals from logs/events."
            },
        {
            role: "user",
            content: prompt
            }
        ]
        })
    });

    if (!response.ok) {
        throw new Error(`External LLM failed with ${response.status}`);
    }

    const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        output_text?: string;
    };

    const content = data.choices?.[0]?.message?.content || data.output_text;
    return content ?? null;
    }

    async function callWorkersAI(env: Env, prompt: string): Promise<string> {
    const model = env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    const result = await env.AI.run(model, {
        messages: [
        {
            role: "system",
            content:
            "You are an incident-debugging assistant. Summarize anomalies, compare pre/post spike behavior, and suggest next checks."
        },
        {
            role: "user",
            content: prompt
        }
        ],
    max_tokens: 600,
    temperature: 0.2
    });

    if (typeof result?.response === "string") {
        return result.response;
    }

    if (typeof result === "string") {
        return result;
    }

    return JSON.stringify(result);
    }

    function formatPrompt(context: IncidentMemory, question: string): string {
    const latestEvents = context.events.slice(-60);
    const latestChat = context.chat.slice(-10);
    const summaries = context.summaries.slice(-5);

    return [
        `Incident ID: ${context.incidentId}`,
        `Current UTC: ${new Date().toISOString()}`,
        "",
        "Latest Summaries:",
        summaries.length ? summaries.map((s, i) => `${i + 1}. ${s}`).join("\n") : "none",
        "",
        "Recent Events:",
        latestEvents.length
        ? latestEvents
            .map(
                (event) =>
                `[${event.timestamp}] service=${event.service} level=${event.level} msg=${event.message}`
            )
            .join("\n")
        : "none",
        "",
        "Recent Conversation:",
        latestChat.length
        ? latestChat.map((turn) => `${turn.role}: ${turn.content}`).join("\n")
        : "none",
        "",
        `Question: ${question}`,
        "",
        "Respond with:",
        "1) direct answer",
        "2) short evidence list (what changed before/after)",
        "3) next 3 debugging checks"
    ].join("\n");
    }

    function chunkText(text: string, size = 100): string[] {
    const chunks: string[] = [];
    for (let index = 0; index < text.length; index += size) {
        chunks.push(text.slice(index, index + size));
    }
    return chunks;
    }

    function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function getSessionStub(env: Env, incidentId: string): DurableObjectStub {
    const id = env.INCIDENT_SESSIONS.idFromName(incidentId);
    return env.INCIDENT_SESSIONS.get(id);
    }

    async function getContext(
    stub: DurableObjectStub,
    incidentId: string
    ): Promise<IncidentMemory> {
    const response = await stub.fetch(`https://session/context?incidentId=${incidentId}`);
    if (!response.ok) {
        throw new Error("Unable to load incident context");
    }

    return (await response.json()) as IncidentMemory;
    }

    export class IncidentSession {
    private state: DurableObjectState;

    constructor(state: DurableObjectState, private env: Env) {
        this.state = state;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
        }

        if (url.pathname === "/append" && request.method === "POST") {
        const body = await readJson<{ incidentId: string; events: IncidentEvent[] }>(request);
        const memory = await this.loadMemory(body.incidentId);
        memory.events.push(...body.events.map(normalizeEvent));
        memory.updatedAt = new Date().toISOString();
        await this.saveMemory(memory);
        return json({ ok: true, eventCount: memory.events.length });
        }

        if (url.pathname === "/qa" && request.method === "POST") {
        const body = await readJson<{
            incidentId: string;
            question: string;
            answer: string;
            summary?: string;
        }>(request);
        const memory = await this.loadMemory(body.incidentId);
        const now = new Date().toISOString();

        memory.chat.push({ at: now, role: "user", content: body.question });
        memory.chat.push({ at: now, role: "assistant", content: body.answer });

        if (body.summary?.trim()) {
            memory.summaries.push(body.summary.trim());
        }

        memory.updatedAt = now;
        await this.saveMemory(memory);

        return json({ ok: true, chatTurns: memory.chat.length });
        }

        if (url.pathname === "/context" && request.method === "GET") {
        const incidentId = url.searchParams.get("incidentId") || "default";
        const memory = await this.loadMemory(incidentId);
        return json(memory);
        }

        if (url.pathname === "/timeline" && request.method === "GET") {
        const incidentId = url.searchParams.get("incidentId") || "default";
        const memory = await this.loadMemory(incidentId);
        return json({
            incidentId,
            events: memory.events,
            chat: memory.chat,
            summaries: memory.summaries,
            updatedAt: memory.updatedAt
        });
        }

        return json({ error: "Not found" }, 404);
    }

    private async loadMemory(incidentId: string): Promise<IncidentMemory> {
        const key = `incident:${incidentId}`;
        const existing = await this.state.storage.get<IncidentMemory>(key);

        if (existing) {
        return existing;
        }

        const now = new Date().toISOString();
        return {
        incidentId,
        events: [],
        chat: [],
        summaries: [],
        createdAt: now,
        updatedAt: now
        };
    }

    private async saveMemory(memory: IncidentMemory): Promise<void> {
        const key = `incident:${memory.incidentId}`;
        await this.state.storage.put(key, memory);
    }
    }

    export default {
    async fetch(request, env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
        }

        if (url.pathname === "/api/health") {
        return json({ ok: true, service: "incident-ai-worker", now: new Date().toISOString() });
        }

        const incidentId = getIncidentIdFromPath(url.pathname);
        if (!incidentId) {
        return json({ error: "Invalid route" }, 404);
        }

        const stub = getSessionStub(env, incidentId);

        if (url.pathname.endsWith("/logs") && request.method === "POST") {
        const body = await readJson<{ events: Partial<IncidentEvent>[] }>(request);
        const events = (body.events || []).map(normalizeEvent);

        if (!events.length) {
            return json({ error: "No events provided" }, 400);
        }

        const response = await stub.fetch("https://session/append", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentId, events })
        });

        if (!response.ok) {
            return json({ error: "Failed to append events" }, 500);
        }

        return json({ ok: true, ingested: events.length });
        }

        if (url.pathname.endsWith("/timeline") && request.method === "GET") {
        const response = await stub.fetch(`https://session/timeline?incidentId=${incidentId}`);
        const data = await response.json();
        return json(data);
        }

        if (url.pathname.endsWith("/ask") && request.method === "POST") {
        const body = await readJson<{ question: string }>(request);
        if (!body.question?.trim()) {
            return json({ error: "Question is required" }, 400);
        }

        const context = await getContext(stub, incidentId);
        const prompt = formatPrompt(context, body.question.trim());

        let answer = await callExternalLLM(env, prompt);
        if (!answer) {
            answer = await callWorkersAI(env, prompt);
        }

        const summary = answer.split("\n").slice(0, 2).join(" ").slice(0, 280);

        await stub.fetch("https://session/qa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentId, question: body.question.trim(), answer, summary })
        });

        return json({ ok: true, answer });
        }

        if (url.pathname.endsWith("/ask-stream") && request.method === "POST") {
        const body = await readJson<{ question: string }>(request);
        if (!body.question?.trim()) {
            return json({ error: "Question is required" }, 400);
        }

        const stream = new ReadableStream({
            async start(controller) {
            const send = (type: string, payload: unknown) => {
                controller.enqueue(
                new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
                );
            };

            try {
                send("status", { step: "loading-context" });
                const context = await getContext(stub, incidentId);

                send("status", { step: "running-llm" });
                const prompt = formatPrompt(context, body.question.trim());
                let answer = await callExternalLLM(env, prompt);
                if (!answer) {
                answer = await callWorkersAI(env, prompt);
                }

                send("status", { step: "streaming-answer" });
                for (const chunk of chunkText(answer, 120)) {
                send("token", { text: chunk });
                await sleep(15);
                }

                const summary = answer.split("\n").slice(0, 2).join(" ").slice(0, 280);
                await stub.fetch("https://session/qa", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ incidentId, question: body.question.trim(), answer, summary })
                });

                send("done", { ok: true });
            } catch (error) {
                send("error", {
                message: error instanceof Error ? error.message : "Unknown error"
                });
            } finally {
                controller.close();
            }
            }
        });

        return new Response(stream, { headers: eventStreamHeaders() });
        }

        return json({ error: "Not found" }, 404);
    }
    } satisfies ExportedHandler<Env>;
