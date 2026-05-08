// ===== 通用工具函数 =====

export function formatSOL(value: number, decimals = 4): string {
  return value.toFixed(decimals);
}

export function formatUSD(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatPct(value: number, decimals = 1): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });
}

export function shortenAddress(addr: string, chars = 4): string {
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatChain(_chainId: string | undefined): string {
  return 'SOL';
}

export function formatStrategy(strategy: string | undefined): string {
  switch (strategy) {
    case 'liquidity_surge': return 'LP 跃迁';
    case 'volume_absorption': return '放量不涨';
    case 'dip_reclaim': return '假摔反包';
    case 'high_turnover_low_mc': return '低市值高换手';
    case 'smart_money_follow': return '聪明钱先手';
    case 'narrative_rotation': return '叙事轮动';
    case 'social_pre_fomo': return '社交未爆量';
    case 'momentum_breakout': return '动量突破';
    case 'score_momentum': return '综合高分';
    default: return '未分桶';
  }
}

export function formatRugRiskLevel(level: string | undefined): string {
  switch (level) {
    case 'critical': return '极高';
    case 'high': return '高';
    case 'medium': return '中';
    case 'low': return '低';
    default: return '未知';
  }
}

export function rugRiskTone(level: string | undefined): string {
  switch (level) {
    case 'critical': return 'text-danger bg-danger/15 border-danger/30';
    case 'high': return 'text-danger bg-danger/10 border-danger/25';
    case 'medium': return 'text-warning bg-warning/10 border-warning/25';
    case 'low': return 'text-success bg-success/10 border-success/20';
    default: return 'text-text-muted bg-text-muted/10 border-border';
  }
}

export function formatScreeningReason(reason: string): string {
  let formatted = reason
    .replace(/⏸️ Holder check inconclusive: Holder RPC returned 429/g, '⏸️ 持仓分布暂时未取到，RPC 请求过多被限流（429）')
    .replace(/⏸️ Holder check inconclusive: Supply RPC returned 429/g, '⏸️ 持仓分布暂时未取到，代币总供应量查询被限流（429）')
    .replace(/⏸️ Authority check inconclusive: Authority RPC returned 429/g, '⏸️ 合约权限状态暂时未取到，RPC 请求过多被限流（429）')
    .replace(/⏸️ Holder check inconclusive: Holder RPC returned 503/g, '⏸️ 持仓分布暂时未取到，RPC 服务暂时不可用（503）')
    .replace(/⏸️ Holder check inconclusive: Supply RPC returned 503/g, '⏸️ 持仓分布暂时未取到，供应量服务暂时不可用（503）')
    .replace(/⏸️ Authority check inconclusive: Authority RPC returned 503/g, '⏸️ 合约权限状态暂时未取到，RPC 服务暂时不可用（503）')
    .replace(/⏸️ Holder check inconclusive: Holder RPC request failed/g, '⏸️ 持仓分布暂时未取到，RPC 请求失败')
    .replace(/⏸️ Holder check inconclusive: Supply RPC request failed/g, '⏸️ 持仓分布暂时未取到，供应量查询失败')
    .replace(/⏸️ Authority check inconclusive: Authority RPC request failed/g, '⏸️ 合约权限状态暂时未取到，RPC 请求失败')
    .replace(/⏸️ Holder data unavailable/g, '⏸️ 持仓分布数据暂不可用')
    .replace(/⏸️ Authority status unavailable/g, '⏸️ 合约权限状态暂不可用');

  const replacements: Array<[RegExp, string]> = [
    [/✅ Mint & Freeze authority revoked/g, '✅ Mint 与 Freeze 权限均已撤销'],
    [/❌ Mint Authority NOT revoked - HARD FAIL/g, '❌ Mint 权限未撤销，硬性淘汰'],
    [/⚠️ Freeze Authority NOT revoked/g, '⚠️ Freeze 权限未撤销'],
    [/✅ Liquidity (\$[\d.]+[KM]?) \(excellent\)/g, '✅ 流动性 $1（优秀）'],
    [/⚠️ Liquidity (\$[\d.]+[KM]?) \(acceptable\)/g, '⚠️ 流动性 $1（可接受）'],
    [/❌ Liquidity (\$[\d.]+[KM]?) < \$50K/g, '❌ 流动性 $1，低于 $50K 门槛'],
    [/✅ Vol\/MC ratio ([\d.]+%) \(healthy activity\)/g, '✅ 成交量/市值比 $1（活跃度健康）'],
    [/⚠️ Vol\/MC ratio ([\d.]+%) \(very high volume, potential hype\)/g, '⚠️ 成交量/市值比 $1（成交过热，可能炒作）'],
    [/⚠️ Vol\/MC ratio ([\d.]+%) \(moderate\)/g, '⚠️ 成交量/市值比 $1（中等）'],
    [/❌ Vol\/MC ratio ([\d.]+%) \(too low\)/g, '❌ 成交量/市值比 $1（过低）'],
    [/✅ MC\/LP ([\d.]+x) \(thick order book\)/g, '✅ 市值/流动性比 $1（深度较厚）'],
    [/⚠️ MC\/LP ([\d.]+x) \(moderate\)/g, '⚠️ 市值/流动性比 $1（中等）'],
    [/❌ MC\/LP ([\d.]+x) \(thin order book, dump risk\)/g, '❌ 市值/流动性比 $1（深度偏薄，易砸盘）'],
    [/✅ Top 10 hold ([\d.]+%) \(well distributed\)/g, '✅ 前10持仓 $1（分布健康）'],
    [/⚠️ Top 10 hold ([\d.]+%) \(moderate concentration\)/g, '⚠️ 前10持仓 $1（集中度中等）'],
    [/❌ Top 10 hold ([\d.]+%) \(high concentration\)/g, '❌ 前10持仓 $1（集中度过高）'],
    [/✅ Buy pressure ([\d.]+x) \(strong buying\)/g, '✅ 买盘压力 $1（买盘强）'],
    [/⚠️ Buy pressure ([\d.]+x) \(mild buying\)/g, '⚠️ 买盘压力 $1（买盘偏强）'],
    [/⚠️ Sell pressure ([\d.]+x)/g, '⚠️ 卖压 $1'],
    [/❌ Heavy sell pressure ([\d.]+x)/g, '❌ 重度卖压 $1'],
    [/✅ Positive momentum: 5m ([\d.+-]+%), 1h ([\d.+-]+%)/g, '✅ 正向动量：5分钟 $1，1小时 $2'],
    [/⚠️ Neutral momentum: 1h ([\d.+-]+%)/g, '⚠️ 中性动量：1小时 $1'],
    [/⚠️ Overheated: 1h \+?([\d.]+%) \(FOMO risk\)/g, '⚠️ 1小时涨幅 $1，过热且有追高风险'],
    [/❌ Negative momentum: 1h ([\d.+-]+%)/g, '❌ 负向动量：1小时 $1'],
    [/❌ Anti-FOMO: 5m ([\d.+-]+%) move is too concentrated vs 1h ([\d.+-]+%)/g, '❌ 防追高拦截：5分钟涨幅 $1 相对 1小时 $2 过于集中'],
    [/✅ Fresh: ([\d.]+h) old \(early opportunity\)/g, '✅ 新币龄 $1（早期窗口）'],
    [/ℹ️ Age: ([\d.]+) days/g, 'ℹ️ 币龄：$1 天'],
    [/✅ Narrative: \[(.+)\] \+(\d+)/g, '✅ 叙事加分：[$1] +$2'],
    [/✅ Strong social presence \(\+8\)/g, '✅ 社交存在感强（+8）'],
    [/⚠️ Moderate social presence \(\+3\)/g, '⚠️ 社交存在感中等（+3）'],
    [/ℹ️ Minimal social presence/g, 'ℹ️ 社交存在感较弱'],
    [/❌ No social presence \(-5\)/g, '❌ 缺少社交存在感（-5）'],
    [/ℹ️ Creator unknown/g, 'ℹ️ 创建者未知'],
    [/ℹ️ Creator history insufficient/g, 'ℹ️ 创建者历史样本不足'],
    [/🚨 Creator BLACKLISTED — known rug deployer \(-50\)/g, '🚨 创建者已进黑名单，属于已知 Rug 部署者（-50）'],
    [/❌ Creator has (\d+)\/(\d+) rugged tokens \(-20\)/g, '❌ 创建者历史上有 $1/$2 个项目 Rug（-20）'],
    [/⚠️ Creator has some rugged tokens \(-8\)/g, '⚠️ 创建者历史上存在 Rug 记录（-8）'],
    [/✅ Creator has (\d+) surviving tokens \(\+8\)/g, '✅ 创建者有 $1 个存活项目（+8）'],
    [/ℹ️ Creator profile neutral/g, 'ℹ️ 创建者画像中性'],
    [/❌ Creator rug probability ([\d.]+)% \(very high risk, n=(\d+), confidence ([\d.]+)%\) \((-?\d+)\)/g, '❌ 创建者 Rug 概率 $1%（极高风险，样本 $2，置信度 $3%）（$4）'],
    [/⚠️ Creator rug probability ([\d.]+)% \(high risk, n=(\d+), confidence ([\d.]+)%\) \((-?\d+)\)/g, '⚠️ 创建者 Rug 概率 $1%（高风险，样本 $2，置信度 $3%）（$4）'],
    [/⚠️ Creator rug probability ([\d.]+)% \(medium risk, n=(\d+), confidence ([\d.]+)%\) \((-?\d+)\)/g, '⚠️ 创建者 Rug 概率 $1%（中风险，样本 $2，置信度 $3%）（$4）'],
    [/✅ Creator rug probability ([\d.]+)% \(low risk, n=(\d+), confidence ([\d.]+)%\) \(\+(\d+)\)/g, '✅ 创建者 Rug 概率 $1%（低风险，样本 $2，置信度 $3%）（+$4）'],
    [/✅ Creator rug probability ([\d.]+)% \(very low risk, n=(\d+), confidence ([\d.]+)%\) \(\+(\d+)\)/g, '✅ 创建者 Rug 概率 $1%（极低风险，样本 $2，置信度 $3%）（+$4）'],
    [/ℹ️ LP lock status unknown/g, 'ℹ️ LP 锁仓状态未知'],
    [/✅ LP burned \(permanent lock\) \(\+12\)/g, '✅ LP 已销毁（永久锁仓）（+12）'],
    [/✅ LP locked via (.+) \(\+8\)/g, '✅ LP 已通过 $1 锁仓（+8）'],
    [/❌ Creator holds ([\d.]+)% of LP — rug risk \(-10\)/g, '❌ 创建者持有 $1% LP，存在 Rug 风险（-10）'],
    [/⚠️ Creator holds ([\d.]+)% of LP \(-5\)/g, '⚠️ 创建者持有 $1% LP（-5）'],
    [/⚠️ LP not locked \(-3\)/g, '⚠️ LP 未锁仓（-3）'],
    [/🐋 (\d+) smart money\/KOL wallets buying \(\+15\)/g, '🐋 $1 个聪明钱/KOL 钱包正在买入（+15）'],
    [/🐋 2 smart money\/KOL wallets buying \(\+10\)/g, '🐋 2 个聪明钱/KOL 钱包正在买入（+10）'],
    [/🐋 1 smart money\/KOL wallet buying \(\+5\)/g, '🐋 1 个聪明钱/KOL 钱包正在买入（+5）'],
    [/ℹ️ No smart money\/KOL detected/g, 'ℹ️ 未检测到聪明钱/KOL 参与'],
    [/🐋 (\d+) smart money wallets buying \(\+15\)/g, '🐋 $1 个聪明钱钱包正在买入（+15）'],
    [/🐋 2 smart money wallets buying \(\+10\)/g, '🐋 2 个聪明钱钱包正在买入（+10）'],
    [/🐋 1 smart money wallet buying \(\+5\)/g, '🐋 1 个聪明钱钱包正在买入（+5）'],
    [/ℹ️ No smart money detected/g, 'ℹ️ 未检测到聪明钱参与'],
    [/🔴 Narrative "(.+)" BLOCKED: (.+)/g, '🔴 叙事“$1”已封禁：$2'],
    [/🔥 Narrative "(.+)" is hot: (\d+) tokens rising \(\+(\d+)\)/g, '🔥 叙事“$1”正在走热：$2 个代币上涨（+$3）'],
    [/✅ Peak trading hours \(UTC 14-22\) \(\+5\)/g, '✅ 高活跃交易时段（UTC 14-22）（+5）'],
    [/ℹ️ Medium activity hours \(UTC 06-14\)/g, 'ℹ️ 中等活跃时段（UTC 06-14）'],
    [/⚠️ Off-peak hours \(UTC 22-06\) — higher rug risk \(-8\)/g, '⚠️ 低活跃时段（UTC 22-06），Rug 风险更高（-8）'],
    [/🔄 Wash trading detected \(-12\)/g, '🔄 检测到刷量交易（-12）'],
    [/📈📉 Pump & dump pattern detected \(-15\)/g, '📈📉 检测到拉高出货模式（-15）'],
    [/⚠️ Volume anomaly detected \(-8\)/g, '⚠️ 检测到成交量异常（-8）'],
    [/🍯 HONEYPOT DETECTED \((\d+)% confidence\) — HARD FAIL/g, '🍯 检测到蜜罐风险（置信度 $1%），硬性淘汰'],
    [/⚠️ Partial honeypot signals \((\d+)% confidence\) \(-10\)/g, '⚠️ 存在部分蜜罐信号（置信度 $1%）（-10）'],
    [/✅ Momentum confirmed: 3\+ consecutive up-ticks/g, '✅ 动量已确认：连续 3 次上涨'],
    [/✅ Final entry re-screen passed on latest market data/g, '✅ 最新市场数据复筛通过，允许最终入场'],
  ];

  for (const [pattern, replacement] of replacements) {
    formatted = formatted.replace(pattern, replacement);
  }

  return formatted;
}
