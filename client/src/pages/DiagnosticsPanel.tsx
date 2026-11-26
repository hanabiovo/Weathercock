import React, { useMemo, useState } from 'react';
import { Activity, Check, Eye, KeyRound, RefreshCw, Zap } from 'lucide-react';
import { SubpageShell } from '../components/SubpageShell';
import { useWeathercock } from '../context/WeathercockContext';
import { formatRelativeTime } from '../utils/format';

export const DiagnosticsPanel: React.FC = () => {
  const {
    config,
    activePanel,
    setActivePanel,
    probingIds,
    batchProgress,
    cancelBatchProbe,
    probeModel,
    batchProbeModels,
    saveSite,
    showToast,
  } = useWeathercock();

  const isOpen = activePanel === 'diagnostics';
  const [siteFilter, setSiteFilter] = useState('all');
  const [editingKeySiteId, setEditingKeySiteId] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');

  const visibleWatched = useMemo(() => {
    if (siteFilter === 'all') return config.watched;
    return config.watched.filter((w) => w.siteId === siteFilter);
  }, [config.watched, siteFilter]);

  const sitesWithoutKey = useMemo(() => config.sites.filter((s) => !s.apiKey), [config.sites]);

  return (
    <SubpageShell
      open={isOpen}
      title="连接诊断控制台"
      subtitle="DIAGNOSTIC / 实测延迟与工具调用"
      onClose={() => setActivePanel(null)}
    >
      {/* API Key Readiness */}
      <div className="subpage-section" style={{ background: 'var(--bg-inset)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span className="micro-label">API KEY STATUS / 站点测试令牌状态</span>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {sitesWithoutKey.length === 0 && config.sites.length > 0
              ? '全部站点已配置测试令牌'
              : `有 ${sitesWithoutKey.length} 个站点尚未配置`}
          </span>
        </div>

        {config.sites.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>请先添加至少一个中转站。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {config.sites.map((s) => {
              const isEditing = editingKeySiteId === s.id;
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-panel)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span className={`status-dot ${s.apiKey ? 'online' : ''}`} />
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{s.name}</span>
                    <span className="muted mono" style={{ fontSize: 11 }}>
                      {s.apiKey ? '已配置密钥' : '未配置（无法主动实测）'}
                    </span>
                  </div>

                  {isEditing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 210 }}>
                      <input
                        type="password"
                        className="input input-sm"
                        style={{ flex: 1 }}
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        placeholder="sk-...（留空则清除）"
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-xs"
                        onClick={() => {
                          saveSite({ ...s, apiKey: keyDraft.trim() || undefined });
                          setEditingKeySiteId(null);
                          showToast(`已更新「${s.name}」诊断密钥`, 'success');
                        }}
                      >
                        <Check size={12} />
                        保存
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => setEditingKeySiteId(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => {
                        setEditingKeySiteId(s.id);
                        setKeyDraft(s.apiKey || '');
                      }}
                    >
                      <KeyRound size={11} />
                      {s.apiKey ? '更换密钥' : '配置测试密钥'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Batch Controls */}
      <div className="subpage-section" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            className="select select-sm"
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            aria-label="按站点筛选诊断目标"
          >
            <option value="all">全部站点 ({config.watched.length})</option>
            {config.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={batchProgress.active || visibleWatched.length === 0}
            onClick={() => batchProbeModels(visibleWatched, 'ping')}
          >
            <Zap size={12} />
            批量测连通
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={batchProgress.active || visibleWatched.length === 0}
            onClick={() => batchProbeModels(visibleWatched, 'tools')}
          >
            <Activity size={12} />
            批量测工具调用
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={batchProgress.active || visibleWatched.length === 0}
            onClick={() => batchProbeModels(visibleWatched, 'vision')}
          >
            <Eye size={12} />
            批量测识图
          </button>
        </div>
      </div>

      {batchProgress.active && (
        <div className="banner-strip info">
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                正在实测模型（{batchProgress.completed} / {batchProgress.total}）...
              </span>
              <button type="button" className="btn btn-danger btn-xs" onClick={cancelBatchProbe}>
                取消
              </button>
            </div>
            <div className="batch-bar">
              <div
                className="batch-bar-fill"
                style={{ width: `${Math.round((batchProgress.completed / Math.max(1, batchProgress.total)) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Model Diagnostics List */}
      {visibleWatched.length === 0 ? (
        <div className="empty-box">
          <h2>暂无待诊断模型</h2>
          <p>请先通过「+ 添加」关注模型后再执行连接与工具调用诊断。</p>
        </div>
      ) : (
        <div>
          {visibleWatched.map((w) => {
            const site = config.sites.find((s) => s.id === w.siteId);
            const isProbing = probingIds.has(w.id);
            const p = w.lastProbe;

            return (
              <div key={w.id} className="plaza-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span className={`status-dot ${p ? (p.ok ? 'online' : 'error') : ''}`} />
                    <strong style={{ fontSize: 13.5, fontWeight: 500 }}>{w.alias || w.modelName}</strong>
                    <span className="mini-tag">{site?.name || '未知'}</span>
                    {p?.supportsTools === true && <span className="tool-badge yes">Tools ✓</span>}
                    {p?.supportsTools === false && <span className="tool-badge no">Tools ✗</span>}
                    {p?.supportsVision === true && <span className="tool-badge yes">Vision ✓</span>}
                    {p?.supportsVision === false && <span className="tool-badge no">Vision ✗</span>}
                  </div>

                  {w.alias && (
                    <div className="mono muted" style={{ fontSize: 11 }}>{w.modelName}</div>
                  )}

                  {p ? (
                    <div style={{ fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div className="tabular">
                        <span style={{ color: p.ok ? 'var(--green)' : 'var(--red)' }}>
                          {p.ok ? `HTTP ${p.httpStatus || 200} · ${p.latencyMs} ms` : `失败 (${p.httpStatus || 0}) · ${p.latencyMs} ms`}
                        </span>
                        <span className="muted"> · {formatRelativeTime(p.at)}</span>
                      </div>
                      {p.usage && (
                        <div className="mono muted" style={{ fontSize: 11 }}>
                          {[
                            p.usage.promptTokens !== null ? `输入 ${p.usage.promptTokens}` : null,
                            p.usage.completionTokens !== null ? `输出 ${p.usage.completionTokens}` : null,
                            p.usage.cacheReadTokens ? `缓存 ${p.usage.cacheReadTokens}` : null,
                            p.usage.reasoningTokens ? `思考 ${p.usage.reasoningTokens}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                      {p.error && (
                        <div style={{ color: 'var(--red)', wordBreak: 'break-word' }}>{p.error}</div>
                      )}
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 11.5 }}>尚未实测</div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={isProbing}
                    onClick={() => probeModel(w.id, 'ping')}
                  >
                    {isProbing ? <RefreshCw size={11} className="spinning" /> : <Zap size={11} />}
                    测连通
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={isProbing}
                    onClick={() => probeModel(w.id, 'tools')}
                  >
                    测工具
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={isProbing}
                    onClick={() => probeModel(w.id, 'vision')}
                  >
                    测识图
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SubpageShell>
  );
};
