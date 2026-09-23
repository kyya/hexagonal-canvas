import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import "./message-scroller.css";

function cx(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export function MessageScrollerProvider(props: ComponentProps<typeof MessageScrollerPrimitive.Provider>) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

export function MessageScroller({ className, ...props }: ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return <MessageScrollerPrimitive.Root className={cx("hex-message-scroller", className)} {...props} />;
}

export function MessageScrollerViewport({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return <MessageScrollerPrimitive.Viewport className={cx("hex-message-scroller-viewport", className)} {...props} />;
}

export function MessageScrollerContent({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return <MessageScrollerPrimitive.Content className={cx("hex-message-scroller-content", className)} {...props} />;
}

export function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      className={cx("hex-message-scroller-item", className)}
      scrollAnchor={scrollAnchor}
      {...props}
    />
  );
}

export function MessageScrollerButton({
  direction = "end",
  className,
  children,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Button>) {
  return (
    <MessageScrollerPrimitive.Button
      className={cx("hex-message-scroller-button", className)}
      direction={direction}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon size={16} />
          <span className="hex-message-scroller-sr">{direction === "end" ? "滚到最新" : "滚到开头"}</span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  );
}

export { useMessageScroller, useMessageScrollerScrollable, useMessageScrollerVisibility };
