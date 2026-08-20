import { useState } from 'react';

function Routine({ tasks, fetchDashboardData }) {
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '' });

  const handleAddTask = async (e) => {
    e.preventDefault();
    try {
      await fetch('http://localhost:5001/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: taskForm.title, completed: false })
      });
      setShowTaskModal(false);
      setTaskForm({ title: '' });
      fetchDashboardData();
    } catch (error) {
      console.error('Error adding task', error);
    }
  };

  const toggleTask = async (task) => {
    try {
      await fetch('http://localhost:5001/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...task, completed: !task.completed })
      });
      fetchDashboardData();
    } catch (error) {
      console.error('Error toggling task', error);
    }
  };
  
  const deleteTask = async (id) => {
    try {
      await fetch(`http://localhost:5001/api/tasks/${id}`, { method: 'DELETE' });
      fetchDashboardData();
    } catch (error) {
      console.error('Error deleting task', error);
    }
  };

  return (
    <div className="glass-panel" style={{ viewTransitionName: 'page-content', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ marginBottom: 0 }}>✅ Daily Routine</h2>
        <button onClick={() => setShowTaskModal(true)} className="icon-btn" title="Add Task">+</button>
      </div>
      <div className="card-list">
        {tasks.length > 0 ? (
          tasks.map(task => (
            <div className="list-item" key={task.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label className="checkbox-container">
                <input 
                  type="checkbox" 
                  checked={task.completed} 
                  onChange={() => toggleTask(task)} 
                />
                <span className={`checkmark ${task.completed ? 'checked' : ''}`}></span>
                <span className="item-title" style={{ textDecoration: task.completed ? 'line-through' : 'none', color: task.completed ? '#64748b' : 'inherit' }}>
                  {task.title}
                </span>
              </label>
              <button onClick={() => deleteTask(task.id)} className="delete-btn">✕</button>
            </div>
          ))
        ) : (
          <p style={{ color: '#94a3b8' }}>No routine tasks added yet.</p>
        )}
      </div>

      {showTaskModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel">
            <h3>Add Daily Routine Task</h3>
            <form onSubmit={handleAddTask} className="modal-form">
              <input 
                type="text" 
                placeholder="e.g. 5 times prayer, Gym, Read 10 pages" 
                required 
                value={taskForm.title} 
                onChange={e => setTaskForm({...taskForm, title: e.target.value})} 
              />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowTaskModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Add Task</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Routine;
