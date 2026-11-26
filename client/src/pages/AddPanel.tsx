import React, { useEffect, useMemo, useState } from 'react';
import { Check, Plus, RefreshCw, Search } from 'lucide-react';
import { NotionTagPicker } from '../components/NotionTagPicker';
import { SiteFormFields, type SiteFormValues, siteToFormValues, validateSiteValues } from '../components/SiteFormFields';
import { SubpageShell } from '../components/SubpageShell';
import { useWeathercock } from '../context/WeathercockContext';
import type { PricingData, PricingModel } from '../types/weathercock';
import { formatRmb, formatUsd } from '../utils/format';
import { computeModelPrice, getEffectiveQuotaType } from '../utils/pricing';
import { PLAZA_PAGE_SIZE } from '../utils/storage';

function getModelVendorLabel(m: PricingModel, pricingData: PricingData): string {
  const fromVendor = m.vendorId !== null ? pricingData.vendors?.[String(m.vendorId)] : '';
  return (fromVendor || m.ownerBy || '其他').trim();
}

function getModelSortName(modelName: string): string {
  return modelName
    .replace(/^(\[[^\]]*\]|【[^】]*】|\([^)]*\)|（[^）]*）|\s)+/g, '')
    .trim()
    .toLowerCase();
}

export const AddPanel: React.FC = () => {
  const {
    config,
    activePanel,
    setActivePanel,
    setEditingSiteId,
    plazaSiteId,
    setPlazaSiteId,
    pricingCache,
    siteErrors,
    loadingSiteIds,
    saveSite,
    refreshSite,
    addWatch,
    removeWatchWithUndo,
    confirmDialog,
    showToast,
  } = useWeathercock();

  const isOpen = activePanel === 'add';

  // Step 1: Quick Add Site state
  const [showNewSite, setShowNewSite] = useState(false);
  const [siteValues, setSiteValues] = useState<SiteFormValues>(() => siteToFormValues(null));
  const [siteFieldErrors, setSiteFieldErrors] = useState<Record<string, string>>({});

  // Step 2: Plaza filter state
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('');
  const [quotaFilter, setQuotaFilter] = useState<'all' | '0' | '1'>('all');
  const [nameSortMode, setNameSortMode] = useState<'model' | 'prefix'>('model');
  const [visibleCount, setVisibleCount] = useState(PLAZA_PAGE_SIZE);
  const [hoverUnwatchId, setHoverUnwatchId] = useState<string | null>(null);
  const [justFollowedModel, setJustFollowedModel] = useState<string | null>(null);
  const [showManualBox, setShowManualBox] = useState(false);
  const [manualModelInput, setManualModelInput] = useState('');

  useEffect(() => {
    if (isOpen && config.sites.length === 0) {
      setShowNewSite(true);
    }
    if (!isOpen) {
      setJustFollowedModel(null);
    }
  }, [isOpen, config.sites.length]);

  const selectedSite = config.sites.find((s) => s.id === plazaSiteId) || null;
  const pricingData = selectedSite ? pricingCache.get(selectedSite.id) : undefined;
  const isLoading = selectedSite ? loadingSiteIds.has(selectedSite.id) : false;
  const plazaErr = selectedSite ? siteErrors.get(selectedSite.id) : undefined;

  useEffect(() => {
    if (isOpen && selectedSite && !pricingCache.has(selectedSite.id) && !loadingSiteIds.has(selectedSite.id)) {
      refreshSite(selectedSite, false);
    }
  }, [isOpen, selectedSite, pricingCache, loadingSiteIds, refreshSite]);

  useEffect(() => {
    setVisibleCount(PLAZA_PAGE_SIZE);
    setGroupFilter('');
    setVendorFilter('all');
    setJustFollowedModel(null);
  }, [plazaSiteId]);

  const watchedMap = useMemo(() => {
    const map = new Map<string, (typeof config.watched)[number]>();
    for (const w of config.watched) {
      if (w.siteId === plazaSiteId) map.set(w.modelName, w);
    }
    return map;
  }, [config.watched, plazaSiteId]);

  // Extract site-provided vendor/category pills (e.g. Google, DeepSeek, OpenAI, Anthropic)
  const vendorStats = useMemo(() => {
    if (!pricingData) return [];
    const counts = new Map<string, number>();
    for (const m of pricingData.models) {
      const label = getModelVendorLabel(m, pricingData);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [pricingData]);

  // Filter + default alphabetical sort by model name
  const filteredModels = useMemo(() => {
    if (!pricingData) return [];
    const q = search.trim().toLowerCase();
    const list = pricingData.models.filter((m) => {
      if (vendorFilter !== 'all' && getModelVendorLabel(m, pricingData) !== vendorFilter) return false;
      if (quotaFilter !== 'all' && String(getEffectiveQuotaType(m)) !== quotaFilter) return false;
      if (groupFilter && !(m.enableGroups || []).includes(groupFilter)) return false;
      if (!q) return true;
      const vendorName = getModelVendorLabel(m, pricingData);
      const hay = `${m.modelName} ${vendorName} ${m.description}`.toLowerCase();
      return hay.includes(q);
    });

    return [...list].sort((a, b) => {
      if (nameSortMode === 'prefix') {
        return a.modelName.localeCompare(b.modelName, undefined, { numeric: true, sensitivity: 'base' });
      }
      const ka = getModelSortName(a.modelName);
      const kb = getModelSortName(b.modelName);
      const primary = ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' });
      if (primary !== 0) return primary;
      return a.modelName.localeCompare(b.modelName, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [pricingData, search, vendorFilter, quotaFilter, groupFilter, nameSortMode]);

  const shownModels = filteredModels.slice(0, visibleCount);
  const groups = pricingData ? Object.keys(pricingData.groupRatio || {}) : [];

  const handleQuickAddSite = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = validateSiteValues(siteValues, config.sites, null);
    if (!res.ok) {
      setSiteFieldErrors(res.errors);
      return;
    }

    setSiteFieldErrors({});
    const saved = saveSite(res.data);
    setSiteValues(siteToFormValues(null));
    setShowNewSite(false);
    setPlazaSiteId(saved.id);
    showToast(`已添加站点「${saved.name}」`, 'success');
    await refreshSite(saved, true);
  };

  const handleToggleWatch = async (modelName: string, activeGroup: string) => {
    const existing = watchedMap.get(modelName);
    if (existing) {
      const hasCustom = Boolean(existing.alias || (existing.tags && existing.tags.length > 0) || existing.kumaMonitorId);
      if (hasCustom) {
        const ok = await confirmDialog({
          title: '取消关注该模型？',
          message: `「${existing.alias || existing.modelName}」包含自定义备注、标签或监控绑定，取消关注后将移除。`,
          confirmText: '确认取消关注',
          danger: true,
        });
        if (!ok) return;
      }
      if (justFollowedModel === modelName) setJustFollowedModel(null);
      removeWatchWithUndo(existing.id);
      return;
    }

    addWatch(plazaSiteId, modelName, activeGroup || undefined, []);
    setJustFollowedModel(modelName);
  };

  const handleManualAddModel = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualModelInput.trim();
    if (!clean || !plazaSiteId) return;
    addWatch(plazaSiteId, clean, groupFilter || undefined, [], true);
    setManualModelInput('');
    setJustFollowedModel(clean);
  };

  const manualOnlyWatched = useMemo(() => {
    if (!plazaSiteId) return [];
    const listedNames = new Set((pricingData?.models || []).map((m) => m.modelName));
    return config.watched.filter((w) => w.siteId === plazaSiteId && !listedNames.has(w.modelName));
  }, [config.watched, plazaSiteId, pricingData]);

  return (
    <SubpageShell
      open={isOpen}
      title="添加站点与模型"
      subtitle="ADD / 先选定中转站，再挑选模型"
      onClose={() => setActivePanel(null)}
    >
      {/* STEP 1: Site Layer */}
      <div className="subpage-section" style={{ background: 'var(--bg-inset)' }}>
        <div className="step-header">
          <div className="step-badge">
            <span className="step-num">1</span>
            <span>选择或新建中转站 / SITE</span>
          </div>
          {selectedSite && !showNewSite && (
            <button
              type="button"
              className="btn btn-xs"
              disabled={isLoading}
              onClick={() => refreshSite(selectedSite, true)}
              title="刷新该站模型列表"
            >
              <RefreshCw size={11} className={isLoading ? 'spinning' : ''} />
              刷新站点
            </button>
          )}
        </div>

        <div className="site-step-pills">
          {config.sites.map((s) => {
            const active = !showNewSite && plazaSiteId === s.id;
            const err = siteErrors.has(s.id);
            const pData = pricingCache.get(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`pill ${active ? 'active' : ''}`}
                onClick={() => {
                  setShowNewSite(false);
                  setPlazaSiteId(s.id);
                }}
              >
                <span className={`pill-dot ${err ? 'err' : pData ? 'ok' : ''}`} />
                <span>{s.name}</span>
                {pData && <span className="mono" style={{ opacity: 0.75 }}>{pData.models.length}</span>}
              </button>
            );
          })}

          <button
            type="button"
            className={`pill ${showNewSite ? 'active' : ''}`}
            onClick={() => setShowNewSite((v) => !v)}
          >
            <Plus size={12} />
            <span>新建中转站</span>
          </button>
        </div>

        {showNewSite && (
          <form
            onSubmit={handleQuickAddSite}
            noValidate
            style={{
              marginTop: 4,
              padding: 12,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'var(--bg-panel)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <SiteFormFields
              values={siteValues}
              onChange={(patch) => setSiteValues((prev) => ({ ...prev, ...patch }))}
              errors={siteFieldErrors}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm">
                <Check size={13} />
                保存并加载模型
              </button>
              {config.sites.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setShowNewSite(false);
                    setSiteFieldErrors({});
                  }}
                >
                  取消
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* STEP 2: Model Plaza Layer */}
      {config.sites.length === 0 ? (
        <div className="empty-box">
          <h2>先添加一个中转站</h2>
          <p>在上方第一步填写站点名称与地址后，即可在此浏览并挑选该站点的模型。</p>
        </div>
      ) : (
        <>
          <div className="subpage-section" style={{ background: 'var(--bg-panel)', gap: 10 }}>
            <div className="step-header">
              <div className="step-badge">
                <span className="step-num">2</span>
                <span>从「{selectedSite?.name}」挑选模型 / MODELS</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="muted tabular" style={{ fontSize: 11.5 }}>
                  {pricingData ? `匹配 ${filteredModels.length} / ${pricingData.models.length}` : ''}
                </span>
                <div
                  role="group"
                  aria-label="模型名称排序方式"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                    padding: 2,
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-subtle)',
                  }}
                >
                  <button
                    type="button"
                    className={`btn btn-xs ${nameSortMode === 'model' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ height: 22, padding: '0 7px', fontSize: 11 }}
                    onClick={() => {
                      setNameSortMode('model');
                      setVisibleCount(PLAZA_PAGE_SIZE);
                    }}
                    title="忽略开头的 [渠道] 前缀，按模型本体名称排序"
                  >
                    按模型
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${nameSortMode === 'prefix' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ height: 22, padding: '0 7px', fontSize: 11 }}
                    onClick={() => {
                      setNameSortMode('prefix');
                      setVisibleCount(PLAZA_PAGE_SIZE);
                    }}
                    title="保留开头前缀，按完整名称排序"
                  >
                    按前缀
                  </button>
                </div>
                <button
                  type="button"
                  className={`btn btn-xs ${showManualBox ? 'btn-primary' : ''}`}
                  style={{ height: 26 }}
                  onClick={() => setShowManualBox((v) => !v)}
                  title="手动输入任意模型 ID 加入监控"
                >
                  <Plus size={11} />
                  手动添模型
                </button>
              </div>
            </div>

            {showManualBox && (
              <form
                onSubmit={handleManualAddModel}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-inset)',
                }}
              >
                <input
                  type="text"
                  className="input mono"
                  style={{ flex: '1 1 220px', height: 30, fontSize: 12.5 }}
                  value={manualModelInput}
                  onChange={(e) => setManualModelInput(e.target.value)}
                  placeholder="输入模型 ID（如 claude-opus-4-5、gemini-2.5-pro）"
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!manualModelInput.trim()}>
                  <Plus size={12} />
                  关注该模型
                </button>
              </form>
            )}

            {pricingData?.source === 'v1-models' && (
              <div className="muted" style={{ fontSize: 11.5 }}>
                该站未开放公开 /api/pricing，已通过 API Key 自动从 /v1/models 拉取可用模型（无公开标价，可正常关注并实测连通、工具与识图）。
              </div>
            )}

            <div className="plaza-controls">
              <div className="search-box plaza-search-input">
                <Search size={13} className="search-box-icon" />
                <input
                  type="search"
                  className="input"
                  style={{ paddingLeft: 28, height: 32 }}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setVisibleCount(PLAZA_PAGE_SIZE);
                  }}
                  placeholder="搜索模型 ID / 厂商 / 描述..."
                />
              </div>

              <select
                className="select select-sm"
                style={{ width: '100%', height: 32 }}
                value={groupFilter}
                onChange={(e) => {
                  setGroupFilter(e.target.value);
                  setVisibleCount(PLAZA_PAGE_SIZE);
                }}
              >
                <option value="">全部分组</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g} (×{pricingData?.groupRatio[g]})
                  </option>
                ))}
              </select>

              <select
                className="select select-sm"
                style={{ width: '100%', height: 32 }}
                value={quotaFilter}
                onChange={(e) => {
                  setQuotaFilter(e.target.value as 'all' | '0' | '1');
                  setVisibleCount(PLAZA_PAGE_SIZE);
                }}
              >
                <option value="all">全部计费</option>
                <option value="0">按量计费</option>
                <option value="1">按次计费</option>
              </select>

              <button
                type="button"
                className="btn btn-sm"
                style={{ height: 32 }}
                disabled={!selectedSite || isLoading}
                onClick={() => selectedSite && refreshSite(selectedSite, true)}
                title="刷新模型列表"
              >
                <RefreshCw size={13} className={isLoading ? 'spinning' : ''} />
              </button>
            </div>

            {/* Site's Native Vendor / Category Filter Pills */}
            {vendorStats.length > 0 && (
              <div className="vendor-pills">
                <button
                  type="button"
                  className={`pill ${vendorFilter === 'all' ? 'active' : ''}`}
                  onClick={() => {
                    setVendorFilter('all');
                    setVisibleCount(PLAZA_PAGE_SIZE);
                  }}
                >
                  全部厂商 <span className="mono">{pricingData?.models.length || 0}</span>
                </button>
                {vendorStats.map(([vendor, count]) => (
                  <button
                    key={vendor}
                    type="button"
                    className={`pill ${vendorFilter === vendor ? 'active' : ''}`}
                    onClick={() => {
                      setVendorFilter(vendor);
                      setVisibleCount(PLAZA_PAGE_SIZE);
                    }}
                  >
                    {vendor} <span className="mono">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {isLoading && !pricingData ? (
            <div className="subpage-section">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton-line" style={{ height: 32 }} />
              ))}
            </div>
          ) : plazaErr && !pricingData ? (
            <div className="empty-box" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <h2>未获取到公开模型列表</h2>
              <p style={{ maxWidth: 520 }}>{plazaErr}</p>
              <p className="muted" style={{ fontSize: 12, maxWidth: 520 }}>
                {selectedSite?.apiKey
                  ? '该站点未公开 /api/pricing 且未能从 /v1/models 拉取清单，可直接在下方手动输入模型 ID 进行监控与实测。'
                  : '若该站点需要登录或非 New API 站点，可在站点设置补充 API Key 自动拉取 /v1/models，或直接手动输入模型 ID。'}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: 460 }}>
                <form onSubmit={handleManualAddModel} style={{ display: 'flex', gap: 8, flex: 1, minWidth: 260 }}>
                  <input
                    type="text"
                    className="input mono"
                    style={{ flex: 1, height: 32, fontSize: 12.5 }}
                    value={manualModelInput}
                    onChange={(e) => setManualModelInput(e.target.value)}
                    placeholder="手动输入模型 ID（如 claude-opus-4-5）"
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!manualModelInput.trim()}>
                    <Plus size={12} />
                    关注
                  </button>
                </form>
                {selectedSite && !selectedSite.apiKey && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setEditingSiteId(selectedSite.id);
                      setActivePanel('settings');
                    }}
                  >
                    去补填 API Key
                  </button>
                )}
              </div>
            </div>
          ) : shownModels.length === 0 ? (
            <div className="empty-box">
              <h2>暂无匹配模型</h2>
              <p>尝试切换厂商标签、清空搜索词、修改计费过滤，或点击上方「手动添模型」。</p>
            </div>
          ) : (
            <div>
              {shownModels.map((m) => {
                const hasPricing = m.hasPricing !== false;
                const calc = hasPricing
                  ? computeModelPrice(
                      m,
                      pricingData!.groupRatio,
                      groupFilter || undefined,
                      selectedSite?.exchangeRate,
                    )
                  : null;
                const activeGroup = calc?.activeGroup || '';
                const watchedEntry = watchedMap.get(m.modelName);
                const isWatched = Boolean(watchedEntry);
                const vendor = getModelVendorLabel(m, pricingData!);
                const isHovered = hoverUnwatchId === m.modelName;
                const openPickerNow = justFollowedModel === m.modelName;

                return (
                  <div key={m.modelName} className="plaza-row">
                    <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 500, wordBreak: 'break-all' }}>
                        {m.modelName}
                      </div>
                      <div className="muted tabular" style={{ fontSize: 11.5, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span>{vendor}</span>
                        {calc ? (
                          <>
                            <span>分组: {calc.activeGroup}</span>
                            {calc.quotaType === 1 ? (
                              <span>
                                按次 {formatUsd(calc.perCallUsd)}/次
                                {calc.perCallRmb !== null && calc.perCallRmb !== undefined ? ` (≈${formatRmb(calc.perCallRmb)})` : ''}
                              </span>
                            ) : (
                              <span>
                                {calc.isTieredExpr ? '[阶梯] ' : ''}
                                输入 {formatUsd(calc.inputUsd)} · 输出 {formatUsd(calc.outputUsd)} /1M
                                {calc.inputRmb !== null && calc.inputRmb !== undefined
                                  ? ` (≈${formatRmb(calc.inputRmb)}/${formatRmb(calc.outputRmb)})`
                                  : ''}
                              </span>
                            )}
                          </>
                        ) : (
                          <span>无公开标价（支持实测）</span>
                        )}
                      </div>

                      {/* Notion-style Tag Picker appears once the model is followed */}
                      {watchedEntry && (
                        <div style={{ marginTop: 2 }}>
                          <NotionTagPicker
                            watchId={watchedEntry.id}
                            selectedTags={watchedEntry.tags || []}
                            defaultOpen={openPickerNow}
                            onClose={() => {
                              if (justFollowedModel === m.modelName) setJustFollowedModel(null);
                            }}
                            compact
                          />
                        </div>
                      )}
                    </div>

                    {isWatched ? (
                      <button
                        type="button"
                        className={`btn btn-sm ${isHovered ? 'btn-danger' : ''}`}
                        style={{ minWidth: 84, color: isHovered ? undefined : 'var(--green)' }}
                        onMouseEnter={() => setHoverUnwatchId(m.modelName)}
                        onMouseLeave={() => setHoverUnwatchId(null)}
                        onClick={() => handleToggleWatch(m.modelName, activeGroup)}
                      >
                        {isHovered ? '取消关注' : '已关注 ✓'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ minWidth: 84 }}
                        onClick={() => handleToggleWatch(m.modelName, activeGroup)}
                      >
                        + 关注
                      </button>
                    )}
                  </div>
                );
              })}

              {filteredModels.length > shownModels.length && (
                <div style={{ padding: '14px 22px', textAlign: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setVisibleCount((c) => c + PLAZA_PAGE_SIZE)}
                  >
                    加载更多（剩余 {filteredModels.length - shownModels.length} 个）
                  </button>
                </div>
              )}
            </div>
          )}

          {manualOnlyWatched.length > 0 && (
            <div className="subpage-section" style={{ gap: 8 }}>
              <div className="micro-label">MANUAL WATCHLIST / 该站已手动关注的模型 ({manualOnlyWatched.length})</div>
              <div>
                {manualOnlyWatched.map((w) => (
                  <div key={w.id} className="plaza-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 500, wordBreak: 'break-all' }}>
                        {w.modelName}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5 }}>手动添加 · 无公开标价</div>
                      <NotionTagPicker
                        watchId={w.id}
                        selectedTags={w.tags || []}
                        defaultOpen={justFollowedModel === w.modelName}
                        onClose={() => {
                          if (justFollowedModel === w.modelName) setJustFollowedModel(null);
                        }}
                        compact
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => handleToggleWatch(w.modelName, w.group || '')}
                    >
                      取消关注
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </SubpageShell>
  );
};
