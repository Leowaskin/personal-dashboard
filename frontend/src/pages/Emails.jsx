function Emails({ emails, loadingEmails, isAuthenticated }) {
  return (
    <div className="glass-panel" style={{ viewTransitionName: 'page-content', height: '100%', overflowY: 'auto' }}>
      <h2>📧 Important Emails</h2>
      <div className="card-list">
        {!isAuthenticated ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ color: '#94a3b8', marginBottom: '1rem' }}>Your Google session has expired or is not connected.</p>
            <a href="http://localhost:5001/auth/google" className="auth-btn" style={{ display: 'inline-block' }}>
              Connect Google Account
            </a>
          </div>
        ) : loadingEmails ? (
          <p style={{ color: '#94a3b8' }}>Loading important emails...</p>
        ) : emails.length > 0 ? (
          emails.map(email => (
            <div className="list-item" key={email.id}>
              <div className="item-details">
                <span className="item-title">{email.subject}</span>
                <span className="item-meta">From: {email.from}</span>
              </div>
              <div className="status-dot important"></div>
            </div>
          ))
        ) : (
          <p style={{ color: '#94a3b8' }}>No unread important emails right now.</p>
        )}
      </div>
    </div>
  );
}

export default Emails;
