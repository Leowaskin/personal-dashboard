import { useState } from 'react';

function Home() {
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([
    { role: 'assistant', content: 'Hello Leo! I am your personal AI assistant. How can I help you today?' }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMessage = { role: 'user', content: chatInput };
    setChatHistory(prev => [...prev, userMessage]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const res = await fetch('http://localhost:5001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userMessage.content })
      });
      const data = await res.json();
      setChatHistory(prev => [...prev, { role: 'assistant', content: data.reply || data.error }]);
    } catch (error) {
      setChatHistory(prev => [...prev, { role: 'assistant', content: 'Sorry, I could not connect to the AI engine.' }]);
    }
    setIsChatLoading(false);
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', viewTransitionName: 'page-content' }}>
      <h2>🤖 Personal AI Assistant</h2>
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '0.5rem' }}>
        {chatHistory.map((msg, index) => (
          <div key={index} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            backgroundColor: msg.role === 'user' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            padding: '0.75rem 1rem',
            borderRadius: '12px',
            maxWidth: '80%',
            lineHeight: '1.4'
          }}>
            {msg.content}
          </div>
        ))}
        {isChatLoading && (
          <div style={{ alignSelf: 'flex-start', color: '#94a3b8' }}>Thinking...</div>
        )}
      </div>
      <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
        <input 
          type="text" 
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          placeholder="Ask anything or request a summary..." 
          style={{
            flex: 1, padding: '0.75rem 1rem', background: 'rgba(15, 23, 42, 0.5)', 
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white'
          }}
        />
        <button type="submit" className="btn-primary" disabled={isChatLoading}>Send</button>
      </form>
    </div>
  );
}

export default Home;
