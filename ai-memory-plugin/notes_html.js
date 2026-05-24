// notes_html.js — AI Memory Bridge 笔记生成模块
// 此文件被 popup.html 和 content.js（通过 exportGroupNotes）使用

// ── 全局 HTML 转义工具 ──
function esc(s) {
  return String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

/**
 * 将 group 和 mems 转换为可编辑的 wiki 风格笔记 HTML 字符串
 * @param {object} group - 项目组对象 {name, sourcePlatform}
 * @param {Array}  mems  - 记忆条目数组 [{role, content, title, createdAt}]
 * @param {object} options - 可选参数 { aiGenerated, aiHtml, aiLoading }
 * @returns {string}     - 完整 HTML 文档字符串
 */
function generateNotesHTML(group, mems, options) {

  options = options || {};
  var aiGenerated = options.aiGenerated || false;
  var aiHtml = options.aiHtml || '';
  var aiLoading = options.aiLoading || false;

  // 如果 AI 正在生成，返回加载中的 HTML
  if (aiLoading) {
    return buildLoadingHTML(group);
  }

  // 如果 AI 已生成内容，直接使用 AI 内容构建可编辑笔记
  if (aiGenerated && aiHtml) {
    return buildEditableHTML(group, aiHtml, true);
  }

  // ── 原始模式：从问答对生成 ──
  var sorted = mems.slice().sort(function(a, b) {
    return (a.createdAt || 0) - (b.createdAt || 0);
  });

  // ── 2. 配对（user+ai → {q,a}）──
  var hasRole = sorted.some(function(m) { return m.role === 'user' || m.role === 'ai'; });
  var pairs = [];
  if (hasRole) {
    var i = 0;
    while (i < sorted.length) {
      var m = sorted[i];
      if (m.role === 'user') {
        var nx = sorted[i + 1];
        if (nx && nx.role === 'ai') { pairs.push({ q: m.content, a: nx.content }); i += 2; }
        else { pairs.push({ q: m.content, a: '' }); i++; }
      } else { pairs.push({ q: '', a: m.content }); i++; }
    }
  } else {
    for (var j = 0; j < sorted.length; j += 2) {
      pairs.push({ q: sorted[j] ? sorted[j].content : '', a: sorted[j+1] ? sorted[j+1].content : '' });
    }
  }

  // ── 3. 去重（关键词重叠>=40%保留最新）──
  var SW = new Set(['的','了','是','在','和','有','我','你','他','它','这','那','个','也','都','不','要','就','会','到','对','说','可以','一个','the','a','an','is','to','for','of','in','on','at']);
  function getKW(t) {
    return Array.from(new Set(
      t.replace(/[\s，。！？；：\u201c\u201d\u2018\u2019【】（）(),.!?;:\n]/g, ' ')
       .split(' ').filter(function(w) { return w.length > 1 && !SW.has(w); })
    )).slice(0, 14);
  }
  function overlap(a, b) {
    var s = new Set(a);
    return b.filter(function(k) { return s.has(k); }).length / Math.max(a.length, b.length, 1);
  }
  var kws = pairs.map(function(p) { return getKW(p.q + ' ' + p.a); });
  var keep = pairs.map(function() { return true; });
  for (var a = 0; a < pairs.length; a++) {
    if (!keep[a]) continue;
    for (var b = a + 1; b < pairs.length; b++) {
      if (!keep[b]) continue;
      if (overlap(kws[a], kws[b]) >= 0.4) { keep[a] = false; break; }
    }
  }
  var fp = pairs.filter(function(_, idx) { return keep[idx]; });
  if (fp.length === 0) fp = pairs; // 防止全部被去重

  // ── 4. 清理AI文本 ──
  function cleanText(t) {
    return t
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/^(当然[！,，\s]?|好的[！,，\s]?|没问题[！,，\s]?|非常好的问题[！\s]?|很高兴(能)?帮(助)?你[！\s]?|当然可以[！,，\s]?|以下是[：:\s]?|下面是[：:\s]?|这是[：:\s]?)/gm, '')
      .replace(/[！]{2,}/g, '。')
      .replace(/[!]{2,}/g, '.')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── 5. 标题提取 ──
  function makeTitle(p, idx) {
    var q = p.q.replace(/\n/g, ' ').trim();
    if (q.length > 2) return q.slice(0, 60) + (q.length > 60 ? '\u2026' : '');
    var aa = p.a.replace(/\n/g, ' ').trim();
    return aa.slice(0, 40) + (aa.length > 40 ? '\u2026' : '') || ('\u4e3b\u9898' + (idx + 1));
  }

  // ── 6. HTML工具 ──
  function textToHTML(t) {

    return t.split(/\n\n+/).filter(function(p) { return p.trim(); }).map(function(p) {
      var trimmed = p.trim();
      // 代码块
      if (trimmed.startsWith('```') || /^\s{4}/.test(p)) {
        var code = trimmed.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
        return '<pre><code>' + esc(code) + '</code></pre>';
      }
      // 列表
      if (/^[-*\u2022] /.test(trimmed)) {
        var items = trimmed.split('\n').filter(function(l) { return l.trim(); })
          .map(function(l) { return '<li>' + esc(l.replace(/^[-*\u2022]\s+/, '')) + '</li>'; }).join('');
        return '<ul>' + items + '</ul>';
      }
      if (/^\d+[.)]\s/.test(trimmed)) {
        var items2 = trimmed.split('\n').filter(function(l) { return l.trim(); })
          .map(function(l) { return '<li>' + esc(l.replace(/^\d+[.)]\s+/, '')) + '</li>'; }).join('');
        return '<ol>' + items2 + '</ol>';
      }
      return '<p>' + esc(trimmed).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  // ── 7. 构建初始内容 ──
  var date = new Date().toLocaleDateString('zh-CN');
  var sections = fp.map(function(p, idx) {
    var title = makeTitle(p, idx);
    var content = p.a ? textToHTML(cleanText(p.a)) : (p.q ? textToHTML(p.q) : '<p></p>');
    return '<h2 id="h' + idx + '">' + esc(title) + '</h2>\n' + content;
  }).join('\n\n');

  var initContent = [
    '<h1 id="h-title">' + esc(group.name) + '</h1>',
    '<p><em>\u6765\u6e90\uff1a' + esc(group.sourcePlatform || 'AI') +
    ' \u00b7 \u751f\u6210\u4e8e ' + date +
    ' \u00b7 \u5171 ' + fp.length + ' \u4e2a\u4e3b\u9898 \u00b7 \u5185\u5bb9\u53ef\u76f4\u63a5\u7f16\u8f91\uff0c\u81ea\u52a8\u4fdd\u5b58</em></p>',
    '<hr>',
    sections
  ].join('\n');

  return buildEditableHTML(group, initContent, false);
}

/**
 * 构建加载中的 HTML（AI 生成时显示）
 */
function buildLoadingHTML(group) {
  var date = new Date().toLocaleDateString('zh-CN');
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(group.name) + ' — AI笔记</title>'
    + '<style>body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#f8f8f8;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.loading{text-align:center}.spinner{width:40px;height:40px;border:4px solid #e0e0e0;border-top-color:#0078d4;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}@keyframes spin{to{transform:rotate(360deg)}}p{color:#555;font-size:14px}</style>'
    + '</head><body><div class="loading">'
    + '<div class="spinner"></div>'
    + '<p>AI 正在整理笔记...</p>'
    + '<p style="font-size:12px;color:#999">' + esc(group.name) + '</p>'
    + '</div></body></html>';
}

/**
 * 构建可编辑笔记的完整 HTML 框架
 * @param {object} group - 项目组对象
 * @param {string} bodyContent - 编辑器内的 HTML 内容
 * @param {boolean} isAIGenerated - 是否为 AI 生成
 * @returns {string} 完整 HTML
 */
function buildEditableHTML(group, bodyContent, isAIGenerated) {
  var date = new Date().toLocaleDateString('zh-CN');
  var gid = 'note_' + encodeURIComponent(group.name);
  var modeLabel = isAIGenerated ? 'AI 辅助整理' : '原始问答';

  var css = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#f8f8f8;color:#1b1b1b;display:flex;flex-direction:column;min-height:100vh;font-size:15px}',
    '.hdr{background:linear-gradient(90deg,#0078d4,#005ea2);color:#fff;padding:0 24px;height:48px;display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.2);flex-shrink:0}',
    '.hdr-logo{font-weight:700;font-size:15px;white-space:nowrap}',
    '.hdr-name{font-size:13px;opacity:.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px}',
    '.hdr-sep{opacity:.35}',
    '.hdr-right{margin-left:auto;display:flex;align-items:center;gap:8px}',
    '.hdr-status{font-size:12px;opacity:.8;min-width:80px;text-align:right}',
    '.toolbar{background:#fff;border-bottom:1px solid #e0e0e0;padding:6px 24px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;position:sticky;top:48px;z-index:99;box-shadow:0 1px 4px rgba(0,0,0,.06)}',
    '.tb-btn{border:1px solid #d0d0d0;background:#fff;border-radius:3px;padding:3px 9px;font-size:13px;cursor:pointer;color:#333;transition:.1s;line-height:1.4;font-family:inherit}',
    '.tb-btn:hover{background:#f0f6fc;border-color:#0078d4;color:#0078d4}',
    '.tb-sep{width:1px;height:20px;background:#e0e0e0;margin:0 4px;flex-shrink:0}',
    '.tb-hint{font-size:12px;color:#999;margin-left:8px}',
    '.layout{display:flex;flex:1;max-width:1280px;margin:0 auto;width:100%;padding:24px 16px;gap:24px;align-items:flex-start}',
    'aside{width:240px;flex-shrink:0}',
    '.toc-wrap{background:#fff;border:1px solid #ddd;border-radius:4px;overflow:hidden;position:sticky;top:112px}',
    '.toc-hd{background:#f3f3f3;padding:9px 14px;font-size:11px;font-weight:700;color:#555;border-bottom:1px solid #ddd;text-transform:uppercase;letter-spacing:.5px}',
    '#toc-list{list-style:none;padding:4px 0;max-height:calc(100vh - 180px);overflow-y:auto}',
    '#toc-list::-webkit-scrollbar{width:3px}',
    '#toc-list::-webkit-scrollbar-thumb{background:#ccc}',
    '.toc-h1>a{padding:7px 12px;font-size:13px;font-weight:700}',
    '.toc-h2>a{padding:6px 12px 6px 22px;font-size:13px}',
    '.toc-h3>a{padding:5px 12px 5px 34px;font-size:12px;color:#555}',
    '#toc-list li>a{display:block;color:#0078d4;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:3px solid transparent;transition:.1s}',
    '#toc-list li>a:hover,#toc-list li>a.on{background:#f0f6fc;border-left-color:#0078d4;color:#005ea2}',
    'main{flex:1;min-width:0}',
    '#editor{background:#fff;border:1px solid #e0e0e0;border-radius:4px;padding:36px 48px;min-height:60vh;outline:none;line-height:1.85;box-shadow:0 1px 4px rgba(0,0,0,.04)}',
    '#editor:focus{border-color:#0078d4;box-shadow:0 0 0 2px rgba(0,120,212,.1)}',
    '#editor h1{font-size:26px;font-weight:700;margin:0 0 16px;padding-bottom:12px;border-bottom:2px solid #0078d4}',
    '#editor h2{font-size:19px;font-weight:600;margin:32px 0 12px;padding-left:12px;border-left:4px solid #0078d4}',
    '#editor h3{font-size:16px;font-weight:600;margin:20px 0 8px;color:#2c5f8a}',
    '#editor p{margin:0 0 12px;color:#333}',
    '#editor ul,#editor ol{margin:0 0 12px;padding-left:24px}',
    '#editor li{margin-bottom:4px;line-height:1.7}',
    '#editor hr{border:none;border-top:1px solid #e8e8e8;margin:28px 0}',
    '#editor em{color:#666}',
    '#editor pre{background:#f6f8fa;border:1px solid #e0e0e0;border-radius:4px;padding:14px 16px;overflow-x:auto;margin:0 0 12px;font-family:Consolas,"Courier New",monospace;font-size:13px;line-height:1.6}',
    '#editor code{background:#f3f3f3;padding:1px 5px;border-radius:2px;font-family:Consolas,monospace;font-size:13px}',
    '#editor pre code{background:none;padding:0}',
    '#editor blockquote{border-left:4px solid #0078d4;background:#f6f8ff;padding:10px 16px;margin:0 0 12px;color:#444;border-radius:0 4px 4px 0}',
    'footer{text-align:center;padding:12px;font-size:12px;color:#aaa;border-top:1px solid #eee;background:#fff;flex-shrink:0}',
    '@media(max-width:800px){.layout{flex-direction:column}aside{width:100%}.toc-wrap{position:static}#toc-list{max-height:160px}#editor{padding:20px 16px}}',
    '@media print{.hdr,.toolbar,aside,footer{display:none!important}.layout{padding:0;max-width:100%}#editor{border:none;box-shadow:none;padding:0}}'
  ].join('');

  var inlineJS = [
    'var GID=' + JSON.stringify(gid) + ';',
    'var editor=document.getElementById("editor");',
    'var tocList=document.getElementById("toc-list");',
    'var statusEl=document.getElementById("save-status");',
    'var saveTimer=null;',
    '(function(){var s=localStorage.getItem(GID);if(s)editor.innerHTML=s;})();',
    'function fmt(cmd,val){document.execCommand(cmd,false,val||null);editor.focus();rebuildTOC();}',
    'function rebuildTOC(){',
    '  var hs=editor.querySelectorAll("h1,h2,h3");',
    '  hs.forEach(function(h,i){if(!h.id)h.id="hh"+i;});',
    '  tocList.innerHTML="";',
    '  hs.forEach(function(h){',
    '    var li=document.createElement("li");',
    '    li.className="toc-"+h.tagName.toLowerCase();',
    '    var a=document.createElement("a");',
    '    a.href="#"+h.id;',
    '    a.textContent=h.textContent.slice(0,45)+(h.textContent.length>45?"\u2026":"");',
    '    a.addEventListener("click",function(e){e.preventDefault();h.scrollIntoView({behavior:"smooth",block:"nearest"});});',
    '    li.appendChild(a);tocList.appendChild(li);',
    '  });',
    '  updateActiveTOC();',
    '}',
    'function updateActiveTOC(){',
    '  var hs=Array.from(editor.querySelectorAll("h1,h2,h3"));',
    '  var sy=window.scrollY+120;',
    '  var cur=null;',
    '  hs.forEach(function(h){if(h.offsetTop<=sy)cur=h;});',
    '  tocList.querySelectorAll("a").forEach(function(a){',
    '    a.classList.toggle("on",cur&&a.getAttribute("href")==="#"+cur.id);',
    '  });',
    '}',
    'window.addEventListener("scroll",updateActiveTOC,{passive:true});',
    'function saveNotes(){',
    '  localStorage.setItem(GID,editor.innerHTML);',
    '  var t=new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});',
    '  statusEl.textContent="\u5df2\u4fdd\u5b58 "+t;',
    '}',
    'editor.addEventListener("input",function(){',
    '  statusEl.textContent="\u7f16\u8f91\u4e2d...";',
    '  clearTimeout(saveTimer);',
    '  saveTimer=setTimeout(function(){saveNotes();rebuildTOC();},1500);',
    '});',
    'rebuildTOC();',
    'document.addEventListener("keydown",function(e){',
    '  if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault();saveNotes();}',
    '  if((e.ctrlKey||e.metaKey)&&e.key==="b"){e.preventDefault();fmt("bold");}',
    '  if((e.ctrlKey||e.metaKey)&&e.key==="i"){e.preventDefault();fmt("italic");}',
    '});'
  ].join('\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + esc(group.name) + ' \u2014 AI\u7b14\u8bb0</title>',
    '<style>' + css + '</style>',
    '</head>',
    '<body>',
    '<header class="hdr">',
    '  <span class="hdr-logo">\ud83d\udcd3 AI\u7b14\u8bb0</span>',
    '  <span class="hdr-sep">|</span>',
    '  <span class="hdr-name">' + esc(group.name) + '</span>',
    '  <div class="hdr-right">',
    '    <span id="save-status" class="hdr-status"></span>',
    '    <button class="tb-btn" onclick="saveNotes()" title="Ctrl+S">\ud83d\udcbe \u4fdd\u5b58</button>',
    '    <button class="tb-btn" onclick="window.print()">\ud83d\udda8\ufe0f \u6253\u5370</button>',
    '  </div>',
    '</header>',
    '<div class="toolbar">',
    '  <button class="tb-btn" onclick="fmt(\'bold\')" title="Ctrl+B"><b>B</b></button>',
    '  <button class="tb-btn" onclick="fmt(\'italic\')" title="Ctrl+I"><i>I</i></button>',
    '  <button class="tb-btn" onclick="fmt(\'underline\')"><u>U</u></button>',
    '  <span class="tb-sep"></span>',
    '  <button class="tb-btn" onclick="fmt(\'formatBlock\',\'h1\')">H1</button>',
    '  <button class="tb-btn" onclick="fmt(\'formatBlock\',\'h2\')">H2</button>',
    '  <button class="tb-btn" onclick="fmt(\'formatBlock\',\'h3\')">H3</button>',
    '  <button class="tb-btn" onclick="fmt(\'formatBlock\',\'p\')">\u6b63\u6587</button>',
    '  <button class="tb-btn" onclick="fmt(\'formatBlock\',\'blockquote\')">\u5f15\u7528</button>',
    '  <span class="tb-sep"></span>',
    '  <button class="tb-btn" onclick="fmt(\'insertUnorderedList\')">\u2022 \u5217\u8868</button>',
    '  <button class="tb-btn" onclick="fmt(\'insertOrderedList\')">1. \u5217\u8868</button>',
    '  <span class="tb-sep"></span>',
    '  <button class="tb-btn" onclick="fmt(\'undo\')">\u21a9 \u64a4\u9500</button>',
    '  <button class="tb-btn" onclick="fmt(\'redo\')">\u21aa \u91cd\u505a</button>',
    '  <span class="tb-hint">Ctrl+S \u4fdd\u5b58 \u00b7 \u70b9\u51fb\u4efb\u610f\u5904\u5f00\u59cb\u7f16\u8f91</span>',
    '</div>',
    '<div class="layout">',
    '  <aside>',
    '    <div class="toc-wrap">',
    '      <div class="toc-hd">\ud83d\udccb \u76ee\u5f55</div>',
    '      <ol id="toc-list"></ol>',
    '    </div>',
    '  </aside>',
    '  <main>',
    '    <div id="editor" contenteditable="true" spellcheck="false">' + bodyContent + '</div>',
    '  </main>',
    '</div>',
    '<footer>\u7531 AI Memory Bridge \u751f\u6210 &nbsp;\u00b7&nbsp; ' + date + ' &nbsp;\u00b7&nbsp; \u7f16\u8f91\u5185\u5bb9\u81ea\u52a8\u4fdd\u5b58\u5230\u672c\u5730\u6d4f\u89c8\u5668</footer>',
    '<script>' + inlineJS + '<\/script>',
    '</body>',
    '</html>'
  ].join('\n');
}
