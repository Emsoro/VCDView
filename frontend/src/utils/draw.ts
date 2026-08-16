import type { ChangePoint, Radix } from "../types/waveform";
import type { ViewSignal } from "../state/store";
import { sigKey } from "../state/store";
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
  data: Map<string, ChangePoint[]>;
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
  const changes = s.data.get(sigKey(sig));
  const color = sig.color || "#58A6FF";

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();

  if (!changes || changes.length === 0) {
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
    return;
  }

  // 整向量（bus）折叠显示：梯形连接 + 中间数字
  if (sig.bit === undefined && sig.width > 1) {
    drawBusRow(s, changes, midY, color);
    return;
  }

  // 标量 / 展开单 bit：方波（GTKWave 风格）
  // - 水平线：画当前电平（0=低，1=高），从 curX 到下一个变化点 x
  // - 竖线：只在值变化时画，连接前一段电平到新电平（不画全高竖线）
  const level = Math.max(6, Math.round(s.rowH * 0.4));
  const yOf = (v: string) => midY - (v === "1" ? level : -level);

  let i0 = 0;
  while (i0 < changes.length - 1 && changes[i0 + 1].t < s.timeStart) i0++;
  let prevVal: string | null = null;   // 前一段的值（null=窗口左缘之前，不画竖线）
  let curX = timeToX(s, changes[i0].t);
  if (curX < 0) curX = 0;

  for (let i = i0; i < changes.length; i++) {
    const ch = changes[i];
    const x = Math.round(timeToX(s, ch.t));
    if (x > width) break;
    if (x < 0) {
      prevVal = ch.v;
      curX = 0;
      continue;
    }
    if (x <= curX) {
      prevVal = ch.v;
      continue;
    }
    // 画 [curX, x) 段，值为 prevVal（上一个变化点已生效的值）
    const segVal = prevVal ?? ch.v;
    const segY = yOf(segVal);
    // 水平线
    ctx.beginPath();
    ctx.moveTo(curX, segY);
    ctx.lineTo(x, segY);
    ctx.stroke();
    // 竖线：仅在值变化时画（跳变点在 x），连接 segVal 电平到 ch.v 电平
    if (prevVal !== null && prevVal !== ch.v) {
      ctx.beginPath();
      ctx.moveTo(x, segY);
      ctx.lineTo(x, yOf(ch.v));
      ctx.stroke();
    }
    curX = x;
    prevVal = ch.v;
  }
  // 末段
  if (curX < width) {
    const segVal = prevVal ?? changes[changes.length - 1].v;
    ctx.beginPath();
    ctx.moveTo(curX, yOf(segVal));
    ctx.lineTo(width, yOf(segVal));
    ctx.stroke();
  }
}

/** 绘制折叠总线：梯形跳变 + 延续 X 连线 + 中间数字（参考 GTKWave draw_hptr_trace_vector） */
function drawBusRow(s: DrawState, changes: ChangePoint[], midY: number, color: string) {
  const { ctx, width } = s;
  const level = Math.max(6, Math.round(s.rowH * 0.4));
  const y0 = midY - level; // 上沿
  const y1 = midY + level; // 下沿
  const yu = midY;         // 中线
  const roundcap = 3;      // 梯形斜边宽度（像素）

  // 收敛到可见首个变化点
  let i0 = 0;
  while (i0 < changes.length - 1 && changes[i0 + 1].t < s.timeStart) i0++;

  let curX = Math.round(timeToX(s, changes[i0].t));
  if (curX < 0) curX = 0;
  let lastVal: string | null = null;   // 前一段的值字符串（null=窗口左缘之前）
  let segVal = changes[i0].v;          // 当前要画的段的值（上一个变化点已生效的值）

  // 窗口左缘 → 首个变化点：先画一段
  const drawSeg = (x0: number, x1: number, val: string) => {
    if (x1 <= x0) return;
    // 值是否变化：用整串比较（参考 GTKWave strcmp），而非首位归一
    const changed = lastVal !== null && lastVal !== val;
    const wide = x1 - x0 > roundcap * 2;
    // 梯形/跳变连接线
    ctx.beginPath();
    if (lastVal !== null && wide && changed) {
      // 值变化：上梯形 + 下梯形（斜线连接）
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + roundcap, yu);
      ctx.lineTo(x0, y1);
    } else if (lastVal !== null && wide && !changed) {
      // 值未变：画 X 形连线表示延续（不画竖直跳变）
      ctx.moveTo(x0 - 2, y0);
      ctx.lineTo(x0 + 2, y1);
      ctx.moveTo(x0 - 2, y1);
      ctx.lineTo(x0 + 2, y0);
    } else {
      // 同值或段太窄：竖直跳变
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0, y1);
    }
    ctx.stroke();
    // 上下两条水平段
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.moveTo(x0, y1);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    // 数字标注
    if (x1 - x0 > 22) {
      ctx.fillStyle = color;
      ctx.font = "9px Consolas";
      ctx.fillText(formatValue(val, s.radix), x0 + 4, yu - level - 3);
    }
    lastVal = val;
  };

  for (let i = i0; i < changes.length; i++) {
    const ch = changes[i];
    const x = Math.round(timeToX(s, ch.t));
    if (x > width) break;
    if (x < 0) {
      // 窗口左缘之前的点：仅更新 segVal 不画
      segVal = ch.v;
      lastVal = ch.v;
      curX = 0;
      continue;
    }
    if (x <= curX) {
      segVal = ch.v;
      continue;
    }
    // 画 [curX, x) 段，值为 segVal（上一个变化点已生效的值）
    drawSeg(curX, x, segVal);
    curX = x;
    segVal = ch.v;
  }
  if (curX < width) {
    // 末段：画 [curX, width) 值为 segVal
    drawSeg(curX, width, segVal);
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
