import React, { useEffect } from 'react';
import { ChevronLeft, X } from 'lucide-react';

interface SubpageShellProps {
  open: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  narrow?: boolean;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}

export const SubpageShell: React.FC<SubpageShellProps> = ({
  open,
  title,
  subtitle,
  onClose,
  narrow = false,
  headerExtra,
  children,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="subpage-backdrop" onClick={onClose}>
      <section
        className={`subpage-panel ${narrow ? 'narrow' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="subpage-head">
          <button type="button" className="btn btn-ghost btn-sm subpage-back-btn" onClick={onClose}>
            <ChevronLeft size={16} />
            返回
          </button>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="micro-label">{subtitle}</div>
            <div style={{ fontSize: 15.5, fontWeight: 500, marginTop: 1 }}>{title}</div>
          </div>

          {headerExtra}

          <button
            type="button"
            className="icon-btn subpage-close-desktop"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="subpage-body">{children}</div>
      </section>
    </div>
  );
};
