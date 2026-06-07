import React, { useState, useEffect, useRef } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'system' | 'toolResult' | 'toolCall';
  content: string;
  thinking?: string;
  streaming?: boolean;
  toolName?: string;
  diff?: string;
}

interface Attachment {
  id: string;
  type: 'image' | 'file';
  fileName: string;
  mimeType: string;
  size: number;
  content: string; // base64
}

interface ExtensionUIRequest {
  type: 'extension_ui_request';
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor' | 'notify';
  title?: string;
  options?: string[];
  message?: string;
  placeholder?: string;
  prefill?: string;
}

const BUILTIN_COMMANDS = [
  { name: 'settings', description: 'Open settings menu' },
  { name: 'model', description: 'Select model (opens selector UI)' },
  { name: 'session', description: 'Show session info and stats' },
  { name: 'stats', description: 'Alias for /session' },
  { name: 'name', description: 'Set session display name' },
  { name: 'new', description: 'Start a new session' },
  { name: 'clear', description: 'Alias for /new' },
  { name: 'fork', description: 'Fork from a previous message' },
  { name: 'clone', description: 'Clone current session' },
  { name: 'compact', description: 'Manually compact context' },
  { name: 'export', description: 'Export session to HTML' },
  { name: 'copy', description: 'Copy last assistant message' },
  { name: 'skills', description: 'List available skills' },
  { name: 'abort', description: 'Abort current run' },
  { name: 'help', description: 'Show help' },
];

const DiffViewer = ({ diff }: { diff: string }) => {
  const lines = diff.split('\n');
  return (
    <div className="diff-viewer">
      {lines.map((line, i) => {
        let className = 'diff-line';
        if (line.startsWith('+')) className += ' diff-added';
        else if (line.startsWith('-')) className += ' diff-removed';
        return (
          <div key={i} className={className}>
            {line}
          </div>
        );
      })}
    </div>
  );
};

const SVGRenderer = ({ content }: { content: string }) => {
  const parts = content.split(/(<svg[\s\S]*?<\/svg>)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('<svg')) {
          return (
            <div 
              key={i} 
              className="inline-svg-container" 
              dangerouslySetInnerHTML={{ __html: part }} 
            />
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
};

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState(BUILTIN_COMMANDS);
  const [isWorking, setIsWorking] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [modelInfo, setModelInfo] = useState({ name: '', usage: '0.0%/128k (auto)' });
  const [thinkingLevel, setThinkingLevel] = useState('medium');
  const [workspace, setWorkspace] = useState('/home/deepi/pi-ui');
  const [uiRequest, setUIRequest] = useState<ExtensionUIRequest | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const ws = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && uiRequest) {
        handleUIResponse({ cancelled: true });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [uiRequest]);

  const fetchState = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'get_state' }));
    }
  };

  const sessionPaths = useRef<Record<string, string>>({});

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.host;
    const socket = new WebSocket(`${protocol}//${host}`);

    socket.onopen = () => {
      setIsConnected(true);
      setMessages([{ role: 'system', content: 'Connected to Pi RPC' }]);
      socket.send(JSON.stringify({ type: 'get_state' }));
      socket.send(JSON.stringify({ type: 'get_messages' }));
    };

    socket.onerror = (error) => {
      console.error('WebSocket Error:', error);
      setMessages(prev => [...prev, { role: 'system', content: 'WebSocket Error. Check server console.' }]);
    };

    socket.onclose = () => {
      setIsConnected(false);
      setMessages(prev => [...prev, { role: 'system', content: 'Disconnected from server' }]);
    };

    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      if (data.type === 'agent_start' || data.type === 'turn_start') {
        setIsWorking(true);
      } else if (data.type === 'turn_end' || data.type === 'agent_end') {
        setIsWorking(false);
        setMessages(prev => prev.map(m => ({ ...m, streaming: false })));
        fetchState();
      } else if (data.type === 'message_start' && data.message?.role === 'assistant') {
        const model = data.message.model || '';
        if (model) setModelInfo(prev => ({ ...prev, name: model }));
      } else if (data.type === 'message_update') {
        const eventType = data.assistantMessageEvent?.type;
        const delta = data.assistantMessageEvent?.delta;
        
        const usage = data.assistantMessageEvent?.usage || data.message?.usage;
        if (usage) {
          const total = usage.totalTokens || 0;
          const limit = 128000;
          const percent = ((total / limit) * 100).toFixed(1);
          setModelInfo(prev => ({ ...prev, usage: `${percent}%/128k (auto)` }));
        }

        if (eventType === 'text_delta' || (!eventType && typeof delta === 'string')) {
          const text = typeof delta === 'string' ? delta : (delta?.text || '');
          if (text) {
            setMessages(prev => {
              const lastMessage = prev[prev.length - 1];
              if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
                return [...prev.slice(0, -1), { ...lastMessage, content: lastMessage.content + text }];
              } else {
                return [...prev, { role: 'assistant', content: text, streaming: true }];
              }
            });
          }
        } else if (eventType === 'thinking_delta') {
          const thinking = typeof delta === 'string' ? delta : (delta?.thinking || '');
          if (thinking) {
            setMessages(prev => {
              const lastMessage = prev[prev.length - 1];
              if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
                return [...prev.slice(0, -1), { ...lastMessage, thinking: (lastMessage.thinking || '') + thinking }];
              } else {
                return [...prev, { role: 'assistant', content: '', thinking: thinking, streaming: true }];
              }
            });
          }
        }
      } else if (data.type === 'tool_result') {
        const diff = data.details?.diff;
        const text = data.content?.map((c: any) => c.text).join('\n') || '';
        setMessages(prev => [...prev, {
          role: 'toolResult',
          content: text,
          toolName: data.toolName,
          diff: diff
        }]);
      } else if (data.type === 'extension_ui_request') {
        setUIRequest(data);
      } else if (data.type === 'response') {
        if (data.command === 'list_sessions' && data.success) {
          const sessions = data.data.sessions || [];
          const paths: Record<string, string> = {};
          sessions.forEach((s: any) => { paths[s.name] = s.path; });
          sessionPaths.current = paths;
          
          setUIRequest({
            type: 'extension_ui_request',
            id: 'internal-session-selector',
            method: 'select',
            title: `Resume Session (${sessions.length} found)`,
            options: sessions.map((s: any) => s.name)
          });
        } else if (data.command === 'switch_session' && data.success) {
          setMessages([{ role: 'system', content: 'Switched session' }]);
          socket.send(JSON.stringify({ type: 'get_messages' }));
          fetchState();
        } else if (data.command === 'get_available_models' && data.success) {
          const models = data.data.models || [];
          setUIRequest({
            type: 'extension_ui_request',
            id: 'internal-model-selector',
            method: 'select',
            title: `Select Model (${models.length} found)`,
            options: models.map((m: any) => `${m.provider}/${m.id} (${m.name})`)
          });
        } else if (data.command === 'get_messages' && data.success) {
          const history = data.data.messages.map((m: any) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : m.content?.map((c: any) => c.text).join('') || '',
            thinking: m.thinking,
            toolName: m.toolName,
            diff: m.details?.diff
          })).filter((m: any) => ['user', 'assistant', 'toolResult'].includes(m.role));
          setMessages(prev => [prev[0], ...history]);
        } else if (data.command === 'get_commands' && data.success) {
          const commands = data.data.commands || [];
          const content = commands.length > 0 
            ? 'Available Commands:\n' + commands.map((c: any) => `/${c.name} - ${c.description || ''}`).join('\n')
            : 'No skills or extensions found.';
          setMessages(prev => [...prev, { role: 'system', content }]);
        } else if (data.command === 'get_session_stats' && data.success) {
          const stats = data.data;
          const content = `Session Stats:\nTokens: ${stats.tokens.total} (In: ${stats.tokens.input}, Out: ${stats.tokens.output})\nCost: $${stats.cost.toFixed(4)}\nMessages: ${stats.totalMessages}`;
          setMessages(prev => [...prev, { role: 'system', content }]);
        } else if (data.command === 'get_state' && data.success) {
          setSettings(data.data);
          if (data.data.model) {
            setModelInfo(prev => ({ ...prev, name: data.data.model.id }));
          }
          if (data.data.thinkingLevel) {
            setThinkingLevel(data.data.thinkingLevel);
          }
        } else if (data.command === 'export_html' && data.success) {
          setMessages(prev => [...prev, { role: 'system', content: `Exported to: ${data.data.path}` }]);
        } else if (data.command === 'get_fork_messages' && data.success) {
          const options = data.data.messages.map((m: any) => `${m.entryId}: ${m.text.slice(0, 50)}...`);
          setUIRequest({
            type: 'extension_ui_request',
            id: 'internal-fork-selector',
            method: 'select',
            title: 'Fork from message',
            options
          });
        } else if (data.command === 'get_last_assistant_text' && data.success) {
          if (data.data.text) {
            navigator.clipboard.writeText(data.data.text);
            setMessages(prev => [...prev, { role: 'system', content: 'Copied last response to clipboard' }]);
          }
        } else if (data.command === 'set_model' && data.success) {
          setMessages(prev => [...prev, { role: 'system', content: `Model changed to ${data.data.id}` }]);
          fetchState();
        } else if (data.command === 'set_thinking_level' && data.success) {
          setMessages(prev => [...prev, { role: 'system', content: 'Thinking level updated' }]);
          fetchState();
        } else if (!data.success) {
          setMessages(prev => [...prev, { role: 'system', content: `Error: ${data.error}` }]);
        }
      } else if (data.type === 'stderr') {
        setMessages(prev => [...prev, { role: 'system', content: `Pi: ${data.message}` }]);
      } else if (data.type === 'exit') {
        setMessages(prev => [...prev, { role: 'system', content: `Pi exited with code ${data.code}` }]);
        setIsWorking(false);
      }
    };

    socket.onclose = () => {
      setMessages(prev => [...prev, { role: 'system', content: 'Disconnected from server' }]);
    };

    ws.current = socket;

    return () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (val.startsWith('/')) {
      const search = val.slice(1).toLowerCase();
      setFilteredCommands(BUILTIN_COMMANDS.filter(c => c.name.startsWith(search)));
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleFileClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      const contentPromise = new Promise<string>((resolve) => {
        reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
      });
      reader.readAsDataURL(file);
      const content = await contentPromise;

      newAttachments.push({
        id: Math.random().toString(36).substr(2, 9),
        type: file.type.startsWith('image/') ? 'image' : 'file',
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        content: content
      });
    }
    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const [showThinkingDropdown, setShowThinkingDropdown] = useState(false);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(event.target as Node)) {
        setShowThinkingDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openThinkingSelector = () => {
    setShowThinkingDropdown(!showThinkingDropdown);
  };

  const setLevel = (level: string) => {
    ws.current?.send(JSON.stringify({ type: 'set_thinking_level', level }));
    setThinkingLevel(level);
    setShowThinkingDropdown(false);
  };

  const openHistorySelector = () => {
    ws.current?.send(JSON.stringify({ type: 'list_sessions' }));
  };

  const sendMessage = (overrideText?: string) => {
    const text = (overrideText || inputValue).trim();
    if (!text && attachments.length === 0) return;
    if (!ws.current) return;
    
    // Don't add internal-only commands to chat history
    const isInternalCmd = text === '/model' || text === '/thinking' || text === '/abort';
    if (!isInternalCmd) {
      setMessages(prev => [...prev, { role: 'user', content: text }]);
    }
    
    setShowSuggestions(false);

    if (text.startsWith('/') && attachments.length === 0) {
      const parts = text.split(' ');
      const cmd = parts[0].toLowerCase();
      
      if (cmd === '/settings') {
        ws.current.send(JSON.stringify({ type: 'get_state' }));
        setUIRequest({
          type: 'extension_ui_request',
          id: 'internal-settings-menu',
          method: 'select',
          title: 'Settings',
          options: [
            `Thinking Level (${settings?.thinkingLevel || 'auto'})`,
            `Auto-compact (${settings?.autoCompactionEnabled ? 'ON' : 'OFF'})`,
            `Steering Mode (${settings?.steeringMode || 'off'})`,
            `Follow-up Mode (${settings?.followUpMode || 'off'})`,
            `Auto-retry (${settings?.autoRetryEnabled ? 'ON' : 'OFF'})`,
            'Back'
          ]
        });
      } else if (cmd === '/model') {
        ws.current.send(JSON.stringify({ type: 'get_available_models' }));
      } else if (cmd === '/skills' || cmd === '/commands') {
        ws.current.send(JSON.stringify({ type: 'get_commands' }));
      } else if (cmd === '/stats' || cmd === '/session') {
        ws.current.send(JSON.stringify({ type: 'get_session_stats' }));
      } else if (cmd === '/compact') {
        ws.current.send(JSON.stringify({ type: 'compact' }));
      } else if (cmd === '/clear' || cmd === '/new') {
        ws.current.send(JSON.stringify({ type: 'new_session' }));
        setMessages([{ role: 'system', content: 'Started new session' }]);
      } else if (cmd === '/abort') {
        ws.current.send(JSON.stringify({ type: 'abort' }));
        setIsWorking(false);
      } else if (cmd === '/name') {
        const name = parts.slice(1).join(' ');
        if (name) ws.current.send(JSON.stringify({ type: 'set_session_name', name }));
        else setMessages(prev => [...prev, { role: 'system', content: 'Usage: /name <session-name>' }]);
      } else if (cmd === '/export') {
        ws.current.send(JSON.stringify({ type: 'export_html' }));
      } else if (cmd === '/copy') {
        ws.current.send(JSON.stringify({ type: 'get_last_assistant_text' }));
      } else if (cmd === '/fork') {
        ws.current.send(JSON.stringify({ type: 'get_fork_messages' }));
      } else if (cmd === '/clone') {
        ws.current.send(JSON.stringify({ type: 'clone' }));
        setMessages(prev => [...prev, { role: 'system', content: 'Session cloned' }]);
      } else if (cmd === '/help') {
        setMessages(prev => [...prev, { role: 'system', content: 'Supported commands: ' + BUILTIN_COMMANDS.map(c => `/${c.name}`).join(', ') }]);
      } else {
        ws.current.send(JSON.stringify({ type: 'prompt', message: text }));
      }
    } else {
      ws.current.send(JSON.stringify({ 
        type: 'prompt', 
        message: text,
        attachments: attachments 
      }));
      setAttachments([]);
    }
    setInputValue('');
  };

  const handleUIResponse = (response: any) => {
    if (!ws.current || !uiRequest) return;

    if (response.cancelled) {
      if (!uiRequest.id.startsWith('internal-')) {
        ws.current.send(JSON.stringify({
          type: 'extension_ui_response',
          id: uiRequest.id,
          cancelled: true
        }));
      }
      setUIRequest(null);
      return;
    }

    if (uiRequest.id === 'internal-session-selector') {
      if (response.value) {
        const path = sessionPaths.current[response.value];
        if (path) ws.current.send(JSON.stringify({ type: 'switch_session', sessionPath: path }));
      }
      setUIRequest(null);
      return;
    }

    if (uiRequest.id === 'internal-settings-menu') {
      const val = response.value;
      if (val.startsWith('Thinking Level')) {
        setUIRequest({
          type: 'extension_ui_request',
          id: 'internal-thinking-selector',
          method: 'select',
          title: 'Select Thinking Level',
          options: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
        });
      } else if (val.startsWith('Auto-compact')) {
        ws.current.send(JSON.stringify({ type: 'set_auto_compaction', enabled: !settings?.autoCompactionEnabled }));
        setUIRequest(null);
      } else if (val.startsWith('Steering Mode')) {
        setUIRequest({
          type: 'extension_ui_request',
          id: 'internal-steering-selector',
          method: 'select',
          title: 'Select Steering Mode',
          options: ['off', 'one-at-a-time', 'immediate']
        });
      } else if (val.startsWith('Follow-up Mode')) {
        setUIRequest({
          type: 'extension_ui_request',
          id: 'internal-followup-selector',
          method: 'select',
          title: 'Select Follow-up Mode',
          options: ['off', 'one-at-a-time', 'immediate']
        });
      } else if (val.startsWith('Auto-retry')) {
        ws.current.send(JSON.stringify({ type: 'set_auto_retry', enabled: !settings?.autoRetryEnabled }));
        setUIRequest(null);
      } else {
        setUIRequest(null);
      }
      return;
    }

    if (uiRequest.id === 'internal-model-selector') {
      if (response.value) {
        const fullValue = response.value;
        const modelIdPart = fullValue.split(' (')[0];
        const parts = modelIdPart.split('/');
        if (parts.length > 1) ws.current.send(JSON.stringify({ type: 'set_model', provider: parts[0], modelId: parts.slice(1).join('/') }));
        else ws.current.send(JSON.stringify({ type: 'set_model', modelId: modelIdPart }));
      }
      setUIRequest(null);
      return;
    }

    if (uiRequest.id === 'internal-thinking-selector') {
      if (response.value) ws.current.send(JSON.stringify({ type: 'set_thinking_level', level: response.value }));
      setUIRequest(null);
      return;
    }

    if (uiRequest.id === 'internal-steering-selector') {
      if (response.value) ws.current.send(JSON.stringify({ type: 'set_steering_mode', mode: response.value }));
      setUIRequest(null);
      return;
    }

    if (uiRequest.id === 'internal-followup-selector') {
      if (response.value) ws.current.send(JSON.stringify({ type: 'set_follow_up_mode', mode: response.value }));
      setUIRequest(null);
      return;
    }

    if (uiRequest.id === 'internal-fork-selector') {
      if (response.value) {
        const entryId = response.value.split(':')[0];
        ws.current.send(JSON.stringify({ type: 'fork', entryId }));
        setMessages(prev => [...prev, { role: 'system', content: `Forked from ${entryId}` }]);
      }
      setUIRequest(null);
      return;
    }

    ws.current.send(JSON.stringify({
      type: 'extension_ui_response',
      id: uiRequest.id,
      ...response
    }));
    setUIRequest(null);
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="header-title">
          <div className="title-row">
            <h2>Pi Chat</h2>
            <span className={`status-indicator ${isConnected ? 'online' : 'offline'}`}>
              {isConnected ? '● Online' : '○ Offline'}
            </span>
          </div>
          {settings?.sessionId && <span className="session-id">{settings.sessionId.slice(0, 8)}</span>}
        </div>
        <div className="header-actions">
          {isWorking && (
            <div className="status-working">
              <div className="dot"></div>
            </div>
          )}
          <button className="history-btn" onClick={openHistorySelector} title="Session History">
            🕒 History
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.role === 'assistant' && <span className="assistant-prefix">╰─</span>}
            <div className="message-body">
              {msg.thinking && <div className="thinking-block">{msg.thinking}</div>}
              {msg.role === 'toolResult' && <div className="tool-header">Tool: {msg.toolName}</div>}
              <SVGRenderer content={msg.content} />
              {msg.diff && <DiffViewer diff={msg.diff} />}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area-wrapper">
        <div className="workspace-header">
          <span className="workspace-path">~/ {workspace.split('/').pop()}</span>
        </div>
        {showSuggestions && filteredCommands.length > 0 && (
          <div className="command-suggestions">
            {filteredCommands.map((c) => (
              <div key={c.name} className="suggestion-item" onClick={() => sendMessage(`/${c.name}`)}>
                <span className="suggestion-name">/{c.name}</span>
                <span className="suggestion-desc">{c.description}</span>
              </div>
            ))}
          </div>
        )}
        <div className={`input-card ${isWorking ? 'input-busy' : ''}`}>
          {attachments.length > 0 && (
            <div className="attachment-list">
              {attachments.map(a => (
                <div key={a.id} className="attachment-tile">
                  <span className="file-name">{a.fileName}</span>
                  <button className="remove-btn" onClick={() => removeAttachment(a.id)}>&times;</button>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!isWorking) sendMessage();
              }
            }}
            placeholder={isWorking ? "Agent is working..." : "Type a message or / for commands..."}
            disabled={isWorking || !!uiRequest}
            rows={1}
          />
          <div className="input-actions">
            <div className="actions-left">
              <button 
                className="action-icon-btn" 
                onClick={handleFileClick}
                disabled={isWorking || !!uiRequest}
                title="Attach Files"
              >
                📎
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                style={{display: 'none'}} 
                onChange={handleFileChange}
                multiple 
              />
              <div className="thinking-container" ref={thinkingDropdownRef}>
                <button 
                  className={`thinking-pill ${showThinkingDropdown ? 'active' : ''}`} 
                  onClick={openThinkingSelector}
                  disabled={isWorking || !!uiRequest}
                >
                  <span>🧠 {thinkingLevel}</span>
                </button>
                {showThinkingDropdown && (
                  <div className="thinking-dropdown">
                    {['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map(l => (
                      <div key={l} className={`dropdown-item ${thinkingLevel === l ? 'selected' : ''}`} onClick={() => setLevel(l)}>
                        {l}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="actions-right">
              {modelInfo.name && (
                <button 
                  className="model-pill" 
                  onClick={() => sendMessage('/model')}
                  disabled={isWorking || !!uiRequest}
                >
                  <span>{modelInfo.name.split('/').pop()}</span>
                </button>
              )}
              {isWorking ? (
                <button 
                  className="stop-icon-btn" 
                  onClick={() => sendMessage('/abort')} 
                  title="Stop (Esc)"
                >
                  <span className="stop-square">■</span>
                </button>
              ) : (
                <button 
                  className="send-icon-btn" 
                  onClick={() => sendMessage()} 
                  disabled={!!uiRequest || (!inputValue.trim() && attachments.length === 0)}
                  title="Send"
                >
                  <span className="send-arrow">▲</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {uiRequest && (
        <div className="dialog-overlay" onClick={() => handleUIResponse({ cancelled: true })}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>{uiRequest.title || 'Request'}</h3>
              <button className="close-x-btn" onClick={() => handleUIResponse({ cancelled: true })} title="Close (Esc)">
                &times;
              </button>
            </div>
            {uiRequest.message && <p className="dialog-message">{uiRequest.message}</p>}
            <div className="dialog-options">
              {uiRequest.method === 'select' && uiRequest.options?.map((opt, i) => (
                <button key={i} className="dialog-btn" onClick={() => handleUIResponse({ value: opt })}>
                  {opt}
                </button>
              ))}
              {uiRequest.method === 'confirm' && (
                <div className="dialog-btn-group">
                  <button className="dialog-btn" onClick={() => handleUIResponse({ confirmed: true })}>Yes</button>
                  <button className="dialog-btn" onClick={() => handleUIResponse({ confirmed: false })}>No</button>
                </div>
              )}
              {uiRequest.method === 'input' && (
                <div className="dialog-input-group">
                  <input type="text" placeholder={uiRequest.placeholder} autoFocus id="dialog-input" className="dialog-input" onKeyPress={(e) => {
                    if (e.key === 'Enter') handleUIResponse({ value: (e.target as HTMLInputElement).value });
                  }} />
                  <button onClick={() => {
                    const el = document.getElementById('dialog-input') as HTMLInputElement;
                    handleUIResponse({ value: el.value });
                  }}>Submit</button>
                </div>
              )}
              <button className="dialog-btn cancel-btn" onClick={() => handleUIResponse({ cancelled: true })}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
