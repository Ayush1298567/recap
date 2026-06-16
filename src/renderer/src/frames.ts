export interface CapturedFrame {
  timeSec: number
  bytes: Uint8Array
}

/**
 * Samples the screen-share video on an interval and keeps only frames that meaningfully
 * changed from the last kept one — i.e. distinct shared screens/slides, not every tick.
 * Frames are downscaled PNGs sized for OCR, with a hard cap to bound vision cost.
 */
export class FrameSampler {
  private video = document.createElement('video')
  private diffCanvas = document.createElement('canvas')
  private outCanvas = document.createElement('canvas')
  private timer?: ReturnType<typeof setInterval>
  private startedAt = 0
  private lastSig?: Uint8ClampedArray
  private frames: CapturedFrame[] = []
  private readonly maxFrames = 40
  private readonly intervalMs = 4000
  private readonly diffThreshold = 0.05 // mean abs grayscale diff (0-1) that counts as a new screen
  private readonly outWidth = 1280

  start(videoStream: MediaStream): void {
    this.video.srcObject = videoStream
    this.video.muted = true
    void this.video.play()
    this.diffCanvas.width = 64
    this.diffCanvas.height = 36
    this.startedAt = performance.now()
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
  }

  private signature(): Uint8ClampedArray | null {
    const ctx = this.diffCanvas.getContext('2d')
    if (!ctx || !this.video.videoWidth) return null
    ctx.drawImage(this.video, 0, 0, 64, 36)
    const { data } = ctx.getImageData(0, 0, 64, 36)
    const gray = new Uint8ClampedArray(64 * 36)
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) | 0
    }
    return gray
  }

  private changed(sig: Uint8ClampedArray): boolean {
    if (!this.lastSig) return true
    let sum = 0
    for (let i = 0; i < sig.length; i++) sum += Math.abs(sig[i] - this.lastSig[i])
    return sum / sig.length / 255 > this.diffThreshold
  }

  private async capture(timeSec: number): Promise<void> {
    const w = Math.min(this.video.videoWidth, this.outWidth)
    const h = Math.round((w / this.video.videoWidth) * this.video.videoHeight)
    this.outCanvas.width = w
    this.outCanvas.height = h
    const ctx = this.outCanvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(this.video, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((res) => this.outCanvas.toBlob(res, 'image/png'))
    if (!blob) return
    this.frames.push({ timeSec, bytes: new Uint8Array(await blob.arrayBuffer()) })
  }

  private async tick(): Promise<void> {
    if (this.frames.length >= this.maxFrames) return
    const sig = this.signature()
    if (!sig || !this.changed(sig)) return
    this.lastSig = sig
    await this.capture(Math.round((performance.now() - this.startedAt) / 1000))
  }

  async stop(): Promise<CapturedFrame[]> {
    if (this.timer) clearInterval(this.timer)
    // one last frame in case the final screen never got sampled
    const sig = this.signature()
    if (sig && this.frames.length < this.maxFrames && this.changed(sig)) {
      await this.capture(Math.round((performance.now() - this.startedAt) / 1000))
    }
    ;(this.video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop())
    this.video.srcObject = null
    return this.frames
  }
}
