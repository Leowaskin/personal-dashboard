import { useNavigate, useLocation } from 'react-router-dom';

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavigation = (to) => {
    if (location.pathname === to) return;
    if (!document.startViewTransition) {
      navigate(to);
    } else {
      document.startViewTransition(() => {
        navigate(to);
      });
    }
  };

  const navItems = [
    { path: '/', label: '🤖 AI Assistant' },
    { path: '/schedule', label: '📅 Schedule' },
    { path: '/routine', label: '✅ Daily Routine' },
    { path: '/emails', label: '📧 Important Emails' }
  ];

  return (
    <aside className="glass-panel sidebar">
      <h2>Dashboard</h2>
      {navItems.map((item) => (
        <div 
          key={item.path}
          className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
          onClick={() => handleNavigation(item.path)}
          style={{ cursor: 'pointer' }}
        >
          <span>{item.label}</span>
        </div>
      ))}
      <div style={{ marginTop: 'auto', cursor: 'pointer' }} className="nav-item">
        <span>⚙️ Settings</span>
      </div>
    </aside>
  );
}

export default Sidebar;
