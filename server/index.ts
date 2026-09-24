import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { canvasSessions, sessionTranscript } from "./sessions.ts";

const app = new Hono();

app.get("/api/sessions", (c) => c.json({ sessions: canvasSessions() }));

app.get("/api/transcript", (c) => {
  const transcript = sessionTranscript(c.req.query("id") ?? "");
  if (!transcript) return c.json({ question: "", answer: "" }, 404);
  return c.json(transcript);
});

app.get("/api/sessions/stream", (c) => {
  return streamSSE(c, async (stream) => {
    let last = "";
    while (true) {
      const data = JSON.stringify({ sessions: canvasSessions() });
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
