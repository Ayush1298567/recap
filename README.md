# recap

A local-first meeting recorder for macOS. It captures the call, transcribes it on-device with Whisper, and uses your Claude Code subscription to write the notes — summaries, action items, chapters, and speaker analytics — at zero marginal cost. A self-hosted take on Read AI: nothing leaves your machine except the prompts you already pay for.

## Why

Meeting-notes tools send your audio to someone else's servers and bill per minute. recap keeps the audio and the transcript on disk and offloads only the reasoning to the `claude` CLI you already have, so there's no audio upload, no API key, and no per-token bill.

## How it works

```
mic + system audio ──▶ on-device Whisper ──▶ transcript ──▶ claude CLI ──▶ notes / analytics
        │                                         │
   diarization (sherpa-onnx)              local JSON + WAV store
```

- **Records** both your microphone and the meeting's system audio via Electron loopback (ScreenCaptureKit on macOS), and samples the shared screen.
- **Transcribes locally** with Whisper `base.en` running through `@huggingface/transformers` (ONNX, WebGPU with a wasm fallback). No network.
- **Labels speakers** by splitting mic vs system audio for a free "Me vs Others," then refining with real diarization (`sherpa-onnx-node`: pyannote segmentation + speaker embeddings) and letting Claude map labels to names using only in-transcript evidence.
- **Writes the notes** by spawning the local `claude` CLI in print mode — summary, key points, decisions, action items with owner and due date, topic chapters, talk-time / sentiment / engagement analytics, per-speaker coaching (filler rate, words per minute, interruptions), and OCR of shared screens. Auth rides your Claude subscription; there is no `ANTHROPIC_API_KEY` and no `@anthropic-ai/sdk` anywhere in the codebase.
- **Stores everything locally** — meetings as JSON, audio as WAV, screen frames as PNG under the app's data directory. No cloud, no database.

Screen-vision runs under prompt-injection defenses: frames are treated as untrusted and Claude is scoped to a read-only tool over the frame directory, with `--safe-mode` isolating it from your own CLAUDE.md and skills.

## Tech

Electron 42, electron-vite, React 19, TypeScript (strict), Tailwind. Whisper via `@huggingface/transformers`; diarization via `sherpa-onnx-node`. The LLM is the external `claude` CLI, spawned as a subprocess — not an npm dependency.

## Running it

macOS only (loopback capture and the Claude CLI are required).

```bash
npm install
npm run setup-models   # downloads the Whisper + diarization models (hundreds of MB)
npm run dev
```

Requires the `claude` CLI installed and signed in to a Claude subscription.

## TODO — visual asset to add

- `assets/screenshot.png` — the app showing a finished meeting (Recap / Deep Dive / Coaching tabs). Reference it here once added.
