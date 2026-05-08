# 🐕 土狗猎手 TuGou Catcher

> 基于真实链上数据的 Solana Memecoin 模拟交易系统

**土狗猎手**是一个全自动化的 Solana 链上"土狗币"（Memecoin）模拟交易系统。它会实时抓取 DexScreener 和 Solana 主网数据，通过 **10 大策略模块（16 维评分）** 联合筛选出有潜力的新代币，经过**动量观察池趋势确认**后自动执行模拟建仓，使用**阶梯止盈**逐级锁定利润，并在交易积累后自动优化策略权重。前端 Dashboard 通过 WebSocket 实时呈现全部运行状态和策略信号。

> ⚠️ **声明**：本项目仅用于模拟交易和链上数据研究，不涉及真实的钱包签名或链上转账，不构成任何投资建议。

---

## 目录

- [系统架构](#系统架构)
- [技术栈](#技术栈)
- [核心模块详解](#核心模块详解)
  - [数据采集层 — Fetcher](#1-数据采集层--fetcher)
  - [多因子筛选引擎 — Screener](#2-多因子筛选引擎--screener)
  - [模拟交易引擎 — Trader](#3-模拟交易引擎--trader)
  - [实时监控引擎 — Monitor](#4-实时监控引擎--monitor)
  - [策略自优化器 — Optimizer](#5-策略自优化器--optimizer)
  - [持久化层 — Database](#6-持久化层--database)
  - [通信层 — Server](#7-通信层--server)
  - [前端 Dashboard](#8-前端-dashboard)
- [策略思想](#策略思想)
- [快速启动](#快速启动)
- [环境变量与 API Key](#环境变量与-api-key)
- [手动分别启动](#手动分别启动)
- [验证服务状态](#验证服务状态)
- [API 速查](#api-速查)
- [生产构建](#生产构建)
- [优化方向](#优化方向)
- [数据重置](#数据重置)
- [常见问题排查](#常见问题排查)

---

## 系统架构

```
┌────────────────────────────────────────────────────────────────┐
│                        前端 Dashboard                          │
│    React 19 + Vite + Tailwind CSS 4 + Recharts                │
│    WebSocket 实时推送 ─── REST API 查询                        │
└─────────────────────────────┬──────────────────────────────────┘
                              │ WebSocket / HTTP
┌─────────────────────────────▼──────────────────────────────────┐
│                     后端 Server (Express)                      │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌────────────┐ │
│  │  Fetcher   │  │ Screener  │  │  Trader   │  │  Optimizer │ │
│  │  数据采集   │  │ 多因子筛选 │  │ 模拟交易  │  │  策略自优化 │ │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └──────┬─────┘ │
│        │              │              │               │        │
│        ▼              ▼              ▼               ▼        │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Monitor (调度中枢)                          │  │
│  │  发现新币 → 筛选评分 → 自动建仓 → 价格监控 → 止盈止损     │  │
│  │  → 平仓 → 策略复盘 → 权重调整 → 循环                     │  │
│  └────────────────────────┬────────────────────────────────┘  │
│                           │                                    │
│  ┌────────────────────────▼────────────────────────────────┐  │
│  │          SQLite (better-sqlite3, WAL 模式)              │  │
│  │    tokens / trades / snapshots / strategy_logs / alerts │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
           ▲                                  ▲
           │                                  │
    DexScreener API                  Solana Mainnet RPC
    (代币发现 + 行情)              (权限/持仓/供应量验证)
```

---

## 技术栈

| 层级 | 技术选型 |
|------|---------|
| 后端运行时 | Node.js 20+ / TypeScript |
| 后端框架 | Express 4 + ws (WebSocket) |
| 持久化 | SQLite — better-sqlite3 (WAL 模式) |
| 开发热重载 | tsx watch |
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 8 |
| 样式 | Tailwind CSS 4 |
| 图表 | Recharts |
| 图标 | Lucide React |
| 链上数据源 | DexScreener API + Solana mainnet RPC |
| 并发启动 | concurrently（根 package.json 统一管理） |

---

## 核心模块详解

### 1. 数据采集层 — Fetcher

**文件**: `backend/src/fetcher.ts`

负责与外部数据源交互，是整个系统的"眼睛"。

**设计要点**：

- **串行限速队列**：所有外部请求通过 `rateLimitedFetch()` 统一排队，维护 350ms 最小请求间隔（`MIN_REQUEST_INTERVAL`），避免触发 DexScreener / Solana RPC 的限流
- **多级缓存**：Token 的 mint/freeze authority 缓存 30 分钟（`AUTHORITY_CACHE_TTL`），持仓分布缓存 10 分钟（`HOLDER_CACHE_TTL`），减少重复 RPC 请求
- **超时控制**：每个请求 15 秒 AbortController 超时，防止慢请求阻塞流水线
- **多源发现**：优先拉取 DexScreener 的 Boosted Token 列表，不足时回退到 Latest Profiles，再通过关键词搜索补充
- **去重最优对**：同一 token 在多个 DEX 有交易对时，自动保留流动性最高的那个

**数据流**：
```
DexScreener Boost API  ──┐
DexScreener Profile API ──┼──→ 过滤 Solana ──→ 批量拉取详情（每批≤30）
DexScreener Search API ──┘
                                                    │
Solana RPC (getAccountInfo)  ──→ Mint/Freeze 权限检查 ──┤
Solana RPC (getTokenLargestAccounts + Supply)────────────┘
                                                    │
                                            pairToTokenData() 标准化
```

### 2. 多因子筛选引擎 — Screener

**文件**: `backend/src/screener.ts`

对每个发现的 token 进行 **16 维评分**（含 3 个硬性门槛），判断是否值得模拟建仓。

**硬性门槛（任一触发直接淘汰）**：

| # | 门槛 | 策略模块 |
|---|------|---------|
| 1 | **Mint Authority 未撤销** | 合约安全 |
| 2 | **蜜罐检测** — 买卖不对称、零卖出 | `honeypot.ts` |
| 3 | **叙事封杀** — 该叙事近 2 小时 ≥3 次 Rug | `narrative.ts` |
| 4 | **创建者黑名单** — 部署者地址在 blacklist 中 | `creator.ts` |

> **降级处理**：当 Solana RPC 超时导致 authority 检查失败时，标记为 `inconclusive` 而非默认通过，并在评分中扣分同时记录警告，避免因 RPC 不可用而放过危险 token。

**评分维度（加权累计）**：

| # | 评分维度 | 权重 | 策略模块 | 逻辑 |
|---|---------|------|---------|------|
| 1 | 合约安全性 | 20 | 内置 | Freeze Authority 撤销加分 |
| 2 | 流动性深度 | 15 | 内置 | ≥$100K 满分, ≥$50K 60%, <$50K 零分 |
| 3 | 交易量/市值比 | 10 | 内置 | 10%~50% 为健康区间 |
| 4 | 市值/流动性比 | 10 | 内置 | <20x 厚实盘口, >50x 砸盘风险 |
| 5 | 持仓分布 | 10 | 内置 | Top 10 <30% 为良好分散 |
| 6 | 买入压力 | 10 | 内置 | Buy/Sell ratio >1.5x 为强买入 |
| 7 | 价格动量 | 10 | 内置 | 5m+1h 均正且 <100% 为健康上涨 |
| 8 | 新鲜度 | 5 | 内置 | 上线 <24h 额外加分 |
| 9 | 叙事加分 | 可变 | 内置 | AI/Meme/Political 热门关键词匹配 |
| 10 | **动量确认** | +5 | `momentum.ts` | 观察池中连续 3 次上涨确认 |
| 11 | **社交信号** | ±8 | `social.ts` | Twitter/Telegram/Discord/Website 分析 |
| 12 | **创建者行为** | ±20 | `creator.ts` | 部署者历史 Rug 分析，黑名单检测 |
| 13 | **LP 锁定** | ±12 | `lp-lock.ts` | LP 已烧毁 +12, 已锁定 +8, 创建者 LP 过高 -10 |
| 14 | **聪明钱信号** | +15 | `smart-money.ts` | 已知盈利钱包买入数量 |
| 15 | **时间窗口** | ±8 | `time-window.ts` | 活跃时段 +5, 低谷时段 -8 |
| 16 | **成交量异常** | -15 | `volume-anomaly.ts` | 刷量/Pump&Dump/鲸鱼操纵检测 |

**准入门槛**：总分 ≥ 45 且流动性 ≥ $30K。

**仓位管理**：

| 得分区间 | 开仓比例 | 止盈 (TP) | 止损 (SL) | 初始 Trailing Stop |
|---------|---------|----------|----------|-------------------|
| ≥85 | 可用资金的 15% | 5.0x | -40% | 35% |
| ≥70 | 可用资金的 12% | 3.5x | -35% | 30% |
| ≥55 | 可用资金的 8% | 2.5x | -30% | 25% |
| <55 | 可用资金的 5% | 2.0x | -25% | 20% |

单笔仓位上限为可用资金的 20%，并受**时间窗口仓位系数**影响（活跃时段 ×1.0, 中等时段 ×0.85, 低谷时段 ×0.6）。

**默认策略权重**（首次运行时的初始值，后续由 Optimizer 动态调整）：

| 维度 | 初始权重 |
|------|--------|
| contractSafety | 20 |
| liquidityDepth | 15 |
| volumeRatio | 10 |
| mcLpRatio | 10 |
| holderDistribution | 10 |
| buyPressure | 10 |
| smartMoneySignal | 10 |
| freshness | 5 |
| narrativeBonus | AI:4, Meme:3, Political:2, Celebrity:2, DeFi:2, Gaming:1 |

### 3. 模拟交易引擎 — Trader

**文件**: `backend/src/trader.ts`

执行开仓、价格更新和平仓的核心逻辑。

**开仓控制**：
- 可用资金 < 0.01 SOL 时不开仓
- 同一 token 不重复开仓
- 同一叙事最多同时持有 2 个仓位，避免板块共振回撤
- 最大同时持仓数由**时间窗口**动态决定（活跃时段 5 个, 中等时段 4 个, 低谷时段 2 个）
- 动量确认后会使用**最新链上数据重新评分**，拒绝“确认时已变质”的 token

**平仓触发条件（优先级从高到低）**：
1. **LP 流动性抽逃检测**：LP 小时级 drain rate >5% 或总量下降 >15% → 紧急平仓
2. **阶梯止盈**：根据评分生成多级止盈计划（如 2x 卖 50%、3x 卖 25%、5x 卖 25%），逐级执行
3. **Dynamic Trailing Stop**（已回收本金/执行阶梯止盈后）：基于评分确定初始幅度（20%~35%），再根据近 8 次价格的波动率和持仓时长在 15%~40% 之间动态调整（高波动 +5%、低波动 -5%、久持低 ROI 收窄 -3%~-7%）
4. **Rug 检测**：流动性从入场时下降 ≥50%，或价格暴跌至入场价的 15% 以下
5. **时间衰减止损**：24h 后 ROI < 50% 时 SL 收紧到 ≥0.85x（约 -15%），36h 后进一步收紧到 ≥0.90x（约 -10%）
6. **硬性止损**：价格低于当前有效 SL 倍数（取时间衰减与初始 SL 的较严值）
7. **超时退出**：持仓超过动态 `max_hold_hours`（默认 48h，optimizer 可下调）且 ROI < 10%

**阶梯止盈策略详解**：

替代旧的"翻倍出本"机制，根据评分生成不同数量+幅度的梯级：

| 评分区间 | 止盈阶梯 |
|---------|---------|
| ≥85 | 2x 卖 40% → 4x 卖 25% → 8x 卖 20%（剩余 15% 跟随 trailing stop） |
| ≥70 | 2x 卖 50% → 3x 卖 25% → 5x 卖 25% |
| ≥55 | 2x 卖 50% → 3x 卖 30% → 4x 卖 20% |
| <55 | 1.5x 卖 50% → 2x 卖 30% → 3x 卖 20% |

每执行一阶，回收的 SOL 归还现金池，剩余仓位继续持有，直到 Trailing Stop 或下一阶触发。

**价格轨迹记录**：

- 开仓时写入第一条价格点
- 每次 `updateTradePrice()` 追加 `(trade_id, timestamp, price_usd, price_native, liquidity_usd)`
- 用于后续分析最大回撤、波动率和 trailing stop 参数优化

### 4. 实时监控引擎 — Monitor

**文件**: `backend/src/monitor.ts`

系统的调度中枢，管理三条并行运行的定时任务循环，并统筹所有策略模块的数据流。

| 循环 | 间隔 | 职责 |
|------|-----|------|
| Discovery Loop | 120 秒 | 拉取新 token → 全策略链上分析 → 观察池 → 动量确认 → 建仓 |
| Price Monitor Loop | 20 秒 | 更新持仓价格 → LP 抽逃检测 → 阶梯止盈 → 触发策略优化 |
| Snapshot Loop | 5 分钟 | 记录组合状态快照（用于资产曲线图表） |

**Discovery 数据流**：
```
DexScreener 拉取 → 更新观察池 → 消费动量确认池（优先建仓）
                  → 新 token 全策略评估：
                      创建者分析 → LP 锁定检查 → 聪明钱匹配
                      → 社交信号 → 蜜罐检测 → 成交量异常
                      → 叙事关联 → 时间窗口
                  → 通过评分的 token 进入观察池（等待动量确认）
                  → 动量确认后用最新 pair + 最新链上数据再次评分
                  → 更新叙事跟踪 → 清理过期观察池条目
```

**设计要点**：
- **并发控制**：Discovery 循环内对 token 处理使用 4 路并发池 (`runWithConcurrency`)，平衡速度与限流
- **确认前衰减重评分**：观察池确认后会重新拉取最新价格/流动性/链上状态，做最终入场决策
- **叙事追踪**：每次发现循环后更新叙事状态，Rug 事件自动标记到对应叙事
- **发现日志**：每次 discovery 记录发现数、筛选数、通过率、耗时、错误数
- **优雅关闭**：停止交易时会先等待进行中的 discovery / monitor 循环结束，再完成停机
- **重入保护**：`discoveryInFlight` / `monitorInFlight` 标志防止任务重入
- **实时推送**：所有状态变化（开仓/平仓/发现新币/报警/动量确认/阶梯止盈）立即通过 WebSocket 广播

### 5. 策略自优化器 — Optimizer

**文件**: `backend/src/optimizer.ts`

每累计平仓 5 笔交易后自动复盘，根据表现动态调整筛选权重。

**优化维度**：

- **胜率分析**：
  - 胜率 < 35%：加大流动性 (+3) 和买压 (+2) 权重
  - 胜率 < 50%：小幅提高筛选严格度
  - 胜率 > 65%：维持当前参数

- **Rug 频率分析**：
  - Rug 率 > 15%：加大合约安全 (+3) 和持仓分布 (+2) 权重

- **叙事表现分析**：
  - 叙事胜率 > 60% 且平均 ROI > 20%：增加叙事加分
  - 叙事胜率 < 30%（样本 ≥ 2）：降低叙事加分

- **退出原因反馈**：
  - `closed-rug` 占比高：进一步提高合约安全与持仓分布权重
  - `closed-sl` 占比高：提高买压与成交量质量要求
  - `closed-time` 占比高：自动下调 `max_hold_hours`，并提高 freshness 权重

- **Common Traits 提取**：统计 Winner/Loser 的入场理由和叙事标签频率，生成特征可信度排行

### 6. 持久化层 — Database

**文件**: `backend/src/database.ts`

基于 better-sqlite3 的本地 SQLite 存储，使用 WAL 模式保证并发读取性能。

**设计要点**：
- **事务保护**：所有涉及资金状态变更（开仓/平仓/阶梯止盈）的操作通过 `runInTransaction()` 包裹 `saveTrade()` + `setCash()` + `saveAlert()`，确保崩溃时资金不出现不一致
- **数据过期清理**：每 6 小时自动清理 30 天前的非交易 token、30 天前的 token_snapshots、和 7 天前的 alerts，控制数据库体积
- **Schema 自动迁移**：使用 `ensureColumn()` 函数在启动时检测并自动添加新字段（如 `initial_amount_sol`），避免手动删库升级

**数据表**：
| 表名 | 用途 |
|------|------|
| `tokens` | 已发现 token 的全量数据（含评分/链上验证结果） |
| `token_snapshots` | token 每次扫描的快照（生命周期轨迹） |
| `trades` | 交易记录（开仓/持仓/平仓全生命周期） |
| `trade_price_history` | 持仓期间的逐点价格/流动性历史 |
| `portfolio_snapshots` | 组合净值快照（用于资产曲线） |
| `strategy_logs` | 策略优化日志（每批复盘结果） |
| `discovery_logs` | 每次 discovery 的发现数量、通过率、耗时、错误数 |
| `alerts` | 系统警报记录 |
| `config` | 键值对配置（当前现金余额、策略权重等） |
| `smart_money_wallets` | 聪明钱包地址、来源、备注、自动导入状态 |
| `smart_money_provider_runs` | 各 provider 的抓取 / 刷新历史 |
| `blacklisted_creators` | 创建者黑名单 |

**索引优化**：
| 表 | 索引 |
|---|------|
| tokens | `discovered_at DESC`, `last_updated DESC`, `screening_score DESC`, `symbol NOCASE`, `name NOCASE`, `eligible` |
| trades | `(status, entry_timestamp DESC)` 复合索引 |
| trade_price_history | `(trade_id, timestamp DESC)` |
| token_snapshots | `(token_address, timestamp DESC)` |
| discovery_logs | `timestamp DESC` |

### 7. 通信层 — Server

**文件**: `backend/src/server.ts`

同时提供 HTTP REST API 和 WebSocket 两种通信方式。

- **WebSocket**：客户端连接后立即收到完整的 `init` 消息（含组合状态/交易列表/token 列表/策略日志/快照/警报/权重），后续通过事件驱动推送增量更新
- **REST API**：提供查询、控制、策略状态、价格轨迹、discovery 日志等端点
- **API Key 认证**：设置 `TUGOU_API_KEY` 后，REST API 与 WebSocket 都要求携带密钥
- **Rate Limit**：对 `/api/*` 启用基础限流，对 `/api/tokens/search` 启用更严格的限流

### 8. 前端 Dashboard

**目录**: `frontend/src/`

React SPA，通过 `useSimulation` Hook 管理 WebSocket 连接和状态。系统已重构为**带有 Sidebar 的多视图架构**，以支持更丰富的模块展示。

| 组件/页面 | 功能 |
|------|------|
| App | 顶层入口，统筹全局状态并负责多页面渲染 |
| Sidebar & Header | 侧边栏进行多页面导航；顶栏展示连接状况、开始/停止控制和核心运作状态 |
| DashboardPage | 核心仪表盘，包含概览卡片、资产曲线（LiveMetricsChart）和实时发现代币网格 |
| TokenSearchPage | 提供全局代币搜索与代币分析（TokenDetailModal） |
| WatchpoolPage | 展示动量观察池中的代币列表与趋势确认详情 |
| SmartMoneyPage | 聪明钱包工作台，支持 provider 状态、一键获取、平台搜索、手动导入和运行记录 |
| NarrativesPage | 实时观测叙事热度，并叠加 6551 每日新闻热榜 |
| TradeHistoryPage | 完整的交易记录归档，支持平仓进度和已回收资金的浏览 |
| ConfigPage | 数据库工作台，显示并编辑后端所有 SQLite 表，并提供表规模可视化 |
| AlertsPanel等组件 | 实时从 WebSocket 读取报警和策略日志展示 |

**性能优化**：各个页面级别的内容使用 `React.lazy` + `Suspense` 异步懒加载，配合通用 `PanelSkeleton` 骨架屏组件平滑视觉体验。

---

## 策略思想

本系统的策略核心是 **"10 策略联合筛选 + 观察池动量确认 + 阶梯止盈 + 自适应权重"**：

1. **不追热度，追安全**：合约安全性 + 蜜罐检测 + 成交量异常 作为三重硬性门槛
2. **观察再入场**：发现的 token 先进入观察池，连续 3 次上涨趋势确认后才建仓
3. **看人下菜**：追溯 token 创建者的历史部署记录，多次 Rug 的地址自动拉黑
4. **LP 流动性监控**：检查 LP 是否已锁定/烧毁，实时监控流动性抽逃行为
5. **跟单聪明钱**：监控已知高盈利钱包的持仓，多个聪明钱买入时大幅加分
6. **叙事联动**：实时追踪 8 大叙事板块冷热，自动封杀 Rug 多发叙事
7. **时间窗口**：UTC 14-22 为活跃时段（更大仓位、更多持仓），低谷时段自动缩量
8. **阶梯止盈**：根据评分生成多级止盈计划（如 2x/50% → 3x/25% → 5x/25%），逐级锁定利润
9. **分散风险**：持仓数由时间窗口动态调整（2-5 个），仓位受窗口系数和评分双重约束
10. **自我进化**：每 5 笔平仓后，Optimizer 自动复盘并调整各维度权重

### 十大策略模块

| # | 策略 | 文件 | 核心作用 |
|---|------|------|---------|
| 1 | 动量观察池 | `momentum.ts` | 新 token 先观察趋势，3 次连续上涨+买量增长才入场 |
| 2 | 社交信号前置 | `social.ts` | 分析 DexScreener socials 字段，有无 Twitter/TG/Discord |
| 3 | 创建者行为分析 | `creator.ts` | 追溯部署者地址，统计历史 Rug 次数，自动拉黑 |
| 4 | LP 锁定/流动性监控 | `lp-lock.ts` | 检查 LP 是否锁定/烧毁，实时检测流动性抽逃 |
| 5 | 聪明钱跟单 | `smart-money.ts` | 匹配已知高盈利钱包的持仓行为 |
| 6 | 叙事板块联动 | `narrative.ts` | 8 大叙事实时冷热追踪，Rug 多发叙事自动封杀 |
| 7 | 时间窗口策略 | `time-window.ts` | UTC 时段决定仓位大小和最大持仓数 |
| 8 | 阶梯止盈 | `tiered-exit.ts` | 多级渐进式止盈，替代旧的"翻倍出本" |
| 9 | 蜜罐检测 | `honeypot.ts` | 买卖不对称、零卖出等蜜罐特征识别 |
| 10 | 成交量异常检测 | `volume-anomaly.ts` | 刷量/Pump&Dump/鲸鱼操纵识别 |

### 已知问题与改进建议

以下是代码审查中发现的问题跟踪表：

| # | 状态 | 问题 | 位置 | 建议 |
|---|------|------|------|------|
| 1 | ⚠️ | **聪明钱钱包列表为空** | `smart-money.ts` `SMART_WALLETS = []` | 接入 Birdeye / GMGN 排行榜自动拉取高盈利钱包 |
| 2 | ⚠️ | **Creator 分析过于粗糙** | `creator.ts` | `tokensMinted = floor(sigs / 10)` 不可靠，应解析 `InitializeMint` 指令或接入 RugCheck |
| 3 | ✅ | ~~叙事关键词两处维护~~ | `narrative-patterns.ts` | 已抽出专门文件统一定义叙事版块及匹配规则 |
| 4 | ✅ | ~~ScreeningExtras 类型绕过~~ | `screener.ts` | 已将 `authorities` / `holders` 正式加入 `ScreeningExtras` 接口 |
| 5 | ⚠️ | **LP 锁定检查逻辑假设过强** | `lp-lock.ts` | 直接用 `pairAddress` 作为 token mint 查询，应先解析 pool account |
| 6 | ✅ | ~~RPC 限流器代码重复~~ | `rpc-client.ts` | 已将所有外部依赖模块的 `requestQueue` 抽离为单实例的公共 RPC 客户端 |

---

## 快速启动

### 环境要求

- Node.js 20+
- npm 10+
- 互联网连接（需访问 `api.dexscreener.com` 和 `api.mainnet-beta.solana.com`）

### 一键安装 + 启动

```bash
cd /path/to/tugoucatcher

# 首次初始化环境变量
cp .env.example .env

# 安装所有依赖
npm install
npm run install:all

# 一键启动后端 + 前端
npm run dev
```

启动后：
- 后端 HTTP API：`http://localhost:3001/api`
- 后端 WebSocket：`ws://localhost:3001`
- 前端 Dashboard：终端中显示的 URL（通常为 `http://localhost:5173`）

打开前端 Dashboard 后，点击页面上的 **「开始交易」** 按钮，系统即开始自动发现 token 并执行模拟交易。

> 启动前建议先检查项目根目录 [`.env`](/Users/dongmac/Desktop/tugoucatcher/.env)，尤其是 `SOLANA_RPC_URL`、`BIRDEYE_API_KEY`、`X_BEARER_TOKEN`。

---

## 环境变量与 API Key

项目统一从根目录的 [`.env`](/Users/dongmac/Desktop/tugoucatcher/.env) 读取配置。后端通过 `backend/src/load-env.ts` 启动时自动加载；前端开发地址也可通过同一个文件配置。

### 环境变量总表

| 变量名 | 是否必填 | 用途 | 获取方法 |
|------|------|------|------|
| `PORT` | 否 | 后端 HTTP / WebSocket 端口 | 本地自定义即可 |
| `TUGOU_API_KEY` | 否 | REST API / WebSocket 访问鉴权 | 自行生成随机字符串 |
| `SOLANA_RPC_URL` | 强烈建议 | Solana 链上读取，决定稳定性和限速表现 | Helius / QuickNode / Alchemy / Shyft |
| `DEXSCREENER_API_BASE` | 否 | DexScreener 数据源地址 | 默认官方地址，无需改 |
| `RUGCHECK_API_BASE` | 否 | RugCheck 风险检测接口 | 默认官方地址，无需改 |
| `BIRDEYE_API_KEY` | 推荐 | Birdeye 聪明钱包前20抓取、每日自动刷新 | [Birdeye Developer](https://bds.birdeye.so/) 创建 API Key |
| `BLOCKBEATS_API_KEY` | 推荐 | BlockBeats 市场总览、分类快讯、关键词搜索 | [BlockBeats](https://www.theblockbeats.info/) 开通 Pro API 后获取 |
| `X_BEARER_TOKEN` | 推荐 | X smart-wallet 自动抓取 | [X Developer Portal](https://developer.x.com/) 创建 App 后获取 Bearer Token |
| `VITE_API_URL` | 否 | 前端调用后端 API 地址 | 本地开发通常保持默认 |
| `VITE_WS_URL` | 否 | 前端 WebSocket 地址 | 本地开发通常保持默认 |

### `SOLANA_RPC_URL`

推荐使用私有 RPC，不建议长期使用公共 `https://api.mainnet-beta.solana.com`。

可选服务：
- [Helius](https://www.helius.dev/)
- [QuickNode](https://www.quicknode.com/)
- [Alchemy](https://www.alchemy.com/)
- [Shyft](https://shyft.to/)

拿到 URL 后，直接替换 `.env` 中的 `SOLANA_RPC_URL=...`。

### `BIRDEYE_API_KEY`

用途：
- 聪明钱包页面中的 Birdeye `一键获取前20`
- Birdeye provider 的每日自动刷新
- provider 抓取运行日志

获取步骤：
1. 打开 [Birdeye Developer](https://bds.birdeye.so/)
2. 注册或登录
3. 创建一个 API Key
4. 将得到的 key 写入 `.env` 的 `BIRDEYE_API_KEY`

不配置时：
- Birdeye provider 在前端会显示为未启用
- 仍然可以使用搜索入口和手工导入

### `BLOCKBEATS_API_KEY`

用途：
- 热叙事页右侧的 BlockBeats 市场总览
- 分类快讯 / 文章流
- 关键词搜索

获取步骤：
1. 打开 [BlockBeats](https://www.theblockbeats.info/)
2. 开通 Pro API
3. 获取 API Key
4. 写入 `.env` 的 `BLOCKBEATS_API_KEY`

不配置时：
- BlockBeats 面板会显示未启用
- 链上叙事部分不受影响

### `X_BEARER_TOKEN`

用途：
- 聪明钱包页面中的 X provider 自动抓取公开 smart-wallet feed
- X provider 的每日自动刷新

获取步骤：
1. 打开 [X Developer Portal](https://developer.x.com/)
2. 注册开发者账号
3. 创建 Project / App
4. 在 App 的 `Keys and Tokens` 页面找到 `Bearer Token`
5. 写入 `.env` 的 `X_BEARER_TOKEN`

权限建议：
- 至少具备 Posts / Recent Search 的读取权限

不配置时：
- X provider 仅保留 search-only 能力

### 当前不需要单独 API Key 的平台

| 平台 | 当前状态 |
|------|------|
| GMGN | 前端已支持搜索入口；后端尚未接入稳定的官方 API Key 模式 |
| BullX | 当前为 search-only，未接入稳定官方 API |
| Photon | 当前为 search-only，未接入稳定官方 API |
| Telegram / Discord | 当前走人工筛选 + 手工导入，不涉及统一 API Key |

---

## 手动分别启动

如果需要分别控制后端和前端：

```bash
# Terminal 1 — 启动后端
cd /path/to/tugoucatcher
npm run dev:backend

# Terminal 2 — 启动前端
cd /path/to/tugoucatcher
npm run dev:frontend
```

或进入各自目录运行 `npm run dev`。

### 前端环境变量

前端默认根据当前浏览器域名自动推导后端地址。如需自定义，在 `frontend/` 下创建 `.env` 文件：

```env
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001
```

### 后端可选环境变量

如需启用 API 访问控制，可在后端运行环境中设置：

```env
TUGOU_API_KEY=your-secret-key
```

---

## 验证服务状态

```bash
# 健康检查
curl http://localhost:3001/api/health

# 查看组合状态
curl http://localhost:3001/api/portfolio

# 命令行启动交易
curl -X POST http://localhost:3001/api/start

# 命令行停止交易
curl -X POST http://localhost:3001/api/stop
```

---

## API 速查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/status` | 系统运行状态（含策略指标） |
| GET | `/api/portfolio` | 组合净值概览 |
| GET | `/api/trades` | 所有交易记录 |
| GET | `/api/trades/open` | 当前持仓 |
| GET | `/api/trades/closed` | 已平仓交易 |
| GET | `/api/trades/:id/history` | 单笔交易的价格轨迹 |
| POST | `/api/trades/:id/close` | 手动平仓指定交易 |
| GET | `/api/tokens` | 最近发现的代币 |
| GET | `/api/tokens/search?q=xxx` | 搜索代币（symbol/name/address） |
| GET | `/api/tokens/eligible` | 通过筛选的代币 |
| GET | `/api/snapshots` | 组合净值快照序列 |
| GET | `/api/strategy/logs` | 策略优化日志 |
| GET | `/api/discovery-logs` | discovery 效率与健康度日志 |
| GET | `/api/strategy/weights` | 当前策略权重 |
| GET | `/api/strategies/overview` | 10 大策略综合状态 |
| GET | `/api/strategies/watchpool` | 动量观察池详情 |
| GET | `/api/strategies/narratives` | 叙事板块冷热状态 |
| GET | `/api/blockbeats/overview` | BlockBeats 市场总览 |
| GET | `/api/blockbeats/feed` | BlockBeats 分类快讯 / 文章流 |
| GET | `/api/blockbeats/search` | BlockBeats 关键词搜索 |
| GET | `/api/blockbeats/netflow` | BlockBeats Solana / Base / Ethereum 资金净流入榜 |
| GET | `/api/blockbeats/derivatives` | BlockBeats 合约持仓 / 成交量快照 |
| GET | `/api/opennews/daily/categories` | 获取每日新闻分类与子分类 |
| GET | `/api/opennews/daily/hot` | 获取指定分类的每日新闻热榜 |
| GET | `/api/strategies/smart-money` | 聪明钱钱包列表 |
| GET | `/api/smart-money/providers` | 聪明钱包 provider 状态 + 最近运行记录 |
| POST | `/api/smart-money/providers/refresh-all` | 刷新全部自动 provider |
| POST | `/api/smart-money/providers/:source/refresh` | 刷新单个 provider |
| GET | `/api/db/tables` | 列出所有 SQLite 表及行数 |
| GET | `/api/db/table/:name` | 读取指定表数据 |
| POST | `/api/db/table/:name/row` | 保存 / 更新指定表的一行 |
| DELETE | `/api/db/table/:name/row` | 删除指定表的一行 |
| GET | `/api/strategies/time-window` | 当前时间窗口及参数 |
| GET | `/api/alerts` | 系统警报 |
| POST | `/api/start` | 开始交易 |
| POST | `/api/stop` | 停止交易 |

---

## 生产构建

```bash
# 一键构建
cd /path/to/tugoucatcher
npm run build

# 单独构建后端
cd backend && npm run build

# 运行编译后的后端
cd backend && npm run start:prod

# 单独构建前端
cd frontend && npm run build

# 预览前端构建产物
cd frontend && npm run preview
```

---

## 优化方向

以下是可进一步改进的方向，按优先级排列：

### 高价值优化

| 方向 | 说明 |
|------|------|
| **引入 DexScreener WebSocket** | 当前靠 20 秒轮询获取价格，切换为 WebSocket 可实现毫秒级价格更新，显著提高止盈止损的精度 |
| **多 RPC 容灾** | Solana 公共 RPC 不稳定，可配置多个备用 RPC（如 Helius、QuickNode），自动切换 |
| **策略回测框架** | 利用 `trade_price_history` 和 `token_snapshots` 的历史数据进行离线回测，验证参数调整效果 |
| **补全更多 Provider** | 当前已支持 Birdeye / X 自动抓取，GMGN / BullX / Photon 仍待补稳定 provider |
| **叙事关键词学习** | 根据交易表现自动学习高/低胜率叙事关键词，继续深化 narrative-patterns.ts |
| **Anti-FOMO 入场检测** | 检查 5m 涨幅是否集中在最近 1-2 分钟（通过 5m/1h 涨幅比例），拒绝"尾部行情" |

### 系统工程优化

| 方向 | 说明 |
|------|------|
| **事件总线解耦** | 当前各模块通过 `broadcastFn` 直接推送，应引入 EventEmitter 解耦业务逻辑和通信层 |
| **策略插件化** | 定义 `StrategyPlugin` 接口，screener 动态加载所有插件，新增/禁用策略无需改代码 |
| **进程守护** | 使用 PM2 管理后端进程，实现崩溃自动重启和日志管理 |
| **结构化日志** | 当前使用 `console.log`，可切换为 pino/winston，支持分级过滤和日志文件轮转 |
| **指标埋点** | 接入 Prometheus + Grafana，监控系统级指标（请求延迟/错误率/持仓统计等） |
| **Docker 部署** | 提供 Dockerfile + docker-compose，实现一键部署 |

### 前端优化

| 方向 | 说明 |
|------|------|
| **虚拟列表** | 当代币和交易记录超过数百条时，TokenDiscovery 和 TradeHistory 应使用虚拟滚动 |
| **价格轨迹图** | 利用 `/api/trades/:id/history` 在 TradeHistoryTable 中展示每笔交易的价格走势小图 |
| **离线缓存** | WebSocket 断开期间缓存最后状态至 localStorage/IndexedDB |
| **移动端适配** | 当前 Dashboard 以桌面端为主，可增加响应式断点适配手机查看 |
| **深色/浅色主题切换** | 当前固定深色主题，可提供切换选项 |

---

## 数据重置

SQLite 数据库文件位于：

```
backend/data/tugoucatcher.db
```

如需重置所有模拟交易历史，停止后端服务后删除该文件，下次启动会自动创建新数据库。

---

## 常见问题排查

### `npm error enoent Could not read package.json`

原因：未在项目根目录执行，或未运行 `npm install`。

```bash
cd /path/to/tugoucatcher
npm install
npm run install:all
```

### 前端提示"未连接到后端服务"

确认后端已在 3001 端口启动：

```bash
curl http://localhost:3001/api/health
```

### 前端端口不是 5173

正常现象 — 端口被占用时 Vite 会自动选用下一个可用端口，以终端输出的 URL 为准。

### 长时间没有发现新代币

可能原因：
- DexScreener API 临时限流
- Solana 公共 RPC 请求失败
- 本地网络限制（需能访问 `api.dexscreener.com` 和 `api.mainnet-beta.solana.com`）

查看后端终端日志定位具体错误。

### 聪明钱包自动抓取没有生效

优先检查根目录 [`.env`](/Users/dongmac/Desktop/tugoucatcher/.env)：
- `BIRDEYE_API_KEY` 是否已配置
- `X_BEARER_TOKEN` 是否已配置

未配置时：
- Birdeye / X provider 会显示为未启用
- 前端仍可搜索和手工导入，但不会自动刷新

---

## 项目结构

```
tugoucatcher/
├── backend/
│   ├── src/
│   │   ├── index.ts          # 入口
│   │   ├── server.ts         # Express + WebSocket 服务
│   │   ├── rpc-client.ts     # 公共全局 RPC 客户端 (含并发和限流控制)
│   │   ├── load-env.ts       # 环境配置文件
│   │   ├── monitor.ts        # 调度中枢（发现/监控/快照）
│   │   ├── fetcher.ts        # DexScreener + Solana RPC 数据采集
│   │   ├── screener.ts       # 16 维多因子评分引擎
│   │   ├── trader.ts         # 模拟交易执行（阶梯止盈）
│   │   ├── optimizer.ts      # 策略自优化器
│   │   ├── database.ts       # SQLite 持久化
│   │   ├── types.ts          # 共享类型定义
│   │   ├── narrative-patterns.ts # 叙事版块和关键字统一定义配置
│   │   ├── momentum.ts       # 策略 1: 动量观察池
│   │   ├── social.ts         # 策略 2: 社交信号前置
│   │   ├── creator.ts        # 策略 3: 创建者行为分析
│   │   ├── lp-lock.ts        # 策略 4: LP 锁定/流动性监控
│   │   ├── smart-money.ts    # 策略 5: 聪明钱跟单
│   │   ├── narrative.ts      # 策略 6: 叙事板块联动
│   │   ├── time-window.ts    # 策略 7: 时间窗口策略
│   │   ├── tiered-exit.ts    # 策略 8: 阶梯止盈
│   │   ├── honeypot.ts       # 策略 9: 蜜罐检测
│   │   └── volume-anomaly.ts # 策略 10: 成交量异常检测
│   ├── data/                 # SQLite 数据库文件（运行时生成）
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # 主应用组件（多页路由映射）
│   │   ├── main.tsx          # 入口
│   │   ├── config.ts         # API/WS 地址配置
│   │   ├── hooks/
│   │   │   └── useSimulation.ts  # WebSocket 状态管理 Hook
│   │   ├── components/
│   │   │   ├── Sidebar.tsx            # 左侧导航栏组件
│   │   │   ├── Header.tsx             # 顶栏（含操作和警示点）
│   │   │   ├── DashboardPage.tsx      # 主面板页（聚合 LiveMetrics、核心数据）
│   │   │   ├── TokenSearchPage.tsx    # 代币搜索和分析页
│   │   │   ├── WatchpoolPage.tsx      # 观察池单页面
│   │   │   ├── SmartMoneyPage.tsx     # 聪明钱单页面
│   │   │   ├── NarrativesPage.tsx     # 叙事分析页
│   │   │   ├── TradeHistoryPage.tsx   # 交易历史页
│   │   │   ├── ConfigPage.tsx         # 系统配置预留界面
│   │   │   ├── TokenDetailModal.tsx   # 代币详情模态框
│   │   │   └── PanelSkeleton.tsx      # 通用骨架屏
│   │   ├── types/            # 前端类型定义
│   │   └── utils.ts          # 工具函数
│   ├── .env.example
│   ├── package.json
│   └── vite.config.ts
├── package.json              # 根控制包（concurrently 统一启动）
└── README.md                 # 本文件
```

---

## 许可与免责

本项目仅用于模拟交易和链上数据研究，不执行任何真实的链上交易操作。使用本系统产生的模拟交易结果不构成投资建议。
