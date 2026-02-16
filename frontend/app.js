const nodes = {
    incidentId: document.getElementById("incidentId"),
    apiBase: document.getElementById("apiBase"),
    logInput: document.getElementById("logInput"),
    sendLogs: document.getElementById("sendLogs"),
    logStatus: document.getElementById("logStatus"),
    question: document.getElementById("question"),
    ask: document.getElementById("ask"),
    askStream: document.getElementById("askStream"),
    askStatus: document.getElementById("askStatus"),
    chat: document.getElementById("chat"),
    timeline: document.getElementById("timeline"),
    refreshTimeline: document.getElementById("refreshTimeline"),
    voice: document.getElementById("voice")
};

function getApiBase() {
    return nodes.apiBase.value.trim().replace(/\/$/, "");
}

function getIncidentId() {
    return nodes.incidentId.value.trim() || "incident-001";
}

function route(path) {
    return `${getApiBase()}${path}`;
}

function addMessage(role, content) {
    const el = document.createElement("div");
    el.className = `message ${role}`;
    el.textContent = content;
    nodes.chat.appendChild(el);
    nodes.chat.scrollTop = nodes.chat.scrollHeight;
    return el;
}

function parseLinesToEvents(raw) {
    const now = new Date().toISOString();
    return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const parts = line.split(/\s+/);
        const service = parts[0] || "unknown-service";
        const levelToken = (parts[1] || "INFO").toLowerCase();
        const level = ["debug", "info", "warn", "error", "fatal"].includes(levelToken)
            ? levelToken
            : "info";
        const message = parts.slice(2).join(" ") || line;

        return {
            timestamp: now,
            service,
            level,
            message
        };
        });
}

async function sendLogs() {
    const raw = nodes.logInput.value;
    const events = parseLinesToEvents(raw);
    if (!events.length) {
        nodes.logStatus.textContent = "Add at least one log line.";
        return;
    }

    nodes.logStatus.textContent = "Streaming logs...";
    const res = await fetch(route(`/api/incident/${encodeURIComponent(getIncidentId())}/logs`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events })
    });

    const data = await res.json();
    if (!res.ok) {
        nodes.logStatus.textContent = `Error: ${data.error || res.status}`;
        return;
    }

    nodes.logStatus.textContent = `Ingested ${data.ingested} events.`;
    await refreshTimeline();
}

async function ask() {
    const question = nodes.question.value.trim();
    if (!question) {
        nodes.askStatus.textContent = "Enter a question first.";
        return;
    }

    addMessage("user", question);
    nodes.askStatus.textContent = "Running analysis...";

    const res = await fetch(route(`/api/incident/${encodeURIComponent(getIncidentId())}/ask`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
    });

    const data = await res.json();
    if (!res.ok) {
        nodes.askStatus.textContent = `Error: ${data.error || res.status}`;
        return;
    }

    addMessage("assistant", data.answer || "No answer returned.");
    nodes.askStatus.textContent = "Done.";
    await refreshTimeline();
}

async function askStream() {
    const question = nodes.question.value.trim();
    if (!question) {
        nodes.askStatus.textContent = "Enter a question first.";
        return;
    }

    addMessage("user", question);
    const assistantNode = addMessage("assistant", "");

    nodes.askStatus.textContent = "Connecting stream...";
    const res = await fetch(route(`/api/incident/${encodeURIComponent(getIncidentId())}/ask-stream`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
    });

    if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        nodes.askStatus.textContent = `Error: ${data.error || res.status}`;
        return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventBlock of events) {
        const lines = eventBlock.split("\n");
        const typeLine = lines.find((line) => line.startsWith("event:"));
        const dataLine = lines.find((line) => line.startsWith("data:"));
        if (!typeLine || !dataLine) continue;

        const eventType = typeLine.replace("event:", "").trim();
        let payload = {};
        try {
            payload = JSON.parse(dataLine.replace("data:", "").trim());
        } catch {
            payload = {};
        }

        if (eventType === "status") {
            nodes.askStatus.textContent = `Status: ${payload.step || "..."}`;
        } else if (eventType === "token") {
            assistantNode.textContent += payload.text || "";
        } else if (eventType === "error") {
            nodes.askStatus.textContent = `Error: ${payload.message || "unknown"}`;
        } else if (eventType === "done") {
            nodes.askStatus.textContent = "Done.";
        }
        }
    }

    await refreshTimeline();
}

async function refreshTimeline() {
    const res = await fetch(route(`/api/incident/${encodeURIComponent(getIncidentId())}/timeline`));
    const data = await res.json();
    if (!res.ok) {
        nodes.timeline.textContent = `Failed to load timeline: ${data.error || res.status}`;
        return;
    }

    nodes.timeline.textContent = JSON.stringify(data, null, 2);
}

function enableVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        nodes.voice.disabled = true;
        nodes.voice.title = "Speech recognition not supported in this browser";
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;

    nodes.voice.addEventListener("click", () => {
        nodes.askStatus.textContent = "Listening...";
        recognition.start();
    });

    recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) {
        nodes.question.value = transcript;
        nodes.askStatus.textContent = "Voice captured.";
        }
    };

    recognition.onerror = () => {
        nodes.askStatus.textContent = "Voice input failed.";
    };
}

nodes.sendLogs.addEventListener("click", () => {
    sendLogs().catch((error) => {
        nodes.logStatus.textContent = `Error: ${error.message || error}`;
    });
});

nodes.ask.addEventListener("click", () => {
    ask().catch((error) => {
        nodes.askStatus.textContent = `Error: ${error.message || error}`;
    });
});

nodes.askStream.addEventListener("click", () => {
    askStream().catch((error) => {
        nodes.askStatus.textContent = `Error: ${error.message || error}`;
    });
});

nodes.refreshTimeline.addEventListener("click", () => {
    refreshTimeline().catch((error) => {
        nodes.timeline.textContent = `Error: ${error.message || error}`;
    });
});

enableVoiceInput();
refreshTimeline().catch(() => {
    nodes.timeline.textContent = "Timeline not loaded yet.";
});
