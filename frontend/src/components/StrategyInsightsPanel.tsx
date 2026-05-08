import { Brain, Lightbulb, ScanSearch, TrendingDown, TrendingUp, Weight } from 'lucide-react';
import type { StrategyLog, StrategyWeights } from '../types';
import { cn, formatPct, formatTimestamp } from '../utils';

interface Props {
  strategyLogs: StrategyLog[];
  currentWeights: StrategyWeights;
}

type WeightItem = {
  label: string;
  value: number;
  tone: 'primary' | 'accent' | 'success';
};

const TONE_CLASS: Record<WeightItem['tone'], string> = {
  primary: 'from-primary via-primary to-accent',
  accent: 'from-accent via-accent to-primary',
  success: 'from-success via-success to-accent',
};

export default function StrategyInsightsPanel({ strategyLogs, currentWeights }: Props) {
  const coreWeights: WeightItem[] = [
    { label: '合约安全', value: currentWeights.contractSafety, tone: 'success' },
    { label: '流动性深度', value: currentWeights.liquidityDepth, tone: 'primary' },
    { label: '成交量比', value: currentWeights.volumeRatio, tone: 'primary' },
    { label: 'MC / LP', value: currentWeights.mcLpRatio, tone: 'primary' },
    { label: '持仓分布', value: currentWeights.holderDistribution, tone: 'accent' },
    { label: '买盘压力', value: currentWeights.buyPressure, tone: 'accent' },
    { label: '聪明钱信号', value: currentWeights.smartMoneySignal, tone: 'accent' },
    { label: '新鲜度', value: currentWeights.freshness, tone: 'success' },
  ];

  const narrativeWeights = Object.entries(currentWeights.narrativeBonus)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

  const latestLogs = [...strategyLogs].reverse().slice(0, 6);
  const latestTraits = latestLogs[0]?.commonTraits.slice(0, 6) ?? [];
  const totalCoreWeight = coreWeights.reduce((sum, item) => sum + item.value, 0);
  const strongestCore = [...coreWeights].sort((a, b) => b.value - a.value)[0];
  const strongestNarrative = narrativeWeights[0];

  return (
    <section className="bg-bg-card terminal-panel rounded-2xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border/70 flex items-center justify-between gap-3">
        <div>
          <h3 className="panel-title text-sm font-semibold text-text-primary flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            全量策略权重与优化记录
          </h3>
          <p className="mt-1 text-[11px] text-text-muted">右侧工作区显示完整筛选权重、叙事加分、最近调参与命中共性，不再只显示部分权重。</p>
        </div>
        <span className="rounded-full bg-bg-primary px-2 py-1 text-[10px] text-text-muted">
          {strategyLogs.length} 次优化
        </span>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryTile label="核心权重总和" value={String(totalCoreWeight)} hint="当前基础筛选倾向强度" icon={Weight} />
          <SummaryTile
            label="最高核心因子"
            value={strongestCore ? `${strongestCore.label} ${strongestCore.value}` : '—'}
            hint="当前最重视的基础因子"
            icon={TrendingUp}
          />
          <SummaryTile
            label="最高叙事加分"
            value={strongestNarrative ? `${strongestNarrative.label} +${strongestNarrative.value}` : '—'}
            hint="当前最偏好的叙事主题"
            icon={Lightbulb}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.95fr]">
          <div className="rounded-2xl border border-border/70 bg-bg-primary/40 p-4">
            <div className="flex items-center gap-2">
              <Weight className="w-4 h-4 text-primary" />
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted">核心策略权重</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {coreWeights.map(item => (
                <WeightCard key={item.label} item={item} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-bg-primary/40 p-4">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-accent" />
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted">叙事加分矩阵</p>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {narrativeWeights.map(item => (
                <div key={item.label} className="rounded-xl border border-accent/15 bg-accent/8 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-text-primary">{item.label}</span>
                    <span className="rounded-full bg-accent/14 px-2 py-0.5 text-[10px] text-accent">+{item.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-2xl border border-border/70 bg-bg-primary/45 p-4">
            <div className="flex items-center gap-2">
              <ScanSearch className="w-4 h-4 text-primary" />
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted">最近优化记录</p>
            </div>

            {latestLogs.length === 0 ? (
              <div className="py-12 text-center">
                <Lightbulb className="w-6 h-6 text-text-muted/60 mx-auto mb-2" />
                <p className="text-sm text-text-muted">当前还没有优化记录</p>
                <p className="text-xs text-text-muted mt-1">系统达到批量交易阈值后会生成自优化日志。</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {latestLogs.map(log => (
                  <div key={log.id} className="rounded-xl border border-border/60 bg-bg-card px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-text-primary">第 {log.batchNumber} 批优化</p>
                        <p className="text-[11px] text-text-muted">{formatTimestamp(log.timestamp)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-text-secondary">胜率 {formatPct(log.winRate, 0)}</p>
                        <p className={cn('text-xs', log.avgROI >= 0 ? 'text-success' : 'text-danger')}>
                          平均 ROI {formatPct(log.avgROI)}
                        </p>
                      </div>
                    </div>

                    {log.changes.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {log.changes.slice(0, 4).map((change, index) => (
                          <div key={`${log.id}-${index}`} className="flex items-start gap-2 text-[11px] text-text-secondary">
                            {change.includes('+') || change.includes('提升') ? (
                              <TrendingUp className="w-3 h-3 mt-0.5 text-success shrink-0" />
                            ) : (
                              <TrendingDown className="w-3 h-3 mt-0.5 text-warning shrink-0" />
                            )}
                            <span>{change}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border/70 bg-bg-primary/45 p-4">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-accent" />
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted">最近命中共性</p>
            </div>

            {latestTraits.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-text-muted">最近没有提炼出稳定共性</p>
                <p className="mt-1 text-xs text-text-muted">后续优化批次会在这里显示高频 trait、平均 ROI 和置信度。</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {latestTraits.map((trait, index) => (
                  <div key={`${trait.trait}-${index}`} className="rounded-xl border border-border/60 bg-bg-card px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-text-primary">{trait.trait}</p>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px]',
                        trait.avgROI >= 0 ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger'
                      )}>
                        {formatPct(trait.avgROI, 0)}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <TraitMetric label="出现频次" value={`${(trait.frequency * 100).toFixed(0)}%`} />
                      <TraitMetric label="置信度" value={`${(trait.confidence * 100).toFixed(0)}%`} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Brain;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-bg-primary/60 px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <span className="text-[11px] uppercase tracking-[0.16em] text-text-muted">{label}</span>
      </div>
      <p className="panel-title mt-2 text-lg font-semibold text-text-primary">{value}</p>
      <p className="mt-1 text-[11px] text-text-muted">{hint}</p>
    </div>
  );
}

function WeightCard({ item }: { item: WeightItem }) {
  return (
    <div className="rounded-xl border border-border/60 bg-bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-text-primary">{item.label}</span>
        <span className="text-sm font-semibold text-text-primary">{item.value}</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-bg-primary overflow-hidden">
        <div
          className={cn('h-full rounded-full bg-gradient-to-r', TONE_CLASS[item.tone])}
          style={{ width: `${Math.min(item.value * 5, 100)}%` }}
        />
      </div>
    </div>
  );
}

function TraitMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-bg-primary/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}
