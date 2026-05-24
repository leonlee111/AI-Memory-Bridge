
// ── 导出项目组为笔记网页 ──────────────────────────────────────
function exportGroupAsNotes(groupId) {
  const group = allGroups.find(g => g.id === groupId);
  if (!group) return;
  const mems = allMemories.filter(m => group.memoryIds && group.memoryIds.includes(m.id));
  if (mems.length === 0) { showToast('⚠️ 项目组无内容'); return; }

  mems.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  // ── 1. 配对用户指令和AI回复 ──
  const pairs = [];
  let i = 0;
  while (i < mems.length) {
    const m = mems[i];
    if (m.role === 'user') {
      const next = mems[i + 1];
      if (next && next.role === 'ai') {
        pairs.push({ question: m.content, answer: next.content });
        i += 2;
      } else {
        pairs.push({ question: m.content, answer: '' });
        i++;
      }
    } else {
      // 独立AI回复
      pairs.push({ question: '', answer: m.content });
      i++;
    }
  }

  // ── 2. 去重：关键词重叠40%以上保留最新 ──
  const STOPWORDS = new Set(['的','了','是','在','和','有','我','你','他','它',
    '这','那','个','也','都','不','要','就','会','到','对','说','可以','一个',
    'with','the','a','an','is','to','for','of','in','on','at']);
  function getKW(text) {
    return [...new Set(
      text.replace(/[\s，。！？；：""''【】（）(),.!?;:\n]/g, ' ')
        .split(' ').filter(w => w.length > 1 && !STOPWORDS.has(w))
    )].slice(0, 14);
  }
  function kwOverlap(kw1, kw2) {
    const s = new Set(kw1);
    return kw2.filter(k => s.has(k)).length / Math.max(kw1.length, kw2.length, 1);
  }
  const kws = pairs.map(p => getKW(p.question + ' ' + p.answer));
  const keep = new Array(pairs.length).fill(true);
  for (let a = 0; a < pairs.length; a++) {
    if (!keep[a]) continue;
    for (let b = a + 1; b < pairs.length; b++) {
      if (!keep[b]) continue;
      if (kwOverlap(kws[a], kws[b]) >= 0.4) {
        keep[a] = false; // 丢旧保新
        break;
      }
    }
  }
  const finalPairs = pairs.filter((_, idx) => keep[idx]);

  // ── 3. 清理AI回复（去表情、去夸张词） ──
  const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FFFF}]/gu;
  const FILLER_RE = /^(当然[！,，！\s]?|好的[！,，\s]?|没问题[！,，\s]?|非常好的问题[！\s]?|很高兴(能)?帮(助)?你[！\s]?|当然可以[！,，\s]?|以下是[：:：\s]?|下面是[：:：\s]?|这是[：:：\s]?)/gm;
  function cleanAI(text) {
    return text
      .replace(EMOJI_RE, '')
      .replace(FILLER_RE, '')
      .replace(/[！]{2,}/g, '。')
      .replace(/[!]{2,}/g, '.')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── 4. 生成标题 ──
  function makeTitle(pair, idx) {
    const q = pair.question.replace(/\n/g, ' ').trim();
    if (q.length > 2) return q.slice(0, 50) + (q.length > 50 ? '…' : '');
    const a = pair.answer.replace(/\n/g, ' ').trim();
    return a.slice(0, 40) + (a.length > 40 ? '…' : '') || ('条目 ' + (idx + 1));
  }

  // ── 5. HTML 工具 ──
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function nl2p(text) {
    return text.split(/\n\n+/).filter(p => p.trim()).map(p =>
      '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>'
    ).join('');
  }

  // ── 6. 生成 HTML（Microsoft Learn 风格） ──
  const date = new Date().toLocaleDateString('zh-CN');
  const tocItems = finalPairs.map((p, i) =>
    `<li><a href="#s${i}" title="${esc(makeTitle(p,i))}">${esc(makeTitle(p,i).slice(0,40))}${makeTitle(p,i).length>40?'…':''}</a></li>`
  ).join('\n');

  const sections = finalPairs.map((p, i) => {
    const title = makeTitle(p, i);
    const qBlock = p.question ? `
      <div class="q-block">
        <span class="q-label">提问</span>
        <div class="q-text">${nl2p(p.question)}</div>
      </div>` : '';
    const aBlock = p.answer ? `
      <div class="a-block">
        <span class="a-label">回答</span>
        <div class="a-text">${nl2p(cleanAI(p.answer))}</div>
      </div>` : '';
    return `<section id="s${i}" class="card">\n<h2>${esc(title)}</h2>\n${qBlock}${aBlock}\n</section>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(group.name)} — AI笔记</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;background:#f5f5f5;color:#1b1b1b;min-height:100vh;display:flex;flex-direction:column}
.header{background:linear-gradient(90deg,#0078d4 0%,#005ea2 100%);color:#fff;height:50px;display:flex;align-items:center;gap:12px;padding:0 32px;position:sticky;top:0;z-index:99;box-shadow:0 2px 6px rgba(0,0,0,.25)}
.header-logo{font-weight:700;font-size:15px;white-space:nowrap}
.header-sep{opacity:.4}
.breadcrumb{font-size:12px;opacity:.85}
.breadcrumb a{color:#fff;text-decoration:none}
.layout{display:flex;flex:1;max-width:1200px;margin:0 auto;width:100%;padding:28px 16px;gap:24px;align-items:flex-start}
aside{width:256px;flex-shrink:0}
.toc{background:#fff;border:1px solid #ddd;border-radius:3px;overflow:hidden;position:sticky;top:66px}
.toc-hd{background:#f3f3f3;padding:10px 16px;font-size:12px;font-weight:700;color:#444;border-bottom:1px solid #ddd;text-transform:uppercase;letter-spacing:.5px}
.toc ol{list-style:none;padding:6px 0;max-height:calc(100vh - 130px);overflow-y:auto}
.toc ol::-webkit-scrollbar{width:4px}
.toc ol::-webkit-scrollbar-thumb{background:#ccc;border-radius:2px}
.toc li a{display:block;padding:6px 16px;font-size:13px;color:#0078d4;text-decoration:none;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-left:3px solid transparent;transition:all .12s}
.toc li a:hover,.toc li a.active{background:#f0f6fc;border-left-color:#0078d4;font-weight:600}
main{flex:1;min-width:0}
.page-title{font-size:26px;font-weight:700;color:#1b1b1b;margin-bottom:6px}
.page-meta{font-size:13px;color:#666;padding-bottom:18px;margin-bottom:24px;border-bottom:3px solid #0078d4}
.card{background:#fff;border:1px solid #e0e0e0;border-radius:3px;margin-bottom:18px;overflow:hidden;transition:box-shadow .15s}
.card:hover{box-shadow:0 2px 12px rgba(0,120,212,.12)}
.card h2{font-size:17px;font-weight:600;color:#1b1b1b;padding:14px 20px 12px;border-bottom:1px solid #f0f0f0;background:#fafafa;line-height:1.4}
.q-block{padding:14px 20px;background:#f6f8ff;border-bottom:1px solid #e8ecf8}
.a-block{padding:14px 20px}
.q-label{display:inline-block;background:#0078d4;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:2px;margin-bottom:8px;letter-spacing:.3px}
.a-label{display:inline-block;background:#107c10;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:2px;margin-bottom:8px;letter-spacing:.3px}
.q-text,.a-text{font-size:14px;line-height:1.75;color:#1b1b1b}
.q-text p,.a-text p{margin-bottom:10px}
.q-text p:last-child,.a-text p:last-child{margin-bottom:0}
footer{text-align:center;padding:14px;font-size:12px;color:#999;border-top:1px solid #e0e0e0;background:#fff;margin-top:auto}
@media(max-width:720px){.layout{flex-direction:column}aside{width:100%}.toc{position:static}.toc ol{max-height:180px}}
</style>
</head>
<body>
<header class="header">
  <span class="header-logo">📓 AI笔记</span>
  <span class="header-sep">|</span>
  <span class="breadcrumb"><a href="#">主页</a> › ${esc(group.name)}</span>
</header>
<div class="layout">
  <aside>
    <nav class="toc">
      <div class="toc-hd">目录 (${finalPairs.length})</div>
      <ol>${tocItems}</ol>
    </nav>
  </aside>
  <main>
    <h1 class="page-title">${esc(group.name)}</h1>
    <div class="page-meta">平台：${esc(group.sourcePlatform||'AI')} &nbsp;·&nbsp; 导出：${date} &nbsp;·&nbsp; ${finalPairs.length} 个问答</div>
    ${sections}
  </main>
</div>
<footer>由 AI Memory Bridge 导出 &nbsp;·&nbsp; ${date}</footer>
<script>
// 滚动高亮目录
const tocLinks = document.querySelectorAll('.toc a');
const cards = document.querySelectorAll('.card');
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      tocLinks.forEach(a => a.classList.remove('active'));
      const a = document.querySelector('.toc a[href="#' + e.target.id + '"]');
      if (a) { a.classList.add('active'); a.scrollIntoView({block:'nearest'}); }
    }
  });
}, { rootMargin: '-20% 0px -60% 0px' });
cards.forEach(c => observer.observe(c));
</script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = group.name.replace(/[\\/:*?"<>|]/g, '_') + '_笔记.html';
  a.click(); URL.revokeObjectURL(url);
  showToast('📄 笔记已导出：' + finalPairs.length + ' 个问答');
}
