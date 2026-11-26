import React from 'react';
import { Activity, Moon, Plus, RefreshCw, Settings, Sun } from 'lucide-react';
import { ConfirmModal, InspectorDrawer, ToastContainer } from './components/UiPrimitives';
import { useWeathercock, WeathercockProvider } from './context/WeathercockContext';
import { AddPanel } from './pages/AddPanel';
import { DiagnosticsPanel } from './pages/DiagnosticsPanel';
import { MonitorPage } from './pages/MonitorPage';
import { SettingsPanel } from './pages/SettingsPanel';
import { STORAGE_KEY } from './utils/storage';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-viewport">
          <div className="instrument-frame">
            <div className="empty-box">
              <h2>界面渲染异常</h2>
              <p>{this.state.error.message || '检测到本地配置格式异常，无法正常渲染。'}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={() => window.location.reload()}>
                  重新加载
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    localStorage.removeItem(STORAGE_KEY);
                    window.location.reload();
                  }}
                >
                  清空本地配置并恢复
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const InstrumentShell: React.FC = () => {
  const {
    config,
    setActivePanel,
    loadingSiteIds,
    refreshAllSites,
    toggleTheme,
  } = useWeathercock();

  const isRefreshing = loadingSiteIds.size > 0;
  const logoSrc = config.ui.theme === 'dark' ? '/svg/weathervane-white.svg' : '/svg/weathervane-black.svg';

  return (
    <div className="app-viewport">
      <div className="instrument-frame">
        {/* Minimal Brand Header + Pure Icon Actions */}
        <header className="inst-header">
          <div className="brand-lockup">
            <img src={logoSrc} alt="风见鸡 Weathercock" className="brand-lockup-logo" />
            <div className="brand-lockup-text">
              <span className="brand-lockup-cn">风见鸡</span>
              <span className="brand-lockup-en">WEATHERCOCK</span>
            </div>
          </div>

          <div className="header-icon-dock" role="toolbar" aria-label="主功能入口">
            <button
              type="button"
              className="icon-action-btn"
              title="刷新所有站点状态"
              aria-label="刷新所有站点状态"
              disabled={isRefreshing || config.sites.length === 0}
              onClick={() => refreshAllSites(true, false)}
            >
              <RefreshCw size={16} className={isRefreshing ? 'spinning' : ''} />
            </button>

            <span className="header-divider" aria-hidden="true" />

            <button
              type="button"
              className="icon-action-btn primary"
              title="添加站点与模型"
              aria-label="添加站点与模型"
              onClick={() => setActivePanel('add')}
            >
              <Plus size={17} />
            </button>

            <button
              type="button"
              className="icon-action-btn"
              title="连接诊断"
              aria-label="连接诊断"
              onClick={() => setActivePanel('diagnostics')}
            >
              <Activity size={16} />
            </button>

            <button
              type="button"
              className="icon-action-btn"
              title="设置（站点维护 / 标签 / 导入导出）"
              aria-label="设置"
              onClick={() => setActivePanel('settings')}
            >
              <Settings size={16} />
            </button>

            <button
              type="button"
              className="icon-action-btn"
              title={config.ui.theme === 'dark' ? '切换日间模式' : '切换夜间模式'}
              aria-label="切换主题"
              onClick={toggleTheme}
            >
              {config.ui.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        {/* Primary Home: LCD Dashboard + Model List */}
        <main style={{ flex: 1 }}>
          <MonitorPage />
        </main>
      </div>

      {/* Responsive Secondary Pages (Drawer on PC, Fullscreen Subpage on Mobile) */}
      <AddPanel />
      <DiagnosticsPanel />
      <SettingsPanel />
      <InspectorDrawer />
      <ConfirmModal />
      <ToastContainer />
    </div>
  );
};

export const App: React.FC = () => (
  <AppErrorBoundary>
    <WeathercockProvider>
      <InstrumentShell />
    </WeathercockProvider>
  </AppErrorBoundary>
);
