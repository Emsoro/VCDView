import { useMemo, useState } from "react";
import { useAppStore, sigKey } from "../state/store";
import type { ScopeNode } from "../types/waveform";
import { FiSearch, FiChevronRight, FiChevronDown, FiX } from "react-icons/fi";
import {
  FaRegSquare,
  FaRegDotCircle,
  FaHashtag,
  FaWaveSquare,
} from "react-icons/fa";
import type { ReactNode } from "react";

interface SignalTreeProps {
  width: number;
}

/** 信号类型图标 */
function TypeIcon({ node }: { node: ScopeNode }) {
  if (node.type === "scope") return null;
  switch (node.type) {
    case "reg":
      return <FaRegDotCircle size={10} className="text-warn" />;
    case "integer":
      return <FaHashtag size={10} className="text-accent2" />;
    case "real":
      return <FaWaveSquare size={10} className="text-good" />;
    default:
      return <FaRegSquare size={10} className="text-accent2" />;
  }
}

export default function SignalTree({ width }: SignalTreeProps) {
  const doc = useAppStore((s) => s.doc);
  const viewSignals = useAppStore((s) => s.viewSignals);
  const addSignal = useAppStore((s) => s.addSignal);
  const removeSignal = useAppStore((s) => s.removeSignal);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const viewKeys = useMemo(() => new Set(viewSignals.map((s) => sigKey(s))), [viewSignals]);

  /** 匹配信号 id 集合（搜索过滤） */
  const matchedIds = useMemo(() => {
    if (!query.trim()) return null;
    const set = new Set<number>();
    const walk = (node: ScopeNode, path: string): boolean => {
      const full = path ? `${path}.${node.name}` : node.name;
      const selfMatch = node.name.toLowerCase().includes(query.toLowerCase()) ||
        full.toLowerCase().includes(query.toLowerCase());
      if (node.type !== "scope") {
        if (selfMatch) set.add(node.id);
        return selfMatch;
      }
      let childMatch = false;
      for (const c of node.children ?? []) {
        if (walk(c, full)) childMatch = true;
      }
      if (childMatch) {
        set.add(node.id);
        setExpanded((prev) => new Set(prev).add(node.id));
      }
      return selfMatch || childMatch;
    };
    (doc.tree ?? []).forEach((n) => walk(n, ""));
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, doc.tree]);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSignal(node: ScopeNode, path: string, bit?: number) {
    const sid = node.signal_idx ?? -1;
    const key = sigKey({ id: sid, bit });
    if (viewKeys.has(key)) {
      removeSignal(key);
    } else {
      // 信号名只用 node.name，不带 scope 路径前缀（GTKWave 风格）
      const label = bit === undefined ? node.name : `${node.name}[${bit}]`;
      addSignal({ id: sid, name: label, width: node.width ?? 1, color: "", bit });
    }
  }

  function renderNode(node: ScopeNode, depth: number, path: string): ReactNode {
    const isScope = node.type === "scope";
    const isVector = !isScope && (node.width ?? 1) > 1;
    const full = path ? `${path}.${node.name}` : node.name;
    const isOpen = expanded.has(node.id);
    const visible = !matchedIds || matchedIds.has(node.id);
    if (!visible) return null;
    const checked = viewKeys.has(sigKey({ id: node.signal_idx ?? -1, bit: undefined }));

    const indent = { paddingLeft: `${depth * 14 + 8}px` };

    // 向量信号展开后的各 bit 子节点
    const bitChildren: ReactNode[] = [];
    if (isVector && isOpen) {
      const msb = node.msb ?? (node.width ?? 1) - 1;
      const lsb = node.lsb ?? 0;
      const step = msb >= lsb ? -1 : 1;
      for (let i = msb; step > 0 ? i <= lsb : i >= lsb; i += step) {
        const bkey = sigKey({ id: node.signal_idx ?? -1, bit: i });
        const bchecked = viewKeys.has(bkey);
        bitChildren.push(
          <div
            key={`${node.id}.${i}`}
            className="flex cursor-pointer items-center gap-1 rounded px-1 py-[3px] transition hover:bg-panel2"
            style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}
            onClick={() => toggleSignal(node, path, i)}
          >
            <span
              className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ${
                bchecked ? "border-accent bg-accent" : "border-text2/50 hover:border-accent2"
              }`}
            >
              {bchecked && <FiX size={9} className="text-text1" />}
            </span>
            <TypeIcon node={{ ...node, type: "wire", width: 1 }} />
            <span className={`truncate text-[12px] ${bchecked ? "text-accent2" : "text-text1"}`}>
              {node.name}[{i}]
            </span>
          </div>
        );
      }
    }

    return (
      <div key={node.id}>
        <div
          className="flex cursor-pointer items-center gap-1 rounded px-1 py-[3px] transition hover:bg-panel2"
          style={indent}
          onClick={() => (isScope ? toggle(node.id) : toggleSignal(node, path))}
        >
          {isScope ? (
            <span className="text-text2">
              {isOpen ? <FiChevronDown size={11} /> : <FiChevronRight size={11} />}
            </span>
          ) : isVector ? (
            <span
              className="text-text2"
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.id);
              }}
            >
              {isOpen ? <FiChevronDown size={11} /> : <FiChevronRight size={11} />}
            </span>
          ) : (
            <span
              className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ${
                checked ? "border-accent bg-accent" : "border-text2/50 hover:border-accent2"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                toggleSignal(node, path);
              }}
            >
              {checked && <FiX size={9} className="text-text1" />}
            </span>
          )}
          <TypeIcon node={node} />
          <span
            className={`truncate text-[12px] ${
              isScope ? "font-medium text-text1" : checked ? "text-accent2" : "text-text1"
            }`}
          >
            {node.name}
          </span>
          {!isScope && (
            <span className="ml-auto pr-1 text-[10px] text-text2">
              {isVector ? `[${node.msb}:${node.lsb}]` : ""}
            </span>
          )}
        </div>
        {isScope && isOpen && (
          <div>
            {node.children?.map((c) => renderNode(c, depth + 1, full))}
          </div>
        )}
        {isVector && isOpen && <div>{bitChildren}</div>}
      </div>
    );
  }

  return (
    <aside
      className="glass-panel flex shrink-0 flex-col border-r border-panel2"
      style={{ width }}
    >
      <div className="flex items-center gap-2 border-b border-panel2 px-3 py-2">
        <span className="text-[13px] font-semibold">信号</span>
        <span className="text-[10px] text-text2">{viewSignals.length} in view</span>
        {doc.opened && (
          <div className="ml-auto flex items-center gap-1.5 rounded-md bg-panel px-2 py-1">
            <FiSearch size={12} className="text-text2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-20 bg-transparent text-[11px] text-text1 outline-none placeholder:text-text2"
              placeholder="搜索信号…"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {!doc.opened ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-text2">
            <FiChevronRight size={18} className="text-text2/40" />
            <span className="text-[11px]">打开 VCD 文件后显示信号层次</span>
          </div>
        ) : (
          <div>
            {doc.tree?.map((n) => renderNode(n, 0, ""))}
            {matchedIds && matchedIds.size === 0 && (
              <div className="p-4 text-center text-[11px] text-text2">无匹配信号</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
