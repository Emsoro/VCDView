#!/usr/bin/env python3
"""生成测试 VCD 文件，用于验证 GTKWave Lite 解析与渲染链路。

用法:
    python tools/gen_test_vcd.py [output.vcd] [scale]

默认输出到 d:/Work/CPlusPlus/GTKWave/test_data/demo.vcd
scale 参数放大时间与数据规模（默认 1）。
"""
import sys
import os

def generate(path: str, scale: int = 1):
    lines = []
    lines.append("$date")
    lines.append("  Mon Aug 10 2026 09:00:00")
    lines.append("$end")
    lines.append("$version")
    lines.append("  GTKWave Lite Test VCD 0.1")
    lines.append("$end")
    lines.append("$timescale 1ns $end")

    # 层次结构: top / u_clk / u_alu / u_ctrl
    lines.append("$scope module top $end")
    lines.append("$scope module u_clk $end")
    lines.append("$var wire 1 ! clk $end")
    lines.append("$var wire 1 \" rst_n $end")
    lines.append("$upscope $end")
    lines.append("$scope module u_alu $end")
    lines.append("$var wire 8 # a $end")
    lines.append("$var wire 8 $ b $end")
    lines.append("$var reg 8 % result $end")
    lines.append("$var wire 1 & carry $end")
    lines.append("$upscope $end")
    lines.append("$scope module u_ctrl $end")
    lines.append("$var reg 2 ' state $end")
    lines.append("$var wire 1 ( enable $end")
    lines.append("$upscope $end")
    lines.append("$var integer 32 ) counter $end")
    lines.append("$var wire 1 * busy $end")
    lines.append("$upscope $end")
    lines.append("$enddefinitions $end")

    # 时间起点（用分块时间，便于抽稀观察）
    T = 0
    clk = 0
    lines.append("#0")
    lines.append("$dumpvars")
    lines.append("0!")
    lines.append("1\"")
    lines.append("b00000000 #")
    lines.append("b00000000 $")
    lines.append("b00000000 %")
    lines.append("0&")
    lines.append("b00 '")
    lines.append("1(")
    lines.append("b00000000000000000000000000000000 )")
    lines.append("0*")
    lines.append("$end")

    n = 200 * scale  # 时钟周期数
    result = 0
    counter = 0
    state = 0
    carry = 0
    for i in range(n):
        T = 10 + i * 20
        clk ^= 1
        lines.append(f"#{T}")
        lines.append(f"{clk}!")

        # 每个周期更新一次总线
        T2 = T + 10
        a = (i * 7) & 0xFF
        b = (i * 3 + 5) & 0xFF
        result = (a + b) & 0xFF
        carry = 1 if (a + b) > 0xFF else 0
        counter += 1
        if i % 5 == 0:
            state = (state + 1) & 0x3
        enable = 1 if (i % 3) == 0 else 0
        busy = 1 if (i % 7) == 0 else 0

        lines.append(f"#{T2}")
        lines.append(f"b{a:08b} #")
        lines.append(f"b{b:08b} $")
        lines.append(f"b{result:08b} %")
        lines.append(f"{carry}&")
        lines.append(f"b{state:02b} '")
        lines.append(f"{enable}(")
        lines.append(f"b{counter:032b} )")
        lines.append(f"{busy}*")

    lines.append(f"#{T + 30}")
    lines.append("0!")

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print(f"generated: {path} ({len(lines)} lines)")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "test_data", "demo.vcd")
    scale = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    generate(out, scale)
