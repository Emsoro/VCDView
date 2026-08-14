# TauriCPP 桌面应用开发技能

> 基于 **VCDView**（GTKWave Lite）实战项目总结：C++17 + WebView2 + React 18 + Vite + TailwindCSS。
> 本文覆盖 TauriCPP 框架的开发方法、调试方法、本项目踩坑经验与调优结论。

---

## 1. 框架认知

TauriCPP 是 Tauri 的 C++ 移植版：**C++ 后端 + WebView2 渲染 + Web 前端**，无 Node 运行时、无外部服务，产物为单文件 `.exe`。

### 1.1 核心类（`src/tauricpp/include/tauricpp/`）

| 类 | 职责 |
|----|------|
| `App` | 应用生命周期：配置窗口、持有 Bridge / VirtualFS / Window，`Run()` 阻塞 |
| `Bridge` | 前后端双向 IPC：`RegisterCommand`（JS→C++）、`Emit`（C++→JS） |
| `Window` | Win32 窗口 + WebView2 控制器 |
| `Dialog` | 原生打开/保存文件对话框 |
| `VirtualFS` | 资源虚拟文件系统（把前端静态资源当"文件"读取） |
| `EmbeddedDLL` | 可选：把 WebView2Loader 静态链接进 exe |

### 1.2 数据流

```
前端调用  window.__tauricpp__.invoke("cmd", args)  → Promise
后端接收  WebMessageReceived → Bridge::HandleInvoke → 路由到 handler
后端返回  handler 返回 nlohmann::json → 序列化 → Promise resolve
后端推送  Bridge::Emit("event", json) → 前端 listen("event", cb)
```

### 1.3 目录约定（本项目）

```
src/
├── main.cpp            # WinMain：配置 App + 注册命令 + Run
├── tauricpp/           # 框架库（MIT），含 include/src/tools/pack_resources.py
├── vcd/                # 复用的 GTKWave C 解析器（GPL v2，剥离版 vcd_core.c）
├── core/               # VcdDocument / VcdLoader / WaveformQuery（纯 C++，无 UI）
└── ipc/commands.cpp    # 全部 Bridge 命令注册
frontend/               # React + Vite，构建产物 dist/ 由 CMake 嵌入 exe
```

---

## 2. 开发方法

### 2.1 最小应用骨架（本项目 `src/main.cpp` 模式）

```cpp
int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    tauricpp::App::Config config;
    config.window_config.title = "MyApp";
    config.window_config.width = 1280;
    config.window_config.height = 800;
    config.window_config.center = true;
    config.window_config.devtools = true;   // F12 打开 DevTools

    tauricpp::App app(config);
    MyCommands::Register(app.GetBridge());  // 注册全部 IPC 命令
    return app.Run();
}
```

### 2.2 注册 IPC 命令（`Bridge::RegisterCommand` 三种重载）

```cpp
// ① 原始 JSON 版：最灵活
bridge.RegisterCommand("raw.cmd", [](const nlohmann::json& args) -> nlohmann::json {
    return {{"echo", args.value("msg", "")}};
});

// ② 类型安全版：Args/Result 自动 JSON 转换
bridge.RegisterCommand<OpenReq, OpenRes>("file.open",
    [](const OpenReq& req) -> OpenRes { /* ... */ });

// ③ 无参数版
bridge.RegisterCommand<int>("app.pid", []() -> int { return GetCurrentProcessId(); });
```

**铁律**：参数与返回值必须是 JSON 可序列化类型（nlohmann/json）。

### 2.3 前端调用（`frontend/src/api/tauricpp.ts` 封装模式）

```ts
// 声明注入类型
declare global {
  interface Window { __tauricpp__?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    listen: (event: string, cb: (data: unknown) => void) => void;
  } }
}

const res = (await window.__tauricpp__!.invoke("file.open", { path })) as T;
// 约定：后端错误通过 { error: string } 返回，前端统一抛错
if (res && typeof res === "object" && "error" in res) throw new Error(res.error);
```

本项目经验：
- **统一封装层**：所有命令走 `invoke<T>()`，集中做错误处理与数据核对日志（`[FE-recv] cmd -> ...`），业务组件不直接碰 bridge。
- **浏览器独立开发**：无桥接时 `mockInvoke` 返回 mock 数据，前端可脱离 C++ 用 `npm run dev` 单独开发（详见 4.4）。
- **大响应必须按需**：`waveform.query` 一次返回数万时间戳，前端按可见时间窗请求 + 抽稀，避免一次拉全量。

### 2.4 前端资源打包（单 exe 关键）

```
frontend/dist  →  src/tauricpp/tools/pack_resources.py  →  resources.rc + resource_map.cpp
                 （CMake 生成，前端文件 hash 变化时 CONFIGURE_DEPENDS 自动重配置）
                 → 嵌入 exe → VirtualFS 运行时读取
```

- 只打包 `dist/`（构建产物），`node_modules`/源码不嵌入。
- 产出 `VCDView.exe` 单文件免依赖（配合 `/MT` 静态运行时）。

### 2.5 构建（Windows，`build.ps1`）

```
vswhere 定位 VS → vcvars64.bat 设置环境 → cmake -G Ninja → ninja
依赖准备：.\build.ps1 -SetupDeps
   ├─ nlohmann/json.hpp 单头下载到 src/tauricpp/third_party/
   └─ vcpkg install webview2 --triplet=x64-windows --classic
```

关键 CMake 配置（本项目）：
- `CMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded`（/MT，免 VC++ 运行库）
- 生成 **PerMonitorV2 DPI manifest** 嵌入 exe（解决高分屏 WebView2 模糊）
- `add_compile_options(/utf-8)`（源码含中文注释）

### 2.6 冒烟测试

```bash
ctest --test-dir build -R vcd_parser_test --output-on-failure
```
后端核心（解析→文档→查询链路）保持无 UI 可测，UI 层用 CDP 脚本验证（见 4.3）。

---

## 3. 调试方法（重点）

### 3.1 双通道统一日志（debug.log）

- **C++ 侧**：`DebugAppend(level, msg)` 追加写 **exe 同目录 `debug.log`**，带毫秒时间戳：

```
[2026-08-14 10:02:39.782][info] [loader] Load start path=...
[2026-08-14 10:02:40.354][info] [loader] Load DONE signals=2857 ...
```

- **前端侧**：`main.tsx` 包装 `console.log`，每条输出转发为一次 `debug.log` IPC 调用，**前后端日志汇流到同一文件**，用时间戳对齐分析时序。
- 排查通用流程：删掉旧 `debug.log` → 重启 exe → 复现 → 看时间戳定位耗时环节。

### 3.2 F12 DevTools

`config.window_config.devtools = true` 后，应用内 F12 打开 DevTools，可直接断点前端、查看网络（WebMessage）、Console。

### 3.3 CDP 远程调试（最强手段，必学）

WebView2 支持 Chromium 调试协议。启动参数注入：

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
Start-Process .\release\VCDView.exe
```

然后用 `puppeteer-core`（本项目 `frontend/node_modules` 自带）连接，**原始 CDP 监听底层事件**（项目参考：`verify_big.mjs`）：

```js
const browser = await puppeteer.connect({ browserURL: "http://localhost:9222" });
const page = browser.pages()[0];
const cdp = await page.createCDPSession();
// 页面级：JS 异常 / console / 渲染进程日志 / 崩溃 / frame 状态
cdp.on("Runtime.exceptionThrown", e => /* JS 未捕获异常 */);
cdp.on("Log.entryAdded", e => /* 渲染进程日志（含 WebView2 崩溃原因） */);
cdp.on("Inspector.detached", e => /* 页面被断开 = 崩溃/导航 */);
cdp.on("Page.frameDetached", e => /* frame 卸载 */);
// browser 级：target 崩溃/销毁（页面整体崩溃时 session 会先死）
const bcdp = await browser.target().createCDPSession();
bcdp.on("Target.targetCrashed", e => /* 渲染进程崩溃 */);
bcdp.on("Target.targetDestroyed", e => /* target 销毁 */);
```

**为什么必须用 CDP 而不是 `page.on('console')`**：页面整体崩溃时 puppeteer 的页面级监听全部失效、只有 browser 级 `Target.targetCrashed` 能捕获；渲染进程日志必须走 `Log.entryAdded`。

### 3.4 前端独立开发（无后端模式）

`tauricpp.ts` 的 `hasBridge()` 检测不到 `window.__tauricpp__` 时自动切 `mockInvoke`（内置 demo 文档 mock 数据）。此时：

```bash
cd frontend && npm run dev   # 浏览器纯前端开发
```

前端逻辑（树、波形渲染、交互）开发调试不需要启动 C++ 后端。

### 3.5 性能剖析

- **后端耗时**：`debug.log` 毫秒时间戳对比（如 `Load start` → `Load DONE`）。
- **前端主线程卡顿**：CDP 脚本周期性 `page.evaluate` 测 `performance.now()` 间隔，间隔 > 1s 即主线程阻塞。
- **IPC 量**：`[FE-recv]` 日志显示每次查询返回的时间戳/变化数，判断是否需要抽稀或按需加载。

---

## 4. 本项目实战教训（踩坑总结）

### 4.1 热路径日志 = 性能杀手（本次最大坑，8 倍差距）

**现象**：打开 3.68MB / 59.5 万行 / 2857 信号的 VCD，解析耗时 **4.68 秒**，界面长期"转圈"。

**根因**：`VcdLoader` 的 `OnSignal` / `OnValue` / `OnTime` 每个回调都调用 `DebugAppend`（打开-写入-关闭文件）：

| 回调 | 频次 | 影响 |
|------|------|------|
| `OnSignal`（信号声明） | 2857 次 | 移除后解析提速 8 倍 |
| `OnTime`（时间戳） | 11.6 万次 | 已修复 |
| `OnValue`（值变化） | 几十万次 | 已修复 |

**修复**：回调内**禁止写日志**，只在阶段边界（Load start/DONE）记一次。

**实测**：4.68s → **0.57s**（提速 8 倍），界面显示文件打开从 5.2s → 1.0s。

> **铁律**：每行一次的回调里绝不能做文件 I/O；要统计就用计数器，最后汇总打印。

### 4.2 console.log → debug.log 递归刷屏（假死陷阱）

**现象**：诊断脚本运行 273 秒、日志 27MB，页面假死，`file.open` 无响应。

**根因**：前端 console 转发机制（每条 `console.log` 都是一次 `debug.log` IPC）+ 诊断脚本给**每个命令**打 `console.log("[bridge.call]...")` → 转发 → 又打日志 → **无限递归 11.6 万次**，IPC 队列塞爆。

**修复**：bridge 包装只记录关键命令（`file.open`/`hierarchy.tree`/`waveform.query`），**过滤 `debug.log` 自身**。

> **铁律**：写诊断脚本时，任何会触发 console 的代码都必须排除 `debug.log` 命令，否则递归刷屏。

### 4.3 IPC 大 JSON 传输

`waveform.query` 返回 11.6 万时间戳的 timeline 时 JSON 序列化/传输开销大。解法：
- 前端**按可见时间窗**请求（`time_start/time_end`），滚动/缩放时增量请求；
- 每信号变化点按需返回，不做全量快照；
- 渲染用 Canvas 2D 直接画，不做 DOM 逐点。

### 4.4 高分屏模糊

WebView2 默认非 DPI 感知会被系统位图拉伸导致模糊。修复：CMake 生成 **PerMonitorV2 DPI manifest** 嵌入 exe（`dpiAwareness=PerMonitorV2`），MSVC 自动与默认 manifest 合并。

### 4.5 页面崩溃排查 SOP（本项目实战流程）

1. **重启 exe + 清空 debug.log**（排除旧日志干扰）；
2. **CDP 监听崩溃**：browser 级 `Target.targetCrashed` + 页面级 `Runtime.exceptionThrown`；
3. **检查日志刷屏**：`node -e` 统计日志行分布，若出现海量同前缀（如 11.6 万次 `[bridge.call]`），优先怀疑递归；
4. **分阶段测**：打开 → 展开 → 查询，每阶段记录 `debug.log` 时间戳与主线程间隔，二分定位卡点；
5. **热路径审计**：凡在 N 次循环/回调内的日志调用一律移除。

---

## 5. 常见问题速查表

| 症状 | 排查方向 |
|------|----------|
| 打开大文件卡死/转圈 | 解析热路径是否写日志（4.1） |
| 页面整体崩溃（detached） | browser 级 CDP `Target.targetCrashed` + `Log.entryAdded` |
| 页面假死、IPC 无响应 | 检查 console 转发递归刷屏（4.2） |
| 前端主线程卡顿 | CDP 周期测 `performance.now()` 间隔；波形按需+抽稀 |
| 界面模糊 | PerMonitorV2 DPI manifest 是否生效 |
| exe 到别的机器跑不起来 | `/MT` 静态运行时；WebView2 运行时是否安装 |
| 前端改了没生效 | `npm run build` 后重跑 cmake（CONFIGURE_DEPENDS 自动感知 dist 变化） |

---

## 6. 相关文件索引

| 文件 | 作用 |
|------|------|
| `src/main.cpp` | 应用入口（App 配置 + 命令注册） |
| `src/ipc/commands.cpp` | 全部 Bridge 命令 + DebugAppend 日志机制 |
| `src/core/VcdLoader.cpp` | 解析器回调封装（热路径日志教训所在） |
| `src/core/WaveformQuery.cpp` | 波形按需查询 |
| `frontend/src/api/tauricpp.ts` | bridge 封装 + mock（独立开发） |
| `verify_big.mjs` | CDP 真实链路诊断脚本（崩溃/异常/刷屏） |
| `build.ps1` | 一键构建（vcvars + cmake + ninja） |
| `CMakeLists.txt` | 资源打包 / DPI manifest / /MT 静态链接 |
