export const createSearchController = ({
  player,
  workerSource,
  loadLyricsCache,
  saveLyricsCache,
  invoke,
  parseLRC,
  parseELRC,
  parseTTML,
  parseJSONLyrics,
  switchTab,
  getCoverSrc,
  showToast,
}) => {
  const lyricsCache = new Map();

  // Populate memory cache and search worker on startup from IndexedDB
  loadLyricsCache().then(cache => {
    cache.forEach((val, key) => {
      lyricsCache.set(key, val);
      searchWorker.postMessage({
        type: 'update_cache',
        data: { filePath: key, lines: val }
      });
    });
  }).catch(err => {
    console.error('[LyricsCacheDB] Failed to restore cache on startup:', err);
  });
  let isIndexing = false;
  let currentSearchQuery = '';
  let currentSearchSubTab = 'all'; // 'all', 'songs', 'albums', 'artists', 'lyrics', 'others'
  let lastSearchResults = { songs: [], albums: [], artists: [], lyrics: [], others: [] };

  const searchWorkerBlob = new Blob([workerSource], { type: 'application/javascript' });
  const searchWorker = new Worker(URL.createObjectURL(searchWorkerBlob));

  // Handle messages returned from Web Worker
  searchWorker.onmessage = (e) => {
    const { type, results, query } = e.data;
    if (type === 'search_results') {
      // Prevent race conditions by making sure results match the active query
      if (query === currentSearchQuery) {
        lastSearchResults = results;
        const resultsContainer = document.getElementById('search-results-list');
        if (resultsContainer) {
          renderSearchList(resultsContainer);
        }
      }
    }
  };

  // Helper to update index progress bar UI in real-time
  const updateIndexingProgress = () => {
    const progressContainer = document.getElementById('indexing-progress-container');
    if (!progressContainer) return;

    const total = player.playlist.length;
    const cached = lyricsCache.size;

    if (total === 0 || cached >= total) {
      progressContainer.style.display = 'none';
      return;
    }

    progressContainer.style.display = 'block';
    const percent = Math.round((cached / total) * 100);
    const fill = progressContainer.querySelector('.indexing-progress-fill');
    const text = progressContainer.querySelector('.indexing-progress-text');

    if (fill) fill.style.width = `${percent}%`;
    if (text) text.innerText = `正在后台生成歌词索引中(${cached}/${total} 首歌曲已索引)... 首次搜索可能不完整，生成后即可展示全部结果`;
  };

  // Background Indexer: Incremental lyrics loader
  const startIndexingLyrics = async () => {
    if (isIndexing) return;
    isIndexing = true;
    updateIndexingProgress();

    // Sync playlist to Web Worker
    searchWorker.postMessage({ type: 'init', data: { playlist: player.playlist } });

    try {
      const uncached = player.playlist.filter(s => !lyricsCache.has(s.file_path));
      if (uncached.length === 0) {
        isIndexing = false;
        updateIndexingProgress();
        return;
      }

      const concurrency = 3;
      for (let i = 0; i < uncached.length; i += concurrency) {
        if (player.playlist.length === 0) break;
        
        // Temporarily pause indexing if the user is typing/searching to prevent IPC congestion & UI stuttering
        if (currentSearchQuery) {
          isIndexing = false;
          return;
        }

        const chunk = uncached.slice(i, i + concurrency);
        await Promise.all(chunk.map(async (song) => {
          try {
            const res = await invoke('get_lyrics', { audioPath: song.file_path });
            if (res && res.content) {
              let parsedLines = [];
              if (res.lyrics_type === 'lrc') parsedLines = parseLRC(res.content);
              else if (res.lyrics_type === 'elrc' || res.lyrics_type === 'enhanced-lrc') parsedLines = parseELRC(res.content);
              else if (res.lyrics_type === 'ttml') parsedLines = parseTTML(res.content);
              else if (res.lyrics_type === 'json') parsedLines = parseJSONLyrics(res.content);
              
              // Sync with Web Worker cache
              lyricsCache.set(song.file_path, parsedLines);
              saveLyricsCache(song.file_path, parsedLines);
              searchWorker.postMessage({
                type: 'update_cache',
                data: { filePath: song.file_path, lines: parsedLines }
              });
            } else {
              lyricsCache.set(song.file_path, []);
              saveLyricsCache(song.file_path, []);
              searchWorker.postMessage({
                type: 'update_cache',
                data: { filePath: song.file_path, lines: [] }
              });
            }
          } catch (e) {
            lyricsCache.set(song.file_path, []);
            saveLyricsCache(song.file_path, []);
            searchWorker.postMessage({
              type: 'update_cache',
              data: { filePath: song.file_path, lines: [] }
            });
          }
        }));
        
        // Update progress dynamically
        updateIndexingProgress();
        await new Promise(r => setTimeout(r, 50));
      }
    } catch (err) {
      console.error('[LyricsIndexer] Pre-indexing error:', err);
    } finally {
      isIndexing = false;
      updateIndexingProgress();
    }
  };

  // Run indexer automatically every 5 seconds if there are playlist changes
  setInterval(() => {
    if (player.playlist.length > 0) {
      startIndexingLyrics();
    }
  }, 5000);

  const openSearch = () => {
    switchTab('search');
    setTimeout(() => {
      document.getElementById('global-search-input')?.focus();
    }, 50);
  };

  // Wire search buttons to switch tabs and focus
  document.getElementById('float-search')?.addEventListener('click', openSearch);

  // Debounced search trigger (150ms for snappy local lookup)
  let searchTimeout = null;
  const debouncedSearch = (query, container) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch(query, container);
    }, 150);
  };

  const performSearch = (query, container) => {
    if (!query) {
      lastSearchResults = { songs: [], albums: [], artists: [], lyrics: [], others: [] };
      container.innerHTML = '<div class="search-placeholder">输入关键词开始全局搜索...</div>';
      const tabsEl = document.querySelector('.search-tabs');
      if (tabsEl) tabsEl.style.display = 'none';
      return;
    }

    // Delegate search lookup completely to searchWorker to keep the UI main thread 100% lag-free
    searchWorker.postMessage({ type: 'init', data: { playlist: player.playlist } });
    searchWorker.postMessage({ type: 'search', data: { query } });
  };

  const highlightText = (text, query) => {
    if (!text) return '';
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return text.replace(regex, '<span class="search-highlight">$1</span>');
  };

  const renderSearchList = (container) => {
    if (!container) return;

    const { songs, albums, artists, lyrics, others } = lastSearchResults;
    const query = currentSearchQuery;

    // Toggle tabs container visibility depending on query and results availability
    const tabsEl = document.querySelector('.search-tabs');
    const totalResults = songs.length + albums.length + artists.length + lyrics.length + others.length;
    const hasResults = query && totalResults > 0;
    if (tabsEl) {
      tabsEl.style.display = hasResults ? 'flex' : 'none';
    }

    const showAll = currentSearchSubTab === 'all';
    const showSongs = showAll || currentSearchSubTab === 'songs';
    const showAlbums = showAll || currentSearchSubTab === 'albums';
    const showArtists = showAll || currentSearchSubTab === 'artists';
    const showLyrics = showAll || currentSearchSubTab === 'lyrics';
    const showOthers = showAll || currentSearchSubTab === 'others';

    const hasSongs = showSongs && songs.length > 0;
    const hasAlbums = showAlbums && albums.length > 0;
    const hasArtists = showArtists && artists.length > 0;
    const hasLyrics = showLyrics && lyrics.length > 0;
    const hasOthers = showOthers && others.length > 0;

    if (!hasSongs && !hasAlbums && !hasArtists && !hasLyrics && !hasOthers) {
      container.innerHTML = '<div class="search-placeholder">未找到匹配的结果。</div>';
      return;
    }

    let html = '';

    // 1. Render Songs
    if (hasSongs) {
      html += '<div class="search-group-title">歌曲</div>';
      songs.forEach((song) => {
        const cover = getCoverSrc(song);
        html += `
          <div class="search-item" data-type="song" data-file-path="${song.file_path}">
            <img class="search-item-icon" src="${cover}" />
            <div class="search-item-info">
              <div class="search-item-title">${highlightText(song.title, query)}</div>
              <div class="search-item-artist">${highlightText(song.artist, query)} ${song.album ? ' - ' + highlightText(song.album, query) : ''}</div>
            </div>
          </div>
        `;
      });
    }

    // 2. Render Albums
    if (hasAlbums) {
      html += '<div class="search-group-title">专辑</div>';
      albums.forEach((song) => {
        const cover = getCoverSrc(song);
        html += `
          <div class="search-item" data-type="song" data-file-path="${song.file_path}">
            <img class="search-item-icon" src="${cover}" />
            <div class="search-item-info">
              <div class="search-item-title">${highlightText(song.title, query)} - <span style="font-size: 12px; color: rgba(255,255,255,0.4);">${song.artist || '未知歌手'}</span></div>
              <div class="search-item-artist">专辑: ${highlightText(song.album, query)}</div>
            </div>
          </div>
        `;
      });
    }

    // 3. Render Artists
    if (hasArtists) {
      html += '<div class="search-group-title">艺术家</div>';
      artists.forEach((song) => {
        const cover = getCoverSrc(song);
        html += `
          <div class="search-item" data-type="song" data-file-path="${song.file_path}">
            <img class="search-item-icon" src="${cover}" />
            <div class="search-item-info">
              <div class="search-item-title">${highlightText(song.title, query)}</div>
              <div class="search-item-artist">歌手: ${highlightText(song.artist, query)} ${song.album ? ' - 专辑: ' + highlightText(song.album, query) : ''}</div>
            </div>
          </div>
        `;
      });
    }

    // 4. Render Lyrics matches
    if (hasLyrics) {
      html += '<div class="search-group-title">歌词内容</div>';
      lyrics.forEach(({ song, matches }) => {
        if (matches && matches.length > 0) {
          const line = matches[0];
          const cover = getCoverSrc(song);
          const timeMin = Math.floor(line.time / 60);
          const timeSec = (Math.floor(line.time) % 60).toString().padStart(2, '0');
          const previewText = line.text ? highlightText(line.text, query) : '';
          const previewTrans = line.translation ? '<br/>' + highlightText(line.translation, query) : '';
          
          html += `
            <div class="search-item" data-type="lyric" data-file-path="${song.file_path}" data-time="${line.time}">
              <img class="search-item-icon" src="${cover}" />
              <div class="search-item-info">
                <div class="search-item-title">${highlightText(song.title, query)} - <span style="font-size: 12px; color: rgba(255,255,255,0.4);">${song.artist || '未知歌手'}</span></div>
                <div class="search-item-lyrics-line">
                  <div>${previewText}${previewTrans}</div>
                  <span class="search-item-lyrics-time">${timeMin}:${timeSec}</span>
                </div>
              </div>
            </div>
          `;
        }
      });
    }

    // 5. Render Others
    if (hasOthers) {
      html += '<div class="search-group-title">其他元数据匹配</div>';
      others.forEach(({ song, fieldLabel }) => {
        const cover = getCoverSrc(song);
        html += `
          <div class="search-item" data-type="song" data-file-path="${song.file_path}">
            <img class="search-item-icon" src="${cover}" />
            <div class="search-item-info">
              <div class="search-item-title">${highlightText(song.title, query)} - <span style="font-size: 12px; color: rgba(255,255,255,0.4);">${song.artist || '未知歌手'}</span></div>
              <div class="search-item-artist" style="color: rgb(var(--dynamic-color, 16, 185, 129)); font-weight: 500;">${highlightText(fieldLabel, query)}</div>
            </div>
          </div>
        `;
      });
    }

    container.innerHTML = html;

    // Attach click listeners to rendered search items
    container.querySelectorAll('.search-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const filePath = item.getAttribute('data-file-path');
        const type = item.getAttribute('data-type');
        const time = parseFloat(item.getAttribute('data-time') || '0');

        const songIdx = player.playlist.findIndex((s) => s.file_path === filePath);
        if (songIdx >= 0) {
          const currentSong = player.playlist[player.currentIndex];
          if (currentSong && currentSong.file_path === filePath) {
            if (type === 'lyric') {
              player.audio.currentTime = time;
            }
          } else {
            if (type === 'lyric') {
              player.pendingSeekTime = time;
            }
            await player.play(songIdx);
          }
          player.lyrics.show();
        } else {
          showToast('无法在播放列表中找到该歌曲');
        }
      });
    });
  };

  const renderSearchTab = () => {
    startIndexingLyrics();
    const listEl = document.getElementById('music-list');
    if (!listEl) return;
    const toolbarEl = document.getElementById('content-toolbar');
    if (toolbarEl) {
      toolbarEl.innerHTML = '';
      toolbarEl.className = 'content-toolbar'; // 重置 className，移除 luna-toolbar 等残留类
    }

    listEl.innerHTML = `
      <div class="search-container">
        <div class="search-box">
          <svg class="search-box-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="global-search-input" placeholder="搜索歌曲标题、歌手、专辑或歌词..." />
          <button id="global-search-clear-btn" class="search-clear-btn" style="display: none;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      
      <!-- Real-time dynamic indexing progress bar -->
      <div id="indexing-progress-container" class="indexing-progress-container" style="display: none;">
        <div class="indexing-progress-bar">
          <div class="indexing-progress-fill"></div>
        </div>
        <div class="indexing-progress-text">正在后台生成歌词检索索引中...</div>
      </div>

      <div class="local-tabs search-tabs" style="display: none;">
        <button class="local-tab-btn ${currentSearchSubTab === 'all' ? 'active' : ''}" data-tab="all">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
          全部
        </button>
        <button class="local-tab-btn ${currentSearchSubTab === 'songs' ? 'active' : ''}" data-tab="songs">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          歌曲
        </button>
        <button class="local-tab-btn ${currentSearchSubTab === 'albums' ? 'active' : ''}" data-tab="albums">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          专辑
        </button>
        <button class="local-tab-btn ${currentSearchSubTab === 'artists' ? 'active' : ''}" data-tab="artists">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          艺术家
        </button>
        <button class="local-tab-btn ${currentSearchSubTab === 'lyrics' ? 'active' : ''}" data-tab="lyrics">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          歌词
        </button>
        <button class="local-tab-btn ${currentSearchSubTab === 'others' ? 'active' : ''}" data-tab="others">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          其他
        </button>
      </div>
      <div id="search-results-list" class="list-songs-container">
        <div class="search-placeholder">输入关键词开始全局搜索...</div>
      </div>
    `;

    const searchToolbar = listEl.querySelector('.search-container');
    const tabsToolbar = listEl.querySelector('.local-tabs');
    if (toolbarEl) {
      if (searchToolbar) toolbarEl.appendChild(searchToolbar);
      if (tabsToolbar) toolbarEl.appendChild(tabsToolbar);
    }

    // Immediately trigger progress UI update on mount
    updateIndexingProgress();

    const tabsEl = tabsToolbar || listEl.querySelector('.search-tabs');
    const contentArea = document.querySelector('.content-area');
    if (tabsEl && contentArea && contentArea.scrollTop > 5) {
      tabsEl.classList.add('scrolled');
    }

    const searchInput = toolbarEl?.querySelector('#global-search-input') || listEl.querySelector('#global-search-input');
    const searchClearBtn = toolbarEl?.querySelector('#global-search-clear-btn') || listEl.querySelector('#global-search-clear-btn');
    const resultsContainer = listEl.querySelector('#search-results-list');

    if (searchInput) {
      searchInput.value = currentSearchQuery;
      searchClearBtn.style.display = currentSearchQuery ? 'flex' : 'none';
    }

    if (currentSearchQuery) {
      renderSearchList(resultsContainer);
    }

    searchInput?.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      currentSearchQuery = val;
      searchClearBtn.style.display = val ? 'flex' : 'none';
      debouncedSearch(val, resultsContainer);
    });

    searchClearBtn?.addEventListener('click', () => {
      currentSearchQuery = '';
      if (searchInput) searchInput.value = '';
      searchClearBtn.style.display = 'none';
      lastSearchResults = { songs: [], albums: [], artists: [], lyrics: [], others: [] };
      resultsContainer.innerHTML = '<div class="search-placeholder">输入关键词开始全局搜索...</div>';
      const tabsEl = toolbarEl?.querySelector('.search-tabs') || listEl.querySelector('.search-tabs');
      if (tabsEl) tabsEl.style.display = 'none';
      searchInput?.focus();
    });

    (tabsEl || listEl).querySelectorAll('.local-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        (tabsEl || listEl).querySelectorAll('.local-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSearchSubTab = btn.getAttribute('data-tab');
                if (currentSearchQuery) {
          renderSearchList(resultsContainer);
          resultsContainer.classList.remove('page-enter');
          void resultsContainer.offsetWidth;
          resultsContainer.classList.add('page-enter');
        }
      });
    });
  };

  return {
    renderSearchTab,
    clearCache: () => {
      lyricsCache.clear();
      searchWorker.postMessage({ type: 'clear_cache' });
    },
  };
};
