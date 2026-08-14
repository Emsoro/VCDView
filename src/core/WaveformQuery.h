#pragma once
#include "VcdDocument.h"
#include <cstdint>
#include <string>
#include <vector>

namespace gtkwave {

/** 单信号查询结果 */
struct SignalChanges {
  int id = -1;
  std::vector<int64_t> times;
  std::vector<std::string> values;
};

/** 波形查询请求 */
struct QueryRequest {
  int64_t time_start = 0;
  int64_t time_end = 0;
  std::vector<int> signal_ids;
  size_t max_points = 4096;  // 每信号最大变化点数（0 表示不限）
};

/** 波形查询结果 */
struct QueryResult {
  std::vector<int64_t> timeline;  // 窗口内全部变化时间的并集（抽稀后）
  std::vector<SignalChanges> signals;
  bool end = true;  // time_end 是否已到文件末尾
};

/** 波形数据查询：时间二分 + 变化点遍历 + 抽稀 */
class WaveformQuery {
 public:
  static QueryResult Query(const VcdDocument& doc, const QueryRequest& req);

 private:
  /// 均匀抽稀，保留首末点
  static void Decimate(const std::vector<int64_t>& times,
                       const std::vector<std::string>& vals, size_t max_points,
                       std::vector<int64_t>& out_times,
                       std::vector<std::string>& out_vals);
};

}  // namespace gtkwave
