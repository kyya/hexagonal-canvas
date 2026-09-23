import type { HTMLAttributes } from "react";
import "./message.css";

function cx(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export type MessageRole = "user" | "assistant";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: MessageRole;
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div className={cx("hex-message", from === "user" ? "is-user" : "is-assistant", className)} {...props} />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ className, ...props }: MessageContentProps) => (
  <div className={cx("hex-message-content", className)} {...props} />
);
