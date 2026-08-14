#include "VcdDocument.h"

#include <cstdlib>

namespace gtkwave {

void VcdDocument::Clear() {
  signals_.clear();
  root_.reset();
  timescale_ = "1s";
  min_time_ = 0;
  max_time_ = 0;
  node_id_counter_ = 0;
  scope_count_ = 0;
}

VcdNode* VcdDocument::FindOrCreateScope(VcdNode* parent, const std::string& name) {
  for (int cid : parent->children) {
    VcdNode* child = NodeById(cid);
    if (child && child->is_scope && child->name == name) return child;
  }
  auto* node = new VcdNode;
  node->id = node_id_counter_++;
  node->name = name;
  node->is_scope = true;
  node->parent = parent->id;
  parent->children.push_back(node->id);
  scope_count_++;
  owned_nodes_.emplace_back(node);
  return node;
}

const VcdNode* VcdDocument::NodeById(int id) const {
  for (const auto& n : owned_nodes_) {
    if (n->id == id) return n.get();
  }
  return nullptr;
}

VcdNode* VcdDocument::NodeById(int id) {
  for (const auto& n : owned_nodes_) {
    if (n->id == id) return n.get();
  }
  return nullptr;
}

int VcdDocument::AddSignal(const std::string& full_name, int msb, int lsb,
                           unsigned char vartype) {
  if (!root_) {
    root_ = std::make_unique<VcdNode>();
    root_->id = node_id_counter_++;
    root_->name = "root";
    root_->is_scope = true;
    root_->parent = -1;
  }

  // 按 '.' 拆分层次路径，逐级构建 scope，最后创建信号叶节点
  VcdNode* cur = root_.get();
  std::string remain = full_name;
  size_t pos = 0;
  while ((pos = remain.find('.')) != std::string::npos) {
    cur = FindOrCreateScope(cur, remain.substr(0, pos));
    remain = remain.substr(pos + 1);
  }
  // 最后一段是信号名
  const std::string leaf = remain;

  auto* node = new VcdNode;
  node->id = node_id_counter_++;
  node->name = leaf;
  node->is_scope = false;
  node->parent = cur->id;
  cur->children.push_back(node->id);

  int id = static_cast<int>(signals_.size());
  VcdSignal sig;
  sig.id = id;
  sig.name = full_name;
  sig.msb = msb;
  sig.lsb = lsb;
  sig.width = std::abs(msb - lsb) + 1;
  if (sig.width < 1) sig.width = 1;
  sig.vartype = vartype;

  node->signal_idx = id;
  node->msb = msb;
  node->lsb = lsb;
  node->width = sig.width;
  node->vartype = vartype;

  signals_.push_back(std::move(sig));
  owned_nodes_.emplace_back(node);
  return id;
}

void VcdDocument::AddValue(int signal_id, int64_t t, const std::string& value) {
  if (signal_id < 0 || signal_id >= static_cast<int>(signals_.size())) return;
  VcdSignal& s = signals_[signal_id];
  // 相同时间相同值：覆盖（VCD 事件信号可能同时间多发）
  if (!s.times.empty() && s.times.back() == t && s.values.back() == value) return;
  s.times.push_back(t);
  s.values.push_back(value);
}

void VcdDocument::Finalize() {
  min_time_ = 0;
  max_time_ = 0;
  for (const auto& s : signals_) {
    for (int64_t t : s.times) {
      if (max_time_ < t) max_time_ = t;
    }
  }
}

}  // namespace gtkwave
