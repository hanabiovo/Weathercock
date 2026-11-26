import React, { useEffect, useMemo, useState } from 'react';
import { Check, CloudDownload, CloudUpload, Copy, Download, Plus, Trash2, Upload } from 'lucide-react';
import { SiteFormFields, type SiteFormValues, siteToFormValues, validateSiteValues } from '../components/SiteFormFields';
import { SubpageShell } from '../components/SubpageShell';
import { useWeathercock } from '../context/WeathercockContext';
import { apiCloudPull, apiCloudPush, apiFetchKuma, apiFetchPricing, apiFetchV1Models } from '../utils/api';
import { copyToClipboard } from '../utils/format';
import { buildExportPayload, parseImportText, SESSION_TOKEN_KEY } from '../utils/storage';

type SettingsTab = 'sites' | 'tags' | 'backup';

export const SettingsPanel: React.FC = () => {
  const {
    config,
    activePanel,
    setActivePanel,
    editingSiteId,
    setEditingSiteId,
    pricingCache,
    siteErrors,
    syncEnabled,
    saveSite,
    deleteSite,
    refreshSite,
    tagCatalog,
    addTagGlobal,
    renameTagGlobal,
    deleteTagGlobal,
    applyImportedConfig,
    confirmDialog,
    showToast,
  } = useWeathercock();

  const isOpen = activePanel === 'settings';
  const [subTab, setSubTab] = useState<SettingsTab>('sites');

  // Site form state
  const [siteValues, setSiteValues] = useState<SiteFormValues>(() => siteToFormValues(null));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [testStatus, setTestStatus] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'err'; text: string }>({
    kind: 'idle',
    text: '',
  });

  // Tag drafts
  const [newTagInput, setNewTagInput] = useState('');
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});

  // Backup & sync
  const [includeExportKeys, setIncludeExportKeys] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFileLabel, setImportFileLabel] = useState('');
  const [syncToken, setSyncToken] = useState(() => sessionStorage.getItem(SESSION_TOKEN_KEY) || '');
  const [rememberToken, setRememberToken] = useState(() => Boolean(sessionStorage.getItem(SESSION_TOKEN_KEY)));
  const [syncIncludeKeys, setSyncIncludeKeys] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => {
    if (isOpen && subTab === 'backup') {
      setIncludeExportKeys(false);
      setSyncIncludeKeys(false);
    }
  }, [isOpen, subTab]);

  useEffect(() => {
    if (!editingSiteId) {
      setSiteValues(siteToFormValues(null));
      setFieldErrors({});
      setTestStatus({ kind: 'idle', text: '' });
      return;
    }
    const site = config.sites.find((s) => s.id === editingSiteId);
    if (site) {
      setSubTab('sites');
      setSiteValues(siteToFormValues(site));
      setFieldErrors({});
      setTestStatus({ kind: 'idle', text: '' });
    }
  }, [editingSiteId, config.sites]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tagCatalog) counts.set(t, 0);
    for (const w of config.watched) {
      for (const t of w.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [tagCatalog, config.watched]);

  const validateSiteForm = () => {
    const res = validateSiteValues(siteValues, config.sites, editingSiteId);
    if (!res.ok) {
      setFieldErrors(res.errors);
      return null;
    }
    setFieldErrors({});
    return res.data;
  };

  const handleTestConnection = async () => {
    const validated = validateSiteForm();
    if (!validated) return;
    setTestStatus({ kind: 'loading', text: '正在测试站点连通性与模型目录接口...' });
    try {
      let modeNote = '';
      let modelCount = 0;
      try {
        const pData = await apiFetchPricing(validated.baseUrl, true);
        modelCount = pData.models.length;
      } catch (pricingErr) {
        if (validated.apiKey) {
          const v1Data = await apiFetchV1Models(validated.baseUrl, validated.apiKey);
          modelCount = v1Data.models.length;
          modeNote = '（/v1/models 兼容模式）';
        } else {
          throw pricingErr;
        }
      }
      let kumaInfo = '';
      if (validated.statusUrl) {
        try {
          const kData = await apiFetchKuma(validated.statusUrl, true);
          kumaInfo = ` · 状态页已连接（${kData.monitors.length} 项监控）`;
        } catch (kErr) {
          kumaInfo = ` · 但状态页失败：${kErr instanceof Error ? kErr.message : '未知错误'}`;
        }
      }
      setTestStatus({ kind: 'ok', text: `连接成功${modeNote}：检测到 ${modelCount} 个模型${kumaInfo}` });
    } catch (err) {
      setTestStatus({ kind: 'err', text: `连接失败：${err instanceof Error ? err.message : '请求失败'}` });
    }
  };

  const handleSubmitSite = async (e: React.FormEvent) => {
    e.preventDefault();
    const validated = validateSiteForm();
    if (!validated) return;
    const isEdit = Boolean(validated.id);
    const saved = saveSite(validated);
    setEditingSiteId(null);
    showToast(isEdit ? `已更新站点「${saved.name}」` : `已添加站点「${saved.name}」`, 'success');
    await refreshSite(saved, true);
  };

  const handleDeleteSite = async (siteId: string) => {
    const site = config.sites.find((s) => s.id === siteId);
    if (!site) return;
    const affectedCount = config.watched.filter((w) => w.siteId === siteId).length;
    const ok = await confirmDialog({
      title: `删除站点「${site.name}」？`,
      message:
        affectedCount > 0
          ? `删除后将同时移除该站点下的 ${affectedCount} 个关注模型。确定继续吗？`
          : '确定移除该站点配置吗？',
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    deleteSite(siteId);
    showToast(`已删除站点「${site.name}」`, 'success');
  };

  const persistTokenSession = (tk: string, remember: boolean) => {
    if (remember && tk) sessionStorage.setItem(SESSION_TOKEN_KEY, tk);
    else sessionStorage.removeItem(SESSION_TOKEN_KEY);
  };

  const handleCloudPull = async () => {
    const tk = syncToken.trim();
    if (!tk) {
      showToast('请先输入访问令牌', 'error');
      return;
    }
    persistTokenSession(tk, rememberToken);
    setSyncBusy(true);
    try {
      const cloudCfg = await apiCloudPull(tk);
      if (!cloudCfg) {
        showToast('云端尚未保存任何配置');
        return;
      }
      const timeDesc = cloudCfg.exportedAt ? new Date(cloudCfg.exportedAt).toLocaleString('zh-CN') : '未知时间';
      const ok = await confirmDialog({
        title: '确认从云端覆盖本地配置？',
        message: `云端备份保存于 ${timeDesc}（含 ${cloudCfg.sites?.length || 0} 个站点、${cloudCfg.watched?.length || 0} 个关注模型）。继续将覆盖当前本地数据。`,
        confirmText: '确认覆盖本地',
        danger: true,
      });
      if (!ok) return;
      applyImportedConfig(cloudCfg, 'replace');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '云同步拉取失败', 'error');
    } finally {
      setSyncBusy(false);
    }
  };

  const handleCloudPush = async () => {
    const tk = syncToken.trim();
    if (!tk) {
      showToast('请先输入访问令牌', 'error');
      return;
    }
    persistTokenSession(tk, rememberToken);
    const ok = await confirmDialog({
      title: '确认推送到云端？',
      message: `将把本地的 ${config.sites.length} 个站点、${config.watched.length} 个关注模型（${syncIncludeKeys ? '包含 API 密钥' : '已剔除 API 密钥'}）覆盖保存到云端。`,
      confirmText: '确认推送',
    });
    if (!ok) return;
    setSyncBusy(true);
    try {
      await apiCloudPush(tk, buildExportPayload(config, syncIncludeKeys));
      showToast('已推送配置到云端存储', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '云同步推送失败', 'error');
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <SubpageShell
      open={isOpen}
      title="系统设置"
      subtitle="SETTINGS / 站点维护 · 标签 · 数据备份"
      onClose={() => setActivePanel(null)}
    >
      {/* Sub-navigation */}
      <div className="subpage-section" style={{ paddingTop: 12, paddingBottom: 12, background: 'var(--bg-inset)' }}>
        <div className="segmented" style={{ alignSelf: 'flex-start' }}>
          <button
            type="button"
            className={`segmented-btn ${subTab === 'sites' ? 'active' : ''}`}
            onClick={() => setSubTab('sites')}
          >
            站点维护 ({config.sites.length})
          </button>
          <button
            type="button"
            className={`segmented-btn ${subTab === 'tags' ? 'active' : ''}`}
            onClick={() => setSubTab('tags')}
          >
            标签词典 ({allTags.length})
          </button>
          <button
            type="button"
            className={`segmented-btn ${subTab === 'backup' ? 'active' : ''}`}
            onClick={() => setSubTab('backup')}
          >
            备份与同步
          </button>
        </div>
      </div>

      {subTab === 'sites' && (
        <>
          <div className="subpage-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="micro-label">SITES / 已配置站点维护</span>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  setEditingSiteId(null);
                  setActivePanel('add');
                }}
              >
                <Plus size={12} />
                去添加站点与模型
              </button>
            </div>

            {config.sites.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>
                暂无已配置站点。点击右上角「去添加站点与模型」开始配置。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {config.sites.map((s) => {
                  const pData = pricingCache.get(s.id);
                  const err = siteErrors.get(s.id);
                  const watchCount = config.watched.filter((w) => w.siteId === s.id).length;

                  return (
                    <div key={s.id} className={`site-item ${editingSiteId === s.id ? 'editing' : ''}`}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className={`status-dot ${err ? 'error' : pData ? 'online' : ''}`} />
                          <strong style={{ fontSize: 13.5, fontWeight: 500 }}>{s.name}</strong>
                          {s.exchangeRate && (
                            <span className="mini-tag">
                              {s.rateRmb && s.rateToken
                                ? `${s.rateRmb}元 = ${s.rateToken}${s.tokenUnit || '刀'}`
                                : `1$ = ¥${s.exchangeRate}`}
                            </span>
                          )}
                          {s.apiKey && <span className="mini-tag">已配密钥</span>}
                        </div>
                        <div className="mono muted" style={{ fontSize: 11, marginTop: 2, wordBreak: 'break-all' }}>
                          {s.baseUrl}
                        </div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          关注 {watchCount} 个{pData ? ` · 广场 ${pData.models.length} 个` : ''}
                          {err ? ` · 异常: ${err}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-xs"
                          onClick={() => setEditingSiteId(editingSiteId === s.id ? null : s.id)}
                        >
                          {editingSiteId === s.id ? '收起' : '编辑'}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ width: 24, height: 24 }}
                          title="删除站点"
                          onClick={() => handleDeleteSite(s.id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {editingSiteId && (
            <form className="subpage-section" onSubmit={handleSubmitSite} noValidate>
              <span className="micro-label">EDIT SITE / 编辑站点参数</span>
              <SiteFormFields
                values={siteValues}
                onChange={(patch) => setSiteValues((prev) => ({ ...prev, ...patch }))}
                errors={fieldErrors}
              />

            {testStatus.kind !== 'idle' && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  background:
                    testStatus.kind === 'ok'
                      ? 'var(--green-soft)'
                      : testStatus.kind === 'err'
                        ? 'var(--red-soft)'
                        : 'var(--bg-inset)',
                  color:
                    testStatus.kind === 'ok'
                      ? 'var(--green)'
                      : testStatus.kind === 'err'
                        ? 'var(--red)'
                        : 'var(--text-secondary)',
                }}
              >
                {testStatus.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary btn-sm">
                <Check size={13} />
                保存修改
              </button>
              <button type="button" className="btn btn-sm" onClick={handleTestConnection}>
                测试连接
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingSiteId(null)}>
                取消编辑
              </button>
            </div>
          </form>
          )}
        </>
      )}

      {subTab === 'tags' && (
        <div className="subpage-section">
          <div className="muted" style={{ fontSize: 12 }}>
            可随时在此新增、重命名或删除标签；在模型行或详情中通过 Notion 标签选择器也可以随时增删。
          </div>

          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              const clean = newTagInput.trim();
              if (!clean) return;
              const created = addTagGlobal(clean);
              setNewTagInput('');
              showToast(created ? `已创建标签「${clean}」` : `标签「${clean}」已存在`, created ? 'success' : 'info');
            }}
          >
            <input
              className="input input-sm"
              style={{ flex: 1 }}
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              placeholder="输入新标签名，如：高性价比、视觉..."
            />
            <button type="submit" className="btn btn-primary btn-sm">
              <Plus size={12} />
              新建标签
            </button>
          </form>

          {allTags.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, padding: '16px 0' }}>
              标签词典为空，请在上方新建标签。
            </div>
          ) : (
            allTags.map(([tag, count]) => {
              const draft = tagDrafts[tag] ?? tag;
              return (
                <div
                  key={tag}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <input
                    className="input input-sm"
                    style={{ flex: 1 }}
                    value={draft}
                    onChange={(e) => setTagDrafts((prev) => ({ ...prev, [tag]: e.target.value }))}
                  />
                  <span className="muted mono" style={{ fontSize: 11 }}>{count} 项</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const next = draft.trim();
                      if (!next || next === tag) return;
                      const updated = renameTagGlobal(tag, next);
                      showToast(`已将「${tag}」重命名为「${next}」（更新 ${updated} 项）`, 'success');
                    }}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `删除标签「${tag}」？`,
                        message:
                          count > 0
                            ? `将从词典及 ${count} 个关注模型中永久移除该标签。`
                            : '将从标签词典中永久移除该标签。',
                        confirmText: '确认删除',
                        danger: true,
                      });
                      if (!ok) return;
                      deleteTagGlobal(tag);
                      showToast(`已删除标签「${tag}」`, 'success');
                    }}
                  >
                    删除
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {subTab === 'backup' && (
        <>
          <div className="subpage-section">
            <div className="micro-label">EXPORT / 导出配置 JSON</div>
            <div className="muted" style={{ fontSize: 12 }}>
              默认导出会自动剔除所有站点的 API 密钥，可直接分享给朋友导入同款模型清单。
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeExportKeys}
                onChange={(e) => setIncludeExportKeys(e.target.checked)}
              />
              <span>导出时包含各站点 API 密钥</span>
            </label>
            {includeExportKeys && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--amber-soft)',
                  color: 'var(--amber)',
                  fontSize: 12,
                }}
              >
                当前已勾选包含 API 密钥，导出内容含敏感凭据，仅限个人私密备份。
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const payload = buildExportPayload(config, includeExportKeys);
                  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `weathercock-config-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  showToast('已下载配置 JSON', 'success');
                }}
              >
                <Download size={12} />
                下载 JSON
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  const ok = await copyToClipboard(JSON.stringify(buildExportPayload(config, includeExportKeys), null, 2));
                  showToast(ok ? '已复制配置 JSON 到剪贴板' : '复制失败', ok ? 'success' : 'error');
                }}
              >
                <Copy size={12} />
                复制到剪贴板
              </button>
            </div>
          </div>

          <div className="subpage-section">
            <div className="micro-label">IMPORT / 导入配置 JSON</div>
            <div className="muted" style={{ fontSize: 12 }}>
              合并导入会按站点地址匹配；覆盖导入会完整替换当前本地数据。
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                <Upload size={12} />
                选择 JSON 文件
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const txt = await file.text();
                    setImportText(txt);
                    setImportFileLabel(`${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
                  }}
                />
              </label>
              {importFileLabel && <span className="muted mono" style={{ fontSize: 11.5 }}>{importFileLabel}</span>}
            </div>
            <textarea
              className="textarea"
              rows={4}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='粘贴导出的 JSON 配置，如 {"version": 1, "sites": [...], "watched": [...]}'
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const parsed = parseImportText(importText.trim());
                  if (!parsed.ok) {
                    showToast(parsed.error, 'error');
                    return;
                  }
                  applyImportedConfig(parsed.data, 'merge');
                  setImportText('');
                  setImportFileLabel('');
                }}
              >
                合并导入
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  const parsed = parseImportText(importText.trim());
                  if (!parsed.ok) {
                    showToast(parsed.error, 'error');
                    return;
                  }
                  const ok = await confirmDialog({
                    title: '确认覆盖当前全部配置？',
                    message: `导入配置包含 ${parsed.data.sites.length} 个站点、${parsed.data.watched.length} 个关注模型。覆盖将替换当前所有本地数据。`,
                    confirmText: '确认覆盖',
                    danger: true,
                  });
                  if (!ok) return;
                  applyImportedConfig(parsed.data, 'replace');
                  setImportText('');
                  setImportFileLabel('');
                }}
              >
                覆盖当前配置
              </button>
            </div>
          </div>

          {syncEnabled && (
            <div className="subpage-section">
              <div className="micro-label">CLOUD SYNC / 跨设备云同步</div>
              <div className="muted" style={{ fontSize: 12 }}>
                当前部署已启用 Cloudflare KV 存储，输入访问令牌即可拉取或推送配置。
              </div>
              <input
                type="password"
                className="input"
                autoComplete="off"
                value={syncToken}
                onChange={(e) => setSyncToken(e.target.value)}
                placeholder="输入部署时设置的 ACCESS_TOKEN"
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rememberToken}
                  onChange={(e) => {
                    setRememberToken(e.target.checked);
                    persistTokenSession(syncToken.trim(), e.target.checked);
                  }}
                />
                <span>在当前浏览器会话中记住令牌（关闭标签页自动清除）</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={syncIncludeKeys}
                  onChange={(e) => setSyncIncludeKeys(e.target.checked)}
                />
                <span>推送到云端时包含各站点 API 密钥（默认脱敏剔除）</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-sm" disabled={syncBusy} onClick={handleCloudPull}>
                  <CloudDownload size={12} />
                  从云端拉取
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={syncBusy} onClick={handleCloudPush}>
                  <CloudUpload size={12} />
                  推送到云端
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </SubpageShell>
  );
};
