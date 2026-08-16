// VCD 解析冒烟测试：验证 C 解析器 → VcdDocument 链路
// 构建: g++ -std=c++17 -Isrc/vcd -Isrc/core src/vcd/vcd_core.c src/vcd/vcd_core_debug.c src/core/VcdDocument.cpp src/core/VcdLoader.cpp src/core/WaveformQuery.cpp tests/vcd_parser_test.cpp -o vcd_parser_test
#include "VcdDocument.h"
#include "VcdLoader.h"
#include "WaveformQuery.h"

#include <cstdio>
#include <cstring>
#include <string>

using namespace gtkwave;

static int failures = 0;

static void check(bool cond, const char* what) {
  if (!cond) {
    std::printf("FAIL: %s\n", what);
    failures++;
  } else {
    std::printf("ok:   %s\n", what);
  }
}

int main(int argc, char** argv) {
  const char* path = argc > 1 ? argv[1] : "test_data/demo.vcd";
  std::printf("== VCD parser smoke test: %s ==\n", path);

  VcdDocument doc;
  VcdLoader loader;
  std::string error;
  int rc = loader.Load(path, doc, error);
  check(rc == 0, "Load returns 0");
  if (rc != 0) {
    std::printf("load error: %s\n", error.c_str());
    return 1;
  }

  check(doc.SignalCount() == 10, "10 signals parsed");
  check(doc.ScopeCount() >= 4, "scopes created (top + 3 modules)");
  check(!doc.timescale().empty(), "timescale set");
  std::printf("    timescale=%s min=%lld max=%lld signals=%zu scopes=%zu\n",
              doc.timescale().c_str(), (long long)doc.MinTime(),
              (long long)doc.MaxTime(), doc.SignalCount(), doc.ScopeCount());

  // 检查 clk 信号
  const VcdSignal* clk = doc.Signal(0);
  check(clk != nullptr, "signal 0 (clk) exists");
  if (clk) {
    std::printf("    clk: name=%s width=%d changes=%zu\n", clk->name.c_str(),
                clk->width, clk->times.size());
    check(clk->name == "top.u_clk.clk", "clk full path name");
    check(clk->width == 1, "clk width 1");
    check(clk->times.size() > 100, "clk has many changes");
    check(clk->values[0] == "0", "clk initial value 0");
    check(clk->values[1] == "1", "clk toggles to 1");
  }

  // 检查总线信号 result
  const VcdSignal* result = nullptr;
  for (const auto& s : doc.signals()) {
    if (s.name == "top.u_alu.result") { result = &s; break; }
  }
  check(result != nullptr, "result signal found");
  if (result) {
    check(result->width == 8, "result width 8");
    check(result->msb == 7 && result->lsb == 0, "result [7:0]");
    std::printf("    result: changes=%zu first=%s\n", result->times.size(),
                result->values.empty() ? "?" : result->values[0].c_str());
  }

  // 波形查询
  QueryRequest req;
  req.time_start = 0;
  req.time_end = doc.MaxTime();
  req.signal_ids = {0};
  req.max_points = 64;
  QueryResult qr = WaveformQuery::Query(doc, req);
  check(!qr.signals.empty() && qr.signals[0].id == 0, "query returns clk");
  check(qr.signals[0].times.size() <= 64, "query decimates to max_points");
  check(qr.end, "query covers full range");
  std::printf("    query: clk points=%zu timeline=%zu\n",
              qr.signals[0].times.size(), qr.timeline.size());

  // 局部窗口查询
  QueryRequest req2;
  req2.time_start = 100;
  req2.time_end = 500;
  req2.signal_ids = {0};
  req2.max_points = 0;
  QueryResult qr2 = WaveformQuery::Query(doc, req2);
  check(qr2.signals[0].times.front() >= 100, "window lower bound");
  check(qr2.signals[0].times.back() <= 500, "window upper bound");
  std::printf("    window[100,500]: points=%zu first=%lld last=%lld\n",
              qr2.signals[0].times.size(),
              (long long)qr2.signals[0].times.front(),
              (long long)qr2.signals[0].times.back());

  std::printf("== %s (%d failures) ==\n", failures ? "FAILED" : "PASSED", failures);
  return failures ? 1 : 0;
}


