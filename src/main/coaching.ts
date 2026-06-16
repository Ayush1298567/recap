import type { CoachingMetric, TranscriptSegment } from './types.js'
import { generateCoachingTips } from './claude.js'

const FILLERS = ['um', 'uh', 'er', 'like', 'you know', 'so', 'actually', 'basically', 'i mean', 'kind of', 'sort of', 'right']
const FILLER_RE = new RegExp(`\\b(${FILLERS.map((f) => f.replace(/ /g, '\\s+')).join('|')})\\b`, 'gi')
const QUESTION_START = /^(who|what|when|where|why|how|do|does|did|can|could|would|will|is|are|should|may|have|has)\b/i

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
const isQuestion = (t: string) => t.includes('?') || QUESTION_START.test(t.trim())

/** All hard coaching metrics computed deterministically from the diarized transcript — no model. */
export function computeCoachingMath(transcript: TranscriptSegment[]): Omit<CoachingMetric, 'tips'>[] {
  const byId = new Map<string, { words: number; talk: number; fillers: number; questions: number }>()
  for (const s of transcript) {
    const cur = byId.get(s.speaker) ?? { words: 0, talk: 0, fillers: 0, questions: 0 }
    cur.words += words(s.text)
    cur.talk += Math.max(0, s.end - s.start)
    cur.fillers += s.text.match(FILLER_RE)?.length ?? 0
    if (isQuestion(s.text)) cur.questions += 1
    byId.set(s.speaker, cur)
  }
  const totalTalk = [...byId.values()].reduce((a, b) => a + b.talk, 0) || 1

  // Longest contiguous same-speaker monologue + interruptions, over the time-ordered timeline.
  const ordered = [...transcript].sort((a, b) => a.start - b.start)
  const longest = new Map<string, number>()
  const interruptions = new Map<string, number>()
  let runSpeaker = ''
  let runDur = 0
  let prevEnd = 0
  let prevSpeaker = ''
  for (const s of ordered) {
    if (s.speaker === runSpeaker) runDur += s.end - s.start
    else {
      runSpeaker = s.speaker
      runDur = s.end - s.start
    }
    longest.set(s.speaker, Math.max(longest.get(s.speaker) ?? 0, runDur))
    if (prevSpeaker && s.speaker !== prevSpeaker && s.start < prevEnd - 0.3) {
      interruptions.set(s.speaker, (interruptions.get(s.speaker) ?? 0) + 1)
    }
    if (s.end > prevEnd) {
      prevEnd = s.end
      prevSpeaker = s.speaker
    }
  }

  return [...byId.entries()]
    .map(([speaker, v]) => ({
      speaker,
      talkRatio: v.talk / totalTalk,
      wpm: v.talk > 0 ? Math.round(v.words / (v.talk / 60)) : 0,
      fillerCount: v.fillers,
      fillerRate: v.words > 0 ? v.fillers / v.words : 0,
      questionsAsked: v.questions,
      longestMonologueSec: Math.round(longest.get(speaker) ?? 0),
      interruptions: interruptions.get(speaker) ?? 0
    }))
    .sort((a, b) => b.talkRatio - a.talkRatio)
}

export async function buildCoaching(transcript: TranscriptSegment[]): Promise<CoachingMetric[]> {
  const math = computeCoachingMath(transcript)
  const summary = math
    .map(
      (m) =>
        `${m.speaker}: talk ${Math.round(m.talkRatio * 100)}%, ${m.wpm} wpm, ${m.fillerCount} fillers (${(m.fillerRate * 100).toFixed(1)}%), ${m.questionsAsked} questions, longest monologue ${m.longestMonologueSec}s, ${m.interruptions} interruptions`
    )
    .join('\n')
  let tipsBySpeaker: Record<string, string[]> = {}
  try {
    const tips = await generateCoachingTips(summary, transcript)
    tipsBySpeaker = Object.fromEntries(tips.map((t) => [t.speaker, t.tips]))
  } catch {
    // tips are a nice-to-have; metrics still ship without them
  }
  return math.map((m) => ({ ...m, tips: tipsBySpeaker[m.speaker] ?? [] }))
}
