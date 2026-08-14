#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace gtkwave {

/** VCD 信号类型（与 vcd_core.c 的 VarTypes 一致） */
enum VcdVarType : unsigned char {
  V_WIRE = 1,
  V_REG = 2,
  V_PARAMETER = 3,
  V_INTEGER = 4,
  V_REAL = 8,
};

/** 层次树节点 */
struct VcdNode {
  int id = -1;
  std::string name;
  bool is_scope = true;
  int parent = -1;
  std::vector<int> children;
  // 信号节点字段
  int signal_idx = -1;  // 关联 VcdSignal::id
  int msb = 0;
  int lsb = 0;
  int width = 1;
  unsigned char vartype = 0;
};

/** 单个信号：名称 + 变化点序列 */
struct VcdSignal {
  int id = -1;
  std::string name;  // 完整层次路径（不含位下标）
  int msb = 0;
  int lsb = 0;
  int width = 1;
  unsigned char vartype = 0;
  std::vector<int64_t> times;    // 与 values 等长，单调不减
  std::vector<std::string> values;  // 每变化点的完整值字符串
};

/** VCD 文档模型 */
class VcdDocument {
 public:
  VcdDocument() = default;
  ~VcdDocument() = default;
  VcdDocument(const VcdDocument&) = delete;
  VcdDocument& operator=(const VcdDocument&) = delete;

  void Clear();

  /// 注册信号（C 解析器 on_signal 回调入口），返回信号索引
  int AddSignal(const std::string& full_name, int msb, int lsb, unsigned char vartype);

  /// 追加变化点（C 解析器 on_value 回调入口）
  void AddValue(int signal_id, int64_t t, const std::string& value);

  /// 设置 timescale
  void SetTimescale(const std::string& ts) { timescale_ = ts; }

  // accessors
  const std::vector<VcdSignal>& signals() const { return signals_; }
  const VcdSignal* Signal(int id) const {
    if (id >= 0 && id < static_cast<int>(signals_.size())) return &signals_[id];
    return nullptr;
  }
  VcdSignal* Signal(int id) {
    if (id >= 0 && id < static_cast<int>(signals_.size())) return &signals_[id];
    return nullptr;
  }
  const VcdNode* Root() const { return root_.get(); }
  VcdNode* Root() { return root_.get(); }
  const VcdNode* NodeById(int id) const;
  VcdNode* NodeById(int id);
  int64_t MinTime() const { return min_time_; }
  int64_t MaxTime() const { return max_time_; }
  const std::string& timescale() const { return timescale_; }
  size_t SignalCount() const { return signals_.size(); }
  size_t ScopeCount() const { return scope_count_; }

  void Finalize();  // 解析完成后调用：计算 min/max time

 private:
  VcdNode* FindOrCreateScope(VcdNode* parent, const std::string& name);

  std::vector<VcdSignal> signals_;
  std::unique_ptr<VcdNode> root_;
  std::vector<std::unique_ptr<VcdNode>> owned_nodes_;
  std::string timescale_ = "1s";
  int64_t min_time_ = 0;
  int64_t max_time_ = 0;
  int node_id_counter_ = 0;
  size_t scope_count_ = 0;
};

}  // namespace gtkwave
