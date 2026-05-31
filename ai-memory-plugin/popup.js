// AI Memory Bridge - Popup Script v2.0
'use strict';

// ── 平台配置 ─────────────────────────────────────────────────
const PLATFORM_MAP = {
  'gemini.google.com':    { name: 'Gemini',    color: '#4285f4' },
  'chat.deepseek.com':    { name: 'DeepSeek',  color: '#1a73e8' },
  'claude.ai':            { name: 'Claude',    color: '#d97706' },
  'chatgpt.com':          { name: 'ChatGPT',   color: '#10a37f' },
  'chat.openai.com':      { name: 'ChatGPT',   color: '#10a37f' },
  'kimi.moonshot.cn':     { name: 'Kimi',      color: '#7c3aed' },
  'tongyi.aliyun.com':    { name: '通义千问',  color: '#f59e0b' }
};

// ── 状态 ─────────────────────────────────────────────────────
let allMemories = [];
let allGroups = [];
let currentTab = null;
let editingId = null;

// ── 初始化 ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await detectCurrentTab();
  await loadMemories();
  await loadGroups();
  await loadSettings();
  bindEvents();
});

async function detectCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    const url = new URL(tab.url);
    const host = url.hostname;
    const platformInfo = document.getElementById('platform-info');
    const currentPlatform = document.getElementById('current-platform');

    let found = null;
    for (const [domain, info] of Object.entries(PLATFORM_MAP)) {
      if (host.includes(domain)) { found = info; break; }
    }

    if (found) {
      platformInfo.textContent = '当前：' + found.name;
      platformInfo.style.color = found.color;
      currentPlatform.textContent = '📍 ' + found.name + ' - 点击「注入」直接填入输入框';
      currentPlatform.style.color = found.color;
    } else {
      platformInfo.textContent = '非AI平台页面';
      currentPlatform.textContent = '⚠️ 当前不在支持的AI平台，可手动复制';
    }
  } catch (_) {
    document.getElementById('platform-info').textContent = '无法检测';
  }
}

async function loadMemories() {
  chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }, (res) => {
    allMemories = (res && res.success) ? res.memories : [];
    renderMemories();
    renderQuickList();
    updateCount();
  });
}

async function loadGroups() {
  chrome.runtime.sendMessage({ type: 'GET_GROUPS' }, (res) => {
    allGroups = (res && res.success) ? res.groups : [];
    renderGroups();
    updateGroupCount();
  });
}

async function loadSettings() {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
    if (!res || !res.success) return;
    const s = res.settings;
    const floatCheck = document.getElementById('setting-float-btn');
    const autoCheck = document.getElementById('setting-auto-capture');
    const defaultTag = document.getElementById('setting-default-tag');
    if (floatCheck) floatCheck.checked = s.showFloatButton !== false;
    if (autoCheck) autoCheck.checked = !!s.autoCapture;
    if (defaultTag) defaultTag.value = s.defaultTag || '通用';
    // AI 设置
    const aiKey = document.getElementById('setting-ai-api-key');
    const aiEndpoint = document.getElementById('setting-ai-api-endpoint');
    const aiModel = document.getElementById('setting-ai-api-model');
    if (aiKey) aiKey.value = s.aiApiKey || '';
    if (aiEndpoint) aiEndpoint.value = s.aiApiEndpoint || 'https://api.openai.com/v1/chat/completions';
    if (aiModel) aiModel.value = s.aiApiModel || 'gpt-3.5-turbo';
  });
}


// ── 渲染记忆列表 ──────────────────────────────────────────────
// ── 批量选择状态 ──
let selectedIds = new Set();
let batchMode = false;

function renderMemories() {
  const list = document.getElementById('memory-list');
  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  const tag = document.getElementById('tag-filter')?.value || 'all';

  const filtered = allMemories.filter(m => {
    const matchTag = tag === 'all' || m.tag === tag;
    const matchSearch = !search ||
      m.title.toLowerCase().includes(search) ||
      m.content.toLowerCase().includes(search);
    return matchTag && matchSearch;
  });

  if (filtered.length === 0) {
    list.innerHTML = [
      '<div class="empty-state">',
      '  <div class="empty-icon">🧠</div>',
      '  <div class="empty-text">' + (allMemories.length === 0 ? '记忆库为空' : '无匹配结果') + '</div>',
      '  <div class="empty-sub">' + (allMemories.length === 0
        ? '在AI平台页面点击紫色悬浮按钮 📥 抓取指令'
        : '换个关键词试试') + '</div>',
      '</div>'
    ].join('');
    return;
  }

  list.innerHTML = filtered.map(m => buildCard(m, false)).join('');
  bindCardEvents(list, false);
  // 恢复选中状态和批量模式UI（修复：renderMemories 重建 DOM 后需恢复 checkbox 可见性）
  if (batchMode) {
    list.querySelectorAll('.memory-card').forEach(card => {
      const id = card.dataset.id;
      if (selectedIds.has(id)) card.classList.add('batch-selected');
      const cb = card.querySelector('.batch-cb');
      if (cb) {
        cb.style.display = 'inline-block';
        cb.checked = selectedIds.has(id);
      }
    });
  }
  updateBatchBar();
}

function renderQuickList() {
  const list = document.getElementById('quick-list');
  if (!list) return;

  const pinned = allMemories.filter(m => m.pinned);
  const recent = allMemories.filter(m => !m.pinned).slice(0, 10);
  const toShow = [...pinned, ...recent].slice(0, 15);

  if (toShow.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📤</div><div class="empty-text">暂无记忆</div></div>';
    return;
  }

  list.innerHTML = toShow.map(m => buildCard(m, true)).join('');
  bindCardEvents(list, true);
}

function buildCard(m, quickMode) {
  const preview = m.content.slice(0, 100).replace(/\n/g, ' ');
  const pinIcon = m.pinned ? '<span class="card-pin-icon">📌</span>' : '';
  const groupInfo = m.groupId ? '<span class="card-group-badge">📁 项目组</span>' : '';
  const fileInfo = m.attachments && m.attachments.length ? '<span class="card-files">📎 ' + m.attachments.length + ' 文件</span>' : '';
  const cbHtml = !quickMode ? '<input type="checkbox" class="batch-cb" data-id="' + m.id + '" style="display:none;accent-color:#667eea;width:14px;height:14px;flex-shrink:0;cursor:pointer;" />' : '';
  return [
    '<div class="memory-card ' + (m.pinned ? 'pinned' : '') + '" data-id="' + m.id + '">',
    '  <div class="card-header">',
    '    ' + cbHtml,
    '    ' + pinIcon,
    '    <span class="card-title" title="' + escapeHtml(m.title) + '">' + escapeHtml(m.title) + '</span>',
    '    <span class="card-tag">' + escapeHtml(m.tag) + '</span>',
    '  </div>',
    '  <div class="card-preview">' + escapeHtml(preview) + (m.content.length > 100 ? '...' : '') + '</div>',
    '  <div class="card-footer">',
    '    <span class="card-source">' + escapeHtml(m.sourcePlatform || '未知') + '</span>',
    '    ' + groupInfo,
    '    ' + fileInfo,
    '    <span class="card-uses">用了 ' + (m.usageCount || 0) + ' 次</span>',
    '    <div class="card-actions">',
    '      <button class="btn-inject" data-id="' + m.id + '" title="注入到当前页面输入框">📤 注入</button>',
    '      <button class="btn-copy" data-id="' + m.id + '" title="复制内容">📋</button>',
    (!quickMode ? [
    '      <button class="btn-edit" data-id="' + m.id + '" title="编辑">✏️</button>',
    '      <button class="btn-pin" data-id="' + m.id + '" title="' + (m.pinned ? '取消置顶' : '置顶') + '">📌</button>',
    '      <button class="btn-del" data-id="' + m.id + '" title="删除">🗑</button>'
    ].join('\n') : ''),
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

function bindCardEvents(container, quickMode) {
  container.querySelectorAll('.btn-inject').forEach(btn => {
    btn.addEventListener('click', () => injectToPage(btn.dataset.id));
  });
  container.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => copyMemory(btn.dataset.id));
  });
  if (!quickMode) {
    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
    container.querySelectorAll('.btn-pin').forEach(btn => {
      btn.addEventListener('click', () => pinMemory(btn.dataset.id));
    });
    container.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => deleteMemory(btn.dataset.id));
    });
    // 批量选择 checkbox
    container.querySelectorAll('.batch-cb').forEach(cb => {
      cb.addEventListener('change', function() {
        const id = this.dataset.id;
        if (this.checked) {
          selectedIds.add(id);
          this.closest('.memory-card').classList.add('batch-selected');
        } else {
          selectedIds.delete(id);
          this.closest('.memory-card').classList.remove('batch-selected');
        }
        updateBatchBar();
      });
    });
  }
}

function updateCount() {
  const el = document.getElementById('memory-count');
  if (el) el.textContent = allMemories.length + ' 条记忆';
}

function updateGroupCount() {
  const el = document.getElementById('group-count');
  if (el) el.textContent = allGroups.length + ' 个项目组';
}

// ── 渲染项目组列表 ────────────────────────────────────────────
function renderGroups() {
  const list = document.getElementById('group-list');
  if (!list) return;

  if (allGroups.length === 0) {
    list.innerHTML = [
      '<div class="empty-state">',
      '  <div class="empty-icon">📁</div>',
      '  <div class="empty-text">暂无项目组</div>',
      '  <div class="empty-sub">在AI页面扫描指令后选择「保存为项目组」</div>',
      '</div>'
    ].join('');
    return;
  }

  list.innerHTML = allGroups.map(g => {
    const memCount = g.memoryIds ? g.memoryIds.length : 0;
    const memPreview = allMemories.filter(m => g.memoryIds && g.memoryIds.includes(m.id));
    const previewText = memPreview.slice(0, 3).map(m => m.title).join('、');
    return [
      '<div class="group-card" data-id="' + g.id + '">',
      '  <div class="group-card-header">',
      '    <span class="group-card-icon">📁</span>',
      '    <span class="group-card-name" title="' + escapeHtml(g.name) + '">' + escapeHtml(g.name) + '</span>',
      '    <span class="group-card-count">' + memCount + '条</span>',
      '  </div>',
      '  <div class="group-card-desc">' + escapeHtml(g.description || '') + '</div>',
      '  <div class="group-card-preview">' + escapeHtml(previewText) + '</div>',
      '  <div class="group-card-footer">',
      '    <span class="card-source">' + escapeHtml(g.sourcePlatform) + '</span>',
      '    <div class="card-actions">',
      '      <button class="btn-inject-group" data-id="' + g.id + '" title="注入全部指令">📤 全部注入</button>',
      '      <button class="btn-export-notes" data-id="' + g.id + '" title="导出为笔记网页">📄 导出笔记</button>',
      '      <button class="btn-ai-notes" data-id="' + g.id + '" title="AI 辅助生成笔记">🤖 AI 笔记</button>',
      '      <button class="btn-rename-group" data-id="' + g.id + '" title="重命名">✏️</button>',

      '      <button class="btn-del-group" data-id="' + g.id + '" title="删除项目组">🗑</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }).join('');

  list.querySelectorAll('.btn-inject-group').forEach(btn => {
    btn.addEventListener('click', () => injectGroupToPage(btn.dataset.id));
  });
  list.querySelectorAll('.btn-rename-group').forEach(btn => {
    btn.addEventListener('click', () => renameGroup(btn.dataset.id));
  });
  list.querySelectorAll('.btn-del-group').forEach(btn => {
    btn.addEventListener('click', () => deleteGroup(btn.dataset.id));
  });
  list.querySelectorAll('.btn-export-notes').forEach(btn => {
    btn.addEventListener('click', () => exportGroupAsNotes(btn.dataset.id));
  });
  list.querySelectorAll('.btn-ai-notes').forEach(btn => {
    btn.addEventListener('click', () => exportGroupAsAIGeneratedNotes(btn.dataset.id));
  });

}

// ── 项目组操作 ────────────────────────────────────────────────
function injectGroupToPage(groupId) {
  const group = allGroups.find(g => g.id === groupId);
  if (!group || !group.memoryIds || group.memoryIds.length === 0) {
    showToast('⚠️ 项目组为空');
    return;
  }
  const groupMemories = allMemories.filter(m => group.memoryIds.includes(m.id));
  if (groupMemories.length === 0) {
    showToast('⚠️ 项目组中无可用记忆');
    return;
  }
  const combined = groupMemories.map((m, i) => '=== ' + m.title + ' ===\n' + m.content).join('\n\n---\n\n');

  if (!currentTab) { showToast('⚠️ 无法获取当前标签页'); return; }

  try {
    chrome.tabs.sendMessage(currentTab.id, {
      type: 'INJECT_MEMORY',
      id: groupMemories[0].id,
      content: combined
    }).catch(() => {
      // 如果content script不支持，复制到剪贴板
      copyToClipboard(combined);
      showToast('📋 已复制项目组内容到剪贴板');
    });
    showToast('📤 已注入项目组 ' + groupMemories.length + ' 条指令');
  } catch (err) {
    copyToClipboard(combined);
    showToast('📋 已复制项目组内容到剪贴板');
  }
}

function renameGroup(id) {
  const group = allGroups.find(g => g.id === id);
  if (!group) return;
  const newName = prompt('请输入新的项目组名称：', group.name);
  if (newName && newName.trim()) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_GROUP',
      data: { id: id, name: newName.trim() }
    }, () => loadGroups());
  }
}

function deleteGroup(id) {
  if (!confirm('确定删除此项目组？（关联的记忆不会被删除）')) return;
  chrome.runtime.sendMessage({ type: 'DELETE_GROUP', id: id }, () => {
    allGroups = allGroups.filter(g => g.id !== id);
    renderGroups();
    updateGroupCount();
    showToast('🗑 项目组已删除');
  });
}

// ── 合并项目组 ────────────────────────────────────────────────
function openMergeModal() {
  if (allGroups.length < 2) {
    showToast('⚠️ 至少需要2个项目组才能合并');
    return;
  }
  const list = document.getElementById('merge-group-list');
  list.innerHTML = allGroups.map(g => {
    const memCount = g.memoryIds ? g.memoryIds.length : 0;
    return [
      '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:rgba(255,255,255,0.04);border-radius:6px;cursor:pointer;">',
      '  <input type="checkbox" class="merge-checkbox" value="' + g.id + '" />',
      '  <span style="flex:1;font-size:12px;color:#e2e8f0;">' + escapeHtml(g.name) + '</span>',
      '  <span style="font-size:10px;color:#64748b;">' + memCount + '条</span>',
      '</label>'
    ].join('');
  }).join('');
  document.getElementById('merge-group-name').value = '';
  document.getElementById('merge-modal-overlay').style.display = 'flex';
}

function closeMergeModal() {
  document.getElementById('merge-modal-overlay').style.display = 'none';
}

function confirmMerge() {
  const checked = document.querySelectorAll('.merge-checkbox:checked');
  const ids = Array.from(checked).map(cb => cb.value);
  if (ids.length < 2) {
    showToast('⚠️ 请至少选择2个项目组');
    return;
  }
  const newName = document.getElementById('merge-group-name').value.trim();
  if (!newName) {
    showToast('⚠️ 请填写合并后的项目组名称');
    return;
  }
  chrome.runtime.sendMessage({
    type: 'MERGE_GROUPS',
    ids: ids,
    data: { newName: newName }
  }, (res) => {
    if (res && res.success) {
      closeMergeModal();
      showToast('✅ 已合并项目组');
      loadGroups();
    } else {
      showToast('❌ 合并失败：' + (res.error || '未知错误'));
    }
  });
}

// ── 操作函数 ─────────────────────────────────────────────────
async function injectToPage(id) {
  if (!currentTab) { showToast('⚠️ 无法获取当前标签页'); return; }

  const memory = allMemories.find(m => m.id === id);
  if (!memory) return;

  try {
    await chrome.tabs.sendMessage(currentTab.id, {
      type: 'INJECT_MEMORY',
      id: id
    });
    chrome.runtime.sendMessage({ type: 'USE_MEMORY', id: id });
    showToast('📤 已注入到输入框！');
    const mem = allMemories.find(m => m.id === id);
    if (mem) mem.usageCount = (mem.usageCount || 0) + 1;
  } catch (err) {
    copyToClipboard(memory.content);
    showToast('📋 非AI平台，已复制到剪贴板');
  }
}

function copyMemory(id) {
  const memory = allMemories.find(m => m.id === id);
  if (!memory) return;
  copyToClipboard(memory.content);
  showToast('📋 已复制到剪贴板');
}

function pinMemory(id) {
  chrome.runtime.sendMessage({ type: 'PIN_MEMORY', id: id }, () => loadMemories());
}

function deleteMemory(id) {
  if (!confirm('确定删除这条记忆？')) return;
  chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', id: id }, () => {
    allMemories = allMemories.filter(m => m.id !== id);
    renderMemories();
    renderQuickList();
    updateCount();
    showToast('🗑 已删除');
  });
}

// ── 模态框 ───────────────────────────────────────────────────
function openNewModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = '✏️ 新建记忆';
  document.getElementById('modal-name').value = '';
  document.getElementById('modal-content').value = '';
  document.getElementById('modal-tag').value = '通用';
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('modal-name').focus();
}

function openEditModal(id) {
  const mem = allMemories.find(m => m.id === id);
  if (!mem) return;
  editingId = id;
  document.getElementById('modal-title').textContent = '✏️ 编辑记忆';
  document.getElementById('modal-name').value = mem.title;
  document.getElementById('modal-content').value = mem.content;
  document.getElementById('modal-tag').value = mem.tag || '通用';
  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  editingId = null;
}

function saveModal() {
  const title = document.getElementById('modal-name').value.trim();
  const content = document.getElementById('modal-content').value.trim();
  const tag = document.getElementById('modal-tag').value;

  if (!title) { showToast('⚠️ 请填写标题'); return; }
  if (!content) { showToast('⚠️ 请填写内容'); return; }

  if (editingId) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_MEMORY',
      data: { id: editingId, title: title, content: content, tag: tag }
    }, () => {
      closeModal();
      showToast('✅ 已更新');
      loadMemories();
    });
  } else {
    chrome.runtime.sendMessage({
      type: 'SAVE_MEMORY',
      data: { title: title, content: content, tag: tag, sourcePlatform: '手动创建' }
    }, () => {
      closeModal();
      showToast('✅ 已保存');
      loadMemories();
    });
  }
}

// ── 导入/导出 ─────────────────────────────────────────────────
function exportMemories() {
  chrome.runtime.sendMessage({ type: 'EXPORT_MEMORIES' }, (res) => {
    if (!res || !res.success) return;
    const blob = new Blob([res.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai-memories-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('📤 导出成功');
  });
}

function importMemories(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    chrome.runtime.sendMessage({ type: 'IMPORT_MEMORIES', data: ev.target.result }, (res) => {
      if (res && res.success) {
        showToast('📥 成功导入 ' + res.count + ' 条新记忆');
        loadMemories();
        loadGroups();
      } else {
        showToast('❌ 导入失败：格式错误');
      }
    });
  };
  reader.readAsText(file);
  e.target.value = '';
}

function saveSettings() {
  const settings = {
    showFloatButton: document.getElementById('setting-float-btn').checked,
    autoCapture: document.getElementById('setting-auto-capture').checked,
    defaultTag: document.getElementById('setting-default-tag').value
  };
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
    const existing = (res && res.success) ? res.settings : {};
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: { ...existing, ...settings } }, () => {
      showToast('⚙️ 设置已保存');
    });
  });
}

function saveAISettings() {
  const aiApiKey = document.getElementById('setting-ai-api-key').value.trim();
  const aiApiEndpoint = document.getElementById('setting-ai-api-endpoint').value.trim();
  const aiApiModel = document.getElementById('setting-ai-api-model').value.trim();
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
    const existing = (res && res.success) ? res.settings : {};
    const settings = {
      ...existing,
      aiApiKey: aiApiKey,
      aiApiEndpoint: aiApiEndpoint || 'https://api.openai.com/v1/chat/completions',
      aiApiModel: aiApiModel || 'gpt-3.5-turbo'
    };
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: settings }, () => {
      showToast('🤖 AI 设置已保存');
    });
  });
}


function openPanelInPage() {
  if (!currentTab) return;
  chrome.tabs.sendMessage(currentTab.id, { type: 'OPEN_PANEL' })
    .catch(() => showToast('⚠️ 当前页面不支持'));
  window.close();
}

// ── 工具 ─────────────────────────────────────────────────────
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
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

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── 事件绑定 ─────────────────────────────────────────────────
function bindEvents() {
  // Tab 切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'quick') renderQuickList();
      if (tab.dataset.tab === 'groups') renderGroups();
    });
  });

  // 搜索/筛选
  document.getElementById('search-input').addEventListener('input', renderMemories);
  document.getElementById('tag-filter').addEventListener('change', renderMemories);

  // 按钮
  document.getElementById('btn-new').addEventListener('click', openNewModal);
  document.getElementById('btn-export').addEventListener('click', exportMemories);
  document.getElementById('btn-import').addEventListener('click', () =>
    document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', importMemories);
  document.getElementById('btn-open-panel').addEventListener('click', openPanelInPage);
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="settings"]').classList.add('active');
    document.getElementById('tab-settings').classList.add('active');
  });

  // 项目组按钮
  document.getElementById('btn-merge-groups').addEventListener('click', openMergeModal);
  document.getElementById('btn-refresh-groups').addEventListener('click', () => {
    loadGroups();
    showToast('🔄 已刷新');
  });

  // 合并模态框
  document.getElementById('merge-modal-close').addEventListener('click', closeMergeModal);
  document.getElementById('merge-modal-cancel').addEventListener('click', closeMergeModal);
  document.getElementById('merge-modal-confirm').addEventListener('click', confirmMerge);
  document.getElementById('merge-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMergeModal();
  });

  // 模态框
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', saveModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modal-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-content').focus();
  });

  // 批量删除按钮
  document.getElementById('btn-batch').addEventListener('click', toggleBatchMode);
  document.getElementById('btn-select-all').addEventListener('click', () => {
    const list = document.getElementById('memory-list');
    list.querySelectorAll('.batch-cb').forEach(cb => {
      cb.checked = true;
      selectedIds.add(cb.dataset.id);
      cb.closest('.memory-card').classList.add('batch-selected');
    });
    updateBatchBar();
  });
  document.getElementById('btn-deselect-all').addEventListener('click', () => {
    const list = document.getElementById('memory-list');
    list.querySelectorAll('.batch-cb').forEach(cb => {
      cb.checked = false;
      selectedIds.delete(cb.dataset.id);
      cb.closest('.memory-card').classList.remove('batch-selected');
    });
    updateBatchBar();
  });
  document.getElementById('btn-delete-selected').addEventListener('click', deleteSelected);

  // 设置
  document.getElementById('setting-float-btn').addEventListener('change', saveSettings);
  document.getElementById('setting-auto-capture').addEventListener('change', saveSettings);
  document.getElementById('setting-default-tag').addEventListener('change', saveSettings);
  document.getElementById('btn-save-ai-settings').addEventListener('click', saveAISettings);
  document.getElementById('btn-clear-all').addEventListener('click', () => {

    if (!confirm('确定清空所有记忆？此操作不可撤销！')) return;
    chrome.storage.local.set({ memories: [], groups: [] }, () => {
      allMemories = [];
      allGroups = [];
      renderMemories();
      renderQuickList();
      renderGroups();
      updateCount();
      updateGroupCount();
      showToast('🗑 已清空');
    });
  });
}

// ── 导出项目组为笔记网页（HTML 生成由 notes_html.js 提供）──
function exportGroupAsNotes(groupId) {
  const group = allGroups.find(g => g.id === groupId);
  if (!group) { showToast('⚠️ 项目组不存在'); return; }
  chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }, (res) => {
    const all = (res && res.success) ? res.memories : allMemories;
    const mems = all.filter(m => group.memoryIds && group.memoryIds.includes(m.id));
    if (mems.length === 0) { showToast('⚠️ 项目组无内容'); return; }
    const html = generateNotesHTML(group, mems);
    downloadHTML(html, group.name.replace(/[\\/:*?"<>|]/g, '_') + '_笔记.html');
    showToast('📄 笔记已导出（可编辑 · 自动保存）');
  });
}

// ── AI 辅助生成笔记 ──
function exportGroupAsAIGeneratedNotes(groupId) {
  const group = allGroups.find(g => g.id === groupId);
  if (!group) { showToast('⚠️ 项目组不存在'); return; }

  // 先显示加载中
  const loadingHtml = generateNotesHTML(group, [], { aiLoading: true });
  downloadHTML(loadingHtml, group.name.replace(/[\\/:*?"<>|]/g, '_') + '_笔记_AI生成中.html');
  showToast('⏳ AI 正在整理笔记，请稍候...');

  chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }, (res) => {
    const all = (res && res.success) ? res.memories : allMemories;
    const mems = all.filter(m => group.memoryIds && group.memoryIds.includes(m.id));
    if (mems.length === 0) { showToast('⚠️ 项目组无内容'); return; }

    // 配对
    const sorted = mems.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const pairs = [];
    let i = 0;
    while (i < sorted.length) {
      const m = sorted[i];
      if (m.role === 'user') {
        const nx = sorted[i + 1];
        if (nx && nx.role === 'ai') {
          pairs.push({ q: m.content, a: nx.content, qAttachments: m.attachments || [], aAttachments: nx.attachments || [] });
          i += 2;
        }
        else { pairs.push({ q: m.content, a: '', qAttachments: m.attachments || [], aAttachments: [] }); i++; }
      } else { pairs.push({ q: '', a: m.content, qAttachments: [], aAttachments: m.attachments || [] }); i++; }
    }

    chrome.runtime.sendMessage({
      type: 'AI_GENERATE_NOTES',
      data: { pairs, groupName: group.name, sourcePlatform: group.sourcePlatform }
    }, (res2) => {
      if (res2 && res2.success) {
        const html = generateNotesHTML(group, mems, { aiGenerated: true, aiHtml: res2.html });
        downloadHTML(html, group.name.replace(/[\\/:*?"<>|]/g, '_') + '_笔记_AI整理.html');
        showToast('🤖 AI 笔记已生成！');
      } else {
        // AI 失败，回退到普通模式
        showToast('⚠️ AI 生成失败: ' + (res2 ? res2.error : '未知错误') + '，已使用普通模式');
        const html = generateNotesHTML(group, mems);
        downloadHTML(html, group.name.replace(/[\\/:*?"<>|]/g, '_') + '_笔记.html');
      }
    });
  });
}

function downloadHTML(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


// ── 批量删除 ─────────────────────────────────────────────────
// 简化：checkbox始终可见，不需要进入"批量模式"
// 点击记忆卡片上的checkbox即可选中，batch-bar始终显示删除按钮
function toggleBatchMode() {
  batchMode = !batchMode;
  selectedIds.clear();
  const list = document.getElementById('memory-list');
  const batchBtn = document.getElementById('btn-batch');

  if (batchMode) {
    batchBtn.textContent = '☑ 取消选择';
    batchBtn.style.background = 'rgba(102,126,234,0.2)';
    batchBtn.style.color = '#818cf8';
    list.querySelectorAll('.batch-cb').forEach(cb => cb.style.display = 'inline-block');
  } else {
    batchBtn.textContent = '☑ 批量';
    batchBtn.style.background = '';
    batchBtn.style.color = '';
    list.querySelectorAll('.batch-cb').forEach(cb => {
      cb.style.display = 'none';
      cb.checked = false;
    });
    list.querySelectorAll('.memory-card').forEach(card => card.classList.remove('batch-selected'));
  }
  updateBatchBar();
}

function updateBatchBar() {
  const countEl = document.getElementById('batch-count');
  if (!countEl) return;
  const count = selectedIds.size;
  countEl.textContent = count + ' 条已选';
  const delBtn = document.getElementById('btn-delete-selected');
  if (delBtn) delBtn.disabled = count === 0;
}

function deleteSelected() {
  const ids = Array.from(selectedIds);
  if (ids.length === 0) { showToast('⚠️ 请先选择要删除的记忆'); return; }
  if (!confirm('确定删除选中的 ' + ids.length + ' 条记忆？')) return;

  chrome.runtime.sendMessage({ type: 'DELETE_MEMORIES_BATCH', ids: ids }, () => {
    allMemories = allMemories.filter(m => !selectedIds.has(m.id));
    selectedIds.clear();
    batchMode = false;
    const batchBtn = document.getElementById('btn-batch');
    if (batchBtn) {
      batchBtn.textContent = '☑ 批量';
      batchBtn.style.background = '';
      batchBtn.style.color = '';
    }
    renderMemories();
    renderQuickList();
    updateCount();
    updateBatchBar();
    showToast('🗑 已删除 ' + ids.length + ' 条记忆');
  });
}

// ── 以下为已废弃的旧代码（保留空函数避免引用错误）────────────
function _gc() {
  // 此函数已废弃，保留空壳避免引用错误
}
