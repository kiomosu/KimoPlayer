import { APP_VERSION } from './update-checker.js';

const UPDATE_SEEN_KEY = `kimo-update-seen-${APP_VERSION}-final`;

export function showStartupUpdateAnnouncement() {
  if (localStorage.getItem(UPDATE_SEEN_KEY) === 'true') return;

  const sections = [
    {
      title: '歌词体验',
      items: [
        ['新增歌词时间兼容模式，可在设置页或歌词页面快捷切换自动、逐字和逐行模式。'],
        ['优化歌词自动换行，普通单词会保持完整，不再被拆到两行。'],
        ['修复部分歌词播放时的卡拉 OK、高亮和 JavaScript 异常问题。'],
      ],
    },
    {
      title: '使用体验',
      items: [
        ['优化歌词逐字播放与抬起动画的衔接。'],
        ['优化常用操作快捷键设置，支持用户自行调整。'],
      ],
    },
  ];

  const sectionsHTML = sections.map(section => {
    const itemsHTML = section.items.map(([text]) => `
      <div style="color:var(--text-secondary);font-size:13px;line-height:1.65;">${text}</div>
    `).join('');
    return `
      <div style="margin-bottom:14px;">
        <div style="font-size:13px;font-weight:650;color:var(--text-primary);margin-bottom:4px;">${section.title}</div>
        ${itemsHTML}
      </div>
    `;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'kimo-modal-overlay';
  overlay.innerHTML = `
    <div class="kimo-modal-card" style="max-width:460px;width:92%;padding:0;text-align:left;overflow:hidden;">
      <div style="padding:22px 24px 18px;border-bottom:1px solid var(--glass-border);background:linear-gradient(135deg,rgba(var(--dynamic-color,0,180,230),0.12),transparent 62%);">
        <div style="font-size:11px;font-weight:700;letter-spacing:.12em;color:rgb(var(--dynamic-color,0,180,230));margin-bottom:8px;">版本更新</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:9px;">
          <div style="font-size:25px;line-height:1.1;font-weight:800;letter-spacing:-.035em;color:var(--text-primary);">KimoPlayer</div>
          <div style="font-size:17px;line-height:1;font-weight:800;padding:6px 10px;border-radius:99px;background:rgb(var(--dynamic-color,0,180,230));color:#fff;">v${APP_VERSION}</div>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);">2026.08.16 · 正式版</div>
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
