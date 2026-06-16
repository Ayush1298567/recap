import type { TranscriptSegment } from './types.js'

/**
 * Local speech-to-text via Whisper running through Transformers.js (ONNX).
 * No Python, no API, no per-minute cost — the model is downloaded once and runs on-device.
 * Audio comes in as mono Float32 PCM @ 16kHz (what the recorder produces).
 */

type ASRPipeline = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{
  text: string
  chunks?: Array<{ timestamp: [number, number | null]; text: string }>
}>

let pipePromise: Promise<ASRPipeline> | null = null

// 'base.en' is the sweet spot for meetings: ~145MB, fast on Apple Silicon, solid accuracy.
// Guard `process` — this module is imported in the renderer too, where it doesn't exist.
const MODEL =
  (typeof process !== 'undefined' ? process.env.RECAP_WHISPER_MODEL : undefined) ?? 'Xenova/whisper-base.en'

const isBrowser = typeof window !== 'undefined'

async function getPipeline(): Promise<ASRPipeline> {
  if (!pipePromise) {
    pipePromise = (async () => {
      const tf = await import('@huggingface/transformers')
      const { pipeline, env } = tf
      if (isBrowser) {
        // Load the model from files we ship in the app (public/models) — no 291MB download.
        env.allowRemoteModels = false
        env.allowLocalModels = true
        env.localModelPath = '/models/'
      }
      // dtype fp32 matches the cached/served .onnx files.
      const base: Record<string, unknown> = { dtype: 'fp32' }
      if (!isBrowser) {
        return (await pipeline('automatic-speech-recognition', MODEL, base)) as unknown as ASRPipeline
      }
      // Prefer WebGPU for speed; fall back to wasm for reliability.
      try {
        return (await pipeline('automatic-speech-recognition', MODEL, {
          ...base,
          device: 'webgpu'
        })) as unknown as ASRPipeline
      } catch {
        return (await pipeline('automatic-speech-recognition', MODEL, {
          ...base,
          device: 'wasm'
        })) as unknown as ASRPipeline
      }
    })()
  }
  return pipePromise
}

/** Force the model to fully load now (download/compile) so the first real transcription is instant. */
export async function warmup(): Promise<void> {
  const asr = await getPipeline()
  await asr(new Float32Array(16000), { chunk_length_s: 30, return_timestamps: false })
}

export interface TranscribeOptions {
  speaker?: string // label applied to every segment (e.g. "Me" or "Others" for channel-split audio)
}

export async function transcribePCM(
  pcm: Float32Array,
  opts: TranscribeOptions = {}
): Promise<TranscriptSegment[]> {
  const asr = await getPipeline()
  const out = await asr(pcm, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true
  })

  const speaker = opts.speaker ?? 'Speaker'
  if (!out.chunks?.length) {
    return out.text.trim() ? [{ speaker, start: 0, end: 0, text: out.text.trim() }] : []
  }
  return out.chunks
    .map((c) => ({
      speaker,
      start: c.timestamp[0] ?? 0,
      end: c.timestamp[1] ?? c.timestamp[0] ?? 0,
      text: c.text.trim()
    }))
    .filter((s) => s.text)
}

/**
 * Merge two channel-split transcripts (your mic vs. everyone else's system audio)
 * into one timeline. This is the v1 stand-in for diarization: cheap, and gives
 * the talk-time analytics a real "you vs. others" split with no extra model.
 */
export function mergeChannels(
  mine: TranscriptSegment[],
  others: TranscriptSegment[]
): TranscriptSegment[] {
  return [...mine, ...others].sort((a, b) => a.start - b.start)
}
