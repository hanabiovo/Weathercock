export function uid(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function padZero(num: number): string {
  const safe = Math.max(0, Math.floor(num));
  return safe < 10 ? `0${safe}` : String(safe);
}

export function parseTagsInput(raw: string): string[] {
  return Array.from(
    new Set(
      String(raw || '')
        .split(/[,，]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

export function formatUsd(num: number | undefined | null): string {
  if (num === undefined || num === null || !Number.isFinite(num)) return '—';
  if (num === 0) return '$0';
  if (num < 0.01) return `$${num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
  if (num < 1) return `$${num.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `$${num.toFixed(2).replace(/\.00$/, '')}`;
}

export function formatRmb(num: number | undefined | null): string {
  if (num === undefined || num === null || !Number.isFinite(num)) return '';
  if (num === 0) return '¥0';
  if (num < 0.01) return `¥${num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
  if (num < 1) return `¥${num.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `¥${num.toFixed(2).replace(/\.00$/, '')}`;
}

export function formatRelativeTime(ts: number | null): string {
  if (!ts) return '未刷新';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 15) return '刚刚';
  if (diffSec < 60) return `${diffSec} 秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  }
  return Promise.resolve(false);
}
