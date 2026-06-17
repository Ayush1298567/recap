import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { generateNotes, generateChapters } from '../src/main/claude.js'
import { buildAnalytics } from '../src/main/analytics.js'
import { buildCoaching } from '../src/main/coaching.js'
import { screensToContext } from '../src/main/screen-vision.js'
import type { Meeting, ScreenCapture, TranscriptSegment } from '../src/main/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const raw: TranscriptSegment[] = JSON.parse(readFileSync(join(here, '..', 'sample', 'transcript.json'), 'utf8'))
const transcript: TranscriptSegment[] = raw.map((s) => ({ ...s, speaker: s.speaker === 'Ayush' ? 'Me' : s.speaker }))

const id = 'aaaaaaaa-0000-4000-8000-000000000001'
const userData = join(homedir(), 'Library', 'Application Support', 'recap')

// Ensure a slide frame exists to seed the Screens tab.
if (!existsSync('/tmp/slide.png')) {
  execFileSync('python3', ['-c', "from PIL import Image,ImageDraw;i=Image.new('RGB',(800,300),(15,7,8));d=ImageDraw.Draw(i);d.text((40,60),'Q3 ROADMAP',fill=(255,160,108));d.text((40,130),'1. Ship diarization',fill=(240,233,231));d.text((40,170),'2. Launch beta Monday',fill=(240,233,231));i.save('/tmp/slide.png')"])
}

const screens: ScreenCapture[] = [
  {
    index: 0,
    timeSec: 90,
    title: 'Q3 Roadmap slide',
    text: 'Q3 ROADMAP\n1. Ship diarization\n2. Launch beta Monday\nOwner: Priya',
    description: 'Dark presentation slide listing two roadmap items and an owner.'
  }
]

console.log('Building seed meeting via the real pipeline…')
const [analytics, chapters, coaching] = await Promise.all([
  buildAnalytics(transcript),
  generateChapters(transcript),
  buildCoaching(transcript)
])
const notes = await generateNotes(transcript, screensToContext(screens))

const meeting: Meeting = {
  id,
  createdAt: new Date().toISOString(),
  title: notes.title,
  durationSeconds: 168,
  transcript,
  notes,
  analytics,
  chapters,
  coaching,
  screens,
  audioPath: join(userData, 'recordings', `${id}.wav`)
}

mkdirSync(join(userData, 'meetings'), { recursive: true })
mkdirSync(join(userData, 'recordings'), { recursive: true })
mkdirSync(join(userData, 'frames', id), { recursive: true })
writeFileSync(join(userData, 'meetings', `${id}.json`), JSON.stringify(meeting, null, 2))
copyFileSync('/tmp/slide.png', join(userData, 'frames', id, '0.png'))
const wavSrc = existsSync('/tmp/recap-diar-test.wav') ? '/tmp/recap-diar-test.wav' : ''
if (wavSrc) copyFileSync(wavSrc, join(userData, 'recordings', `${id}.wav`))

console.log('✓ Seeded:', meeting.title, '| speakers:', [...new Set(transcript.map((s) => s.speaker))].join(', '))
console.log('  meeting:', join(userData, 'meetings', `${id}.json`))
