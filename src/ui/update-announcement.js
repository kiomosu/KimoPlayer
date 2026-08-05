import { APP_VERSION } from './update-checker.js';

// 版本号唯一来源：package.json → Vite __APP_VERSION__ → update-checker.js APP_VERSION
const UPDATE_SEEN_KEY = `kimo-update-seen-${APP_VERSION}-final`;

export function showStartupUpdateAnnouncement() {
  if (localStorage.getItem(UPDATE_SEEN_KEY) === 'true') return;

  const sections = [
    {
      title: '✨ 优化与修复',
      items: [
        ['修复设置页预览框：补全缺失的预设特效阴影，并在选中渐变主题时可以正确显示高光填充。'],
        ['设置页逻辑解耦：完全拆分原有的主题预设和文字对齐控制。在应用自定义颜色或开启双行模式时，将正确隐藏可能引起冲突的对应设置行。'],
        ['设置页交互动效：重写了所有因状态变化而动态显示/隐藏的设置行，新增抽屉式弹性过渡动画，告别生硬闪烁。'],
      ],
    }
  ];

  const sectionsHTML = sections.map(section => {
    const itemsHTML = section.items.map(([text]) => `
      <div style="color:var(--text-secondary);font-size:13px;line-height:1.65;">${text}</div>
    `).join('');
    return `
      <div style="margin-bottom:14px;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${section.title}</div>
        ${itemsHTML}
      </div>
    `;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'kimo-modal-overlay';
  overlay.innerHTML = `
    <div class="kimo-modal-card" style="max-width:460px;width:92%;padding:0;text-align:left;overflow:hidden;">
      <div style="padding:22px 24px 18px;border-bottom:1px solid rgba(255,255,255,0.08);background:linear-gradient(135deg,rgba(var(--dynamic-color,0,180,230),0.12),transparent 62%);">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:rgb(var(--dynamic-color,0,180,230));margin-bottom:8px;">版本更新</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:9px;">
          <div style="font-size:25px;line-height:1.1;font-weight:800;letter-spacing:-0.035em;color:var(--text-primary);">KimoPlayer</div>
          <div style="font-size:17px;line-height:1;font-weight:800;padding:6px 10px;border-radius:99px;background:rgb(var(--dynamic-color,0,180,230));color:#fff;box-shadow:0 6px 18px rgba(var(--dynamic-color,0,180,230),0.22);">v${APP_VERSION}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);">
          <span>2026.08.05</span>
          <span style="width:3px;height:3px;border-radius:50%;background:currentColor;opacity:0.45;"></span>
          <span style="padding:2px 7px;border-radius:999px;background:rgba(var(--dynamic-color,0,180,230),0.1);color:rgb(var(--dynamic-color,0,180,230));font-weight:600;">正式版</span>
          <span>体验打磨</span>
        </div>
      </div>
      <div style="padding:18px 24px 4px;max-height:min(58vh,470px);overflow-y:auto;">${sectionsHTML}</div>
      <div style="padding:14px 24px 20px;">
        <button id="kimo-update-ok-btn" style="width:100%;padding:10px;font-size:14px;font-weight:600;border:none;border-radius:8px;background:rgb(var(--dynamic-color,16,185,129));color:#fff;cursor:pointer;">开始使用</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', event => {
    if (event.target !== overlay && !event.target.closest('#kimo-update-ok-btn')) return;

    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 200);
    localStorage.setItem(UPDATE_SEEN_KEY, 'true');
  });
}
