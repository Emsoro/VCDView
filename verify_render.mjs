// 渲染验证：加载 dist 前端 + 注入解析 demo1ns.vcd 的桥接，截图验证波形方波高低电平
import puppeteer from "file:///d:/Work/CPlusPlus/GTKWave/frontend/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import http from "http";
import fs from "fs";
import path from "path";

const DIST = path.normalize("d:/Work/CPlusPlus/GTKWave/frontend/dist");
const VCD_PATH = "d:/Work/CPlusPlus/GTKWave/demo1ns.vcd";

// ---- 解析 demo1ns.vcd ----
function parseVCD() {
  const lines = fs.readFileSync(VCD_PATH, "utf8").split(/\r?\n/);
  let timescale = "1ns";
  let curScope = null;
  const vars = []; // { id, width, name, scope }
  const changes = {};
  let curTime = 0;
  let inDef = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("$timescale")) {
      timescale = line.replace("$timescale", "").replace("$end", "").trim();
    } else if (line.startsWith("$scope")) {
      inDef = true;
      const m = line.match(/\$scope\s+\S+\s+(\S+)/);
      curScope = m ? m[1] : "top";
    } else if (line.startsWith("$upscope")) {
      curScope = null;
    } else if (line.startsWith("$enddefinitions")) {
      inDef = false;
    } else if (line.startsWith("$var")) {
      const parts = line.split(/\s+/);
      const width = parseInt(parts[2], 10);
      const id = parts[3];
      const name = parts[4];
      vars.push({ id, width, name, scope: curScope ?? "top" });
      changes[id] = [];
    } else if (line.startsWith("#")) {
      curTime = parseInt(line.slice(1), 10);
    } else {
      if (inDef) continue;
      const v = line.slice(0, -1);
      const id = line.slice(-1);
      if (changes[id]) {
        const prev = changes[id][changes[id].length - 1];
        if (!prev || prev.v !== v) changes[id].push({ t: curTime, v });
      }
    }
  }
  return { timescale, vars, changes };
}

const vcd = parseVCD();
console.log(`parsed timescale=${vcd.timescale} vars=${vcd.vars.map((v) => v.name).join(",")}`);

// 时间单位 → 秒
function tsToSec(ts) {
  const m = ts.match(/(\d+)\s*(s|ms|us|ns|ps|fs)/);
  if (!m) return 1e-9;
  const mult = { s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9, ps: 1e-12, fs: 1e-15 };
  return parseInt(m[1], 10) * mult[m[2]];
}
const TS_SEC = tsToSec(vcd.timescale);
let maxT = 0;
for (const k of Object.keys(vcd.changes)) {
  const arr = vcd.changes[k];
  if (arr.length) maxT = Math.max(maxT, arr[arr.length - 1].t);
}

// 层次树：scope "logic" 下挂所有信号
const idMap = new Map();
vcd.vars.forEach((v, i) => idMap.set(v.id, i + 10));

const tree = [{
  id: 1, name: "logic", type: "scope", children: vcd.vars.map((v, i) => ({
    id: i + 10, name: v.name, type: "wire", signal_idx: i + 10, width: v.width, msb: v.width - 1, lsb: 0,
  })),
}];

const docInfo = {
  path: VCD_PATH,
  file_size: fs.statSync(VCD_PATH).size,
  timescale: vcd.timescale,
  min_time: 0,
  max_time: maxT,
  num_signals: vcd.vars.length,
  num_scopes: 1,
};

// ---- 静态服务器 ----
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const fp = path.normalize(path.join(DIST, "." + p));
  const root = path.normalize(DIST);
  if (!fp.startsWith(root) || !fs.existsSync(fp)) { res.writeHead(404); res.end("not found"); return; }
  const ext = path.extname(fp);
  const ct = ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : ext === ".html" ? "text/html" : "application/octet-stream";
  res.writeHead(200, { "Content-Type": ct });
  res.end(fs.readFileSync(fp));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- 启动浏览器 ----
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--window-size=1600,1000", "--force-device-scale-factor=1"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });

// ---- 注入后端桥接 ----
await page.evaluateOnNewDocument(({ tree, docInfo, TS_SEC }) => {
  const tsSec = TS_SEC;
  let opened = true;
  window.__tauricpp__ = {
    invoke: (cmd, args) => {
      console.log("[bridge] invoke", cmd, JSON.stringify(args ?? {}));
      switch (cmd) {
        case "file.open":
          return Promise.resolve({ ok: true, info: docInfo });
        case "file.recent":
          return Promise.resolve([]);
        case "doc.info":
          return Promise.resolve(opened ? docInfo : null);
        case "hierarchy.tree":
          return Promise.resolve(opened ? tree : []);
        case "waveform.query": {
          const { time_start, time_end, signal_ids, max_points } = args;
          const signals = signal_ids.map((id) => {
            const all = window.__vcdChanges ? window.__vcdChanges[id] : [];
            return { id, changes: all };
          });
          const timeline = [];
          return Promise.resolve({ timeline, signals, end: time_end >= docInfo.max_time });
        }
        default:
          return Promise.reject(new Error("unknown cmd: " + cmd));
      }
    },
    listen: () => {},
  };
}, { tree, docInfo, TS_SEC });

// 把 VCD 变化数据传给页面（键用前端 signal id）
const vcdChangesBySid = {};
for (const [vcdId, arr] of Object.entries(vcd.changes)) {
  const sid = idMap.get(vcdId);
  if (sid !== undefined) vcdChangesBySid[sid] = arr;
}
await page.goto(base, { waitUntil: "networkidle0" });
await page.evaluate(({ changes }) => {
  window.__vcdChanges = changes;
}, { changes: vcdChangesBySid });

const shots = "d:/Work/CPlusPlus/GTKWave/build_test/shots";
fs.mkdirSync(shots, { recursive: true });

// 等待应用挂载
await new Promise((r) => setTimeout(r, 1500));

// 1) 点击“打开”按钮触发 file.open，让前端进入已打开状态
const openBtn = await page.$('button[title="打开 VCD 文件"]');
if (openBtn) await openBtn.click();
await new Promise((r) => setTimeout(r, 1200));

// 2) 展开 scope，勾选信号
const clickItem = async (name) => {
  const els = await page.$$('aside div[class*="cursor-pointer"]');
  for (const el of els) {
    const txt = await el.evaluate((n) => n.textContent);
    if (txt && txt.trim().startsWith(name)) { await el.click(); return true; }
  }
  return false;
};
await clickItem("logic");
await new Promise((r) => setTimeout(r, 400));
await clickItem("clk");
await clickItem("data");
await clickItem("cnt");
await new Promise((r) => setTimeout(r, 1500));

await page.screenshot({ path: path.join(shots, "1_fit.png") });

// 2) 放大 8 次（每次 ÷10，从 20ns/1600px 开始 → 2ps/px）
for (let i = 0; i < 8; i++) {
  const zoomIn = await page.$('button[title*="放大"], button[title*="Zoom In"], button[title*="zoom in"]');
  if (!zoomIn) break;
  await zoomIn.click();
  await new Promise((r) => setTimeout(r, 150));
}
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: path.join(shots, "3_zoomin8.png") });

// 输出缩放信息
const info = await page.evaluate(() => {
  const btn = document.querySelector('button[title*="每像素"]');
  const tb = document.querySelector("header span[title='时间范围']");
  return {
    tooltip: btn ? btn.getAttribute("title") : null,
    timeRange: tb ? tb.textContent : null,
  };
});
console.log("zoom info:", JSON.stringify(info));

await browser.close();
server.close();
console.log("VERIFY_DONE");
