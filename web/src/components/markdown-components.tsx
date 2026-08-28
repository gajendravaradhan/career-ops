import type { Components } from "react-markdown";

/** Shared renderer for report markdown on both saved-report and live-run pages. */
export const markdownComponents: Components = {
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full [&_td]:min-w-32 [&_th]:min-w-32">{children}</table>
    </div>
  ),
};
