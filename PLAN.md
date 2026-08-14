# VCDView（GTKWave Lite）— 开发计划

> 基于 TauriCPP（WebView2 + C++17 + React 18）重构 GTKWave 的轻量 VCD 波形查看器。
> **当前版本：v1.0.0**
> 本文档为开发计划与进度追踪。实现细节、调试经验见根目录 `SKILL.md`；产品/技术复盘见 `docs/`。

---

## 一、目标

打造一款 Windows 桌面的轻量 VCD 波形查看器，复用 GTKWave 成熟 C 解析内核 + 现代 Web 前端渲染，实现"**双击打开、1 秒出波形、用完即走**"。产物为**单文件免安装 `.exe`**。

## 二、里程碑总览

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 框架搭建 | TauriCPP 集成、窗口、桥接 IPC、前端工程 | ✅ 完成 |
| M2 核心解析 | VCD 解析（GTKWave C 内核）、信号文档、按需查询 | ✅ 完成 |
| M3 界面 | 文件打开、信号树、波形渲染、交互 | ✅ 完成 |
| M4 体验优化 | 性能调优、文件信息修复、健壮性 | ✅ 完成（v1.0.0） |
| M5 发布 | README / SKILL / docs、版本号、Git 推送 | ✅ 完成 |
| M6 扩展能力 | FST/FSDB、测量、导出等 | ⏸ 规划中 |

---

## 三、已完成功能

### 3.1 后端（C++17，`src/`）

| 命令 | 说明 |
|------|------|
| `dialog.open` | 原生打开文件对话框（过滤 `.vcd`） |
| `file.open` | 打开并解析 VCD；支持 `{ path }` 跳过对话框；返回文档摘要 |
| `file.reload` | 重新加载当前文件（外部修改后刷新） |
| `file.recent` | 最近文件列表；`{ add }` 追加记录 |
| `doc.info` | 文档摘要：路径、文件大小、timescale、时间范围、信号/模块数 |
| `hierarchy.tree` | 返回层次树（scope 嵌套 + 信号节点位宽/进制） |
| `waveform.query` | 按可见时间窗 + 信号 id 查询波形，按像素列抽稀 |
| `system.info` | 后端版本、框架信息 |
| `debug.log` | 前端 console 转发写入 `debug.log`（汇流日志） |

**核心层（无 UI 耦合，可单测）**：
- `core/VcdDocument.{h,cpp}`：信号/值/时间戳存储
- `core/VcdLoader.{h,cpp}`：C 解析器封装（回调驱动）
- `core/WaveformQuery.{h,cpp}`：按时间窗 + 像素抽稀查询

### 3.2 前端（React + TS + Vite + Tailwind + Canvas 2D，`frontend/`）

- **`api/tauricpp.ts`**：桥接封装 + 数据核对日志 + **浏览器 mock**（无后端可独立开发）
- **`state/store.ts`**：zustand 全局状态（文档、视图信号、进制、marker、时间窗、光标模式、显示开关）
- **组件**：
  - `Toolbar.tsx`：打开文件、文件信息、进制切换、视图开关、最近文件
  - `SignalTree.tsx`：信号层次树 + **关键字搜索** + 勾选加入波形
  - `WaveformCanvas.tsx`：Canvas 波形渲染 + **滚轮缩放（以鼠标为中心）** + 拖拽/滚动平移 + 垂直滚动
  - `WaveformViewport.tsx`：布局与滚动容器
  - `StatusBar.tsx`：状态栏（时间/缩放/光标读数）
- **`utils/format.ts`**：进制格式化；**`utils/draw.ts`**：Canvas 绘制封装
- **`types/waveform.ts`**：IPC 协议类型定义（与后端对应）

### 3.3 性能优化（v1.0.0 关键成果）

- **解析热路径零日志**：移除 `OnSignal`/`OnValue`/`OnTime` 回调内的 `debug.log` 写文件
  - 打开 3.68MB / 59.5 万行 / 2857 信号 VCD：**4.68s → 0.57s（提速 8 倍）**，界面 5.2s → 1.0s
- **`file_size` 修复**：`commands.cpp` 直接读真实文件大小，不再恒为 0
- **波形按需加载**：`waveform.query` 只返回可见窗口数据，支持大文件流畅浏览

### 3.4 工程化

- `build.ps1`：vcvars + CMake(Ninja) + 构建，支持 `-Clean` / `-SetupDeps`，输出 `build/VCDView.exe`
- 前端资源经 `pack_resources.py` 嵌入 exe（单文件分发）
- `/MT` 静态运行时 + **PerMonitorV2 DPI manifest**（高分屏不模糊）
- `ctest` 冒烟测试（`vcd_parser_test`）
- `verify_big.mjs`：CDP 真实链路诊断脚本（崩溃/异常/递归刷屏检测）

---

## 四、M6 扩展能力（规划中）

按优先级排序，未开始：

| 能力 | 说明 | 优先级 |
|------|------|--------|
| 波形测量 | 光标读数、区间时长/频次统计、marker 差值 | P0 |
| FST / FSDB 支持 | 二进制格式，打开更快、占用更小 | P0 |
| 信号搜索增强 | 正则过滤、按值/按翻转过滤 | P1 |
| 波形导出 | PNG 截图、CSV 数据导出 | P1 |
| 数据对比 | 黄金波形 diff（两文件叠对比对） | P2 |
| 大文件优化 | >500MB 增量读取、内存占用优化 | P2 |

---

## 五、技术决策与约束

- **IPC 全 JSON**（nlohmann/json），命令注册支持 raw / typed / 无参重载
- **前端资源嵌入**：只打包 `frontend/dist`，源码与 node_modules 不嵌入
- **后端核心无 UI 依赖**：解析→文档→查询链路可被 ctest 覆盖
- **前端 mock 模式**：无后端时 `npm run dev` 即可浏览器独立开发
- **日志铁律**：每行/每回调一次的热路径禁止写文件日志，只打阶段边界
- **诊断铁律**：任何触发 console 的调试代码必须排除 `debug.log` 命令（防递归刷屏）

---

## 六、版本记录

| 版本 | 日期 | 内容 |
|------|------|------|
| v1.0.0 | 2026-08-14 | 首个发布版：VCD 解析/信号树/波形查看/缩放平移/进制切换/信号搜索；性能调优（解析提速 8 倍）；`file_size` 修复；补充 SKILL.md、docs、README |

## 七、许可

- 本项目：GPL v2（见 `LICENSE`）
- `src/vcd/`：源自 GTKWave（GPL v2）
- `src/tauricpp/`：TauriCPP（MIT）
- 完整 GTKWave 与 TauriCPP 上游副本仅本地参考，不随仓库分发
