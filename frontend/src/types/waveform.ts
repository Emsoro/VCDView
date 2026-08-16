/** IPC 协议类型定义（与后端 src/ipc/commands.cpp 对应） */

/** 层次树节点 */
export interface ScopeNode {
  id: number;
  name: string;
  type: "scope" | "wire" | "reg" | "integer" | "real" | "parameter";
  children?: ScopeNode[];
  /** 信号节点：信号索引（与 waveform.query 的 signal_ids 一致） */
  signal_idx?: number;
  /** 信号节点：位宽 */
  width?: number;
  /** 信号节点：msb */
  msb?: number;
  /** 信号节点：lsb */
  lsb?: number;
  /** 信号节点：进制（后端转换用） */
  format?: number;
}

/** 文件打开结果 */
export interface OpenFileResult {
  ok: boolean;
  error?: string;
  path?: string;
  /** 文档摘要 */
  info?: DocInfo;
}

/** 文档摘要 */
export interface DocInfo {
  path: string;
  /** 文件大小（字节） */
  file_size: number;
  /** 时间单位 */
  timescale: string;
  /** 时间戳数量 */
  num_time_steps?: number;
  /** 最小时间 */
  min_time: number;
  /** 最大时间 */
  max_time: number;
  /** 信号总数 */
  num_signals: number;
  /** 模块数 */
  num_scopes: number;
  /** 推荐初始窗口结束时间（变化点密集时收敛到前 2000 个变化点） */
  viewport_end?: number;
}

/** 变化点 */
export interface ChangePoint {
  /** 时间索引（timeline 的下标） */
  t: number;
  /** 值（字符串编码） */
  v: string;
}

/** 波形查询请求 */
export interface WaveformQueryRequest {
  time_start: number;
  time_end: number;
  signal_ids: number[];
  /** 与 signal_ids 一一对应：-1=整向量，0..width-1=指定位 */
  bit_indices?: number[];
  max_points: number;
}

/** 波形查询响应 */
export interface WaveformQueryResult {
  /** 可见窗口内的时间轴（按像素列抽稀后的时间戳） */
  timeline: number[];
  /** 每个信号的变化点 */
  signals: {
    id: number;
    /** 信号位宽（来自文档） */
    width?: number;
    /** 本次查询抽取的比特位（>=0 时 values 为单字符） */
    bit?: number;
    changes: ChangePoint[];
  }[];
  /** 查询窗口是否已达文件末尾 */
  end: boolean;
}

/** 进制 */
export type Radix = "bin" | "oct" | "dec" | "hex" | "ascii";

/** 文档状态 */
export interface DocumentState {
  opened: boolean;
  info: DocInfo | null;
  tree: ScopeNode[] | null;
}
