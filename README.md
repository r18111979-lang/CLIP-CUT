# CLIP-CUT

CLIP-CUT is an AI-assisted video clipping MVP that detects energetic or scene-changing moments, converts source footage to vertical 9:16, and generates downloadable short clips.

## Features

- YouTube live and regular video URL import through `yt-dlp`
- Uploaded MP4, MOV, and WebM video support
- Automatic hype-moment and scene-change candidate detection
- Multiple 9:16 short generation with FFmpeg
- In-browser preview and individual/bulk download
- YouTube, TikTok, Instagram, and Facebook publishing hooks

## Requirements

- Node.js 18+
- FFmpeg and FFprobe
- `yt-dlp` for URL imports

Ubuntu example:

```bash
sudo apt update
sudo apt install -y ffmpeg
python3 -m pip install --upgrade yt-dlp
npm install
npm start
```

Open `http://localhost:3000`.

## Publishing integrations

The platform publish endpoints are intentionally OAuth-safe placeholders. To publish automatically, add official platform OAuth credentials and use their approved APIs:

- YouTube Data API v3 resumable uploads
- TikTok Content Posting API
- Instagram Graph API
- Facebook Graph API

Never scrape or bypass social platform login protections. Respect copyright and the account owner's permissions.

## Architecture

- `server.js`: Express API, job queue, media probing, scene detection, FFmpeg rendering
- `public/`: responsive no-build web interface
- `data/`: temporary uploaded sources and generated clips

## Detection note

The MVP uses scene-change detection and evenly distributed candidates. The next phase should add audio-energy peaks, speech excitement scoring, live chat velocity, face tracking, and optional Whisper/LLM scene analysis.
