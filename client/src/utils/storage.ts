import type { MonitorViewMode, SiteConfig, SortMode, WatchedModel, WeathercockConfig, WeightedCostMode } from '../types/weathercock';
import { uid } from './format';

export const STORAGE_KEY = 'weathercock:v1';
export const SESSION_TOKEN_KEY = 'weathercock:sync_token';
export const DEFAULT_PRESET_TAGS = ['主力', '备用', '便宜', '长文本'];
export const AUTO_REFRESH_MS = 5 * 60 * 1000;
export const PLAZA_PAGE_SIZE = 80;

export function defaultConfig(): WeathercockConfig {
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  return {
    version: 1,
    sites: [],
    watched: [],
    tags: [...DEFAULT_PRESET_TAGS],
    ui: {
      theme: prefersDark ? 'dark' : 'light',
      activeTag: 'all',
      view: 'list',
      sort: 'default',
      autoRefresh: true,
      weightedMode: 'none',
    },
  };
}

export function normalizeMonitorView(raw: unknown): MonitorViewMode {
  if (raw === 'cards' || raw === 'compare') return raw;
  return 'list';
}

function sanitizeSites(rawSites: unknown): SiteConfig[] {
  if (!Array.isArray(rawSites)) return [];
  const list: SiteConfig[] = [];
  for (const item of rawSites) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const baseUrl = typeof r.baseUrl === 'string' ? r.baseUrl.trim() : '';
    if (!baseUrl) continue;
    const rateRmb =
      typeof r.rateRmb === 'number' && Number.isFinite(r.rateRmb) && r.rateRmb > 0 ? r.rateRmb : undefined;
    const rateToken =
      typeof r.rateToken === 'number' && Number.isFinite(r.rateToken) && r.rateToken > 0 ? r.rateToken : undefined;
    const tokenUnit = typeof r.tokenUnit === 'string' && r.tokenUnit.trim() ? r.tokenUnit.trim() : undefined;
    const rawRate =
      typeof r.exchangeRate === 'number' && Number.isFinite(r.exchangeRate) && r.exchangeRate > 0
        ? r.exchangeRate
        : undefined;
    const exchangeRate = rawRate ?? (rateRmb && rateToken ? rateRmb / rateToken : undefined);

    list.push({
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : uid('site'),
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : baseUrl,
      baseUrl,
      statusUrl: typeof r.statusUrl === 'string' && r.statusUrl.trim() ? r.statusUrl.trim() : undefined,
      exchangeRate,
      rateRmb,
      rateToken,
      tokenUnit,
      apiKey: typeof r.apiKey === 'string' && r.apiKey.trim() ? r.apiKey.trim() : undefined,
    });
  }
  return list;
}

function sanitizeWatched(rawWatched: unknown): WatchedModel[] {
  if (!Array.isArray(rawWatched)) return [];
  const list: WatchedModel[] = [];
  for (const item of rawWatched) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const rawName = typeof r.modelName === 'string' ? r.modelName : typeof r.modelId === 'string' ? r.modelId : '';
    const modelName = rawName.trim();
    const siteId = typeof r.siteId === 'string' ? r.siteId.trim() : '';
    if (!modelName || !siteId) continue;

    list.push({
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : uid('watch'),
      siteId,
      modelName,
      group: typeof r.group === 'string' && r.group.trim() ? r.group.trim() : undefined,
      alias: typeof r.alias === 'string' && r.alias.trim() ? r.alias.trim() : undefined,
      tags: Array.isArray(r.tags) ? r.tags.map((t) => String(t).trim()).filter(Boolean) : undefined,
      kumaMonitorId: typeof r.kumaMonitorId === 'string' && r.kumaMonitorId.trim() ? r.kumaMonitorId.trim() : undefined,
      lastProbe: r.lastProbe && typeof r.lastProbe === 'object' ? (r.lastProbe as WatchedModel['lastProbe']) : undefined,
    });
  }
  return list;
}

function resolveTagCatalog(rawTags: unknown, watched: WatchedModel[]): string[] {
  const used = new Set<string>();
  for (const w of watched) {
    for (const t of w.tags || []) used.add(t);
  }
  if (Array.isArray(rawTags)) {
    const clean = rawTags.map((t) => String(t).trim()).filter(Boolean);
    return Array.from(new Set([...clean, ...used]));
  }
  return Array.from(new Set([...DEFAULT_PRESET_TAGS, ...used]));
}

export function loadConfig(): WeathercockConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig();
    const parsed = JSON.parse(raw) as Partial<WeathercockConfig>;
    if (!parsed || parsed.version !== 1) return defaultConfig();

    const savedTheme = parsed.ui?.theme;
    const effectiveInitTheme =
      savedTheme === 'dark' || savedTheme === 'light'
        ? savedTheme
        : defaultConfig().ui.theme;

    const validSorts: SortMode[] = ['default', 'price-asc', 'price-desc', 'uptime-desc', 'site', 'name'];
    const sort = validSorts.includes(parsed.ui?.sort as SortMode) ? (parsed.ui?.sort as SortMode) : 'default';

    const validWeighted: WeightedCostMode[] = ['none', '3:1', '1:1', '1:3'];
    const weightedMode = validWeighted.includes(parsed.ui?.weightedMode as WeightedCostMode)
      ? (parsed.ui?.weightedMode as WeightedCostMode)
      : 'none';

    const sites = sanitizeSites(parsed.sites);
    const watched = sanitizeWatched(parsed.watched);
    const tags = resolveTagCatalog(parsed.tags, watched);

    return {
      version: 1,
      sites,
      watched,
      tags,
      ui: {
        theme: effectiveInitTheme,
        activeTag: 'all',
        view: normalizeMonitorView(parsed.ui?.view),
        sort,
        autoRefresh: parsed.ui?.autoRefresh !== false,
        weightedMode,
      },
    };
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(cfg: WeathercockConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export interface ExportPayload extends WeathercockConfig {
  exportedAt: string;
}

export function buildExportPayload(cfg: WeathercockConfig, includeKeys: boolean): ExportPayload {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    sites: cfg.sites.map((s) => {
      const copy = { ...s };
      if (!includeKeys) delete copy.apiKey;
      return copy;
    }),
    watched: cfg.watched.map((w) => ({ ...w })),
    tags: Array.isArray(cfg.tags) ? [...cfg.tags] : undefined,
    ui: { ...cfg.ui },
  };
}

export function parseImportText(rawText: string): { ok: true; data: ExportPayload } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: 'JSON 格式无效，请检查文件内容' };
  }
  const rec = parsed as Partial<ExportPayload>;
  if (!rec || rec.version !== 1 || !Array.isArray(rec.sites) || !Array.isArray(rec.watched)) {
    return { ok: false, error: '配置结构无效（需含 version: 1、sites 与 watched 数组）' };
  }
  const sites = sanitizeSites(rec.sites);
  const watched = sanitizeWatched(rec.watched);
  return {
    ok: true,
    data: {
      version: 1,
      exportedAt: typeof rec.exportedAt === 'string' ? rec.exportedAt : new Date().toISOString(),
      sites,
      watched,
      tags: Array.isArray(rec.tags) ? rec.tags.map((t) => String(t).trim()).filter(Boolean) : undefined,
      ui: rec.ui ?? defaultConfig().ui,
    },
  };
}

export function mergeConfigInto(current: WeathercockConfig, incoming: ExportPayload): WeathercockConfig {
  const nextSites = current.sites.map((s) => ({ ...s }));
  const nextWatched = current.watched.map((w) => ({ ...w }));
  const siteIdMap = new Map<string, string>();

  for (const incSite of incoming.sites) {
    if (!incSite?.baseUrl) continue;
    const existing = nextSites.find((s) => s.baseUrl.toLowerCase() === incSite.baseUrl.toLowerCase());
    if (existing) {
      siteIdMap.set(incSite.id, existing.id);
      if (!existing.statusUrl && incSite.statusUrl) existing.statusUrl = incSite.statusUrl;
      if (!existing.exchangeRate && incSite.exchangeRate) existing.exchangeRate = incSite.exchangeRate;
      if (!existing.apiKey && incSite.apiKey) existing.apiKey = incSite.apiKey;
    } else {
      const newId = incSite.id && !nextSites.some((s) => s.id === incSite.id) ? incSite.id : uid('site');
      siteIdMap.set(incSite.id, newId);
      nextSites.push({ ...incSite, id: newId });
    }
  }

  for (const incWatch of incoming.watched) {
    if (!incWatch?.modelName) continue;
    const mappedSiteId = siteIdMap.get(incWatch.siteId) || incWatch.siteId;
    if (!nextSites.some((s) => s.id === mappedSiteId)) continue;
    const exists = nextWatched.some((w) => w.siteId === mappedSiteId && w.modelName === incWatch.modelName);
    if (!exists) {
      nextWatched.push({
        ...incWatch,
        id: uid('watch'),
        siteId: mappedSiteId,
      });
    }
  }

  const nextTags = Array.from(
    new Set([...(current.tags || []), ...(incoming.tags || []), ...nextWatched.flatMap((w) => w.tags || [])]),
  );

  return {
    ...current,
    sites: nextSites,
    watched: nextWatched,
    tags: nextTags,
  };
}

export function replaceConfigWith(current: WeathercockConfig, incoming: ExportPayload): WeathercockConfig {
  const sites = sanitizeSites(incoming.sites);
  const watched = sanitizeWatched(incoming.watched);
  return {
    version: 1,
    sites,
    watched,
    tags: resolveTagCatalog(incoming.tags, watched),
    ui: {
      ...current.ui,
      theme: incoming.ui?.theme === 'dark' ? 'dark' : current.ui.theme,
      activeTag: 'all',
      view: normalizeMonitorView(incoming.ui?.view),
      sort: incoming.ui?.sort || current.ui.sort,
      autoRefresh: current.ui.autoRefresh,
    },
  };
}
