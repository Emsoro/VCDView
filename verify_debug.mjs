// 真实链路验证：连接运行中的 VCDView.exe (WebView2 远程调试 9222)
// 触发真实 C++ 后端解析 demo1ns.vcd -> 勾选信号 -> 渲染截图 -> 核对数据
import puppeteer from "file:///d:/Work/CPlusPlus/GTKWave/frontend/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import fs from "fs";
import path from "path";

const OUT = path.normalize("d:/Work/CPlusPlus/GTKWave/build_test/debug_shots");
const VCD_PATH = "d:/Work/CPlusPlus/GTKWave/demo1ns.vcd";
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
console.log("connected, url:", await page.url());
await page.setViewport({ width: 1280, height: 800 });

// 0) 等 UI 就绪
await page.waitForSelector('button[title="打开 VCD 文件"]', { timeout: 15000 });
console.log("UI ready");

// 1) 包装 file.open：自动带上真实路径，绕过原生对话框（后端解析逻辑完全真实）
await page.evaluate((vcdPath) => {
  const t = window.__tauricpp__;
  if (!t || !t.invoke) throw new Error("no bridge");
  const orig = t.invoke.bind(t);
  t.invoke = (cmd, args) => {
    if (cmd === "file.open" && !(args && args.path)) {
      args = Object.assign({}, args, { path: vcdPath });
    }
    return orig(cmd, args);
  };
}, VCD_PATH);
console.log("bridge wrapped");

// 2) 点击"打开 VCD 文件"按钮 -> 真实后端解析
await page.click('button[title="打开 VCD 文件"]');
console.log("open clicked");
await sleep(2000);

// 3) 等信号树出现，展开 logic，勾选信号
await page.waitForSelector('aside div[class*="cursor-pointer"]', { timeout: 10000 });
const clickItem = async (name) => {
  const els = await page.$$('aside div[class*="cursor-pointer"]');
  for (const el of els) {
    const txt = await el.evaluate((n) => n.textContent);
    if (txt && txt.trim().startsWith(name)) {
      await el.click();
      return true;
    }
  }
  return false;
};

await clickItem("logic");
await sleep(400);
for (const name of ["clk", "data", "cnt"]) {
  await clickItem(name);
}
await sleep(2500);

// 4) 检查渲染状态
const state = await page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  const aside = document.querySelector("aside");
  return {
    canvasCount: document.querySelectorAll("canvas").length,
    canvasW: canvas ? canvas.width : 0,
    canvasH: canvas ? canvas.height : 0,
    asideText: aside ? aside.textContent.slice(0, 300) : "",
    sigRows: Array.from(document.querySelectorAll('aside div[class*="cursor-pointer"]')).map((n) =>
      n.textContent.trim()
    ),
  };
});
console.log("STATE:", JSON.stringify(state, null, 2));
fs.writeFileSync(path.join(OUT, "state.json"), JSON.stringify(state, null, 2));

// 5) 截图
await sleep(800);
await page.screenshot({ path: path.join(OUT, "1_fit_real.png") });
console.log("screenshot saved");

await browser.disconnect();
console.log("DONE");
