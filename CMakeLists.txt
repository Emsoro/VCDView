cmake_minimum_required(VERSION 3.15)
project(GTKWaveLite VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

if(MSVC)
    # 静态链接 MSVC 运行时（/MT），实现单文件免依赖部署（无需 VC++ Redistributable）
    cmake_policy(SET CMP0091 NEW)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    add_compile_options(/utf-8)
    # 生成 Per-Monitor V2 DPI 感知 manifest 片段，MSVC 会将其与默认 manifest 合并
    # 避免系统对窗口做位图拉伸缩放，消除 WebView2 在高DPI屏幕下的模糊问题
    set(DPI_MANIFEST_XML "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<assembly xmlns='urn:schemas-microsoft-com:asm.v1' manifestVersion='1.0'>
  <trustInfo xmlns=\"urn:schemas-microsoft-com:asm.v3\">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level='asInvoker' uiAccess='false' />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <application>
    <windowsSettings>
      <dpiAware xmlns='http://schemas.microsoft.com/SMI/2005/WindowsSettings'>true/pm</dpiAware>
      <dpiAwareness xmlns='http://schemas.microsoft.com/SMI/2016/WindowsSettings'>PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
  <compatibility xmlns='urn:schemas-microsoft-com:compatibility.v1'>
    <application>
      <!-- Windows 10/11 -->
      <supportedOS Id='{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}'/>
      <!-- Windows 8.1 -->
      <supportedOS Id='{1f676c76-80e1-4239-95bb-83d0f6d0da78}'/>
      <!-- Windows 8 -->
      <supportedOS Id='{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}'/>
      <!-- Windows 7 -->
      <supportedOS Id='{35138b9a-5d96-4fbd-8e2d-a2440225f93a}'/>
    </application>
  </compatibility>
</assembly>")
    file(WRITE "${CMAKE_BINARY_DIR}/generated/dpi_awareness.manifest" "${DPI_MANIFEST_XML}")
endif()

# ============================================================================
# 依赖管理
# ============================================================================

set(NLOHMANN_JSON_DIR "${CMAKE_SOURCE_DIR}/src/tauricpp/third_party/nlohmann")
if(NOT EXISTS "${NLOHMANN_JSON_DIR}/json.hpp")
    message(STATUS "Downloading nlohmann/json.hpp...")
    file(DOWNLOAD
        "https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp"
        "${NLOHMANN_JSON_DIR}/json.hpp"
        SHOW_PROGRESS
    )
endif()

set(WEBVIEW2_SEARCH_PATHS
    "${CMAKE_SOURCE_DIR}/vcpkg/installed/x64-windows"
    "$ENV{VCPKG_ROOT}/installed/x64-windows"
    "C:/vcpkg/installed/x64-windows"
    "${CMAKE_SOURCE_DIR}/third_party/WebView2"
)

find_path(WEBVIEW2_INCLUDE_DIR
    NAMES WebView2.h
    PATH_SUFFIXES include
    PATHS ${WEBVIEW2_SEARCH_PATHS}
)

find_library(WEBVIEW2_LIBRARY
    NAMES WebView2LoaderStatic WebView2Loader.dll.lib
    PATH_SUFFIXES lib
    PATHS ${WEBVIEW2_SEARCH_PATHS}
)

if(NOT WEBVIEW2_INCLUDE_DIR)
    message(FATAL_ERROR
        "WebView2 SDK not found!\n"
        "Install via: vcpkg install webview2 --classic\n"
        "Or download from: https://www.nuget.org/packages/Microsoft.Web.WebView2"
    )
endif()

message(STATUS "WebView2 include: ${WEBVIEW2_INCLUDE_DIR}")
message(STATUS "WebView2 library: ${WEBVIEW2_LIBRARY}")

# ============================================================================
# TauriCPP 静态库
# ============================================================================
file(GLOB TAURICPP_SOURCES "${CMAKE_SOURCE_DIR}/src/tauricpp/src/*.cpp")
add_library(tauricpp STATIC ${TAURICPP_SOURCES})

target_include_directories(tauricpp PUBLIC
    ${CMAKE_SOURCE_DIR}/src/tauricpp/include
    ${NLOHMANN_JSON_DIR}/..
    ${WEBVIEW2_INCLUDE_DIR}
)

target_link_libraries(tauricpp PUBLIC
    shlwapi
    shell32
    comdlg32
    ole32
    ${WEBVIEW2_LIBRARY}
)

# ============================================================================
# 资源打包：将前端文件生成.rc并编译嵌入exe
# 使用数字资源ID，确保 rc.exe 和 llvm-rc 兼容
# ============================================================================
# 只打包 vite 构建产物 frontend/dist（node_modules/源码不嵌入 exe）
set(FRONTEND_DIR "${CMAKE_SOURCE_DIR}/frontend/dist")
set(GEN_DIR "${CMAKE_BINARY_DIR}/generated")
file(MAKE_DIRECTORY "${GEN_DIR}")
set(RESOURCES_RC "${GEN_DIR}/resources.rc")
set(RESOURCE_MAP_CPP "${GEN_DIR}/resource_map.cpp")

find_package(Python3 COMPONENTS Interpreter)

if(Python3_Interpreter_FOUND)
    # ★ 收集前端文件列表作为依赖（CONFIGURE_DEPENDS：vite 产物 hash 变化时自动重新 configure）
    file(GLOB_RECURSE FRONTEND_FILES CONFIGURE_DEPENDS "${FRONTEND_DIR}/*")
    add_custom_command(
        OUTPUT "${RESOURCES_RC}" "${RESOURCE_MAP_CPP}"
        COMMAND ${Python3_EXECUTABLE} "${CMAKE_SOURCE_DIR}/src/tauricpp/tools/pack_resources.py"
                "${FRONTEND_DIR}" -o "${RESOURCES_RC}" -t "TAURI_RES"
        DEPENDS "${CMAKE_SOURCE_DIR}/src/tauricpp/tools/pack_resources.py" ${FRONTEND_FILES}
        COMMENT "Packing frontend resources into .rc file"
        VERBATIM
    )
else()
    # 没有Python时手动生成
    file(WRITE "${RESOURCES_RC}" "// Auto-generated resources\n")
    file(WRITE "${RESOURCE_MAP_CPP}" "// Auto-generated\n")
endif()

add_custom_target(pack_resources
    DEPENDS "${RESOURCES_RC}" "${RESOURCE_MAP_CPP}"
    COMMENT "Pack frontend resources"
)

# ============================================================================
# VCD 解析器（复用 GTKWave C 代码，GPL v2）
# ============================================================================
# 仅编译自包含的剥离版解析核心 vcd_core.c 及其内存/数值辅助 vcd_core_debug.c。
# src/vcd/ 下其余 .c/.h 为 GTKWave 原版参考文件（依赖 GTK/GConf，不参与构建）。
set(VCD_C_SOURCES
    "${CMAKE_SOURCE_DIR}/src/vcd/vcd_core.c"
    "${CMAKE_SOURCE_DIR}/src/vcd/vcd_core_debug.c"
)
set(VCD_CXX_SOURCES "")
add_library(vcdparser STATIC ${VCD_C_SOURCES} ${VCD_CXX_SOURCES})
target_include_directories(vcdparser PUBLIC
    ${CMAKE_SOURCE_DIR}/src/vcd
    ${CMAKE_SOURCE_DIR}/src/core
)
if(MSVC)
    target_compile_options(vcdparser PRIVATE /wd4996 /wd4244 /wd4267 /wd4018 /wd4101)
endif()

# ============================================================================
# 后端核心（文档模型 / 加载器 / 波形查询）
# ============================================================================
file(GLOB CORE_CPP_SOURCES "${CMAKE_SOURCE_DIR}/src/core/*.cpp")
add_library(gtkwavecore STATIC ${CORE_CPP_SOURCES})
target_include_directories(gtkwavecore PUBLIC
    ${CMAKE_SOURCE_DIR}/src/core
    ${CMAKE_SOURCE_DIR}/src/vcd
    ${NLOHMANN_JSON_DIR}/..
)
target_link_libraries(gtkwavecore PUBLIC vcdparser)

# ============================================================================
# IPC 命令层
# ============================================================================
file(GLOB IPC_CPP_SOURCES "${CMAKE_SOURCE_DIR}/src/ipc/*.cpp")

# ============================================================================
# 主应用
# ============================================================================
set(APP_ADDITIONAL_SOURCES "")
if(MSVC)
    list(APPEND APP_ADDITIONAL_SOURCES "${CMAKE_BINARY_DIR}/generated/dpi_awareness.manifest")
endif()

add_executable(VCDView WIN32
    src/main.cpp
    ${IPC_CPP_SOURCES}
    "${RESOURCE_MAP_CPP}"
    "${RESOURCES_RC}"
    ${APP_ADDITIONAL_SOURCES}
)

target_include_directories(VCDView PRIVATE
    "${GEN_DIR}"
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/src/core
    ${CMAKE_SOURCE_DIR}/src/ipc
)
target_link_libraries(VCDView PRIVATE
    tauricpp
    gtkwavecore
)

add_dependencies(VCDView pack_resources)

# ============================================================================
# 冒烟测试：vcd_parser_test（无 UI，验证 C 解析器 → VcdDocument → WaveformQuery 链路）
# 运行: ctest --test-dir build -R vcd_parser_test --output-on-failure
# ============================================================================
if(EXISTS "${CMAKE_SOURCE_DIR}/tests/vcd_parser_test.cpp")
    add_executable(vcd_parser_test tests/vcd_parser_test.cpp)
    target_include_directories(vcd_parser_test PRIVATE
        ${CMAKE_SOURCE_DIR}/src/core
        ${CMAKE_SOURCE_DIR}/src/vcd
    )
    target_link_libraries(vcd_parser_test PRIVATE gtkwavecore)
    enable_testing()
    add_test(NAME vcd_parser_test COMMAND vcd_parser_test "${CMAKE_SOURCE_DIR}/test_data/demo.vcd")
endif()
