import { transcribePCM, mergeChannels } from '../../main/transcribe.js'
import { FrameSampler, type CapturedFrame } from './frames.js'
import type { TranscriptSegment } from '../../main/types.js'

/**
 * Two-channel local recorder. Captures your mic on one channel and the meeting's
 * system audio (everyone else) on another via Electron loopback. Recording the two
 * separately gives us a free "Me vs. Others" split for transcription + talk-time,
 * the v1 stand-in for full speaker diarization.
 */
export class Recorder {
  private mic?: MediaStream
  private system?: MediaStream
  private micRec?: MediaRecorder
  private sysRec?: MediaRecorder
  private micChunks: Blob[] = []
  private sysChunks: Blob[] = []
  private sampler?: FrameSampler
  private startedAt = 0

  async start(): Promise<void> {
    this.micChunks = []
    this.sysChunks = []

    this.mic = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.micRec = this.record(this.mic, this.micChunks)

    // Screen capture serves double duty: the audio track is the meeting's system audio
    // (everyone else), and the video track is sampled for shared screens/slides.
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      const videoTracks = display.getVideoTracks()
      if (videoTracks.length) {
        this.sampler = new FrameSampler()
        this.sampler.start(new MediaStream(videoTracks))
      }
      const audioTracks = display.getAudioTracks()
      if (audioTracks.length) {
        this.system = new MediaStream(audioTracks)
        this.sysRec = this.record(this.system, this.sysChunks)
      }
    } catch {
      // No screen capture (permission denied / unsupported) — mic-only still works.
    }

    this.startedAt = performance.now()
  }

  private record(stream: MediaStream, sink: Blob[]): MediaRecorder {
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    rec.ondataavailable = (e) => e.data.size && sink.push(e.data)
    rec.start(1000)
    return rec
  }

  /**
   * Stop capture, transcribe both channels locally, and return a merged transcript, the mixed
   * audio for playback, and the isolated system-channel WAV (everyone-but-you) for diarization.
   */
  async stop(onStage?: (s: string) => void): Promise<{
    transcript: TranscriptSegment[]
    durationSeconds: number
    audio: Uint8Array
    systemWav?: Uint8Array
    frames: CapturedFrame[]
  }> {
    const durationSeconds = Math.round((performance.now() - this.startedAt) / 1000)
    const frames = this.sampler ? await this.sampler.stop() : []
    await Promise.all([this.flush(this.micRec), this.flush(this.sysRec)])
    this.mic?.getTracks().forEach((t) => t.stop())
    this.system?.getTracks().forEach((t) => t.stop())

    const micPCM = this.micChunks.length ? await this.toPCM(this.micChunks) : new Float32Array(0)
    const sysPCM = this.sysChunks.length ? await this.toPCM(this.sysChunks) : new Float32Array(0)

    onStage?.('Transcribing your audio…')
    const mine = micPCM.length ? await transcribePCM(micPCM, { speaker: 'Me' }) : []

    let others: TranscriptSegment[] = []
    if (sysPCM.length) {
      onStage?.('Transcribing the meeting audio…')
      others = await transcribePCM(sysPCM, { speaker: 'Others' })
    }

    const audio = encodeWav(mixPCM(micPCM, sysPCM), 16000)
    const systemWav = sysPCM.length ? encodeWav(sysPCM, 16000) : undefined
    return { transcript: mergeChannels(mine, others), durationSeconds, audio, systemWav, frames }
  }

  private flush(rec?: MediaRecorder): Promise<void> {
    return new Promise((res) => {
      if (!rec || rec.state === 'inactive') return res()
      rec.onstop = () => res()
      rec.stop()
    })
  }

  /** Decode recorded webm/opus to 16kHz mono Float32 PCM for Whisper. */
  private async toPCM(chunks: Blob[]): Promise<Float32Array> {
    const buf = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer()
    const ctx = new AudioContext()
    const decoded = await ctx.decodeAudioData(buf)
    await ctx.close()

    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    const rendered = await offline.startRendering()
    return rendered.getChannelData(0)
  }
}

/** Sum two mono PCM channels into one, soft-clipped — the playback mix of you + everyone else. */
function mixPCM(a: Float32Array, b: Float32Array): Float32Array {
  const len = Math.max(a.length, b.length)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const s = (a[i] ?? 0) + (b[i] ?? 0)
    out[i] = s > 1 ? 1 : s < -1 ? -1 : s
  }
  return out
}

/** Encode mono Float32 PCM as a 16-bit WAV file for playback. */
function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new ArrayBuffer(44 + pcm.length * 2)
  const view = new DataView(bytes)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, pcm.length * 2, true)
  let off = 44
  for (let i = 0; i < pcm.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(bytes)
}
