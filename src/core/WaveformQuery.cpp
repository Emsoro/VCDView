#include "WaveformQuery.h"

#include <algorithm>

namespace gtkwave {

void WaveformQuery::Decimate(const std::vector<int64_t>& times,
                             const std::vector<std::string>& vals,
                             size_t max_points,
                             std::vector<int64_t>& out_times,
                             std::vector<std::string>& out_vals) {
  out_times.clear();
  out_vals.clear();
  const size_t n = times.size();
  if (n == 0 || max_points == 0) {
    out_times = times;
    out_vals = vals;
    return;
  }
  if (n <= max_points) {
    out_times = times;
    out_vals = vals;
    return;
  }
  out_times.reserve(max_points);
  out_vals.reserve(max_points);
  for (size_t k = 0; k < max_points; ++k) {
    size_t idx = k * (n - 1) / (max_points - 1);
    out_times.push_back(times[idx]);
    out_vals.push_back(vals[idx]);
  }
}

QueryResult WaveformQuery::Query(const VcdDocument& doc,
                                 const QueryRequest& req) {
  QueryResult res;
  res.end = req.time_end >= doc.MaxTime();

  std::vector<int64_t> merged;
  std::vector<SignalChanges> collected;
  collected.reserve(req.signal_ids.size());

  for (int id : req.signal_ids) {
    const VcdSignal* s = doc.Signal(id);
    SignalChanges sc;
    sc.id = id;
    if (s) {
      // 二分查找第一个 >= time_start 的变化点
      auto it = std::lower_bound(s->times.begin(), s->times.end(), req.time_start);
      while (it != s->times.end() && *it <= req.time_end) {
        size_t idx = static_cast<size_t>(std::distance(s->times.begin(), it));
        sc.times.push_back(*it);
        sc.values.push_back(s->values[idx]);
        merged.push_back(*it);
        ++it;
      }
    }
    collected.push_back(std::move(sc));
  }

  // 每信号抽稀
  res.signals.reserve(collected.size());
  for (auto& sc : collected) {
    SignalChanges out;
    out.id = sc.id;
    Decimate(sc.times, sc.values, req.max_points, out.times, out.values);
    res.signals.push_back(std::move(out));
  }

  // timeline：窗口内全部变化时间并集，抽稀
  std::sort(merged.begin(), merged.end());
  merged.erase(std::unique(merged.begin(), merged.end()), merged.end());
  if (req.max_points && merged.size() > req.max_points) {
    std::vector<int64_t> slim;
    slim.reserve(req.max_points);
    const size_t n = merged.size();
    for (size_t k = 0; k < req.max_points; ++k) {
      slim.push_back(merged[k * (n - 1) / (req.max_points - 1)]);
    }
    res.timeline = std::move(slim);
  } else {
    res.timeline = std::move(merged);
  }

  return res;
}

}  // namespace gtkwave
