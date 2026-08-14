# 用 C++ 与 WebView2 重写 GTKWave：一场 8 倍性能的日志调优实战

> VCDView（GTKWave Lite）开发复盘 · 技术向
> 关键词：TauriCPP / WebView2 / IPC / CDP 调试 / 性能优化

---

## 一、为什么会有这个项目

GTKWave 是硬件工程师最熟悉的 VCD 波形查看器，但它停留在 GTK3 时代，UI 交互与现代化工具差距明显。直接改 GTK 前端投入巨大，而整个波形解析/渲染核心又是成熟的 C 实现。

VCDView 的路线是：**复用 C 解析器，重写现代 UI** —— 用 TauriCPP（Tauri 的 C++ 移植版）做壳：C++17 后端承载解析与查询，WebView2 承载 React 前端。产物是**单文件免依赖的 .exe**，无 Node 运行时、无服务进程。

## 二、架构速览

```
┌─────────────────────────────┐
│  React + Vite + Tailwind    │  ← 前端：信号树 / 波形 Canvas 渲染
└──────────┬──────────────────┘
           │ window.__tauricpp__.invoke("file.open", {...})
           ▼
┌─────────────────────────────┐
│  Bridge（WebView2 桥）       │  ← 双向 IPC：invoke / Emit
└──────────┬──────────────────┘
           ▼
┌─────────────────────────────┐
│  C++ 命令层 (ipc/commands)   │  ← file.open / hierarchy.tree /
│                              │     waveform.query / doc.info
├─────────────────────────────┤
│  核心层 (core + vcd)         │  ← VCD 解析 / 信号文档 / 按需查询
└─────────────────────────────┘
```

关键设计决策：

1. **IPC 全部走 JSON**（nlohmann/json），命令注册有 raw / typed / 无参三种重载，类型安全与灵活性兼得。
2. **前端资源嵌入 exe**：`frontend/dist` 经打包脚本生成 C 资源 → 编译进二进制，运行时经 VirtualFS 读取，**单文件分发**。
3. **前端可独立开发**：bridge 封装层带 `mockInvoke`，无后端时 `npm run dev` 即可在浏览器开发全部 UI。
4. **后端核心无 UI 耦合**：解析 → 文档 → 查询链路保持纯 C++，可被 ctest 冒烟测试覆盖。

## 三、性能问题：打开文件为什么卡了 5 秒

实测 3.68MB / 59.5 万行 / 2857 信号的 VCD：

| 阶段 | 耗时 |
|------|------|
| 点击打开 → 界面响应 | **5.2 秒** |
| 其中 VCD 解析 | **4.68 秒** |

4.68 秒解析一个 3.68MB 的文本文件？C 解析器本身毫秒级。用 debug.log 时间戳一测就发现问题：

```
[10:00:47.644][info] [loader] Load start
[10:00:52.322][info] [loader] Load DONE     ← 4.7 秒
```

定位到 `VcdLoader` 的回调实现：**每个信号声明、每个值变化、每个时间戳都调用一次 `DebugAppend`**（打开-写入-关闭文件）。2857 次信号回调 × 每次文件 I/O ≈ 4 秒纯日志开销。

修复只删了 4 行日志：

```cpp
// 修复前
int VcdLoader::OnSignal(...) {
    int id = doc_->AddSignal(...);
    DebugAppend("info", "[loader] OnSignal name=" + ...);  // ← 2857 次文件 I/O
    return id;
}
// 修复后
int VcdLoader::OnSignal(...) {
    return doc_->AddSignal(...);  // 只留阶段边界日志
}
```

**结果：解析 4.68s → 0.57s，界面 5.2s → 1.0s，提速 8 倍。**

> 教训：**每行一次的回调里绝不能做文件 I/O**。日志要打，但要打在阶段边界（Load start/DONE），用计数器汇总替代逐条打印。

## 四、调试方法论：页面崩溃与"假死"怎么破

WebView2 应用最难的调试点是：**页面渲染进程崩溃时，前端 DevTools 和普通断点全部失效**。我们的三板斧：

### 1. 双通道统一日志
C++ 侧 `DebugAppend` 写 `debug.log`（带毫秒时间戳）；前端每条 `console.log` 自动转发为 `debug.log` IPC。前后端事件流汇入同一文件，用时间戳对齐分析时序。

### 2. F12 DevTools
`config.devtools = true`，应用内直接开 DevTools。

### 3. CDP 远程调试（核心）
WebView2 支持 Chromium 调试协议，启动参数注入远程调试端口后用 `puppeteer-core` 连接，**监听底层 CDP 事件**：

```js
const cdp = await page.createCDPSession();
cdp.on("Runtime.exceptionThrown", e => { /* JS 未捕获异常 */ });
cdp.on("Log.entryAdded", e => { /* 渲染进程日志（含崩溃原因） */ });

const bcdp = await browser.target().createCDPSession();
bcdp.on("Target.targetCrashed", e => { /* 渲染进程崩溃 */ });
```

关键认知：**页面整体崩溃时页面级监听先死，必须用 browser 级 `Target.targetCrashed` 捕获**；崩溃原因在 `Log.entryAdded` 里，前端 Console 根本看不到。

### 4. 一次"假死"诊断实录
诊断脚本运行 273 秒、日志膨胀到 27MB、页面假死、`file.open` 无响应。统计日志行分布，发现 **11.6 万次**同前缀 `[bridge.call]`——原来是前端 console 转发机制（每条 console 都是一次 IPC）遇上诊断脚本给每个命令打日志，**递归刷屏把 IPC 队列塞爆**。

修复：bridge 包装只记录关键命令、过滤 `debug.log` 自身。

> 教训：**写诊断代码时，任何触发 console 的路径都必须排除 `debug.log` 命令**，否则自伤。

## 五、成果与沉淀

| 指标 | 结果 |
|------|------|
| 打开 3.68MB VCD 到可操作 | **~1 秒** |
| 2857 信号树加载 | 秒级 |
| 波形按需查询 | 可见时间窗增量请求，主线程无阻塞 |
| 产物 | 单 exe，免安装 |

工程沉淀（开源可复用）：
- `SKILL.md`：TauriCPP 完整开发/调试手册（含本项目的坑与铁律）
- `verify_big.mjs`：CDP 真实链路诊断脚本模板，任何 WebView2 项目可直接套用
- `build.ps1`：vcvars + cmake + ninja 一键构建，含 DPI manifest 与 /MT 静态链接

## 六、给同类项目的一句话

WebView2 + C++ 是一条被低估的路：既有 Chromium 的现代渲染，又有原生性能与免依赖分发。前提是——**把 IPC 设计成按需、把日志设计成边界、把调试建立在 CDP 协议之上**。

项目地址：https://gitee.com/masonwu21/vcdview
