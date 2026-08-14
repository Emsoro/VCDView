import Toolbar from "./components/Toolbar";
import SignalTree from "./components/SignalTree";
import WaveformViewport from "./components/WaveformViewport";
import StatusBar from "./components/StatusBar";
import { useState } from "react";

export default function App() {
  const [treeWidth, setTreeWidth] = useState(280);
  const [treeCollapsed, setTreeCollapsed] = useState(false);

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
