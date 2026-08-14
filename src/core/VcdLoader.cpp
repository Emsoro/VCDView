#include "VcdLoader.h"

#include "vcd_core.h"

#include <Windows.h>

#include <chrono>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <string>

namespace gtkwave {

namespace {

// 调试日志：写入 exe 同目录 debug.log（与 ipc/commands.cpp 保持一致）
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

}  // namespace

int VcdLoader::Load(const std::string& path, VcdDocument& doc,
                    std::string& error) {
  doc_ = &doc;
  last_time_ = 0;
  doc.Clear();

  vcd_core_cb_t cb{};
  cb.userdata = this;
  cb.on_signal = OnSignal;
  cb.on_value = OnValue;
  cb.on_time = OnTime;
  cb.on_timescale = OnTimescale;
  cb.on_timezero = OnTimezero;
  cb.on_dumpoff = OnDumpoff;
  cb.on_dumpon = OnDumpon;

  char errbuf[512] = {0};
  DebugAppend("info", "[loader] Load start path=" + path);
  int rc = vcd_core_parse(path.c_str(), &cb, this, errbuf, sizeof(errbuf));
  if (rc != 0) {
    error = errbuf[0] ? errbuf : "VCD parse failed";
    doc_ = nullptr;
    DebugAppend("warn", "[loader] Load FAILED rc=" + std::to_string(rc) + " error=" + error);
    return rc;
  }
  doc.Finalize();
  doc_ = nullptr;
  DebugAppend("info", "[loader] Load DONE signals=" + std::to_string(doc.SignalCount()) +
                          " min=" + std::to_string(doc.MinTime()) +
                          " max=" + std::to_string(doc.MaxTime()));
  return 0;
}

int VcdLoader::OnSignal(void* ud, const char* name, int msi, int lsi,
                        unsigned char vartype) {
  // NOTE: 每个信号回调一次（大文件数千次），禁止写日志
  auto* self = static_cast<VcdLoader*>(ud);
  if (!self || !self->doc_) return -1;
  return self->doc_->AddSignal(name ? name : "", msi, lsi, vartype);
}

void VcdLoader::OnValue(void* ud, int sig, const char* value) {
  // NOTE: 热路径回调，禁止写日志（大文件几十万次回调会拖慢解析）
  auto* self = static_cast<VcdLoader*>(ud);
  if (!self || !self->doc_ || sig < 0) return;
  self->doc_->AddValue(sig, self->last_time_, value ? value : "");
}

void VcdLoader::OnTime(void* ud, long long t) {
  // NOTE: 热路径回调，禁止写日志
  auto* self = static_cast<VcdLoader*>(ud);
  if (!self) return;
  self->last_time_ = t < 0 ? 0 : static_cast<int64_t>(t);
}

void VcdLoader::OnTimescale(void* ud, const char* ts) {
  auto* self = static_cast<VcdLoader*>(ud);
  if (!self || !self->doc_) return;
  if (ts && ts[0]) self->doc_->SetTimescale(ts);
  DebugAppend("info", "[loader] OnTimescale ts=" + std::string(ts ? ts : ""));
}

void VcdLoader::OnTimezero(void* ud, long long /*t*/) {
  (void)ud;
  // time zero 信息由 OnTime 处理，忽略
}

void VcdLoader::OnDumpoff(void* /*ud*/) {}
void VcdLoader::OnDumpon(void* /*ud*/) {}

}  // namespace gtkwave
