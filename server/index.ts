import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { snapshot, subscribe } from "./hub.ts";
import { sessionTranscript } from "./sessions.ts";

const app = new Hono();

app.get("/api/sessions", (c) => c.body(snapshot(), 200, { "content-type": "application/json" }));

app.get("/api/transcript", (c) => {
  const transcript = sessionTranscript(c.req.query("id") ?? "");
  if (!transcript) return c.json({ turns: [], truncated: false }, 404);
  return c.json(transcript);
});

// A heartbeat on every stream, so the page can tell a quiet server from a dead one even when a
// proxy in between (Vite in development) keeps the connection open after the server is gone.
const HEARTBEAT_MS = 5000;

app.get("/api/sessions/stream", (c) => {
  return streamSSE(c, async (stream) => {
    // Only the newest snapshot matters, so a slow client skips intermediate ones.
    let pending: string | null = snapshot();
    let beat = false;
    let wake: (() => void) | null = null;
    const unsubscribe = subscribe((data) => {
      pending = data;
      wake?.();
    });
    const heartbeat = setInterval(() => {
      beat = true;
      wake?.();
    }, HEARTBEAT_MS);
    let closed = false;
    stream.onAbort(() => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      wake?.();
    });
    while (!closed) {
      if (pending !== null) {
        const data: string = pending;
        pending = null;
        await stream.writeSSE({ data });
      } else if (beat) {
        beat = false;
        await stream.writeSSE({ event: "ping", data: "" });
      } else {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    }
  });
});

// HEX_API_PORT lets a second instance (e.g. the cell storybook) run beside `pnpm dev`.
const port = Number(process.env.HEX_API_PORT) || 8787;
serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
console.log(`agent status http://127.0.0.1:${port}`);
