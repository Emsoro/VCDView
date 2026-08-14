#pragma once
#include "VcdDocument.h"
#include <cstdint>
#include <string>

namespace gtkwave {

/** 桥接 GTKWave C 解析器（vcd_core.c）→ VcdDocument */
class VcdLoader {
 public:
  VcdLoader() = default;

  /// 解析 VCD 文件到 doc；成功返回 0，失败返回负值并填充 error
  int Load(const std::string& path, VcdDocument& doc, std::string& error);

 private:
  VcdDocument* doc_ = nullptr;
  int64_t last_time_ = 0;

  // C 回调（静态）
  static int OnSignal(void* ud, const char* name, int msi, int lsi,
                      unsigned char vartype);
  static void OnValue(void* ud, int sig, const char* value);
  static void OnTime(void* ud, long long t);
  static void OnTimescale(void* ud, const char* ts);
  static void OnTimezero(void* ud, long long t);
  static void OnDumpoff(void* ud);
  static void OnDumpon(void* ud);
};

}  // namespace gtkwave
