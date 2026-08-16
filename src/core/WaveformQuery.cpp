#include "WaveformQuery.h"

#include <algorithm>

namespace gtkwave {

namespace {

// 将 GTKWave 风格的值字符串（可能带 b/h/d 前缀，或纯二进制串）解析为二进制位向量。
// 返回长度与 width 一致，索引 0 为 LSB（最右）。无法识别的字符原样保留（x/z/u/...）。
std::string NormalizeBits(const std::string& raw, int width) {
  std::string bits;  // MSB-first，长度 = 位数
  std::string v = raw;
  if (!v.empty()) {
    char p = v[0];
    if (p == 'b' || p == 'B') {
      bits = v.substr(1);  // 已是二进制，MSB-first
    } else if (p == 'h' || p == 'H') {
      for (size_t i = 1; i < v.size(); ++i) {
        int nib;
        char c = v[i];
        if (c >= '0' && c <= '9') nib = c - '0';
        else if (c >= 'a' && c <= 'f') nib = c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') nib = c - 'A' + 10;
        else nib = -1;  // x/z 等
        if (nib < 0) {
          bits.push_back(c);
        } else {
          // MSB-first 四位
          bits.push_back((nib & 8) ? '1' : '0');
          bits.push_back((nib & 4) ? '1' : '0');
          bits.push_back((nib & 2) ? '1' : '0');
          bits.push_back((nib & 1) ? '1' : '0');
        }
      }
    } else {
      // 纯二进制串或十进制。GTKWave 二进制串为 0/1/x/z...，直接视为 MSB-first。
      bits = v;
    }
  }
  // 对齐到 width（右对齐，多余左边截，不足左补 '0'）
  if (width > 0 && bits.size() != static_cast<size_t>(width)) {
    std::string out(width, '0');
    int n = static_cast<int>(bits.size());
    for (int i = 0; i < n && i < width; ++i) {
      // 复制最右 width 位
      out[width - 1 - i] = bits[n - 1 - i];
    }
    bits = out;
  }
  return bits;
}

// 取某一位（0=LSB）的标量值字符
char GetBitValue(const std::string& raw, int width, int bit) {
  std::string bits = NormalizeBits(raw, width);
  if (bits.empty()) return 'x';
  int idx = width - 1 - bit;  // MSB-first 转数组下标
  if (idx < 0 || idx >= static_cast<int>(bits.size())) return 'x';
  char c = bits[idx];
  // 归并到四种标准值
  if (c == '1' || c == 'h' || c == 'H') return '1';
  if (c == '0' || c == 'l' || c == 'L') return '0';
  if (c == 'z' || c == 'Z') return 'z';
  return 'x';
}

}  // namespace

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

  for (size_t si = 0; si < req.signal_ids.size(); ++si) {
    int id = req.signal_ids[si];
    int bit = (si < req.bit_indices.size()) ? req.bit_indices[si] : -1;
    const VcdSignal* s = doc.Signal(id);
    SignalChanges sc;
    sc.id = id;
    if (s) {
      sc.width = s->width;
      sc.bit = bit;
      // 二分查找第一个 >= time_start 的变化点
      auto it = std::lower_bound(s->times.begin(), s->times.end(), req.time_start);
      while (it != s->times.end() && *it <= req.time_end) {
        size_t idx = static_cast<size_t>(std::distance(s->times.begin(), it));
        sc.times.push_back(*it);
        if (bit >= 0) {
          sc.values.push_back(std::string(1, GetBitValue(s->values[idx], s->width, bit)));
        } else {
          sc.values.push_back(s->values[idx]);
        }
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
    out.width = sc.width;  // 保留位宽（供前端 bus 折叠判断 + sigKey）
    out.bit = sc.bit;      // 保留 bit 索引（供前端 sigKey 区分 bit 行）
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
