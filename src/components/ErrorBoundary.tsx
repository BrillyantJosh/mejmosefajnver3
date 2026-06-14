import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

// Global error boundary. Without this, ANY render-time throw anywhere in the
// tree unmounts the whole app into a blank white page — with nothing logged,
// so it can't be diagnosed (some customers hit browser/data-specific crashes
// the developer can't reproduce). This catches the throw, keeps the page
// usable, and SHOWS the error text so it can be screenshotted/reported.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("💥 ErrorBoundary caught:", error, errorInfo);
    this.setState({ info: errorInfo?.componentStack || "" });

    // Stale-chunk / failed dynamic import after a deploy: the cached HTML
    // points to chunk files that no longer exist. Reload ONCE to pull fresh
    // assets (guarded so we never loop on a genuine render bug).
    const msg = `${error?.name || ""} ${error?.message || ""}`;
    const isChunkError =
      /ChunkLoadError|Loading chunk|Importing a module script failed|dynamically imported module|Failed to fetch dynamically/i.test(
        msg,
      );
    if (isChunkError && !sessionStorage.getItem("eb-chunk-reload")) {
      sessionStorage.setItem("eb-chunk-reload", "1");
      window.location.reload();
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    const err = this.state.error;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#fafafa",
          color: "#1a1a1a",
        }}
      >
        <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
            Nekaj je šlo narobe / Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: "#666", margin: "0 0 20px" }}>
            Stran se ni mogla prikazati. Osvežite stran, ali pošljite to sliko podpori.
            <br />
            The page failed to render. Reload, or send this screenshot to support.
          </p>

          <div
            style={{
              textAlign: "left",
              background: "#fff",
              border: "1px solid #eee",
              borderRadius: 8,
              padding: "12px 14px",
              marginBottom: 20,
              fontSize: 12,
              fontFamily: "ui-monospace, monospace",
              color: "#b00020",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
              maxHeight: 180,
              overflow: "auto",
            }}
          >
            {err.name}: {err.message}
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => {
                sessionStorage.removeItem("eb-chunk-reload");
                window.location.reload();
              }}
              style={{
                background: "#1a1a1a",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Osveži / Reload
            </button>
            <button
              onClick={() => {
                window.location.href = "/";
              }}
              style={{
                background: "#fff",
                color: "#1a1a1a",
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Domov / Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
