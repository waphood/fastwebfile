/* ──────────────────────────────────────────────────
   FastWebFile — app.js
   Multi-file + bundle mode + short IDs
   ────────────────────────────────────────────────── */

const MAX_SIZE  = 500 * 1024 * 1024;
const MAX_FILES = 20;

let selectedFiles  = [];
let selectedExpiry = 'once';
let bundleMode     = false;

// DOM
const dropzone       = document.getElementById('dropzone');
const fileInput      = document.getElementById('fileInput');
const fileListEl     = document.getElementById('fileList');
const uploadBtn      = document.getElementById('uploadBtn');
const uploadBtnText  = document.getElementById('uploadBtnText');
const progressBlock  = document.getElementById('progressBlock');
const progressBar    = document.getElementById('progressBar');
const progressLabel  = document.getElementById('progressLabel');
const progressSpeed  = document.getElementById('progressSpeed');
const btnPauseResume = document.getElementById('btnPauseResume');
const uploadCard     = document.getElementById('uploadCard');
const resultCard     = document.getElementById('resultCard');
const resultList     = document.getElementById('resultList');
const resultsCount   = document.getElementById('resultsCount');
const resultsPwdBadge = document.getElementById('resultsPwdBadge');
const resultsNoteBadge = document.getElementById('resultsNoteBadge');
const bundleToggle   = document.getElementById('bundleToggle');
const bundleHint     = document.getElementById('bundleHint');
const pwdPillBtn     = document.getElementById('pwdPillBtn');
const pwdPillLabel   = document.getElementById('pwdPillLabel');
const pwdStatusDot   = document.getElementById('pwdStatusDot');
const pwdDrawer      = document.getElementById('pwdDrawer');
const passwordInput  = document.getElementById('passwordInput');
const passwordToggle = document.getElementById('passwordToggle');
const passwordClear  = document.getElementById('passwordClear');

// Note/Description elements
const notePillBtn    = document.getElementById('notePillBtn');
const notePillLabel  = document.getElementById('notePillLabel');
const noteStatusDot  = document.getElementById('noteStatusDot');
const noteDrawer     = document.getElementById('noteDrawer');
const noteInput      = document.getElementById('noteInput');
const noteClear      = document.getElementById('noteClear');

// Compression elements
const compressPillBtn = document.getElementById('compressPillBtn');
const compressTag     = document.getElementById('compressTag');
let compressPhotos    = localStorage.getItem('fwf_compress_photos') !== 'false'; // default true

// Quick Receive PIN elements
const pinInputs  = document.querySelectorAll('.pin-digit-input');
const btnReceive = document.getElementById('btnReceive');
const receiveMsg = document.getElementById('receiveMsg');

let pwdVisible = false;

// ── Compression Pill Toggle ────────────────────────────────────────────────
function syncCompressUI() {
  if (compressPhotos) {
    compressPillBtn.classList.add('is-active');
    compressTag.textContent = 'ВКЛ';
  } else {
    compressPillBtn.classList.remove('is-active');
    compressTag.textContent = 'ВЫКЛ';
  }
}
syncCompressUI();

compressPillBtn.addEventListener('click', () => {
  compressPhotos = !compressPhotos;
  localStorage.setItem('fwf_compress_photos', compressPhotos ? 'true' : 'false');
  syncCompressUI();
  showToast(compressPhotos ? 'Сжатие фото включено' : 'Сжатие фото отключено (оригиналы 1:1)');
});

// ── Metadata Shredder (EXIF/GPS) Toggle ────────────────────────────────────
const shredPillBtn = document.getElementById('shredPillBtn');
const shredTag     = document.getElementById('shredTag');
let shredExif      = localStorage.getItem('fwf_shred_exif') !== 'false'; // default true

function syncShredUI() {
  if (shredPillBtn && shredTag) {
    if (shredExif) {
      shredPillBtn.classList.add('is-active');
      shredTag.textContent = 'ВКЛ';
    } else {
      shredPillBtn.classList.remove('is-active');
      shredTag.textContent = 'ВЫКЛ';
    }
  }
}
syncShredUI();

if (shredPillBtn) {
  shredPillBtn.addEventListener('click', () => {
    shredExif = !shredExif;
    localStorage.setItem('fwf_shred_exif', shredExif ? 'true' : 'false');
    syncShredUI();
    showToast(shredExif ? 'Шредер EXIF включен (очистка геопозиции и камеры)' : 'Шредер EXIF выключен');
  });
}

// ── Drop Folder Modal ────────────────────────────────────────────────────────
const openDropModalBtn    = document.getElementById('openDropModalBtn');
const closeDropModalBtn   = document.getElementById('closeDropModalBtn');
const dropModal           = document.getElementById('dropModal');
const dropTitleInput      = document.getElementById('dropTitleInput');
const dropExpiryTabs      = document.getElementById('dropExpiryTabs');
const btnSubmitCreateDrop = document.getElementById('btnSubmitCreateDrop');
let selectedDropExpiry    = '3days';

if (openDropModalBtn) {
  openDropModalBtn.addEventListener('click', () => {
    dropModal.removeAttribute('hidden');
    dropTitleInput.focus();
    setTimeout(() => {
      if (window.initIosSegmentedControl && dropExpiryTabs) {
        window.initIosSegmentedControl(dropExpiryTabs);
        if (dropExpiryTabs._updateThumb) dropExpiryTabs._updateThumb();
      }
    }, 60);
  });
}
if (closeDropModalBtn) {
  closeDropModalBtn.addEventListener('click', () => {
    dropModal.setAttribute('hidden', '');
  });
}
if (dropModal) {
  dropModal.addEventListener('click', e => {
    if (e.target === dropModal) dropModal.setAttribute('hidden', '');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !dropModal.hasAttribute('hidden')) {
      dropModal.setAttribute('hidden', '');
    }
  });
  if (window.location.search.includes('drop=1')) {
    dropModal.removeAttribute('hidden');
    setTimeout(() => {
      if (dropTitleInput) dropTitleInput.focus();
      if (window.initIosSegmentedControl && dropExpiryTabs) {
        window.initIosSegmentedControl(dropExpiryTabs);
        if (dropExpiryTabs._updateThumb) dropExpiryTabs._updateThumb();
      }
    }, 100);
  }
}
if (dropExpiryTabs) {
  dropExpiryTabs.addEventListener('click', e => {
    const tab = e.target.closest('.expiry-tab');
    if (!tab) return;
    dropExpiryTabs.querySelectorAll('.expiry-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    selectedDropExpiry = tab.dataset.val || '3days';
  });
}
if (btnSubmitCreateDrop) {
  btnSubmitCreateDrop.addEventListener('click', async () => {
    btnSubmitCreateDrop.disabled = true;
    btnSubmitCreateDrop.innerHTML = '<span class="spinner"></span> Создание...';
    try {
      const title = dropTitleInput.value.trim() || 'Drop-папка';
      const res = await fetch('/api/drop/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, expiry: selectedDropExpiry })
      });
      const data = await res.json();
      if (res.ok && data.drop) {
        window.location.href = data.drop.manageUrl;
      } else {
        showToast('Ошибка: ' + (data.error || 'Не удалось создать папку'));
        btnSubmitCreateDrop.disabled = false;
        btnSubmitCreateDrop.innerHTML = '<span>Создать Drop-папку</span>';
      }
    } catch {
      showToast('Ошибка соединения');
      btnSubmitCreateDrop.disabled = false;
      btnSubmitCreateDrop.innerHTML = '<span>Создать Drop-папку</span>';
    }
  });
}

// ── Password subtle drawer & pill ──────────────────────────────────────────
function updatePwdPillState() {
  const hasVal = passwordInput.value.trim().length > 0;
  if (hasVal) {
    pwdPillBtn.classList.add('has-val');
    pwdStatusDot.removeAttribute('hidden');
    pwdPillLabel.textContent = 'Пароль задан';
  } else {
    pwdPillBtn.classList.remove('has-val');
    pwdStatusDot.setAttribute('hidden', '');
    pwdPillLabel.textContent = 'Пароль';
  }
}

pwdPillBtn.addEventListener('click', () => {
  const isHidden = pwdDrawer.hasAttribute('hidden');
  if (isHidden) {
    pwdDrawer.removeAttribute('hidden');
    pwdPillBtn.classList.add('open');
    passwordInput.focus();
  } else {
    pwdDrawer.setAttribute('hidden', '');
    pwdPillBtn.classList.remove('open');
  }
});

passwordInput.addEventListener('input', updatePwdPillState);

// ── Password toggle (show/hide masked text) ────────────────────────────────
passwordToggle.addEventListener('click', () => {
  pwdVisible = !pwdVisible;
  const sec = pwdVisible ? 'none' : 'disc';
  passwordInput.style.webkitTextSecurity = sec;
  passwordInput.style.textSecurity = sec;
  passwordToggle.querySelector('svg').innerHTML = pwdVisible
    ? `<path d="M1 1l14 14M6.5 6.6A2 2 0 0010 9.4M3.5 3.8A6 6 0 001.5 8c1.2 2.3 3.7 4 6.5 4a6.5 6.5 0 003.3-.9M6 4.1A6.5 6.5 0 0114.5 8a6.3 6.3 0 01-1.6 2.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`
    : `<ellipse cx="8" cy="8" rx="6" ry="4" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="1.8" stroke="currentColor" stroke-width="1.2"/>`;
});

// ── Password clear button ──────────────────────────────────────────────────
passwordClear.addEventListener('click', () => {
  passwordInput.value = '';
  updatePwdPillState();
  pwdDrawer.setAttribute('hidden', '');
  pwdPillBtn.classList.remove('open');
  pwdVisible = false;
  passwordInput.style.webkitTextSecurity = 'disc';
  passwordInput.style.textSecurity = 'disc';
  passwordToggle.querySelector('svg').innerHTML = `<ellipse cx="8" cy="8" rx="6" ry="4" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="1.8" stroke="currentColor" stroke-width="1.2"/>`;
});

// ── Note / Description drawer & pill ──────────────────────────────────────
function updateNotePillState() {
  const hasVal = noteInput.value.trim().length > 0;
  if (hasVal) {
    notePillBtn.classList.add('has-val');
    noteStatusDot.removeAttribute('hidden');
    notePillLabel.textContent = 'Описание есть';
  } else {
    notePillBtn.classList.remove('has-val');
    noteStatusDot.setAttribute('hidden', '');
    notePillLabel.textContent = 'Описание';
  }
}

notePillBtn.addEventListener('click', () => {
  const isHidden = noteDrawer.hasAttribute('hidden');
  if (isHidden) {
    noteDrawer.removeAttribute('hidden');
    notePillBtn.classList.add('open');
    noteInput.focus();
  } else {
    noteDrawer.setAttribute('hidden', '');
    notePillBtn.classList.remove('open');
  }
});

noteInput.addEventListener('input', updateNotePillState);

noteClear.addEventListener('click', () => {
  noteInput.value = '';
  updateNotePillState();
  noteDrawer.setAttribute('hidden', '');
  notePillBtn.classList.remove('open');
});

// ── Quick Receive PIN inputs (5 alphanumeric characters) ───────────────────
pinInputs.forEach((inp, idx) => {
  inp.addEventListener('input', () => {
    const val = inp.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    inp.value = val.slice(0, 1);
    if (inp.value) {
      inp.classList.add('filled');
      if (idx < pinInputs.length - 1) {
        pinInputs[idx + 1].focus();
      } else {
        triggerPinLookup();
      }
    } else {
      inp.classList.remove('filled');
    }
  });

  inp.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !inp.value && idx > 0) {
      pinInputs[idx - 1].focus();
    } else if (e.key === 'Enter') {
      triggerPinLookup();
    }
  });

  inp.addEventListener('paste', e => {
    e.preventDefault();
    const pasteText = (e.clipboardData || window.clipboardData).getData('text').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5);
    if (!pasteText) return;
    for (let i = 0; i < 5; i++) {
      if (pinInputs[i]) {
        pinInputs[i].value = pasteText[i] || '';
        if (pasteText[i]) pinInputs[i].classList.add('filled');
      }
    }
    if (pasteText.length === 5) {
      triggerPinLookup();
    } else if (pinInputs[pasteText.length]) {
      pinInputs[pasteText.length].focus();
    }
  });
});

btnReceive.addEventListener('click', triggerPinLookup);

async function triggerPinLookup() {
  const code = Array.from(pinInputs).map(i => i.value.trim().toUpperCase()).join('');
  if (code.length !== 5) {
    showReceiveMsg('Введи 5 знаков кода (буквы и цифры)', 'error');
    const emptyIdx = Array.from(pinInputs).findIndex(i => !i.value.trim());
    if (emptyIdx >= 0) pinInputs[emptyIdx].focus();
    return;
  }

  showReceiveMsg('Поиск файла...', 'loading');
  btnReceive.disabled = true;

  try {
    const res = await fetch(`/api/pin/${code}`);
    const data = await res.json();
    if (res.ok && data.url) {
      showReceiveMsg('Файл найден! Открываем...', 'loading');
      window.location.href = data.url;
    } else {
      showReceiveMsg(data.error || 'Код не найден или истёк', 'error');
      pinInputs.forEach(i => i.classList.remove('filled'));
      btnReceive.disabled = false;
    }
  } catch (err) {
    showReceiveMsg('Сетевая ошибка при поиске', 'error');
    btnReceive.disabled = false;
  }
}

function showReceiveMsg(text, type) {
  receiveMsg.textContent = text;
  receiveMsg.className = `receive-msg ${type}`;
  receiveMsg.removeAttribute('hidden');
}

if (new URLSearchParams(window.location.search).get('pin_err')) {
  showToast('Код получения не найден или срок действия истёк');
  window.history.replaceState({}, '', '/');
}

// ── Expiry tabs ──────────────────────────────────────
document.getElementById('expiryTabs').addEventListener('click', e => {
  const btn = e.target.closest('.expiry-tab');
  if (!btn) return;
  document.querySelectorAll('.expiry-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedExpiry = btn.dataset.value;
});

// ── Bundle toggle ────────────────────────────────────
bundleToggle.addEventListener('change', () => {
  bundleMode = bundleToggle.checked;
  bundleHint.textContent = bundleMode
    ? 'Все файлы — одна ссылка'
    : 'Каждый файл — своя ссылка';
  syncUploadBtn();
});

// ── Drag & drop & Folder Support ──────────────────────
dropzone.addEventListener('click', e => {
  if (!e.target.closest('.drop-input')) fileInput.click();
});
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', e => { if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag-over'); });

async function getFilesFromDataTransfer(dataTransfer) {
  const items = dataTransfer.items;
  if (!items || !items.length) {
    return Array.from(dataTransfer.files || []);
  }

  const filePromises = [];
  let foundDirectory = false;

  async function traverseEntry(entry) {
    if (entry.isFile) {
      return new Promise(res => {
        entry.file(f => res([f]), () => res([]));
      });
    } else if (entry.isDirectory) {
      foundDirectory = true;
      const dirReader = entry.createReader();
      const readAll = async () => {
        return new Promise(res => {
          const entries = [];
          const read = () => {
            dirReader.readEntries(results => {
              if (!results || !results.length) return res(entries);
              entries.push(...results);
              read();
            }, () => res(entries));
          };
          read();
        });
      };
      const entries = await readAll();
      const subResults = [];
      for (const sub of entries) {
        const subFiles = await traverseEntry(sub);
        subResults.push(...subFiles);
      }
      return subResults;
    }
    return [];
  }

  const entriesToProcess = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.webkitGetAsEntry) {
      const entry = item.webkitGetAsEntry();
      if (entry) entriesToProcess.push(entry);
    }
  }

  if (entriesToProcess.length > 0) {
    const results = [];
    for (const entry of entriesToProcess) {
      const files = await traverseEntry(entry);
      results.push(...files);
    }
    if (foundDirectory && results.length > 1) {
      bundleToggle.checked = true;
      bundleMode = true;
      bundleHint.textContent = 'Все файлы — одна ссылка';
      showToast(`Папка загружена (${results.length} ${pluralFiles(results.length)})`);
    }
    return results;
  }

  return Array.from(dataTransfer.files || []);
}

dropzone.addEventListener('drop', async e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const files = await getFilesFromDataTransfer(e.dataTransfer);
  if (files.length) addFiles(files);
});
fileInput.addEventListener('change', () => { addFiles(Array.from(fileInput.files)); fileInput.value = ''; });

// ── Ctrl + V / Clipboard Paste ────────────────────────
window.addEventListener('paste', e => {
  if (uploadCard.style.display === 'none') return; // on result page
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  const isInput = activeTag === 'input' || activeTag === 'textarea';

  const items = e.clipboardData?.items;
  if (!items) return;

  const pastedFiles = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) {
        // Provide friendly screenshot name if generic
        if (file.name === 'image.png' || !file.name) {
          const now = new Date();
          const dStr = now.toISOString().slice(0,10);
          const tStr = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;
          const renamed = new File([file], `screenshot-${dStr}-${tStr}.png`, { type: file.type });
          pastedFiles.push(renamed);
        } else {
          pastedFiles.push(file);
        }
      }
    }
  }

  if (pastedFiles.length > 0) {
    e.preventDefault();
    addFiles(pastedFiles);
    showToast(pastedFiles.length === 1 ? 'Файл вставлен из буфера' : `Вставлено ${pastedFiles.length} ${pluralFiles(pastedFiles.length)} из буфера`);
  }
});

// ── File management ──────────────────────────────────
function addFiles(incoming) {
  for (const f of incoming) {
    if (selectedFiles.length >= MAX_FILES) { showToast(`Максимум ${MAX_FILES} файлов`); break; }
    if (f.size > MAX_SIZE) { showToast(`«${f.name}» слишком большой`); continue; }
    if (selectedFiles.some(x => x.name === f.name && x.size === f.size)) continue;
    selectedFiles.push(f);
  }
  renderFileList();
  syncUploadBtn();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
  syncUploadBtn();
}

function renderFileList() {
  fileListEl.innerHTML = '';
  selectedFiles.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-item-icon">${getFileIcon(f.name)}</div>
      <div class="file-item-info">
        <div class="file-item-name" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="file-item-size">${fmtSize(f.size)}</div>
      </div>
      <button class="file-item-remove" data-idx="${i}" title="Убрать">
        <svg viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>`;
    fileListEl.appendChild(item);
  });
  fileListEl.querySelectorAll('.file-item-remove').forEach(btn =>
    btn.addEventListener('click', () => removeFile(+btn.dataset.idx))
  );
}

function syncUploadBtn() {
  const n = selectedFiles.length;
  uploadBtn.disabled = n === 0;
  if (n === 0) { uploadBtnText.textContent = 'Загрузить'; return; }
  if (bundleMode && n > 1) {
    uploadBtnText.textContent = `Загрузить как пакет (${n} ${pluralFiles(n)})`;
  } else {
    uploadBtnText.textContent = `Загрузить ${n} ${pluralFiles(n)}`;
  }
}

// ── Image Compression (Canvas) ────────────────────────
async function compressImageFile(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return file;
  }
  // Skip small images (< 150 KB)
  if (file.size < 150 * 1024) return file;

  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const MAX_DIM = 2048;

      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(blob => {
        if (!blob || blob.size >= file.size) {
          resolve(file);
        } else {
          const compName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          const compressed = new File([blob], compName, { type: 'image/jpeg', lastModified: Date.now() });
          resolve(compressed);
        }
      }, 'image/jpeg', 0.82);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

// ── Metadata Shredder (Canvas re-draw purges EXIF, GPS & camera data) ───────
async function stripImageMetadata(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return; }
          const stripped = new File([blob], file.name, { type: mimeType, lastModified: Date.now() });
          resolve(stripped);
        }, mimeType, 0.95);
      } catch {
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

// ── Upload ───────────────────────────────────────────
uploadBtn.addEventListener('click', doUpload);

async function doUpload() {
  if (!selectedFiles.length) return;
  uploadBtn.disabled = true;

  let filesToUpload = selectedFiles;
  if (compressPhotos) {
    const imageFiles = selectedFiles.filter(f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) && f.size >= 150 * 1024);
    if (imageFiles.length > 0) {
      uploadBtnText.textContent = 'Сжатие фото...';
      let beforeSize = 0;
      let afterSize = 0;
      let compressedCount = 0;

      const processed = [];
      for (const f of selectedFiles) {
        beforeSize += f.size;
        const res = await compressImageFile(f);
        afterSize += res.size;
        if (res !== f && res.size < f.size) {
          compressedCount++;
        }
        processed.push(res);
      }
      filesToUpload = processed;

      if (compressedCount > 0 && beforeSize > afterSize) {
        const saved = beforeSize - afterSize;
        const pct = Math.round((saved / beforeSize) * 100);
        showToast(`Сжато ${compressedCount} фото · экономия ${fmtSize(saved)} (-${pct}%)`);
      }
    }
  }

  // Shred EXIF / metadata if enabled (for images that weren't re-encoded)
  if (shredExif) {
    const images = filesToUpload.filter(f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type));
    if (images.length > 0) {
      const strippedList = [];
      for (const f of filesToUpload) {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
          strippedList.push(await stripImageMetadata(f));
        } else {
          strippedList.push(f);
        }
      }
      filesToUpload = strippedList;
    }
  }

  // Smart Resume: Chunked upload for large single files (>= 15 MB)
  if (filesToUpload.length === 1 && filesToUpload[0].size >= 15 * 1024 * 1024) {
    await uploadChunked(filesToUpload[0]);
    return;
  }

  uploadBtnText.textContent = 'Загрузка...';
  progressBlock.removeAttribute('hidden');
  progressBar.style.width = '0%';
  progressLabel.textContent = '0%';
  progressSpeed.textContent = '';
  btnPauseResume.setAttribute('hidden', '');

  const fd = new FormData();
  filesToUpload.forEach(f => fd.append('files', f));
  fd.append('expiry', selectedExpiry);
  fd.append('bundle', bundleMode && filesToUpload.length > 1 ? 'true' : 'false');
  const pwd = passwordInput.value.trim();
  if (pwd) fd.append('password', pwd);
  const noteVal = noteInput.value.trim();
  if (noteVal) fd.append('note', noteVal);

  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    const startTime = performance.now();
    let lastLoaded = 0;
    let lastTime = startTime;

    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return;
      const p = Math.round(e.loaded / e.total * 92);
      progressBar.style.width = p + '%';
      progressLabel.textContent = p + '%';

      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      if (dt > 0.3) {
        const speed = (e.loaded - lastLoaded) / dt;
        progressSpeed.textContent = fmtSize(speed) + '/с';
        lastLoaded = e.loaded;
        lastTime = now;
      }
    };
    xhr.onload = () => {
      progressBar.style.width = '100%';
      progressLabel.textContent = '100%';
      progressSpeed.textContent = '';
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        setTimeout(() => showResults(data), 280);
      } else {
        let msg = 'Ошибка';
        try { msg = JSON.parse(xhr.responseText).error; } catch {}
        showToast('Ошибка: ' + msg);
        resetUpload();
      }
      resolve();
    };
    xhr.onerror = () => {
      showToast('Сетевая ошибка');
      resetUpload();
      resolve();
    };
    xhr.send(fd);
  });
}

// ── Smart Resume Chunked Upload ─────────────────────────
async function uploadChunked(file) {
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const pwd = passwordInput.value.trim();
  const noteVal = noteInput.value.trim();

  uploadBtnText.textContent = 'Инициализация...';
  progressBlock.removeAttribute('hidden');
  progressBar.style.width = '0%';
  progressLabel.textContent = '0%';
  progressSpeed.textContent = '';
  btnPauseResume.removeAttribute('hidden');
  btnPauseResume.textContent = 'Пауза';

  let isPaused = false;
  let resumeFn = null;
  btnPauseResume.onclick = () => {
    isPaused = !isPaused;
    if (isPaused) {
      btnPauseResume.textContent = 'Продолжить';
      progressSpeed.textContent = 'Пауза';
    } else {
      btnPauseResume.textContent = 'Пауза';
      if (resumeFn) {
        resumeFn();
        resumeFn = null;
      }
    }
  };

  try {
    const initRes = await fetch('/api/upload/chunk-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        totalChunks,
        totalSize: file.size,
        expiry: selectedExpiry,
        password: pwd,
        note: noteVal
      })
    });
    if (!initRes.ok) {
      const errData = await initRes.json().catch(() => ({}));
      throw new Error(errData.error || 'Ошибка инициализации');
    }
    const { uploadId } = await initRes.json();

    uploadBtnText.textContent = 'Загрузка...';

    for (let i = 0; i < totalChunks; i++) {
      if (isPaused) {
        await new Promise(r => { resumeFn = r; });
      }

      const start = i * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      const chunkBlob = file.slice(start, end);

      const chunkFd = new FormData();
      chunkFd.append('uploadId', uploadId);
      chunkFd.append('chunkIndex', i);
      chunkFd.append('chunk', chunkBlob, `chunk_${i}`);

      const t0 = performance.now();
      let ok = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (isPaused) {
          await new Promise(r => { resumeFn = r; });
        }
        try {
          const res = await fetch('/api/upload/chunk', { method: 'POST', body: chunkFd });
          if (res.ok) { ok = true; break; }
        } catch {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      if (!ok) throw new Error(`Сбой передачи блока ${i + 1}/${totalChunks}`);

      const dt = (performance.now() - t0) / 1000;
      if (dt > 0.05 && !isPaused) {
        const speed = chunkBlob.size / dt;
        progressSpeed.textContent = fmtSize(speed) + '/с';
      }

      const pct = Math.round(((i + 1) / totalChunks) * 94);
      progressBar.style.width = pct + '%';
      progressLabel.textContent = `${pct}% (${i + 1}/${totalChunks})`;
    }

    uploadBtnText.textContent = 'Сборка файла...';
    progressSpeed.textContent = 'Сборка...';

    const compRes = await fetch('/api/upload/chunk-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId })
    });
    const compData = await compRes.json();
    if (!compRes.ok) throw new Error(compData.error || 'Ошибка сборки');

    progressBar.style.width = '100%';
    progressLabel.textContent = '100%';
    btnPauseResume.setAttribute('hidden', '');
    progressSpeed.textContent = '';
    btnPauseResume.onclick = null;

    setTimeout(() => showResults(compData), 280);
  } catch (err) {
    showToast('Ошибка: ' + err.message);
    resetUpload();
  }
}

function resetUpload() {
  progressBlock.setAttribute('hidden', '');
  progressBar.style.width = '0%';
  progressSpeed.textContent = '';
  btnPauseResume.setAttribute('hidden', '');
  btnPauseResume.onclick = null;
  syncUploadBtn();
}

// ── Results ──────────────────────────────────────────
const expiryLabel = { once: '1 скачивание', '1day': '1 день', '3days': '3 дня' };

function showResults(data) {
  resultList.innerHTML = '';

  const hasPwd = data.hasPassword || (data.bundle && data.bundle.hasPassword) || (data.files && data.files[0] && data.files[0].hasPassword);
  if (hasPwd) {
    resultsPwdBadge.removeAttribute('hidden');
  } else {
    resultsPwdBadge.setAttribute('hidden', '');
  }

  const hasNote = (data.bundle && data.bundle.description) || (data.description) || (data.files && data.files[0] && data.files[0].description);
  if (hasNote) {
    resultsNoteBadge.removeAttribute('hidden');
  } else {
    resultsNoteBadge.setAttribute('hidden', '');
  }

  if (data.mode === 'bundle') {
    const b = data.bundle;
    resultsCount.textContent = `пакет · ${b.fileCount} ${pluralFiles(b.fileCount)}`;
    resultsExpiry.textContent = expiryLabel[b.expiry] || b.expiry;
    renderBundleResult(b);
  } else {
    const files = data.files;
    resultsCount.textContent = `${files.length} ${pluralFiles(files.length)}`;
    resultsExpiry.textContent = expiryLabel[files[0]?.expiry] || '';
    files.forEach((f, i) => renderFileResult(f, i));
  }

  uploadCard.style.display = 'none';
  resultCard.removeAttribute('hidden');
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  selectedFiles = [];
  renderFileList();
  syncUploadBtn();
  progressBlock.setAttribute('hidden', '');
  progressBar.style.width = '0%';
  passwordInput.value = '';
  updatePwdPillState();
  pwdDrawer.setAttribute('hidden', '');
  pwdPillBtn.classList.remove('open');
  pwdVisible = false;
  passwordInput.style.webkitTextSecurity = 'disc';
  passwordInput.style.textSecurity = 'disc';

  noteInput.value = '';
  updateNotePillState();
  noteDrawer.setAttribute('hidden', '');
  notePillBtn.classList.remove('open');
}

function renderBundleResult(b) {
  const row = document.createElement('div');
  row.className = 'result-item';

  const fileNames = b.files.map(f =>
    `<div class="bundle-file-entry">${getFileIcon(f.originalName)} <span>${esc(f.originalName)}</span> <span class="result-file-size">${fmtSize(f.size)}</span></div>`
  ).join('');

  const noteHtml = b.description
    ? `<div class="result-note-box"><svg viewBox="0 0 16 16" fill="none"><path d="M3 3h10M3 7h10M3 11h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><span>${esc(b.description)}</span></div>`
    : '';

  const pinHtml = b.pin ? `
    <div class="pin-share-box">
      <div class="pin-share-info">
        <span class="pin-share-label">Код получения</span>
        <span class="pin-share-code">${esc(b.pin)}</span>
      </div>
      <button class="btn-copy-pin" data-pin="${esc(b.pin)}">
        <svg viewBox="0 0 12 12" fill="none"><rect x="1.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.5V2.5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Копировать код
      </button>
    </div>` : '';

  row.innerHTML = `
    <div class="result-item-left">
      <div class="result-file-row" style="margin-bottom:10px;">
        <div class="result-file-icon">${ICONS.package}</div>
        <div class="file-item-name" style="flex:1">Пакет файлов</div>
        <span class="result-file-size">${fmtSize(b.totalSize)}</span>
      </div>
      <div class="bundle-files-list">${fileNames}</div>
      ${noteHtml}
      ${pinHtml}
      <div class="result-link-row" style="margin-top:10px;">
        <input class="result-link-input" type="text" value="${esc(b.url)}" readonly />
        <button class="btn-copy" data-url="${esc(b.url)}">
          <svg viewBox="0 0 12 12" fill="none"><rect x="1.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.5V2.5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          Копировать
        </button>
        <button class="btn-copy btn-share-native" data-url="${esc(b.url)}" title="Поделиться">
          <svg viewBox="0 0 16 16" fill="none"><path d="M4 8v5a1 1 0 001 1h6a1 1 0 001-1V8M8 2v8M5 5l3-3 3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Поделиться
        </button>
        <a class="btn-copy" href="/api/bundle/${b.id}/zip" download="bundle-${b.id}.zip" style="text-decoration:none;" title="Скачать ZIP архив">
          <svg viewBox="0 0 16 16" fill="none"><path d="M4 3h8v9a2 2 0 01-2 2H6a2 2 0 01-2-2V3z" stroke="currentColor" stroke-width="1.3"/><path d="M8 3v5M6 6h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          ZIP
        </a>
      </div>
    </div>
    <div class="result-item-qr">
      <div class="qr-box">
        <img src="${b.qrCode}" alt="QR" />
        <a class="qr-dl" href="${b.qrCode}" download="fwf-bundle-qr.png">скачать QR</a>
      </div>
    </div>`;

  resultList.appendChild(row);
  row.querySelectorAll('.btn-copy:not(.btn-share-native)').forEach(btn =>
    btn.addEventListener('click', () => copyUrl(btn.dataset.url, btn))
  );
  row.querySelectorAll('.btn-share-native').forEach(btn =>
    btn.addEventListener('click', () => handleNativeShare(btn.dataset.url, 'Пакет файлов', btn))
  );
  row.querySelectorAll('.btn-copy-pin').forEach(btn =>
    btn.addEventListener('click', () => copyPin(btn.dataset.pin, btn))
  );
}

function renderFileResult(f, i) {
  const row = document.createElement('div');
  row.className = 'result-item';
  row.style.animationDelay = (i * 0.04) + 's';

  const noteHtml = f.description
    ? `<div class="result-note-box"><svg viewBox="0 0 16 16" fill="none"><path d="M3 3h10M3 7h10M3 11h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><span>${esc(f.description)}</span></div>`
    : '';

  const pinHtml = f.pin ? `
    <div class="pin-share-box">
      <div class="pin-share-info">
        <span class="pin-share-label">Код получения</span>
        <span class="pin-share-code">${esc(f.pin)}</span>
      </div>
      <button class="btn-copy-pin" data-pin="${esc(f.pin)}">
        <svg viewBox="0 0 12 12" fill="none"><rect x="1.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.5V2.5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Копировать код
      </button>
    </div>` : '';

  row.innerHTML = `
    <div class="result-item-left">
      <div class="result-file-row">
        <div class="result-file-icon">${getFileIcon(f.originalName)}</div>
        <div class="file-item-name" style="flex:1;min-width:0" title="${esc(f.originalName)}">${esc(f.originalName)}</div>
        <span class="result-file-size">${fmtSize(f.size)}</span>
      </div>
      ${noteHtml}
      ${pinHtml}
      <div class="result-link-row" style="margin-top:10px;">
        <input class="result-link-input" type="text" value="${esc(f.downloadUrl)}" readonly />
        <button class="btn-copy" data-url="${esc(f.downloadUrl)}">
          <svg viewBox="0 0 12 12" fill="none"><rect x="1.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.5V2.5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          Копировать
        </button>
        <button class="btn-copy btn-share-native" data-url="${esc(f.downloadUrl)}" title="Поделиться">
          <svg viewBox="0 0 16 16" fill="none"><path d="M4 8v5a1 1 0 001 1h6a1 1 0 001-1V8M8 2v8M5 5l3-3 3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Поделиться
        </button>
      </div>
    </div>
    <div class="result-item-qr">
      <div class="qr-box">
        <img src="${f.qrCode}" alt="QR" />
        <a class="qr-dl" href="${f.qrCode}" download="fwf-qr-${i+1}.png">скачать QR</a>
      </div>
    </div>`;
  resultList.appendChild(row);
  row.querySelectorAll('.btn-copy:not(.btn-share-native)').forEach(btn =>
    btn.addEventListener('click', () => copyUrl(btn.dataset.url, btn))
  );
  row.querySelectorAll('.btn-share-native').forEach(btn =>
    btn.addEventListener('click', () => handleNativeShare(btn.dataset.url, f.originalName, btn))
  );
  row.querySelectorAll('.btn-copy-pin').forEach(btn =>
    btn.addEventListener('click', () => copyPin(btn.dataset.pin, btn))
  );
}

async function handleNativeShare(url, title, btn) {
  if (navigator.share) {
    try {
      await navigator.share({
        title: title || 'FastWebFile',
        text: `Файл «${title || 'FastWebFile'}» доступен для скачивания:`,
        url: url
      });
      return;
    } catch (e) {
      if (e.name !== 'AbortError') copyUrl(url, btn);
      return;
    }
  }
  copyUrl(url, btn);
}

function copyPin(pin, btn) {
  navigator.clipboard.writeText(pin).then(() => {
    btn.classList.add('ok');
    btn.innerHTML = `<svg viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Скопирован`;
    showToast(`Код ${pin} скопирован`);
    setTimeout(() => {
      btn.classList.remove('ok');
      btn.innerHTML = `<svg viewBox="0 0 12 12" fill="none"><rect x="1.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.5V2.5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>Копировать код`;
    }, 2200);
  });
}

// ── Copy all ──────────────────────────────────────────
document.getElementById('copyAllBtn').addEventListener('click', () => {
  const links = Array.from(resultList.querySelectorAll('.result-link-input')).map(i => i.value);
  navigator.clipboard.writeText(links.join('\n')).then(() => {
    showToast('Все ссылки скопированы');
  });
});

// ── New upload ────────────────────────────────────────
document.getElementById('newUploadBtn').addEventListener('click', () => {
  resultCard.setAttribute('hidden', '');
  uploadCard.style.display = '';
  uploadCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ── Copy ─────────────────────────────────────────────
async function copyUrl(url, btn) {
  try { await navigator.clipboard.writeText(url); }
  catch {
    const tmp = Object.assign(document.createElement('input'), { value: url });
    document.body.appendChild(tmp); tmp.select(); document.execCommand('copy'); document.body.removeChild(tmp);
  }
  btn.classList.add('ok');
  btn.innerHTML = `<svg viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Скопировано`;
  showToast('Ссылка скопирована');
  setTimeout(() => {
    btn.classList.remove('ok');
    btn.innerHTML = `<svg viewBox="0 0 12 12" fill="none"><rect x="1.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.5V2.5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>Копировать`;
  }, 2200);
}

// ── Utils ─────────────────────────────────────────────
function fmtSize(b) {
  if (b < 1024) return b + ' Б';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' КБ';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' МБ';
  return (b / 1073741824).toFixed(2) + ' ГБ';
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function pluralFiles(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'файл';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'файла';
  return 'файлов';
}
// ── SVG icon map ─────────────────────────────────────
const ICONS = {
  pdf:     `<svg viewBox="0 0 20 20" fill="none"><rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M7 6h6M7 10h6M7 14h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  doc:     `<svg viewBox="0 0 20 20" fill="none"><rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M7 7h6M7 10.5h6M7 14h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  sheet:   `<svg viewBox="0 0 20 20" fill="none"><rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M3 7h14M10 7v11" stroke="currentColor" stroke-width="1.4"/><path d="M7 11h3m4 0H10m0 4H7m6 0h-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  slides:  `<svg viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M10 15v3M7 18h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  zip:     `<svg viewBox="0 0 20 20" fill="none"><path d="M4 4h12v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" stroke="currentColor" stroke-width="1.4"/><path d="M10 4v5M8 7h4M9 10h2v2h-2v2h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  video:   `<svg viewBox="0 0 20 20" fill="none"><rect x="2" y="5" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M14 8l4-2v8l-4-2V8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  audio:   `<svg viewBox="0 0 20 20" fill="none"><circle cx="5" cy="15" r="2.5" stroke="currentColor" stroke-width="1.4"/><circle cx="15" cy="13" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M7.5 15V7l10-2v8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  image:   `<svg viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="7.5" cy="7.5" r="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 14l4-4 3 3 2-2 5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  design:  `<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M10 3v3M10 14v3M3 10h3M14 10h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  code:    `<svg viewBox="0 0 20 20" fill="none"><path d="M6 8l-4 4 4 4M14 8l4 4-4 4M11 5l-2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  python:  `<svg viewBox="0 0 20 20" fill="none"><path d="M10 2c-4 0-5 1.5-5 3v2h5v1H5C3 8 2 9 2 11v3c0 1.5 1 3 5 3h1v-2.5h-1c-1.5 0-2-.5-2-1.5v-2c0-1 .5-1.5 2-1.5h3c1.5 0 2-1 2-2V5c0-1.5-.5-3-2-3zm1 1.5c.4 0 .75.35.75.75S11.4 5 11 5s-.75-.35-.75-.75S10.6 3.5 11 3.5z" fill="currentColor" opacity=".6"/><path d="M10 18c4 0 5-1.5 5-3v-2h-5v-1h5c2 0 3-1 3-3V6c0-1.5-1-3-5-3h-1v2.5h1c1.5 0 2 .5 2 1.5v2c0 1-.5 1.5-2 1.5H9c-1.5 0-2 1-2 2v3c0 1.5.5 3 2 3h1zm-1-1.5c-.4 0-.75-.35-.75-.75S8.6 15 9 15s.75.35.75.75S9.4 16.5 9 16.5z" fill="currentColor" opacity=".6"/></svg>`,
  web:     `<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M10 3c-2 2-3 4.5-3 7s1 5 3 7M10 3c2 2 3 4.5 3 7s-1 5-3 7M3 10h14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  exe:     `<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M7 10h6M13 10l-2.5-2.5M13 10l-2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  disk:    `<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
  text:    `<svg viewBox="0 0 20 20" fill="none"><rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  package: `<svg viewBox="0 0 20 20" fill="none"><path d="M10 2L2 6v8l8 4 8-4V6L10 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 6l8 4 8-4M10 10v10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6 4l8 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  file:    `<svg viewBox="0 0 20 20" fill="none"><path d="M5 2h7l4 4v12a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.4"/><path d="M12 2v4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

const EXT_MAP = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet',
  ppt: 'slides', pptx: 'slides',
  zip: 'zip', rar: 'zip', '7z': 'zip', gz: 'zip', tar: 'zip',
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', aac: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
  svg: 'design', fig: 'design', psd: 'design', ai: 'design',
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', json: 'code',
  css: 'code', scss: 'code', html: 'web',
  py: 'python',
  exe: 'exe', msi: 'exe', app: 'exe',
  dmg: 'disk', iso: 'disk',
  txt: 'text', md: 'text', log: 'text', xml: 'text',
};

function getFileIcon(name) {
  const ext = (name||'').split('.').pop().toLowerCase();
  const key = EXT_MAP[ext] || 'file';
  return ICONS[key];
}

let toastTimer;
function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = Object.assign(document.createElement('div'), {className:'toast'}); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}
