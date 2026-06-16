import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pkg from 'wavefile'
const { WaveFile } = pkg
import { transcribePCM } from '../src/main/transcribe.js'

// Synthesize a short spoken clip with macOS `say` so we have real audio to transcribe.
const wavPath = join(tmpdir(), 'recap-test.wav')
const phrase =
  'Hi team, this is a test of the Recap meeting transcription pipeline running fully on device.'

if (!existsSync(wavPath)) {
  console.log('Synthesizing test speech with macOS say...')
  execFileSync('say', ['-o', wavPath, '--data-format=LEI16@16000', '-v', 'Samantha', phrase])
}

// Decode the 16kHz mono WAV into Float32 PCM for Whisper.
const wav = new WaveFile(readFileSync(wavPath))
wav.toBitDepth('32f')
wav.toSampleRate(16000)
let samples = wav.getSamples()
if (Array.isArray(samples)) samples = samples[0] // take channel 0 if multi-channel
const pcm = Float32Array.from(samples as unknown as ArrayLike<number>)

console.log(`Loaded ${(pcm.length / 16000).toFixed(1)}s of audio. Transcribing locally (first run downloads the model)...`)
console.time('transcribe')
const segments = await transcribePCM(pcm, { speaker: 'Me' })
console.timeEnd('transcribe')

console.log('\nSpoken:     ', phrase)
console.log('Transcribed:', segments.map((s) => s.text).join(' '))
console.log('\nSegments:')
segments.forEach((s) => console.log(`  [${s.start.toFixed(1)}-${s.end.toFixed(1)}s] ${s.speaker}: ${s.text}`))
