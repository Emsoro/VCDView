import type { ChangePoint, Radix } from "../types/waveform";
import type { ViewSignal } from "../state/store";
import { formatValue } from "./format";

/** 绘制状态 */
export interface DrawState {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  timeStart: number;
  timeEnd: number;
  rowH: number;
  labelW: number;
  timeAxisH: number;
  scrollY: number;
  signals: ViewSignal[];
  data: Map<number, ChangePoint[]>;
  radix: Radix;
  markerTime: number | null;
  hoverRow: number | null;
  mouseTime: number | null;
}

export const ROW_H = 26;
export const TIME_AXIS_H = 26;
export const LABEL_W = 170;

const GRID_COLOR = "#1C2128";
const AXIS_BG = "#161B22";
const AXIS_LINE = "#30363D";
const TEXT_COLOR = "#8B949E";
const XZ_COLOR = "#58A6FF";

function timeToX(s: DrawState, t: number): number {
  const span = s.timeEnd - s.timeStart;
  if (span <= 0) return 0;
  return ((t - s.timeStart) / span) * s.width;
}

/** 归一化时间轴刻度步长 */
export function niceTimeStep(raw: number): number {
  if (raw <= 0) raw = 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const frac = raw / base;
  let nf = 1;
  if (frac < 2) nf = 1;
  else if (frac < 5) nf = 2;
  else nf = 5;
  return nf * base;
}

function drawTimeAxis(s: DrawState) {
  const { ctx, width, timeAxisH } = s;
  ctx.fillStyle = AXIS_BG;
  ctx.fillRect(0, 0, width, timeAxisH);
  ctx.strokeStyle = AXIS_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, timeAxisH - 0.5);
  ctx.lineTo(width, timeAxisH - 0.5);
  ctx.stroke();

  const span = s.timeEnd - s.timeStart;
  if (span <= 0) return;
  const pxPerTime = width / span;
  const step = niceTimeStep(80 / pxPerTime);
  const startTick = Math.ceil(s.timeStart / step) * step;

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "10px Consolas";
  ctx.textAlign = "left";
  for (let t = startTick; t <= s.timeEnd; t += step) {
    const x = timeToX(s, t);
    if (x < 0 || x > width) continue;
    ctx.strokeStyle = AXIS_LINE;
    ctx.beginPath();
    ctx.moveTo(x, timeAxisH - 8);
    ctx.lineTo(x, timeAxisH - 2);
    ctx.stroke();
    ctx.fillText(String(t), x + 3, timeAxisH - 10);
  }
}

function drawMarker(s: DrawState) {
  if (s.markerTime === null) return;
  const { ctx, width, height, timeAxisH } = s;
  const x = timeToX(s, s.markerTime);
  if (x < 0 || x > width) return;

  // 垂直高亮线
  ctx.fillStyle = "rgba(31, 111, 235, 0.12)";
  ctx.fillRect(x, timeAxisH, 1.5, height - timeAxisH);
  ctx.strokeStyle = "#58A6FF";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, timeAxisH);
  ctx.lineTo(x, height);
  ctx.stroke();

  // 时间轴上的标记
  ctx.fillStyle = "#1F6FEB";
  ctx.beginPath();
  ctx.moveTo(x - 4, timeAxisH - 1);
  ctx.lineTo(x + 4, timeAxisH - 1);
  ctx.lineTo(x, timeAxisH + 6);
  ctx.closePath();
  ctx.fill();

  // 时间标签
  const label = String(s.markerTime);
  ctx.font = "10px Consolas";
  const tw = ctx.measureText(label).width + 8;
  let bx = x + 6;
  if (bx + tw > width) bx = x - tw - 6;
  ctx.fillStyle = "#1F6FEB";
  ctx.fillRect(bx, timeAxisH + 2, tw, 14);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(label, bx + 4, timeAxisH + 13);
}

function drawGrid(s: DrawState) {
  const { ctx, width, height, timeAxisH } = s;
  const span = s.timeEnd - s.timeStart;
  if (span <= 0) return;
  const pxPerTime = width / span;
  const step = niceTimeStep(50 / pxPerTime);

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let t = Math.ceil(s.timeStart / step) * step; t <= s.timeEnd; t += step) {
    const x = timeToX(s, t);
    if (x < 0 || x > width) continue;
    ctx.moveTo(x, timeAxisH);
    ctx.lineTo(x, height);
  }
  ctx.stroke();

  // 水平行分隔线
  const firstRow = Math.max(0, Math.floor(s.scrollY / s.rowH));
  const lastRow = firstRow + Math.ceil((height - timeAxisH) / s.rowH) + 1;
  ctx.beginPath();
  for (let i = firstRow; i <= lastRow; i++) {
    const y = timeAxisH + i * s.rowH - s.scrollY;
    if (y < timeAxisH || y > height) continue;
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }
  ctx.stroke();
}

/** 绘制单行波形（数字信号） */
function drawSignalRow(s: DrawState, sig: ViewSignal, rowIdx: number) {
  const { ctx, width } = s;
  const y = s.timeAxisH + rowIdx * s.rowH - s.scrollY;
  if (y + s.rowH < s.timeAxisH || y > s.height) return;

  const midY = y + s.rowH / 2;
  const changes = s.data.get(sig.id);
  const color = sig.color || "#58A6FF";

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();

  const span = s.timeEnd - s.timeStart;
  if (!changes || changes.length === 0) {
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
    return;
  }

  // 找到可见范围内的首变化点
  let i0 = 0;
  while (i0 < changes.length - 1 && changes[i0 + 1].t < s.timeStart) i0++;
  // 起始值：i0 处值（若 i0 变化点早于窗口则用其值）
  let cur = changes[i0].v;
  let curX = timeToX(s, changes[i0].t);
  if (curX < 0) curX = 0;

  for (let i = i0; i < changes.length; i++) {
    const ch = changes[i];
    // 取整到像素边界，避免 subpixel 反锯齿导致细线模糊
    const x = Math.round(timeToX(s, ch.t));
    if (x > width) break;
    if (x < 0) {
      cur = ch.v;
      curX = 0;
      continue;
    }
    if (x <= curX) {
      // 同一像素列内的多个变化点：仅更新状态，合并绘制
      cur = ch.v;
      continue;
    }
    // 水平段（从上一个跳变到当前）
    drawSegment(s, cur, curX, x, midY, color, sig.width);
    curX = x;
    cur = ch.v;
  }
  // 末尾延伸到窗口右缘
  if (curX < width) {
    drawSegment(s, cur, curX, width, midY, color, sig.width);
  }
}

function drawSegment(s: DrawState, value: string, x0: number, x1: number, midY: number, color: string, widthBits: number) {
  const { ctx } = s;
  const w = widthBits;
  // 高低电平距中线的幅度：确保高电平明显高于行头字体上沿、低电平明显低于字体下沿
  // 26px 行 → ±10px，跳变线高度 20px，方波清晰可辨
  const level = Math.max(6, Math.round(s.rowH * 0.4));
  if (w <= 1) {
    // 标量
    const lv = value === "1" ? level : -level;
    ctx.beginPath();
    ctx.moveTo(x0, midY - lv);
    ctx.lineTo(x1, midY - lv);
    ctx.stroke();
  } else {
    // 向量：中线
    ctx.beginPath();
    ctx.moveTo(x0, midY);
    ctx.lineTo(x1, midY);
    ctx.stroke();
  }
  // 垂直跳变
  ctx.beginPath();
  ctx.moveTo(x0, midY - level);
  ctx.lineTo(x0, midY + level);
  ctx.stroke();

  // 值标注（段足够宽时）
  if (x1 - x0 > 22) {
    const txt = w <= 1 ? value : formatValue(value, s.radix);
    ctx.fillStyle = color;
    ctx.font = "9px Consolas";
    ctx.fillText(txt, x0 + 4, midY - level - 3);
  }
}

/** 绘制波形主入口 */
export function drawWaveform(s: DrawState) {
  const { ctx, width, height, timeAxisH } = s;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0D1117";
  ctx.fillRect(0, 0, width, height);

  drawGrid(s);
  drawTimeAxis(s);

  // 波形行
  const firstRow = Math.max(0, Math.floor(s.scrollY / s.rowH));
  const lastRow = firstRow + Math.ceil((height - timeAxisH) / s.rowH) + 1;
  for (let i = firstRow; i <= lastRow; i++) {
    const sig = s.signals[i];
    if (!sig) break;
    if (s.hoverRow === i) {
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      const y = timeAxisH + i * s.rowH - s.scrollY;
      ctx.fillRect(0, y, width, s.rowH);
    }
    drawSignalRow(s, sig, i);
  }

  drawMarker(s);
}
