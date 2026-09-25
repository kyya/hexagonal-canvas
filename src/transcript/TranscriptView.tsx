import { useQuery, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Message, MessageContent } from "../components/ai-elements/message";
import { Response } from "../components/ai-elements/response";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../components/ui/message-scroller";
import "./menu.css";

export type TranscriptTurn = {
  role: "user" | "assistant";
  text: string;
};

type Transcript = {
  turns: TranscriptTurn[];
  truncated: boolean;
};

// A running session keeps writing, so its open transcript refreshes on this interval.
const LIVE_REFRESH_MS = 3000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    },
  },
});

async function readTranscript(sessionId: string): Promise<Transcript> {
  const response = await fetch(`/api/transcript?id=${encodeURIComponent(sessionId)}`);
  if (!response.ok) {
    throw new Error(`Transcript request failed: ${response.status}`);
  }
  const payload = (await response.json()) as Partial<Transcript>;
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  return {
    turns: turns.filter(
      (turn): turn is TranscriptTurn =>
        !!turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string",
    ),
    truncated: payload.truncated === true,
  };
}

function TranscriptView({ turns, truncated }: Transcript) {
  return (
    // Opens at the latest question; follows new replies while scrolled to the bottom.
    <MessageScrollerProvider defaultScrollPosition="last-anchor" scrollPreviousItemPeek={0} autoScroll>
      <MessageScroller>
        <MessageScrollerViewport aria-label="对话">
          <MessageScrollerContent>
            {truncated && (
              <MessageScrollerItem messageId="truncated">
                <p className="hex-transcript-note">只显示最近的对话</p>
              </MessageScrollerItem>
            )}
            {turns.map((turn, index) => (
              <MessageScrollerItem key={index} messageId={`turn-${index}`} scrollAnchor={turn.role === "user"}>
                <Message from={turn.role}>
                  <MessageContent>{turn.role === "assistant" ? <Response>{turn.text}</Response> : turn.text}</MessageContent>
                </Message>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function TranscriptQuery({ sessionId, live }: { sessionId: string; live: boolean }) {
  const query = useQuery({
    queryKey: ["transcript", sessionId],
    queryFn: () => readTranscript(sessionId),
    refetchInterval: live ? LIVE_REFRESH_MS : false,
    // A session that was running when last opened may have grown since.
    staleTime: live ? 0 : Number.POSITIVE_INFINITY,
  });

  const empty = query.isError || (!!query.data && query.data.turns.length === 0);
  useEffect(() => {
    if (!hostEl || query.isPending) return;
    hostEl.hidden = empty;
  }, [query.isPending, empty]);

  if (query.isPending) {
    return <p className="hex-message-scroller-empty">读取对话…</p>;
  }
  if (empty || !query.data) return null;
  return <TranscriptView turns={query.data.turns} truncated={query.data.truncated} />;
}

let root: Root | null = null;
let hostEl: HTMLElement | null = null;

export function mountTranscript(host: HTMLElement, sessionId: string | null, live = false): void {
  hostEl = host;
  root ??= createRoot(host);
  if (!sessionId) {
    root.render(null);
    return;
  }
  root.render(
    <QueryClientProvider client={queryClient}>
      {/* Keyed so switching sessions starts a fresh scroller at the latest question. */}
      <TranscriptQuery key={sessionId} sessionId={sessionId} live={live} />
    </QueryClientProvider>,
  );
}
