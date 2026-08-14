import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../state/store";
import { queryWaveform } from "../api/tauricpp";
import { drawWaveform, ROW_H, TIME_AXIS_H, LABEL_W } from "../utils/draw";
import { formatValue } from "../utils/format";
import type { ChangePoint } from "../types/waveform";

export default function WaveformCanvas() {
  const viewSignals = useAppStore((s) => s.viewSignals);
  const radix = useAppStore((s) => s.radix);
  const markerTime = useAppStore((s) => s.markerTime);
  const setMarker = useAppStore((s) => s.setMarker);
  const timeWindow = useAppStore((s) => s.timeWindow);
  const setTimeWindow = useAppStore((s) => s.setTimeWindow);
  const setLoading = useAppStore((s) => s.setLoading);
  const setCanvasWidth = useAppStore((s) => s.setCanvasWidth);
  const setCursorTime = useAppStore((s) => s.setCursorTime);
  const cursorMode = useAppStore((s) => s.cursorMode);
  const showSignalNames = useAppStore((s) => s.showSignalNames);
  const showTimeline = useAppStore((s) => s.showTimeline);
  const showWaveform = useAppStore((s) => s.showWaveform);
  const moveSignal = useAppStore((s) => s.moveSignal);
  const removeSignal = useAppStore((s) => s.removeSignal);
  const doc = useAppStore((s) => s.doc);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastWRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);
  const [data, setData] = useState<Map<number, ChangePoint[]>>(new Map());
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const dragRef = useRef({ x: 0, startT: 0, active: false });

  // ---- 按需加载（防抖 100ms）----
  useEffect(() => {
    if (!viewSignals.length || !timeWindow) {
      setData(new Map());
      return;
    }
    const tw = timeWindow;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const w = canvasRef.current?.clientWidth ?? 1000;
        const res = await queryWaveform({
          time_start: tw.start,
          time_end: tw.end,
          signal_ids: viewSignals.map((s) => s.id),
          max_points: Math.max(64, Math.floor(w * 2)),
        });
        const map = new Map<number, ChangePoint[]>();
        for (const s of res.signals) map.set(s.id, s.changes);
        setData(map);
      } catch (err) {
        console.error("waveform.query failed:", err);
      } finally {
        setLoading(false);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [timeWindow, viewSignals, setLoading]);

  // ---- 绘制 ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = rect.width;
    const H = rect.height;
    if (W <= 0 || H <= 0) return;
    // 上报画布宽度（供工具栏计算每像素时间 / 原始缩放）
    if (W !== lastWRef.current) {
      lastWRef.current = W;
      setCanvasWidth(W);
    }
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (!timeWindow) return;
    const axisH = showTimeline ? TIME_AXIS_H : 0;
    drawWaveform({
      ctx,
      width: W,
      height: H,
      dpr,
      timeStart: timeWindow.start,
      timeEnd: timeWindow.end,
      rowH: ROW_H,
      labelW: LABEL_W,
      timeAxisH: axisH,
      scrollY,
      signals: viewSignals,
      data,
      radix,
      markerTime,
      hoverRow,
      mouseTime: null,
    });
  }, [timeWindow, viewSignals, data, radix, markerTime, scrollY, hoverRow, showTimeline]);

  // ---- 交互 ----
  const xToTime = useCallback(
    (clientX: number): number => {
      const tw = timeWindow;
      const canvas = canvasRef.current;
      if (!tw || !canvas) return tw?.start ?? 0;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      return tw.start + (x / rect.width) * (tw.end - tw.start);
    },
    [timeWindow]
  );

  /** 缩放：固定左边界不变，仅改变右边界（factor>1 放大，<1 缩小） */
  function zoomAt(factor: number) {
    const tw = timeWindow;
    if (!tw) return;
    const span = tw.end - tw.start;
    const newSpan = Math.max(1, span * factor);
    setTimeWindow({ start: tw.start, end: tw.start + newSpan });
  }

  function onWheel(e: React.WheelEvent) {
    if (!timeWindow) return;
    e.preventDefault();
    if (e.ctrlKey) {
      // Ctrl+滚轮：缩放（固定左边界，上滚放大、下滚缩小）
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      zoomAt(factor);
    } else if (e.shiftKey) {
      // Shift+滚轮：水平平移
      const rect = canvasRef.current!.getBoundingClientRect();
      const dx = (e.deltaY / rect.width) * (timeWindow.end - timeWindow.start);
      setTimeWindow({ start: timeWindow.start + dx, end: timeWindow.end + dx });
    } else {
      // 普通滚轮：垂直滚动（由滚动容器处理）
      return;
    }
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!timeWindow) return;
    dragRef.current = { x: e.clientX, startT: xToTime(e.clientX), active: true };
  }

  function onMouseMove(e: React.MouseEvent) {
    const canvas = canvasRef.current;
    if (canvas && timeWindow) {
      const rect = canvas.getBoundingClientRect();
      const axisH = showTimeline ? TIME_AXIS_H : 0;
      const row = Math.floor((e.clientY - rect.top + scrollY - axisH) / ROW_H);
      setHoverRow(row >= 0 && row < viewSignals.length ? row : null);
      setCursorTime(Math.round(xToTime(e.clientX)));
    }
    if (dragRef.current.active && timeWindow) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const dt = (e.clientX - dragRef.current.x) / rect.width * (timeWindow.end - timeWindow.start);
      // 抓取模式：拖动时 Marker 跟随光标（GTKWave Grab 行为）
      if (cursorMode === "grab") {
        setMarker(Math.round(xToTime(e.clientX)));
      }
      setTimeWindow({
        start: dragRef.current.startT - dt,
        end: dragRef.current.startT - dt + (timeWindow.end - timeWindow.start),
      });
    }
  }

  function onMouseUp() {
    dragRef.current.active = false;
  }

  function onClick(e: React.MouseEvent) {
    const canvas = canvasRef.current;
    if (!canvas || !showTimeline) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < TIME_AXIS_H) {
      setMarker(markerTime === null ? xToTime(e.clientX) : null);
    }
  }

  function onDoubleClick() {
    setMarker(null);
  }

  const axisH = showTimeline ? TIME_AXIS_H : 0;
  const totalH = axisH + viewSignals.length * ROW_H;
  const firstRow = Math.max(0, Math.floor(scrollY / ROW_H));
  const visibleCount = Math.ceil((window.innerHeight || 800) / ROW_H) + 2;

  return (
    <div className="relative h-full w-full select-none">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-auto"
        onScroll={(e) => setScrollY(e.currentTarget.scrollTop)}
      >
        {/* 滚动撑高 */}
        <div style={{ height: totalH }} />

        {/* 行头（信号名 + 当前值） */}
        {showSignalNames && (
        <div className="pointer-events-none absolute left-0 top-0 w-[170px]">
          {/* 标题行：固定不动，与 Canvas 时间轴区域对齐 */}
          <div className="absolute left-0 right-0 top-0 flex h-[26px] items-center border-b border-panel2 bg-panel px-2 text-[11px] font-medium text-text2">
            信号
          </div>
          {/* 信号名行：起点在 axisH 下方，随滚动偏移（与波形行 y = axisH + i*rowH - scrollY 对齐） */}
          <div className="absolute left-0 right-0" style={{ top: axisH - scrollY }}>
            {viewSignals.slice(firstRow, firstRow + visibleCount).map((sig, i) => {
              const rowIdx = firstRow + i;
              const ch = data.get(sig.id);
              const lastVal = ch && ch.length ? ch[ch.length - 1].v : "";
              return (
                <div
                  key={sig.id}
                  className={`group flex h-[26px] items-center gap-1.5 border-b border-panel2 px-2 ${
                    hoverRow === rowIdx ? "bg-panel2/60" : "bg-panel/40"
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: sig.color }} />
                  <span className="truncate text-[11px] text-text1" title={sig.name}>
                    {sig.name}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-accent2">
                    {lastVal ? formatValue(lastVal, radix) : ""}
                  </span>
                  {/* hover 操作：上移 / 下移 / 删除 */}
                  <span className="hidden items-center gap-0.5 group-hover:flex">
                    <button
                      onClick={() => moveSignal(sig.id, -1)}
                      disabled={rowIdx === 0}
                      title="上移"
                      className="rounded px-0.5 text-text2 transition hover:bg-panel2 hover:text-accent2 disabled:opacity-30"
                    >
                      <span className="text-[10px]">↑</span>
                    </button>
                    <button
                      onClick={() => moveSignal(sig.id, 1)}
                      disabled={rowIdx === viewSignals.length - 1}
                      title="下移"
                      className="rounded px-0.5 text-text2 transition hover:bg-panel2 hover:text-accent2 disabled:opacity-30"
                    >
                      <span className="text-[10px]">↓</span>
                    </button>
                    <button
                      onClick={() => removeSignal(sig.id)}
                      title="从视图移除"
                      className="rounded px-0.5 text-text2 transition hover:bg-panel2 hover:text-danger"
                    >
                      <span className="text-[10px]">✕</span>
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* Canvas 波形区 */}
        {showWaveform && (
        <div
          className="absolute bottom-0 right-0 top-0"
          style={{ left: showSignalNames ? LABEL_W : 0 }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => {
            onMouseUp();
            setCursorTime(null);
          }}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
        >
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
        )}
      </div>
    </div>
  );
}
