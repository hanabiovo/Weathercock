import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { SiteConfig } from '../types/weathercock';

export interface SiteFormValues {
  name: string;
  baseUrl: string;
  statusUrl: string;
  rateRmb: string;
  rateToken: string;
  tokenUnit: string;
  apiKey: string;
}

export function siteToFormValues(site?: SiteConfig | null): SiteFormValues {
  if (!site) {
    return {
      name: '',
      baseUrl: '',
      statusUrl: '',
      rateRmb: '',
      rateToken: '',
      tokenUnit: '刀',
      apiKey: '',
    };
  }
  const hasEquation = site.rateRmb && site.rateToken;
  return {
    name: site.name,
    baseUrl: site.baseUrl,
    statusUrl: site.statusUrl || '',
    rateRmb: hasEquation ? String(site.rateRmb) : site.exchangeRate ? String(site.exchangeRate) : '',
    rateToken: hasEquation ? String(site.rateToken) : site.exchangeRate ? '1' : '',
    tokenUnit: site.tokenUnit || '刀',
    apiKey: site.apiKey || '',
  };
}

export function validateSiteValues(
  values: SiteFormValues,
  existingSites: SiteConfig[],
  editingSiteId?: string | null,
):
  | { ok: true; data: Omit<SiteConfig, 'id'> & { id?: string } }
  | { ok: false; errors: Record<string, string>; firstError: string } {
  const errors: Record<string, string> = {};
  const n = values.name.trim();
  const b = values.baseUrl.trim().replace(/\/+$/, '');
  const s = values.statusUrl.trim().replace(/\/+$/, '');
  const rmbRaw = values.rateRmb.trim();
  const tokRaw = values.rateToken.trim();
  const unit = values.tokenUnit.trim() || '刀';

  if (!n) errors.name = '请填写站点名称';

  if (!b) {
    errors.baseUrl = '请填写站点地址';
  } else if (!/^https:\/\/.+/i.test(b)) {
    errors.baseUrl = '站点地址必须以 https:// 开头';
  } else {
    const dup = existingSites.find((x) => x.id !== editingSiteId && x.baseUrl.toLowerCase() === b.toLowerCase());
    if (dup) errors.baseUrl = `该地址已存在于「${dup.name}」`;
  }

  if (s && !/^https:\/\/.+\/status\/[^/]+/i.test(s)) {
    errors.statusUrl = '仅填写 Uptime Kuma 状态页（https://<域名>/status/<名称>），不是 /monitor';
  }

  let exchangeRate: number | undefined;
  let rateRmb: number | undefined;
  let rateToken: number | undefined;

  if (rmbRaw || tokRaw) {
    if (!rmbRaw || !tokRaw) {
      errors.exchangeRate = '请完整填写换算等式两侧的数值，或全部留空';
    } else {
      const rmb = Number(rmbRaw);
      const tok = Number(tokRaw);
      if (!Number.isFinite(rmb) || rmb <= 0 || !Number.isFinite(tok) || tok <= 0) {
        errors.exchangeRate = '换算数值必须大于 0';
      } else {
        rateRmb = rmb;
        rateToken = tok;
        exchangeRate = rmb / tok;
      }
    }
  }

  const keys = Object.keys(errors);
  if (keys.length > 0) {
    return { ok: false, errors, firstError: errors[keys[0]] };
  }

  return {
    ok: true,
    data: {
      id: editingSiteId || undefined,
      name: n,
      baseUrl: b,
      statusUrl: s || undefined,
      exchangeRate,
      rateRmb,
      rateToken,
      tokenUnit: rateRmb && rateToken ? unit : undefined,
      apiKey: values.apiKey.trim() || undefined,
    },
  };
}

interface SiteFormFieldsProps {
  values: SiteFormValues;
  onChange: (patch: Partial<SiteFormValues>) => void;
  errors?: Record<string, string>;
}

export const SiteFormFields: React.FC<SiteFormFieldsProps> = ({ values, onChange, errors = {} }) => {
  const [showKey, setShowKey] = useState(false);

  const rmbNum = Number(values.rateRmb.trim());
  const tokNum = Number(values.rateToken.trim());
  const hasValidPreview =
    values.rateRmb.trim() !== '' &&
    values.rateToken.trim() !== '' &&
    Number.isFinite(rmbNum) &&
    rmbNum > 0 &&
    Number.isFinite(tokNum) &&
    tokNum > 0;
  const unitDisplay = values.tokenUnit.trim() || '代币';

  return (
    <div className="form-grid-2">
      <label className="field">
        <span>站点名称 *</span>
        <input
          className="input"
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="例如：主力站 / 备用站"
        />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </label>

      <label className="field">
        <span>站点地址（站点 URL，不加 /v1）*</span>
        <input
          className="input"
          value={values.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          placeholder="https://api.example.com"
        />
        {errors.baseUrl && <span className="field-error">{errors.baseUrl}</span>}
      </label>

      <label className="field field-full">
        <span>模型状态检测页地址（非必填，不是 /monitor）</span>
        <input
          className="input"
          value={values.statusUrl}
          onChange={(e) => onChange({ statusUrl: e.target.value })}
          placeholder="https://status.example.com/status/api"
        />
        <span className="field-hint">
          仅填写独立 Uptime Kuma 状态页（如 https://status.example.com/status/api），不是站点自带的 /monitor 页面；留空时会自动读取站点原生监控。
        </span>
        {errors.statusUrl && <span className="field-error">{errors.statusUrl}</span>}
      </label>

      <div className="field field-full">
        <span>站内代币换算（非必填）</span>
        <div className="rate-equation">
          <input
            type="number"
            step="any"
            min="0"
            className="input rate-num-input"
            aria-label="人民币金额（元）"
            value={values.rateRmb}
            onChange={(e) => onChange({ rateRmb: e.target.value })}
            placeholder="1"
          />
          <span className="rate-sep">元 =</span>
          <input
            type="number"
            step="any"
            min="0"
            className="input rate-num-input"
            aria-label="对应站内代币数量"
            value={values.rateToken}
            onChange={(e) => onChange({ rateToken: e.target.value })}
            placeholder="1"
          />
          <input
            type="text"
            className="input rate-unit-input"
            aria-label="站内代币单位"
            value={values.tokenUnit}
            onChange={(e) => onChange({ tokenUnit: e.target.value })}
            placeholder="刀 / 额度"
          />
        </div>
        <span className="field-hint">
          {hasValidPreview
            ? `当前换算：站内 1 ${unitDisplay} ≈ ¥${Number((rmbNum / tokNum).toFixed(4))} 元（列表将同步显示人民币参考价）`
            : '按该站实际充值比例填写，如 1 元 = 2 刀 或 7.2 元 = 1 USD；留空则仅显示站内标价。'}
        </span>
        {errors.exchangeRate && <span className="field-error">{errors.exchangeRate}</span>}
      </div>

      <div className="field field-full">
        <span>诊断用 API 密钥（非必填）</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type={showKey ? 'text' : 'password'}
            className="input"
            autoComplete="off"
            value={values.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            placeholder="sk-...（用于实测诊断；无公开广场时也可拉取 /v1/models）"
          />
          <button
            type="button"
            className="btn"
            aria-label={showKey ? '隐藏密钥' : '显示密钥'}
            onClick={() => setShowKey((v) => !v)}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <div className="security-notice">
          <div>
            <strong>安全声明：</strong>密钥仅保存在当前浏览器本地，服务端不落盘存储，导出与云同步默认脱敏剔除，建议使用低额度测试令牌。
          </div>
          <div>
            <strong>费用提示：</strong>仅在主动触发「连接诊断 / 测连通 / 测工具 / 测识图」时才会发起极短测试请求，每次诊断将按模型实际价格产生少量费用。
          </div>
        </div>
      </div>
    </div>
  );
};
