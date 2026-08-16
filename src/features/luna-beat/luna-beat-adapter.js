/**
 * LunaBeat LAN 音源适配器
 * 所有 HTTP 请求通过 Tauri Rust 后端代理（luna_proxy_get/post/download），绕过 CORS
 *
 * 认证：POST /api/auth {code: PIN} → Rust 端自动保存 cookie
 * 音频：luna_proxy_download → Vec<u8> → 前端 Blob → objectURL
 * 歌词：luna_proxy_get → JSON（逐字卡拉OK格式，ms 时间戳）
 */

import { saveLunaCover } from '../../storage/luna-cover-cache.js';

const AUTH_PATH = '/api/auth';
const SONGS_PATH = '/api/songs';
const ALBUMS_PATH = '/api/albums';
const ARTISTS_PATH = '/api/artists';
const FOLDERS_PATH = '/api/folders';
const LYRIC_PATH = (id) => `/api/lyric?id=${id}`;
const AUDIO_PATH = (id) => `/api/audio/${id}`;
// COVER_PATH 第二个参数 size：缩略图=480（列表），大图=1440（沉浸页封面/动态毛玻璃取色/播放条封面）
const COVER_PATH = (id, size) => size ? `/api/cover/${id}?size=${size}` : `/api/cover/${id}`;

/** 通过文件头魔数嗅探音频 MIME 类型（兜底，当服务端未提供格式信息时） */
function sniffAudioMime(bytes) {
  if (!bytes || bytes.length < 4) return '';
  // FLAC: fLaC
  if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
    return 'audio/flac';
  }
  // MP3 / MPEG: ID3 标签 或帧同步 0xFFEx
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'audio/mpeg';
  }
  if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
    return 'audio/mpeg';
  }
  // RIFF / WAV: RIFF....WAVE
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
    return 'audio/wav';
  }
  // OGG: OggS
  if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return 'audio/ogg';
  }
  // M4A / MP4 / AAC: ftyp box
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    // 区分音频 mp4 与视频 mp4：查看 ftyp 后的品牌，常见的音频品牌有 M4A / isom
    return 'audio/mp4';
  }
  return '';
}

// LRU 上限：音频 blob 体积大，保留最近 5 首；
// 封面按尺寸分区缓存，避免大/小图互相覆盖：缩略图(480)=1000 张，大图(1440)=300 张
const AUDIO_BLOB_LRU_MAX = 5;
const COVER_SMALL_MAX = 1000;
const COVER_LARGE_MAX = 300;
// 尺寸常量：缩略图 480，大图 1440
export const COVER_SIZE_SMALL = 480;
export const COVER_SIZE_LARGE = 1440;

export class LunaBeatAdapter {
  constructor(baseUrl) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.authenticated = false;
    this._blobUrlCache = new Map();   // songId -> blob URL（LRU，插入顺序即最近使用顺序）
    // 封面按尺寸分区，避免大图、小图互相覆盖：缓存键 = `${songId}::${size}`
    this._coverUrlCache = new Map();  // coverKey -> blob URL（LRU，容量见 COVER_SMALL_MAX / COVER_LARGE_MAX）
    this._pinnedAudioId = null;       // 当前播放歌曲 id，LRU 淘汰时跳过
  }

  /** 通用 LRU 写入：超限时淘汰最旧项并释放其 blob URL */
  _lruSet(cache, key, url, max) {
    if (cache.has(key)) {
      cache.delete(key); // 重新放到末尾，保持最近使用
    }
    cache.set(key, url);
    while (cache.size > max) {
      const oldestKey = cache.keys().next().value;
      const oldestUrl = cache.get(oldestKey);
      cache.delete(oldestKey);
      // 淘汰当前正在播放的音频 blob 会导致 <audio> ERR_FILE_NOT_FOUND
      if (oldestKey === this._pinnedAudioId && cache === this._blobUrlCache) {
        cache.set(oldestKey, oldestUrl); // 放回末尾
        continue;
      }
      // 仅针对大文件音频 blob 执行 revokeObjectURL；封面图片 blob 保留引用防止 DOM <img> 触发 ERR_FILE_NOT_FOUND
      if (cache === this._blobUrlCache && oldestUrl && oldestUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(oldestUrl); } catch (e) {}
      }
    }
  }

  /** 标记当前播放的歌曲 id（LRU 淘汰时保护其音频 blob 不被释放） */
  pinAudioId(lunaId) {
    this._pinnedAudioId = lunaId != null ? String(lunaId) : null;
  }

  static loadConfig() {
    try {
      const raw = localStorage.getItem('kimo-lunabeat-config');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { baseUrl: '', pinCode: '', enabled: false };
  }

  static saveConfig(config) {
    try {
      localStorage.setItem('kimo-lunabeat-config', JSON.stringify(config));
    } catch (e) {}
  }

  isConfigured() {
    return !!(this.baseUrl && this.authenticated);
  }

  /** 判断错误是否为配对码过期（触发自动重连） */
  _isPairingRequired(err) {
    const msg = (err && (err.message || String(err))) || '';
    return msg.includes('pairing_required') || msg.includes('401');
  }

  /** 重新认证（cookie 过期时自动调用） */
  async _reauth() {
    this.authenticated = false;
    const cfg = LunaBeatAdapter.loadConfig();
    if (!cfg.pinCode) throw new Error('配对码已过期，请重新输入');
    await this.authenticate(cfg.pinCode);
  }

  /** 通过 Rust 后端发 GET 请求（cookie 过期自动重连一次） */
  async _proxyGet(path) {
    const url = `${this.baseUrl}${path}`;
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      return await invoke('luna_proxy_get', { url });
    } catch (e) {
      if (this._isPairingRequired(e)) {
        await this._reauth();
        return invoke('luna_proxy_get', { url });
      }
      throw e;
    }
  }

  /** 通过 Rust 后端发 POST 请求 */
  async _proxyPost(path, bodyObj) {
    const url = `${this.baseUrl}${path}`;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('luna_proxy_post', { url, body: JSON.stringify(bodyObj) });
  }

  /** 通过 Rust 后端下载二进制数据（cookie 过期自动重连一次） */
  async _proxyDownload(path) {
    const url = `${this.baseUrl}${path}`;
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const bytes = await invoke('luna_proxy_download', { url });
      // Tauri 返回 Vec<u8> → JS 端是 number[]
      return new Uint8Array(bytes);
    } catch (e) {
      if (this._isPairingRequired(e)) {
        await this._reauth();
        const bytes = await invoke('luna_proxy_download', { url });
        return new Uint8Array(bytes);
      }
      throw e;
    }
  }

  /** 认证 */
  async authenticate(pinCode) {
    if (!this.baseUrl) throw new Error('未配置 LunaBeat 服务器地址');
    if (!pinCode) throw new Error('未配置配对码');

    const result = await this._proxyPost(AUTH_PATH, { code: pinCode });
    let parsed;
    try { parsed = JSON.parse(result); } catch (e) { parsed = {}; }

    if (parsed.authenticated) {
      this.authenticated = true;
      return true;
    }
    if (parsed.error) throw new Error(`认证失败: ${parsed.error}`);
    throw new Error('认证失败: 未知响应');
  }

  /** 自动认证（若已保存 PIN 且未认证时） */
  async ensureAuth() {
    if (!this.baseUrl) return false;
    if (this.authenticated) return true;

    const cfg = LunaBeatAdapter.loadConfig();
    if (cfg.pinCode) {
      await this.authenticate(cfg.pinCode);
      return true;
    }
    return false;
  }

  /**
   * 从分页响应中提取歌曲数组和总数信息
   * 兼容多种 LunaBeat 返回格式：
   *   - 直接返回数组（不分页或旧版）
   *   - { songs: [...], total: N, pageSize: N, pages: N }
   *   - { data: [...], total: N, count: N, pageCount: N }
   *   - { list: [...], total: N }
   * @returns {{ list: Array, total: number, pageSize: number }}
   */
  static _extractPagedSongs(raw) {
    let list = [];
    let total = 0;
    let pageSize = 0;
    if (Array.isArray(raw)) {
      list = raw;
      total = raw.length;
      pageSize = raw.length;
    } else if (raw && typeof raw === 'object') {
      list = Array.isArray(raw.songs)
        ? raw.songs
        : (Array.isArray(raw.data)
          ? raw.data
          : (Array.isArray(raw.list) ? raw.list : []));
      total = Number.isFinite(raw.total)
        ? raw.total
        : (Number.isFinite(raw.count)
          ? raw.count
          : (Number.isFinite(raw.itemCount)
            ? raw.itemCount
            : list.length));
      pageSize = Number.isFinite(raw.pageSize) ? raw.pageSize : list.length;
    }
    return { list, total, pageSize };
  }

  /**
   * 拉取一页歌曲（滚动分页加载用）
   * @param {number} page 页码，从 1 开始
   * @param {number} pageSize 每页数量（建议 50）
   * @returns {{ songs: Array, total: number, hasMore: boolean }}
   *   songs: 已 _mapSong 后的歌曲数组
   *   total: 服务端报告的歌曲总数
   *   hasMore: 是否还有下一页
   */
  async getSongsPage(page = 1, pageSize = 50) {
    await this.ensureAuth();
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safeSize = Math.max(10, Math.min(500, Math.floor(Number(pageSize) || 50)));
    const url = `${SONGS_PATH}?page=${safePage}&pageSize=${safeSize}&sort=title`;
    const result = await this._proxyGet(url);
    const raw = JSON.parse(result);
    const { list, total } = LunaBeatAdapter._extractPagedSongs(raw);
    const mapped = list.map(s => this._mapSong(s));
    const loadedCount = (safePage - 1) * safeSize + mapped.length;
    return {
      songs: mapped,
      total,
      hasMore: loadedCount < total && mapped.length > 0,
    };
  }

  /**
   * 获取全部歌曲（向后兼容：专辑/艺人/文件夹筛选仍要在 songsCache 上做，
   * 所以这里还是一次性拉全量，但用 getSongsPage 循环翻页保证不丢歌）
   */
  async getSongs() {
    const PAGE_SIZE = 50;
    const first = await this.getSongsPage(1, PAGE_SIZE);
    const all = [...first.songs];
    if (!first.hasMore) return all;

    const totalPages = Math.ceil(first.total / PAGE_SIZE);
    for (let p = 2; p <= totalPages; p++) {
      const page = await this.getSongsPage(p, PAGE_SIZE);
      all.push(...page.songs);
      if (!page.hasMore) break;
    }

    // 按 _lunaId 去重（翻页边界可能重复）
    const seen = new Set();
    const deduped = [];
    for (const s of all) {
      const id = String(s?._lunaId ?? '');
      if (id && !seen.has(id)) {
        seen.add(id);
        deduped.push(s);
      } else if (!id) {
        deduped.push(s);
      }
    }
    return deduped;
  }

  /** 获取专辑列表 */
  async getAlbums() {
    await this.ensureAuth();
    const result = await this._proxyGet(ALBUMS_PATH);
    return JSON.parse(result);
  }

  /** 获取艺人列表 */
  async getArtists() {
    await this.ensureAuth();
    const result = await this._proxyGet(ARTISTS_PATH);
    return JSON.parse(result);
  }

  /** 获取文件夹列表 */
  async getFolders() {
    await this.ensureAuth();
    const result = await this._proxyGet(FOLDERS_PATH);
    return JSON.parse(result);
  }

  /**
   * 获取封面 blob URL（带 LRU 缓存）
   * @param {object} song 歌曲对象（含 _lunaId / id / audioId）
   * @param {number|null|undefined} size 封面尺寸，可选：
   *   - COVER_SIZE_LARGE (1440)：大封面（沉浸歌词页 / 播放条封面 / 动态毛玻璃取色）
   *   - COVER_SIZE_SMALL (480)：缩略图（歌曲列表、右键菜单、搜索结果）
   *   - null / 不传：向后兼容（等价 COVER_SIZE_SMALL，避免旧调用方行为突变）
   */
  async getCoverBlobUrl(song, size) {
    if (!song || (!song._lunaId && !song.id && !song.audioId)) return null;
    const lunaId = String(song._lunaId || song.audioId || song.id);
    // 归一化：未传 size 时等价 SMALL；非 LARGE 的值统一夹到合法集合
    let normSize = (size === COVER_SIZE_SMALL || size === COVER_SIZE_LARGE)
      ? size
      : COVER_SIZE_SMALL;
    const cacheKey = `${lunaId}::${normSize}`;

    if (this._coverUrlCache.has(cacheKey)) {
      const url = this._coverUrlCache.get(cacheKey);
      this._coverUrlCache.delete(cacheKey);
      this._coverUrlCache.set(cacheKey, url);
      return url;
    }
    await this.ensureAuth();
    try {
      const bytes = await this._proxyDownload(COVER_PATH(lunaId, normSize));
      if (!bytes || !bytes.length || bytes.length === 0) {
        return null;
      }
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const maxCount = normSize === COVER_SIZE_LARGE ? COVER_LARGE_MAX : COVER_SMALL_MAX;
      this._lruSet(this._coverUrlCache, cacheKey, url, maxCount);
      // 持久化封面：月度榜单等离线场景可恢复（fire-and-forget，不阻塞显示）
      if (normSize === COVER_SIZE_SMALL) {
        saveLunaCover(lunaId, blob);
      }
      return url;
    } catch (e) {
      return null;
    }
  }

  /**
   * 同步返回封面 URL（优先返回已缓存的 blob URL；未缓存返回 null，由调用方走懒加载）
   * 优先查找 LARGE 缓存；找不到再找 SMALL，保证调用方至少能拿到可用图（略模糊但不空白）
   */
  getCoverUrl(song) {
    if (!song || (!song._lunaId && !song.id && !song.audioId)) return null;
    const lunaId = String(song._lunaId || song.audioId || song.id);
    const largeKey = `${lunaId}::${COVER_SIZE_LARGE}`;
    const smallKey = `${lunaId}::${COVER_SIZE_SMALL}`;
    if (this._coverUrlCache.has(largeKey)) return this._coverUrlCache.get(largeKey);
    if (this._coverUrlCache.has(smallKey)) return this._coverUrlCache.get(smallKey);
    return null;
  }

  /** 获取音频直链流地址（用于 HTML5 <audio> 秒级流式播放） */
  getAudioUrl(lunaId) {
    if (!lunaId || !this.baseUrl) return null;
    return `${this.baseUrl}${AUDIO_PATH(lunaId)}`;
  }

  /**
   * 下载音频并返回可播放的 blob URL
   * @param {number} lunaId LunaBeat 歌曲 ID
   * @param {object} song 歌曲对象（可选）
   * @param {Function} onProgress 进度回调 (loadedBytes, totalBytes)
   */
  async fetchAudioBlob(lunaId, song = null, onProgress = null) {
    if (typeof song === 'function') {
      onProgress = song;
      song = null;
    }
    if (this._blobUrlCache.has(lunaId)) {
      return this._blobUrlCache.get(lunaId);
    }

    await this.ensureAuth();
    const bytes = await this._proxyDownload(AUDIO_PATH(lunaId));

    // MIME 推导：优先用服务端给出的 mimeType，其次按格式扩展名推导，
    // 最后用文件头字节嗅探（避免格式未知时硬编码 audio/flac 导致 mp3/m4a 解码失败）
    let mimeType = (song && song.mimeType) ? song.mimeType.toLowerCase() : '';
    if (!mimeType) {
      const fmt = (song && song.format ? song.format : '').toLowerCase();
      if (fmt === 'mp3') mimeType = 'audio/mpeg';
      else if (fmt === 'wav') mimeType = 'audio/wav';
      else if (fmt === 'aac') mimeType = 'audio/aac';
      else if (fmt === 'm4a') mimeType = 'audio/mp4';
      else if (fmt === 'ogg') mimeType = 'audio/ogg';
      else if (fmt === 'flac') mimeType = 'audio/flac';
    }
    if (!mimeType) {
      mimeType = sniffAudioMime(bytes);
    }

    const blob = new Blob([bytes], { type: mimeType || 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    this._lruSet(this._blobUrlCache, String(lunaId), url, AUDIO_BLOB_LRU_MAX);
    if (onProgress) onProgress(bytes.byteLength, bytes.byteLength);
    return url;
  }

  /**
   * 获取歌词并转换为 kimoPlayer 内部格式
   * LunaBeat: { lines: [{ words: [{startTime, endTime, word}], startTime, endTime, translatedLyric }] }
   * kimoPlayer: [{ time, end, text, words: [{ time, end, text, duration }], translation }]
   *
   * ⭐ 逐字汉字合并：LunaBeat/AMLL 的逐字分词器（character-level）会把「態度」拆成
   * 两个独立 word（態 + 度，各带 romanWord=たい / ど），导致渲染层把一整串 compound
   * 的振假名拆成多段注音。这里在适配层提前把相邻的「连续纯汉字 + 时间无间隙 + 都有 ruby」
   * 的 word 合并回一个 compound word，视觉效果就和 Apple Music 一致：
   * 振假名整串居中放在 compound 连续汉字段上方。
   */
  async fetchLyrics(lunaId) {
    await this.ensureAuth();
    const result = await this._proxyGet(LYRIC_PATH(lunaId));
    const data = JSON.parse(result);
    if (!data || !Array.isArray(data.lines) || data.lines.length === 0) return null;

    const GAP_EPSILON = 0.025; // 25ms 之内视为连续（Apple Music 原数据常有浮点误差）
    const isPureCJK = (text) => {
      if (!text) return false;
      if (!/^[\u4e00-\u9faf\u3400-\u4dbf]+$/.test(text)) return false;
      return true;
    };
    const mergeCompounds = (words) => {
      if (!words || words.length <= 1) return words;
      const merged = [];
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const prev = merged.length > 0 ? merged[merged.length - 1] : null;
        const canMerge = prev
          && isPureCJK(prev.text)
          && isPureCJK(w.text)
          && prev.ruby
          && w.ruby
          && prev.isBackground === w.isBackground
          && Math.abs((prev.end || 0) - (w.time || 0)) < GAP_EPSILON;
        if (canMerge) {
          prev.text += w.text;
          prev.ruby += w.ruby;
          prev.end = Math.max(prev.end || 0, w.end || 0);
          prev.duration = Math.max(0.001, prev.end - prev.time);
          prev.spaceAfter = Boolean(w.spaceAfter);
        } else {
          merged.push({ ...w });
        }
      }
      return merged;
    };

    return data.lines.map(line => {
      const startTime = (line.startTime || 0) / 1000;
      const endTime = (line.endTime || 0) / 1000;
      let words = Array.isArray(line.words)
        ? line.words.map(w => {
            const time = (w.startTime || 0) / 1000;
            const end = (w.endTime || 0) / 1000;
            const rubyRaw = w.romanWord || w.transliteration || '';
            return {
              time,
              end,
              text: w.word || '',
              duration: Math.max(0.001, end - time),
              spaceAfter: false,
              ruby: rubyRaw ? String(rubyRaw) : null,
              isBackground: Boolean(w.isBG || w.isBackground),
            };
          })
        : null;

      if (words) words = mergeCompounds(words);

      const text = words ? words.map(w => w.text).join('') : '';

      const hasValidWords = !!(words && words.length >= 1 && words.some(w => (w.end - w.time) > 0.001));

      return {
        time: startTime,
        end: endTime,
        text,
        words: hasValidWords ? words : null,
        isWordTimed: hasValidWords,
        timingFormat: hasValidWords ? 'word-lrc' : 'lrc',
        translation: line.translatedLyric || '',
        romanLyric: line.romanLyric || '',
        role: line.role || line.agent || '',
        duetLane: line.duetLane,
        isBackground: Boolean(line.isBackground ?? line.isBG),
        isDuet: Boolean(line.isDuet),
      };
    });
  }

  /** 将 LunaBeat 歌曲映射到 kimoPlayer 歌曲格式 */
  _mapSong(s) {
    const lunaId = s.audioId || s.id;
    const lunaIdStr = String(lunaId);
    // 封面初始为 null，避免暴露跨域 HTTP 直链导致 <img> 加载失败闪烁；
    // 若已缓存 SMALL 尺寸则直接使用（列表/缩略图场景即点即现）
    const smallKey = `${lunaIdStr}::${COVER_SIZE_SMALL}`;
    const cachedCover = this._coverUrlCache.has(smallKey)
      ? this._coverUrlCache.get(smallKey)
      : null;
    return {
      file_path: `luna://${lunaId}`,
      title: s.title || '未知歌曲',
      artist: s.artist || '未知艺人',
      album: s.album || '',
      albumArtist: s.albumArtist || '',
      duration: s.durationMs ? s.durationMs / 1000 : s.duration || 0,
      durationMs: s.durationMs || s.duration || 0,
      fileSize: s.fileSize || 0,
      year: s.year || '',
      genre: s.genre || '',
      format: s.format || '',
      mimeType: s.mimeType || '',
      cover_image: cachedCover,
      _source: 'luna',
      _lunaId: s.audioId || s.id,
      _baseUrl: this.baseUrl,
    };
  }

  dispose() {
    // 释放所有 blob URL，避免内存泄漏；调用方应确保此时无活动 <audio> / <img> 引用
    for (const url of this._blobUrlCache.values()) {
      if (url && url.startsWith('blob:')) {
        try { URL.revokeObjectURL(url); } catch (e) {}
      }
    }
    for (const url of this._coverUrlCache.values()) {
      if (url && url.startsWith('blob:')) {
        try { URL.revokeObjectURL(url); } catch (e) {}
      }
    }
    this._blobUrlCache.clear();
    this._coverUrlCache.clear();
    this._pinnedAudioId = null;
  }
}
