// AI Memory Bridge - Content Script v2.0
// 注入到各AI平台页面，实现抓取和注入功能
// 支持：多条指令识别、滚动检测、完整内容抓取、项目组

(function () {
  'use strict';

  // 当前平台检测
  const hostname = window.location.hostname;
  const PLATFORMS = {
    'gemini.google.com': {
      name: 'Gemini', color: '#4285f4',
      inputSelectors: ['rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"].ql-editor'],
      // 用户指令选择器
      userSelectors: ['user-query', '.user-query-bubble-with-background', 'user-query-text',
        '[data-role="user"]', '.human-turn'],
      // AI回复选择器
      aiSelectors: ['model-response .response-content', 'model-response', '.response-content',
        '.conversation-turn .message-content'],
      submitSelectors: ['button[aria-label="Send message"]']
    },
    'chat.deepseek.com': {
      name: 'DeepSeek', color: '#1a73e8',
      inputSelectors: ['textarea#chat-input', 'div[contenteditable="true"]'],
      // DeepSeek 用户消息（class名会变，多备选）
      userSelectors: [
        '[class*="userContent"]', '[class*="user-message"]', '[class*="humanMessage"]',
        'div[class*="r-"][class*="user"]', '.dad65929', '.e1675d8b',
        '[data-role="user"] .content', '.chat-message.user .content'
      ],
      // DeepSeek AI回复
      aiSelectors: [
        '.ds-markdown', '[class*="ds-markdown"]', '.f6d670',
        '[class*="markdownContent"]', '[class*="assistantContent"]',
        '.markdown-body', '[data-role="assistant"] .content'
      ],
      submitSelectors: ['button[type="submit"]', '.send-button']
    },
    'claude.ai': {
      name: 'Claude', color: '#d97706',
      inputSelectors: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable]'],
      userSelectors: [
        '[data-testid="human-turn"]', '.human-turn',
        '[data-testid="human-turn-wrapper"]', '.font-user-message'
      ],
      aiSelectors: [
        '[data-testid="assistant-turn"] .prose', '.font-claude-message',
        '[data-testid="assistant-turn"]', '[data-is-streaming]'
      ],
      submitSelectors: ['button[aria-label="Send Message"]']
    },
    'chatgpt.com': {
      name: 'ChatGPT', color: '#10a37f',
      inputSelectors: ['#prompt-textarea', 'div[contenteditable="true"]'],
      userSelectors: [
        '[data-message-author-role="user"] .whitespace-pre-wrap',
        '[data-message-author-role="user"]'
      ],
      aiSelectors: [
        '[data-message-author-role="assistant"] .markdown',
        '[data-message-author-role="assistant"]',
        '.agent-turn .markdown'
      ],
      submitSelectors: ['button[data-testid="send-button"]', 'button[aria-label="Send prompt"]']
    },
    'chat.openai.com': {
      name: 'ChatGPT', color: '#10a37f',
      inputSelectors: ['#prompt-textarea', 'div[contenteditable="true"]'],
      userSelectors: ['[data-message-author-role="user"]'],
      aiSelectors: ['[data-message-author-role="assistant"] .markdown'],
      submitSelectors: ['button[data-testid="send-button"]']
    },
    'kimi.moonshot.cn': {
      name: 'Kimi', color: '#7c3aed',
      inputSelectors: ['div[contenteditable="true"]', 'textarea'],
      userSelectors: ['.chat-message.user .message-content', '[class*="userMessage"]', '[data-role="user"]'],
      aiSelectors: ['.chat-message__content', '.markdown-body', '[class*="assistantMessage"]'],
      submitSelectors: ['button.send-btn']
    },
    'tongyi.aliyun.com': {
      name: '通义千问', color: '#f59e0b',
      inputSelectors: ['textarea', 'div[contenteditable="true"]'],
      userSelectors: ['[class*="userContent"]', '[data-role="user"]', '.question-content'],
      aiSelectors: ['.ant-md-editor-markdown', '.message-item__main', '[class*="answerContent"]'],
      submitSelectors: ['button.send-btn', 'button[type="submit"]']
    }
  };

  // 兼容旧字段：保证平台有 userSelectors 和 aiSelectors
  function getPlatformSelectors(p) {
    return {
      user: p.userSelectors || [],
      ai: p.aiSelectors || p.messageSelectors || []
    };
  }

  const platformKey = Object.keys(PLATFORMS).find(k => hostname.includes(k));
  const platform = platformKey ? PLATFORMS[platformKey] : {
    name: hostname, color: '#888',
    inputSelectors: ['textarea', 'div[contenteditable="true"]'],
    messageContainerSelectors: ['body'],
    messageSelectors: ['.message', '.response', '.content'],
    submitSelectors: ['button[type="submit"]']
  };

  // ── 状态 ──────────────────────────────────────────────────
  let floatBtn = null;
  let panel = null;
  let memories = [];
  let groups = [];
  let isVisible = false;
  let capturedItems = [];
  let scrollObserver = null;
  let _contextInvalid = false;

  // ── 安全消息发送（防止插件重载后上下文失效崩溃）────────────
  function safeMsg(msg, callback) {
    if (_contextInvalid) return;
    // chrome.runtime.id 不存在代表上下文已失效
    if (!chrome.runtime || !chrome.runtime.id) {
      _contextInvalid = true;
      _onContextInvalid();
      return;
    }
    try {
      // 注意：这里必须直接调用 chrome.runtime.sendMessage，不能用 safeMsg（会无限递归）
      chrome.runtime.sendMessage(msg, function(res) {
        // 捕获回调时的运行时错误
        if (chrome.runtime.lastError) {
          var errMsg = chrome.runtime.lastError.message || '';
          if (errMsg.includes('context invalidated') || errMsg.includes('receiving end does not exist')) {
            _contextInvalid = true;
            _onContextInvalid();
            return;
          }
        }
        if (callback) callback(res);
      });
    } catch (e) {
      if (e.message && (e.message.includes('context invalidated') || e.message.includes('Extension context'))) {
        _contextInvalid = true;
        _onContextInvalid();
      } else {
        console.warn('[AI Memory Bridge] sendMessage error:', e.message);
      }
    }
  }

  function _onContextInvalid() {
    // 隐藏面板和按钮，提示用户刷新
    if (panel) panel.style.display = 'none';
    if (floatBtn) {
      floatBtn.style.opacity = '0.4';
      floatBtn.title = '插件已更新，请刷新页面';
    }
    showToast('⚠️ 插件已更新，请刷新页面后继续使用');
    console.warn('[AI Memory Bridge] Extension context invalidated. Please refresh the page.');
  }

  // ── 悬浮按钮 ──────────────────────────────────────────────
  function createFloatButton() {
    if (floatBtn) return;

    floatBtn = document.createElement('div');
    floatBtn.id = 'ai-memory-float-btn';
    floatBtn.innerHTML = [
      '<div class="amb-btn-inner">',
      '  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">',
      '    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" fill="white"/>',
      '  </svg>',
      '  <span class="amb-badge" id="amb-badge" style="display:none">0</span>',
      '</div>'
    ].join('');
    floatBtn.title = 'AI Memory Bridge';
    floatBtn.addEventListener('click', togglePanel);

    let isDragging = false, startX, startY, startLeft, startTop;
    floatBtn.addEventListener('mousedown', function(e) {
      if (e.target.closest('.amb-btn-inner')) {
        isDragging = false;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = floatBtn.offsetLeft;
        startTop = floatBtn.offsetTop;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', onDragEnd);
      }
    });
    function onDrag(e) {
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragging = true;
      if (isDragging) {
        floatBtn.style.left = Math.max(0, Math.min(window.innerWidth - 56, startLeft + dx)) + 'px';
        floatBtn.style.top = Math.max(0, Math.min(window.innerHeight - 56, startTop + dy)) + 'px';
        floatBtn.style.right = 'auto';
        floatBtn.style.bottom = 'auto';
      }
    }
    function onDragEnd() {
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', onDragEnd);
      if (isDragging) setTimeout(function() { isDragging = false; }, 100);
    }

    document.body.appendChild(floatBtn);
    updateBadge();
  }

  // ── 面板 ──────────────────────────────────────────────────
  function createPanel() {
    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'ai-memory-panel';
    panel.innerHTML = [
      '<div class="amp-header">',
      '  <div class="amp-title">',
      '    <span class="amp-logo">🧠</span>',
      '    <span>AI Memory Bridge</span>',
      '    <span class="amp-platform" style="background:' + platform.color + '">' + platform.name + '</span>',
      '  </div>',
      '  <div class="amp-actions">',
      '    <button class="amp-icon-btn" id="amb-scan-btn" title="扫描页面所有指令">🔍</button>',
      '    <button class="amp-icon-btn" id="amb-capture-btn" title="保存选中指令到记忆库">💾</button>',
      '    <button class="amp-icon-btn" id="amb-close-btn" title="关闭">✕</button>',
      '  </div>',
      '</div>',
      '<div class="amp-tabs">',
      '  <button class="amp-tab active" data-amp-tab="scan">扫描结果</button>',
      '  <button class="amp-tab" data-amp-tab="memories">记忆库</button>',
      '  <button class="amp-tab" data-amp-tab="groups">项目组</button>',
      '</div>',
      '<div class="amp-tab-content active" id="amp-tab-scan">',
      '  <div class="amp-scan-info">',
      '    <span id="amb-scan-count">未扫描</span>',
      '    <button class="amp-mini-btn" id="amb-scan-files-btn">扫文件</button>',
      '    <button class="amp-mini-btn" id="amb-select-all-btn">全选</button>',
      '    <button class="amp-mini-btn" id="amb-deselect-all-btn">取消</button>',
      '  </div>',
      '  <div class="amp-memory-list" id="amb-scan-list"><div class="amb-empty">点击 🔍 扫描当前页面所有AI指令</div></div>',
      '</div>',
      '<div class="amp-tab-content" id="amp-tab-memories">',
      '  <div class="amp-search-bar">',
      '    <input type="text" id="amb-search" placeholder="搜索记忆..." />',
      '    <select id="amb-tag-filter">',
      '      <option value="all">全部标签</option>',
      '      <option value="通用">通用</option>',
      '      <option value="编程">编程</option>',
      '      <option value="写作">写作</option>',
      '      <option value="分析">分析</option>',
      '      <option value="自定义">自定义</option>',
      '    </select>',
      '  </div>',
      '  <div class="amp-scan-info" style="padding:4px 14px;">',
      '    <span id="amb-panel-batch-count" style="font-size:10px;color:#818cf8;font-weight:500;">0 条已选</span>',
      '    <button class="amp-mini-btn" id="amb-panel-batch-btn" style="font-size:10px;padding:2px 6px;">☑ 批量</button>',
      '    <button class="amp-mini-btn" id="amb-panel-select-all" style="font-size:10px;padding:2px 6px;">☑ 全选</button>',
      '    <button class="amp-mini-btn" id="amb-panel-deselect-all" style="font-size:10px;padding:2px 6px;">☐ 取消</button>',
      '    <button class="amp-mini-btn" id="amb-panel-delete-selected" style="font-size:10px;padding:2px 6px;background:rgba(239,68,68,0.15)!important;color:#f87171!important;" disabled>🗑 删除选中</button>',
      '  </div>',
      '  <div class="amp-memory-list" id="amb-memory-list"><div class="amb-empty">暂无记忆</div></div>',
      '</div>',
      '<div class="amp-tab-content" id="amp-tab-groups">',
      '  <div class="amp-scan-info">',
      '    <span id="amb-group-count">无项目组</span>',
      '    <button class="amp-mini-btn" id="amb-new-group-btn">➕ 新建组</button>',
      '  </div>',
      '  <div class="amp-memory-list" id="amb-group-list"><div class="amb-empty">暂无项目组</div></div>',
      '</div>',
      '<div class="amp-footer">',
      '  <button class="amp-footer-btn" id="amb-new-btn">✏️ 新建</button>',
      '  <button class="amp-footer-btn" id="amb-export-btn">📤 导出</button>',
      '  <button class="amp-footer-btn" id="amb-import-btn">📥 导入</button>',
      '  <input type="file" id="amb-import-file" accept=".json" style="display:none">',
      '</div>',
      '<div class="amp-capture-modal" id="amb-capture-modal" style="display:none">',
      '  <div class="amp-modal-content">',
      '    <h3>💾 保存到记忆库</h3>',
      '    <div class="amp-save-options">',
      '      <label><input type="radio" name="save-mode" value="selected" checked> 仅保存选中的指令</label>',
      '      <label><input type="radio" name="save-mode" value="all"> 保存全部扫描结果</label>',
      '      <label><input type="radio" name="save-mode" value="group"> 保存为项目组</label>',
      '    </div>',
      '    <div id="amb-group-name-row" style="display:none">',
      '      <input type="text" id="amb-group-name-input" placeholder="项目组名称（默认使用第一条指令标题）" />',
      '    </div>',
      '    <input type="text" id="amb-save-tag-input" placeholder="标签（可选，默认：通用）" />',
      '    <div class="amp-save-row">',
      '      <button class="amp-save-btn" id="amb-save-confirm">保存</button>',
      '      <button class="amp-cancel-btn" id="amb-save-cancel">取消</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(panel);
    bindPanelEvents();
  }

  function bindPanelEvents() {
    document.getElementById('amb-close-btn').addEventListener('click', togglePanel);
    document.getElementById('amb-scan-btn').addEventListener('click', scanPageMessages);
    document.getElementById('amb-scan-files-btn').addEventListener('click', scanPageFilesOnly);
    document.getElementById('amb-capture-btn').addEventListener('click', openSaveModal);
    document.getElementById('amb-new-btn').addEventListener('click', function() { openSingleSaveModal('', ''); });
    document.getElementById('amb-export-btn').addEventListener('click', exportMemories);
    document.getElementById('amb-import-btn').addEventListener('click', function() { document.getElementById('amb-import-file').click(); });
    document.getElementById('amb-import-file').addEventListener('change', importMemories);
    document.getElementById('amb-search').addEventListener('input', renderMemoryList);
    document.getElementById('amb-tag-filter').addEventListener('change', renderMemoryList);
    document.getElementById('amb-save-confirm').addEventListener('click', saveCapturedItems);
    document.getElementById('amb-save-cancel').addEventListener('click', function() {
      document.getElementById('amb-capture-modal').style.display = 'none';
    });
    document.getElementById('amb-select-all-btn').addEventListener('click', function() { toggleSelectAll(true); });
    document.getElementById('amb-deselect-all-btn').addEventListener('click', function() { toggleSelectAll(false); });
    document.getElementById('amb-new-group-btn').addEventListener('click', createNewGroupFromSelection);

    // 面板记忆库批量操作按钮
    var panelBatchBtn = document.getElementById('amb-panel-batch-btn');
    if (panelBatchBtn) panelBatchBtn.addEventListener('click', togglePanelBatchMode);
    var panelSelectAll = document.getElementById('amb-panel-select-all');
    if (panelSelectAll) panelSelectAll.addEventListener('click', function() {
      var list = document.getElementById('amb-memory-list');
      list.querySelectorAll('.panel-batch-cb').forEach(function(cb) {
        cb.checked = true;
        panelSelectedIds.add(cb.dataset.id);
        cb.closest('.amb-memory-item').classList.add('selected');
      });
      updatePanelBatchBar();
    });
    var panelDeselectAll = document.getElementById('amb-panel-deselect-all');
    if (panelDeselectAll) panelDeselectAll.addEventListener('click', function() {
      var list = document.getElementById('amb-memory-list');
      list.querySelectorAll('.panel-batch-cb').forEach(function(cb) {
        cb.checked = false;
        panelSelectedIds.delete(cb.dataset.id);
        cb.closest('.amb-memory-item').classList.remove('selected');
      });
      updatePanelBatchBar();
    });
    var panelDeleteBtn = document.getElementById('amb-panel-delete-selected');
    if (panelDeleteBtn) panelDeleteBtn.addEventListener('click', deletePanelSelectedMemories);

    document.querySelectorAll('.amp-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.amp-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.amp-tab-content').forEach(function(c) { c.classList.remove('active'); });
        tab.classList.add('active');
        document.getElementById('amp-tab-' + tab.dataset.ampTab).classList.add('active');
        if (tab.dataset.ampTab === 'memories') loadMemories();
        if (tab.dataset.ampTab === 'groups') loadGroups();
      });
    });

    document.querySelectorAll('input[name="save-mode"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        document.getElementById('amb-group-name-row').style.display =
          radio.value === 'group' ? 'block' : 'none';
      });
    });
  }

  function togglePanel() {
    if (!panel) createPanel();
    isVisible = !isVisible;
    panel.style.display = isVisible ? 'flex' : 'none';
    if (isVisible) {
      loadMemories();
      loadGroups();
      renderScanList();
    }
  }

  // ── 核心扫描函数（Map去重+祖先过滤+优先级角色）─────────
  function collectMessages() {
    // 用 Map<DOMElement, {role, priority}> 保证同一元素只记一次
    var elMap = new Map();

    // priority越小越可信，不允许低优先级覆盖高优先级的角色
    function tryAdd(el, role, priority) {
      if (!el || !el.isConnected) return;
      var existing = elMap.get(el);
      if (existing && existing.priority <= priority) return;
      elMap.set(el, { role: role, priority: priority });
    }

    var sel = getPlatformSelectors(platform);

    // P0: 最可靠的 data 属性（ChatGPT/Claude等标准属性）
    var P0_USER = ['[data-message-author-role="user"]','[data-testid="human-turn"]','user-query','[data-role="user"]'];
    var P0_AI   = ['[data-message-author-role="assistant"]','[data-testid="assistant-turn"]','model-response','[data-role="assistant"]'];
    P0_USER.forEach(function(s){ document.querySelectorAll(s).forEach(function(el){ tryAdd(el,'user',0); }); });
    P0_AI.forEach(function(s){   document.querySelectorAll(s).forEach(function(el){ tryAdd(el,'ai',0);   }); });

    // P1: 平台专属选择器
    sel.user.forEach(function(s){ document.querySelectorAll(s).forEach(function(el){ tryAdd(el,'user',1); }); });
    sel.ai.forEach(function(s){   document.querySelectorAll(s).forEach(function(el){ tryAdd(el,'ai',1);   }); });

    // DeepSeek特殊处理：排除思考过程（thinking block）被误识别为用户指令
    // DeepSeek的思考块通常包含"思考过程"、"thinking"等关键词，且位于特定容器中
    if (hostname.includes('deepseek.com')) {
      document.querySelectorAll('[class*="thinking"],[class*="reasoning"],[class*="thought"]').forEach(function(el) {
        // 如果这个元素被标记为user，移除它
        if (elMap.has(el) && elMap.get(el).role === 'user') {
          elMap.delete(el);
        }
      });
      // 额外：排除包含"思考过程"或"Thinking"文本的容器
      elMap.forEach(function(info, el) {
        if (info.role === 'user') {
          var txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (txt.startsWith('思考过程') || txt.startsWith('thinking') || txt.startsWith('好的') || txt.length < 10) {
            elMap.delete(el);
          }
        }
      });
    }

    // P2: 兜底 class 关键词（仅在命中数 < 2 时启用）
    if (elMap.size < 2) {
      [['[class*="userMessage"]:not([class*="List"]):not([class*="container"])','user'],
       ['[class*="humanMessage"]:not([class*="List"])','user'],
       ['[class*="assistantMessage"]:not([class*="List"])','ai'],
       ['.ds-markdown','ai'],['.markdown-body','ai'],['.prose','ai']
      ].forEach(function(pair){
        document.querySelectorAll(pair[0]).forEach(function(el){ tryAdd(el, pair[1], 2); });
      });
    }

    // 转换为数组
    var candidates = [];
    elMap.forEach(function(info, el) { candidates.push({ el: el, role: info.role }); });

    // ── 合并策略：将同一AI回复的多个DOM片段合并 ──────────────
    // 策略1：同一父节点下有2+个同角色兄弟候选，用父节点替换
    var parentMap = new Map();
    candidates.forEach(function(c) {
      var p = c.el.parentElement;
      if (!p) return;
      if (!parentMap.has(p)) parentMap.set(p, []);
      parentMap.get(p).push(c);
    });
    var toMerge = new Set();
    var mergeAdd = [];
    parentMap.forEach(function(children, parent) {
      if (children.length < 2) return;
      var role0 = children[0].role;
      if (children.every(function(c) { return c.role === role0; })) {
        children.forEach(function(c) { toMerge.add(c.el); });
        if (!elMap.has(parent)) mergeAdd.push({ el: parent, role: role0 });
      }
    });
    if (toMerge.size > 0) {
      candidates = candidates.filter(function(c) { return !toMerge.has(c.el); });
      mergeAdd.forEach(function(item) { candidates.push(item); });
    }

    // 策略2：相邻同角色候选中，属于同一祖先容器（3层内）且之间无其他角色插入的AI回复片段，合并到最近公共祖先
    // 解决DeepSeek等平台AI回复被分散在不同容器（思考块/正文/代码块等）的问题
    var mergeGroups = [];
    var currentGroup = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c.role !== 'ai') {
        if (currentGroup.length >= 2) mergeGroups.push(currentGroup.slice());
        currentGroup = [];
        continue;
      }
      if (currentGroup.length === 0) {
        currentGroup.push(c);
      } else {
        var prev = currentGroup[currentGroup.length - 1];
        var sharedAncestor = findSharedAncestor(prev.el, c.el, 3);
        if (sharedAncestor) {
          currentGroup.push(c);
        } else {
          if (currentGroup.length >= 2) mergeGroups.push(currentGroup.slice());
          currentGroup = [c];
        }
      }
    }
    if (currentGroup.length >= 2) mergeGroups.push(currentGroup.slice());

    mergeGroups.forEach(function(group) {
      var ancestor = group[0].el;
      for (var k = 1; k < group.length; k++) {
        ancestor = findSharedAncestor(ancestor, group[k].el, 3) || ancestor;
      }
      group.forEach(function(item) { toMerge.add(item.el); });
      candidates.push({ el: ancestor, role: 'ai' });
    });
    if (toMerge.size > 0) {
      candidates = candidates.filter(function(c) { return !toMerge.has(c.el); });
    }

    // 辅助函数：查找两个元素在最多maxDepth层内的最近公共祖先
    function findSharedAncestor(a, b, maxDepth) {
      var ancestorsA = [];
      var cur = a;
      for (var d = 0; d <= maxDepth && cur && cur !== document.body; d++) {
        ancestorsA.push(cur);
        cur = cur.parentElement;
      }
      cur = b;
      for (var d = 0; d <= maxDepth && cur && cur !== document.body; d++) {
        if (ancestorsA.indexOf(cur) !== -1) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    // 过滤掉祖先节点：如果 A.contains(B) 且 A≠B，丢弃 A，只保留更内层的 B
    var filtered = candidates.filter(function(a) {
      return !candidates.some(function(b) {
        return a.el !== b.el && a.el.contains(b.el);
      });
    });

    // 按 DOM 顺序排列（保证对话顺序）
    filtered.sort(function(a, b) {
      var pos = a.el.compareDocumentPosition(b.el);
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });

    // 最终内容去重 + 相邻AI文本合并（文本级合并，不操作DOM）
    // 解决DeepSeek等平台AI回复被拆成多条但DOM层级太深无法用祖先合并的问题
    var seenContent = new Set();
    var messages = [];
    var pendingAiText = null; // 用于累积相邻AI片段的文本
    var pendingAiAttachments = [];

    function flushPendingAi() {
      if (pendingAiText !== null) {
        var text = pendingAiText.trim();
        if (text.length >= 3 || pendingAiAttachments.length > 0) {
          var key = text.length + '|' + text.slice(0, 80) + '|' + pendingAiAttachments.map(function(f) { return f.name; }).join(',');
          if (!seenContent.has(key)) {
            seenContent.add(key);
            var titleText = text.replace(/\n+/g, ' ').trim();
            if (!titleText && pendingAiAttachments.length > 0) titleText = '附件：' + pendingAiAttachments[0].name;
            messages.push({
              id: 'msg_' + Date.now() + '_' + messages.length,
              title: '🤖 ' + titleText.slice(0, 45) + (titleText.length > 45 ? '...' : ''),
              content: appendAttachmentsToContent(text, pendingAiAttachments), attachments: pendingAiAttachments.slice(), role: 'ai', selected: true, element: null
            });
          }
        }
        pendingAiText = null;
        pendingAiAttachments = [];
      }
    }

    filtered.forEach(function(item) {
      var attachments = extractAttachments(item.el);
      var text = (item.el.innerText || item.el.textContent || '').trim();
      if (text.length < 3 && attachments.length === 0) return;

      // 清理AI回复中的平台前缀（如"Gemini说"、"Gemini:"等）
      if (item.role === 'ai') {
        text = text.replace(/^(Gemini|DeepSeek|Claude|ChatGPT|Kimi|通义千问)\s*(说|：|:)\s*/i, '');
        text = text.replace(/^(Gemini|DeepSeek|Claude|ChatGPT|Kimi|通义千问)\s*/i, '');
      }

      if (item.role === 'user') {
        // 遇到用户消息，先flush累积的AI文本
        flushPendingAi();
        var key = text.length + '|' + text.slice(0, 80) + '|' + attachments.map(function(f) { return f.name; }).join(',');
        if (seenContent.has(key)) return;
        seenContent.add(key);
        var titleText = text.replace(/\n+/g, ' ').trim();
        if (!titleText && attachments.length > 0) titleText = '附件：' + attachments[0].name;
        messages.push({
          id: 'msg_' + Date.now() + '_' + messages.length,
          title: '👤 ' + titleText.slice(0, 45) + (titleText.length > 45 ? '...' : ''),
          content: appendAttachmentsToContent(text, attachments), attachments: attachments, role: 'user', selected: true, element: item.el
        });
      } else if (item.role === 'ai') {
        // AI消息：累积文本，后续合并
        if (pendingAiText === null) {
          pendingAiText = text;
          pendingAiAttachments = attachments;
        } else {
          // 检查是否与之前的AI文本有重叠（避免重复累积）
          var overlap = pendingAiText.slice(-100);
          if (text.indexOf(overlap) === -1) {
            pendingAiText += '\n\n' + text;
          }
          pendingAiAttachments = mergeAttachments(pendingAiAttachments, attachments);
        }
      }
    });
    // 最后flush
    flushPendingAi();

    messages = appendPageAttachments(messages);
    return messages;
  }

  function appendPageAttachments(messages) {
    var messageFileKeys = new Set();
    messages.forEach(function(msg) {
      (msg.attachments || []).forEach(function(file) {
        messageFileKeys.add((file.name || '') + '|' + (file.url || ''));
      });
    });

    var extraFiles = extractPageAttachments().filter(function(file) {
      return !messageFileKeys.has((file.name || '') + '|' + (file.url || ''));
    });

    if (extraFiles.length > 0 && messages.length > 0) {
      var target = messages.slice().reverse().find(function(msg) {
        return msg.role === 'user' || msg.role === 'ai';
      }) || messages[messages.length - 1];
      target.attachments = mergeAttachments(target.attachments || [], extraFiles);
      target.content = appendAttachmentsToContent(stripAttachmentBlock(target.content || ''), target.attachments);
      return messages;
    }

    extraFiles.forEach(function(file, idx) {
      messages.push({
        id: 'file_' + Date.now() + '_' + idx,
        title: '📎 ' + (file.name || '对话附件'),
        content: buildAttachmentContent([file]),
        attachments: [file],
        role: 'file',
        selected: true,
        element: null
      });
    });
    return messages;
  }

  function extractAttachments(root) {
    if (!root) return [];
    var fileExt = /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|tsv|json|xml|zip|rar|7z|tar|gz|png|jpe?g|gif|webp|svg|mp[34]|wav|m4a|py|js|ts|tsx|jsx|c|cc|cpp|h|hpp|sv|v|vh|java|go|rs|sh|bat|ps1|log)(\?|#|$)/i;
    var attachmentHint = /(attach|attachment|file|upload|document|image|文件|附件|上传|图片|文档)/i;
    var candidates = root.querySelectorAll('a[href], [download], img[src], video[src], audio[src], object[data], embed[src], [data-testid*="attach" i], [data-testid*="file" i], [class*="attach" i], [class*="file" i], [aria-label*="文件"], [aria-label*="附件"], [aria-label*="file" i], [title]');
    var files = [];
    candidates.forEach(function(el) {
      var url = el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('data') || '';
      var label = el.getAttribute('download') || el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('alt') || (el.innerText || el.textContent || '').trim();
      var classText = (el.className && typeof el.className === 'string') ? el.className : '';
      var testId = el.getAttribute('data-testid') || '';
      var raw = (label + ' ' + url).trim();
      var looksLikeFile = fileExt.test(raw) || attachmentHint.test(classText) || attachmentHint.test(testId) || el.hasAttribute('download');
      if (!looksLikeFile) return;
      if (el.tagName === 'IMG' && !fileExt.test(raw) && !/^blob:|^data:/i.test(url)) return;

      var name = inferAttachmentName(label, url);
      if (!name) return;
      if (/^(file|attachment|upload|download|文件|附件|上传|下载)$/i.test(name.trim())) return;
      files.push({
        name: name,
        type: inferAttachmentType(name, el.tagName),
        size: inferAttachmentSize(label),
        url: normalizeAttachmentUrl(url)
      });
    });
    return mergeAttachments([], files).slice(0, 12);
  }

  function extractPageAttachments() {
    return extractAttachments(document.body).slice(0, 50);
  }

  function scanPageFilesOnly() {
    var files = extractPageAttachments();
    var existingKeys = new Set();
    capturedItems.forEach(function(item) {
      (item.attachments || []).forEach(function(file) {
        existingKeys.add((file.name || '') + '|' + (file.url || ''));
      });
    });
    var newFiles = files.filter(function(file) {
      return !existingKeys.has((file.name || '') + '|' + (file.url || ''));
    });

    if (newFiles.length === 0) {
      showToast(files.length > 0 ? '📎 文件已在扫描结果中' : '未识别到页面文件');
      renderScanList();
      return;
    }

    if (capturedItems.length > 0) {
      var target = capturedItems.slice().reverse().find(function(item) {
        return item.role === 'user' || item.role === 'ai';
      }) || capturedItems[capturedItems.length - 1];
      target.attachments = mergeAttachments(target.attachments || [], newFiles);
      target.content = appendAttachmentsToContent(stripAttachmentBlock(target.content || ''), target.attachments);
      renderScanList();
      showToast('📎 已合并 ' + newFiles.length + ' 个文件到对话内容');
      return;
    }

    var fileItems = newFiles.map(function(file, idx) {
      return {
        id: 'file_' + Date.now() + '_' + idx,
        title: '📎 ' + (file.name || '对话附件'),
        content: buildAttachmentContent([file]),
        attachments: [file],
        role: 'file',
        selected: true,
        element: null
      };
    });
    capturedItems = capturedItems.concat(fileItems);
    renderScanList();
    showToast('📎 已识别 ' + fileItems.length + ' 个文件');
  }

  function buildAttachmentContent(files) {
    files = files || [];
    if (files.length === 0) return '';
    return '相关文件：\n' + files.map(function(file) {
      return '- ' + (file.name || '未命名文件')
        + (file.size ? '（' + file.size + '）' : '')
        + (file.url ? '\n  链接：' + file.url : '');
    }).join('\n');
  }

  function appendAttachmentsToContent(text, attachments) {
    attachments = attachments || [];
    var base = stripAttachmentBlock(text || '').trim();
    if (attachments.length === 0) return base;
    return (base ? base + '\n\n' : '') + buildAttachmentContent(attachments);
  }

  function stripAttachmentBlock(text) {
    return String(text || '').replace(/\n{0,2}相关文件：\n(?:- .+(?:\n  链接：.+)?\n?)+$/m, '').trim();
  }

  function inferAttachmentName(label, url) {
    var cleaned = String(label || '').replace(/\s+/g, ' ').trim();
    var extMatch = cleaned.match(/[^\\/:*?"<>|\s][^\\/:*?"<>|]*\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|tsv|json|xml|zip|rar|7z|tar|gz|png|jpe?g|gif|webp|svg|mp[34]|wav|m4a|py|js|ts|tsx|jsx|c|cc|cpp|h|hpp|sv|v|vh|java|go|rs|sh|bat|ps1|log)/i);
    if (extMatch) return extMatch[0].slice(0, 120);
    if (url) {
      try {
        var path = new URL(url, location.href).pathname;
        var last = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
        if (last) return last.slice(0, 120);
      } catch (e) {}
    }
    return cleaned ? cleaned.slice(0, 80) : '';
  }

  function inferAttachmentType(name, tagName) {
    var ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1];
    if (ext) return ext.toLowerCase();
    return String(tagName || 'file').toLowerCase();
  }

  function inferAttachmentSize(text) {
    var match = String(text || '').match(/\b\d+(?:\.\d+)?\s*(?:KB|MB|GB|B|字节)\b/i);
    return match ? match[0] : '';
  }

  function normalizeAttachmentUrl(url) {
    if (!url) return '';
    try { return new URL(url, location.href).href; } catch (e) { return url; }
  }

  function mergeAttachments(base, extra) {
    var out = [];
    var seen = new Set();
    (base || []).concat(extra || []).forEach(function(file) {
      var key = (file.name || '') + '|' + (file.url || '');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(file);
    });
    return out;
  }

  function scanPageMessages() {
    var messages = collectMessages();
    capturedItems = messages;
    renderScanList();
    var userCount = messages.filter(function(m) { return m.role === 'user'; }).length;
    var aiCount   = messages.filter(function(m) { return m.role === 'ai'; }).length;
    var fileCount = messages.reduce(function(n, m) { return n + ((m.attachments && m.attachments.length) || 0); }, 0);
    showToast('\uD83D\uDD0D \u626B\u63CF\u5B8C\u6210\uFF1A\uD83D\uDC64' + userCount + '\u6761\u6307\u4EE4 + \uD83E\uDD16' + aiCount + '\u6761\u56DE\u590D + \uD83D\uDCCE' + fileCount + '\u4E2A\u6587\u4EF6');
    startScrollWatch();
  }

  // ── 滚动监听 ──────────────────────────────────────────────
  function startScrollWatch() {
    if (scrollObserver) scrollObserver.disconnect();
    scrollObserver = new MutationObserver(function() {
      clearTimeout(scrollObserver._timer);
      scrollObserver._timer = setTimeout(checkNewMessages, 1000);
    });
    scrollObserver.observe(document.body, { childList: true, subtree: true, attributes: false });
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  var scrollTimer = null;
  function onScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function() {
      var scrollBottom = window.innerHeight + window.scrollY;
      var docHeight = document.documentElement.scrollHeight;
      if (docHeight - scrollBottom < 500) checkNewMessages();
    }, 800);
  }

  function checkNewMessages() {
    // 用 collectMessages 重新扫描，与已捕获内容做差集
    var existingKeys = new Set(capturedItems.map(function(m) {
      return m.content.length + '|' + m.content.slice(0, 80);
    }));
    var fresh = collectMessages();
    var newItems = fresh.filter(function(m) {
      return !existingKeys.has(m.content.length + '|' + m.content.slice(0, 80));
    });
    if (newItems.length > 0) {
      capturedItems = capturedItems.concat(newItems);
      renderScanList();
      showToast('\uD83D\uDCE5 \u53D1\u73B0 ' + newItems.length + ' \u6761\u65B0\u6D88\u606F');
    }
  }

  // ── 渲染扫描列表 ──────────────────────────────────────────
  function renderScanList() {
    var list = document.getElementById('amb-scan-list');
    if (!list) return;
    var countEl = document.getElementById('amb-scan-count');
    if (countEl) {
      var fileCount = capturedItems.reduce(function(n, item) {
        return n + ((item.attachments && item.attachments.length) || 0);
      }, 0);
      countEl.textContent = capturedItems.length > 0
        ? '已识别 ' + capturedItems.length + ' 条内容' + (fileCount ? ' · ' + fileCount + ' 个文件' : ' · 0 个文件')
        : '未扫描';
    }
    if (capturedItems.length === 0) {
      list.innerHTML = '<div class="amb-empty">点击 🔍 扫描当前页面所有AI指令</div>';
      return;
    }
    list.innerHTML = capturedItems.map(function(item, idx) {
      return [
        '<div class="amb-memory-item ' + (item.selected ? 'selected' : '') + '" data-idx="' + idx + '">',
        '  <div class="amb-item-select"><input type="checkbox" ' + (item.selected ? 'checked' : '') + ' data-idx="' + idx + '" /></div>',
        '  <div class="amb-item-body">',
        '    <div class="amb-item-header">',
        '      <span class="amb-item-title">' + escapeHtml(item.title) + '</span>',
        '      <span class="amb-item-num">#' + (idx + 1) + '</span>',
        '    </div>',
        '    <div class="amb-item-content">' + escapeHtml((item.content || item.title || '').slice(0, 200)) + ((item.content || '').length > 200 ? '...' : '') + '</div>',
        renderAttachmentChips(item.attachments),
        '    <div class="amb-item-meta">',
        '      <span class="amb-usage">' + item.content.length + ' 字符' + ((item.attachments && item.attachments.length) ? ' · ' + item.attachments.length + ' 个文件' : '') + '</span>',
        '      <div class="amb-item-btns">',
        '        <button class="amb-copy-btn" data-idx="' + idx + '" title="复制">📋</button>',
        '        <button class="amb-inject-btn" data-idx="' + idx + '" title="注入到输入框">📤</button>',
        '      </div>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    list.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var idx = parseInt(cb.dataset.idx);
        if (capturedItems[idx]) {
          capturedItems[idx].selected = cb.checked;
          var itemEl = cb.closest('.amb-memory-item');
          if (itemEl) itemEl.classList.toggle('selected', cb.checked);
        }
      });
    });
    list.querySelectorAll('.amb-copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.idx);
        if (capturedItems[idx]) { copyToClipboard(capturedItems[idx].content); showToast('📋 已复制'); }
      });
    });
    list.querySelectorAll('.amb-inject-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.idx);
        if (capturedItems[idx]) injectText(capturedItems[idx].content);
      });
    });
  }

  function renderAttachmentChips(attachments) {
    if (!attachments || attachments.length === 0) return '';
    return '<div class="amb-file-list">' + attachments.map(function(file) {
      var label = '📎 ' + (file.name || '文件') + (file.size ? ' · ' + file.size : '');
      return '<span class="amb-file-chip" title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</span>';
    }).join('') + '</div>';
  }

  function toggleSelectAll(select) {
    capturedItems.forEach(function(item) { item.selected = select; });
    renderScanList();
  }

  // ── 保存模态框 ────────────────────────────────────────────
  function openSaveModal() {
    var modal = document.getElementById('amb-capture-modal');
    if (!modal) return;
    var selectedCount = capturedItems.filter(function(m) { return m.selected; }).length;
    if (selectedCount === 0 && capturedItems.length > 0) {
      showToast('⚠️ 请先勾选要保存的指令');
      return;
    }
    if (capturedItems.length === 0) {
      showToast('⚠️ 请先点击 🔍 扫描页面');
      return;
    }
    document.getElementById('amb-group-name-input').value = '';
    document.getElementById('amb-save-tag-input').value = '';
    document.getElementById('amb-group-name-row').style.display = 'none';
    modal.style.display = 'flex';
  }

  function openSingleSaveModal(content, title) {
    capturedItems = [{
      id: 'manual_' + Date.now(),
      title: title || '手动创建',
      content: content || '',
      selected: true
    }];
    document.querySelectorAll('.amp-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.amp-tab-content').forEach(function(c) { c.classList.remove('active'); });
    document.querySelector('[data-amp-tab="scan"]').classList.add('active');
    document.getElementById('amp-tab-scan').classList.add('active');
    renderScanList();
    setTimeout(function() { openSaveModal(); }, 100);
  }

  function saveCapturedItems() {
    var modeEl = document.querySelector('input[name="save-mode"]:checked');
    var mode = modeEl ? modeEl.value : 'selected';
    var items = mode === 'selected' ? capturedItems.filter(function(m) { return m.selected; }) : capturedItems;
    if (items.length === 0) { showToast('⚠️ 没有要保存的指令'); return; }
    var tag = document.getElementById('amb-save-tag-input').value.trim() || '通用';

    if (mode === 'group') {
      var groupName = document.getElementById('amb-group-name-input').value.trim() || items[0].title;
      safeMsg({
        type: 'SAVE_MULTI_MEMORIES',
        data: {
          items: items.map(function(item) { return { title: item.title, content: item.content, attachments: item.attachments || [], role: item.role || 'manual', tag: tag }; }),
          defaultTag: tag,
          sourcePlatform: platform.name
        }
      }, function(res) {
        if (res && res.success) {
          var memoryIds = res.memories.map(function(m) { return m.id; });
          safeMsg({
            type: 'SAVE_GROUP',
            data: {
              name: groupName,
              description: '来自 ' + platform.name + ' 的 ' + items.length + ' 条指令',
              sourcePlatform: platform.name,
              memoryIds: memoryIds
            }
          }, function() {
            document.getElementById('amb-capture-modal').style.display = 'none';
            showToast('✅ 已保存项目组「' + groupName + '」(' + items.length + '条)');
            loadGroups();
          });
        }
      });
    } else {
      safeMsg({
        type: 'SAVE_MULTI_MEMORIES',
        data: {
          items: items.map(function(item) { return { title: item.title, content: item.content, attachments: item.attachments || [], role: item.role || 'manual', tag: tag }; }),
          defaultTag: tag,
          sourcePlatform: platform.name
        }
      }, function(res) {
        if (res && res.success) {
          document.getElementById('amb-capture-modal').style.display = 'none';
          showToast('✅ 已保存 ' + res.count + ' 条记忆');
          loadMemories();
        }
      });
    }
  }

  // ── 记忆库操作 ────────────────────────────────────────────
  function loadMemories() {
    safeMsg({ type: 'GET_MEMORIES' }, function(res) {
      if (res && res.success) { memories = res.memories; renderMemoryList(); updateBadge(); }
    });
  }

  function updateBadge() {
    safeMsg({ type: 'GET_MEMORIES' }, function(res) {
      var badge = document.getElementById('amb-badge');
      if (!badge) return;
      var count = res && res.memories ? res.memories.length : 0;
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    });
  }

  // ── 面板内记忆库的批量选择状态 ──
  var panelSelectedIds = new Set();
  var panelBatchMode = false;

  function renderMemoryList() {
    var list = document.getElementById('amb-memory-list');
    if (!list) return;
    var searchEl = document.getElementById('amb-search');
    var search = (searchEl ? searchEl.value : '').toLowerCase();
    var tagFilter = document.getElementById('amb-tag-filter');
    var tag = tagFilter ? tagFilter.value : 'all';
    var filtered = memories.filter(function(m) {
      var matchTag = tag === 'all' || m.tag === tag;
      var matchSearch = !search || m.title.toLowerCase().includes(search) || m.content.toLowerCase().includes(search);
      return matchTag && matchSearch;
    });
    if (filtered.length === 0) {
      list.innerHTML = '<div class="amb-empty">没有匹配的记忆</div>';
      return;
    }
    list.innerHTML = filtered.map(function(m) {
      var isSelected = panelSelectedIds.has(m.id);
      var cbChecked = isSelected ? 'checked' : '';
      var selectedClass = isSelected ? ' selected' : '';
      return [
        '<div class="amb-memory-item ' + (m.pinned ? 'pinned' : '') + selectedClass + '" data-id="' + m.id + '">',
        '  <div class="amb-item-select" style="display:' + (panelBatchMode ? 'flex' : 'none') + '">',
        '    <input type="checkbox" class="panel-batch-cb" data-id="' + m.id + '" ' + cbChecked + ' />',
        '  </div>',
        '  <div class="amb-item-body">',
        '    <div class="amb-item-header">',
        '      <span class="amb-item-title">' + escapeHtml(m.title) + '</span>',
        '      <span class="amb-item-tag">' + escapeHtml(m.tag) + '</span>',
        '    </div>',
        '    <div class="amb-item-content">' + escapeHtml(m.content) + '</div>',
        '    <div class="amb-item-meta">',
        '      <span class="amb-platform-badge">' + escapeHtml(m.sourcePlatform) + '</span>',
        '      <span class="amb-usage">使用 ' + (m.usageCount || 0) + ' 次</span>',
        '      <div class="amb-item-btns">',
        '        <button class="amb-use-btn" data-id="' + m.id + '" title="注入到输入框">📤 注入</button>',
        '        <button class="amb-copy-btn" data-id="' + m.id + '" title="复制">📋</button>',
        '        <button class="amb-pin-btn" data-id="' + m.id + '" title="' + (m.pinned ? '取消置顶' : '置顶') + '">📌</button>',
        '        <button class="amb-del-btn" data-id="' + m.id + '" title="删除">🗑</button>',
        '      </div>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    list.querySelectorAll('.amb-use-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { injectMemory(btn.dataset.id); });
    });
    list.querySelectorAll('.amb-copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { copyMemory(btn.dataset.id); });
    });
    list.querySelectorAll('.amb-pin-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { pinMemory(btn.dataset.id); });
    });
    list.querySelectorAll('.amb-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { deleteMemory(btn.dataset.id); });
    });
    // 批量选择 checkbox 事件
    list.querySelectorAll('.panel-batch-cb').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var id = this.dataset.id;
        if (this.checked) {
          panelSelectedIds.add(id);
          this.closest('.amb-memory-item').classList.add('selected');
        } else {
          panelSelectedIds.delete(id);
          this.closest('.amb-memory-item').classList.remove('selected');
        }
        updatePanelBatchBar();
      });
    });
  }

  function updatePanelBatchBar() {
    var countEl = document.getElementById('amb-panel-batch-count');
    if (!countEl) return;
    var count = panelSelectedIds.size;
    countEl.textContent = count + ' 条已选';
    var delBtn = document.getElementById('amb-panel-delete-selected');
    if (delBtn) delBtn.disabled = count === 0;
  }

  function togglePanelBatchMode() {
    panelBatchMode = !panelBatchMode;
    panelSelectedIds.clear();
    var list = document.getElementById('amb-memory-list');
    var batchBtn = document.getElementById('amb-panel-batch-btn');

    if (panelBatchMode) {
      if (batchBtn) batchBtn.textContent = '☑ 取消';
      list.querySelectorAll('.amb-item-select').forEach(function(el) { el.style.display = 'flex'; });
      list.querySelectorAll('.amb-memory-item').forEach(function(el) { el.classList.remove('selected'); });
    } else {
      if (batchBtn) batchBtn.textContent = '☑ 批量';
      list.querySelectorAll('.amb-item-select').forEach(function(el) { el.style.display = 'none'; });
      list.querySelectorAll('.panel-batch-cb').forEach(function(cb) { cb.checked = false; });
      list.querySelectorAll('.amb-memory-item').forEach(function(el) { el.classList.remove('selected'); });
    }
    updatePanelBatchBar();
  }

  function deletePanelSelectedMemories() {
    var ids = Array.from(panelSelectedIds);
    if (ids.length === 0) { showToast('⚠️ 请先选择要删除的记忆'); return; }
    if (!confirm('确定删除选中的 ' + ids.length + ' 条记忆？')) return;

    safeMsg({ type: 'DELETE_MEMORIES_BATCH', ids: ids }, function() {
      memories = memories.filter(function(m) { return !panelSelectedIds.has(m.id); });
      panelSelectedIds.clear();
      panelBatchMode = false;
      var batchBtn = document.getElementById('amb-panel-batch-btn');
      if (batchBtn) batchBtn.textContent = '☑ 批量';
      loadMemories();
      updateBadge();
      showToast('🗑 已删除 ' + ids.length + ' 条记忆');
    });
  }

  // ── 项目组操作 ────────────────────────────────────────────
  function loadGroups() {
    safeMsg({ type: 'GET_GROUPS' }, function(res) {
      if (res && res.success) { groups = res.groups; renderGroupList(); }
    });
  }

  function renderGroupList() {
    var list = document.getElementById('amb-group-list');
    if (!list) return;
    var countEl = document.getElementById('amb-group-count');
    if (countEl) countEl.textContent = groups.length > 0 ? groups.length + ' 个项目组' : '无项目组';
    if (groups.length === 0) {
      list.innerHTML = '<div class="amb-empty">暂无项目组<br/>扫描页面后选择「保存为项目组」</div>';
      return;
    }
    list.innerHTML = groups.map(function(g) {
      var memCount = g.memoryIds ? g.memoryIds.length : 0;
      return [
        '<div class="amb-group-item" data-id="' + g.id + '">',
        '  <div class="amb-group-header">',
        '    <span class="amb-group-icon">📁</span>',
        '    <span class="amb-group-name">' + escapeHtml(g.name) + '</span>',
        '    <span class="amb-group-count">' + memCount + '条</span>',
        '  </div>',
        '  <div class="amb-group-desc">' + escapeHtml(g.description || '') + '</div>',
        '  <div class="amb-group-meta">',
        '    <span class="amb-platform-badge">' + escapeHtml(g.sourcePlatform) + '</span>',
        '    <div class="amb-item-btns">',
        '      <button class="amb-group-inject-all" data-id="' + g.id + '" title="注入全部到输入框">📤 全部注入</button>',
        '      <button class="amb-group-export" data-id="' + g.id + '" title="导出为笔记网页">📄 导出笔记</button>',
        '      <button class="amb-group-ai-notes" data-id="' + g.id + '" title="AI 辅助生成笔记">🤖 AI 笔记</button>',
        '      <button class="amb-group-rename" data-id="' + g.id + '" title="重命名">✏️</button>',
        '      <button class="amb-group-del" data-id="' + g.id + '" title="删除项目组">🗑</button>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    list.querySelectorAll('.amb-group-inject-all').forEach(function(btn) {
      btn.addEventListener('click', function() { injectGroupAll(btn.dataset.id); });
    });
    list.querySelectorAll('.amb-group-export').forEach(function(btn) {
      btn.addEventListener('click', function() { exportGroupNotes(btn.dataset.id); });
    });
    list.querySelectorAll('.amb-group-ai-notes').forEach(function(btn) {
      btn.addEventListener('click', function() { exportGroupAsAIGeneratedNotes(btn.dataset.id); });
    });
    list.querySelectorAll('.amb-group-rename').forEach(function(btn) {
      btn.addEventListener('click', function() { renameGroup(btn.dataset.id); });
    });
    list.querySelectorAll('.amb-group-del').forEach(function(btn) {
      btn.addEventListener('click', function() { deleteGroup(btn.dataset.id); });
    });
  }

  function createNewGroupFromSelection() {
    var selected = capturedItems.filter(function(m) { return m.selected; });
    if (selected.length === 0) { showToast('⚠️ 请先在扫描结果中勾选指令'); return; }
    var modal = document.getElementById('amb-capture-modal');
    if (!modal) return;
    document.querySelector('input[name="save-mode"][value="group"]').checked = true;
    document.getElementById('amb-group-name-row').style.display = 'block';
    document.getElementById('amb-group-name-input').value = selected[0].title;
    document.getElementById('amb-save-tag-input').value = '';
    modal.style.display = 'flex';
  }

  function injectGroupAll(groupId) {
    var group = groups.find(function(g) { return g.id === groupId; });
    if (!group || !group.memoryIds || group.memoryIds.length === 0) { showToast('⚠️ 项目组为空'); return; }
    safeMsg({ type: 'GET_MEMORIES' }, function(res) {
      if (!res || !res.success) return;
      var groupMemories = res.memories.filter(function(m) { return group.memoryIds.includes(m.id); });
      if (groupMemories.length === 0) { showToast('⚠️ 项目组中无可用记忆'); return; }
      var combined = groupMemories.map(function(m, i) {
        return '=== ' + m.title + ' ===\n' + m.content;
      }).join('\n\n---\n\n');
      injectText(combined);
      showToast('📤 已注入项目组 ' + groupMemories.length + ' 条指令');
    });
  }

  function renameGroup(id) {
    var group = groups.find(function(g) { return g.id === id; });
    if (!group) return;
    var newName = prompt('请输入新的项目组名称：', group.name);
    if (newName && newName.trim()) {
      safeMsg({ type: 'UPDATE_GROUP', data: { id: id, name: newName.trim() } }, function() { loadGroups(); });
    }
  }

  function deleteGroup(id) {
    if (!confirm('确定删除此项目组？（关联的记忆不会被删除）')) return;
    safeMsg({ type: 'DELETE_GROUP', id: id }, function() {
      groups = groups.filter(function(g) { return g.id !== id; });
      renderGroupList();
      showToast('🗑 项目组已删除');
    });
  }

  // ── 导出项目组为笔记网页（HTML生成由 notes_html.js 提供）──
  function exportGroupNotes(groupId) {
    var group = groups.find(function(g) { return g.id === groupId; });
    if (!group) return;
    showToast('⏳ 正在生成笔记...');
    safeMsg({ type: 'GET_MEMORIES' }, function(res) {
      var allMems = (res && res.success) ? res.memories : [];
      var mems = allMems.filter(function(m) {
        return group.memoryIds && group.memoryIds.includes(m.id);
      });
      if (mems.length === 0) { showToast('⚠️ 项目组无内容'); return; }
      var html = generateNotesHTML(group, mems);
      downloadHTMLFile(html, group.name.replace(/[\\/:*?"<>|]/g, '_') + '_笔记.html');
      showToast('📄 笔记已导出（可编辑 · 自动保存）');
    });
  }

  // ── AI 辅助生成笔记 ──
  function exportGroupAsAIGeneratedNotes(groupId) {
    var group = groups.find(function(g) { return g.id === groupId; });
    if (!group) return;

    // 先显示加载中
    var loadingHtml = generateNotesHTML(group, [], { aiLoading: true });
    downloadHTMLFile(loadingHtml, group.name.replace(/[\\/:*?"<>|]/g, '_') + '_笔记_AI生成中.html');
    showToast('⏳ AI 正在整理笔记，请稍候...');

    safeMsg({ type: 'GET_MEMORIES' }, function(res) {
      var allMems = (res && res.success) ? res.memories : [];
      var mems = allMems.filter(function(m) {
        return group.memoryIds && group.memoryIds.includes(m.id);
      });
      if (mems.length === 0) { showToast('⚠️ 项目组无内容'); return; }

      // 配对
      var sorted = mems.slice().sort(function(a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      var pairs = [];
      var i = 0;
      while (i < sorted.length) {
        var m = sorted[i];
        if (m.role === 'user') {
          var nx = sorted[i + 1];
          if (nx && nx.role === 'ai') {
            pairs.push({ q: m.content, a: nx.content, qAttachments: m.attachments || [], aAttachments: nx.attachments || [] });
            i += 2;
          }
          else { pairs.push({ q: m.content, a: '', qAttachments: m.attachments || [], aAttachments: [] }); i++; }
        } else { pairs.push({ q: '', a: m.content, qAttachments: [], aAttachments: m.attachments || [] }); i++; }
      }

      safeMsg({
        type: 'AI_GENERATE_NOTES',
        data: { pairs: pairs, groupName: group.name, sourcePlatform: group.sourcePlatform }
      }, function(res2) {
        if (res2 && res2.success) {
          var html = generateNotesHTML(group, mems, { aiGenerated: true, aiHtml: res2.html });
          downloadHTMLFile(html, group.name.replace(/[\\/:*?"<>|]/g, '_') + '_笔记_AI整理.html');
          showToast('🤖 AI 笔记已生成！');
        } else {
          showToast('⚠️ AI 生成失败: ' + (res2 && res2.error ? res2.error : '未知错误') + '，已使用普通模式');
          var html = generateNotesHTML(group, mems);
          downloadHTMLFile(html, group.name.replace(/[\\/:*?"<>|]/g, '_') + '_笔记.html');
        }
      });
    });
  }

  function downloadHTMLFile(html, filename) {
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }


  // ── 注入文本到输入框 ──────────────────────────────────────
  function injectText(text) {
    var injected = false;
    for (var si = 0; si < platform.inputSelectors.length; si++) {
      var el = document.querySelector(platform.inputSelectors[si]);
      if (!el) continue;

      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        injected = true;
        break;
      } else if (el.isContentEditable) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        injected = true;
        break;
      }
    }
    if (injected) {
      showToast('📤 已注入到输入框！');
    } else {
      copyToClipboard(text);
      showToast('📋 未找到输入框，已复制到剪贴板');
    }
  }

  function injectMemory(id) {
    var memory = memories.find(function(m) { return m.id === id; });
    if (!memory) return;
    injectText(memory.content);
    safeMsg({ type: 'USE_MEMORY', id: id });
    memory.usageCount = (memory.usageCount || 0) + 1;
  }

  function copyMemory(id) {
    var memory = memories.find(function(m) { return m.id === id; });
    if (!memory) return;
    copyToClipboard(memory.content);
    showToast('📋 已复制到剪贴板');
  }

  function pinMemory(id) {
    safeMsg({ type: 'PIN_MEMORY', id: id }, function() { loadMemories(); });
  }

  function deleteMemory(id) {
    if (!confirm('确定删除这条记忆？')) return;
    safeMsg({ type: 'DELETE_MEMORY', id: id }, function() {
      memories = memories.filter(function(m) { return m.id !== id; });
      renderMemoryList();
      updateBadge();
      showToast('🗑 已删除');
    });
  }

  // ── 导出/导入 ─────────────────────────────────────────────
  function exportMemories() {
    safeMsg({ type: 'EXPORT_MEMORIES' }, function(res) {
      if (!res || !res.success) return;
      var blob = new Blob([res.data], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'ai-memories-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('📤 导出成功');
    });
  }

  function importMemories(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      safeMsg({ type: 'IMPORT_MEMORIES', data: ev.target.result }, function(res) {
        if (res && res.success) {
          showToast('📥 成功导入 ' + res.count + ' 条新记忆');
          loadMemories();
        } else {
          showToast('❌ 导入失败：格式错误');
        }
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ── 工具函数 ──────────────────────────────────────────────
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(function() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"');
  }

  var toastTimer;
  function showToast(msg) {
    var toast = document.getElementById('amb-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'amb-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 2200);
  }

  // ── 消息监听 ──────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    switch (message.type) {
      case 'INJECT_MEMORY':
        // 支持两种方式：按ID查记忆 或 直接注入content字段（项目组合并内容）
        if (message.content) {
          injectText(message.content);
          if (message.id) safeMsg({ type: 'USE_MEMORY', id: message.id });
        } else {
          injectMemory(message.id);
        }
        sendResponse({ success: true });
        break;
      case 'OPEN_PANEL':
        if (!panel) createPanel();
        panel.style.display = 'flex';
        isVisible = true;
        loadMemories();
        loadGroups();
        sendResponse({ success: true });
        break;
      case 'CLOSE_PANEL':
        if (panel) panel.style.display = 'none';
        isVisible = false;
        sendResponse({ success: true });
        break;
    }
    return true;
  });

  // ── 初始化 ────────────────────────────────────────────────
  function init() {
    createFloatButton();
    safeMsg({ type: 'GET_SETTINGS' }, function(res) {
      // 防御 settings 为 null 的情况
      if (res && res.success && res.settings && res.settings.autoCapture) {
        setTimeout(scanPageMessages, 3000);
      }
      // 根据设置控制悬浮按钮显示
      if (res && res.success && res.settings && res.settings.showFloatButton === false) {
        if (floatBtn) floatBtn.style.display = 'none';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
