const $ = s => document.querySelector(s);
let activeTab = 'url';
let pollTimer = null;

$('.tabs').addEventListener('click', event => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
  activeTab = tab.dataset.tab;
  $('#urlPanel').classList.toggle('hidden', activeTab !== 'url');
  $('#uploadPanel').classList.toggle('hidden', activeTab !== 'upload');
  $('#analyzeUpload').classList.toggle('hidden', activeTab !== 'upload');
});

$('#clipCount').addEventListener('input', e => $('#clipCountValue').textContent = e.target.value);
$('#videoFile').addEventListener('change', e => {
  $('#fileName').textContent = e.target.files[0]?.name || 'Drop a video here';
});

$('#analyzeUrl').addEventListener('click', async () => {
  const url = $('#url').value.trim();
  if (!url) return toast('Enter a live stream or video URL');
  try {
    const response = await fetch('/api/analyze-url', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({url, count: $('#clipCount').value}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not start analysis');
    beginPolling(data.id);
  } catch (error) { toast(error.message); }
});

$('#analyzeUpload').addEventListener('click', async () => {
  const file = $('#videoFile').files[0];
  if (!file) return toast('Choose a video first');
  const form = new FormData();
  form.append('video', file);
  form.append('count', $('#clipCount').value);
  try {
    const response = await fetch('/api/analyze-upload', {method:'POST', body:form});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not start analysis');
    beginPolling(data.id);
  } catch (error) { toast(error.message); }
});

function beginPolling(id) {
  clearInterval(pollTimer);
  $('#progress').classList.remove('hidden');
  $('#results').classList.add('hidden');
  setProgress(3, 'Downloading or reading source');
  pollTimer = setInterval(async () => {
    try {
      const response = await fetch(`/api/jobs/${id}`);
      const job = await response.json();
      setProgress(job.progress || 0, job.status === 'done' ? 'Shorts ready' : 'Detecting hype moments');
      if (job.status === 'done') {
        clearInterval(pollTimer);
        renderClips(job, id);
      } else if (job.status === 'error') {
        clearInterval(pollTimer);
        toast(job.error || 'Analysis failed');
      }
    } catch (_) {}
  }, 1200);
}

function setProgress(value, label) {
  $('#progressValue').textContent = `${value}%`;
  $('#progressLabel').textContent = label;
  $('#progressBar').style.width = `${value}%`;
}

function renderClips(job, id) {
  $('#progress').classList.add('hidden');
  $('#results').classList.remove('hidden');
  $('#clips').innerHTML = job.clips.map(clip => `
    <article class="clip-card">
      <video src="${clip.url}" controls preload="metadata"></video>
      <div class="clip-meta">
        <div><span>SHORT ${String(clip.id).padStart(2,'0')}</span><b>${clip.score}% HYPE</b></div>
        <p>${formatTime(clip.start)} — ${formatTime(clip.end)}</p>
        <div class="actions">
          <a href="${clip.url}" download="clip-cut-short-${clip.id}.mp4">DOWNLOAD</a>
          <button onclick="publish('youtube','${clip.url}','${id}')">YOUTUBE</button>
          <button onclick="publish('tiktok','${clip.url}','${id}')">TIKTOK</button>
        </div>
      </div>
    </article>`).join('');
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

async function publish(platform, clipUrl, jobId) {
  const response = await fetch(`/api/export/${platform}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({clipUrl, jobId})});
  const data = await response.json();
  toast(data.message || `Opening ${platform}`);
}

$('#exportAll').addEventListener('click', () => {
  document.querySelectorAll('.clip-card a').forEach((link, i) => setTimeout(() => link.click(), i * 300));
});

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}
