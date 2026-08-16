import { useAppStore } from "../state/store";
import { formatTime } from "../utils/format";

/**
 * 状态栏：显示光标时间、Marker 时间与差值（对应 GTKWave 底部状态栏）。
 * Δ 为光标时间与 Marker 的时间差（T2 - T1）。
 */
export default function StatusBar() {
  const doc = useAppStore((s) => s.doc);
  const cursorTime = useAppStore((s) => s.cursorTime);
  const markerTime = useAppStore((s) => s.markerTime);
  const radix = useAppStore((s) => s.radix);
  const viewSignalCount = useAppStore((s) => s.viewSignals.length);
  const timescale = doc.info?.timescale ?? "";

  if (!doc.opened) return null;

  const delta =
    cursorTime !== null && markerTime !== null ? Math.abs(cursorTime - markerTime) : null;

  const Cell = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
    <div className="flex items-center gap-1.5 px-3">
      <span className="text-[10px] uppercase tracking-wide text-text3">{label}</span>
      <span className={`font-mono text-[11px] ${highlight ? "text-accent2" : "text-text1"}`}>
        {value}
      </span>
    </div>
  );

  return (
    <footer className="flex h-7 shrink-0 items-center border-t border-panel2 bg-panel text-text2">
      <Cell label="Time" value={cursorTime !== null ? formatTime(cursorTime, timescale) : "—"} />
      <span className="h-3 w-px bg-panel2" />
      <Cell
        label="T1"
        value={markerTime !== null ? formatTime(markerTime, timescale) : "—"}
        highlight={markerTime !== null}
      />
      <Cell
        label="Δ"
        value={delta !== null ? formatTime(delta, timescale) : "—"}
        highlight={delta !== null}
      />
      <div className="ml-auto flex items-center gap-3 px-3">
        <span className="font-mono text-[11px] text-text2">radix: {radix}</span>
        <span className="text-[11px] text-text2">{viewSignalCount} signals</span>
        {doc.info && (
          <span className="max-w-[260px] truncate text-[10px] text-text3" title={doc.info.path}>
            {doc.info.path}
          </span>
        )}
        <span className="text-[10px] text-text3">v1.0.1</span>
      </div>
    </footer>
  );
}
