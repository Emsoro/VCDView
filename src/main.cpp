#include "tauricpp/app.hpp"
#include "ipc/commands.h"
#include <Windows.h>

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int) {
    // WebView2Loader 已静态链接，无需运行时加载DLL

    // 配置应用
    tauricpp::App::Config config;
    config.window_config.title = "VCDView";
    config.window_config.width = 1280;
    config.window_config.height = 800;
    config.window_config.center = true;
    config.window_config.devtools = true;  // 启用DevTools，F12切换

    tauricpp::App app(config);

    // 注册全部 IPC 命令（文件打开 / 文档信息 / 层次树 / 波形查询）
    gtkwave::RegisterCommands(app.GetBridge());

    return app.Run();
}
