import type {
  DocInfo,
  ScopeNode,
  WaveformQueryRequest,
  WaveformQueryResult,
} from "../types/waveform";

/**
 * TauriCPP 桥接封装。
 * 后端注入 window.__tauricpp__：{ invoke(cmd, args) => Promise, listen(event, cb), ... }
 */
declare global {
  interface Window {
    __tauricpp__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      listen: (event: string, cb: (data: unknown) => void) => void;
    };
  }
}

function hasBridge(): boolean {
  return typeof window.__tauricpp__ !== "undefined";
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasBridge()) {
    // 浏览器调试模式：无桥接时返回 mock，便于前端独立开发
    return mockInvoke<T>(cmd, args);
  }
  const result = (await window.__tauricpp__!.invoke(cmd, args)) as T;
  if (result && typeof result === "object" && "error" in result) {
    const r = result as { error?: string };
    if (r.error) throw new Error(r.error);
  }
  // 数据核对日志：摘要记录前端收到的响应，写入后端 debug.log
  try {
    if (cmd === "waveform.query") {
      const r = result as WaveformQueryResult;
      const sigs = (r?.signals ?? []).map((s) => `id=${s.id}:${(s.changes ?? []).length}ch`).join(" ");
      console.log(`[FE-recv] ${cmd} req_ids=${JSON.stringify(args?.signal_ids ?? [])} -> timeline=${(r?.timeline ?? []).length} ${sigs} end=${r?.end}`);
    } else if (cmd === "file.open") {
      console.log(`[FE-recv] ${cmd} -> ok=${JSON.stringify((result as { ok?: boolean }).ok)} path=${JSON.stringify((result as { path?: string }).path)} info=${JSON.stringify((result as { info?: unknown }).info)}`);
    } else if (cmd === "hierarchy.tree") {
      const arr = (result as { id?: number; name?: string; type?: string; width?: number }[]) ?? [];
      const names = arr.map((n) => `${n.name}(id=${n.id},type=${n.type},w=${n.width})`).join(", ");
      console.log(`[FE-recv] ${cmd} -> ${arr.length} top: ${names}`);
    } else {
      const s = JSON.stringify(result);
      console.log(`[FE-recv] ${cmd} -> ${s === undefined ? "undefined" : s.slice(0, 500)}`);
    }
  } catch {
    /* 日志失败不影响主流程 */
  }
  return result;
}

/** 打开文件（对话框 + 解析），成功后一并取回层次树 */
export async function openFile(): Promise<{ info: DocInfo; tree: ScopeNode[] } | null> {
  const res = await invoke<{ ok: boolean; cancelled?: boolean; error?: string; info?: DocInfo }>(
    "file.open", {}
  );
  if (!res.ok) {
    if (res.cancelled) return null;
    throw new Error(res.error || "打开文件失败");
  }
  const tree = await getHierarchyTree();
  return { info: res.info!, tree };
}

/** 按路径打开文件（跳过对话框），成功后一并取回层次树 */
export async function openPath(path: string): Promise<{ info: DocInfo; tree: ScopeNode[] } | null> {
  const res = await invoke<{ ok: boolean; cancelled?: boolean; error?: string; info?: DocInfo }>(
    "file.open", { path }
  );
  if (!res.ok) {
    if (res.cancelled) return null;
    throw new Error(res.error || "打开文件失败");
  }
  const tree = await getHierarchyTree();
  return { info: res.info!, tree };
}

/** 重新加载当前文件（外部修改后刷新） */
export async function reloadFile(): Promise<{ ok: boolean; error?: string; info?: DocInfo }> {
  return invoke<{ ok: boolean; error?: string; info?: DocInfo }>("file.reload", {});
}

/** 获取最近文件列表；可传 add 记录一次打开 */
export async function getRecentFiles(): Promise<string[]> {
  return invoke<string[]>("file.recent", {});
}

/** 获取文档信息 */
export function getDocInfo(): Promise<DocInfo | null> {
  return invoke<DocInfo | null>("doc.info", {});
}

/** 获取层次树 */
export function getHierarchyTree(): Promise<ScopeNode[]> {
  return invoke<ScopeNode[]>("hierarchy.tree", {});
}

/** 查询波形数据 */
export function queryWaveform(req: WaveformQueryRequest): Promise<WaveformQueryResult> {
  return invoke<WaveformQueryResult>("waveform.query", req as unknown as Record<string, unknown>);
}

/** 订阅后端事件 */
export function listen(event: string, cb: (data: unknown) => void): void {
  if (hasBridge()) {
    window.__tauricpp__!.listen(event, cb);
  }
}

export { hasBridge };

// ============================================================================
// 浏览器调试用 mock（无后端时，模拟一份 demo VCD 文档）
// ============================================================================

let mockOpened = false;
const MOCK_RECENT: string[] = ["demo.vcd (mock)", "test_data/demo.vcd"];
const MOCK_TS = "1ns";

const MOCK_TREE: ScopeNode[] = [
  {
    id: 1, name: "top", type: "scope", children: [
      {
        id: 2, name: "u_clk", type: "scope", children: [
          { id: 10, name: "clk", type: "wire", signal_idx: 10, width: 1, msb: 0, lsb: 0 },
          { id: 11, name: "rst_n", type: "wire", signal_idx: 11, width: 1, msb: 0, lsb: 0 },
        ],
      },
      {
        id: 3, name: "u_alu", type: "scope", children: [
          { id: 12, name: "a", type: "wire", signal_idx: 12, width: 8, msb: 7, lsb: 0 },
          { id: 13, name: "b", type: "wire", signal_idx: 13, width: 8, msb: 7, lsb: 0 },
          { id: 14, name: "result", type: "reg", signal_idx: 14, width: 8, msb: 7, lsb: 0 },
          { id: 15, name: "carry", type: "wire", signal_idx: 15, width: 1, msb: 0, lsb: 0 },
        ],
      },
      {
        id: 4, name: "u_ctrl", type: "scope", children: [
          { id: 16, name: "state", type: "reg", signal_idx: 16, width: 2, msb: 1, lsb: 0 },
          { id: 17, name: "enable", type: "wire", signal_idx: 17, width: 1, msb: 0, lsb: 0 },
        ],
      },
      { id: 18, name: "counter", type: "integer", signal_idx: 18, width: 32, msb: 31, lsb: 0 },
      { id: 19, name: "busy", type: "wire", signal_idx: 19, width: 1, msb: 0, lsb: 0 },
    ],
  },
];

const MOCK_INFO: DocInfo = {
  path: "demo.vcd (mock)",
  file_size: 10240,
  timescale: MOCK_TS,
  min_time: 0,
  max_time: 4000,
  num_signals: 10,
  num_scopes: 4,
};

/** mock 波形数据生成：按信号 id 生成确定性的变化序列 */
function mockWaveform(req: WaveformQueryRequest): WaveformQueryResult {
  const t0 = Math.floor(req.time_start / 10) * 10;
  const timeline: number[] = [];
  const signals = req.signal_ids.map((id) => {
    const changes: { t: number; v: string }[] = [];
    const w = id >= 12 && id <= 14 ? 8 : id === 16 ? 2 : id === 18 ? 32 : 1;
    let v = 0;
    for (let t = t0; t <= req.time_end; t += 10) {
      const step = Math.floor(t / 10);
      let next = v;
      switch (id % 5) {
        case 0: next = step % 2; break;                    // clk 类：方波
        case 1: next = (step * 7) & 0xff; break;           // 递增
        case 2: next = (step * 3 + 5) & 0xff; break;
        case 3: next = (step % 4); break;
        case 4: next = (step * 13) & 0xffffffff; break;
      }
      next = next & ((1 << w) - 1);
      if (next !== v || changes.length === 0) {
        v = next;
        changes.push({ t, v: v.toString(2).padStart(w, "0") });
        if (timeline[timeline.length - 1] !== t) timeline.push(t);
      }
    }
    return { id, changes };
  });
  return { timeline, signals, end: req.time_end >= MOCK_INFO.max_time };
}

async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  console.warn(`[tauricpp] mock invoke: ${cmd}`);
  switch (cmd) {
    case "dialog.open":
      return { files: [], cancelled: true } as T;
    case "file.open":
      mockOpened = true;
      return { ok: true, path: MOCK_INFO.path, info: MOCK_INFO } as T;
    case "file.reload":
      mockOpened = true;
      return { ok: true, info: MOCK_INFO } as T;
    case "file.recent":
      if (args && typeof args.add === "string" && !MOCK_RECENT.includes(args.add)) {
        MOCK_RECENT.unshift(args.add);
      }
      return (MOCK_RECENT as T);
    case "doc.info":
      return mockOpened ? (MOCK_INFO as T) : (null as T);
    case "hierarchy.tree":
      return (mockOpened ? MOCK_TREE : []) as T;
    case "waveform.query":
      return mockWaveform((args ?? {}) as unknown as WaveformQueryRequest) as T;
    case "system.info":
      return { framework: "TauriCPP", backend: "mock" } as T;
    default:
      throw new Error(`[mock] unknown command: ${cmd}`);
  }
}
