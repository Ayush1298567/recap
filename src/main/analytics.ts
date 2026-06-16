import type { MeetingAnalytics, SpeakerStat, TranscriptSegment } from './types.js'
import { readSentiment } from './claude.js'

/** Talk-time and participation stats computed locally from the diarized transcript — no model needed. */
export function computeSpeakerStats(transcript: TranscriptSegment[]): SpeakerStat[] {
  const bySpeaker = new Map<string, { talk: number; words: number }>()
  for (const seg of transcript) {
    const cur = bySpeaker.get(seg.speaker) ?? { talk: 0, words: 0 }
    cur.talk += Math.max(0, seg.end - seg.start)
    cur.words += seg.text.trim().split(/\s+/).filter(Boolean).length
    bySpeaker.set(seg.speaker, cur)
  }
  const totalTalk = [...bySpeaker.values()].reduce((a, b) => a + b.talk, 0) || 1
  return [...bySpeaker.entries()]
    .map(([speaker, v]) => ({
      speaker,
      talkSeconds: Math.round(v.talk),
      talkShare: v.talk / totalTalk,
      wordCount: v.words
    }))
    .sort((a, b) => b.talkSeconds - a.talkSeconds)
}

export async function buildAnalytics(transcript: TranscriptSegment[]): Promise<MeetingAnalytics> {
  const speakerStats = computeSpeakerStats(transcript)
  const durationSeconds = transcript.length ? Math.round(transcript[transcript.length - 1].end) : 0
  const s = await readSentiment(transcript)
  const shareBySpeaker = new Map(speakerStats.map((x) => [x.speaker, x.talkShare]))
  return {
    durationSeconds,
    speakerStats,
    sentiment: s.sentiment,
    sentimentScore: s.sentimentScore,
    sentimentReason: s.sentimentReason,
    engagement: s.engagement,
    engagementReason: s.engagementReason,
    readScore: Math.round((s.sentimentScore + s.engagement) / 2),
    standings: s.standings.map((st) => ({
      speaker: st.speaker,
      talkShare: shareBySpeaker.get(st.speaker) ?? 0,
      engagement: st.engagement,
      sentiment: st.sentiment
    }))
  }
}
