#include "ipc/commands.h"

#include "core/VcdDocument.h"
#include "core/VcdLoader.h"
#include "core/WaveformQuery.h"
#include "tauricpp/dialog.hpp"
#include <nlohmann/json.hpp>

#include <Windows.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <functional>
#include <string>
#include <vector>

namespace gtkwave {

namespace {

// 当前打开的文档会话
std::unique_ptr<VcdDocument> g_doc;
std::string g_path;
std::string g_error;

// ---------------------------------------------------------------------------
// 最近文件列表（持久化到 %APPDATA%/gtkwave-lite/recent.json）
// ---------------------------------------------------------------------------
constexpr int kMaxRecent = 10;

std::string RecentFilePath() {
  const char* appdata = std::getenv("APPDATA");
  std::string dir = (appdata && *appdata) ? std::string(appdata) : ".";
  dir += "/gtkwave-lite";
  std::error_code ec;
  std::filesystem::create_directories(dir, ec);
  return dir + "/recent.json";
}

std::vector<std::string> LoadRecentFiles() {
  std::vector<std::string> list;
  std::ifstream in(RecentFilePath());
  if (!in) return list;
  try {
    nlohmann::json j = nlohmann::json::parse(in);
    if (j.contains("files") && j["files"].is_array()) {
      for (auto& f : j["files"]) {
        if (f.is_string()) list.push_back(f.get<std::string>());
      }
    }
  } catch (...) {
  }
  return list;
}

void SaveRecentFiles(const std::vector<std::string>& list) {
  try {
    nlohmann::json j;
    j["files"] = list;
    std::ofstream out(RecentFilePath());
    out << j.dump(2);
  } catch (...) {
  }
}

void TouchRecent(const std::string& path) {
  if (path.empty()) return;
  auto list = LoadRecentFiles();
  list.erase(std::remove(list.begin(), list.end(), path), list.end());
  list.insert(list.begin(), path);
  if (static_cast<int>(list.size()) > kMaxRecent) list.resize(kMaxRecent);
  SaveRecentFiles(list);
}

const char* VarTypeName(unsigned char vt) {
  switch (vt) {
    case V_WIRE: return "wire";
    case V_REG: return "reg";
    case V_PARAMETER: return "parameter";
    case V_INTEGER: return "integer";
    case V_REAL: return "real";
    default: return "wire";
  }
}

void NodeToJson(const VcdDocument& doc, const VcdNode* n, nlohmann::json& j) {
  if (!n) return;
  j["id"] = n->id;
  j["name"] = n->name;
  if (n->is_scope) {
    j["type"] = "scope";
    j["children"] = nlohmann::json::array();
    for (int cid : n->children) {
      const VcdNode* c = doc.NodeById(cid);
      if (!c) continue;
      nlohmann::json child;
      NodeToJson(doc, c, child);
      j["children"].push_back(std::move(child));
    }
  } else {
    j["type"] = VarTypeName(n->vartype);
    j["signal_idx"] = n->signal_idx;
    j["width"] = n->width;
    j["msb"] = n->msb;
    j["lsb"] = n->lsb;
  }
}

nlohmann::json DocInfoJson(const VcdDocument& doc, const std::string& path) {
  nlohmann::json info;
  info["path"] = path;
  info["timescale"] = doc.timescale();
  info["min_time"] = doc.MinTime();
  info["max_time"] = doc.MaxTime();
  info["num_signals"] = static_cast<int>(doc.SignalCount());
  info["num_scopes"] = static_cast<int>(doc.ScopeCount());
  std::error_code ec;
  const uintmax_t sz = std::filesystem::file_size(path, ec);
  info["file_size"] = static_cast<int64_t>(ec ? 0 : sz);

  // 推荐初始窗口：当数据变化点很多时，初始视图收敛到前 N 个变化点，
  // 避免全窗口下波形过密（视觉上像一条横线）
  const int64_t kFitChanges = 2000;
  int64_t min_t = doc.MinTime();
  int64_t viewport_end = doc.MaxTime();
  for (const auto& s : doc.signals()) {
    if (static_cast<int64_t>(s.times.size()) > kFitChanges) {
      int64_t t = s.times[kFitChanges - 1];
      if (t < viewport_end) viewport_end = t;
    }
  }
  if (viewport_end > min_t) info["viewport_end"] = viewport_end;
  return info;
}

// ---------------------------------------------------------------------------
// 调试日志：写入 exe 同目录 debug.log
// ---------------------------------------------------------------------------
std::string DebugLogPath() {
  static std::string path;
  if (path.empty()) {
    wchar_t buf[MAX_PATH] = {0};
    DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
    if (n > 0 && n < MAX_PATH) {
      std::filesystem::path p(buf);
      path = (p.parent_path() / "debug.log").string();
    } else {
      path = "debug.log";
    }
  }
  return path;
}

std::string TimestampNow() {
  using namespace std::chrono;
  auto now = system_clock::now();
  auto t = system_clock::to_time_t(now);
  auto ms = duration_cast<milliseconds>(now.time_since_epoch()).count() % 1000;
  std::tm tmv{};
  localtime_s(&tmv, &t);
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d.%03d", tmv.tm_year + 1900,
                tmv.tm_mon + 1, tmv.tm_mday, tmv.tm_hour, tmv.tm_min, tmv.tm_sec, (int)ms);
  return buf;
}

void DebugAppend(const std::string& level, const std::string& msg) {
  try {
    std::ofstream out(DebugLogPath(), std::ios::app);
    if (out) out << "[" << TimestampNow() << "][" << level << "] " << msg << "\n";
  } catch (...) {
  }
}

// 层次树摘要（用于日志核对）
std::string TreeSummary(const nlohmann::json& arr) {
  std::string s;
  std::function<void(const nlohmann::json&, int)> walk = [&](const nlohmann::json& n, int depth) {
    if (s.size() > 8192) return;
    s += std::string(depth * 2, ' ') + n.value("name", "?") + " id=" + std::to_string(n.value("id", -1));
    if (n.value("type", "") == "scope") {
      s += " [scope]\n";
      if (n.contains("children")) {
        for (auto& c : n["children"]) walk(c, depth + 1);
      }
    } else {
      s += " type=" + n.value("type", "?") + " w=" + std::to_string(n.value("width", 0));
      s += " msb=" + std::to_string(n.value("msb", 0)) + " lsb=" + std::to_string(n.value("lsb", 0));
      s += " sig=" + std::to_string(n.value("signal_idx", -1)) + "\n";
    }
  };
  for (auto& n : arr) walk(n, 0);
  return s;
}

}  // namespace

void RegisterCommands(tauricpp::Bridge& bridge) {
  DebugAppend("info", "=== commands registered, debug.log at " + DebugLogPath() + " ===");

  // 前端日志转发：把前端 console 输出写入 exe 同目录 debug.log
  bridge.RegisterCommand("debug.log", [](const nlohmann::json& args) -> nlohmann::json {
    std::string level = args.value("level", "info");
    std::string msg = args.value("msg", "");
    DebugAppend(level, msg);
    return nullptr;
  });

  // 打开文件对话框
  bridge.RegisterCommand("dialog.open", [](const nlohmann::json& args) -> nlohmann::json {
    tauricpp::Dialog::OpenOptions opts;
    opts.title = args.value("title", "Open VCD File");
    opts.filters = {{"VCD Waveform", "*.vcd"}, {"All Files", "*.*"}};
    auto files = tauricpp::Dialog::OpenFile(nullptr, opts);
    nlohmann::json result;
    result["files"] = files;
    result["cancelled"] = files.empty();
    return result;
  });

  // 打开并解析 VCD 文件
  bridge.RegisterCommand("file.open", [](const nlohmann::json& args) -> nlohmann::json {
    std::string path;
    if (args.contains("path") && args["path"].is_string()) {
      path = args["path"].get<std::string>();
    } else {
      tauricpp::Dialog::OpenOptions opts;
      opts.title = "Open VCD File";
      opts.filters = {{"VCD Waveform", "*.vcd"}, {"All Files", "*.*"}};
      auto files = tauricpp::Dialog::OpenFile(nullptr, opts);
      if (files.empty()) return {{"ok", false}, {"cancelled", true}};
      path = files[0];
    }

    auto doc = std::make_unique<VcdDocument>();
    VcdLoader loader;
    std::string error;
    int rc = loader.Load(path, *doc, error);
    if (rc != 0) {
      g_error = error;
      DebugAppend("warn", "file.open FAILED path=" + path + " error=" + error);
      return {{"ok", false}, {"error", error}, {"path", path}};
    }

    g_doc = std::move(doc);
    g_path = path;
    g_error.clear();
    TouchRecent(path);

    nlohmann::json result;
    result["ok"] = true;
    result["path"] = path;
    result["info"] = DocInfoJson(*g_doc, path);
    DebugAppend("info", "file.open OK path=" + path + " timescale=" + g_doc->timescale() +
                            " min=" + std::to_string(g_doc->MinTime()) +
                            " max=" + std::to_string(g_doc->MaxTime()) +
                            " signals=" + std::to_string(g_doc->SignalCount()) +
                            " scopes=" + std::to_string(g_doc->ScopeCount()) +
                            " info=" + result["info"].dump());
    return result;
  });

  // 重新加载当前文件（文件可能已被外部修改）
  bridge.RegisterCommand("file.reload", [](const nlohmann::json&) -> nlohmann::json {
    if (g_path.empty()) {
      return {{"ok", false}, {"error", "no file open"}};
    }
    auto doc = std::make_unique<VcdDocument>();
    VcdLoader loader;
    std::string error;
    int rc = loader.Load(g_path, *doc, error);
    if (rc != 0) {
      g_error = error;
      return {{"ok", false}, {"error", error}};
    }
    g_doc = std::move(doc);
    g_error.clear();
    return {{"ok", true}, {"info", DocInfoJson(*g_doc, g_path)}};
  });

  // 最近文件列表：无参数返回列表；带 add 参数则追加并返回新列表
  bridge.RegisterCommand("file.recent", [](const nlohmann::json& args) -> nlohmann::json {
    if (args.contains("add") && args["add"].is_string()) {
      TouchRecent(args["add"].get<std::string>());
    }
    return LoadRecentFiles();
  });

  // 文档信息
  bridge.RegisterCommand("doc.info", [](const nlohmann::json&) -> nlohmann::json {
    if (!g_doc) return nullptr;
    return DocInfoJson(*g_doc, g_path);
  });

  // 层次树
  bridge.RegisterCommand("hierarchy.tree", [](const nlohmann::json&) -> nlohmann::json {
    if (!g_doc) return nlohmann::json::array();
    nlohmann::json arr = nlohmann::json::array();
    const VcdNode* root = g_doc->Root();
    if (root) {
      for (int cid : root->children) {
        const VcdNode* c = g_doc->NodeById(cid);
        if (!c) continue;
        nlohmann::json node;
        NodeToJson(*g_doc, c, node);
        arr.push_back(std::move(node));
      }
    }
    DebugAppend("info", "hierarchy.tree ->\n" + TreeSummary(arr));
    return arr;
  });

  // 波形查询
  bridge.RegisterCommand("waveform.query", [](const nlohmann::json& args) -> nlohmann::json {
    if (!g_doc) {
      return {{"error", "no document open"}};
    }
    QueryRequest req;
    req.time_start = args.value("time_start", (int64_t)0);
    req.time_end = args.value("time_end", g_doc->MaxTime());
    req.max_points = args.value("max_points", (int64_t)4096);
    if (args.contains("signal_ids") && args["signal_ids"].is_array()) {
      for (const auto& v : args["signal_ids"]) req.signal_ids.push_back(v.get<int>());
    }
    if (args.contains("bit_indices") && args["bit_indices"].is_array()) {
      for (const auto& v : args["bit_indices"]) req.bit_indices.push_back(v.get<int>());
    }
    // 若未提供 bit_indices，则与 signal_ids 等长，全部为整向量（-1）
    if (req.bit_indices.empty()) {
      req.bit_indices.assign(req.signal_ids.size(), -1);
    }

    QueryResult res = WaveformQuery::Query(*g_doc, req);

    std::string idsJson;
    for (size_t i = 0; i < req.signal_ids.size(); ++i) {
      if (i) idsJson += ",";
      idsJson += std::to_string(req.signal_ids[i]);
    }
    DebugAppend("info", "waveform.query t=[" + std::to_string(req.time_start) + "," +
                            std::to_string(req.time_end) + "] maxpts=" +
                            std::to_string(req.max_points) + " ids=[" + idsJson + "]");
    for (const auto& sc : res.signals) {
      std::string first = sc.times.empty() ? "-" : std::to_string(sc.times.front()) + ":" + sc.values.front();
      std::string last = sc.times.empty() ? "-" : std::to_string(sc.times.back()) + ":" + sc.values.back();
      DebugAppend("info", "  -> signal id=" + std::to_string(sc.id) +
                              " changes=" + std::to_string(sc.times.size()) +
                              " first=" + first + " last=" + last);
    }

    nlohmann::json out;
    out["timeline"] = res.timeline;
    out["end"] = res.end;
    out["signals"] = nlohmann::json::array();
    for (const auto& sc : res.signals) {
      nlohmann::json sj;
      sj["id"] = sc.id;
      sj["width"] = sc.width;
      sj["bit"] = sc.bit;
      sj["changes"] = nlohmann::json::array();
      for (size_t i = 0; i < sc.times.size(); ++i) {
        sj["changes"].push_back({{"t", sc.times[i]}, {"v", sc.values[i]}});
      }
      out["signals"].push_back(std::move(sj));
    }
    DebugAppend("info", "waveform.query DONE timeline=" + std::to_string(res.timeline.size()) +
                            " end=" + (res.end ? "1" : "0"));
    return out;
  });

  // 后端信息
  bridge.RegisterCommand("system.info", [](const nlohmann::json&) -> nlohmann::json {
    return {
        {"framework", "TauriCPP"},
        {"backend", "C++ + WebView2"},
        {"version", "1.0.1"},
        {"format", "VCD"}
    };
  });
}

}  // namespace gtkwave
