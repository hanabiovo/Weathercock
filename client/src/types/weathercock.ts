export type ThemeMode = 'light' | 'dark';
export type SecondaryPanel = 'add' | 'diagnostics' | 'settings' | null;
export type MonitorViewMode = 'list' | 'cards' | 'compare';
export type SortMode = 'default' | 'price-asc' | 'price-desc' | 'uptime-desc' | 'site' | 'name';
export type WeightedCostMode = 'none' | '3:1' | '1:1' | '1:3';

export interface ProbeUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  reasoningTokens: number | null;
}

export type ProbeMode = 'ping' | 'tools' | 'vision';

export interface ProbeRecord {
  at: number;
  ok: boolean;
  httpStatus: number;
  latencyMs: number;
  supportsTools: boolean | null;
  supportsVision?: boolean | null;
  usage: ProbeUsage | null;
  error: string | null;
  testedTools: boolean;
  testedVision?: boolean;
}

export interface SiteConfig {
  id: string;
  name: string;
  baseUrl: string;
  statusUrl?: string;
  exchangeRate?: number;
  rateRmb?: number;
  rateToken?: number;
  tokenUnit?: string;
  apiKey?: string;
}

export interface WatchedModel {
  id: string;
  siteId: string;
  modelName: string;
  group?: string;
  alias?: string;
  tags?: string[];
  kumaMonitorId?: string;
  manual?: boolean;
  lastProbe?: ProbeRecord;
}

export interface UiConfig {
  theme: ThemeMode;
  activeTag: string;
  view: MonitorViewMode | 'table';
  sort: SortMode;
  autoRefresh: boolean;
  weightedMode?: WeightedCostMode;
}

export interface WeathercockConfig {
  version: 1;
  sites: SiteConfig[];
  watched: WatchedModel[];
  tags?: string[];
  ui: UiConfig;
}

export interface PricingModel {
  modelName: string;
  vendorId: number | string | null;
  ownerBy: string;
  quotaType: 0 | 1;
  modelRatio: number;
  completionRatio: number;
  modelPrice: number;
  enableGroups: string[];
  description: string;
  supportedEndpointTypes: string[];
  billingMode?: string;
  billingExpr?: string;
  hasPricing?: boolean;
}

export interface PricingData {
  baseUrl: string;
  source?: 'pricing' | 'v1-models';
  fetchedAt: number;
  models: PricingModel[];
  groupRatio: Record<string, number>;
  usableGroup: Record<string, string>;
  vendors: Record<string, string>;
}

export interface KumaHeartbeat {
  status: number;
  ping: number | null;
  time: string;
}

export interface KumaMonitor {
  id: string;
  name: string;
  groupName: string;
  uptime24h: number | null;
  latestStatus: number | null;
  latestPing: number | null;
  heartbeats: KumaHeartbeat[];
}

export interface KumaData {
  statusUrl?: string;
  baseUrl?: string;
  source?: string;
  title?: string;
  fetchedAt: number;
  monitors: KumaMonitor[];
}

export interface ComputedPrice {
  quotaType: 0 | 1;
  activeGroup: string;
  groupRatio: number;
  perCallUsd?: number;
  perCallRmb?: number | null;
  inputUsd?: number;
  outputUsd?: number;
  inputRmb?: number | null;
  outputRmb?: number | null;
  sortPriceUsd: number;
  isTieredExpr: boolean;
  billingExpr: string;
}

export type ListingStatusCode = 'loading' | 'error' | 'unknown' | 'online' | 'delisted' | 'manual';

export interface ListingStatus {
  code: ListingStatusCode;
  label: string;
  error?: string;
  model?: PricingModel;
  pricing?: PricingData;
}

export interface ToastItem {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  actionLabel?: string;
  onAction?: () => void;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}
