'use strict';

// ── State ───────────────────────────────────────────────────
const state = {
  apiKey: sessionStorage.getItem('gedion_api_key') || '',
  messages: [],          // Full conversation history for Gemini API
  isLoading: false,
  abortController: null,
  sessionCount: 0,
};

// ── Gedion System Prompt ────────────────────────────────────
const SYSTEM_INSTRUCTION = `You are Gedion, a highly intelligent, articulate, and helpful AI assistant with a professional and warm female persona. You are powered by Google Gemini.

You can help with absolutely anything:
- Answering questions on any topic
- Writing, editing, and proofreading
- Coding in any programming language
- Analysis, research, and summarization
- Creative writing, brainstorming, and ideation
- Math, science, history, philosophy — anything
- Translation and language assistance
- Step-by-step explanations and tutorials

Guidelines:
- Always be professional, patient, friendly, and accurate
- Format your responses clearly using markdown when helpful (bold, lists, code blocks, etc.)
- For code, always use proper code blocks with the language specified
- If you don't know something, say so honestly
- Keep greetings brief — focus on being genuinely helpful
- You are named Gedion — a sharp, confident, helpful female AI assistant`;

// ── Gemini API ──────────────────────────────────────────────
const GEMINI_MODEL  = 'gemini-2.0-flash';
const GEMINI_URL    = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

async function callGemini(userMessage) {
  // Build messages array: always include system instruction + full history + new user message
  const contents = [
    ...state.messages,
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents,
    generationConfig: {
      temperature: 0.8,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  state.abortController = new AbortController();

  const resp = await fetch(GEMINI_URL(state.apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: state.abortController.signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `API error ${resp.status}`;
    throw new Error(msg);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response content from Gemini.');
  return text;
}

// ── Markdown Renderer ────────────────────────────────────────
function renderMarkdown(text) {
  // Escape HTML first to prevent XSS
  const escape = (s) => s
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  // Code blocks (```lang\n...\n```) — processed BEFORE other rules
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = escape(code.trimEnd());
    const label = lang ? `<span style="font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">${escape(lang)}</span>` : '';
    return `<pre><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">${label}<button onclick="copyCode(this)" style="background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.25);color:var(--blue-400);padding:2px 8px;border-radius:4px;font-size:.65rem;cursor:pointer;font-family:'Inter',sans-serif;">Copy</button></div><code>${escaped}</code></pre>`;
  });

  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  text = text.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Bold + Italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g,         '<em>$1</em>');
  text = text.replace(/__(.+?)__/g,         '<strong>$1</strong>');
  text = text.replace(/_(.+?)_/g,           '<em>$1</em>');

  // Blockquote
  text = text.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rule
  text = text.replace(/^---$/gm, '<hr>');

  // Unordered lists
  text = text.replace(/^[\*\-\+] (.+)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>.*<\/li>)/gs, (match) => {
    if (!match.includes('<ul>')) return `<ul>${match}</ul>`;
    return match;
  });

  // Ordered lists
  text = text.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
  text = text.replace(/(<oli>.*<\/oli>)/gs, (match) =>
    `<ol>${match.replace(/<oli>/g,'<li>').replace(/<\/oli>/g,'</li>')}</ol>`
  );

  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Paragraphs — split on double newlines
  const parts = text.split(/\n\n+/);
  text = parts.map(part => {
    const trimmed = part.trim();
    if (!trimmed) return '';
    // Don't wrap block-level elements
    if (/^<(pre|ul|ol|h[1-6]|blockquote|hr)/.test(trimmed)) return trimmed;
    // Replace single newlines with <br> inside paragraphs
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return text;
}

// Copy code helper (global)
window.copyCode = function(btn) {
  const pre = btn.closest('pre');
  const code = pre.querySelector('code');
  navigator.clipboard.writeText(code.innerText).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1800);
  });
};

// ── Chat UI ─────────────────────────────────────────────────
function showWelcome(show) {
  const el = document.getElementById('welcomeScreen');
  if (el) el.style.display = show ? 'flex' : 'none';
}

function addMessage(role, content, isTyping = false) {
  const container = document.getElementById('messagesContainer');
  const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const time = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.id = id;

  const avatar = role === 'assistant'
    ? `<div class="msg-avatar"><img src="gedion_avatar.png" alt="Gedion" onerror="this.outerHTML='<span style=color:var(--blue-400);font-weight:700;font-size:.8rem>G</span>'"/></div>`
    : `<div class="msg-avatar">You</div>`;

  const bubble = isTyping
    ? `<div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`
    : `<div class="msg-bubble">${role === 'user' ? escapeHtml(content).replace(/\n/g,'<br>') : renderMarkdown(content)}</div>
       <div class="msg-meta"><span>${role === 'assistant' ? 'Gedion' : 'You'}</span>·<span>${time}</span></div>`;

  div.innerHTML = `${avatar}<div style="flex:1;min-width:0">${bubble}</div>`;
  container.appendChild(div);
  scrollToBottom();
  showWelcome(false);
  return id;
}

function updateMessageContent(id, content) {
  const div = document.getElementById(id);
  if (!div) return;
  const time = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const wrapper = div.querySelector('div[style]') || div.children[1];
  if (!wrapper) return;
  wrapper.innerHTML = `
    <div class="msg-bubble">${renderMarkdown(content)}</div>
    <div class="msg-meta"><span>Gedion</span>·<span>${time}</span></div>`;
  scrollToBottom();
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function scrollToBottom() {
  const zone = document.getElementById('chatZone');
  if (zone) setTimeout(() => zone.scrollTo({ top: zone.scrollHeight, behavior: 'smooth' }), 40);
}

// ── Send Message ─────────────────────────────────────────────
async function sendMessage() {
  if (state.isLoading) {
    // Stop generation
    state.abortController?.abort();
    return;
  }

  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  autoResize(input);
  updateCharCount(0);
  setLoading(true);

  // Add user bubble
  addMessage('user', text);

  // Add to history for Gemini
  state.messages.push({ role: 'user', parts: [{ text }] });

  // Save to sidebar history
  if (state.messages.length <= 2) addToHistory(text);

  // Typing indicator
  const typingId = addMessage('assistant', '', true);

  try {
    setStatus('Gedion is thinking…', true);
    const reply = await callGemini(text);

    updateMessageContent(typingId, reply);
    state.messages.push({ role: 'model', parts: [{ text: reply }] });
  } catch (err) {
    if (err.name === 'AbortError') {
      updateMessageContent(typingId, '*Response stopped by user.*');
    } else {
      const isAuthErr = err.message?.toLowerCase().includes('api key') ||
                        err.message?.toLowerCase().includes('invalid') ||
                        err.message?.toLowerCase().includes('permission');
      updateMessageContent(typingId,
        `**Error:** ${escapeHtml(err.message)}\n\n${isAuthErr ? '_Please check your API key in the sidebar settings._' : '_Please try again._'}`
      );
    }
  } finally {
    setLoading(false);
    setStatus('Gedion is ready', false);
    document.getElementById('chatInput')?.focus();
  }
}

// ── UI Helpers ───────────────────────────────────────────────
function setLoading(loading) {
  state.isLoading = loading;
  const btn   = document.getElementById('sendBtn');
  const send  = btn?.querySelector('.send-icon');
  const stop  = btn?.querySelector('.stop-icon');
  const input = document.getElementById('chatInput');

  if (loading) {
    if (send) send.style.display = 'none';
    if (stop) stop.style.display = 'block';
    if (btn)  { btn.disabled = false; btn.title = 'Stop'; }
    if (input) input.disabled = true;
  } else {
    if (send) send.style.display = 'block';
    if (stop) stop.style.display = 'none';
    if (input) { input.disabled = false; }
    updateSendBtn();
  }
}

function setStatus(text, thinking = false) {
  const el = document.getElementById('statusText');
  const dot = document.querySelector('.pulse-dot');
  if (el) el.textContent = text;
  if (dot) dot.style.background = thinking ? '#FBBF24' : 'var(--green-400)';
}

function updateSendBtn() {
  const btn = document.getElementById('sendBtn');
  const input = document.getElementById('chatInput');
  if (btn) btn.disabled = !(input?.value.trim().length > 0);
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 220) + 'px';
}

function updateCharCount(len) {
  const el = document.getElementById('charCount');
  if (!el) return;
  if (len === 0) { el.textContent = ''; return; }
  el.textContent = `${len} / 8000`;
  el.className = 'char-count' + (len > 7000 ? ' warn' : '') + (len > 7800 ? ' error' : '');
}

// ── History Sidebar ──────────────────────────────────────────
function addToHistory(title) {
  state.sessionCount++;
  const list = document.getElementById('historyList');
  const empty = list.querySelector('.no-files-msg');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'history-item';
  item.innerHTML = `
    <div class="history-item-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </div>
    <span class="history-item-text">${escapeHtml(title.slice(0, 40))}${title.length > 40 ? '…' : ''}</span>`;
  list.insertBefore(item, list.firstChild);
}

function clearChat() {
  state.messages = [];
  document.getElementById('messagesContainer').innerHTML = '';
  showWelcome(true);
}

// ── API Key Modal ────────────────────────────────────────────
function showApiModal() {
  const modal = document.getElementById('apiModal');
  const shell = document.getElementById('appShell');
  modal.style.display = 'flex';
  shell.style.display = 'none';
  document.getElementById('apiKeyInput').value = state.apiKey || '';
  document.getElementById('modalError').textContent = '';
}

function hideApiModal() {
  document.getElementById('apiModal').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
}

async function submitApiKey() {
  const input   = document.getElementById('apiKeyInput');
  const errEl   = document.getElementById('modalError');
  const btn     = document.getElementById('modalSubmitBtn');
  const key     = input.value.trim();

  if (!key) { errEl.textContent = 'Please enter your API key.'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span>Verifying…</span>';
  errEl.textContent = '';

  // Quick validation call
  try {
    const resp = await fetch(GEMINI_URL(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        generationConfig: { maxOutputTokens: 5 }
      }),
    });

    if (resp.status === 400 || resp.status === 403) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data?.error?.message || 'Invalid API key.');
    }

    // Key is valid
    state.apiKey = key;
    sessionStorage.setItem('gedion_api_key', key);
    hideApiModal();
  } catch (err) {
    if (err.name === 'TypeError') {
      // Network issue — accept the key anyway
      state.apiKey = key;
      sessionStorage.setItem('gedion_api_key', key);
      hideApiModal();
    } else {
      errEl.textContent = err.message || 'Could not verify key. Please try again.';
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Start Chatting</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></svg>';
  }
}

// ── Particles ────────────────────────────────────────────────
function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  let particles = [];

  const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  resize(); addEventListener('resize', resize);

  for (let i = 0; i < 75; i++) {
    particles.push({
      x: Math.random() * innerWidth,   y: Math.random() * innerHeight,
      vx: (Math.random() - .5) * .28,  vy: (Math.random() - .5) * .28,
      size: Math.random() * 1.4 + .4,  opacity: Math.random() * .35 + .08,
      color: Math.random() > .5 ? '96,165,250' : '167,139,250',
    });
  }

  (function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width)  p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
      ctx.fillStyle = `rgba(${p.color},${p.opacity})`; ctx.fill();
    });
    for (let i = 0; i < particles.length; i++) {
      for (let j = i+1; j < particles.length; j++) {
        const dx = particles[i].x-particles[j].x, dy = particles[i].y-particles[j].y;
        const d = Math.sqrt(dx*dx+dy*dy);
        if (d < 110) {
          ctx.strokeStyle = `rgba(96,165,250,${(1-d/110)*.12})`;
          ctx.lineWidth = .5; ctx.beginPath();
          ctx.moveTo(particles[i].x,particles[i].y); ctx.lineTo(particles[j].x,particles[j].y); ctx.stroke();
        }
      }
    }
    requestAnimationFrame(animate);
  })();
}

// ── Sidebar Toggle ───────────────────────────────────────────
function initSidebar() {
  const sidebar   = document.getElementById('sidebar');
  const mobileBtn = document.getElementById('mobileMenuBtn');

  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    const collapsed = sidebar.style.width === '60px';
    sidebar.style.width = collapsed ? 'var(--sidebar-w)' : '60px';
  });

  mobileBtn?.addEventListener('click', () => sidebar.classList.toggle('open'));

  document.addEventListener('click', e => {
    if (innerWidth <= 768 && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && e.target !== mobileBtn) sidebar.classList.remove('open');
    }
  });
}

// ── Global helper for capability cards ──────────────────────
window.setPrompt = function(text) {
  const input = document.getElementById('chatInput');
  input.value = text; input.focus();
  autoResize(input); updateCharCount(text.length); updateSendBtn();
};

// ── Toast ────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  document.querySelector('.toast')?.remove();
  const colors = {
    success: ['rgba(16,185,129,.15)','rgba(16,185,129,.3)','#34D399'],
    warning: ['rgba(251,191,36,.15)','rgba(251,191,36,.3)','#FBBF24'],
    error:   ['rgba(239,68,68,.15)','rgba(239,68,68,.3)','#F87171'],
    info:    ['rgba(59,130,246,.15)','rgba(59,130,246,.3)','#60A5FA'],
  };
  const [bg, border, color] = colors[type] || colors.info;
  const el = document.createElement('div');
  el.className = 'toast';
  Object.assign(el.style, { background:bg, border:`1px solid ${border}`, color });
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }, 2800);
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  initSidebar();

  // API key modal
  const submitBtn = document.getElementById('modalSubmitBtn');
  const keyInput  = document.getElementById('apiKeyInput');

  submitBtn?.addEventListener('click', submitApiKey);
  keyInput?.addEventListener('keydown', e => { if (e.key === 'Enter') submitApiKey(); });

  // Toggle password visibility
  document.getElementById('toggleApiVisibility')?.addEventListener('click', () => {
    const inp  = document.getElementById('apiKeyInput');
    const open = document.getElementById('eyeOpen');
    const shut = document.getElementById('eyeClosed');
    if (inp.type === 'password') { inp.type='text'; open.style.display='none'; shut.style.display='block'; }
    else                         { inp.type='password'; open.style.display='block'; shut.style.display='none'; }
  });

  // Change API key
  document.getElementById('changeApiKeyBtn')?.addEventListener('click', showApiModal);

  // New chat
  document.getElementById('newChatBtn')?.addEventListener('click', () => {
    clearChat(); document.getElementById('chatInput')?.focus();
  });

  // Clear chat
  document.getElementById('clearBtn')?.addEventListener('click', () => {
    if (!state.messages.length || confirm('Clear this conversation?')) clearChat();
  });

  // Input events
  const chatInput = document.getElementById('chatInput');
  chatInput?.addEventListener('input', () => {
    autoResize(chatInput); updateCharCount(chatInput.value.length); updateSendBtn();
  });
  chatInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  document.getElementById('sendBtn')?.addEventListener('click', sendMessage);

  // Show modal or app on load
  if (state.apiKey) {
    hideApiModal();
    showWelcome(true);
    setTimeout(() => chatInput?.focus(), 400);
  } else {
    showApiModal();
    setTimeout(() => keyInput?.focus(), 300);
  }
});
