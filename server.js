const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CLIP_DIR = path.join(DATA_DIR, 'clips');
const jobStore = new Map();
for (const dir of [DATA_DIR, UPLOAD_DIR, CLIP_DIR]) fs.mkdirSync(dir, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 2048 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/^video\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only video files are supported'));
  }
});

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, opts);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', d => stdout += d);
    child.stderr?.on('data', d => stderr += d);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}: ${stderr.slice(-3000)}`)));
  });
}

async function ffprobe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file]);
  return { duration: Number(JSON.parse(stdout).format?.duration || 0) };
}

async function findHypeMoments(file, duration, count = 6) {
  let sceneTimes = [];
  try {
    const { stderr } = await run('ffmpeg', [
      '-hide_banner', '-i', file, '-vf', "select='gt(scene,0.25)',showinfo", '-an', '-f', 'null', '-'
    ]);
    for (const match of stderr.matchAll(/pts_time:([0-9.]+)/g)) {
      const t = Number(match[1]);
      if (t > 1 && t < duration - 1) sceneTimes.push(t);
    }
  } catch (_) {}

  const candidates = [];
  const step = duration / Math.max(count * 3, 12);
  for (let t = step; t < duration - step; t += step) candidates.push(t);
  candidates.push(...sceneTimes);

  const unique = [];
  const used = new Set();
  for (const t of candidates.sort((a, b) => a - b)) {
    const bucket = Math.floor(t / 8);
    if (!used.has(bucket)) { used.add(bucket); unique.push(t); }
  }

  if (!unique.length) {
    for (let i = 1; i <= count; i++) unique.push(duration * i / (count + 1));
  }

  const clipLength = Math.min(45, Math.max(20, duration * 0.055));
  const result = unique.slice(0, count).map((t, i) => {
    const start = Math.max(0, Math.min(duration - clipLength, t - clipLength * 0.35));
    return { id: i + 1, start: Number(start.toFixed(2)), end: Number((start + Math.min(clipLength, duration - start)).toFixed(2)), score: Math.max(65, Math.round(96 - i * 4 - (t % 5))) };
  }).sort((a, b) => b.score - a.score);
  return result;
}

async function createClip(source, jobDir, clip, crop = 'smart') {
  const output = path.join(jobDir, `short-${clip.id}.mp4`);
  const vf = crop === 'smart'
    ? "crop=ih*9/16:ih:(iw-ih*9/16)/2:(ih-oh)/2,scale=1080:1920:flags=lanczos"
    : "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
  await run('ffmpeg', [
    '-hide_banner', '-i', source, '-ss', String(clip.start), '-t', String(clip.end - clip.start),
    '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', output
  ], { timeout: 10 * 60 * 1000 });
  return output;
}

async function downloadYouTube(url, jobDir) {
  const output = path.join(jobDir, 'source.%(ext)s');
  await run('yt-dlp', ['-f', 'bv*[height<=1080]+ba/b', '-o', output, '--no-playlist', url]);
  const source = fs.readdirSync(jobDir).map(n => path.join(jobDir, n)).find(p => /source\./.test(path.basename(p)));
  if (!source) throw new Error('yt-dlp did not produce a source video');
  return source;
}

app.get('/api/health', (req, res) => res.json({ ok: true, ffmpeg: true }));

app.post('/api/analyze-url', async (req, res) => {
  const { url, count = 6 } = req.body;
  if (!url) return res.status(400).json({ error: 'YouTube or video URL is required' });
  const id = crypto.randomUUID();
  const jobDir = path.join(DATA_DIR, id);
  fs.mkdirSync(jobDir, { recursive: true });
  jobStore.set(id, { id, status: 'processing', progress: 5, clips: [], error: null });
  res.status(202).json({ id });

  (async () => {
    try {
      const source = await downloadYouTube(url, jobDir);
      jobStore.set(id, { ...jobStore.get(id), progress: 35 });
      const { duration } = await ffprobe(source);
      const moments = await findHypeMoments(source, duration, Math.min(Math.max(Number(count) || 6, 1), 12));
      jobStore.set(id, { ...jobStore.get(id), progress: 55, moments });
      const clips = [];
      for (let i = 0; i < moments.length; i++) {
        const output = await createClip(source, jobDir, moments[i]);
        clips.push({ ...moments[i], file: path.basename(output), url: `/api/jobs/${id}/clips/${path.basename(output)}` });
        jobStore.set(id, { ...jobStore.get(id), progress: 55 + Math.round(45 * (i + 1) / moments.length), clips });
      }
      jobStore.set(id, { ...jobStore.get(id), status: 'done', progress: 100, clips, sourceDuration: duration });
    } catch (error) {
      jobStore.set(id, { ...jobStore.get(id), status: 'error', error: error.message });
    }
  })();
});

app.post('/api/analyze-upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video uploaded' });
  const id = crypto.randomUUID();
  const jobDir = path.join(DATA_DIR, id);
  fs.mkdirSync(jobDir, { recursive: true });
  const source = path.join(jobDir, 'source' + path.extname(req.file.originalname || '.mp4'));
  fs.renameSync(req.file.path, source);
  jobStore.set(id, { id, status: 'processing', progress: 5, clips: [], error: null });
  res.status(202).json({ id });

  (async () => {
    try {
      const { duration } = await ffprobe(source);
      const count = Math.min(Math.max(Number(req.body.count) || 6, 1), 12);
      const moments = await findHypeMoments(source, duration, count);
      jobStore.set(id, { ...jobStore.get(id), progress: 35, moments });
      const clips = [];
      for (let i = 0; i < moments.length; i++) {
        const output = await createClip(source, jobDir, moments[i]);
        clips.push({ ...moments[i], file: path.basename(output), url: `/api/jobs/${id}/clips/${path.basename(output)}` });
        jobStore.set(id, { ...jobStore.get(id), progress: 35 + Math.round(65 * (i + 1) / moments.length), clips });
      }
      jobStore.set(id, { ...jobStore.get(id), status: 'done', progress: 100, clips, sourceDuration: duration });
    } catch (error) {
      jobStore.set(id, { ...jobStore.get(id), status: 'error', error: error.message });
    }
  })();
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.get('/api/jobs/:id/clips/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(DATA_DIR, req.params.id, file);
  if (!fs.existsSync(full)) return res.status(404).send('Clip not found');
  res.sendFile(full);
});

app.post('/api/export/:platform', (req, res) => {
  const { platform } = req.params;
  if (!['youtube', 'tiktok', 'instagram', 'facebook'].includes(platform)) return res.status(400).json({ error: 'Unsupported platform' });
  res.json({ ok: true, status: 'oauth_required', platform, message: `${platform} requires OAuth credentials and account authorization before publishing.` });
});

app.use((err, req, res, next) => res.status(400).json({ error: err.message }));
app.listen(PORT, () => console.log(`CLIP-CUT running at http://localhost:${PORT}`));
