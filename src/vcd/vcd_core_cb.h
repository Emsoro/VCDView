/* vcd_core_cb.h - VCD 解析器回调接口
 *
 * 由 C++ 封装层 (VcdLoader) 实现回调，替代原 GTKWave vcd2lxt2.c 中的
 * lxt2 写入逻辑。解析器只负责解析，数据通过回调交付。
 *
 * 此文件为 GTKWave Lite 新增（MIT 风格接口头）。
 */
#ifndef VCD_CORE_CB_H
#define VCD_CORE_CB_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct vcd_core_cb_t {
    void *userdata;

    /* 信号注册。name 为完整层次路径（不含位下标），如 "top.u_alu.result"。
     * msi/lsi 为位范围（标量 msi==lsi==0），vartype 为 VCD 类型
     * （V_WIRE=1, V_REG=2, V_INTEGER=4, V_REAL=8 等，见 vcd_core.c 中
     * vcd_parse 的 $var 类型表）。
     * 返回后端分配的信号索引（>=0），供后续 on_value 使用。 */
    int (*on_signal)(void *ud, const char *name, int msi, int lsi,
                     unsigned char vartype);

    /* 值变化。sig 为 on_signal 返回的索引，value 为完整值字符串
     * （标量："0"/"1"/"x"/"z"；向量："1010" 等；real："1.5"）。 */
    void (*on_value)(void *ud, int sig, const char *value);

    /* 时间推进（# 指令）。t 为原始仿真时间刻度值。 */
    void (*on_time)(void *ud, signed long long t);

    /* timescale 声明（如 "1ns"）。 */
    void (*on_timescale)(void *ud, const char *timescale);

    /* time zero（通常为 0，可忽略）。 */
    void (*on_timezero)(void *ud, signed long long t);

    /* $dumpoff / $dumpon 状态切换。 */
    void (*on_dumpoff)(void *ud);
    void (*on_dumpon)(void *ud);
} vcd_core_cb_t;

/* 解析 VCD 文件。
 * 成功返回 0；文件打开失败返回 -1；解析失败返回 -2。
 * errbuf（可为 NULL）接收错误描述。 */
int vcd_core_parse(const char *fname, const vcd_core_cb_t *cb, void *userdata,
                   char *errbuf, int errbuf_len);

#ifdef __cplusplus
}
#endif

#endif /* VCD_CORE_CB_H */
