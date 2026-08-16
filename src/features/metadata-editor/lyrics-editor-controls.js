export function bindLyricsEditorControls({
  openFile,
  readTextFile,
  parseLyrics,
  renderTimeline,
  serializeWorkspace,
  showToast,
  getLyrics,
  setLyrics,
  getLyricsType,
  getEditorMode,
  setEditorMode,
}) {
  document.getElementById('btn-lyrics-import')?.addEventListener('click', async () => {
    try {
      const selected = await openFile({
        multiple: false,
        filters: [{
          name: 'Lyrics Files',
          extensions: ['lrc', 'elrc', 'ttml', 'json', 'txt'],
        }],
      });
      if (!selected) return;

      const content = await readTextFile(selected);
      if (!content || !content.trim()) {
        showToast('歌词文件为空');
        return;
      }

      const list = parseLyrics(content);
      if (!list || list.length === 0) {
        showToast('歌词解析失败，请检查文件格式');
        return;
      }

      setLyrics(list);
      const textarea = document.getElementById('edit-metadata-lyrics');
      if (textarea) {
        textarea.value = content;
        textarea.dataset.workspaceSnapshot = serializeWorkspace();
      }
      renderTimeline(list);
      showToast('歌词文件已导入');
    } catch (error) {
      console.error('[MetadataEditor] Failed to import external lyrics:', error);
      showToast('导入歌词文件失败');
    }
  });

  document.getElementById('btn-lyrics-raw-toggle')?.addEventListener('click', () => {
    const rawContainer = document.getElementById('lyrics-editor-raw-container');
    const viewport = document.getElementById('lyrics-editor-viewport');
    const textarea = document.getElementById('edit-metadata-lyrics');
    const toggleBtn = document.getElementById('btn-lyrics-raw-toggle');
    const addLineBtn = document.getElementById('btn-lyrics-add-line');

    if (getEditorMode() === 'timeline') {
      if (textarea) {
        const workspaceSnapshot = serializeWorkspace();
        // Preserve the exact source until the structured workspace changes.
        if (
          textarea.dataset.workspaceSnapshot
          && textarea.dataset.workspaceSnapshot !== workspaceSnapshot
        ) {
          textarea.value = workspaceSnapshot;
        }
        textarea.dataset.workspaceSnapshot = workspaceSnapshot;
      }
      if (viewport) viewport.style.display = 'none';
      if (rawContainer) rawContainer.style.display = 'flex';
      if (toggleBtn) toggleBtn.textContent = '返回结构视图';
      if (addLineBtn) addLineBtn.style.display = 'none';
      setEditorMode('raw');
      return;
    }

    const list = parseLyrics(textarea?.value || '');
    setLyrics(list);
    renderTimeline(list);
    if (textarea) textarea.dataset.workspaceSnapshot = serializeWorkspace();
    if (rawContainer) rawContainer.style.display = 'none';
    if (viewport) viewport.style.display = 'block';
    if (toggleBtn) toggleBtn.textContent = '查看原始文本';
    if (addLineBtn) {
      addLineBtn.style.display = getLyricsType() === 'lrc' ? 'inline-block' : 'none';
    }
    setEditorMode('timeline');
  });

  document.getElementById('btn-lyrics-add-line')?.addEventListener('click', () => {
    const lyrics = getLyrics();
    if (getLyricsType() !== 'lrc' || !lyrics) return;

    const lastTime = lyrics.length > 0 ? lyrics[lyrics.length - 1].time + 5 : 0;
    lyrics.push({ time: lastTime, text: '新歌词行', translation: null });
    renderTimeline(lyrics);
  });
}
