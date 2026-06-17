import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { generateNotes, generateChapters } from '../src/main/claude.js'
import { buildAnalytics } from '../src/main/analytics.js'
import { buildCoaching } from '../src/main/coaching.js'
import { exportMeetingMarkdown } from '../src/main/export.js'
import type { Meeting, TranscriptSegment } from '../src/main/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const raw: TranscriptSegment[] = JSON.parse(
  readFileSync(join(here, '..', 'sample', 'transcript.json'), 'utf8')
)
// Relabel the host as "Me" so this exercises the personal-feedback path (real meetings use the mic channel = "Me").
const transcript: TranscriptSegment[] = raw.map((s) => ({ ...s, speaker: s.speaker === 'Ayush' ? 'Me' : s.speaker }))

console.log('Building a full meeting from the sample…')
const [notes, analytics, chapters, coaching] = await Promise.all([
  generateNotes(transcript),
  buildAnalytics(transcript),
  generateChapters(transcript),
  buildCoaching(transcript)
])

const meeting: Meeting = {
  id: 'export-test',
  createdAt: new Date().toISOString(),
  title: notes.title,
  durationSeconds: 168,
  transcript,
  notes,
  analytics,
  chapters,
  coaching,
  screens: [
    {
      index: 0,
      timeSec: 90,
      title: 'Q3 Roadmap slide',
      text: 'Q3 ROADMAP\n1. Ship diarization\n2. Launch beta Monday\nOwner: Priya',
      description: 'Dark presentation slide listing two roadmap items and an owner.'
    }
  ]
}

console.log('Exporting markdown (Claude writes the screen rundown + personal feedback)…')
const path = await exportMeetingMarkdown(meeting, '/tmp/recap-export-test')
console.log('\n✓ wrote', path, '\n')
console.log('─'.repeat(70))
console.log(readFileSync(path, 'utf8'))
