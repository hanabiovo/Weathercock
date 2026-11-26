import type {
  ComputedPrice,
  KumaData,
  KumaMonitor,
  PricingModel,
  WeightedCostMode,
  WatchedModel,
} from '../types/weathercock';

export type ParsedTieredExpr =
  | { kind: 'fixed'; perCallBase: number }
  | { kind: 'tokens'; inputBase: number; outputBase: number };

export function parseTieredExprPrices(expr: string): ParsedTieredExpr | null {
  if (typeof expr !== 'string' || !expr) return null;
  const pMatch = expr.match(/\bp\s*\*\s*([0-9]+(?:\.[0-9]+)?)/);
  const cMatch = expr.match(/\bc\s*\*\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!pMatch && !cMatch) {
    const fixedMatch = expr.match(/\bfixed\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)/);
    if (!fixedMatch) return null;
    const perCallBase = Number(fixedMatch[1]);
    return Number.isFinite(perCallBase) ? { kind: 'fixed', perCallBase } : null;
  }
  const inputBase = pMatch ? Number(pMatch[1]) : 0;
  const outputBase = cMatch ? Number(cMatch[1]) : inputBase;
  if (!Number.isFinite(inputBase) || !Number.isFinite(outputBase)) return null;
  return { kind: 'tokens', inputBase, outputBase };
}

export function getEffectiveQuotaType(model: PricingModel): 0 | 1 {
  if (model.quotaType === 1) return 1;
  if (model.billingMode === 'tiered_expr' && model.billingExpr) {
    const parsed = parseTieredExprPrices(model.billingExpr);
    if (parsed?.kind === 'fixed') return 1;
  }
  return 0;
}

export function computeModelPrice(
  model: PricingModel,
  groupRatioMap: Record<string, number> | undefined,
  preferredGroup: string | undefined,
  exchangeRate: number | undefined | null,
): ComputedPrice {
  const groups = model?.enableGroups || [];
  let activeGroup = preferredGroup && groups.includes(preferredGroup) ? preferredGroup : '';
  if (!activeGroup) {
    activeGroup = groups.includes('default') ? 'default' : groups[0] || 'default';
  }
  const rawRatio = groupRatioMap?.[activeGroup];
  const gRatio = typeof rawRatio === 'number' && Number.isFinite(rawRatio) ? rawRatio : 1;
  const rate = exchangeRate && Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : null;

  if (model.quotaType === 1) {
    const perCallUsd = model.modelPrice * gRatio;
    return {
      quotaType: 1,
      activeGroup,
      groupRatio: gRatio,
      perCallUsd,
      perCallRmb: rate ? perCallUsd * rate : null,
      sortPriceUsd: perCallUsd,
      isTieredExpr: false,
      billingExpr: '',
    };
  }

  if (model.billingMode === 'tiered_expr' && model.billingExpr) {
    const parsed = parseTieredExprPrices(model.billingExpr);
    if (parsed?.kind === 'fixed') {
      const perCallUsd = parsed.perCallBase * gRatio;
      return {
        quotaType: 1,
        activeGroup,
        groupRatio: gRatio,
        perCallUsd,
        perCallRmb: rate ? perCallUsd * rate : null,
        sortPriceUsd: perCallUsd,
        isTieredExpr: true,
        billingExpr: model.billingExpr,
      };
    }
    if (parsed?.kind === 'tokens') {
      const inputUsd = parsed.inputBase * gRatio;
      const outputUsd = parsed.outputBase * gRatio;
      return {
        quotaType: 0,
        activeGroup,
        groupRatio: gRatio,
        inputUsd,
        outputUsd,
        inputRmb: rate ? inputUsd * rate : null,
        outputRmb: rate ? outputUsd * rate : null,
        sortPriceUsd: inputUsd,
        isTieredExpr: true,
        billingExpr: model.billingExpr,
      };
    }
  }

  const inputUsd = model.modelRatio * 2 * gRatio;
  const outputUsd = inputUsd * (model.completionRatio || 1);
  return {
    quotaType: 0,
    activeGroup,
    groupRatio: gRatio,
    inputUsd,
    outputUsd,
    inputRmb: rate ? inputUsd * rate : null,
    outputRmb: rate ? outputUsd * rate : null,
    sortPriceUsd: inputUsd,
    isTieredExpr: false,
    billingExpr: '',
  };
}

/**
 * Compute blended USD/1M cost for token-based models according to a user-selected input:output ratio.
 * Returns null for per-call models.
 */
export function computeWeightedCost(
  calc: ComputedPrice,
  mode: WeightedCostMode,
): { usd: number; rmb: number | null } | null {
  if (mode === 'none' || calc.quotaType === 1) return null;
  if (calc.inputUsd === undefined || calc.outputUsd === undefined) return null;
  const [inW, outW] = mode === '3:1' ? [0.75, 0.25] : mode === '1:1' ? [0.5, 0.5] : [0.25, 0.75];
  const usd = calc.inputUsd * inW + calc.outputUsd * outW;
  let rmb: number | null = null;
  if (calc.inputRmb !== null && calc.inputRmb !== undefined && calc.outputRmb !== null && calc.outputRmb !== undefined) {
    rmb = calc.inputRmb * inW + calc.outputRmb * outW;
  }
  return { usd, rmb };
}

export function normalizeMatchKey(str: string): string {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function extractCanonicalModelKey(rawName: string): string {
  let cleaned = String(rawName || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .trim()
    .toLowerCase();
  cleaned = cleaned.replace(/^[\s/_-]+|[\s/_-]+$/g, '').replace(/\s+/g, '-');
  cleaned = cleaned.replace(/(\d)\.(\d)/g, '$1-$2');
  return cleaned || String(rawName || '').toLowerCase();
}

export function findKumaMonitor(
  watchedItem: WatchedModel,
  kumaData: KumaData | null | undefined,
): { monitor: KumaMonitor; manual: boolean } | null {
  if (!kumaData || !Array.isArray(kumaData.monitors) || kumaData.monitors.length === 0) {
    return null;
  }
  if (watchedItem.kumaMonitorId) {
    const manual = kumaData.monitors.find((m) => m.id === String(watchedItem.kumaMonitorId));
    if (manual) return { monitor: manual, manual: true };
  }

  const targetLower = String(watchedItem.modelName || '').toLowerCase();
  const exact = kumaData.monitors.find((m) => String(m.name || '').toLowerCase() === targetLower);
  if (exact) return { monitor: exact, manual: false };

  const targetKey = normalizeMatchKey(watchedItem.modelName || '');
  const normExact = kumaData.monitors.find((m) => normalizeMatchKey(m.name || '') === targetKey);
  if (normExact) return { monitor: normExact, manual: false };

  const candidates = kumaData.monitors
    .filter((m) => {
      const mKey = normalizeMatchKey(m.name);
      return mKey.length >= 4 && (targetKey.includes(mKey) || mKey.includes(targetKey));
    })
    .sort((a, b) => b.name.length - a.name.length);

  if (candidates[0]) {
    return { monitor: candidates[0], manual: false };
  }
  return null;
}
