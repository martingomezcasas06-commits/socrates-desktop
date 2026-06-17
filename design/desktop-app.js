/* ════════════════════════════════════════════════════════════════
   Socrates — Desktop App (interactive prototype)
   macOS window · Stack / Chat / Coaching · floating companion
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ───────── icons ───────── */
  const s = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const I = {
    stack: s('<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/>'),
    chat: s('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-5.2A8 8 0 1 1 21 12Z"/>'),
    coach: s('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
    sparkle: s('<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z"/>'),
    send: s('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>'),
    arrow: s('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
    search: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/>'),
    open: s('<path d="M9 5h10v10"/><path d="M19 5 5 19"/>'),
    play: s('<path d="M7 4v16l13-8Z"/>'),
    logout: s('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
    check: s('<path d="M4 12.5 9 17.5 20 6.5"/>'),
    x: s('<path d="M6 6l12 12M18 6 6 18"/>'),
    stop: s('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    bolt: s('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>'),
    shield: s('<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/>'),
    grad: s('<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5"/>'),
    target: s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
    eye: s('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
    cursor: s('<path d="M5 3l5 16 2.5-6.5L19 10Z" fill="white" stroke="white"/>'),
    pop: s('<path d="M14 3h7v7"/><path d="M21 3 11 13"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    help: s('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1.4.9-1.4 1.7v.5M12 17h.01"/>'),
    grid: s('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    book: s('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M9 8h7"/>'),
    refresh: s('<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>'),
  };
  const googleG = `<svg class="g" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-2 3.2-4.8 3.2-7.8Z"/><path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.6l-3.6-2.7c-1 .7-2.3 1.1-3.6 1.1-2.8 0-5.1-1.9-6-4.4H2.3v2.8A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M6 14.4a6.6 6.6 0 0 1 0-4.2V7.4H2.3a11 11 0 0 0 0 9.8L6 14.4Z"/><path fill="#EA4335" d="M12 5.5c1.6 0 3 .5 4.1 1.6l3.1-3.1A11 11 0 0 0 2.3 7.4L6 10.2C6.9 7.7 9.2 5.5 12 5.5Z"/></svg>`;

  /* ───────── data ───────── */
  const user = { name: 'Sofia Almeida', role: 'Account Executive', initials: 'SA' };

  const TOOLS = [
    { name: 'Claude', cat: 'General Assistant', use: 'Draft, summarize, and think through tricky work.', c1: '#C96442', c2: '#8B4226', risk: 'low' },
    { name: 'Gong', cat: 'Revenue Intelligence', use: 'Auto-capture calls and surface what moves deals.', c1: '#7C5CFF', c2: '#4A2FB0', risk: 'med' },
    { name: 'Clay', cat: 'Prospecting', use: 'Build and enrich target lists in minutes.', c1: '#2A2A2A', c2: '#555', risk: 'med' },
    { name: 'Perplexity', cat: 'Research', use: 'Cited answers and fast pre-call account research.', c1: '#20B8C5', c2: '#137A85', risk: 'low' },
    { name: 'Notion AI', cat: 'Productivity', use: 'Summaries and writing right inside your docs.', c1: '#2F2F2F', c2: '#000', risk: 'low' },
    { name: 'Granola', cat: 'Meeting Notes', use: 'A quiet notetaker that writes up every meeting.', c1: '#E8694A', c2: '#B23E20', risk: 'low' },
  ];
  const toolLogo = (t, cls = 'tool-logo') => `<div class="${cls}" style="background:linear-gradient(135deg, ${t.c1}, ${t.c2})">${t.name.slice(0, 1)}</div>`;

  const CHAT_SUGGEST = [
    'Which tool should I use to prep for a discovery call?',
    'How do I get a better summary out of Gong?',
    'Is it safe to paste a customer email into Claude?',
  ];
  const RECENT_TOPICS = ['Writing better prompts', 'Gong call reviews', 'Clay enrichment basics'];

  const SESSIONS = [
    { tool: 'Gong', when: 'Yesterday · 14 min', t: 'Setting up call alerts' },
    { tool: 'Claude', when: 'Mon · 9 min', t: 'Building a follow-up email project' },
    { tool: 'Clay', when: 'Last week · 22 min', t: 'Your first enrichment table' },
  ];

  // coaching guidance steps (Claude Projects example)
  const STEPS = [
    'Open Claude and click <b>+ New project</b> in the sidebar.',
    'Name it <b>“Discovery prep”</b> so it’s easy to find later.',
    'Add your call notes and ICP doc to <b>Project knowledge</b>.',
    'Write your first prompt: <b>“Summarize this account before my call.”</b>',
    'Save the prompt as a template so you can reuse it every time.',
  ];
  const ACTIONLOG = [
    ['0:00', 'Opened Claude in your browser'],
    ['0:04', 'Clicked <b>+ New project</b>'],
    ['0:07', 'Named it <b>“Discovery prep”</b>'],
    ['0:12', 'Uploading your ICP doc to project knowledge…'],
  ];

  /* ───────── state ───────── */
  const st = {
    screen: 'login',      // login | stack | chat | coaching
    coach: 'idle',        // idle | watching | offer | control | done
    stackEmpty: false,
    companion: false,
    chat: [{ from: 'bot', text: "Hi Sofia — I'm Socrates. Ask me anything about your AI tools or how to use them." }],
    loginTab: 'password', // password | magic
  };

  /* ───────── helpers ───────── */
  const railLink = (id, label, icon, pip) =>
    `<button class="rail-link ${st.screen === id ? 'active' : ''}" data-act="nav" data-screen="${id}">${I[icon]}<span>${label}</span>${pip ? '<span class="pip"></span>' : ''}</button>`;

  function shellRail() {
    return `<aside class="rail">
      <div class="rail-brand"><span class="brand-mark"></span><span class="nm">Socrates</span></div>
      <div class="rail-section"><span>Workspace</span></div>
      <nav class="rail-nav">
        ${railLink('stack', 'Stack', 'stack')}
        ${railLink('chat', 'Chat', 'chat')}
        ${railLink('coaching', 'Coaching', 'coach', st.screen !== 'coaching')}
      </nav>
      <div class="rail-foot">
        <div class="rail-user">
          <div class="avatar">${user.initials}</div>
          <div class="meta"><div class="nm">${user.name}</div><div class="rl">${user.role}</div></div>
          <button class="out" data-act="signout" title="Sign out">${I.logout}</button>
        </div>
      </div>
    </aside>`;
  }

  /* ───────── LOGIN ───────── */
  function screenLogin() {
    const pwForm = `
      <input class="field" type="email" placeholder="your@email.com" autocomplete="off">
      <input class="field" type="password" placeholder="Password" autocomplete="off">
      <button class="btn btn-primary btn-lg btn-block" data-act="signin">Sign in ${I.arrow}</button>
      <div class="forgot"><a href="#" data-act="noop">Forgot password?</a></div>`;
    const magicForm = `
      <div class="magic-note">We’ll email you a one-time sign-in link. No password needed.</div>
      <input class="field" type="email" placeholder="your@email.com" autocomplete="off">
      <button class="btn btn-primary btn-lg btn-block" data-act="signin">Send magic link ${I.send}</button>`;
    return `<div class="login anim">
      <div class="login-aside">
        <div class="la-brand"><span class="brand-mark"></span><span class="nm">Socrates</span></div>
        <div class="la-tag">
          <h2>Your team’s <span class="ital">AI&nbsp;mentor</span>, right on your desktop.</h2>
          <div class="la-points">
            <div class="la-point"><div class="ic">${I.stack}</div><div class="tx"><b>Your approved stack</b> — every tool cleared for your role, in one place.</div></div>
            <div class="la-point"><div class="ic">${I.coach}</div><div class="tx"><b>Live coaching</b> — Socrates watches your screen and guides you, step by step.</div></div>
            <div class="la-point"><div class="ic">${I.shield}</div><div class="tx"><b>Safe by default</b> — only tools and data your org has approved.</div></div>
          </div>
        </div>
      </div>
      <div class="login-form">
        <div class="lf-head"><h1>Welcome back</h1><p>Sign in with your work account to continue.</p></div>
        <button class="oauth-btn" data-act="signin">${googleG} Continue with Google</button>
        <div class="or-sep">or</div>
        <div class="seg">
          <button class="${st.loginTab === 'password' ? 'active' : ''}" data-act="login-tab" data-tab="password">Password</button>
          <button class="${st.loginTab === 'magic' ? 'active' : ''}" data-act="login-tab" data-tab="magic">Magic link</button>
        </div>
        ${st.loginTab === 'password' ? pwForm : magicForm}
        <div class="foot-note">Use the same email as your Socrates web account.</div>
      </div>
    </div>`;
  }

  /* ───────── STACK ───────── */
  function screenStack() {
    const head = `<div class="head">
      <div class="titles"><h1>Your <span class="ital">stack</span></h1><div class="sub">${st.stackEmpty ? 'Approved tools will appear here' : TOOLS.length + ' tools approved for you · ready to use'}</div></div>
      <div class="tools">
        <div class="search">${I.search}<input placeholder="Search tools…"></div>
      </div>
    </div>`;
    if (st.stackEmpty) {
      return `<div class="content"><div class="scroll"><div class="head"><div class="titles"><h1>Your <span class="ital">stack</span></h1><div class="sub">Approved tools will appear here</div></div></div>
        <div class="empty-rich anim">
          <div class="empty-ill"><div class="ring"></div><div class="core">${I.stack}</div></div>
          <h3>No tools approved <span class="ital">yet</span></h3>
          <p>Once you finish your onboarding interview and your manager signs off, your tailored AI toolkit lands right here.</p>
          <div class="empty-steps">
            <div class="empty-step"><span class="n">01</span><span class="tx"><b>Finish onboarding</b>A ~30-min chat about how you work.</span></div>
            <div class="empty-step"><span class="n">02</span><span class="tx"><b>Manager review</b>Socrates routes recommendations for approval.</span></div>
            <div class="empty-step"><span class="n">03</span><span class="tx"><b>Start using them</b>Approved tools show up here with coaching.</span></div>
          </div>
          <button class="btn btn-soft btn-block" data-act="noop">${I.open} Open the Socrates web app</button>
        </div>
      </div></div>`;
    }
    const filters = ['All', 'General', 'Research', 'Sales', 'Notes'];
    return `<div class="content">
      ${head.replace('<div class="content">', '')}
      <div class="head" style="padding-top:0;padding-bottom:10px">
        <div class="pill-filter">${filters.map((f, i) => `<button class="pill ${i === 0 ? 'active' : ''}" data-act="noop">${f}</button>`).join('')}</div>
      </div>
      <div class="scroll"><div class="stack-grid anim">
        ${TOOLS.map(t => `<div class="tool-card">
          <div class="tool-top">${toolLogo(t)}<div class="tt"><div class="nm">${t.name}</div><div class="ct">${t.cat}</div></div><span class="badge approved"><span class="dot"></span>Approved</span></div>
          <div class="tool-use">${t.use}</div>
          <div class="tool-actions">
            <button class="btn btn-soft btn-sm" data-act="noop">${I.open} Open</button>
            <button class="btn btn-primary btn-sm" data-act="coach-tool" data-tool="${t.name}">${I.coach} Coach me</button>
          </div>
        </div>`).join('')}
      </div></div>
    </div>`;
  }

  /* ───────── CHAT ───────── */
  function screenChat() {
    return `<div class="content">
      <div class="head"><div class="titles"><h1>Chat with <span class="ital">Socrates</span></h1><div class="sub">Your always-on AI advisor</div></div></div>
      <div class="chat-layout">
        <div class="chat-main">
          <div class="chat-stream" id="chatStream">${st.chat.map(chatMsg).join('')}</div>
          <div class="chat-foot">
            <div class="chips">${CHAT_SUGGEST.map(c => `<button class="chip" data-act="suggest" data-text="${c.replace(/"/g, '&quot;')}">${c}</button>`).join('')}</div>
            <div class="composer"><textarea id="chatInput" rows="1" placeholder="Ask Socrates anything…"></textarea><button class="send" data-act="send">${I.send}</button></div>
          </div>
        </div>
        <aside class="chat-aside">
          <div class="aside-sec"><h4>Your tools</h4>${TOOLS.slice(0, 4).map(t => `<div class="aside-tool">${toolLogo(t, 'lg')}<span class="nm">${t.name}</span></div>`).join('')}</div>
          <div class="aside-sec"><h4>Recent topics</h4>${RECENT_TOPICS.map(t => `<div class="aside-topic">${t}</div>`).join('')}</div>
        </aside>
      </div>
    </div>`;
  }
  function chatMsg(m) {
    if (m.from === 'bot') return `<div class="msg bot"><div class="av">${I.sparkle}</div><div class="bubble">${m.text}</div></div>`;
    return `<div class="msg me"><div class="av">${user.initials}</div><div class="bubble">${m.text}</div></div>`;
  }

  /* ───────── COACHING ───────── */
  function coachTabs() {
    return `<div class="coach-sub">
      <button class="coach-tab active">${I.coach} Coaching</button>
      <button class="coach-tab" data-act="nav" data-screen="chat">${I.chat} Chat</button>
    </div>`;
  }
  function fakeApp(activeIdx) {
    return `<div class="fake-app">
      <div class="fake-bar"><span class="d"></span><span class="d"></span><span class="d"></span><span class="url"></span></div>
      <div class="fake-body">
        <div class="fake-side">${[0,1,2,3,4].map(i => `<div class="fl ${i === 0 ? 'on' : ''}"></div>`).join('')}<div class="fl" style="margin-top:auto"></div></div>
        <div class="fake-main"><div class="fake-h"></div><div class="fake-l" style="width:90%"></div><div class="fake-l" style="width:70%"></div><div class="fake-l" style="width:80%"></div><div class="fake-input"></div></div>
      </div>
    </div>`;
  }
  function guideSteps(activeIdx, compact) {
    return STEPS.map((tx, i) => {
      const cls = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo';
      const n = i < activeIdx ? I.check : (i + 1);
      const C = compact ? 'comp-step' : 'guide-step';
      const N = compact ? 'cs-n' : 'gs-n';
      const X = compact ? 'cs-x' : 'gs-tx';
      return `<div class="${C} ${cls}"><div class="${N}">${i < activeIdx ? I.check : (i + 1)}</div><div class="${X}">${tx}</div></div>`;
    }).join('');
  }
  function qaBar() {
    return `<div class="guide-qa"><div class="qa-label">Ask about your screen</div>
      <div class="qa-input">${I.eye}<input placeholder="What does this button do?"><button class="send-sm" data-act="noop">${I.send}</button></div></div>`;
  }

  function screenCoaching() {
    if (st.coach === 'idle') return coachIdle();
    if (st.coach === 'done') return coachDone();
    return coachLive(); // watching | offer | control
  }

  function coachIdle() {
    return `<div class="content"><div class="coach">
      ${coachTabs()}
      <div class="coach-idle anim">
        <div class="start-panel">
          <h2>Start a <span class="ital">live coaching</span> session</h2>
          <p>Tell me which tool you want help with. I’ll watch your screen and guide you step by step — and if you get stuck, I’ll offer to take over.</p>
          <div class="start-row">
            <input class="field" id="coachTool" placeholder="Which tool? (e.g. Claude, Gong, Clay)">
            <button class="btn btn-primary btn-lg" data-act="start-session">${I.play} Start session</button>
          </div>
        </div>
        <div class="coach-cols">
          <div class="panel">
            <h4>${I.stack} Coach me on a tool <span class="mono">your stack</span></h4>
            <div class="coach-tool-row">${TOOLS.map(t => `<button class="coach-tool" data-act="coach-tool" data-tool="${t.name}">${toolLogo(t, 'lg')}<span class="nm">${t.name}</span></button>`).join('')}</div>
          </div>
          <div class="panel">
            <h4>${I.clock} Recent sessions</h4>
            ${SESSIONS.map(se => `<div class="session-item"><div class="si-ic">${I.coach}</div><div class="si-tx"><div class="t">${se.t}</div><div class="d">${se.tool} · ${se.when}</div></div><button class="btn btn-soft btn-sm" data-act="noop">${I.refresh}</button></div>`).join('')}
          </div>
        </div>
        <div class="panel" style="margin-top:16px">
          <h4>${I.help} How live coaching works</h4>
          <div class="how-row">
            <div class="how-card"><div class="n">1</div><div class="t">You start a session</div><div class="d">Pick a tool. Socrates begins watching your screen — privately.</div></div>
            <div class="how-card"><div class="n">2</div><div class="t">Guidance, step by step</div><div class="d">Follow along with highlights and a live checklist. Ask anything.</div></div>
            <div class="how-card"><div class="n">3</div><div class="t">Stuck? It takes over</div><div class="d">With your OK, Socrates navigates the steps for you.</div></div>
          </div>
        </div>
      </div>
    </div></div>`;
  }

  function coachLive() {
    const active = st.coach === 'control' ? 4 : 2;
    const statusBar = st.coach === 'control'
      ? `<div class="control-banner"><div class="control-orb">${I.bolt}</div><div class="cb-tx"><div class="t">Socrates is in control</div><div class="d">Navigating Claude for you · you can stop anytime</div></div><button class="btn btn-danger btn-sm" data-act="stop-session">${I.stop} Stop</button></div>`
      : `<div class="preview-status"><span class="badge live"><span class="dot"></span>Live · watching</span><span class="st-txt">Coaching <span class="dim">·</span> Claude</span><span class="spacer"></span><button class="btn btn-danger btn-sm" data-act="stop-session">${I.stop} Stop session</button></div>`;

    // preview pane content
    const preview = `<div class="preview-pane">
      ${st.coach !== 'control' ? statusBar : ''}
      <div class="preview-frame">
        ${fakeApp(active)}
        <div class="spotlight" id="spotlight" style="left:148px;top:96px;width:150px;height:30px"></div>
        <div class="cursor-ghost" id="ghost" style="left:210px;top:104px">${I.cursor}</div>
      </div>
    </div>`;

    // right guidance pane — differs for watching vs control vs offer
    let guide;
    if (st.coach === 'control') {
      guide = `<aside class="guide-pane">
        <div class="guide-head">${I.bolt}<div class="gh-t">Action log<span class="mono">autonomous mode</span></div></div>
        <div class="action-log" id="actionLog">${ACTIONLOG.map((l, i) => `<div class="log-item ${i === ACTIONLOG.length - 1 ? 'cur' : ''}"><span class="lt">${l[0]}</span><span class="lx">${l[1]}</span></div>`).join('')}</div>
        ${qaBar()}
      </aside>`;
    } else {
      guide = `<aside class="guide-pane">
        <div class="guide-head">${I.target}<div class="gh-t">Step ${active + 1} of ${STEPS.length}<span class="mono">Claude · discovery prep</span></div></div>
        <div class="guide-feed">${guideSteps(active)}</div>
        ${st.coach === 'offer' ? offerCard() : ''}
        ${qaBar()}
      </aside>`;
    }

    return `<div class="content"><div class="coach">
      ${coachTabs()}
      ${st.coach === 'control' ? statusBar : ''}
      <div class="coach-live">${preview}${guide}</div>
    </div></div>`;
  }

  function offerCard() {
    return `<div class="offer-card">
      <div class="oc-top"><div class="oc-ic">${I.bolt}</div><h4>Looks like you’re stuck here</h4></div>
      <p>You’ve been on this step for a bit. Want me to navigate to <b>Project knowledge</b> and upload the doc for you?</p>
      <div class="offer-actions">
        <button class="btn btn-soft btn-sm" data-act="decline-offer">No, I’ve got it</button>
        <button class="btn btn-primary btn-sm" data-act="accept-offer">${I.bolt} Yes, take over</button>
      </div>
    </div>`;
  }

  function coachDone() {
    return `<div class="content"><div class="coach">
      ${coachTabs()}
      <div class="coach-done anim"><div class="done-card">
        <div class="done-check">${I.check}</div>
        <h3>You’re all set <span class="ital">with Claude</span></h3>
        <p>Your “Discovery prep” project is ready. Next time, just open it and run your saved prompt.</p>
        <div class="done-summary">
          <div class="ds-row">${I.check} Created the <b style="margin:0 4px;font-weight:600">Discovery prep</b> project</div>
          <div class="ds-row">${I.check} Added your ICP doc to project knowledge</div>
          <div class="ds-row">${I.check} Saved a reusable pre-call prompt</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-soft btn-block" data-act="nav" data-screen="stack">Back to stack</button>
          <button class="btn btn-primary btn-block" data-act="reset-coach">${I.coach} Back to coaching</button>
        </div>
      </div></div>
    </div></div>`;
  }

  /* ───────── COMPANION (floating) ───────── */
  function renderCompanion() {
    const layer = document.getElementById('companionLayer');
    if (!st.companion) { layer.innerHTML = ''; return; }
    const active = 2;
    layer.innerHTML = `<div class="companion" id="companion" style="right:-30px;top:118px">
      <div class="comp-bar" id="compBar"><span class="cb-mark"></span><span class="cb-t">Coaching <span class="dim">· Claude</span></span>
        <span class="badge live" style="font-size:8.5px"><span class="dot"></span>Live</span>
        <button class="cb-x" data-act="toggle-companion">${I.x}</button></div>
      <div class="comp-body">
        ${guideSteps(active, true)}
        <div class="comp-qa"><div class="qa-input">${I.eye}<input placeholder="Ask about your screen…"><button class="send-sm" data-act="noop">${I.send}</button></div></div>
      </div>
    </div>`;
    makeCompanionDraggable();
  }

  function makeCompanionDraggable() {
    const comp = document.getElementById('companion');
    const bar = document.getElementById('compBar');
    if (!comp || !bar) return;
    let sx, sy, ox, oy, drag = false;
    bar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.cb-x')) return;
      drag = true; const r = comp.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      comp.style.right = 'auto'; comp.style.bottom = 'auto'; comp.style.left = ox + 'px'; comp.style.top = oy + 'px';
      bar.style.cursor = 'grabbing'; e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => { if (!drag) return; comp.style.left = (ox + e.clientX - sx) + 'px'; comp.style.top = (oy + e.clientY - sy) + 'px'; });
    window.addEventListener('mouseup', () => { drag = false; if (bar) bar.style.cursor = 'grab'; });
  }

  /* ───────── render router ───────── */
  function render() {
    const win = document.getElementById('window');
    if (st.screen === 'login') {
      win.innerHTML = titlebar(false) + `<div class="window-body" style="display:block">${screenLogin()}</div>`;
    } else {
      win.innerHTML = titlebar(true) + `<div class="window-body">${shellRail()}${screenBody()}</div>`;
    }
    renderCompanion();
    renderDemoBar();
    if (st.screen === 'chat') initChat();
    if (st.screen === 'coaching' && (st.coach === 'watching' || st.coach === 'offer' || st.coach === 'control')) animateLive();
  }
  function titlebar(showLive) {
    const right = st.screen === 'coaching' && st.coach !== 'idle' && st.coach !== 'done'
      ? `<button class="tb-btn ${st.companion ? 'live' : ''}" data-act="toggle-companion">${I.pop} ${st.companion ? 'Companion on' : 'Pop out companion'}</button>`
      : '';
    return `<div class="titlebar"><div class="traffic"><i class="r"></i><i class="y"></i><i class="g"></i></div><div class="tb-title">Socrates</div><div class="tb-right">${right}</div></div>`;
  }
  function screenBody() {
    if (st.screen === 'stack') return screenStack();
    if (st.screen === 'chat') return screenChat();
    if (st.screen === 'coaching') return screenCoaching();
    return screenStack();
  }

  /* ───────── chat behavior ───────── */
  function initChat() {
    const stream = document.getElementById('chatStream');
    if (stream) stream.scrollTop = stream.scrollHeight;
    const input = document.getElementById('chatInput');
    if (input) {
      input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 100) + 'px'; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(input.value); } });
    }
  }
  function botReply(t) {
    t = t.toLowerCase();
    if (t.includes('safe') || t.includes('customer') || t.includes('data')) return "Good instinct to check. Stick to your approved tools for anything with customer info — they’re configured for your org’s data policy. Claude is approved, so a customer email is fine; just avoid pasting full contact lists.";
    if (t.includes('gong') || t.includes('summary')) return "In Gong, open the call and check the ‘Highlights’ tab first — it auto-pulls objections and next steps. Want me to coach you through setting up call alerts live?";
    if (t.includes('discovery') || t.includes('prep') || t.includes('which tool')) return "For pre-call prep I’d use Perplexity for fast account research, then Claude to turn your notes into talking points. Want me to start a live coaching session on that?";
    return "Happy to help — tell me the tool and the task, and I’ll walk you through it or start a live coaching session.";
  }
  function sendChat(text) {
    text = (text || '').trim(); if (!text) return;
    st.chat.push({ from: 'me', text });
    render();
    setTimeout(() => { st.chat.push({ from: 'bot', text: botReply(text) }); render(); }, 520);
  }

  /* ───────── live coaching animation (spotlight + cursor + log) ───────── */
  let liveTimer = null;
  function animateLive() {
    clearInterval(liveTimer);
    const spots = [
      { left: 18, top: 42, w: 84, h: 16 },    // sidebar new project
      { left: 148, top: 96, w: 150, h: 18 },   // name field
      { left: 148, top: 150, w: 220, h: 40 },   // knowledge area
      { left: 148, top: 230, w: 240, h: 38 },   // prompt input
    ];
    let i = 0;
    const move = () => {
      const sp = document.getElementById('spotlight'); const gh = document.getElementById('ghost');
      const frame = document.querySelector('.preview-frame');
      if (!sp || !frame) return;
      const fr = frame.getBoundingClientRect();
      const o = spots[i % spots.length];
      // positions are within the fake-main; scale roughly to frame
      const x = fr.width * (0.18 + (i % 2) * 0.04) ;
      sp.style.left = (o.left) + 'px'; sp.style.top = (o.top) + 'px'; sp.style.width = o.w + 'px'; sp.style.height = o.h + 'px';
      if (gh) { gh.style.left = (o.left + o.w - 10) + 'px'; gh.style.top = (o.top + o.h) + 'px'; }
      i++;
    };
    move();
    liveTimer = setInterval(move, 1800);
  }

  /* ───────── demo bar ───────── */
  function renderDemoBar() {
    const bar = document.getElementById('demoBar');
    const screens = [['login', 'Login'], ['stack', 'Stack'], ['chat', 'Chat'], ['coaching', 'Coaching']];
    let html = `<span class="db-label">Demo</span>` + screens.map(([k, l]) => `<button class="${st.screen === k ? 'active' : ''}" data-act="nav" data-screen="${k}">${l}</button>`).join('');
    if (st.screen === 'coaching') {
      const states = [['idle', 'Ready'], ['watching', 'Watching'], ['offer', 'Offer'], ['control', 'In control'], ['done', 'Done']];
      html += `<span class="db-sep"></span><div class="db-sub">` + states.map(([k, l]) => `<button class="${st.coach === k ? 'active' : ''}" data-act="coach-state" data-state="${k}">${l}</button>`).join('') + `</div>`;
      html += `<span class="db-sep"></span><button class="toggle ${st.companion ? 'on' : ''}" data-act="toggle-companion">${I.pop} Companion</button>`;
    }
    if (st.screen === 'stack') {
      html += `<span class="db-sep"></span><button class="toggle ${st.stackEmpty ? 'on' : ''}" data-act="toggle-empty">Empty state</button>`;
    }
    bar.innerHTML = html;
  }

  /* ───────── scale to fit ───────── */
  function fit() {
    const wrap = document.getElementById('scaleWrap');
    const vw = window.innerWidth, vh = window.innerHeight;
    const scale = Math.min(1, (vw - 64) / 960, (vh - 110) / 680);
    wrap.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', fit);

  /* ───────── events ───────── */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const a = t.dataset.act;
    switch (a) {
      case 'nav': st.screen = t.dataset.screen; if (st.screen !== 'coaching') st.companion = false; render(); break;
      case 'signin': st.screen = 'stack'; render(); break;
      case 'signout': st.screen = 'login'; render(); break;
      case 'login-tab': st.loginTab = t.dataset.tab; render(); break;
      case 'suggest': sendChat(t.dataset.text); break;
      case 'send': { const i = document.getElementById('chatInput'); sendChat(i ? i.value : ''); break; }
      case 'coach-tool': st.screen = 'coaching'; st.coach = 'watching'; render(); break;
      case 'coach-state': st.coach = t.dataset.state; if (st.coach === 'idle' || st.coach === 'done') st.companion = false; render(); break;
      case 'start-session': st.coach = 'watching'; render(); break;
      case 'stop-session': st.coach = 'done'; st.companion = false; render(); break;
      case 'accept-offer': st.coach = 'control'; render(); break;
      case 'decline-offer': st.coach = 'watching'; render(); break;
      case 'reset-coach': st.coach = 'idle'; render(); break;
      case 'toggle-companion': st.companion = !st.companion; if (st.companion && st.screen === 'coaching' && (st.coach === 'idle' || st.coach === 'done')) st.coach = 'watching'; render(); break;
      case 'toggle-empty': st.stackEmpty = !st.stackEmpty; render(); break;
      case 'noop': e.preventDefault(); break;
    }
  });

  /* ───────── clock ───────── */
  function tickClock() {
    const el = document.getElementById('mbClock');
    if (el) { const d = new Date(); let h = d.getHours() % 12 || 12; const m = String(d.getMinutes()).padStart(2, '0'); el.textContent = `${h}:${m} ${d.getHours() < 12 ? 'AM' : 'PM'}`; }
  }

  /* ───────── boot ───────── */
  fit();
  render();
  tickClock(); setInterval(tickClock, 30000);
})();
