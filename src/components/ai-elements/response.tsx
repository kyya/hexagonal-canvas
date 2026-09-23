import type { ComponentProps } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import "./response.css";

function cx(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(" ");
}

type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = ({ className, ...props }: ResponseProps) => (
  <Streamdown className={cx("hex-markdown", className)} mode="static" {...props} />
);
