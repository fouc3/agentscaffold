# 各栈的采样工具与读法

先选工具，再看记录。**优先用非侵入式采样**：能不动代码就不动代码，因为改代码本身就是变量。

## 通用原则

- 采样而不是插桩：插桩会改变时序，找「慢在哪」优先用采样。
- 采样频率与时长要匹配：想看清短函数，就得提高频率或延长总时长。
- **符号必须先解决**：否则你看到的是一堆地址。原生程序要有 debug 信息（`-g`，或保留符号文件），
  Java/C# 要看是否有方法名，解释型语言要确认版本与源码路径对得上。

## 原生程序（C / C++ / Rust / Go）

| 工具 | 抓取 | 查看 | 备注 |
| --- | --- | --- | --- |
| `samply` | `samply record <命令>` | `samply load <profile.json>` | 自带界面，输出可分享；也能读别人的 profile |
| `perf` | `perf record -g <命令>` | `perf report` / 火焰图脚本 | Linux 原生，需要 `perf_event_paranoid` 允许 |
| Go 自带 | `go test -cpuprofile cpu.out` | `go tool pprof -http=:0 cpu.out` | 含内存 profile（`-memprofile`） |

坑：

- Go 的 pprof 里 `runtime` 相关占比高时，先看是不是 GC 频繁（`-alloc_space` 对照看）。
- Rust release 构建默认没有符号：需要 `[profile.release] debug = 1` 或 `-C debuginfo=1`。

## Python

| 工具 | 抓取 | 备注 |
| --- | --- | --- |
| `py-spy` | `py-spy record -o p.svg --pid <pid>` | 非侵入，能看运行中的进程；`py-spy top` 适合快速扫一眼 |
| `cProfile` | 改代码或 `python -m cProfile` | 侵入式，会放大函数调用开销，适合看调用次数而非绝对耗时 |

坑：GIL 存在时，多线程程序的 CPU 时间只出现在拿到 GIL 的线程上；
真实瓶颈可能是等 IO 或等 GIL，别只盯着热点函数。

## Node.js / TypeScript

| 工具 | 抓取 | 查看 |
| --- | --- | --- |
| 内置 | `node --cpu-prof --cpu-prof-dir=./prof app.js` | 产出的 `.cpuprofile` 拖进 Chrome DevTools 的 Performance 面板 |
| 长期运行 | `node --inspect` + DevTools | 适合线上进程按需抓一段 |

坑：`.cpuprofile` 里的 `(idle)`、`(program)`、`(garbage collector)` 是伪节点——
先看这三项占比，能立刻区分「CPU 忙」还是「在等」。

## Gecko / Firefox

- `profiler-cli`：先 `profiler-cli guide` 读命令参考，再 `load` 成命名 session 做结构化查询。
- **不要用网页抓取去读 profiler 链接**：抓回来的是界面外壳，没有数据。
- 记录要带符号（默认开发构建有；发布构建需要专门配置）。

## 通用坑清单

1. **把包含时间当自身时间**：火焰图里一层的宽度是它 + 它调用的全部，判断根因要看最深的、
   自身占比高的那一层。
2. **样本太少**：占比 3% 与 5% 在 200 个样本上不可区分。
3. **跨机型比较**：不同 CPU / 负载状态下的数字不能直接对比。
4. **只看一次记录**：单次采样可能正好碰上一次 GC 或一次冷启动，重复两次再下结论。
5. **缺符号造成的假热点**：一大块 `[unknown]` 通常是你没带符号，不是真的慢在那里。
6. **把 `idle` 当开销**：空闲占比高说明瓶颈不在 CPU —— 去找等待什么（IO、锁、外部服务）。
