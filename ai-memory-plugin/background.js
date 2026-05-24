// AI Memory Bridge - Background Service Worker

// 平台识别配置
const PLATFORM_CONFIG = {
  'gemini.google.com': {
    name: 'Gemini',
    color: '#4285f4',
    icon: '✨'
  },
  'chat.deepseek.com': {
    name: 'DeepSeek',
    color: '#1a73e8',
    icon: '🔍'
  },
  'claude.ai': {
    name: 'Claude',
    color: '#d97706',
    icon: '🤖'
  },
  'chatgpt.com': {
    name: 'ChatGPT',
    color: '#10a37f',
    icon: '💬'
  },
  'chat.openai.com': {
    name: 'ChatGPT',
    color: '#10a37f',
    icon: '💬'
  },
  'kimi.moonshot.cn': {
    name: 'Kimi',
    color: '#7c3aed',
    icon: '🌙'
  },
  'tongyi.aliyun.com': {
    name: '通义千问',
    color: '#f59e0b',
    icon: '🔮'
  }
};

// 初始化存储
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['memories', 'groups', 'settings']);
  if (!existing.memories) {
    await chrome.storage.local.set({
      memories: [],
      groups: [],
      settings: {
        autoCapture: false,
        showFloatButton: true,
        defaultTag: '通用'
      }
    });
  }
  if (!existing.groups) {
    await chrome.storage.local.set({ groups: [] });
  }
  console.log('[AI Memory Bridge] 插件已初始化');
});

// 消息处理中心
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // 保持异步响应通道
});

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      // ===== 单条记忆操作 =====
      case 'SAVE_MEMORY': {
        const memories = await getMemories();
        const newMemory = {
          id: Date.now().toString(),
          title: message.data.title || '未命名记忆',
          content: message.data.content,
          tag: message.data.tag || '通用',
          sourcePlatform: message.data.sourcePlatform || '未知',
          sourceUrl: sender.url || '',
          createdAt: new Date().toISOString(),
          usageCount: 0,
          pinned: false,
          groupId: message.data.groupId || null
        };
        memories.unshift(newMemory);
        const trimmed = memories.slice(0, 500);
        await chrome.storage.local.set({ memories: trimmed });
        sendResponse({ success: true, memory: newMemory });
        break;
      }

      case 'SAVE_MULTI_MEMORIES': {
        const memories = await getMemories();
        const newMemories = message.data.items.map(item => ({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
          title: item.title || '未命名记忆',
          content: item.content,
          tag: item.tag || message.data.defaultTag || '通用',
          sourcePlatform: message.data.sourcePlatform || '未知',
          sourceUrl: sender.url || '',
          createdAt: new Date().toISOString(),
          usageCount: 0,
          pinned: false,
          groupId: message.data.groupId || null
        }));
        const all = [...newMemories, ...memories].slice(0, 500);
        await chrome.storage.local.set({ memories: all });
        sendResponse({ success: true, count: newMemories.length, memories: newMemories });
        break;
      }

      case 'GET_MEMORIES': {
        const memories = await getMemories();
        const filtered = message.tag && message.tag !== 'all'
          ? memories.filter(m => m.tag === message.tag)
          : memories;
        sendResponse({ success: true, memories: filtered });
        break;
      }

      case 'DELETE_MEMORY': {
        let memories = await getMemories();
        memories = memories.filter(m => m.id !== message.id);
        await chrome.storage.local.set({ memories });
        sendResponse({ success: true });
        break;
      }

      case 'DELETE_MEMORIES_BATCH': {
        let memories = await getMemories();
        const ids = new Set(message.ids || []);
        memories = memories.filter(m => !ids.has(m.id));
        await chrome.storage.local.set({ memories });
        sendResponse({ success: true });
        break;
      }

      case 'UPDATE_MEMORY': {
        let memories = await getMemories();
        const idx = memories.findIndex(m => m.id === message.data.id);
        if (idx !== -1) {
          memories[idx] = { ...memories[idx], ...message.data };
          await chrome.storage.local.set({ memories });
        }
        sendResponse({ success: true });
        break;
      }

      case 'PIN_MEMORY': {
        let memories = await getMemories();
        const idx = memories.findIndex(m => m.id === message.id);
        if (idx !== -1) {
          memories[idx].pinned = !memories[idx].pinned;
          memories.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
          await chrome.storage.local.set({ memories });
        }
        sendResponse({ success: true });
        break;
      }

      case 'USE_MEMORY': {
        let memories = await getMemories();
        const idx = memories.findIndex(m => m.id === message.id);
        if (idx !== -1) {
          memories[idx].usageCount = (memories[idx].usageCount || 0) + 1;
          memories[idx].lastUsedAt = new Date().toISOString();
          await chrome.storage.local.set({ memories });
        }
        sendResponse({ success: true });
        break;
      }

      // ===== 项目组操作 =====
      case 'SAVE_GROUP': {
        const groups = await getGroups();
        const newGroup = {
          id: Date.now().toString(),
          name: message.data.name || '未命名项目组',
          description: message.data.description || '',
          sourcePlatform: message.data.sourcePlatform || '未知',
          sourceUrl: sender.url || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          memoryIds: message.data.memoryIds || [],
          pinned: false
        };
        groups.unshift(newGroup);
        await chrome.storage.local.set({ groups });
        sendResponse({ success: true, group: newGroup });
        break;
      }

      case 'GET_GROUPS': {
        const groups = await getGroups();
        sendResponse({ success: true, groups });
        break;
      }

      case 'UPDATE_GROUP': {
        let groups = await getGroups();
        const idx = groups.findIndex(g => g.id === message.data.id);
        if (idx !== -1) {
          groups[idx] = { ...groups[idx], ...message.data, updatedAt: new Date().toISOString() };
          await chrome.storage.local.set({ groups });
        }
        sendResponse({ success: true });
        break;
      }

      case 'DELETE_GROUP': {
        let groups = await getGroups();
        groups = groups.filter(g => g.id !== message.id);
        await chrome.storage.local.set({ groups });
        // 同时解除该组下所有记忆的 groupId 关联
        let memories = await getMemories();
        memories = memories.map(m => m.groupId === message.id ? { ...m, groupId: null } : m);
        await chrome.storage.local.set({ memories });
        sendResponse({ success: true });
        break;
      }

      case 'MERGE_GROUPS': {
        // 合并多个项目组为一个
        let groups = await getGroups();
        const sourceGroups = groups.filter(g => message.ids.includes(g.id));
        if (sourceGroups.length === 0) {
          sendResponse({ success: false, error: '未找到要合并的项目组' });
          break;
        }
        // 收集所有记忆ID
        const allMemoryIds = [...new Set(sourceGroups.flatMap(g => g.memoryIds))];
        // 创建新组
        const newGroup = {
          id: Date.now().toString(),
          name: message.data.newName || (sourceGroups[0]?.name || '合并项目组'),
          description: sourceGroups.map(g => g.name).join(' + '),
          sourcePlatform: sourceGroups[0]?.sourcePlatform || '未知',
          sourceUrl: sourceGroups[0]?.sourceUrl || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          memoryIds: allMemoryIds,
          pinned: false
        };
        // 删除旧组
        groups = groups.filter(g => !message.ids.includes(g.id));
        groups.unshift(newGroup);
        await chrome.storage.local.set({ groups });
        // 更新记忆的 groupId
        let memories = await getMemories();
        memories = memories.map(m => message.ids.includes(m.groupId) ? { ...m, groupId: newGroup.id } : m);
        await chrome.storage.local.set({ memories });
        sendResponse({ success: true, group: newGroup });
        break;
      }

      case 'ADD_MEMORIES_TO_GROUP': {
        let groups = await getGroups();
        const idx = groups.findIndex(g => g.id === message.groupId);
        if (idx !== -1) {
          const existingIds = new Set(groups[idx].memoryIds);
          const newIds = (message.memoryIds || []).filter(id => !existingIds.has(id));
          groups[idx].memoryIds = [...groups[idx].memoryIds, ...newIds];
          groups[idx].updatedAt = new Date().toISOString();
          await chrome.storage.local.set({ groups });
          // 更新记忆的 groupId
          let memories = await getMemories();
          memories = memories.map(m => newIds.includes(m.id) ? { ...m, groupId: message.groupId } : m);
          await chrome.storage.local.set({ memories });
        }
        sendResponse({ success: true });
        break;
      }

      case 'REMOVE_MEMORIES_FROM_GROUP': {
        let groups = await getGroups();
        const idx = groups.findIndex(g => g.id === message.groupId);
        if (idx !== -1) {
          const removeIds = new Set(message.memoryIds || []);
          groups[idx].memoryIds = groups[idx].memoryIds.filter(id => !removeIds.has(id));
          groups[idx].updatedAt = new Date().toISOString();
          await chrome.storage.local.set({ groups });
          // 解除记忆关联
          let memories = await getMemories();
          memories = memories.map(m => removeIds.has(m.id) ? { ...m, groupId: null } : m);
          await chrome.storage.local.set({ memories });
        }
        sendResponse({ success: true });
        break;
      }

      // ===== 其他操作 =====
      case 'GET_PLATFORM_INFO': {
        const url = sender.url || '';
        let platform = { name: '未知平台', color: '#888', icon: '🤖' };
        for (const [domain, info] of Object.entries(PLATFORM_CONFIG)) {
          if (url.includes(domain)) {
            platform = info;
            break;
          }
        }
        sendResponse({ success: true, platform });
        break;
      }

      case 'EXPORT_MEMORIES': {
        const memories = await getMemories();
        const groups = await getGroups();
        sendResponse({ success: true, data: JSON.stringify({ memories, groups }, null, 2) });
        break;
      }

      case 'IMPORT_MEMORIES': {
        try {
          const imported = JSON.parse(message.data);
          const memories = imported.memories || imported;
          const groups = imported.groups || [];
          const existing = await getMemories();
          const existingIds = new Set(existing.map(m => m.id));
          const newOnes = (Array.isArray(memories) ? memories : []).filter(m => !existingIds.has(m.id));
          const merged = [...newOnes, ...existing].slice(0, 500);
          await chrome.storage.local.set({ memories: merged });
          // 导入项目组
          if (groups.length > 0) {
            const existingGroups = await getGroups();
            const existingGroupIds = new Set(existingGroups.map(g => g.id));
            const newGroups = groups.filter(g => !existingGroupIds.has(g.id));
            await chrome.storage.local.set({ groups: [...newGroups, ...existingGroups] });
          }
          sendResponse({ success: true, count: newOnes.length });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'GET_SETTINGS': {
        const data = await chrome.storage.local.get('settings');
        sendResponse({ success: true, settings: data.settings });
        break;
      }

      case 'SAVE_SETTINGS': {
        await chrome.storage.local.set({ settings: message.settings });
        sendResponse({ success: true });
        break;
      }

      // ===== AI 辅助生成笔记 =====
      case 'AI_GENERATE_NOTES': {
        try {
          const { pairs, groupName, sourcePlatform } = message.data;
          const settings = (await chrome.storage.local.get('settings')).settings || {};
          const apiKey = settings.aiApiKey || '';
          const apiEndpoint = settings.aiApiEndpoint || 'https://api.openai.com/v1/chat/completions';
          const apiModel = settings.aiApiModel || 'gpt-3.5-turbo';

          if (!apiKey) {
            sendResponse({ success: false, error: '请先在设置中配置 AI API Key' });
            break;
          }

          // 构建 prompt：将问答对转为连贯笔记
          const conversationText = pairs.map(function(p, i) {
            return '【问答' + (i+1) + '】\n提问：' + (p.q || '（无提问）') + '\n回答：' + (p.a || '（无回答）');
          }).join('\n\n');

          const prompt = '你是一个专业的笔记整理助手。请将以下AI对话记录整理成一篇结构清晰、语言流畅的笔记文章。\n\n'
            + '要求：\n'
            + '1. 保留所有重要信息和技术细节\n'
            + '2. 去除对话中的重复内容和口头禅（如"当然"、"好的"、"没问题"等）\n'
            + '3. 按主题重新组织内容，使用合适的标题层级（H1/H2/H3）\n'
            + '4. 代码块用 ``` 包裹\n'
            + '5. 列表用 - 或 1. 格式\n'
            + '6. 输出格式为 HTML（仅 body 内内容，不要 html/head/body 标签）\n\n'
            + '笔记标题：' + groupName + '\n'
            + '来源平台：' + (sourcePlatform || 'AI') + '\n\n'
            + '以下是需要整理的对话记录：\n\n' + conversationText;

          const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
              model: apiModel,
              messages: [
                { role: 'system', content: '你是一个专业的笔记整理助手，擅长将对话记录整理成结构清晰的笔记。' },
                { role: 'user', content: prompt }
              ],
              temperature: 0.7,
              max_tokens: 4096
            })
          });

          if (!response.ok) {
            var errText = await response.text();
            sendResponse({ success: false, error: 'API 请求失败: ' + response.status + ' ' + errText });
            break;
          }

          const result = await response.json();
          var generatedHTML = result.choices && result.choices[0] && result.choices[0].message
            ? result.choices[0].message.content
            : '';

          if (!generatedHTML) {
            sendResponse({ success: false, error: 'AI 返回内容为空' });
            break;
          }

          sendResponse({ success: true, html: generatedHTML });
        } catch (err) {
          console.error('[AI Memory Bridge] AI 生成笔记错误:', err);
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      default:
        sendResponse({ success: false, error: '未知消息类型' });
    }
  } catch (err) {
    console.error('[AI Memory Bridge] 错误:', err);
    sendResponse({ success: false, error: err.message });
  }
}

async function getMemories() {
  const data = await chrome.storage.local.get('memories');
  return data.memories || [];
}

async function getGroups() {
  const data = await chrome.storage.local.get('groups');
  return data.groups || [];
}
