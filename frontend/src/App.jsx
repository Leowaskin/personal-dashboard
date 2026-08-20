import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './index.css';

import Sidebar from './components/Sidebar';
import Home from './pages/Home';
import Schedule from './pages/Schedule';
import Routine from './pages/Routine';
import Emails from './pages/Emails';

function App() {
  const [greeting, setGreeting] = useState('');
  const [time, setTime] = useState(new Date());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [emails, setEmails] = useState([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  
  // Daily Routine Tasks State
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    // Dynamic greeting based on time of day
    const hour = time.getHours();
    if (hour < 12) setGreeting('Good Morning');
    else if (hour < 18) setGreeting('Good Afternoon');
    else setGreeting('Good Evening');

    // Update time every minute
    const timer = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, [time]);

  const fetchDashboardData = async () => {
    try {
      const authRes = await fetch('http://localhost:5001/api/auth/status');
      const authData = await authRes.json();
      setIsAuthenticated(authData.authenticated);

      // Always fetch local tasks regardless of Google Auth
      const tasksRes = await fetch('http://localhost:5001/api/tasks');
      const tasksData = await tasksRes.json();
      setTasks(tasksData.tasks || []);

      if (authData.authenticated) {
        setLoadingEvents(true);
        setLoadingEmails(true);
        
        const [eventsRes, emailsRes] = await Promise.all([
          fetch('http://localhost:5001/api/calendar/events'),
          fetch('http://localhost:5001/api/gmail/important')
        ]);

        if (eventsRes.status === 401 || emailsRes.status === 401) {
          setIsAuthenticated(false);
          setEvents([]);
          setEmails([]);
          setLoadingEvents(false);
          setLoadingEmails(false);
          return;
        }

        const eventsData = await eventsRes.json();
        if (eventsData.events) {
          setEvents(eventsData.events);
        }
        setLoadingEvents(false);

        const emailsData = await emailsRes.json();
        if (emailsData.emails) {
          setEmails(emailsData.emails);
        }
        setLoadingEmails(false);
      } else {
        setEvents([]);
        setEmails([]);
      }
    } catch (error) {
      console.error('Error fetching data from backend:', error);
      setLoadingEvents(false);
      setLoadingEmails(false);
    }
  };

  useEffect(() => {
    // Check if redirected from Google OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    fetchDashboardData();
  }, []);

  return (
    <Router>
      <div className="dashboard-container">
        {/* Sidebar Navigation */}
        <Sidebar />

        {/* Main Content Area */}
        <main className="main-content">
          <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <h1>{greeting}, Leo!</h1>
              <p className="subtitle">Here is your overview for today, {time.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.</p>
            </div>
            {!isAuthenticated && (
              <a href="http://localhost:5001/auth/google" className="auth-btn">
                Connect Google Account
              </a>
            )}
          </div>

          <div style={{ flex: 1, position: 'relative' }}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/schedule" element={
                <Schedule 
                  events={events} 
                  loadingEvents={loadingEvents} 
                  isAuthenticated={isAuthenticated} 
                  fetchDashboardData={fetchDashboardData} 
                />
              } />
              <Route path="/routine" element={
                <Routine 
                  tasks={tasks} 
                  fetchDashboardData={fetchDashboardData} 
                />
              } />
              <Route path="/emails" element={
                <Emails 
                  emails={emails} 
                  loadingEmails={loadingEmails} 
                  isAuthenticated={isAuthenticated} 
                />
              } />
            </Routes>
          </div>
        </main>
      </div>
    </Router>
  );
}

export default App;
