import { useState } from 'react';

function Schedule({ events, loadingEvents, isAuthenticated, fetchDashboardData }) {
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventForm, setEventForm] = useState({ summary: '', start: '', end: '' });

  const formatTime = (isoString) => {
    if (!isoString) return 'All Day';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const handleAddEvent = async (e) => {
    e.preventDefault();
    try {
      await fetch('http://localhost:5001/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventForm)
      });
      setShowEventModal(false);
      setEventForm({ summary: '', start: '', end: '' });
      fetchDashboardData();
    } catch (error) {
      console.error('Error adding event', error);
    }
  };

  return (
    <div className="glass-panel" style={{ viewTransitionName: 'page-content', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ marginBottom: 0 }}>📅 Today's Schedule</h2>
        {isAuthenticated && (
          <button onClick={() => setShowEventModal(true)} className="icon-btn" title="Add Event">+</button>
        )}
      </div>
      
      <div className="card-list">
        {!isAuthenticated ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ color: '#94a3b8', marginBottom: '1rem' }}>Your Google session has expired or is not connected.</p>
            <a href="http://localhost:5001/auth/google" className="auth-btn" style={{ display: 'inline-block' }}>
              Connect Google Account
            </a>
          </div>
        ) : loadingEvents ? (
          <p style={{ color: '#94a3b8' }}>Loading schedule...</p>
        ) : events.length > 0 ? (
          events.map(event => (
            <div className="list-item" key={event.id}>
              <div className="item-details">
                <span className="item-title">{event.summary}</span>
                <span className="item-meta">
                  {event.start?.dateTime ? `${formatTime(event.start.dateTime)} - ${formatTime(event.end.dateTime)}` : 'All Day'}
                </span>
              </div>
              <div className="status-dot"></div>
            </div>
          ))
        ) : (
          <p style={{ color: '#94a3b8' }}>No events scheduled for today. Enjoy!</p>
        )}
      </div>

      {showEventModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel">
            <h3>Add New Calendar Event</h3>
            <form onSubmit={handleAddEvent} className="modal-form">
              <input 
                type="text" 
                placeholder="Event Title" 
                required 
                value={eventForm.summary} 
                onChange={e => setEventForm({...eventForm, summary: e.target.value})} 
              />
              <div className="form-group">
                <label>Start Time</label>
                <input 
                  type="datetime-local" 
                  required 
                  value={eventForm.start} 
                  onChange={e => setEventForm({...eventForm, start: e.target.value})} 
                />
              </div>
              <div className="form-group">
                <label>End Time</label>
                <input 
                  type="datetime-local" 
                  required 
                  value={eventForm.end} 
                  onChange={e => setEventForm({...eventForm, end: e.target.value})} 
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowEventModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Event</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Schedule;
