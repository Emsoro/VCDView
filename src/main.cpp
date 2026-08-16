#include "tauricpp/app.hpp"
#include "ipc/commands.h"
#include <Windows.h>

// 应用图标资源ID（与 src/appicon.rc 保持一致）
#define IDI_APP_ICON 1000

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

    // 加载并应用应用图标
    app.OnSetup([](tauricpp::App& app) {
        HICON hIcon = reinterpret_cast<HICON>(LoadImageW(
            GetModuleHandle(nullptr),
            MAKEINTRESOURCEW(IDI_APP_ICON),
            IMAGE_ICON,
            0, 0,
            LR_DEFAULTSIZE | LR_SHARED));
        if (hIcon) {
            app.GetWindow().SetIcon(hIcon);
        }
    });

    // 注册全部 IPC 命令（文件打开 / 文档信息 / 层次树 / 波形查询）
    gtkwave::RegisterCommands(app.GetBridge());

    return app.Run();
}
