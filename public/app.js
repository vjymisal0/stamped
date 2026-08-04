const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- tabs ----------

$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    $$('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    $(`#${btn.dataset.tab}`).classList.add('active');
  });
});

// ---------- helpers ----------

function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function barColor(score) {
  if (score >= 0.66) return 'var(--tray-green)';
  if (score >= 0.35) return 'var(--kraft)';
  return 'var(--safelight-bright)';
}

function stampClass(stamp) {
  return { PASSED: 'stamp--passed', FLAGGED: 'stamp--flagged', DUPLICATE: 'stamp--duplicate', VALID: 'stamp--valid', INVALID: 'stamp--invalid' }[stamp] ?? '';
}

// ---------- intake ----------

const dropzone = $('#dropzone');
const fileInput = $('#fileInput');
const gallery = $('#gallery');
const emptyNote = $('#emptyNote');
const dropHint = $('#dropHint');

$('#browseBtn').addEventListener('click', () => fileInput.click());
dropzone.addEventListener('click', (e) => { if (e.target === dropzone || e.target.closest('.slot')) fileInput.click(); });
dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drag'); })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) uploadPhoto(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) uploadPhoto(file);
  fileInput.value = '';
});

async function uploadPhoto(file) {
  dropHint.textContent = `Developing ${file.name}…`;
  const form = new FormData();
  form.append('photo', file);
  try {
    const res = await fetch('/api/photos', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    prependPhoto(data);
    dropHint.textContent = 'Nothing processed leaves this machine — files stay on this server.';
  } catch (err) {
    dropHint.textContent = err.message;
  }
}

function metricRow(label, score) {
  const pct = Math.round(score * 100);
  return `
    <div class="metric">
      <span class="metric-label">${label}</span>
      <span class="metric-bar"><span class="metric-bar-fill" style="width:${pct}%; background:${barColor(score)}"></span></span>
      <span class="metric-value">${pct}%</span>
    </div>`;
}

function photoCard(p) {
  const tags = [];
  if (p.hasGps) tags.push('<span class="tag tag--gps">gps present</span>');
  if (p.stamp === 'DUPLICATE') tags.push(`<span class="tag tag--dup">dup of ${p.duplicateOf} · ${Math.round((p.similarity ?? 0) * 100)}%</span>`);
  if (p.exifStripped) tags.push('<span class="tag">exif stripped</span>');

  const el = document.createElement('article');
  el.className = 'frame-card';
  el.dataset.id = p.id;
  el.innerHTML = `
    <span class="stamp ${stampClass(p.stamp)}">${p.stamp}</span>
    <div class="frame-thumb-wrap">
      <div class="sprockets">${'<span></span>'.repeat(10)}</div>
      <img class="frame-thumb" src="${p.url}" alt="" loading="lazy" />
    </div>
    <div class="frame-body">
      <div class="frame-name" title="${p.filename}">${p.filename} · ${p.hash.slice(0, 12)}…</div>
      ${metricRow('sharp', p.blurScore)}
      ${metricRow('exposure', p.exposureScore)}
      ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
      <div class="card-actions">
        <button class="btn-small strip-btn" ${!p.hasGps || p.exifStripped ? 'disabled' : ''}>
          ${p.exifStripped ? 'Metadata stripped' : 'Strip EXIF'}
        </button>
        <button class="btn-icon del-btn" title="Delete">×</button>
      </div>
    </div>`;

  el.querySelector('.strip-btn').addEventListener('click', async () => {
    const btn = el.querySelector('.strip-btn');
    btn.disabled = true;
    btn.textContent = 'Stripping…';
    const res = await fetch(`/api/photos/${p.id}/strip`, { method: 'POST' });
    const updated = await res.json();
    if (res.ok) el.replaceWith(photoCard(updated));
  });

  el.querySelector('.del-btn').addEventListener('click', async () => {
    await fetch(`/api/photos/${p.id}`, { method: 'DELETE' });
    el.remove();
    emptyNote.style.display = gallery.children.length ? 'none' : 'block';
  });

  return el;
}

function prependPhoto(p) {
  gallery.prepend(photoCard(p));
  emptyNote.style.display = 'none';
}

async function loadPhotos() {
  const res = await fetch('/api/photos');
  const photos = await res.json();
  gallery.innerHTML = '';
  photos.forEach((p) => gallery.appendChild(photoCard(p)));
  emptyNote.style.display = photos.length ? 'none' : 'block';
}

// ---------- registry ----------

function renderResult(container, kind, valid, parsed) {
  const stamp = valid ? 'VALID' : 'INVALID';
  const entries = Object.entries(parsed || {}).filter(([k]) => k !== 'valid');
  container.innerHTML = `
    <span class="stamp ${stampClass(stamp)}">${stamp}</span>
    <dl>${entries.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('')}</dl>`;
}

$('#panForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const pan = form.pan.value.trim();
  const holderName = form.holderName.value.trim();
  if (!pan) return;
  const res = await fetch('/api/validate/pan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pan, holderName: holderName || undefined }),
  });
  const data = await res.json();
  if (res.ok) {
    renderResult($('#panResult'), 'pan', data.valid, data.parsed);
    loadLog();
  }
});

$('#gstinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const gstin = form.gstin.value.trim();
  if (!gstin) return;
  const res = await fetch('/api/validate/gstin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gstin }),
  });
  const data = await res.json();
  if (res.ok) {
    renderResult($('#gstinResult'), 'gstin', data.valid, data.parsed);
    loadLog();
  }
});

async function loadLog() {
  const res = await fetch('/api/validations');
  const rows = await res.json();
  const list = $('#logList');
  if (!rows.length) {
    list.innerHTML = '<p class="log-empty">No filings yet. Run a PAN or GSTIN check above.</p>';
    return;
  }
  list.innerHTML = rows.map((r) => `
    <div class="log-row">
      <span class="log-kind">${r.kind}</span>
      <span class="log-input">${r.input}</span>
      <span class="stamp ${stampClass(r.valid ? 'VALID' : 'INVALID')}">${r.valid ? 'VALID' : 'INVALID'}</span>
      <span class="log-time">${timeAgo(r.createdAt)}</span>
    </div>`).join('');
}

loadPhotos();
loadLog();
