import React, { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  GitCompareArrows,
  LayoutGrid,
  List,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { LcdDisplay } from '../components/LcdDisplay';
import { BatchNotionTagPicker, NotionTagPicker } from '../components/NotionTagPicker';
import { useWeathercock } from '../context/WeathercockContext';
import type { KumaMonitor, ListingStatus, MonitorViewMode, SortMode, WatchedModel, WeightedCostMode } from '../types/weathercock';
import { copyToClipboard, formatRelativeTime, formatRmb, formatUsd, padZero } from '../utils/format';
import { computeModelPrice, computeWeightedCost, extractCanonicalModelKey, findKumaMonitor } from '../utils/pricing';

function getEffectiveHealth(
  w: WatchedModel,
  listing: ListingStatus,
  monitor: KumaMonitor | null | undefined,
): { isAlert: boolean; dotCode: string } {
  const probeFailed = w.lastProbe?.ok === false;
  const monitorDown = monitor?.latestStatus === 0 || monitor?.uptime24h === 0;
  const isAlert =
    listing.code === 'delisted' || listing.code === 'error' || probeFailed || monitorDown;

  if (listing.code === 'loading') return { isAlert: false, dotCode: 'loading' };
  if (isAlert) return { isAlert: true, dotCode: 'error' };
  if (listing.code === 'online' || (listing.code === 'manual' && w.lastProbe?.ok)) {
    return { isAlert: false, dotCode: 'online' };
  }
  return { isAlert: false, dotCode: '' };
}

export const MonitorPage: React.FC = () => {
  const {
    config,
    activeSiteFilter,
    setActiveSiteFilter,
    setActivePanel,
    inspectedWatchId,
    setInspectedWatchId,
    pricingCache,
    kumaCache,
    siteErrors,
    loadingSiteIds,
    lastRefreshAt,
    lastRefreshWasLive,
    tickNow,
    getListingStatus,
    setUiFilter,
    refreshAllSites,
    updateWatch,
    removeWatchWithUndo,
    batchRemoveWatchesWithUndo,
    confirmDialog,
    showToast,
  } = useWeathercock();

  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Keep selectedIds pruned when watched items change
  useEffect(() => {
    const valid = new Set(config.watched.map((w) => w.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [config.watched]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of config.watched) {
      for (const t of w.tags || []) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [config.watched]);

  const kpi = useMemo(() => {
    let online = 0;
    let alert = 0;
    let uptimeSum = 0;
    let uptimeCount = 0;

    for (const w of config.watched) {
      const st = getListingStatus(w);
      const kuma = kumaCache.get(w.siteId);
      const mon = findKumaMonitor(w, kuma);
      const health = getEffectiveHealth(w, st, mon?.monitor);

      if (health.isAlert) alert++;
      else if (st.code === 'online' || (st.code === 'manual' && w.lastProbe?.ok)) online++;

      if (mon?.monitor.uptime24h !== null && mon?.monitor.uptime24h !== undefined) {
        uptimeSum += mon.monitor.uptime24h;
        uptimeCount++;
      }
    }

    const avgUptimeValue = uptimeCount > 0 ? ((uptimeSum / uptimeCount) * 100).toFixed(1) : '--';
    return {
      total: config.watched.length,
      online,
      alert,
      avgUptimeValue,
      hasUptime: uptimeCount > 0,
      uptimeCount,
    };
  }, [config.watched, getListingStatus, kumaCache]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = config.watched.filter((w) => {
      if (activeSiteFilter !== 'all' && w.siteId !== activeSiteFilter) return false;
      if (config.ui.activeTag !== 'all' && !(w.tags || []).includes(config.ui.activeTag)) return false;
      if (!q) return true;
      const site = config.sites.find((s) => s.id === w.siteId);
      const hay = [w.modelName, w.alias || '', site?.name || '', ...(w.tags || [])].join(' ').toLowerCase();
      return hay.includes(q);
    });

    const sortMode = config.ui.sort || 'default';
    if (sortMode === 'default') return list;

    return [...list].sort((a, b) => {
      const getMetrics = (w: WatchedModel) => {
        const site = config.sites.find((s) => s.id === w.siteId);
        const pData = pricingCache.get(w.siteId);
        const model = pData?.models.find((m) => m.modelName === w.modelName);
        const calc =
          model && pData && model.hasPricing !== false
            ? computeModelPrice(model, pData.groupRatio, w.group, site?.exchangeRate)
            : null;
        const mon = findKumaMonitor(w, kumaCache.get(w.siteId));
        return {
          siteName: site?.name || '',
          name: (w.alias || w.modelName || '').toLowerCase(),
          price: calc ? calc.sortPriceUsd : Number.POSITIVE_INFINITY,
          uptime: mon?.monitor.uptime24h ?? -1,
        };
      };
      const ma = getMetrics(a);
      const mb = getMetrics(b);
      if (sortMode === 'price-asc') return ma.price - mb.price;
      if (sortMode === 'price-desc') {
        const pa = Number.isFinite(ma.price) ? ma.price : -1;
        const pb = Number.isFinite(mb.price) ? mb.price : -1;
        return pb - pa;
      }
      if (sortMode === 'uptime-desc') return mb.uptime - ma.uptime;
      if (sortMode === 'site') return ma.siteName.localeCompare(mb.siteName) || ma.name.localeCompare(mb.name);
      if (sortMode === 'name') return ma.name.localeCompare(mb.name);
      return 0;
    });
  }, [config.watched, config.sites, config.ui.activeTag, config.ui.sort, activeSiteFilter, search, pricingCache, kumaCache]);

  const compareGroups = useMemo(() => {
    const map = new Map<string, WatchedModel[]>();
    for (const w of filteredItems) {
      const key = extractCanonicalModelKey(w.modelName);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(w);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [filteredItems]);

  const monitorMode: MonitorViewMode =
    config.ui.view === 'cards' || config.ui.view === 'compare' ? config.ui.view : 'list';
  const weightedMode: WeightedCostMode = config.ui.weightedMode || 'none';

  const isRefreshing = loadingSiteIds.size > 0;
  const hasErrors = siteErrors.size > 0;
  const isInitialLoading =
    config.watched.length > 0 && pricingCache.size === 0 && siteErrors.size === 0 && isRefreshing;
  const lastSyncLabel = tickNow ? formatRelativeTime(lastRefreshAt) : formatRelativeTime(lastRefreshAt);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((w) => selectedIds.has(w.id));
  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((w) => w.id)));
    }
  };

  const showBatchBar = selectedIds.size > 0;

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = await confirmDialog({
      title: `批量移除 ${ids.length} 个关注模型？`,
      message: '移除后可通过底部提示条一键撤销恢复。',
      confirmText: '确认移除',
      danger: true,
    });
    if (!ok) return;
    batchRemoveWatchesWithUndo(ids);
    setSelectedIds(new Set());
  };

  return (
    <div>
      {/* LCD Telemetry Dashboard */}
      <section className="lcd-dashboard" aria-label="状态仪表盘">
        <div className="kpi-strip">
          <div className="kpi-cell">
            <span className="micro-label">监控模型 / MODELS</span>
            <LcdDisplay value={padZero(kpi.total)} />
            <span className="kpi-sub">覆盖 {config.sites.length} 个中转站</span>
          </div>
          <div className="kpi-cell">
            <span className="micro-label">连接正常 / ONLINE</span>
            <LcdDisplay value={padZero(kpi.online)} />
            <span className="kpi-sub">广场在架可调用</span>
          </div>
          <div className="kpi-cell">
            <span className="micro-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {kpi.alert > 0 && <span className="status-dot error" />}
              异常或下架 / ALERT
            </span>
            <LcdDisplay value={padZero(kpi.alert)} />
            <span className="kpi-sub">{kpi.alert > 0 ? '建议检查站点或模型状态' : '当前无异常项'}</span>
          </div>
          <div className="kpi-cell">
            <span className="micro-label">24H 均值 / AVG UPTIME</span>
            <LcdDisplay value={kpi.avgUptimeValue} suffix={kpi.hasUptime ? '%' : undefined} />
            <span className="kpi-sub">
              {kpi.uptimeCount > 0 ? `基于 ${kpi.uptimeCount} 条公开监控` : '配置状态页或原生监控后显示'}
            </span>
          </div>
        </div>

        {/* Integrated Telemetry Strip inside LCD Bezel */}
        <div className="lcd-telemetry-strip">
          <div className="telemetry-left">
            <span
              className={`pulse-dot ${isRefreshing ? 'syncing' : hasErrors ? 'error' : config.sites.length > 0 ? 'active' : ''}`}
            />
            <span className="micro-label">
              {isRefreshing
                ? 'SYNCING...'
                : hasErrors
                  ? `ALERT / ${siteErrors.size} SITE(S) ERROR`
                  : config.sites.length > 0
                    ? 'MONITORING ACTIVE'
                    : 'STANDBY / NO SITES'}
            </span>
          </div>

          <div className="telemetry-right">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.ui.autoRefresh}
                onChange={(e) => setUiFilter({ autoRefresh: e.target.checked })}
              />
              <span className="micro-label">AUTO / {config.ui.autoRefresh ? '300S' : 'OFF'}</span>
            </label>
            <span className="micro-label">
              SYNC / {lastSyncLabel}
              {lastRefreshAt ? (lastRefreshWasLive ? ' · LIVE' : ' · CACHED') : ''}
            </span>
          </div>
        </div>
      </section>

      {/* Site Error Alert */}
      {siteErrors.size > 0 && (
        <div className="banner-strip error" role="alert">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {Array.from(siteErrors.entries()).map(([siteId, msg]) => {
              const s = config.sites.find((x) => x.id === siteId);
              return (
                <div key={siteId}>
                  <strong>{s?.name || siteId}</strong>：{msg}
                </div>
              );
            })}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => refreshAllSites(true, false)}>
            重试
          </button>
        </div>
      )}

      {/* Main Model List Filter & Controls */}
      {config.sites.length > 0 && (
        <section className="filter-strip">
          <div className="filter-pills">
            {config.sites.length > 1 && (
              <>
                <button
                  type="button"
                  className={`pill ${activeSiteFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveSiteFilter('all')}
                >
                  全部站点
                </button>
                {config.sites.map((s) => {
                  const hasErr = siteErrors.has(s.id);
                  const isLoading = loadingSiteIds.has(s.id);
                  const isOk = pricingCache.has(s.id) && !hasErr;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`pill ${activeSiteFilter === s.id ? 'active' : ''}`}
                      onClick={() => setActiveSiteFilter(s.id)}
                    >
                      <span className={`pill-dot ${isLoading ? 'loading' : hasErr ? 'err' : isOk ? 'ok' : ''}`} />
                      {s.name}
                    </button>
                  );
                })}
              </>
            )}

            {allTags.length > 0 && (
              <>
                {config.sites.length > 1 && <span className="muted" style={{ margin: '0 2px' }}>|</span>}
                <button
                  type="button"
                  className={`pill ${config.ui.activeTag === 'all' ? 'active' : ''}`}
                  onClick={() => setUiFilter({ activeTag: 'all' })}
                >
                  全部 <span className="mono">{config.watched.length}</span>
                </button>
                {allTags.map(([tag, count]) => (
                  <button
                    key={tag}
                    type="button"
                    className={`pill ${config.ui.activeTag === tag ? 'active' : ''}`}
                    onClick={() => setUiFilter({ activeTag: tag })}
                  >
                    {tag} <span className="mono">{count}</span>
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="filter-controls">
            <div className="search-box">
              <Search size={13} className="search-box-icon" />
              <input
                type="search"
                className="input input-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="筛选模型 / 标签 / 站点"
                aria-label="筛选模型"
              />
            </div>

            <select
              className="select select-sm sort-select-fixed"
              value={config.ui.sort}
              disabled={monitorMode === 'compare'}
              onChange={(e) => setUiFilter({ sort: e.target.value as SortMode })}
              aria-label="排序方式"
              title={monitorMode === 'compare' ? '比价视图组内固定按价格升序' : '排序方式'}
            >
              <option value="default">默认排序</option>
              <option value="name">名称 A → Z</option>
              <option value="uptime-desc">健康度高 → 低</option>
              <option value="price-asc">价格低 → 高</option>
              <option value="price-desc">价格高 → 低</option>
              <option value="site">按站点分组</option>
            </select>

            <div className="segmented" role="group" aria-label="视图模式">
              <button
                type="button"
                className={`segmented-btn ${monitorMode === 'list' ? 'active' : ''}`}
                onClick={() => setUiFilter({ view: 'list' })}
                title="列表视图"
                aria-label="列表视图"
              >
                <List size={13} />
              </button>
              <button
                type="button"
                className={`segmented-btn ${monitorMode === 'cards' ? 'active' : ''}`}
                onClick={() => setUiFilter({ view: 'cards' })}
                title="卡片视图"
                aria-label="卡片视图"
              >
                <LayoutGrid size={13} />
              </button>
              <button
                type="button"
                className={`segmented-btn ${monitorMode === 'compare' ? 'active' : ''}`}
                onClick={() => setUiFilter({ view: 'compare' })}
                title="跨站比价视图"
                aria-label="跨站比价视图"
              >
                <GitCompareArrows size={13} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Batch Management Action Bar */}
      {showBatchBar && config.watched.length > 0 && monitorMode !== 'compare' && (
        <div className="batch-toolbar">
          <div className="batch-toolbar-left">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAllFiltered}
              />
              <span>全选当前 ({filteredItems.length})</span>
            </label>
            <span className="muted">·</span>
            <span>已选 <strong>{selectedIds.size}</strong> 项</span>
          </div>

          <div className="batch-toolbar-right">
            <BatchNotionTagPicker selectedIds={Array.from(selectedIds)} />
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={selectedIds.size === 0}
              onClick={handleBatchDelete}
            >
              <Trash2 size={12} />
              批量删除
            </button>
            <button
              type="button"
              className="icon-btn"
              title="取消多选"
              onClick={() => setSelectedIds(new Set())}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Main Model Content */}
      {config.sites.length === 0 ? (
        <div className="empty-box view-animate">
          <h2>欢迎使用风见鸡 · Weathercock</h2>
          <p>点击右上角「+」添加你的第一个 New API 中转站并挑选常用模型，即可开始实时监控与比价。</p>
          <button type="button" className="btn btn-primary" onClick={() => setActivePanel('add')}>
            <Plus size={14} />
            添加站点与模型
          </button>
        </div>
      ) : config.watched.length === 0 ? (
        <div className="empty-box view-animate">
          <h2>尚未添加关注模型</h2>
          <p>已配置 {config.sites.length} 个中转站。点击下方按钮从模型广场挑选常用模型加入列表。</p>
          <button type="button" className="btn btn-primary" onClick={() => setActivePanel('add')}>
            <Plus size={14} />
            挑选模型
          </button>
        </div>
      ) : isInitialLoading ? (
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-line" style={{ height: 38 }} />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="empty-box view-animate">
          <h2>没有匹配的模型</h2>
          <p>当前站点、标签或搜索词过滤掉了所有关注模型。</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setSearch('');
              setActiveSiteFilter('all');
              setUiFilter({ activeTag: 'all' });
            }}
          >
            清除筛选条件
          </button>
        </div>
      ) : monitorMode === 'list' ? (
        <div key="view-list" className={`view-animate ${selectedIds.size > 0 ? 'batch-active' : ''}`}>
          <div className="inst-table-head">
            <div className="row-check-cell">
              <input
                type="checkbox"
                className="row-checkbox"
                aria-label="全选当前列表"
                checked={allFilteredSelected}
                onChange={toggleSelectAllFiltered}
              />
            </div>
            <span className="micro-label">MODEL</span>
            <span className="micro-label">PRICING</span>
            <span className="micro-label">UPTIME</span>
            <span className="micro-label" style={{ textAlign: 'right' }}>LATENCY</span>
            <span className="micro-label" />
          </div>
          <div>
            {filteredItems.map((w) => {
              const site = config.sites.find((s) => s.id === w.siteId);
              const listing = getListingStatus(w);
              const calc =
                listing.model && listing.pricing && listing.model.hasPricing !== false
                  ? computeModelPrice(listing.model, listing.pricing.groupRatio, w.group, site?.exchangeRate)
                  : null;
              const kumaMatch = findKumaMonitor(w, kumaCache.get(w.siteId));
              const health = getEffectiveHealth(w, listing, kumaMatch?.monitor);
              const uptime = kumaMatch?.monitor.uptime24h ?? null;
              const uptimePct = uptime !== null ? Number((uptime * 100).toFixed(1)) : null;
              const uptimeBarClass =
                uptimePct === null ? '' : uptimePct >= 99 ? 'ok' : uptimePct >= 90 ? 'warn' : 'bad';
              const latency = w.lastProbe?.latencyMs ?? kumaMatch?.monitor.latestPing ?? null;
              const isChecked = selectedIds.has(w.id);

              const groups =
                listing.model && listing.model.enableGroups.length > 0
                  ? listing.model.enableGroups
                  : calc
                    ? [calc.activeGroup]
                    : [];

              return (
                <div
                  key={w.id}
                  className={`inst-row ${inspectedWatchId === w.id || isChecked ? 'selected' : ''}`}
                  onClick={() => {
                    if (selectedIds.size > 0) toggleSelect(w.id);
                    else setInspectedWatchId(w.id);
                  }}
                >
                  <div className="row-check-cell" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      aria-label={`选择 ${w.alias || w.modelName}`}
                      checked={isChecked}
                      onChange={() => toggleSelect(w.id)}
                    />
                  </div>

                  <div className="inst-row-main">
                    <div className="inst-model-title">
                      <span className={`status-dot ${health.dotCode}`} title={health.isAlert ? '异常或失败' : listing.label} />
                      <span className="inst-model-name">{w.alias || w.modelName}</span>
                    </div>
                    <div className="inst-model-sub">
                      <span>{site?.name || '未知站点'}</span>
                      <span>·</span>
                      <span className="mono">{w.alias ? w.modelName : calc ? (calc.quotaType === 1 ? '按次' : '按量') : '无标价'}</span>
                      {listing.code === 'manual' && <span className="muted">· 手动</span>}
                      {listing.code === 'delisted' && <span style={{ color: 'var(--red)' }}>· 已下架</span>}
                      {listing.code === 'error' && <span style={{ color: 'var(--red)' }}>· 站点异常</span>}
                      <NotionTagPicker watchId={w.id} selectedTags={w.tags || []} inlinePlusOnly />
                    </div>
                  </div>

                  <div className="col-pricing price-cell" onClick={(e) => e.stopPropagation()}>
                    {calc ? (
                      <>
                        {calc.quotaType === 1 ? (
                          <div className="price-main">
                            {formatUsd(calc.perCallUsd)}
                            <span className="muted">/次</span>
                            {calc.perCallRmb !== null && calc.perCallRmb !== undefined && (
                              <span className="muted" style={{ marginLeft: 6, fontSize: 11.5 }}>
                                {formatRmb(calc.perCallRmb)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="price-main">
                            {formatUsd(calc.inputUsd)} <span className="muted">/</span> {formatUsd(calc.outputUsd)}
                            <span className="muted" style={{ fontSize: 11 }}> /1M</span>
                            {calc.inputRmb !== null && calc.inputRmb !== undefined && (
                              <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                                {formatRmb(calc.inputRmb)}/{formatRmb(calc.outputRmb)}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="price-sub">
                          {groups.length > 1 ? (
                            <select
                              className="group-inline-select"
                              aria-label="切换计费分组"
                              value={calc.activeGroup}
                              onChange={(e) => updateWatch(w.id, { group: e.target.value })}
                            >
                              {groups.map((g) => {
                                const r = listing.pricing?.groupRatio?.[g];
                                return (
                                  <option key={g} value={g}>
                                    {g}
                                    {Number.isFinite(r) ? ` ×${r}` : ''}
                                  </option>
                                );
                              })}
                            </select>
                          ) : groups.length === 1 ? (
                            <span className="mono muted" style={{ fontSize: 11 }}>
                              {calc.activeGroup}
                              {Number.isFinite(calc.groupRatio) ? ` ×${calc.groupRatio}` : ''}
                            </span>
                          ) : null}
                          {calc.isTieredExpr && <span style={{ color: 'var(--amber)' }}>阶梯基础</span>}
                        </div>
                      </>
                    ) : (
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {listing.code === 'manual' || listing.model?.hasPricing === false ? '无公开标价' : '—'}
                      </span>
                    )}
                  </div>

                  <div className="col-uptime metric-bar-wrap">
                    <div className="metric-bar-val">
                      <span>{uptimePct !== null ? `${uptimePct.toFixed(1)}%` : '—'}</span>
                    </div>
                    <div className="metric-track">
                      <div
                        className={`metric-fill ${uptimeBarClass}`}
                        style={{ width: `${uptimePct !== null ? Math.min(100, Math.max(0, uptimePct)) : 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="col-latency latency-cell">
                    {w.lastProbe?.supportsTools === true && <span className="tool-badge yes" title="支持工具调用">T✓</span>}
                    {w.lastProbe?.supportsTools === false && <span className="tool-badge no" title="不支持工具调用">T✗</span>}
                    {w.lastProbe?.supportsVision === true && <span className="tool-badge yes" title="支持识图">V✓</span>}
                    {w.lastProbe?.supportsVision === false && <span className="tool-badge no" title="未识别图片">V✗</span>}
                    {w.lastProbe && !w.lastProbe.ok ? (
                      <span style={{ color: 'var(--red)', fontSize: 12 }}>失败</span>
                    ) : latency !== null ? (
                      <span>{latency} ms</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>

                  <div className="col-actions row-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-btn"
                      title="复制模型 ID"
                      onClick={async () => {
                        const ok = await copyToClipboard(w.modelName);
                        showToast(ok ? `已复制 ${w.modelName}` : '复制失败', ok ? 'success' : 'error');
                      }}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="取消关注"
                      onClick={() => removeWatchWithUndo(w.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : monitorMode === 'cards' ? (
        <div key="view-cards" className={`cards-grid view-animate ${selectedIds.size > 0 ? 'batch-active' : ''}`}>
          {filteredItems.map((w) => {
            const site = config.sites.find((s) => s.id === w.siteId);
            const listing = getListingStatus(w);
            const calc =
              listing.model && listing.pricing && listing.model.hasPricing !== false
                ? computeModelPrice(listing.model, listing.pricing.groupRatio, w.group, site?.exchangeRate)
                : null;
            const kumaMatch = findKumaMonitor(w, kumaCache.get(w.siteId));
            const health = getEffectiveHealth(w, listing, kumaMatch?.monitor);
            const uptimePct =
              kumaMatch?.monitor.uptime24h !== null && kumaMatch?.monitor.uptime24h !== undefined
                ? Number((kumaMatch.monitor.uptime24h * 100).toFixed(1))
                : null;
            const uptimeBarClass =
              uptimePct === null ? '' : uptimePct >= 99 ? 'ok' : uptimePct >= 90 ? 'warn' : 'bad';
            const latency = w.lastProbe?.latencyMs ?? kumaMatch?.monitor.latestPing ?? null;
            const isChecked = selectedIds.has(w.id);

            return (
              <article
                key={w.id}
                className={`inst-card ${isChecked ? 'selected' : ''}`}
                onClick={() => {
                  if (selectedIds.size > 0) toggleSelect(w.id);
                  else setInspectedWatchId(w.id);
                }}
              >
                <div className="inst-card-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <input
                        type="checkbox"
                        className="row-checkbox"
                        aria-label={`选择 ${w.alias || w.modelName}`}
                        checked={isChecked}
                        onChange={() => toggleSelect(w.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className={`status-dot ${health.dotCode}`} />
                      <strong style={{ fontSize: 14, fontWeight: 500, wordBreak: 'break-all' }}>
                        {w.alias || w.modelName}
                      </strong>
                    </div>
                    <div className="muted mono" style={{ fontSize: 11, paddingLeft: 14, marginTop: 2 }}>
                      {site?.name || '未知站点'}
                      {w.alias ? ` · ${w.modelName}` : ''}
                    </div>
                    <div style={{ paddingLeft: 14, marginTop: 6 }}>
                      <NotionTagPicker watchId={w.id} selectedTags={w.tags || []} inlinePlusOnly />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-btn"
                      title="复制模型 ID"
                      onClick={async () => {
                        const ok = await copyToClipboard(w.modelName);
                        showToast(ok ? `已复制 ${w.modelName}` : '复制失败', ok ? 'success' : 'error');
                      }}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="取消关注"
                      onClick={() => removeWatchWithUndo(w.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="inst-card-price">
                  {calc ? (
                    calc.quotaType === 1 ? (
                      <div>
                        <span className="inst-card-price-num">{formatUsd(calc.perCallUsd)}</span>
                        <span className="muted" style={{ fontSize: 12 }}> /次</span>
                        {calc.perCallRmb !== null && calc.perCallRmb !== undefined && (
                          <div className="muted tabular" style={{ fontSize: 11.5 }}>
                            ≈ {formatRmb(calc.perCallRmb)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="micro-label">INPUT</div>
                          <span className="inst-card-price-num">{formatUsd(calc.inputUsd)}</span>
                          {calc.inputRmb !== null && calc.inputRmb !== undefined && (
                            <div className="muted tabular" style={{ fontSize: 11 }}>{formatRmb(calc.inputRmb)}</div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="micro-label">OUTPUT</div>
                          <span className="inst-card-price-num">{formatUsd(calc.outputUsd)}</span>
                          {calc.outputRmb !== null && calc.outputRmb !== undefined && (
                            <div className="muted tabular" style={{ fontSize: 11 }}>{formatRmb(calc.outputRmb)}</div>
                          )}
                        </div>
                      </>
                    )
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {listing.code === 'delisted'
                        ? '模型广场已下架'
                        : listing.code === 'manual' || listing.model?.hasPricing === false
                          ? '无公开标价（支持实测）'
                          : listing.error || '暂无资费'}
                    </span>
                  )}
                </div>

                <div className="inst-card-telemetry">
                  <div className="metric-bar-wrap">
                    <div className="metric-bar-val" style={{ fontSize: 12 }}>
                      <span className="micro-label">UPTIME</span>
                      <span>{uptimePct !== null ? `${uptimePct.toFixed(1)}%` : '—'}</span>
                    </div>
                    <div className="metric-track">
                      <div
                        className={`metric-fill ${uptimeBarClass}`}
                        style={{ width: `${uptimePct !== null ? Math.min(100, Math.max(0, uptimePct)) : 0}%` }}
                      />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="micro-label">LATENCY</div>
                    <div className="tabular" style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {w.lastProbe?.supportsTools === true && <span className="tool-badge yes" title="支持工具调用">T✓</span>}
                      {w.lastProbe?.supportsTools === false && <span className="tool-badge no" title="不支持工具调用">T✗</span>}
                      {w.lastProbe?.supportsVision === true && <span className="tool-badge yes" title="支持识图">V✓</span>}
                      {w.lastProbe?.supportsVision === false && <span className="tool-badge no" title="未识别图片">V✗</span>}
                      {w.lastProbe && !w.lastProbe.ok ? (
                        <span style={{ color: 'var(--red)' }}>失败</span>
                      ) : latency !== null ? (
                        `${latency} ms`
                      ) : (
                        '—'
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        /* Compare Matrix View */
        <div key="view-compare" className="view-animate">
          <div className="compare-subbar">
            <span className="micro-label">COMPARE / 同模型跨站比价归并 ({compareGroups.length} 组)</span>
            <select
              className="select select-sm"
              value={weightedMode}
              onChange={(e) => setUiFilter({ weightedMode: e.target.value as WeightedCostMode })}
              aria-label="成本估算比例"
            >
              <option value="none">按输入单价排序</option>
              <option value="3:1">按 3:1 输入/输出估算</option>
              <option value="1:1">按 1:1 输入/输出估算</option>
              <option value="1:3">按 1:3 输入/输出估算</option>
            </select>
          </div>

          {compareGroups.map(([canonicalKey, list]) => {
            const enriched = list.map((w) => {
              const site = config.sites.find((s) => s.id === w.siteId);
              const listing = getListingStatus(w);
              const calc =
                listing.model && listing.pricing && listing.model.hasPricing !== false
                  ? computeModelPrice(listing.model, listing.pricing.groupRatio, w.group, site?.exchangeRate)
                  : null;
              const weighted = calc ? computeWeightedCost(calc, weightedMode) : null;
              const compareCost = weighted ? weighted.usd : calc?.sortPriceUsd ?? Number.POSITIVE_INFINITY;
              const kumaMatch = findKumaMonitor(w, kumaCache.get(w.siteId));
              const health = getEffectiveHealth(w, listing, kumaMatch?.monitor);
              const uptime = kumaMatch?.monitor.uptime24h ?? null;
              const latency = w.lastProbe?.latencyMs ?? kumaMatch?.monitor.latestPing ?? null;
              return { w, site, listing, health, calc, weighted, compareCost, uptime, latency };
            });

            enriched.sort((a, b) => a.compareCost - b.compareCost);

            const validCosts = enriched.filter((e) => Number.isFinite(e.compareCost)).map((e) => e.compareCost);
            const minCost = validCosts.length >= 2 ? Math.min(...validCosts) : null;
            const maxCost = validCosts.length >= 2 ? Math.max(...validCosts) : null;
            const spreadText =
              minCost !== null && maxCost !== null && minCost > 0 && maxCost > minCost
                ? `差价 ${(maxCost / minCost).toFixed(1)}×`
                : null;

            const validUptimes = enriched.filter((e) => e.uptime !== null).map((e) => e.uptime!);
            const maxUptime = validUptimes.length >= 2 ? Math.max(...validUptimes) : null;

            return (
              <section key={canonicalKey} className="compare-group">
                <div className="compare-group-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="mono" style={{ fontWeight: 500, fontSize: 13.5 }}>
                      {canonicalKey}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {enriched.length} 个渠道
                    </span>
                  </div>
                  {spreadText && <span className="badge-tag">{spreadText}</span>}
                </div>

                <div>
                  {enriched.map(({ w, site, listing, health, calc, weighted, compareCost, uptime, latency }) => {
                    const isCheapest =
                      minCost !== null && Number.isFinite(compareCost) && Math.abs(compareCost - minCost) < 1e-9;
                    const isMostStable =
                      maxUptime !== null && uptime !== null && maxUptime > 0 && Math.abs(uptime - maxUptime) < 1e-6;
                    const barRatio =
                      maxCost && maxCost > 0 && Number.isFinite(compareCost)
                        ? Math.max(8, Math.min(100, Math.round((compareCost / maxCost) * 100)))
                        : 0;

                    return (
                      <div key={w.id} className="compare-row" onClick={() => setInspectedWatchId(w.id)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className={`status-dot ${health.dotCode}`} />
                          <strong style={{ fontWeight: 500, fontSize: 13.5 }}>{site?.name || '未知站点'}</strong>
                          {isCheapest && <span className="badge-tag best">最低价</span>}
                          {isMostStable && <span className="badge-tag">最稳</span>}
                        </div>

                        <div className="mono muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {w.alias ? `${w.alias} (${w.modelName})` : w.modelName}
                        </div>

                        <div className="metric-bar-wrap">
                          {calc ? (
                            <>
                              <div className="metric-bar-val" style={{ fontSize: 12.5 }}>
                                {calc.quotaType === 1 ? (
                                  <span>
                                    {formatUsd(calc.perCallUsd)}/次
                                    {calc.perCallRmb !== null && calc.perCallRmb !== undefined && (
                                      <span className="muted"> · {formatRmb(calc.perCallRmb)}</span>
                                    )}
                                  </span>
                                ) : weighted ? (
                                  <span>
                                    均价 {formatUsd(weighted.usd)}/1M
                                    {weighted.rmb !== null && <span className="muted"> · {formatRmb(weighted.rmb)}</span>}
                                  </span>
                                ) : (
                                  <span>
                                    {formatUsd(calc.inputUsd)} / {formatUsd(calc.outputUsd)}
                                    {calc.inputRmb !== null && calc.inputRmb !== undefined && (
                                      <span className="muted"> · {formatRmb(calc.inputRmb)}/{formatRmb(calc.outputRmb)}</span>
                                    )}
                                  </span>
                                )}
                              </div>
                              {maxCost !== null && (
                                <div className="metric-track">
                                  <div
                                    className={`metric-fill ${isCheapest ? 'ok' : ''}`}
                                    style={{ width: `${barRatio}%` }}
                                  />
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </div>

                        <div className="tabular" style={{ fontSize: 12.5 }}>
                          {uptime !== null ? `24h ${(uptime * 100).toFixed(1)}%` : <span className="muted">—</span>}
                        </div>

                        <div className="tabular" style={{ textAlign: 'right', fontSize: 12.5 }}>
                          {w.lastProbe && !w.lastProbe.ok ? (
                            <span style={{ color: 'var(--red)' }}>失败</span>
                          ) : latency !== null ? (
                            `${latency} ms`
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
