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
  question: string;
  answer: string;
};

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

async function readTranscript(sessionId: string): Promise<TranscriptTurn> {
  const response = await fetch(`/api/transcript?id=${encodeURIComponent(sessionId)}`);
  if (!response.ok) {
    throw new Error(`Transcript request failed: ${response.status}`);
  }
  const payload = (await response.json()) as { question?: string; answer?: string };
  return {
    question: payload.question ?? "",
    answer: payload.answer ?? "",
  };
}

function hasTurn(turn: TranscriptTurn | undefined): turn is TranscriptTurn {
  return !!turn && (turn.question !== "" || turn.answer !== "");
}

function TranscriptView({ question, answer }: TranscriptTurn) {
  return (
    <MessageScrollerProvider defaultScrollPosition="last-anchor" scrollPreviousItemPeek={0}>
      <MessageScroller>
        <MessageScrollerViewport aria-label="对话">
          <MessageScrollerContent>
            <MessageScrollerItem messageId="question" scrollAnchor>
              <Message from="user">
                <MessageContent>{question || "（没有提问）"}</MessageContent>
              </Message>
            </MessageScrollerItem>
            <MessageScrollerItem messageId="answer">
              <Message from="assistant">
                <MessageContent>
                  {answer ? <Response>{answer}</Response> : "（还没有回复）"}
                </MessageContent>
              </Message>
            </MessageScrollerItem>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function TranscriptQuery({ sessionId }: { sessionId: string }) {
  const query = useQuery({
    queryKey: ["transcript", sessionId],
    queryFn: () => readTranscript(sessionId),
  });

  useEffect(() => {
    if (!hostEl || query.isPending) return;
    hostEl.hidden = query.isError || !hasTurn(query.data);
  }, [query.isPending, query.isError, query.data]);

  if (query.isPending) {
    return <p className="hex-message-scroller-empty">读取对话…</p>;
  }
  if (query.isError || !hasTurn(query.data)) return null;
  return <TranscriptView question={query.data.question} answer={query.data.answer} />;
}

let root: Root | null = null;
let hostEl: HTMLElement | null = null;

export function mountTranscript(host: HTMLElement, sessionId: string | null): void {
  hostEl = host;
  root ??= createRoot(host);
  if (!sessionId) {
    root.render(null);
    return;
  }
  root.render(
    <QueryClientProvider client={queryClient}>
      <TranscriptQuery sessionId={sessionId} />
    </QueryClientProvider>,
  );
}
