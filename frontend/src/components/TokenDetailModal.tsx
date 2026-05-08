// ===== Token Detail Modal =====
// Three-column research view: market, strategy, risk/evidence.
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  AtSign,
  Brain,
  CheckCircle,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Lock,
  MessageCircle,
  Shield,
  ShieldAlert,
  TrendingUp,
  X,
  XCircle,
} from 'lucide-react';
import type { ChainId, DexSearchPair, ExternalLinkItem, RugCheckReport, TokenData } from '../types';
import { API_URL } from '../config';
import { RESEARCH_PROVIDERS, buildEvidenceStorageKey } from '../constants/tokenResearch';
import {
  cn,
  formatChain,
  formatPct,
  formatRugRiskLevel,
  formatScreeningReason,
  formatStrategy,
  formatTimestamp,
  formatUSD,
  rugRiskTone,
  shortenAddress,
} from '../utils';

interface Props {
  token: TokenData | null;
  dexPair?: DexSearchPair;
  onClose: () => void;
}

const CREATOR_RISK_BAND_LABEL: Record<NonNullable<TokenData['creatorRiskBand']>, string> = {
  very_low: 'Very Low',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  very_high: 'Very High',
  unknown: 'Unknown',
};

export default function TokenDetailModal({ token, dexPair, onClose }: Props) {
  const [rugCheck, setRugCheck] = useState<RugCheckReport | null>(null);
  const [rugLoading, setRugLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [evidenceNote, setEvidenceNote] = useState('');
  const renderedAt = useState(() => Date.now())[0];

  const chainId = normalizeChainId(token?.chainId || dexPair?.chainId);
  const address = token?.address || dexPair?.baseToken?.address || '';
  const name = token?.name || dexPair?.baseToken?.name || '';
  const symbol = token?.symbol || dexPair?.baseToken?.symbol || '';
  const pairAddress = token?.pairAddress || dexPair?.pairAddress || '';
  const evidenceKey = address ? buildEvidenceStorageKey(chainId, address) : '';

  useEffect(() => {
    if (!address || chainId !== 'solana') {
      setRugCheck(null);
      setRugLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setRugLoading(true);
      try {
        const response = await fetch(`${API_URL}/rugcheck/${encodeURIComponent(address)}`);
        const data = response.ok ? await response.json() : null;
        if (!cancelled) setRugCheck(data);
      } catch {
        if (!cancelled) setRugCheck(null);
      } finally {
        if (!cancelled) setRugLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [address, chainId]);

  useEffect(() => {
    if (!evidenceKey) return;
    setEvidenceNote(window.localStorage.getItem(evidenceKey) || '');
  }, [evidenceKey]);

  useEffect(() => {
    if (!evidenceKey) return;
    window.localStorage.setItem(evidenceKey, evidenceNote);
  }, [evidenceKey, evidenceNote]);

  const researchInput = useMemo(() => ({
    chainId,
    address,
    pairAddress,
    symbol,
    name,
  }), [address, chainId, name, pairAddress, symbol]);

  const priceUsd = token?.priceUsd || parseFloat(dexPair?.priceUsd || '0');
  const liquidity = token?.liquidityUsd || dexPair?.liquidity?.usd || 0;
  const marketCap = token?.marketCap || dexPair?.marketCap || dexPair?.fdv || 0;
  const volume24h = token?.volume24h || dexPair?.volume?.h24 || 0;
  const volume1h = token?.volume1h || dexPair?.volume?.h1 || 0;
  const change5m = token?.priceChange5m ?? dexPair?.priceChange?.m5 ?? 0;
  const change1h = token?.priceChange1h ?? dexPair?.priceChange?.h1 ?? 0;
  const change6h = token?.priceChange6h ?? dexPair?.priceChange?.h6 ?? 0;
  const change24h = token?.priceChange24h ?? dexPair?.priceChange?.h24 ?? 0;
  const imageUrl = token?.imageUrl || dexPair?.info?.imageUrl;
  const websites = dexPair?.info?.websites || [];
  const socials = dexPair?.info?.socials || [];
  const pairCreatedAt = token?.pairCreatedAt || dexPair?.pairCreatedAt || 0;
  const passedRules = token?.screeningPassed ?? [];
  const failedRules = token?.screeningFailed ?? [];

  if (!address) return null;

  const copyAddress = () => {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-3 py-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[92vh] w-[min(1180px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-border bg-bg-secondary shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-bg-secondary/95 px-4 py-4 backdrop-blur-sm sm:px-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {imageUrl && <img src={imageUrl} alt="" className="h-10 w-10 rounded-full" />}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-text-primary">{symbol || 'UNKNOWN'}</h2>
                  <Badge>{formatChain(chainId)}</Badge>
                  {token?.experimentStrategy && <Badge tone="accent">{formatStrategy(token.experimentStrategy)}</Badge>}
                  {token?.eligible && <Badge tone="success">合格</Badge>}
                </div>
                <p className="mt-1 truncate text-xs text-text-muted">{name}</p>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-card hover:text-text-primary">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-bg-card px-2 py-1 font-mono text-xs text-text-secondary">{address}</code>
            <button onClick={copyAddress} className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-card hover:text-primary" title="复制地址">
              <Copy className="h-3.5 w-3.5" />
            </button>
            {copied && <span className="text-[10px] text-success">已复制</span>}
            {RESEARCH_PROVIDERS.slice(0, 5).map(provider => (
              <a
                key={provider.id}
                href={provider.buildUrl(researchInput)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
              >
                <ExternalLink className="h-3 w-3" />
                {provider.name}
              </a>
            ))}
          </div>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)_340px]">
          <section className="space-y-4">
            <PanelTitle icon={TrendingUp} title="行情与池子" />
            <div className="grid grid-cols-2 gap-3">
              <InfoCard label="价格" value={formatUSD(priceUsd)} />
              <InfoCard label="市值" value={formatUSD(marketCap)} />
              <InfoCard label="流动性" value={formatUSD(liquidity)} />
              <InfoCard label="24h 成交量" value={formatUSD(volume24h)} />
            </div>

            <div className="grid grid-cols-4 gap-2">
              <ChangeCard label="5m" value={change5m} />
              <ChangeCard label="1h" value={change1h} />
              <ChangeCard label="6h" value={change6h} />
              <ChangeCard label="24h" value={change24h} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <InfoCard label="1h 成交量" value={formatUSD(volume1h)} />
              <InfoCard label="MC/LP" value={token ? `${token.mcLpRatio.toFixed(1)}x` : '-'} />
              <InfoCard label="Vol/MC" value={token ? `${(token.volumeToMcRatio * 100).toFixed(1)}%` : '-'} />
              <InfoCard label="买卖比 1h" value={token ? `${token.buyToSellRatio1h.toFixed(2)}x` : '-'} />
            </div>

            {pairCreatedAt > 0 && (
              <div className="rounded-lg border border-border/70 bg-bg-card px-3 py-2 text-xs text-text-muted">
                创建于 {formatTimestamp(pairCreatedAt)} · 距今 {((renderedAt - pairCreatedAt) / 3_600_000).toFixed(1)}h
              </div>
            )}

            <ResearchLinks providers={RESEARCH_PROVIDERS} input={researchInput} />

            {(websites.length > 0 || socials.length > 0 || (token?.socialUrls && token.socialUrls.length > 0)) && (
              <SocialLinks websites={websites} socials={socials} tokenUrls={token?.socialUrls ?? []} />
            )}
          </section>

          <section className="space-y-4">
            <PanelTitle icon={Brain} title="策略与入场证据" />
            {token ? (
              <>
                <div className="rounded-lg border border-border bg-bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-text-muted">当前得分</p>
                      <p className={cn('panel-title mt-1 text-3xl', token.screeningScore >= 70 ? 'text-success' : token.screeningScore >= 45 ? 'text-warning' : 'text-danger')}>
                        {token.screeningScore.toFixed(0)}
                      </p>
                    </div>
                    <Badge tone={token.eligible ? 'success' : token.momentumConfirmed ? 'warning' : 'muted'}>
                      {getScoreStatus(token)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-text-secondary">{getScoreHeadline(token)}</p>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <BreakdownStat label="命中" value={String(passedRules.length)} tone="positive" />
                  <BreakdownStat label="风险" value={String(failedRules.length)} tone={failedRules.length > 0 ? 'negative' : 'positive'} />
                  <BreakdownStat label="聪明钱/KOL" value={String(token.smartMoneyBuyers)} tone={token.smartMoneyBuyers > 0 ? 'positive' : 'neutral'} />
                  <BreakdownStat label="动量" value={token.momentumConfirmed ? '是' : '否'} tone={token.momentumConfirmed ? 'positive' : 'neutral'} />
                </div>

                <ReasonList title="命中的条件" tone="positive" icon={CheckCircle} reasons={passedRules} />
                <ReasonList title="扣分或阻止准入" tone="negative" icon={AlertTriangle} reasons={failedRules} />
                <CreatorPanel token={token} />
              </>
            ) : (
              <EmptyPanel title="暂无本地策略记录" body="这个币来自 DexScreener 搜索结果，还没有经过本地筛选、Rug 分和模拟交易流程。" />
            )}
          </section>

          <section className="space-y-4">
            <PanelTitle icon={ShieldAlert} title="Rug 风险与人工证据" />
            {token ? (
              <>
                <div className={cn('rounded-lg border p-3', rugRiskTone(token.rugRiskLevel))}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{formatRugRiskLevel(token.rugRiskLevel)}风险</span>
                    <span className="panel-title text-2xl">{token.rugRiskScore}/100</span>
                  </div>
                  {token.rugRiskReasons.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-xs">
                      {token.rugRiskReasons.slice(0, 7).map(reason => <li key={reason}>{reason}</li>)}
                    </ul>
                  )}
                </div>

                <SafetyPanel token={token} />
              </>
            ) : (
              <EmptyPanel title="等待本地风控" body="搜索结果可以先外部核验，进入监控后会补齐本地安全评分。" />
            )}

            <RugCheckPanel chainId={chainId} rugCheck={rugCheck} loading={rugLoading} />
            <EvidenceDesk note={evidenceNote} onChange={setEvidenceNote} />
          </section>
        </div>
      </div>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary" />
      <h3 className="panel-title text-sm text-text-primary">{title}</h3>
    </div>
  );
}

function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'success' | 'warning' | 'accent' | 'muted' }) {
  return (
    <span className={cn(
      'rounded-full px-2 py-0.5 text-[10px]',
      tone === 'success' ? 'bg-success/15 text-success' :
      tone === 'warning' ? 'bg-warning/15 text-warning' :
      tone === 'accent' ? 'bg-accent/15 text-accent' :
      'bg-text-muted/15 text-text-muted',
    )}>
      {children}
    </span>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg-card p-2.5">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function ChangeCard({ label, value }: { label: string; value: number }) {
  return (
    <div className={cn(
      'rounded-lg border p-2 text-center',
      value >= 0 ? 'border-success/20 bg-success/10' : 'border-danger/20 bg-danger/10',
    )}>
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className={cn('text-xs font-bold', value >= 0 ? 'text-success' : 'text-danger')}>{formatPct(value)}</div>
    </div>
  );
}

function ResearchLinks({ providers, input }: {
  providers: typeof RESEARCH_PROVIDERS;
  input: Parameters<typeof RESEARCH_PROVIDERS[number]['buildUrl']>[0];
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-medium text-text-secondary">平台借鉴工作流</h4>
        <span className="text-[10px] text-text-muted">API / 外链 / 人工证据</span>
      </div>
      <div className="mt-3 grid gap-2">
        {providers.map(provider => (
          <a
            key={provider.id}
            href={provider.buildUrl(input)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border/70 bg-bg-primary/55 px-3 py-2 transition-colors hover:border-accent/30 hover:bg-bg-card-hover"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-text-primary">{provider.name}</span>
              <Badge tone={provider.mode === 'api' ? 'success' : provider.mode === 'manual' ? 'warning' : 'muted'}>
                {provider.mode === 'api' ? '自动' : provider.mode === 'manual' ? '人工' : '外部'}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-text-muted">{provider.signal}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

function SocialLinks({ websites, socials, tokenUrls }: {
  websites: ExternalLinkItem[];
  socials: ExternalLinkItem[];
  tokenUrls: string[];
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <h4 className="text-xs font-medium text-text-secondary">项目链接</h4>
      <div className="mt-2 flex flex-wrap gap-2">
        {websites.map((website, index) => (
          <ExternalPill key={`w-${index}`} href={website.url} icon={Globe} label={safeHostname(website.url)} />
        ))}
        {socials.map((social, index) => (
          <ExternalPill key={`s-${index}`} href={social.url} icon={social.type === 'twitter' ? AtSign : MessageCircle} label={social.type || safeHostname(social.url)} />
        ))}
        {tokenUrls.map((url, index) => (
          <ExternalPill key={`u-${index}`} href={url} icon={ExternalLink} label={url.includes('twitter') || url.includes('x.com') ? 'Twitter' : safeHostname(url)} />
        ))}
      </div>
    </div>
  );
}

function ExternalPill({ href, icon: Icon, label }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-bg-primary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-accent">
      <Icon className="h-3 w-3" />
      {label}
    </a>
  );
}

function ReasonList({ title, reasons, tone, icon: Icon }: {
  title: string;
  reasons: string[];
  tone: 'positive' | 'negative';
  icon: React.ComponentType<{ className?: string }>;
}) {
  if (reasons.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5', tone === 'positive' ? 'text-success' : 'text-danger')} />
        <h4 className={cn('text-[11px] font-medium', tone === 'positive' ? 'text-success' : 'text-danger')}>{title}</h4>
      </div>
      <div className="mt-2 max-h-[210px] space-y-1.5 overflow-y-auto pr-1">
        {reasons.map((reason, index) => (
          <div key={`${tone}-${index}`} className={cn(
            'rounded-lg px-2.5 py-2 text-[11px] leading-5',
            tone === 'positive' ? 'bg-success/8 text-success' : 'bg-danger/8 text-danger',
          )}>
            {formatScreeningReason(reason)}
          </div>
        ))}
      </div>
    </div>
  );
}

function SafetyPanel({ token }: { token: TokenData }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <h4 className="text-xs font-medium text-text-secondary">安全检查</h4>
      <div className="mt-3 grid gap-2 text-xs">
        <SafetyRow label="Mint 权限" ok={token.mintAuthorityRevoked} />
        <SafetyRow label="Freeze 权限" ok={token.freezeAuthorityRevoked} />
        <div className="flex items-center gap-1.5">
          {token.lpLocked ? <Lock className="h-3 w-3 text-success" /> : <AlertTriangle className="h-3 w-3 text-warning" />}
          <span className={token.lpLocked ? 'text-success' : 'text-warning'}>
            LP {token.lpLocked ? `已锁定${token.lpLockPlatform ? ` (${token.lpLockPlatform})` : ''}` : '未锁定或未知'}
          </span>
        </div>
        {token.top10HolderPct !== null && (
          <div className={token.top10HolderPct < 40 ? 'text-success' : 'text-danger'}>
            Top10 持仓 {token.top10HolderPct.toFixed(1)}%
          </div>
        )}
        {token.holderCount !== null && <div className="text-text-secondary">持有人数 {token.holderCount}</div>}
        {token.smartMoneyBuyers > 0 && (
          <div className="flex items-center gap-1.5 text-accent">
            <Brain className="h-3 w-3" />
            {token.smartMoneyBuyers} 个聪明钱/KOL 钱包命中
          </div>
        )}
      </div>
    </div>
  );
}

function SafetyRow({ label, ok }: { label: string; ok: boolean | null }) {
  return (
    <div className="flex items-center gap-1.5">
      {ok === null ? (
        <span className="text-text-muted">{label}: 未知</span>
      ) : ok ? (
        <>
          <CheckCircle className="h-3 w-3 text-success" />
          <span className="text-success">{label} 已撤销</span>
        </>
      ) : (
        <>
          <XCircle className="h-3 w-3 text-danger" />
          <span className="text-danger">{label} 未撤销</span>
        </>
      )}
    </div>
  );
}

function RugCheckPanel({ rugCheck, loading }: { chainId: ChainId; rugCheck: RugCheckReport | null; loading: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
        <Shield className="h-3.5 w-3.5" />
        RugCheck 安全报告
      </h4>
      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在获取安全报告
        </div>
      ) : rugCheck ? (
        <div className="mt-3 space-y-2">
          {rugCheck.score !== undefined && (
            <div className="text-xs">
              安全评分 <span className={cn('font-bold', rugCheck.score >= 800 ? 'text-success' : rugCheck.score >= 500 ? 'text-warning' : 'text-danger')}>{rugCheck.score}</span>
            </div>
          )}
          {rugCheck.risks && rugCheck.risks.length > 0 ? (
            <div className="space-y-1">
              {rugCheck.risks.slice(0, 8).map((risk, index) => (
                <div key={index} className={cn(
                  'rounded px-2 py-1 text-[11px] leading-5',
                  risk.level === 'danger' || risk.level === 'critical' ? 'bg-danger/10 text-danger' :
                  risk.level === 'warn' ? 'bg-warning/10 text-warning' :
                  'bg-bg-primary text-text-secondary',
                )}>
                  <span className="font-medium">{risk.name}</span>: {risk.description}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-success">未发现高风险项</div>
          )}
        </div>
      ) : (
        <div className="mt-3 text-xs text-text-muted">无法获取 RugCheck 报告</div>
      )}
    </div>
  );
}

function EvidenceDesk({ note, onChange }: { note: string; onChange: (value: string) => void }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-medium text-text-secondary">人工证据</h4>
        <span className="text-[10px] text-text-muted">本地保存</span>
      </div>
      <textarea
        value={note}
        onChange={event => onChange(event.target.value)}
        placeholder="粘贴 GMGN 钱包链接、KOL 线索、AVE 页面结论、异常税费或任何人工核验记录。"
        className="mt-3 min-h-[120px] w-full resize-y rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs leading-5 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
      />
      <p className="mt-2 text-[11px] leading-5 text-text-muted">
        没有稳定 API 的平台只作为证据来源，不直接自动加分；需要复制钱包或结论后再进入聪明钱/风控流程。
      </p>
    </div>
  );
}

function CreatorPanel({ token }: { token: TokenData }) {
  if (!token.creatorAddress) return null;

  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <h4 className="text-xs font-medium text-text-secondary">创建者分析</h4>
      <div className="mt-2 space-y-1 text-xs text-text-secondary">
        <div>地址 <code className="text-text-muted">{shortenAddress(token.creatorAddress, 6)}</code></div>
        {token.creatorRugCount !== null && (
          <div className={token.creatorRugCount > 0 ? 'text-danger' : 'text-success'}>
            Rug 次数 {token.creatorRugCount}
            {token.creatorSurvivalCount !== null && ` · 存活项目 ${token.creatorSurvivalCount}`}
          </div>
        )}
        {token.creatorRugProbability !== null && (
          <div className={token.creatorRugProbability >= 0.55 ? 'text-danger' : token.creatorRugProbability >= 0.35 ? 'text-warning' : 'text-success'}>
            Rug Probability {(token.creatorRugProbability * 100).toFixed(1)}%
            {token.creatorRiskBand && ` · ${CREATOR_RISK_BAND_LABEL[token.creatorRiskBand]}`}
          </div>
        )}
        {token.creatorDevLaunchedTokenCount !== null && (
          <div className={(token.creatorDevRugRate ?? 0) >= 0.45 ? 'text-danger' : 'text-text-secondary'}>
            Pump.dev 历史 {token.creatorDevLaunchedTokenCount} 个币
            {token.creatorDevRugRate !== null && ` · 历史跑路率 ${(token.creatorDevRugRate * 100).toFixed(1)}%`}
          </div>
        )}
        {token.creatorDevHistory.length > 0 && (
          <div className="mt-2 rounded-md border border-border/60 bg-bg-primary/60 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">AVE / Pump dev history</div>
            <div className="space-y-1">
              {token.creatorDevHistory.slice(0, 5).map((item) => (
                <div key={item.address} className="flex items-center justify-between gap-2">
                  <span className="truncate text-text-secondary">{item.symbol || item.name}</span>
                  <span className={item.status === 'rugged' ? 'text-danger' : item.status === 'survived' ? 'text-success' : 'text-text-muted'}>
                    {item.status === 'rugged' ? '疑似跑路' : item.status === 'survived' ? '存活' : '未知'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <h4 className="text-xs font-medium text-text-secondary">{title}</h4>
      <p className="mt-2 text-xs leading-5 text-text-muted">{body}</p>
    </div>
  );
}

function BreakdownStat({ label, value, tone }: {
  label: string;
  value: string;
  tone: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  return (
    <div className={cn(
      'rounded-lg border px-3 py-2',
      tone === 'positive' ? 'border-success/20 bg-success/10' :
      tone === 'negative' ? 'border-danger/20 bg-danger/10' :
      tone === 'warning' ? 'border-warning/20 bg-warning/10' :
      'border-border/60 bg-bg-primary/60',
    )}>
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className={cn(
        'mt-1 truncate text-sm font-semibold',
        tone === 'positive' ? 'text-success' :
        tone === 'negative' ? 'text-danger' :
        tone === 'warning' ? 'text-warning' :
        'text-text-primary',
      )}>{value}</div>
    </div>
  );
}

function getScoreStatus(token: TokenData | null) {
  if (!token) return '无数据';
  if (token.eligible) return '当前可交易';
  if (token.momentumConfirmed) return '等待准入';
  if (token.screeningScore >= 45) return '观察中';
  return '高风险观察';
}

function getScoreHeadline(token: TokenData | null) {
  if (!token) return '暂无策略解释。';

  const base = `当前得分 ${token.screeningScore.toFixed(0)}，命中 ${token.screeningPassed.length} 项，风险/扣分 ${token.screeningFailed.length} 项。`;
  if (token.eligible) return `${base} 已满足当前准入条件，可以进入交易候选。`;
  if (token.momentumConfirmed) return `${base} 已出现动量确认，但仍有条件未满足。`;
  return `${base} 目前更适合继续观察。`;
}

function normalizeChainId(_value: unknown): ChainId {
  return 'solana';
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
