/* config.h - 裁剪版配置（替代 autoconf 生成的 config.h）
 * 仅供 src/vcd/ 下复用的 GTKWave C 解析器使用。
 */
#ifndef VCD_CONFIG_H
#define VCD_CONFIG_H

#define HAVE_INTTYPES_H 1
#define HAVE_STDINT_H 1

/* Windows (MSVC) 下无 getopt/unistd */
#ifdef _MSC_VER
#define HAVE_GETOPT_H 0
#define HAVE_UNISTD_H 0
#else
#define HAVE_GETOPT_H 1
#define HAVE_UNISTD_H 1
#endif

#endif /* VCD_CONFIG_H */
