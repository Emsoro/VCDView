#pragma once
#include "tauricpp/bridge.hpp"

namespace gtkwave {

/// 注册全部 IPC 命令到 Bridge
void RegisterCommands(tauricpp::Bridge& bridge);

} // namespace gtkwave
