import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// ============================================================================
// 调试日志：重写 console.*，把前端日志通过 IPC 转发到后端，
// 由 C++ 写入 exe 同目录的 debug.log，便于核对前后端数据是否一致。
// 仅在后端桥接存在时生效；浏览器调试模式（无桥接）保持原输出。
// ============================================================================
function installDebugLogForwarding() {
  type Bridge = { __tauricpp__?: { invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown> } };
  const w = window as unknown as Bridge;
  if (!w.__tauricpp__) return;

  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  const send = (level: string, args: unknown[]) => {
    try {
      const ts = new Date().toISOString().slice(11, 23);
      const msg =
        `[${ts}] ` +
        args
          .map((a) => {
            if (typeof a === "string") return a;
            try {
              const s = JSON.stringify(a);
              return s === undefined ? String(a) : s.length > 2000 ? s.slice(0, 2000) + "...(truncated)" : s;
            } catch {
              return String(a);
            }
          })
          .join(" ");
      w.__tauricpp__?.invoke("debug.log", { level, msg }).catch(() => {});
    } catch {
      /* 日志失败不影响主流程 */
    }
  };

  console.log = (...args: unknown[]) => { orig.log(...args); send("log", args); };
  console.info = (...args: unknown[]) => { orig.info(...args); send("info", args); };
  console.warn = (...args: unknown[]) => { orig.warn(...args); send("warn", args); };
  console.error = (...args: unknown[]) => { orig.error(...args); send("error", args); };
  console.debug = (...args: unknown[]) => { orig.debug(...args); send("debug", args); };

  console.log("[main] console forwarded to backend debug.log");
}

installDebugLogForwarding();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
