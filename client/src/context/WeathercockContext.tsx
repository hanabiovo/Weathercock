import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConfirmOptions,
  KumaData,
  ListingStatus,
  MonitorViewMode,
  PricingData,
  ProbeMode,
  ProbeRecord,
  SecondaryPanel,
  SiteConfig,
  SortMode,
  ToastItem,
  WatchedModel,
  WeathercockConfig,
  WeightedCostMode,
} from '../types/weathercock';
import {
  apiFetchHealth,
  apiFetchKuma,
  apiFetchNativeUptime,
  apiFetchPricing,
  apiFetchV1Models,
  apiProbeModel,
} from '../utils/api';
import { uid } from '../utils/format';
import {
  AUTO_REFRESH_MS,
  ExportPayload,
  loadConfig,
  mergeConfigInto,
  replaceConfigWith,
  saveConfig,
} from '../utils/storage';

interface BatchProgress {
  active: boolean;
  completed: number;
  total: number;
}

interface WeathercockContextValue {
  config: WeathercockConfig;
  activePanel: SecondaryPanel;
  setActivePanel: (panel: SecondaryPanel) => void;
  activeSiteFilter: string;
  setActiveSiteFilter: (siteId: string) => void;
  plazaSiteId: string;
  setPlazaSiteId: (siteId: string) => void;
  inspectedWatchId: string | null;
  setInspectedWatchId: (id: string | null) => void;
  editingSiteId: string | null;
  setEditingSiteId: (id: string | null) => void;

  pricingCache: Map<string, PricingData>;
  kumaCache: Map<string, KumaData>;
  siteErrors: Map<string, string>;
  loadingSiteIds: Set<string>;
  probingIds: Set<string>;

  syncEnabled: boolean;
  lastRefreshAt: number | null;
  lastRefreshWasLive: boolean;
  tickNow: number;
  batchProgress: BatchProgress;
  cancelBatchProbe: () => void;

  toasts: ToastItem[];
  showToast: (
    message: string,
    type?: ToastItem['type'],
    options?: { actionLabel?: string; onAction?: () => void; duration?: number },
  ) => void;
  dismissToast: (id: string) => void;

  confirmState: ConfirmOptions | null;
  confirmDialog: (opts: ConfirmOptions) => Promise<boolean>;
  resolveConfirm: (result: boolean) => void;

  toggleTheme: () => void;
  setUiFilter: (patch: Partial<WeathercockConfig['ui']>) => void;
  getListingStatus: (watchedItem: WatchedModel) => ListingStatus;
  refreshSite: (site: SiteConfig, forceRefresh?: boolean) => Promise<boolean>;
  refreshAllSites: (forceRefresh?: boolean, silent?: boolean) => Promise<void>;
  probeModel: (watchedId: string, mode?: ProbeMode | boolean, silentToast?: boolean) => Promise<boolean>;
  batchProbeModels: (targets: WatchedModel[], mode?: ProbeMode | boolean) => Promise<void>;

  addWatch: (siteId: string, modelName: string, group?: string, tags?: string[], manual?: boolean) => string;
  batchAddWatch: (siteId: string, items: Array<{ modelName: string; group?: string }>, tags: string[]) => number;
  updateWatch: (watchId: string, patch: Partial<WatchedModel>) => void;
  toggleWatchTag: (watchId: string, tag: string) => void;
  removeWatchWithUndo: (watchId: string) => void;
  batchRemoveWatchesWithUndo: (watchIds: string[]) => void;
  batchUpdateWatchTags: (watchIds: string[], tags: string[], mode: 'append' | 'replace') => void;
  batchSetTagPresence: (watchIds: string[], tag: string, present: boolean) => void;

  saveSite: (siteData: Omit<SiteConfig, 'id'> & { id?: string }) => SiteConfig;
  deleteSite: (siteId: string) => void;

  tagCatalog: string[];
  addTagGlobal: (tag: string) => boolean;
  renameTagGlobal: (oldTag: string, newTag: string) => number;
  deleteTagGlobal: (tag: string) => number;

  applyImportedConfig: (payload: ExportPayload, mode: 'merge' | 'replace') => void;
}

const WeathercockContext = createContext<WeathercockContextValue | null>(null);

export const WeathercockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<WeathercockConfig>(() => loadConfig());
  const configRef = useRef(config);
  configRef.current = config;

  const [activePanel, setActivePanel] = useState<SecondaryPanel>(null);
  const [activeSiteFilter, setActiveSiteFilter] = useState<string>('all');
  const [plazaSiteId, setPlazaSiteId] = useState<string>(() => config.sites[0]?.id || '');
  const [inspectedWatchId, setInspectedWatchId] = useState<string | null>(null);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);

  const [pricingCache, setPricingCache] = useState<Map<string, PricingData>>(() => new Map());
  const [kumaCache, setKumaCache] = useState<Map<string, KumaData>>(() => new Map());
  const [siteErrors, setSiteErrors] = useState<Map<string, string>>(() => new Map());
  const [loadingSiteIds, setLoadingSiteIds] = useState<Set<string>>(() => new Set());
  const [probingIds, setProbingIds] = useState<Set<string>>(() => new Set());

  const [syncEnabled, setSyncEnabled] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [lastRefreshWasLive, setLastRefreshWasLive] = useState(false);
  const [tickNow, setTickNow] = useState(() => Date.now());
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({ active: false, completed: 0, total: 0 });
  const batchCancelRef = useRef(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const confirmResolverRef = useRef<((val: boolean) => void) | null>(null);

  const updateConfig = useCallback((updater: (prev: WeathercockConfig) => WeathercockConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      saveConfig(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const theme = config.ui.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.getElementById('meta-theme-color');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#181818' : '#D8D8D8');
    }
  }, [config.ui.theme]);

  useEffect(() => {
    if (config.sites.length === 0) {
      if (plazaSiteId) setPlazaSiteId('');
      if (activeSiteFilter !== 'all') setActiveSiteFilter('all');
      return;
    }
    if (!config.sites.some((s) => s.id === plazaSiteId)) {
      setPlazaSiteId(config.sites[0].id);
    }
    if (activeSiteFilter !== 'all' && !config.sites.some((s) => s.id === activeSiteFilter)) {
      setActiveSiteFilter('all');
    }
  }, [config.sites, plazaSiteId, activeSiteFilter]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (
      message: string,
      type: ToastItem['type'] = 'info',
      options?: { actionLabel?: string; onAction?: () => void; duration?: number },
    ) => {
      const id = uid('toast');
      const item: ToastItem = {
        id,
        message,
        type,
        actionLabel: options?.actionLabel,
        onAction: options?.onAction,
      };
      setToasts((prev) => [...prev.slice(-3), item]);

      const duration = options?.duration ?? (type === 'error' || options?.actionLabel ? 6500 : 3400);
      if (duration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
      }
    },
    [],
  );

  const confirmDialog = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState(opts);
    });
  }, []);

  const resolveConfirm = useCallback((result: boolean) => {
    setConfirmState(null);
    if (confirmResolverRef.current) {
      const fn = confirmResolverRef.current;
      confirmResolverRef.current = null;
      fn(result);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    updateConfig((prev) => ({
      ...prev,
      ui: {
        ...prev.ui,
        theme: prev.ui.theme === 'dark' ? 'light' : 'dark',
      },
    }));
  }, [updateConfig]);

  const setUiFilter = useCallback(
    (patch: Partial<WeathercockConfig['ui']>) => {
      updateConfig((prev) => ({
        ...prev,
        ui: {
          ...prev.ui,
          ...patch,
          view: (patch.view ?? prev.ui.view) as MonitorViewMode,
          sort: (patch.sort ?? prev.ui.sort) as SortMode,
          weightedMode: (patch.weightedMode ?? prev.ui.weightedMode) as WeightedCostMode,
        },
      }));
    },
    [updateConfig],
  );

  const refreshSite = useCallback(async (site: SiteConfig, forceRefresh = false): Promise<boolean> => {
    setLoadingSiteIds((prev) => new Set(prev).add(site.id));
    try {
      const pricingPromise = apiFetchPricing(site.baseUrl, forceRefresh)
        .then((pData) => {
          setPricingCache((prev) => new Map(prev).set(site.id, pData));
          setSiteErrors((prev) => {
            const next = new Map(prev);
            next.delete(site.id);
            return next;
          });
          return true;
        })
        .catch(async (err) => {
          const pricingMsg = err instanceof Error ? err.message : '拉取模型广场失败';
          if (site.apiKey && site.apiKey.trim()) {
            try {
              const v1Data = await apiFetchV1Models(site.baseUrl, site.apiKey);
              setPricingCache((prev) => new Map(prev).set(site.id, v1Data));
              setSiteErrors((prev) => {
                const next = new Map(prev);
                next.delete(site.id);
                return next;
              });
              return true;
            } catch (v1Err) {
              const v1Msg = v1Err instanceof Error ? v1Err.message : '拉取 /v1/models 失败';
              setSiteErrors((prev) => new Map(prev).set(site.id, `${pricingMsg}；尝试 /v1/models 也失败：${v1Msg}`));
              return false;
            }
          }
          setSiteErrors((prev) => new Map(prev).set(site.id, pricingMsg));
          return false;
        });

      const monitorPromise = site.statusUrl
        ? apiFetchKuma(site.statusUrl, forceRefresh)
            .then((kData) => setKumaCache((prev) => new Map(prev).set(site.id, kData)))
            .catch(() => undefined)
        : apiFetchNativeUptime(site.baseUrl, forceRefresh)
            .then((uData) => setKumaCache((prev) => new Map(prev).set(site.id, uData)))
            .catch(() => undefined);

      const [pricingOk] = await Promise.all([pricingPromise, monitorPromise]);
      return pricingOk;
    } finally {
      setLoadingSiteIds((prev) => {
        const next = new Set(prev);
        next.delete(site.id);
        return next;
      });
    }
  }, []);

  const refreshAllSites = useCallback(
    async (forceRefresh = false, silent = false) => {
      const sites = configRef.current.sites;
      if (sites.length === 0) return;

      const results = await Promise.all(sites.map((s) => refreshSite(s, forceRefresh)));
      const failCount = results.filter((ok) => !ok).length;
      setLastRefreshAt(Date.now());
      setLastRefreshWasLive(forceRefresh);

      if (!silent) {
        if (failCount > 0) {
          showToast(`刷新完成，其中 ${failCount} 个站点异常`, 'error');
        } else {
          showToast(forceRefresh ? '已实时同步所有站点资费与渠道状态' : '已同步所有站点状态', 'success');
        }
      }
    },
    [refreshSite, showToast],
  );

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    apiFetchHealth()
      .then((h) => setSyncEnabled(h.syncEnabled))
      .catch(() => {});

    if (configRef.current.sites.length > 0) {
      refreshAllSites(false, true);
    }

    const autoTimer = setInterval(() => {
      if (!configRef.current.ui.autoRefresh) return;
      if (document.visibilityState !== 'visible') return;
      if (configRef.current.sites.length === 0) return;
      refreshAllSites(true, true);
    }, AUTO_REFRESH_MS);

    const tickTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setTickNow(Date.now());
      }
    }, 15000);

    return () => {
      clearInterval(autoTimer);
      clearInterval(tickTimer);
    };
  }, [refreshAllSites]);

  const getListingStatus = useCallback(
    (watchedItem: WatchedModel): ListingStatus => {
      const siteId = watchedItem.siteId;
      const pData = pricingCache.get(siteId);
      if (loadingSiteIds.has(siteId) && !pData) {
        return { code: 'loading', label: '加载中' };
      }
      if (pData) {
        const model = pData.models.find((m) => m.modelName === watchedItem.modelName);
        if (model) {
          return { code: 'online', label: '在架', model, pricing: pData };
        }
        if (watchedItem.manual) {
          return { code: 'manual', label: '手动添加', pricing: pData };
        }
        return { code: 'delisted', label: '已下架', pricing: pData };
      }
      if (watchedItem.manual) {
        return { code: 'manual', label: '手动监控', error: siteErrors.get(siteId) };
      }
      if (siteErrors.has(siteId)) {
        return { code: 'error', label: '站点异常', error: siteErrors.get(siteId) };
      }
      return { code: 'unknown', label: '待刷新' };
    },
    [loadingSiteIds, pricingCache, siteErrors],
  );

  const probeModel = useCallback(
    async (watchedId: string, modeOrTools: ProbeMode | boolean = 'ping', silentToast = false): Promise<boolean> => {
      const mode: ProbeMode = typeof modeOrTools === 'string' ? modeOrTools : modeOrTools ? 'tools' : 'ping';
      const testTools = mode === 'tools';
      const testVision = mode === 'vision';
      const item = configRef.current.watched.find((w) => w.id === watchedId);
      if (!item) return false;
      const site = configRef.current.sites.find((s) => s.id === item.siteId);
      if (!site) return false;

      if (!site.apiKey) {
        const go = await confirmDialog({
          title: '需要配置诊断用 API 密钥',
          message: `「${site.name}」尚未配置诊断密钥。连接诊断会发送极短测试请求以实测延迟、工具调用、识图能力与 token 计数。现在前往诊断控制台填写吗？`,
          confirmText: '打开诊断配置',
        });
        if (go) {
          setActivePanel('diagnostics');
        }
        return false;
      }

      if (probingIds.has(watchedId)) return false;

      setProbingIds((prev) => new Set(prev).add(watchedId));
      try {
        let record: ProbeRecord;
        try {
          record = await apiProbeModel({
            baseUrl: site.baseUrl,
            apiKey: site.apiKey,
            model: item.modelName,
            testTools,
            testVision,
          });
        } catch (err) {
          record = {
            at: Date.now(),
            ok: false,
            httpStatus: 0,
            latencyMs: 0,
            supportsTools: testTools ? false : null,
            supportsVision: testVision ? false : null,
            usage: null,
            error: err instanceof Error ? err.message : '请求失败',
            testedTools: testTools,
            testedVision: testVision,
          };
        }

        updateConfig((prev) => ({
          ...prev,
          watched: prev.watched.map((w) => {
            if (w.id !== watchedId) return w;
            const merged: ProbeRecord = {
              ...record,
              supportsTools: testTools ? record.supportsTools : (w.lastProbe?.supportsTools ?? null),
              supportsVision: testVision ? (record.supportsVision ?? null) : (w.lastProbe?.supportsVision ?? null),
              testedTools: testTools || Boolean(w.lastProbe?.testedTools),
              testedVision: testVision || Boolean(w.lastProbe?.testedVision),
            };
            return { ...w, lastProbe: merged };
          }),
        }));

        if (!silentToast) {
          const label = item.alias || item.modelName;
          if (record.ok) {
            if (testVision) {
              if (record.supportsVision) {
                showToast(`${label} 识图测试通过 (${record.latencyMs}ms)`, 'success');
              } else {
                showToast(`${label} 可连通但未识别图片 (${record.latencyMs}ms)`, 'error');
              }
            } else {
              showToast(`${label} 诊断通过 (${record.latencyMs}ms)`, 'success');
            }
          } else {
            showToast(`${label} 诊断失败：${record.error || '未知错误'}`, 'error');
          }
        }
        return record.ok;
      } finally {
        setProbingIds((prev) => {
          const next = new Set(prev);
          next.delete(watchedId);
          return next;
        });
      }
    },
    [confirmDialog, probingIds, showToast, updateConfig],
  );

  const batchProbeModels = useCallback(
    async (targets: WatchedModel[], modeOrTools: ProbeMode | boolean = 'ping') => {
      const validTargets = targets.filter((w) => {
        const site = configRef.current.sites.find((s) => s.id === w.siteId);
        return site && Boolean(site.apiKey);
      });

      if (validTargets.length === 0) {
        showToast('目标模型所属站点尚未配置诊断密钥，请在诊断面板中补充测试令牌', 'error');
        return;
      }

      batchCancelRef.current = false;
      setBatchProgress({ active: true, completed: 0, total: validTargets.length });

      let completed = 0;
      let okCount = 0;
      const queue = [...validTargets];
      const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
        while (queue.length > 0 && !batchCancelRef.current) {
          const next = queue.shift();
          if (next) {
            const ok = await probeModel(next.id, modeOrTools, true);
            if (ok) okCount++;
            completed++;
            setBatchProgress({ active: true, completed, total: validTargets.length });
          }
        }
      });

      await Promise.all(workers);
      setBatchProgress({ active: false, completed: 0, total: 0 });

      if (batchCancelRef.current) {
        showToast(`已取消批量诊断（已完成 ${completed}/${validTargets.length}，成功 ${okCount} 个）`);
      } else {
        showToast(
          `批量诊断完成：${okCount} 个成功，${validTargets.length - okCount} 个失败`,
          okCount === validTargets.length ? 'success' : 'error',
        );
      }
    },
    [probeModel, showToast],
  );

  const cancelBatchProbe = useCallback(() => {
    batchCancelRef.current = true;
  }, []);

  const addWatch = useCallback(
    (siteId: string, modelName: string, group?: string, tags: string[] = [], manual = false): string => {
      const existing = configRef.current.watched.find((w) => w.siteId === siteId && w.modelName === modelName);
      if (existing) return existing.id;

      const newId = uid('watch');
      updateConfig((prev) => {
        if (prev.watched.some((w) => w.siteId === siteId && w.modelName === modelName)) {
          return prev;
        }
        return {
          ...prev,
          tags: Array.from(new Set([...(prev.tags || []), ...tags])),
          watched: [
            ...prev.watched,
            {
              id: newId,
              siteId,
              modelName,
              group: group || undefined,
              tags,
              manual: manual || undefined,
            },
          ],
        };
      });
      showToast(`已关注 ${modelName}`, 'success');
      return newId;
    },
    [showToast, updateConfig],
  );

  const batchAddWatch = useCallback(
    (siteId: string, items: Array<{ modelName: string; group?: string }>, tags: string[]): number => {
      let added = 0;
      updateConfig((prev) => {
        const existingSet = new Set(prev.watched.filter((w) => w.siteId === siteId).map((w) => w.modelName));
        const newItems: WatchedModel[] = [];
        for (const it of items) {
          if (existingSet.has(it.modelName)) continue;
          existingSet.add(it.modelName);
          newItems.push({
            id: uid('watch'),
            siteId,
            modelName: it.modelName,
            group: it.group || undefined,
            tags: [...tags],
          });
        }
        added = newItems.length;
        if (added === 0) return prev;
        return { ...prev, watched: [...prev.watched, ...newItems] };
      });
      return added;
    },
    [updateConfig],
  );

  const updateWatch = useCallback(
    (watchId: string, patch: Partial<WatchedModel>) => {
      updateConfig((prev) => ({
        ...prev,
        tags: patch.tags ? Array.from(new Set([...(prev.tags || []), ...patch.tags])) : prev.tags,
        watched: prev.watched.map((w) => (w.id === watchId ? { ...w, ...patch } : w)),
      }));
    },
    [updateConfig],
  );

  const toggleWatchTag = useCallback(
    (watchId: string, tag: string) => {
      const clean = tag.trim();
      if (!clean) return;
      updateConfig((prev) => ({
        ...prev,
        tags: Array.from(new Set([...(prev.tags || []), clean])),
        watched: prev.watched.map((w) => {
          if (w.id !== watchId) return w;
          const cur = w.tags || [];
          const has = cur.includes(clean);
          return {
            ...w,
            tags: has ? cur.filter((t) => t !== clean) : [...cur, clean],
          };
        }),
      }));
    },
    [updateConfig],
  );

  const removeWatchWithUndo = useCallback(
    (watchId: string) => {
      const idx = configRef.current.watched.findIndex((w) => w.id === watchId);
      if (idx < 0) return;
      const removed = configRef.current.watched[idx];

      updateConfig((prev) => ({
        ...prev,
        watched: prev.watched.filter((w) => w.id !== watchId),
      }));

      if (inspectedWatchId === watchId) {
        setInspectedWatchId(null);
      }

      showToast(`已取消关注 ${removed.alias || removed.modelName}`, 'info', {
        actionLabel: '撤销',
        onAction: () => {
          updateConfig((prev) => {
            if (prev.watched.some((w) => w.id === removed.id)) return prev;
            const copy = [...prev.watched];
            copy.splice(Math.min(idx, copy.length), 0, removed);
            return { ...prev, watched: copy };
          });
          showToast('已恢复关注项', 'success');
        },
      });
    },
    [inspectedWatchId, showToast, updateConfig],
  );

  const batchRemoveWatchesWithUndo = useCallback(
    (watchIds: string[]) => {
      const idSet = new Set(watchIds);
      if (idSet.size === 0) return;
      const snapshot = configRef.current.watched
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => idSet.has(item.id));
      if (snapshot.length === 0) return;

      updateConfig((prev) => ({
        ...prev,
        watched: prev.watched.filter((w) => !idSet.has(w.id)),
      }));

      if (inspectedWatchId && idSet.has(inspectedWatchId)) {
        setInspectedWatchId(null);
      }

      showToast(`已移除 ${snapshot.length} 个关注模型`, 'info', {
        actionLabel: '撤销',
        onAction: () => {
          updateConfig((prev) => {
            const existingIds = new Set(prev.watched.map((w) => w.id));
            const copy = [...prev.watched];
            for (const { item, idx } of snapshot) {
              if (!existingIds.has(item.id)) {
                copy.splice(Math.min(idx, copy.length), 0, item);
                existingIds.add(item.id);
              }
            }
            return { ...prev, watched: copy };
          });
          showToast(`已恢复 ${snapshot.length} 个关注模型`, 'success');
        },
      });
    },
    [inspectedWatchId, showToast, updateConfig],
  );

  const batchUpdateWatchTags = useCallback(
    (watchIds: string[], tags: string[], mode: 'append' | 'replace') => {
      const idSet = new Set(watchIds);
      if (idSet.size === 0) return;
      updateConfig((prev) => ({
        ...prev,
        tags: Array.from(new Set([...(prev.tags || []), ...tags])),
        watched: prev.watched.map((w) => {
          if (!idSet.has(w.id)) return w;
          const nextTags =
            mode === 'replace' ? [...tags] : Array.from(new Set([...(w.tags || []), ...tags]));
          return { ...w, tags: nextTags };
        }),
      }));
      showToast(
        mode === 'replace'
          ? `已更新 ${idSet.size} 个模型的标签`
          : `已为 ${idSet.size} 个模型追加标签`,
        'success',
      );
    },
    [showToast, updateConfig],
  );

  const batchSetTagPresence = useCallback(
    (watchIds: string[], rawTag: string, present: boolean) => {
      const clean = rawTag.trim();
      const idSet = new Set(watchIds);
      if (!clean || idSet.size === 0) return;
      updateConfig((prev) => ({
        ...prev,
        tags: present ? Array.from(new Set([...(prev.tags || []), clean])) : prev.tags,
        watched: prev.watched.map((w) => {
          if (!idSet.has(w.id)) return w;
          const cur = w.tags || [];
          const nextTags = present
            ? Array.from(new Set([...cur, clean]))
            : cur.filter((t) => t !== clean);
          return { ...w, tags: nextTags };
        }),
      }));
    },
    [updateConfig],
  );

  const saveSite = useCallback(
    (siteData: Omit<SiteConfig, 'id'> & { id?: string }): SiteConfig => {
      let saved!: SiteConfig;
      updateConfig((prev) => {
        if (siteData.id) {
          const existing = prev.sites.find((s) => s.id === siteData.id);
          if (existing) {
            saved = { ...existing, ...siteData, id: existing.id };
            return {
              ...prev,
              sites: prev.sites.map((s) => (s.id === existing.id ? saved : s)),
            };
          }
        }
        saved = { ...siteData, id: uid('site') };
        return {
          ...prev,
          sites: [...prev.sites, saved],
        };
      });
      return saved;
    },
    [updateConfig],
  );

  const deleteSite = useCallback(
    (siteId: string) => {
      updateConfig((prev) => ({
        ...prev,
        sites: prev.sites.filter((s) => s.id !== siteId),
        watched: prev.watched.filter((w) => w.siteId !== siteId),
      }));
      setPricingCache((prev) => {
        const next = new Map(prev);
        next.delete(siteId);
        return next;
      });
      setKumaCache((prev) => {
        const next = new Map(prev);
        next.delete(siteId);
        return next;
      });
      setSiteErrors((prev) => {
        const next = new Map(prev);
        next.delete(siteId);
        return next;
      });
      if (editingSiteId === siteId) setEditingSiteId(null);
    },
    [editingSiteId, updateConfig],
  );

  const tagCatalog = useMemo(() => {
    return Array.from(new Set([...(config.tags || []), ...config.watched.flatMap((w) => w.tags || [])]));
  }, [config.tags, config.watched]);

  const addTagGlobal = useCallback(
    (rawTag: string): boolean => {
      const clean = rawTag.trim();
      if (!clean) return false;
      const exists = (configRef.current.tags || []).includes(clean);
      updateConfig((prev) => ({
        ...prev,
        tags: Array.from(new Set([...(prev.tags || []), clean])),
      }));
      return !exists;
    },
    [updateConfig],
  );

  const renameTagGlobal = useCallback(
    (oldTag: string, newTag: string): number => {
      const cleanNew = newTag.trim();
      if (!cleanNew) return 0;
      let updated = 0;
      updateConfig((prev) => ({
        ...prev,
        tags: Array.from(new Set((prev.tags || []).map((t) => (t === oldTag ? cleanNew : t)))),
        watched: prev.watched.map((w) => {
          if (!w.tags || !w.tags.includes(oldTag)) return w;
          updated++;
          return {
            ...w,
            tags: Array.from(new Set(w.tags.map((t) => (t === oldTag ? cleanNew : t)))),
          };
        }),
        ui: {
          ...prev.ui,
          activeTag: prev.ui.activeTag === oldTag ? cleanNew : prev.ui.activeTag,
        },
      }));
      return updated;
    },
    [updateConfig],
  );

  const deleteTagGlobal = useCallback(
    (tag: string): number => {
      let updated = 0;
      updateConfig((prev) => ({
        ...prev,
        tags: (prev.tags || []).filter((t) => t !== tag),
        watched: prev.watched.map((w) => {
          if (!w.tags || !w.tags.includes(tag)) return w;
          updated++;
          return {
            ...w,
            tags: w.tags.filter((t) => t !== tag),
          };
        }),
        ui: {
          ...prev.ui,
          activeTag: prev.ui.activeTag === tag ? 'all' : prev.ui.activeTag,
        },
      }));
      return updated;
    },
    [updateConfig],
  );

  const applyImportedConfig = useCallback(
    (payload: ExportPayload, mode: 'merge' | 'replace') => {
      if (mode === 'replace') {
        setPricingCache(new Map());
        setKumaCache(new Map());
        setSiteErrors(new Map());
        setInspectedWatchId(null);
        updateConfig((prev) => replaceConfigWith(prev, payload));
      } else {
        updateConfig((prev) => mergeConfigInto(prev, payload));
      }
      setTimeout(() => {
        refreshAllSites(false, true);
      }, 20);
      showToast(mode === 'replace' ? '已覆盖导入配置' : '已合并导入配置', 'success');
    },
    [refreshAllSites, showToast, updateConfig],
  );

  const value = useMemo<WeathercockContextValue>(
    () => ({
      config,
      activePanel,
      setActivePanel,
      activeSiteFilter,
      setActiveSiteFilter,
      plazaSiteId,
      setPlazaSiteId,
      inspectedWatchId,
      setInspectedWatchId,
      editingSiteId,
      setEditingSiteId,
      pricingCache,
      kumaCache,
      siteErrors,
      loadingSiteIds,
      probingIds,
      syncEnabled,
      lastRefreshAt,
      lastRefreshWasLive,
      tickNow,
      batchProgress,
      cancelBatchProbe,
      toasts,
      showToast,
      dismissToast,
      confirmState,
      confirmDialog,
      resolveConfirm,
      toggleTheme,
      setUiFilter,
      getListingStatus,
      refreshSite,
      refreshAllSites,
      probeModel,
      batchProbeModels,
      addWatch,
      batchAddWatch,
      updateWatch,
      toggleWatchTag,
      removeWatchWithUndo,
      batchRemoveWatchesWithUndo,
      batchUpdateWatchTags,
      batchSetTagPresence,
      saveSite,
      deleteSite,
      tagCatalog,
      addTagGlobal,
      renameTagGlobal,
      deleteTagGlobal,
      applyImportedConfig,
    }),
    [
      config,
      activePanel,
      activeSiteFilter,
      plazaSiteId,
      inspectedWatchId,
      editingSiteId,
      pricingCache,
      kumaCache,
      siteErrors,
      loadingSiteIds,
      probingIds,
      syncEnabled,
      lastRefreshAt,
      lastRefreshWasLive,
      tickNow,
      batchProgress,
      cancelBatchProbe,
      toasts,
      showToast,
      dismissToast,
      confirmState,
      confirmDialog,
      resolveConfirm,
      toggleTheme,
      setUiFilter,
      getListingStatus,
      refreshSite,
      refreshAllSites,
      probeModel,
      batchProbeModels,
      addWatch,
      batchAddWatch,
      updateWatch,
      toggleWatchTag,
      removeWatchWithUndo,
      batchRemoveWatchesWithUndo,
      batchUpdateWatchTags,
      batchSetTagPresence,
      saveSite,
      deleteSite,
      tagCatalog,
      addTagGlobal,
      renameTagGlobal,
      deleteTagGlobal,
      applyImportedConfig,
    ],
  );

  return <WeathercockContext.Provider value={value}>{children}</WeathercockContext.Provider>;
};

export function useWeathercock(): WeathercockContextValue {
  const ctx = useContext(WeathercockContext);
  if (!ctx) throw new Error('useWeathercock must be used within WeathercockProvider');
  return ctx;
}
