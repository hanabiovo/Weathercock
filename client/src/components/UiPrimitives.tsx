import React, { useEffect, useState } from 'react';
import { Activity, ChevronLeft, Copy, Eye, RefreshCw, Trash2, X, Zap } from 'lucide-react';
import { useWeathercock } from '../context/WeathercockContext';
import { copyToClipboard, formatRelativeTime, formatRmb, formatUsd } from '../utils/format';
import { computeModelPrice, findKumaMonitor } from '../utils/pricing';
import { NotionTagPicker } from './NotionTagPicker';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useWeathercock();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-item ${t.type}`}>
          <span>{t.message}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {t.actionLabel && t.onAction && (
              <button
                type="button"
                className="toast-btn"
                onClick={() => {
                  t.onAction?.();
                  dismissToast(t.id);
                }}
              >
                {t.actionLabel}
              </button>
            )}
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => dismissToast(t.id)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                opacity: 0.75,
                display: 'inline-flex',
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export const ConfirmModal: React.FC = () => {
  const { confirmState, resolveConfirm } = useWeathercock();

  useEffect(() => {
    if (!confirmState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resolveConfirm(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmState, resolveConfirm]);

  if (!confirmState) return null;

  return (
    <div className="modal-backdrop" role="alertdialog" aria-modal="true" onClick={() => resolveConfirm(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 15, fontWeight: 500 }}>{confirmState.title}</strong>
          <button type="button" className="icon-btn" onClick={() => resolveConfirm(false)} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.6 }}>
          {confirmState.message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn" onClick={() => resolveConfirm(false)}>
            {confirmState.cancelText || '取消'}
          </button>
          <button
            type="button"
            className={`btn ${confirmState.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => resolveConfirm(true)}
            autoFocus
          >
            {confirmState.confirmText || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const InspectorDrawer: React.FC = () => {
  const {
    config,
    inspectedWatchId,
    setInspectedWatchId,
    kumaCache,
    probingIds,
    getListingStatus,
    probeModel,
    updateWatch,
    removeWatchWithUndo,
    showToast,
  } = useWeathercock();

  const item = config.watched.find((w) => w.id === inspectedWatchId) || null;
  const site = item ? config.sites.find((s) => s.id === item.siteId) || null : null;
  const listing = item ? getListingStatus(item) : null;
  const kumaData = site ? kumaCache.get(site.id) : undefined;
  const kumaMatch = item && kumaData ? findKumaMonitor(item, kumaData) : null;

  const [alias, setAlias] = useState('');
  const [group, setGroup] = useState('');
  const [kumaId, setKumaId] = useState('');

  useEffect(() => {
    if (!item) return;
    setAlias(item.alias || '');
    const calc =
      listing?.model && listing.pricing
        ? computeModelPrice(listing.model, listing.pricing.groupRatio, item.group, site?.exchangeRate)
        : null;
    setGroup(item.group || calc?.activeGroup || 'default');
    setKumaId(item.kumaMonitorId || '');
  }, [item?.id, item?.alias, item?.group, item?.kumaMonitorId, listing?.model, listing?.pricing, site?.exchangeRate]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectedWatchId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, setInspectedWatchId]);

  if (!item || !listing) return null;

  const calc =
    listing.model && listing.pricing && listing.model.hasPricing !== false
      ? computeModelPrice(listing.model, listing.pricing.groupRatio, group || item.group, site?.exchangeRate)
      : null;

  const availableGroups =
    listing.model && listing.model.enableGroups.length > 0
      ? listing.model.enableGroups
      : [calc?.activeGroup || item.group || 'default'];

  const isProbing = probingIds.has(item.id);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateWatch(item.id, {
      alias: alias.trim() || undefined,
      group: group || undefined,
      kumaMonitorId: kumaId || undefined,
    });
    showToast('模型配置已更新', 'success');
  };

  return (
    <div className="subpage-backdrop" onClick={() => setInspectedWatchId(null)}>
      <aside className="subpage-panel narrow" aria-label="模型详情检查器" onClick={(e) => e.stopPropagation()}>
        <div className="subpage-head">
          <button type="button" className="btn btn-ghost btn-sm subpage-back-btn" onClick={() => setInspectedWatchId(null)}>
            <ChevronLeft size={16} />
            返回
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="micro-label">INSPECTOR / 模型详情</div>
            <div style={{ fontSize: 15, fontWeight: 500, marginTop: 2, wordBreak: 'break-all' }}>
              {item.alias || item.modelName}
            </div>
            <div className="mono muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>
              {site?.name || '未知站点'} · {item.modelName}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className="icon-btn"
              title="复制模型 ID"
              onClick={async () => {
                const ok = await copyToClipboard(item.modelName);
                showToast(ok ? `已复制 ${item.modelName}` : '复制失败', ok ? 'success' : 'error');
              }}
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              className="icon-btn subpage-close-desktop"
              aria-label="关闭抽屉"
              onClick={() => setInspectedWatchId(null)}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="subpage-body">
          {/* Pricing Detail */}
          <div className="subpage-section">
            <div className="micro-label">PRICING / 实时资费</div>
            {calc ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {calc.quotaType === 1 ? (
                  <div className="tabular" style={{ fontSize: 18 }}>
                    {formatUsd(calc.perCallUsd)}
                    <span className="muted" style={{ fontSize: 12 }}> / 次</span>
                    {calc.perCallRmb !== null && calc.perCallRmb !== undefined && (
                      <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>
                        ≈ {formatRmb(calc.perCallRmb)}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="tabular" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div className="micro-label">INPUT / 1M</div>
                      <div style={{ fontSize: 18 }}>{formatUsd(calc.inputUsd)}</div>
                      {calc.inputRmb !== null && calc.inputRmb !== undefined && (
                        <div className="muted" style={{ fontSize: 11.5 }}>≈ {formatRmb(calc.inputRmb)}</div>
                      )}
                    </div>
                    <div>
                      <div className="micro-label">OUTPUT / 1M</div>
                      <div style={{ fontSize: 18 }}>{formatUsd(calc.outputUsd)}</div>
                      {calc.outputRmb !== null && calc.outputRmb !== undefined && (
                        <div className="muted" style={{ fontSize: 11.5 }}>≈ {formatRmb(calc.outputRmb)}</div>
                      )}
                    </div>
                  </div>
                )}
                <div className="muted mono" style={{ fontSize: 11 }}>
                  当前分组：{calc.activeGroup} (×{calc.groupRatio})
                  {calc.isTieredExpr ? ` · 阶梯计费：${calc.billingExpr}` : ''}
                </div>
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                {listing.code === 'delisted'
                  ? '该站模型广场已找不到此模型 ID，可能已下架或改名。'
                  : listing.code === 'manual' || listing.model?.hasPricing === false
                    ? '该站未公开资费（通过 /v1/models 或手动添加），可直接使用下方实测诊断。'
                    : listing.error || '暂无实时资费数据'}
              </div>
            )}
          </div>

          {/* Kuma / Native Uptime Heartbeats */}
          <div className="subpage-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="micro-label">HEARTBEAT / 渠道监控</span>
              {kumaMatch && (
                <span className="mono tabular" style={{ fontSize: 12 }}>
                  {kumaMatch.monitor.uptime24h !== null ? `24h ${(kumaMatch.monitor.uptime24h * 100).toFixed(1)}%` : '—'}
                  {kumaMatch.monitor.latestPing !== null ? ` · ${kumaMatch.monitor.latestPing}ms` : ''}
                </span>
              )}
            </div>
            {kumaMatch ? (
              <>
                <div className="muted" style={{ fontSize: 12 }}>
                  绑定监控项：{kumaMatch.monitor.name} {kumaMatch.manual ? '(手动绑定)' : '(自动匹配)'}
                </div>
                {kumaMatch.monitor.heartbeats.length > 0 ? (
                  <>
                    <div className="kuma-bars" role="img" aria-label="最近 20 次心跳记录">
                      {kumaMatch.monitor.heartbeats.slice(-20).map((b, i) => {
                        const cls = b.status === 1 ? 'up' : b.status === 2 ? 'maint' : 'down';
                        const statusText = b.status === 1 ? '正常' : b.status === 2 ? '维护' : '异常';
                        return (
                          <span
                            key={`${b.time}-${i}`}
                            className={`kuma-bar ${cls}`}
                            title={`${b.time || ''} · ${statusText} · ${b.ping !== null ? `${b.ping}ms` : '—'}`}
                          />
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }} className="muted">
                      <span>较早</span>
                      <span>最新（悬停单条可看时间与延迟）</span>
                    </div>
                  </>
                ) : (
                  <div className="muted" style={{ fontSize: 11.5 }}>站点原生监控（无逐条心跳明细）</div>
                )}
              </>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                {kumaData?.monitors?.length
                  ? '未自动匹配到监控项，可在下方手动绑定。'
                  : '该站点暂无公开状态监控数据。'}
              </div>
            )}
          </div>

          {/* Active Probe */}
          <div className="subpage-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="micro-label">DIAGNOSTIC / 连接诊断</span>
              {item.lastProbe && (
                <span className="muted" style={{ fontSize: 11 }}>
                  {formatRelativeTime(item.lastProbe.at)}
                </span>
              )}
            </div>
            {item.lastProbe ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`badge-tag ${item.lastProbe.ok ? 'best' : 'warn'}`}>
                    {item.lastProbe.ok
                      ? `HTTP ${item.lastProbe.httpStatus || 200} · ${item.lastProbe.latencyMs}ms`
                      : `失败 ${item.lastProbe.httpStatus || ''} · ${item.lastProbe.latencyMs}ms`}
                  </span>
                  {item.lastProbe.supportsTools === true && <span className="tool-badge yes">Tools ✓</span>}
                  {item.lastProbe.supportsTools === false && <span className="tool-badge no">Tools ✗</span>}
                  {item.lastProbe.supportsVision === true && <span className="tool-badge yes">Vision ✓</span>}
                  {item.lastProbe.supportsVision === false && <span className="tool-badge no">Vision ✗</span>}
                </div>
                {item.lastProbe.usage && (
                  <div className="mono muted" style={{ fontSize: 11 }}>
                    {[
                      item.lastProbe.usage.promptTokens !== null ? `输入 ${item.lastProbe.usage.promptTokens}` : null,
                      item.lastProbe.usage.completionTokens !== null ? `输出 ${item.lastProbe.usage.completionTokens}` : null,
                      item.lastProbe.usage.totalTokens !== null ? `总计 ${item.lastProbe.usage.totalTokens}` : null,
                      item.lastProbe.usage.cacheReadTokens ? `缓存 ${item.lastProbe.usage.cacheReadTokens}` : null,
                      item.lastProbe.usage.reasoningTokens ? `思考 ${item.lastProbe.usage.reasoningTokens}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
                {item.lastProbe.error && (
                  <div style={{ color: 'var(--red)', fontSize: 11.5, wordBreak: 'break-word' }}>
                    {item.lastProbe.error}
                  </div>
                )}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>尚未执行主动连接诊断</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={isProbing}
                onClick={() => probeModel(item.id, 'ping')}
              >
                {isProbing ? <RefreshCw size={12} className="spinning" /> : <Zap size={12} />}
                {isProbing ? '诊断中...' : '测连通'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={isProbing}
                onClick={() => probeModel(item.id, 'tools')}
              >
                <Activity size={12} />
                测工具调用
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={isProbing}
                onClick={() => probeModel(item.id, 'vision')}
              >
                <Eye size={12} />
                测识图
              </button>
            </div>
          </div>

          {/* Edit Form */}
          <form className="subpage-section" onSubmit={handleSave}>
            <div className="micro-label">CONFIGURATION / 关注配置</div>
            <label className="field">
              <span>自定义备注名</span>
              <input
                className="input"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="例如：写作主力 / AWS 渠道"
              />
            </label>
            <div className="field">
              <span>标签（Notion 多选 · 即点即存）</span>
              <NotionTagPicker watchId={item.id} selectedTags={item.tags || []} />
            </div>
            <div className="field">
              <span>计费分组</span>
              {availableGroups.length > 1 ? (
                <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
                  {availableGroups.map((g) => {
                    const r = listing.pricing?.groupRatio?.[g];
                    return (
                      <option key={g} value={g}>
                        {g}
                        {Number.isFinite(r) ? ` (×${r})` : ''}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <div className="mono muted" style={{ fontSize: 12.5, padding: '6px 0' }}>
                  {availableGroups[0] || 'default'}
                  {Number.isFinite(listing.pricing?.groupRatio?.[availableGroups[0] || 'default'])
                    ? ` (×${listing.pricing?.groupRatio?.[availableGroups[0] || 'default']})`
                    : ''}
                </div>
              )}
            </div>
            {kumaData && kumaData.monitors.length > 0 && (
              <label className="field">
                <span>渠道监控项绑定</span>
                <select className="select" value={kumaId} onChange={(e) => setKumaId(e.target.value)}>
                  <option value="">自动匹配</option>
                  {kumaData.monitors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.groupName ? `[${m.groupName}] ` : ''}
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => removeWatchWithUndo(item.id)}
              >
                <Trash2 size={12} />
                取消关注
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                保存配置
              </button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
};
