import { useState, useEffect, useMemo } from 'react';
import type { ExtensionResponse } from '../../types';
import './App.css';

type RecentCapture = {
  linkedinUrl: string;
  name: string;
  type: 'person' | 'company';
  capturedAt: number;
  twentyId: string;
};

export default function App() {
  // State
  const [twentyUrl, setTwentyUrl] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [recentCaptures, setRecentCaptures] = useState<RecentCapture[]>([]);

  // Computed
  const isConfigured = useMemo(() => !!twentyUrl, [twentyUrl]);
  
  const connectionStatus = useMemo(() => {
    if (!isConfigured) return 'not-configured';
    if (!hasToken) return 'no-session';
    if (isConnected) return 'connected';
    return 'disconnected';
  }, [isConfigured, hasToken, isConnected]);

  const statusText = useMemo(() => {
    switch (connectionStatus) {
      case 'not-configured': return 'Not configured';
      case 'no-session': return 'Not logged in';
      case 'connected': return 'Connected';
      case 'disconnected': return 'Connection failed';
      default: return 'Unknown';
    }
  }, [connectionStatus]);

  const statusClass = useMemo(() => {
    switch (connectionStatus) {
      case 'connected': return 'status--connected';
      case 'no-session': return 'status--warning';
      default: return 'status--error';
    }
  }, [connectionStatus]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    loadRecentCaptures();
  }, []);

  async function loadSettings() {
    setIsLoading(true);
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_SETTINGS',
      }) as ExtensionResponse<{ twentyUrl: string; hasToken: boolean }>;
      
      if (response.success && response.data) {
        setTwentyUrl(response.data.twentyUrl || '');
        setHasToken(response.data.hasToken || false);
        
        if (response.data.hasToken) {
          await testConnection();
        }
      }
    } catch (err) {
      console.error('Error loading settings:', err);
      setError('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadRecentCaptures() {
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_RECENT_CAPTURES',
      }) as ExtensionResponse<RecentCapture[]>;
      
      if (response.success && response.data) {
        setRecentCaptures(response.data);
      }
    } catch (err) {
      console.error('Error loading recent captures:', err);
    }
  }

  async function saveSettings() {
    if (!twentyUrl) {
      setError('Please enter your Twenty URL');
      return;
    }
    
    // Normalize URL
    let url = twentyUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    url = url.replace(/\/$/, ''); // Remove trailing slash
    setTwentyUrl(url);
    
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await browser.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        payload: { twentyUrl: url },
      }) as ExtensionResponse;
      
      if (response.success) {
        setSuccess('Settings saved!');
        // Reload to check token
        await loadSettings();
      } else {
        setError(response.error || 'Failed to save settings');
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
      setTimeout(() => { setSuccess(null); }, 3000);
    }
  }

  async function testConnection() {
    setIsTesting(true);
    setError(null);
    
    try {
      const response = await browser.runtime.sendMessage({
        type: 'TEST_CONNECTION',
      }) as ExtensionResponse<{ connected: boolean }>;
      
      const connected = response.success && response.data?.connected === true;
      setIsConnected(connected);
      
      if (!connected) {
        setError('Connection test failed. Check your URL and login.');
      }
    } catch (err) {
      console.error('Error testing connection:', err);
      setIsConnected(false);
      setError('Connection test failed');
    } finally {
      setIsTesting(false);
    }
  }

  function openTwenty() {
    if (twentyUrl) {
      browser.tabs.create({ url: twentyUrl });
    }
  }

  function openRecord(record: { twentyId: string; type: string }) {
    if (twentyUrl) {
      // URL uses singular: /object/person/ and /object/company/
      browser.tabs.create({ 
        url: `${twentyUrl}/object/${record.type}/${record.twentyId}` 
      });
    }
  }

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      saveSettings();
    }
  }

  return (
    <div className="popup">
      {/* Header */}
      <header className="header">
        <div className="header__logo">
          <svg width="24" height="24" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="8" fill="#6366f1"/>
            <path d="M12 14h16v3H12zM12 20h12v3H12zM12 26h8v3H12z" fill="white"/>
          </svg>
          <span className="header__title">Twenty CRM</span>
        </div>
        <div className={`status-badge ${statusClass}`}>
          <span className="status-dot"></span>
          {statusText}
        </div>
      </header>

      {/* Loading State */}
      {isLoading ? (
        <div className="loading">
          <div className="spinner"></div>
          <span>Loading...</span>
        </div>
      ) : (
        /* Main Content */
        <main className="content">
          {/* Settings Section */}
          <section className="section">
            <h2 className="section__title">Settings</h2>
            
            <div className="form-group">
              <label className="label" htmlFor="twentyUrl">Twenty URL</label>
              <input
                id="twentyUrl"
                type="url"
                className="input"
                placeholder="https://your-twenty.com"
                value={twentyUrl}
                onChange={(e) => setTwentyUrl(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <p className="hint">Your self-hosted Twenty instance URL</p>
            </div>

            <div className="button-group">
              <button 
                className="btn btn--primary" 
                disabled={isSaving}
                onClick={saveSettings}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button 
                className="btn btn--secondary" 
                disabled={isTesting || !isConfigured}
                onClick={testConnection}
              >
                {isTesting ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            {/* Messages */}
            {error && (
              <div className="message message--error">
                {error}
              </div>
            )}
            {success && (
              <div className="message message--success">
                {success}
              </div>
            )}
          </section>

          {/* Login Prompt */}
          {isConfigured && !hasToken && (
            <section className="section section--warning">
              <p className="warning-text">
                Please log in to your Twenty instance to use the extension.
              </p>
              <button className="btn btn--primary" onClick={openTwenty}>
                Open Twenty →
              </button>
            </section>
          )}

          {/* Recent Captures */}
          {recentCaptures.length > 0 && (
            <section className="section">
              <h2 className="section__title">Recent Captures</h2>
              <ul className="captures-list">
                {recentCaptures.map((capture) => (
                  <li 
                    key={capture.twentyId}
                    className="capture-item"
                    onClick={() => openRecord(capture)}
                  >
                    <div className="capture-item__icon">
                      {capture.type === 'person' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                          <circle cx="12" cy="7" r="4"/>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/>
                        </svg>
                      )}
                    </div>
                    <div className="capture-item__info">
                      <span className="capture-item__name">{capture.name}</span>
                      <span className="capture-item__time">{formatDate(capture.capturedAt)}</span>
                    </div>
                    <svg className="capture-item__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Instructions */}
          <section className="section section--muted">
            <h2 className="section__title">How to use</h2>
            <ol className="instructions">
              <li>Enter your Twenty CRM URL above</li>
              <li>Log in to Twenty in your browser</li>
              <li>Visit any LinkedIn profile or company page</li>
              <li>Click the floating button to capture</li>
            </ol>
          </section>
        </main>
      )}
    </div>
  );
}
