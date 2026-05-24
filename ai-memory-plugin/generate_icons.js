// 用 Node.js 运行此脚本生成插件图标（可选）
// 或者直接跳过，Chrome加载时不检查图标是否存在

// 以下是 Base64 编码的 16x16 简易图标（紫色脑图标）
// 你也可以去 https://favicon.io 生成一套 PNG 图标放到 icons/ 目录

const fs = require('fs');
const path = require('path');

// 创建一个简单的 SVG 图标并说明如何转换
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#2d1b69"/>
      <stop offset="100%" style="stop-color:#0a0a14"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#818cf8;stop-opacity:0.6"/>
      <stop offset="100%" style="stop-color:#667eea;stop-opacity:0"/>
    </radialGradient>
  </defs>
  <rect width="128" height="128" rx="24" fill="url(#bg)"/>
  <circle cx="64" cy="64" r="40" fill="url(#glow)"/>
  <text x="64" y="82" text-anchor="middle" font-size="56" font-family="Arial">🧠</text>
</svg>`;

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);
fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgIcon);
console.log('✅ SVG图标已生成: icons/icon.svg');
console.log('📌 请用以下方法转为PNG:');
console.log('   1. 在线工具: https://svgtopng.com');
console.log('   2. 将 icon.svg 另存为 icon16.png, icon48.png, icon128.png');
console.log('   或直接略过图标（Chrome可以加载无图标的插件）');
