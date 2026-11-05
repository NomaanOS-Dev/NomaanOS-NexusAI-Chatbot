import React, { useState } from 'react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (data: {
    email: string;
    password: string;
    fullName?: string;
    organizationName?: string;
    workspaceName?: string;
  }) => Promise<void>;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLogin,
  onRegister,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [wsName, setWsName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        await onLogin(email, password);
      } else {
        await onRegister({
          email,
          password,
          fullName: fullName.trim() || undefined,
          organizationName: orgName.trim() || undefined,
          workspaceName: wsName.trim() || undefined,
        });
      }
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="nexus-modal-overlay" onClick={onClose}>
      <div className="nexus-modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="nexus-modal-header">
          <h3>{mode === 'login' ? 'Sign In to Nexus AI' : 'Create Operator Account'}</h3>
          <button type="button" className="nexus-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="nexus-tabs-sub" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`nexus-tab-sub-btn ${mode === 'login' ? 'active' : ''}`}
            onClick={() => {
              setMode('login');
              setErrorMessage(null);
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`nexus-tab-sub-btn ${mode === 'register' ? 'active' : ''}`}
            onClick={() => {
              setMode('register');
              setErrorMessage(null);
            }}
          >
            Register Project
          </button>
        </div>



        <form onSubmit={handleSubmit}>
          {errorMessage && <div className="nexus-form-error">{errorMessage}</div>}

          {mode === 'register' && (
            <>
              <div className="nexus-form-group">
                <label className="nexus-form-label">Full Name</label>
                <input
                  type="text"
                  className="nexus-input"
                  placeholder="e.g. Lead Engineer"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="nexus-form-group">
                <label className="nexus-form-label">Initial Project / Workspace Name</label>
                <input
                  type="text"
                  className="nexus-input"
                  placeholder="e.g. Sentinel Security Ops"
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </>
          )}

          <div className="nexus-form-group">
            <label className="nexus-form-label">Email Address *</label>
            <input
              type="email"
              className="nexus-input"
              placeholder="operator@nomaanos.internal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="nexus-form-group">
            <label className="nexus-form-label">Password *</label>
            <input
              type="password"
              className="nexus-input"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="nexus-modal-actions" style={{ marginTop: 20 }}>
            <button type="button" className="nexus-btn-ghost" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="nexus-btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

