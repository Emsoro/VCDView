// 渲染验证：加载 dist 前端 + 注入解析 demo1ns.vcd 的桥接，截图验证波形方波高低电平
// 支持 bit_indices：总线展开的 bit 行按位抽取，与整向量数字标注对照
import puppeteer from "file:///d:/Cplusplus/VCDView/frontend/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import http from "http";
import fs from "fs";
import path from "path";

const DIST = path.normalize("d:/Cplusplus/VCDView/frontend/dist");
const VCD_PATH = "d:/Cplusplus/VCDView/test_data/demo1ns.vcd";
const SHOTS = "d:/Cplusplus/VCDView/build_test/shots";

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
      // 值行格式：标量 "0!" / "1\""（值紧贴 id），向量 "b0001 #" / "b0001#"
      // id 恒为行尾最后一个非空白字符（VCD 规范）
      const m = line.match(/^(.*?)(\S)$/);
      if (!m) continue;
      const id = m[2];
      if (changes[id]) {
        let v = m[1].trim();
        // 剥离 b/h 前缀（与后端 VcdLoader 一致）
        if (/^[bh]/i.test(v)) v = v.slice(1);
        const prev = changes[id][changes[id].length - 1];
        if (!prev || prev.v !== v) changes[id].push({ t: curTime, v });
      }
    }
  }
  return { timescale, vars, changes };
}

const vcd = parseVCD();
console.log(`parsed timescale=${vcd.timescale} vars=${vcd.vars.map((v) => v.name).join(",")}`);
for (const v of vcd.vars) {
  const arr = vcd.changes[v.id] ?? [];
  console.log(`  ${v.name} (id=${v.id}, w=${v.width}) first values: ${arr.slice(0, 6).map((c) => c.v).join(" ")}`);
}

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

// 层次树：scope "logic" 下挂所有信号（msb/lsb 与后端一致：[width-1:0]）
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
  headless: true,
  dumpio: false,
  args: ["--window-size=1600,1000", "--force-device-scale-factor=1", "--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.setViewport({ width: 1600, height: 1000 });

// ---- 注入后端桥接（支持 bit_indices 按位抽取，返回 width/bit 字段）----
await page.evaluateOnNewDocument(({ tree, docInfo, TS_SEC }) => {
  const tsSec = TS_SEC;
  let opened = true;
  const sigMeta = {};
  for (const scope of tree) {
    for (const s of scope.children ?? []) sigMeta[s.signal_idx] = { width: s.width };
  }
  window.__lastQuery = null;
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
          const { time_start, time_end, signal_ids, bit_indices, max_points } = args;
          const bits = Array.isArray(bit_indices) ? bit_indices : signal_ids.map(() => -1);
          const signals = signal_ids.map((id, i) => {
            const bit = bits[i] ?? -1;
            const meta = sigMeta[id] ?? { width: 1 };
            const all = (window.__vcdChanges && window.__vcdChanges[id]) || [];
            let changes = all;
            if (bit >= 0) {
              // 按位抽取：idx = width-1-bit（bit0 = LSB = 最右）
              const idx = meta.width - 1 - bit;
              changes = all.map((c) => {
                const ch = c.v[idx] ?? "x";
                return { t: c.t, v: ch };
              });
            }
            return { id, width: meta.width, bit, changes };
          });
          const timeline = [];
          window.__lastQuery = { time_start, time_end, signal_ids, bits, signals };
          return Promise.resolve({ timeline, signals, end: time_end >= docInfo.max_time });
        }
        default:
          return Promise.reject(new Error("unknown cmd: " + cmd));
      }
    },
    listen: () => {},
  };
}, { tree, docInfo, TS_SEC });

// 把 VCD 变化数据传给页面（键用前端 signal id，值已剥离前缀）
const vcdChangesBySid = {};
for (const [vcdId, arr] of Object.entries(vcd.changes)) {
  const sid = idMap.get(vcdId);
  if (sid !== undefined) vcdChangesBySid[sid] = arr;
}
await page.goto(base + "/index.html", { waitUntil: "load", timeout: 30000 });
await page.evaluate(({ changes }) => {
  window.__vcdChanges = changes;
}, { changes: vcdChangesBySid });

fs.mkdirSync(SHOTS, { recursive: true });

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
// 展开向量行（点击其 chevron span）
const expandVector = async (name) => {
  return page.evaluate((name) => {
    const els = Array.from(document.querySelectorAll('aside div[class*="cursor-pointer"]'));
    for (const el of els) {
      const txt = (el.textContent || "").trim();
      if (txt.startsWith(name)) {
        const span = el.querySelector("span");
        if (span) { span.click(); return true; }
      }
    }
    return false;
  }, name);
};
// 报告当前视图范围内每个信号的可见变化（机器可验证，不依赖肉眼）
const reportVisible = async (tag) => {
  const range = await page.evaluate(() => {
    const tb = document.querySelector("header span[title='时间范围']");
    return tb ? tb.textContent : null;
  });
  const q = await page.evaluate(() => window.__lastQuery);
  console.log(`\n[${tag}] 视图范围=${range}`);
  if (!q) {
    console.log("  (无 lastQuery，尚未查询)");
    return;
  }
  for (const s of q.signals) {
    const inWin = s.changes.filter((c) => c.t >= q.time_start && c.t <= q.time_end);
    const distinct = new Set(inWin.map((c) => c.v)).size;
    const label = s.bit >= 0 ? `id=${s.id}[bit${s.bit}]` : `id=${s.id} 整向量`;
    console.log(`  ${label}: 窗口内变化点=${inWin.length} 不同值=${distinct} ${distinct >= 2 ? "(有跳变 ✓)" : "(平 ✗)"}`);
  }
};

await clickItem("logic");
await new Promise((r) => setTimeout(r, 400));
await clickItem("clk");
await clickItem("data");
await clickItem("cnt"); // 整向量（梯形 + 数字）
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: path.join(SHOTS, "1_bus_folded.png") });
await reportVisible("1_bus_folded");

// 展开 cnt 并添加 4 根 bit 线
await expandVector("cnt");
await new Promise((r) => setTimeout(r, 400));
for (const b of ["cnt[3]", "cnt[2]", "cnt[1]", "cnt[0]"]) {
  await clickItem(b);
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: path.join(SHOTS, "2_bus_expanded.png") });
await reportVisible("2_bus_expanded");

// 3) 放大 2 次（fit 135 → 67 → 33），能看到 cnt 的多个周期变化
for (let i = 0; i < 2; i++) {
  const zoomIn = await page.$('button[title*="放大"], button[title*="Zoom In"], button[title*="zoom in"]');
  if (!zoomIn) break;
  await zoomIn.click();
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: path.join(SHOTS, "3_zoom2.png") });
await reportVisible("3_zoom2");

// 4) 核对传给前端的数据：整向量 vs 展开 bit（bit0 = LSB）
const q = await page.evaluate(() => window.__lastQuery);
if (q) {
  console.log("\n==== 传给前端的数据核对 (lastQuery) ====");
  for (const s of q.signals) {
    const label = s.bit >= 0 ? `id=${s.id}[bit${s.bit}]` : `id=${s.id} 整向量`;
    console.log(`${label} w=${s.width}: ` + s.changes.slice(0, 8).map((c) => `${c.t}:${c.v}`).join(" "));
  }
  // 展开 bit0（cnt[0]）与 cnt 整向量最低位对照
  const bus = q.signals.find((s) => s.bit === -1 && s.width > 1);
  const bit0 = q.signals.find((s) => s.bit === 0 && s.width > 1);
  if (bus && bit0) {
    const mismatches = [];
    for (const c of bit0.changes) {
      const b = bus.changes.find((x) => x.t === c.t);
      if (!b || b.v[b.v.length - 1] !== c.v) mismatches.push({ t: c.t, bus: b ? b.v : "?", bit0: c.v });
    }
    const ok = mismatches.length === 0;
    console.log(`\n整向量最低位 vs bit0 一致性: ${ok ? "一致 ✓" : "不一致 ✗"}`);
    if (!ok) console.log("不一致点:", mismatches.slice(0, 5));
  }
}

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
