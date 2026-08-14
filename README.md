# VCDView

> 使用 [TauriCPP](https://github.com/tauri-apps)（WebView2 + C++ 后端 + Web 前端）重构的 GTKWave 波形查看器。
> **v1.0.0** — 开箱即用：单文件免安装，打开 3.68MB / 59.5 万行 / 2857 信号的 VCD 约 1 秒。

VCDView 是一款面向硬件工程师 / FPGA 开发者的轻量 VCD 波形查看器。它复用 GTKWave 久经考验的 C 解析内核，配合现代 Web 前端与 Canvas 波形渲染，目标是"**双击打开、1 秒出波形、用完即走**"。

## 功能

- **打开本地 `.vcd` 波形文件**：文件摘要（路径、大小、时间范围、信号总数、timescale）
- **信号层次树**：按 scope 层级组织，折叠/展开、关键字搜索、多选信号加入波形视图
- **Canvas 波形渲染**：数字矩形波、总线向量值标注、时间轴与网格、marker 参考线
- **交互**：滚轮缩放（以鼠标为中心）、拖拽/滚动平移、垂直滚动信号行、点击时间轴设置 marker
- **值显示**：hex / dec / oct / bin / ascii 进制切换
- **按需加载**：仅请求可见时间范围的波形数据（`waveform.query` 按时间窗增量查询），支持大文件流畅浏览
- **性能**：解析热路径零日志 I/O，大文件打开实测 4.68s → 0.57s（提速 8 倍）
- **中文界面**，单文件免安装分发

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | C++17 + TauriCPP（WebView2 + nlohmann/json） |
| VCD 解析 | 复用 GTKWave C 解析器（`vcd_core.c` 剥离版），C++ 封装 |
| 核心层 | `VcdDocument` / `VcdLoader` / `WaveformQuery`（纯 C++，可单测） |
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS + Canvas 2D |
| 构建 | CMake（MSVC + Ninja），前端产物由 `pack_resources.py` 嵌入 exe |

## 目录结构

```
├── CMakeLists.txt          # 根构建（资源打包 / DPI manifest / /MT 静态链接）
├── build.ps1               # 一键构建脚本
├── vcpkg.json              # vcpkg 依赖（webview2）
├── SKILL.md                # TauriCPP 开发/调试手册（含本项目踩坑与调优经验）
├── docs/                   # 推文与技术文档
│   ├── tech-article.md     # 技术向：架构与性能调优复盘
│   └── app-article.md      # 应用向：产品介绍
├── src/                    # C++ 后端
│   ├── main.cpp            # 应用入口
│   ├── tauricpp/           # TauriCPP 框架库（MIT）
│   ├── vcd/                # 复用的 GTKWave C 解析器（GPL v2）
│   ├── core/               # VcdDocument / VcdLoader / WaveformQuery
│   └── ipc/commands.cpp    # Bridge 命令层（file.open / hierarchy.tree / waveform.query / doc.info）
├── frontend/               # React 前端（npm run dev 可独立开发）
├── tools/                  # 工具脚本（测试 VCD 生成）
├── tests/                  # 后端冒烟测试
├── verify_big.mjs          # CDP 真实链路诊断脚本（崩溃/异常/递归刷屏检测）
└── test_data/              # 测试 VCD 样本
```

## 构建

前置条件：Windows 10/11、Visual Studio 2022（含 C++ 工具集）、CMake、Ninja、Python 3、Node.js 18+、WebView2 运行时（Win11 自带）。

```powershell
# 1. 安装依赖（首次）
.\build.ps1 -SetupDeps

# 2. 构建前端
cd frontend
npm install
npm run build
cd ..

# 3. 构建后端
.\build.ps1
# 产物: build/VCDView.exe（可复制到 release/ 作为发布包）
```

## 开发与调试

完整的开发方法、调试方法与本项目实战经验见 **[SKILL.md](SKILL.md)**，要点：

- **双通道日志**：C++ `DebugAppend` 写 `debug.log`；前端 console 自动转发为 `debug.log` IPC，前后端日志汇流对齐。
- **F12 DevTools**：`config.window_config.devtools = true`。
- **CDP 远程调试**：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 启动后，用 `verify_big.mjs`（puppeteer-core）监听崩溃/异常/递归刷屏。
- **前端独立开发**：`frontend/src/api/tauricpp.ts` 内置 `mockInvoke`，无后端时 `npm run dev` 即可浏览器开发。

### 核心教训（详见 SKILL.md）

1. **热路径日志 = 性能杀手**：解析回调（OnSignal/OnValue/OnTime）每行写 `debug.log` 导致打开卡 4.7s，移除后 0.57s（8 倍提速）。
2. **console 转发递归**：诊断脚本给每个命令打日志会与 console→debug.log 转发机制互锁，导致 11.6 万次递归刷屏、页面假死。
3. **页面崩溃排查**：页面整体崩溃时页面级监听先失效，必须用 browser 级 `Target.targetCrashed` + `Log.entryAdded`。

## 测试

```powershell
ctest --test-dir build -R vcd_parser_test --output-on-failure
```

## 许可证

本项目采用 GPL v2（见 LICENSE）。

- `src/vcd/` 下的 C 解析器代码源自 [GTKWave](https://gtkwave.sourceforge.net/)（GPL v2）
- `src/tauricpp/` 为 TauriCPP 框架库（MIT）
- 上游参考源码（完整 GTKWave 与 TauriCPP 副本）仅本地保留，不随仓库分发

## 已知限制

- 仅支持 VCD 文本格式（FST/LXT/GHW 后续版本支持）
- 超大文件（>500MB）解析占用内存较高，后续以增量读取优化
- 波形测量（光标读数、区间统计）与导出（PNG/CSV）在规划中
