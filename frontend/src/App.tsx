import Toolbar from "./components/Toolbar";
import SignalTree from "./components/SignalTree";
import WaveformViewport from "./components/WaveformViewport";
import StatusBar from "./components/StatusBar";
import { useEffect, useState } from "react";
import { useAppStore } from "./state/store";

export default function App() {
  const [treeWidth, setTreeWidth] = useState(280);
  const [treeCollapsed, setTreeCollapsed] = useState(false);

  // 全局快捷键：↑ 放大、↓ 缩小（与工具栏按钮等价，固定左边界）
  const timeWindow = useAppStore((s) => s.timeWindow);
  const setTimeWindow = useAppStore((s) => s.setTimeWindow);
  const doc = useAppStore((s) => s.doc);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!doc.opened || !timeWindow) return;
      // 输入框聚焦时不拦截方向键
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const span = timeWindow.end - timeWindow.start;
        setTimeWindow({ start: timeWindow.start, end: timeWindow.start + Math.max(1, span / 2) });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const span = timeWindow.end - timeWindow.start;
        setTimeWindow({ start: timeWindow.start, end: timeWindow.start + span * 2 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc.opened, timeWindow, setTimeWindow]);

  return (
    <div className="flex h-full w-full flex-col bg-wavebg text-text1">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {!treeCollapsed && (
          <>
            <SignalTree width={treeWidth} />
            {/* 拖拽调宽分隔条 */}
            <div
              className="w-[3px] cursor-col-resize bg-panel2 hover:bg-accent/60"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = treeWidth;
                const onMove = (ev: MouseEvent) => {
                  const w = Math.min(480, Math.max(200, startW + (ev.clientX - startX)));
                  setTreeWidth(w);
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            />
          </>
        )}
        <div className="relative flex-1">
          <WaveformViewport />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
