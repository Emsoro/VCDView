import { useEffect, useState } from "react";
import { useAppStore } from "../state/store";
import { openFile, openPath, getRecentFiles } from "../api/tauricpp";
import { formatFileSize, formatTime } from "../utils/format";
import { FiFolder, FiZoomIn, FiZoomOut, FiMaximize, FiX, FiClock } from "react-icons/fi";

export default function Toolbar() {
  const doc = useAppStore((s) => s.doc);
  const setDocOpened = useAppStore((s) => s.setDocOpened);
  const resetDoc = useAppStore((s) => s.resetDoc);
  const timeWindow = useAppStore((s) => s.timeWindow);
  const setTimeWindow = useAppStore((s) => s.setTimeWindow);
  const loading = useAppStore((s) => s.loading);

  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [recentOpen, setRecentOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  // 时间窗口变化时同步 From/To 输入框
  useEffect(() => {
    if (timeWindow) {
      setFromInput(String(Math.round(timeWindow.start)));
      setToInput(String(Math.round(timeWindow.end)));
    }
  }, [timeWindow]);

  // 打开文档后刷新最近文件列表
  useEffect(() => {
    if (doc.opened) {
      getRecentFiles().then(setRecent).catch(() => {});
    }
  }, [doc.opened]);

  async function handleOpen() {
    const res = await openFile();
    if (res) {
      setDocOpened(res.info, res.tree);
      getRecentFiles().then(setRecent).catch(() => {});
    }
  }

  /** 从最近文件列表打开 */
  async function openRecent(path: string) {
    setRecentOpen(false);
    try {
      const res = await openPath(path);
      if (res) setDocOpened(res.info, res.tree);
    } catch (err) {
      console.error("open recent failed:", err);
    }
  }

  /** 展开/收起最近文件下拉 */
  function toggleRecent() {
    setRecentOpen((v) => {
      if (!v) getRecentFiles().then(setRecent).catch(() => {});
      return !v;
    });
  }

  /** 缩小：固定左边界不变，范围 ×2（如 0~10 → 0~20） */
  function zoomOut() {
    if (!timeWindow) return;
    const span = timeWindow.end - timeWindow.start;
    setTimeWindow({ start: timeWindow.start, end: timeWindow.start + span * 2 });
  }

  /** 放大：固定左边界不变，范围 ÷2（如 0~20 → 0~10） */
  function zoomIn() {
    if (!timeWindow) return;
    const span = timeWindow.end - timeWindow.start;
    const newSpan = Math.max(1, span / 2);
    setTimeWindow({ start: timeWindow.start, end: timeWindow.start + newSpan });
  }

  /** 显示全部：从文档最小时间到最大时间 */
  function zoomFit() {
    if (!doc.info) return;
    setTimeWindow({ start: doc.info.min_time, end: doc.info.max_time });
  }

  /** 应用 From/To 设定的展示范围 */
  function commitRange() {
    const s = parseFloat(fromInput);
    const e = parseFloat(toInput);
    if (isNaN(s) || isNaN(e) || e <= s) return;
    setTimeWindow({ start: s, end: e });
  }

  return (
    <header className="glass-panel z-10 flex h-11 shrink-0 items-center gap-2 border-b border-panel2 px-3">
      {/* 打开文件 */}
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-text1 transition hover:bg-accent2 disabled:opacity-50"
        title="打开 VCD 文件"
      >
        <FiFolder size={14} />
        <span>打开</span>
      </button>

      {/* 最近文件 */}
      <div className="relative">
        <button
          onClick={toggleRecent}
          className="flex items-center gap-1 rounded-md bg-panel px-2 py-1.5 text-text2 transition hover:bg-panel2 hover:text-text1"
          title="最近文件"
        >
          <FiClock size={13} />
          <span className="hidden text-[11px] sm:inline">最近</span>
        </button>
        {recentOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setRecentOpen(false)} />
            <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-panel2 bg-panel shadow-xl">
              <div className="border-b border-panel2 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-text2">
                最近文件
              </div>
              {recent.length === 0 ? (
                <div className="px-2.5 py-3 text-[11px] text-text3">暂无最近文件</div>
              ) : (
                recent.map((p) => (
                  <button
                    key={p}
                    onClick={() => openRecent(p)}
                    title={p}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-panel2"
                  >
                    <span className="truncate text-[11px] text-text1">
                      {p.split(/[\\/]/).pop()}
                    </span>
                    <span className="ml-auto truncate text-[10px] text-text3">{p}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {doc.opened && (
        <>
          {/* 缩放控制组：缩小 / 放大 / 显示全部 */}
          <div className="mx-1 flex items-center gap-0.5 rounded-md bg-panel px-1 py-1">
            <IconBtn title="缩小（↓ / 左边界不变，范围×2）" onClick={zoomOut}>
              <FiZoomOut size={13} />
            </IconBtn>
            <IconBtn title="放大（↑ / 左边界不变，范围÷2）" onClick={zoomIn}>
              <FiZoomIn size={13} />
            </IconBtn>
            <IconBtn title="显示全部 (Fit)" onClick={zoomFit}>
              <FiMaximize size={13} />
            </IconBtn>
          </div>

          {/* From / To 展示范围 */}
          <div
            className="mx-1 flex items-center gap-1 rounded-md bg-panel px-2 py-1"
            title="设置展示范围，回车应用"
          >
            <span className="text-[10px] text-text2">From</span>
            <input
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRange();
              }}
              className="w-16 rounded bg-panel2 px-1.5 py-0.5 font-mono text-[11px] text-text1 outline-none ring-accent placeholder:text-text3 focus:ring-1"
            />
            <span className="text-[10px] text-text2">To</span>
            <input
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRange();
              }}
              className="w-16 rounded bg-panel2 px-1.5 py-0.5 font-mono text-[11px] text-text1 outline-none ring-accent placeholder:text-text3 focus:ring-1"
            />
          </div>

          {/* 文档信息 */}
          {doc.info && (
            <div className="ml-auto flex items-center gap-3 text-text2">
              <span className="hidden max-w-[260px] truncate text-text1" title={doc.info.path}>
                {doc.info.path.split(/[\\/]/).pop()}
              </span>
              <span title="文件大小">{formatFileSize(doc.info.file_size)}</span>
              <span title="信号数">{doc.info.num_signals} signals</span>
              <span title="时间范围">
                {formatTime(timeWindow?.start ?? doc.info.min_time, doc.info.timescale)} –{" "}
                {formatTime(timeWindow?.end ?? doc.info.max_time, doc.info.timescale)}
              </span>
              {loading && <span className="animate-pulse text-accent2">加载中…</span>}
              <button
                onClick={resetDoc}
                className="rounded-md p-1 text-text2 transition hover:bg-panel2 hover:text-danger"
                title="关闭文件"
              >
                <FiX size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </header>
  );
}

function IconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-text2 transition hover:bg-panel2 hover:text-accent2 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}
