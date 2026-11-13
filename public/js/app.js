const FORMAT_CONFIG = {
  video: {
    label: 'Video',
    defaultQuality: '1080p',
    qualities: [
      { value: '1080p', label: '1080p', note: 'Full HD' },
      { value: '720p', label: '720p', note: 'HD' },
      { value: '480p', label: '480p', note: 'Hemat kuota' },
    ],
  },
  audio: {
    label: 'Audio',
    defaultQuality: '320kbps',
    qualities: [
      { value: '320kbps', label: '320 kbps', note: 'Kualitas tinggi' },
      { value: '128kbps', label: '128 kbps', note: 'Hemat kuota' },
    ],
  },
  photo: {
    label: 'Foto',
    defaultQuality: 'original',
    qualities: [{ value: 'original', label: 'Original', note: 'Resolusi penuh' }],
  },
};

const SAMPLE_URL = 'https://www.tiktok.com/@tiktok/video/7106594312292453675';

const els = {
  form: document.querySelector('#downloadForm'),
  urlInput: document.querySelector('#urlInput'),
  inputShell: document.querySelector('.input-shell'),
  pasteBtn: document.querySelector('#pasteBtn'),
  sampleBtn: document.querySelector('#sampleBtn'),
  detectedPlatform: document.querySelector('#detectedPlatform'),
  formatTabs: document.querySelector('#formatTabs'),
  qualityGroup: document.querySelector('#qualityGroup'),
  qualityHint: document.querySelector('#qualityHint'),
  submitBtn: document.querySelector('#submitBtn'),
  formMessage: document.querySelector('#formMessage'),
  resultCard: document.querySelector('#resultCard'),
  resultThumb: document.querySelector('#resultThumb'),
  resultThumbFallback: document.querySelector('#resultThumbFallback'),
  resultPlatform: document.querySelector('#resultPlatform'),
  resultTitle: document.querySelector('#resultTitle'),
  resultQuality: document.querySelector('#resultQuality'),
  resultMeta: document.querySelector('#resultMeta'),
  resultNote: document.querySelector('#resultNote'),
  downloadActions: document.querySelector('#downloadActions'),
  navToggle: document.querySelector('#mobileToggle'),
  navMenu: document.querySelector('#navMenu'),
  navStatusDot: document.querySelector('#navStatusDot'),
  apiStatusDot: document.querySelector('#apiStatusDot'),
  apiStatusText: document.querySelector('#apiStatusText'),
  apiStatusDetail: document.querySelector('#apiStatusDetail'),
  refreshStatus: document.querySelector('#refreshStatus'),
  toast: document.querySelector('#toast'),
};

const state = {
  format: 'video',
  quality: FORMAT_CONFIG.video.defaultQuality,
  url: '',
  media: null,
  formats: null,
  busy: false,
  requestId: 0,
  downloadId: 0,
  toastTimer: null,
};

init();

function init() {
  syncFormatTabs();
  renderQualityOptions();
  bindEvents();
  updateDetectedPlatform();
  checkApiHealth();
}

function bindEvents() {
  els.form.addEventListener('submit', handleSubmit);
  els.pasteBtn.addEventListener('click', handlePaste);
  els.sampleBtn.addEventListener('click', handleSample);

  els.urlInput.addEventListener('input', () => {
    clearFieldError();
    updateDetectedPlatform();

    const current = els.urlInput.value.trim();
    if (state.media && current !== state.url) resetResult();
  });

  els.formatTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-format]');
    if (!tab || tab.disabled) return;
    selectFormat(tab.dataset.format);
  });

  els.qualityGroup.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quality]');
    if (!button || button.disabled) return;
    state.quality = button.dataset.quality;
    renderQualityOptions();
    if (state.media && !state.busy) resolveDownload();
  });

  els.resultThumb.addEventListener('error', showThumbFallback);

  els.navToggle.addEventListener('click', () => {
    setNavOpen(!els.navMenu.classList.contains('is-open'));
  });

  els.navMenu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setNavOpen(false);
  });

  document.addEventListener('click', (event) => {
    if (!els.navMenu.contains(event.target) && !els.navToggle.contains(event.target)) {
      setNavOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setNavOpen(false);
  });

  els.refreshStatus.addEventListener('click', () => {
    checkApiHealth(true);
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  if (state.busy) return;

  const url = els.urlInput.value.trim();

  if (!url) {
    showFieldError('Tempel tautan terlebih dahulu sebelum mengambil berkas.');
    els.urlInput.focus();
    return;
  }

  if (!isValidUrl(url)) {
    showFieldError('Tautan tidak valid. Sertakan alamat lengkap dengan https:// di awal.');
    els.urlInput.focus();
    return;
  }

  clearFieldError();
  resetResult({ keepMessage: true });
  setBusy(true);
  setMessage('Mengambil informasi media...', 'info');

  const requestId = ++state.requestId;

  try {
    const info = await postJson('/api/info', { url });
    if (requestId !== state.requestId) return;

    state.media = info;
    state.formats = info.formats || { video: [], audio: [], photo: [] };
    state.url = info.sourceUrl || url;

    syncFormatAvailability(info);

    if (!info.available?.[state.format]) {
      const fallback = ['video', 'audio', 'photo'].find((format) => info.available?.[format]);
      if (!fallback) throw new Error('Tidak ada format yang bisa diunduh dari tautan ini.');
      selectFormat(fallback, { refresh: false });
    }

    renderResult(info);
    setMessage('Media ditemukan. Menyiapkan tautan unduhan...', 'info');

    const ready = await resolveDownload(requestId);

    if (requestId === state.requestId && ready) {
      setMessage('Tautan unduhan siap. Silakan unduh berkasmu.', 'success');
      showToast('Tautan unduhan siap.', 'success');
    }
  } catch (error) {
    if (requestId !== state.requestId) return;
    setMessage(error.message || 'Gagal mengambil media. Coba lagi.', 'error');
    els.resultCard.hidden = true;
  } finally {
    if (requestId === state.requestId) setBusy(false);
  }
}

async function resolveDownload(requestId = state.requestId) {
  if (!state.media) return false;

  const media = state.media;
  const format = state.format;
  const quality = state.quality;
  const downloadId = ++state.downloadId;

  renderDownloadLoading();

  try {
    const payload = await postJson('/api/download', {
      url: media.sourceUrl || state.url,
      format,
      quality,
    });

    if (requestId !== state.requestId || downloadId !== state.downloadId) return false;

    renderDownloadActions(payload);
    updateResultQuality(payload);
    return true;
  } catch (error) {
    if (requestId !== state.requestId || downloadId !== state.downloadId) return false;
    renderDownloadError(error.message);
    return false;
  }
}

function selectFormat(format, options = {}) {
  if (!FORMAT_CONFIG[format]) return;

  state.format = format;

  const config = FORMAT_CONFIG[format];
  const values = qualityValues(format);

  if (!values.includes(state.quality)) state.quality = config.defaultQuality;

  syncFormatTabs();
  renderQualityOptions();

  if (options.refresh !== false && state.media && !state.busy) resolveDownload();
}

function syncFormatTabs() {
  for (const tab of els.formatTabs.querySelectorAll('[data-format]')) {
    const active = tab.dataset.format === state.format;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

function syncFormatAvailability(info) {
  for (const tab of els.formatTabs.querySelectorAll('[data-format]')) {
    const format = tab.dataset.format;
    const available = Boolean(info.available?.[format] ?? info.formats?.[format]?.length);
    tab.classList.toggle('is-unavailable', !available);
    tab.disabled = !available;
    tab.setAttribute('aria-disabled', String(!available));
    tab.title = available ? '' : `Format ${FORMAT_CONFIG[format].label} tidak tersedia untuk media ini`;
  }
}

function resetFormatAvailability() {
  for (const tab of els.formatTabs.querySelectorAll('[data-format]')) {
    tab.disabled = false;
    tab.classList.remove('is-unavailable');
    tab.removeAttribute('aria-disabled');
    tab.title = '';
  }
}

function qualityValues(format) {
  const config = FORMAT_CONFIG[format];
  const values = config.qualities.map((item) => item.value);
  const streams = state.formats?.[format] || [];

  for (const stream of streams) {
    if (stream.quality && !values.includes(stream.quality)) values.push(stream.quality);
  }

  return values;
}

function renderQualityOptions() {
  const config = FORMAT_CONFIG[state.format];
  const streams = state.formats?.[state.format] || null;
  const hasFormat = !state.formats || streams.length > 0;
  const actual = new Map();

  for (const stream of streams || []) {
    if (stream.quality && !actual.has(stream.quality)) actual.set(stream.quality, stream);
  }

  const options = [];
  const seen = new Set();

  for (const item of config.qualities) {
    seen.add(item.value);
    options.push({ ...item, actual: actual.get(item.value) || null });
  }

  for (const [value, stream] of actual) {
    if (seen.has(value)) continue;
    options.push({
      value,
      label: value,
      note: stream.label || (stream.height ? `${stream.height}p` : 'Tersedia'),
      actual: stream,
    });
  }

  if (!options.some((item) => item.value === state.quality) && options.length) {
    state.quality = options[0].value;
  }

  els.qualityGroup.innerHTML = '';

  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quality-pill';
    button.dataset.quality = option.value;
    button.setAttribute('aria-pressed', String(option.value === state.quality));
    button.disabled = !hasFormat;

    if (option.value === state.quality) button.classList.add('is-active');
    if (!hasFormat) button.classList.add('is-disabled');

    const name = document.createElement('span');
    name.className = 'quality-name';
    name.textContent = option.label;

    button.append(name);

    if (option.note) {
      const note = document.createElement('span');
      note.className = 'quality-note';
      note.textContent = option.note;
      button.append(note);
    }

    els.qualityGroup.append(button);
  }

  if (!hasFormat) {
    els.qualityHint.textContent = `Format ${config.label} tidak tersedia untuk media ini. Pilih format lain.`;
  } else if (state.formats) {
    els.qualityHint.textContent =
      'Kualitas aktual ditampilkan pada kartu hasil. Jika opsi tidak tersedia, sistem memakai kualitas terdekat.';
  } else {
    els.qualityHint.textContent = 'Kualitas disesuaikan otomatis jika opsi yang dipilih tidak tersedia.';
  }
}

function renderResult(info) {
  els.resultCard.hidden = false;
  els.resultPlatform.textContent = info.platformLabel || 'Media';
  els.resultTitle.textContent = info.title || 'Media tanpa judul';

  const meta = [];
  if (info.author) meta.push(info.author);
  if (info.duration) meta.push(formatDuration(info.duration));
  meta.push('Tautan publik');
  els.resultMeta.textContent = meta.join(' • ');

  if (info.note) {
    els.resultNote.textContent = info.note;
    els.resultNote.hidden = false;
  } else {
    els.resultNote.hidden = true;
    els.resultNote.textContent = '';
  }

  els.resultQuality.textContent = 'Menyiapkan...';
  els.resultThumb.onerror = showThumbFallback;

  if (info.thumbnail) {
    els.resultThumb.src = info.thumbnail;
    els.resultThumb.alt = info.title ? `Pratinjau: ${info.title}` : 'Pratinjau media';
    els.resultThumb.hidden = false;
    els.resultThumbFallback.hidden = true;
  } else {
    showThumbFallback();
  }

  renderDownloadLoading();
}

function showThumbFallback() {
  els.resultThumb.hidden = true;
  els.resultThumbFallback.hidden = false;
}

function renderDownloadLoading() {
  els.downloadActions.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'download-loading';

  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.textContent = 'Menyiapkan tautan unduhan...';

  wrap.append(spinner, text);
  els.downloadActions.append(wrap);
}

function renderDownloadError(message) {
  els.downloadActions.innerHTML = '';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn-secondary';
  retry.textContent = 'Coba lagi';
  retry.addEventListener('click', () => resolveDownload());

  const note = document.createElement('span');
  note.className = 'actions-note';
  note.textContent = message || 'Tautan unduhan belum siap.';

  els.downloadActions.append(retry, note);
  setMessage(message || 'Gagal menyiapkan tautan unduhan.', 'error');
}

function renderDownloadActions(payload) {
  els.downloadActions.innerHTML = '';

  const primary = document.createElement('a');
  primary.className = 'btn btn-primary btn-download';
  primary.href = payload.downloadUrl;
  primary.target = '_blank';
  primary.rel = 'noopener noreferrer';
  if (payload.filename) primary.setAttribute('download', payload.filename);

  const label = document.createElement('span');
  label.textContent = `Unduh ${String(payload.ext || 'berkas').toUpperCase()}`;

  primary.append(createDownloadIcon(), label);
  els.downloadActions.append(primary);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'btn-secondary';
  copyButton.textContent = 'Salin tautan';
  copyButton.addEventListener('click', async () => {
    try {
      await copyText(payload.downloadUrl);
      showToast('Tautan unduhan disalin.', 'success');
    } catch {
      showToast('Gagal menyalin tautan. Buka tautan secara manual.', 'error');
    }
  });

  els.downloadActions.append(copyButton);

  if (Array.isArray(payload.downloads) && payload.downloads.length > 1) {
    const list = document.createElement('div');
    list.className = 'download-list';

    payload.downloads.forEach((item, index) => {
      const link = document.createElement('a');
      link.className = 'download-chip';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      if (payload.format === 'photo') {
        link.textContent = `Foto ${index + 1}`;
      } else {
        link.textContent = item.quality || item.label || `Opsi ${index + 1}`;
      }

      list.append(link);
    });

    els.downloadActions.append(list);
  }

  const notes = [];

  if (payload.hasAudio === false) {
    notes.push('Berkas video ini tidak menyertakan trek audio.');
  }

  if (payload.requestedQuality && payload.quality && payload.requestedQuality !== payload.quality) {
    notes.push(`Kualitas disesuaikan ke ${payload.quality} karena ${payload.requestedQuality} tidak tersedia.`);
  }

  if (payload.format === 'photo' && payload.downloads?.length > 1) {
    notes.push('Postingan berisi beberapa foto. Gunakan tombol di atas untuk memilih foto lain.');
  }

  notes.push('Tautan langsung biasanya berlaku sementara. Segera simpan berkasmu.');

  for (const text of notes) {
    const note = document.createElement('span');
    note.className = 'actions-note';
    note.textContent = text;
    els.downloadActions.append(note);
  }
}

function updateResultQuality(payload) {
  const parts = [];
  if (payload.quality) parts.push(payload.quality);
  if (payload.ext) parts.push(String(payload.ext).toUpperCase());
  els.resultQuality.textContent = parts.join(' • ') || 'Siap';
}

async function handlePaste() {
  if (!navigator.clipboard?.readText) {
    showToast('Browser tidak mendukung tempel otomatis. Gunakan Ctrl+V.', 'error');
    els.urlInput.focus();
    return;
  }

  try {
    const text = (await navigator.clipboard.readText()).trim();

    if (!text) {
      showToast('Clipboard kosong. Salin tautan terlebih dahulu.', 'error');
      els.urlInput.focus();
      return;
    }

    els.urlInput.value = text;
    els.urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    els.urlInput.focus();
    showToast('Tautan ditempel dari clipboard.', 'success');
  } catch {
    showToast('Akses clipboard diblokir. Tempel manual dengan Ctrl+V.', 'error');
    els.urlInput.focus();
  }
}

function handleSample() {
  els.urlInput.value = SAMPLE_URL;
  els.urlInput.dispatchEvent(new Event('input', { bubbles: true }));
  els.urlInput.focus();
  showToast('Contoh tautan TikTok siap. Klik Ambil berkas.', 'success');
}

async function checkApiHealth(manual = false) {
  setApiStatus('checking');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    let response;
    try {
      response = await fetch('/api/health', {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data?.ok) throw new Error('Status tidak sehat');

    setApiStatus('online', data);
    if (manual) showToast('API online dan siap digunakan.', 'success');
  } catch {
    setApiStatus('offline');
    if (manual) showToast('API sedang tidak dapat dihubungi.', 'error');
  }
}

function setApiStatus(status, data = null) {
  for (const dot of [els.apiStatusDot, els.navStatusDot]) {
    dot.classList.remove('is-online', 'is-offline');
    if (status === 'online') dot.classList.add('is-online');
    if (status === 'offline') dot.classList.add('is-offline');
  }

  if (status === 'online') {
    els.apiStatusText.textContent = 'API online';
    const runtime = data?.runtime || 'Node.js';
    const region = data?.region && data.region !== 'local' ? data.region : 'lokal';
    const time = formatTimestamp(data?.timestamp);
    els.apiStatusDetail.textContent = [runtime, region, time].filter(Boolean).join(' • ');
    return;
  }

  if (status === 'offline') {
    els.apiStatusText.textContent = 'API offline';
    els.apiStatusDetail.textContent = 'Tidak dapat menghubungi /api/health. Coba periksa lagi.';
    return;
  }

  els.apiStatusText.textContent = 'Memeriksa API...';
  els.apiStatusDetail.textContent = 'Menghubungi /api/health';
}

function setBusy(busy) {
  state.busy = busy;
  els.submitBtn.disabled = busy;
  els.submitBtn.classList.toggle('is-loading', busy);
  els.submitBtn.setAttribute('aria-busy', String(busy));
  els.submitBtn.querySelector('.btn-label').textContent = busy ? 'Memproses...' : 'Ambil berkas';
}

function setMessage(text, type = 'info') {
  if (!text) {
    els.formMessage.hidden = true;
    els.formMessage.textContent = '';
    els.formMessage.className = 'form-message';
    return;
  }

  els.formMessage.hidden = false;
  els.formMessage.textContent = text;
  els.formMessage.className = `form-message is-${type}`;
}

function showFieldError(message) {
  els.inputShell.classList.add('has-error');
  els.urlInput.setAttribute('aria-invalid', 'true');
  setMessage(message, 'error');
}

function clearFieldError() {
  els.inputShell.classList.remove('has-error');
  els.urlInput.removeAttribute('aria-invalid');
}

function setNavOpen(open) {
  els.navMenu.classList.toggle('is-open', open);
  els.navToggle.setAttribute('aria-expanded', String(open));
  els.navToggle.setAttribute('aria-label', open ? 'Tutup menu navigasi' : 'Buka menu navigasi');
}

function updateDetectedPlatform() {
  const platform = detectClientPlatform(els.urlInput.value);

  if (!platform) {
    els.detectedPlatform.hidden = true;
    els.detectedPlatform.textContent = '';
    return;
  }

  els.detectedPlatform.hidden = false;
  els.detectedPlatform.textContent = `${platform} terdeteksi`;
}

function detectClientPlatform(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }

  if (!/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();

  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'YouTube';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'TikTok';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'Instagram';
  if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) {
    return 'X (Twitter)';
  }
  if (host === 'fb.watch' || host === 'fb.com' || host === 'facebook.com' || host.endsWith('.facebook.com')) {
    return 'Facebook';
  }

  return null;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

async function postJson(path, payload) {
  let response;

  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internetmu lalu coba lagi.');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Server mengembalikan respons yang tidak valid.');
  }

  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || `Permintaan gagal (${response.status}).`);
    error.code = data?.code;
    error.status = response.status;
    throw error;
  }

  return data;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();

  const ok = document.execCommand('copy');
  textarea.remove();

  if (!ok) throw new Error('Copy gagal');
}

function createDownloadIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const arrow = document.createElementNS(ns, 'path');
  arrow.setAttribute('d', 'M12 4v11m0 0l4-4m-4 4l-4-4');
  arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-width', '2');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('stroke-linejoin', 'round');

  const base = document.createElementNS(ns, 'path');
  base.setAttribute('d', 'M5 19h14');
  base.setAttribute('stroke', 'currentColor');
  base.setAttribute('stroke-width', '2');
  base.setAttribute('stroke-linecap', 'round');

  svg.append(arrow, base);
  return svg;
}

function resetResult(options = {}) {
  state.media = null;
  state.formats = null;
  state.url = '';

  els.resultCard.hidden = true;
  els.downloadActions.innerHTML = '';
  els.resultQuality.textContent = '';
  els.resultNote.hidden = true;

  resetFormatAvailability();
  renderQualityOptions();

  if (!options.keepMessage) setMessage('', 'info');
}

function formatDuration(seconds) {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return '';

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  try {
    return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return date.toISOString();
  }
}

function showToast(message, type = 'success') {
  clearTimeout(state.toastTimer);

  els.toast.textContent = message;
  els.toast.className = `toast is-visible is-${type}`;
  els.toast.hidden = false;

  state.toastTimer = setTimeout(() => {
    els.toast.classList.remove('is-visible');
    setTimeout(() => {
      if (!els.toast.classList.contains('is-visible')) els.toast.hidden = true;
    }, 250);
  }, 3200);
}
