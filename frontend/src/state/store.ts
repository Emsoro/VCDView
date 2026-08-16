import { create } from "zustand";
import type { DocInfo, DocumentState, Radix, ScopeNode } from "../types/waveform";

/** 波形视图中显示的信号 */
export interface ViewSignal {
  id: number;
  name: string;
  width: number;
  color: string;
  /** 抽取的比特位（>=0 表示从总线展开的单 bit；undefined 表示整向量/bus） */
  bit?: number;
}

/** 可见时间窗口 */
export interface TimeWindow {
  start: number;
  end: number;
}

interface AppState {
  doc: DocumentState;
  viewSignals: ViewSignal[];
  radix: Radix;
  markerTime: number | null;
  timeWindow: TimeWindow | null;
  loading: boolean;
  /** 波形画布宽度（px），供工具栏计算每像素时间 / 原始缩放 */
  canvasWidth: number;
  /** 鼠标在波形区悬停对应的时间 */
  cursorTime: number | null;
  /** 光标模式：move=拖动平移 / grab=拖动时 marker 跟随 */
  cursorMode: "move" | "grab";
  /** 视图选项：信号名栏 / 波形 / 时间轴 */
  showSignalNames: boolean;
  showWaveform: boolean;
  showTimeline: boolean;

  // actions
  setDocOpened: (info: DocInfo, tree: ScopeNode[]) => void;
  resetDoc: () => void;
  addSignal: (sig: ViewSignal) => void;
  removeSignal: (key: string) => void;
  clearSignals: () => void;
  moveSignal: (key: string, dir: -1 | 1) => void;
  setRadix: (r: Radix) => void;
  setMarker: (t: number | null) => void;
  setTimeWindow: (w: TimeWindow | null) => void;
  setLoading: (b: boolean) => void;
  setCanvasWidth: (w: number) => void;
  setCursorTime: (t: number | null) => void;
  setCursorMode: (m: "move" | "grab") => void;
  setShowSignalNames: (b: boolean) => void;
  setShowWaveform: (b: boolean) => void;
  setShowTimeline: (b: boolean) => void;
}

const SIGNAL_COLORS = [
  "#58A6FF",
  "#4ADE80",
  "#FACC15",
  "#F87171",
  "#C792EA",
  "#79C0FF",
  "#7EE787",
  "#FFA657",
  "#FF7B72",
  "#A5D6FF",
];

/** 信号唯一键：整向量用 id，展开单 bit 用 id.bit */
export function sigKey(sig: { id: number; bit?: number }): string {
  return sig.bit === undefined || sig.bit < 0 ? `${sig.id}` : `${sig.id}.${sig.bit}`;
}

export const useAppStore = create<AppState>((set) => ({
  doc: { opened: false, info: null, tree: null },
  viewSignals: [],
  radix: "hex",
  markerTime: null,
  timeWindow: null,
  loading: false,
  canvasWidth: 800,
  cursorTime: null,
  cursorMode: "move",
  showSignalNames: true,
  showWaveform: true,
  showTimeline: true,

  setDocOpened: (info, tree) =>
    set((s) => ({
      doc: { opened: true, info, tree },
      viewSignals: [],
      markerTime: null,
      timeWindow: {
        start: info.min_time,
        end: info.viewport_end ?? info.max_time,
      },
    })),
  resetDoc: () =>
    set({ doc: { opened: false, info: null, tree: null }, viewSignals: [], markerTime: null, timeWindow: null }),
  addSignal: (sig) =>
    set((s) => {
      if (s.viewSignals.some((x) => sigKey(x) === sigKey(sig))) return s;
      const color = SIGNAL_COLORS[s.viewSignals.length % SIGNAL_COLORS.length];
      return { viewSignals: [...s.viewSignals, { ...sig, color }] };
    }),
  removeSignal: (key) => set((s) => ({ viewSignals: s.viewSignals.filter((x) => sigKey(x) !== key) })),
  clearSignals: () => set({ viewSignals: [] }),
  moveSignal: (key, dir) =>
    set((s) => {
      const idx = s.viewSignals.findIndex((x) => sigKey(x) === key);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= s.viewSignals.length) return s;
      const arr = [...s.viewSignals];
      const [sig] = arr.splice(idx, 1);
      arr.splice(to, 0, sig);
      return { viewSignals: arr };
    }),
  setRadix: (r) => set({ radix: r }),
  setMarker: (t) => set({ markerTime: t }),
  setTimeWindow: (w) => set({ timeWindow: w }),
  setLoading: (b) => set({ loading: b }),
  setCanvasWidth: (w) => set({ canvasWidth: w }),
  setCursorTime: (t) => set({ cursorTime: t }),
  setCursorMode: (m) => set({ cursorMode: m }),
  setShowSignalNames: (b) => set({ showSignalNames: b }),
  setShowWaveform: (b) => set({ showWaveform: b }),
  setShowTimeline: (b) => set({ showTimeline: b }),
}));
