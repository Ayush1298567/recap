import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { runDiarization, assignSpeakers, mapSpeakerNames } from '../src/main/diarize.js'
import type { TranscriptSegment } from '../src/main/types.js'

const wav = '/tmp/recap-diar-test.wav'

// Regenerate a 2-voice test wav if it's gone.
if (!existsSync(wav)) {
  console.log('Regenerating 2-voice test wav…')
  execFileSync('say', ['-v', 'Samantha', '-o', '/tmp/a.aiff', 'Hi everyone, this is Priya. Lets start with the budget review for the quarter.'])
  execFileSync('say', ['-v', 'Daniel', '-o', '/tmp/b.aiff', 'Thanks Priya. Mark here. I think we should increase marketing spend this quarter.'])
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', '/tmp/a.aiff', '/tmp/a.wav'])
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', '/tmp/b.aiff', '/tmp/b.wav'])
  // concat via ffmpeg if available, else just use a.wav+b.wav stitched by cat won't work for wav; use afconvert on a concat list
  execFileSync('sh', ['-c', `cat /tmp/a.aiff /tmp/b.aiff > /tmp/ab.aiff && afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/ab.aiff ${wav}`])
}

console.log('1) runDiarization on real 2-voice wav…')
const turns = await runDiarization(wav, -1)
console.log('   turns:', JSON.stringify(turns))
console.log(`   → detected ${new Set(turns.map((t) => t.speaker)).size} distinct speaker(s)`)

console.log('\n2) assignSpeakers onto an "Others" transcript…')
const transcript: TranscriptSegment[] = [
  { speaker: 'Others', start: 0, end: 7.5, text: 'Hi everyone, this is Priya. Let us start with the budget review for the quarter.' },
  { speaker: 'Others', start: 7.6, end: 15, text: 'Thanks Priya. Mark here. I think we should increase marketing spend this quarter.' }
]
const assigned = assignSpeakers(transcript, turns)
assigned.forEach((s) => console.log(`   [${s.start}-${s.end}] ${s.speaker}: ${s.text.slice(0, 40)}…`))

console.log('\n3) mapSpeakerNames via Claude (should find Priya & Mark from context)…')
const names = await mapSpeakerNames(assigned)
console.log('   name map:', JSON.stringify(names))
const named = assigned.map((s) => ({ ...s, speaker: names[s.speaker] ?? s.speaker }))
console.log('   final speakers:', named.map((s) => s.speaker).join(', '))
