import type { Radix } from "../types/waveform";

/** 将二进制值字符串按指定进制格式化 */
export function formatValue(bin: string, radix: Radix): string {
  if (bin === "" || bin === undefined) return "";
  if (bin === "x" || bin === "z") return bin.toUpperCase();
  // 含未知位时按原始字符串返回（逐位映射 x/z）
  if (/[xzXZ]/.test(bin)) {
    return mapUnknownBits(bin, radix);
  }
  const sign = bin.startsWith("-") ? "-" : "";
  const bits = sign ? bin.slice(1) : bin;
  const val = BigInt("0b" + bits);
  switch (radix) {
    case "bin":
      return bin;
    case "oct":
      return sign + val.toString(8);
    case "dec":
      return sign + val.toString(10);
    case "hex":
      return sign + val.toString(16).toUpperCase();
    case "ascii": {
      const bytes = [];
      for (let i = 0; i < bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8).padEnd(8, "0"), 2));
      }
      return bytes
        .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
        .join("");
    }
    default:
      return bin;
  }
}

/** 含 x/z 位时按分组映射 */
function mapUnknownBits(bin: string, radix: Radix): string {
  const group = radix === "oct" ? 3 : radix === "hex" ? 4 : 8;
  if (radix === "bin") return bin;
  if (radix === "dec") return bin; // 无法安全转换，原样返回
  // 从低位开始分组
  const chars = bin.split("");
  const groups: string[] = [];
  for (let i = chars.length; i > 0; i -= group) {
    const start = Math.max(0, i - group);
    groups.unshift(chars.slice(start, i).join(""));
  }
  return groups
    .map((g) => {
      if (/[01]/.test(g) && !/[xzXZ]/.test(g)) {
        return BigInt("0b" + g).toString(radix === "oct" ? 8 : 16).toUpperCase();
      }
      // 含 x/z：逐位映射
      return g
        .split("")
        .map((c) => {
          if (c === "0") return "0";
          if (c === "1") return "1";
          return c.toUpperCase();
        })
        .join("");
    })
    .join("");
}

/** 时间格式化（自适应单位） */
export function formatTime(t: number, timescale?: string): string {
  if (t === undefined || t === null) return "";
  const ts = timescale || "1s";
  return `${t} ${ts}`;
}

/** 压缩大数字显示 */
export function compactNumber(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "G";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

/** 文件大小显示 */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(2) + " GB";
  if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(2) + " MB";
  if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(1) + " KB";
  return bytes + " B";
}
