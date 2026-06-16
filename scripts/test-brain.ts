import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { generateNotes } from '../src/main/claude.js'
import { buildAnalytics } from '../src/main/analytics.js'
import type { TranscriptSegment } from '../src/main/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const transcript: TranscriptSegment[] = JSON.parse(
  readFileSync(join(here, '..', 'sample', 'transcript.json'), 'utf8')
)

const fmt = (s: number) => `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`

console.log('Running the brain on the sample transcript via your Claude subscription...\n')
console.time('total')

const [notes, analytics] = await Promise.all([generateNotes(transcript), buildAnalytics(transcript)])

console.timeEnd('total')
console.log('\n=== NOTES ===')
console.log('Title:   ', notes.title)
console.log('Summary: ', notes.summary)
console.log('\nKey points:')
notes.keyPoints.forEach((p) => console.log('  •', p))
console.log('\nDecisions:')
notes.decisions.forEach((d) => console.log('  •', d))
console.log('\nAction items:')
notes.actionItems.forEach((a) => console.log(`  • [${a.owner ?? 'unassigned'}] ${a.task}${a.due ? ` (due ${a.due})` : ''}`))
console.log('\nTopics:  ', notes.topics.join(', '))
console.log('Open Qs: ', notes.questions.join(' | '))

console.log('\n=== ANALYTICS ===')
console.log('Duration:  ', fmt(analytics.durationSeconds))
console.log('Sentiment: ', analytics.sentiment, '—', analytics.sentimentReason)
console.log('Engagement:', analytics.engagement, '—', analytics.engagementReason)
console.log('Talk time:')
analytics.speakerStats.forEach((s) =>
  console.log(`  • ${s.speaker}: ${fmt(s.talkSeconds)} (${Math.round(s.talkShare * 100)}%), ${s.wordCount} words`)
)
