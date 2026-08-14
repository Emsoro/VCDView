// 真实链路诊断：打开大文件，原始 CDP 监听崩溃/异常/渲染进程日志
import puppeteer from "file:///d:/Work/CPlusPlus/GTKWave/frontend/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import fs from "fs";
import path from "path";

const OUT = path.normalize("d:/Work/CPlusPlus/GTKWave/build_test/big_shots");
const VCD_PATH = "d:/Work/CPlusPlus/GTKWave/test_data/clk_trim_dt_test.vcd";
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const browser = await puppeteer.connect({
        browserURL: "http://localhost:9222",
        defaultViewport: null,
      });
      const pages = await browser.pages();
      if (pages.length) return { browser, page: pages[0] };
      await browser.disconnect();
    } catch {}
    await sleep(500);
  }
  throw new Error("cannot connect to WebView2 debug port");
}

const { browser, page } = await connect();
const targetId = page.target()._targetId;
console.log("connected, url:", await page.url(), "targetId:", targetId);
await page.setViewport({ width: 1280, height: 800 });

// 原始 CDP 会话，监听底层事件
const cdp = await page.createCDPSession();
cdp.on("Runtime.exceptionThrown", (e) => {
  console.log("[CDP:exceptionThrown]", JSON.stringify(e.exceptionDetails).slice(0, 800));
});
cdp.on("Runtime.consoleAPICalled", (e) => {
  const args = (e.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
  console.log(`[CDP:console.${e.type}]`, String(args).slice(0, 400));
});
cdp.on("Log.entryAdded", (e) => {
  const le = e.entry;
  console.log(`[Log:${le.level}]`, le.source, le.text.slice(0, 500), le.url ? "@" + le.url : "");
});
cdp.on("Inspector.detached", (e) => {
  console.log("[Inspector.detached]", JSON.stringify(e));
});
cdp.on("Page.frameDetached", (e) => {
  console.log("[frameDetached]", JSON.stringify(e));
});
cdp.on("Page.frameNavigated", (e) => {
  console.log("[frameNavigated]", e.frame.url);
});
cdp.on("Page.javascriptDialogOpening", (e) => {
  console.log("[javascriptDialog]", JSON.stringify(e));
});
await cdp.send("Runtime.enable");
await cdp.send("Log.enable");
await cdp.send("Page.enable");

// 监听所有 target 的崩溃（browser 级 CDP）
const browserCdp = await browser.target().createCDPSession();
browserCdp.on("Target.targetCrashed", (e) => {
  console.log("[browser:targetCrashed]", JSON.stringify(e));
});
browserCdp.on("Target.detachedFromTarget", (e) => {
  console.log("[Target.detachedFromTarget]", JSON.stringify(e));
});
browserCdp.on("Target.targetCreated", (e) => {
  console.log("[Target.targetCreated]", e.targetInfo.targetId, e.targetInfo.type);
});
browserCdp.on("Target.targetDestroyed", (e) => {
  console.log("[Target.targetDestroyed]", e.targetId);
});
await browserCdp.send("Target.setDiscoverTargets", { discover: true });
browser.on("disconnected", () => console.log("[browser disconnected]"));

// 页面级事件
page.on("console", (msg) => {
  const t = msg.type();
  if (["error", "warning"].includes(t)) {
    console.log(`[page.console.${t}]`, msg.text().slice(0, 500));
  }
});
page.on("pageerror", (err) => {
  console.log("[pageerror]", (err && err.message ? err.message : String(err)).slice(0, 800));
});
page.on("close", () => console.log("[page closed]"));
page.on("framenavigated", (f) => {
  console.log("[framenavigated]", f.url());
});

await page.waitForSelector('button[title="打开 VCD 文件"]', { timeout: 15000 });
console.log("UI ready");

await page.evaluate((vcdPath) => {
  const t = window.__tauricpp__;
  if (!t || !t.invoke) throw new Error("no bridge");
  const orig = t.invoke.bind(t);
  // 只记录关键命令，避免 debug.log 转发递归刷屏
  const KEY = new Set(["file.open", "hierarchy.tree", "waveform.query", "doc.info"]);
  t.invoke = (cmd, args) => {
    if (cmd === "file.open" && !(args && args.path)) {
      args = Object.assign({}, args, { path: vcdPath });
    }
    if (KEY.has(cmd)) console.log("[bridge.call]", cmd, JSON.stringify(args ?? {}).slice(0, 200));
    return orig(cmd, args).then((r) => {
      if (KEY.has(cmd)) console.log("[bridge.resp]", cmd, JSON.stringify(r ?? {}).slice(0, 300));
      return r;
    });
  };
}, VCD_PATH);
console.log("bridge wrapped");

const t0 = Date.now();
await page.click('button[title="打开 VCD 文件"]');
console.log("open clicked at", t0);

for (let i = 0; i < 40; i++) {
  await sleep(500);
  let info = "";
  try {
    info = await page.evaluate(() => {
      const a = document.querySelector("aside");
      return {
        aside: a ? a.textContent.trim().slice(0, 60) : "(no aside)",
        hasCanvas: !!document.querySelector("canvas"),
        nodes: document.querySelectorAll("aside .cursor-pointer").length,
      };
    });
    console.log(
      `t+${((Date.now() - t0) / 1000).toFixed(1)}s aside="${info.aside}" canvas=${info.hasCanvas} nodes=${info.nodes}`
    );
  } catch (e) {
    console.log(`t+${((Date.now() - t0) / 1000).toFixed(1)}s EVAL ERROR:`, e.message.slice(0, 120));
    break;
  }
}

// ==== 模拟用户操作：展开 scope + 添加信号 ====
console.log("=== 开始模拟用户操作 ===");
// 1. 点击顶层 scope 展开
try {
  const scopeEl = await page.evaluateHandle(() => {
    const divs = document.querySelectorAll("aside .cursor-pointer");
    for (const d of divs) {
      if (d.textContent.includes("clk_trim_dt_test")) return d;
    }
    return null;
  });
  if (scopeEl) {
    const h = scopeEl.asElement();
    await h.click();
    console.log("scope clicked (expanded)");
  } else {
    console.log("scope NOT FOUND");
  }
} catch (e) {
  console.log("expand scope error:", e.message.slice(0, 200));
}

// 2. 等待树展开
for (let i = 0; i < 20; i++) {
  await sleep(500);
  try {
    const n = await page.evaluate(() => document.querySelectorAll("aside .cursor-pointer").length);
    console.log(`expand t+${(i * 0.5).toFixed(1)}s nodes=${n}`);
    if (n > 100) break;
  } catch (e) {
    console.log("expand eval error:", e.message.slice(0, 120));
    break;
  }
}

// 3. 点击第一个信号（checkbox），触发 waveform.query
try {
  const sigEl = await page.evaluateHandle(() => {
    const divs = document.querySelectorAll("aside .cursor-pointer");
    for (const d of divs) {
      if (d.querySelector(".h-3\\.5") && !d.textContent.includes("clk_trim_dt_test")) return d;
    }
    return null;
  });
  if (sigEl) {
    const h = sigEl.asElement();
    const t0q = Date.now();
    await h.click();
    console.log("signal clicked, awaiting query...");
    // 4. 监测卡顿：每 250ms 测主线程响应
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        const dt = await page.evaluate(
          (t) => {
            const now = performance.now();
            const prev = now - t;
            // 顺带统计 DOM/画布状态
            const canvas = document.querySelector("canvas");
            return {
              elapsed: Math.round(prev),
              canvas: !!canvas,
              viewCount: document.querySelectorAll("aside .text-\\[10px\\].text-text2").length,
            };
          },
          Date.now()
        );
        if (i % 4 === 0 || dt.elapsed > 1000)
          console.log(
            `query t+${((Date.now() - t0q) / 1000).toFixed(1)}s mainThreadGap=${dt.elapsed}ms canvas=${dt.canvas}`
          );
        if (dt.elapsed > 3000) console.log("!!! MAIN THREAD BLOCKED > 3s !!!");
      } catch (e) {
        console.log(`query t+${((Date.now() - t0q) / 1000).toFixed(1)}s EVAL ERROR:`, e.message.slice(0, 160));
        break;
      }
    }
    console.log("signal add flow done");
  } else {
    console.log("signal NOT FOUND in tree");
  }
} catch (e) {
  console.log("add signal error:", e.message.slice(0, 200));
}

try {
  await page.screenshot({ path: path.join(OUT, "3_after_signal.png") });
  console.log("after-signal screenshot saved");
} catch (e) {
  console.log("screenshot failed:", e.message.slice(0, 120));
}

// 崩溃后看 debug.log 尾部
try {
  const log = fs.existsSync("d:/Work/CPlusPlus/GTKWave/release/debug.log")
    ? fs.readFileSync("d:/Work/CPlusPlus/GTKWave/release/debug.log", "utf8")
    : "(no debug.log)";
  const lines = log.split("\n");
  console.log("=== debug.log tail (last 40) ===");
  console.log(lines.slice(-40).join("\n"));
} catch (e) {
  console.log("debug.log read failed:", e.message);
}

try {
  await browser.disconnect();
} catch {}
console.log("DONE");
