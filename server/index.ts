import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { collectSessions } from "./agents.ts";
import { readTranscript } from "./transcript.ts";

const app = new Hono();

app.get("/api/sessions", (c) => c.json({ sessions: collectSessions() }));

app.get("/api/transcript", (c) => {
  const id = c.req.query("id") ?? "";
  const session = collectSessions().find((item) => item.id === id);
  if (!session) return c.json({ question: "", answer: "" }, 404);
  return c.json(readTranscript(session));
});

app.get("/api/sessions/stream", (c) => {
  return streamSSE(c, async (stream) => {
    let last = "";
    while (true) {
      const data = JSON.stringify({ sessions: collectSessions() });
      if (data !== last) {
        await stream.writeSSE({ data });
        last = data;
      }
      await stream.sleep(1000);
    }
  });
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8787 });
console.log("agent status http://127.0.0.1:8787");
