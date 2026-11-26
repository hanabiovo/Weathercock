import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Minus, Plus, Tag, Trash2, X } from 'lucide-react';
import { useWeathercock } from '../context/WeathercockContext';

interface NotionTagPickerProps {
  watchId: string;
  selectedTags: string[];
  /** Controlled open state (e.g. auto-open immediately after clicking + 关注) */
  defaultOpen?: boolean;
  onClose?: () => void;
  compact?: boolean;
  /** Render existing tags as static pills + a dedicated small '+' button on the right */
  inlinePlusOnly?: boolean;
}

export const NotionTagPicker: React.FC<NotionTagPickerProps> = ({
  watchId,
  selectedTags,
  defaultOpen = false,
  onClose,
  compact = false,
  inlinePlusOnly = false,
}) => {
  const { tagCatalog, toggleWatchTag, addTagGlobal, deleteTagGlobal, confirmDialog, showToast } = useWeathercock();
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
        onClose?.();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        setQuery('');
        onClose?.();
      }
    };
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const cleanQuery = query.trim();
  const filteredCatalog = useMemo(() => {
    if (!cleanQuery) return tagCatalog;
    const q = cleanQuery.toLowerCase();
    return tagCatalog.filter((t) => t.toLowerCase().includes(q));
  }, [tagCatalog, cleanQuery]);

  const exactExists = tagCatalog.some((t) => t.toLowerCase() === cleanQuery.toLowerCase());

  const handleCreateAndAttach = () => {
    if (!cleanQuery) return;
    addTagGlobal(cleanQuery);
    if (!selectedTags.includes(cleanQuery)) {
      toggleWatchTag(watchId, cleanQuery);
    }
    setQuery('');
  };

  return (
    <div ref={rootRef} className="notion-picker-wrap" onClick={(e) => e.stopPropagation()}>
      {inlinePlusOnly ? (
        <div className="notion-inline-row">
          {selectedTags.map((t) => (
            <span key={t} className="mini-tag">
              {t}
            </span>
          ))}
          <button
            type="button"
            className={`notion-plus-btn ${open ? 'active' : ''}`}
            title="选择或添加标签"
            aria-label="选择或添加标签"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Plus size={11} />
          </button>
        </div>
      ) : (
        <div
          className={`notion-picker-trigger ${compact ? 'compact' : ''}`}
          onClick={() => setOpen((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen((v) => !v);
            }
          }}
          title="点击选择或管理标签"
        >
          {selectedTags.length === 0 ? (
            <span className="notion-placeholder">
              <Tag size={11} />
              添加标签
            </span>
          ) : (
            <>
              {selectedTags.map((t) => (
                <span key={t} className="notion-chip">
                  <span>{t}</span>
                  <button
                    type="button"
                    className="notion-chip-remove"
                    aria-label={`移除标签 ${t}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWatchTag(watchId, t);
                    }}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <span className="notion-plus-btn" aria-hidden="true">
                <Plus size={11} />
              </span>
            </>
          )}
        </div>
      )}

      {open && (
        <div className="notion-popover" onClick={(e) => e.stopPropagation()}>
          <div className="notion-popover-search">
            <input
              ref={inputRef}
              type="text"
              className="notion-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (cleanQuery && !exactExists) {
                    handleCreateAndAttach();
                  } else if (filteredCatalog[0]) {
                    toggleWatchTag(watchId, filteredCatalog[0]);
                  }
                }
              }}
              placeholder="搜索或输入新标签，回车创建..."
            />
          </div>

          <div className="notion-popover-list">
            {filteredCatalog.map((tag) => {
              const checked = selectedTags.includes(tag);
              return (
                <div
                  key={tag}
                  className={`notion-option ${checked ? 'checked' : ''}`}
                  onClick={() => toggleWatchTag(watchId, tag)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 }}>
                    <span className={`notion-check ${checked ? 'on' : ''}`}>
                      {checked && <Check size={10} />}
                    </span>
                    <span className="notion-option-label">{tag}</span>
                  </div>
                  <button
                    type="button"
                    className="notion-option-del"
                    title={`从词典永久删除「${tag}」`}
                    aria-label={`删除标签 ${tag}`}
                    onClick={async (e) => {
                      e.stopPropagation();
                      const ok = await confirmDialog({
                        title: `删除标签「${tag}」？`,
                        message: '将从标签词典及所有已绑定该标签的模型中移除。',
                        confirmText: '确认删除',
                        danger: true,
                      });
                      if (!ok) return;
                      deleteTagGlobal(tag);
                      showToast(`已删除标签「${tag}」`, 'success');
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}

            {cleanQuery && !exactExists && (
              <button type="button" className="notion-create-row" onClick={handleCreateAndAttach}>
                <Plus size={12} />
                <span>
                  创建标签 <strong>“{cleanQuery}”</strong>
                </span>
              </button>
            )}

            {filteredCatalog.length === 0 && !cleanQuery && (
              <div className="muted" style={{ padding: '10px 10px', fontSize: 11.5 }}>
                输入名称回车即可创建第一个标签
              </div>
            )}
          </div>

          <div className="notion-popover-foot">
            <span className="muted" style={{ fontSize: 10.5 }}>点击勾选 · 可随时增删</span>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => {
                setOpen(false);
                setQuery('');
                onClose?.();
              }}
            >
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface BatchNotionTagPickerProps {
  selectedIds: string[];
}

export const BatchNotionTagPicker: React.FC<BatchNotionTagPickerProps> = ({ selectedIds }) => {
  const { config, tagCatalog, batchSetTagPresence, addTagGlobal, deleteTagGlobal, confirmDialog, showToast } =
    useWeathercock();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedModels = useMemo(() => {
    const idSet = new Set(selectedIds);
    return config.watched.filter((w) => idSet.has(w.id));
  }, [config.watched, selectedIds]);

  const cleanQuery = query.trim();
  const filteredCatalog = useMemo(() => {
    if (!cleanQuery) return tagCatalog;
    const q = cleanQuery.toLowerCase();
    return tagCatalog.filter((t) => t.toLowerCase().includes(q));
  }, [tagCatalog, cleanQuery]);

  const exactExists = tagCatalog.some((t) => t.toLowerCase() === cleanQuery.toLowerCase());

  const getTagPresence = (tag: string): 'all' | 'some' | 'none' => {
    if (selectedModels.length === 0) return 'none';
    let hits = 0;
    for (const m of selectedModels) {
      if ((m.tags || []).includes(tag)) hits++;
    }
    if (hits === 0) return 'none';
    if (hits === selectedModels.length) return 'all';
    return 'some';
  };

  const handleToggleTag = (tag: string) => {
    const state = getTagPresence(tag);
    batchSetTagPresence(selectedIds, tag, state !== 'all');
  };

  const handleCreateAndApply = () => {
    if (!cleanQuery) return;
    addTagGlobal(cleanQuery);
    batchSetTagPresence(selectedIds, cleanQuery, true);
    setQuery('');
  };

  return (
    <div ref={rootRef} className="notion-picker-wrap">
      <button
        type="button"
        className="btn btn-sm"
        disabled={selectedIds.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        <Tag size={12} />
        <span>标签管理</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="notion-popover" onClick={(e) => e.stopPropagation()}>
          <div className="notion-popover-search">
            <input
              ref={inputRef}
              type="text"
              className="notion-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (cleanQuery && !exactExists) {
                    handleCreateAndApply();
                  } else if (filteredCatalog[0]) {
                    handleToggleTag(filteredCatalog[0]);
                  }
                }
              }}
              placeholder="搜索或输入新标签，回车创建..."
            />
          </div>

          <div className="notion-popover-list">
            {filteredCatalog.map((tag) => {
              const state = getTagPresence(tag);
              return (
                <div
                  key={tag}
                  className={`notion-option ${state !== 'none' ? 'checked' : ''}`}
                  onClick={() => handleToggleTag(tag)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 }}>
                    <span className={`notion-check ${state !== 'none' ? 'on' : ''}`}>
                      {state === 'all' && <Check size={10} />}
                      {state === 'some' && <Minus size={10} />}
                    </span>
                    <span className="notion-option-label">{tag}</span>
                  </div>
                  <button
                    type="button"
                    className="notion-option-del"
                    title={`从词典永久删除「${tag}」`}
                    aria-label={`删除标签 ${tag}`}
                    onClick={async (e) => {
                      e.stopPropagation();
                      const ok = await confirmDialog({
                        title: `删除标签「${tag}」？`,
                        message: '将从标签词典及所有已绑定该标签的模型中移除。',
                        confirmText: '确认删除',
                        danger: true,
                      });
                      if (!ok) return;
                      deleteTagGlobal(tag);
                      showToast(`已删除标签「${tag}」`, 'success');
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}

            {cleanQuery && !exactExists && (
              <button type="button" className="notion-create-row" onClick={handleCreateAndApply}>
                <Plus size={12} />
                <span>
                  创建并应用 <strong>“{cleanQuery}”</strong>
                </span>
              </button>
            )}

            {filteredCatalog.length === 0 && !cleanQuery && (
              <div className="muted" style={{ padding: '10px 10px', fontSize: 11.5 }}>
                输入名称回车即可创建第一个标签
              </div>
            )}
          </div>

          <div className="notion-popover-foot">
            <span className="muted" style={{ fontSize: 10.5 }}>
              作用于已选 {selectedIds.length} 项
            </span>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => {
                setOpen(false);
                setQuery('');
              }}
            >
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
