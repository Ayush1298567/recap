export interface TranscriptSegment {
  speaker: string
  start: number // seconds
  end: number
  text: string
}

export interface ActionItem {
  task: string
  owner: string | null // null = unassigned
  due: string | null // natural-language due date if mentioned, else null
}

export interface MeetingNotes {
  title: string
  summary: string // 2-4 sentence overview
  keyPoints: string[]
  decisions: string[]
  actionItems: ActionItem[]
  topics: string[]
  questions: string[] // open questions raised but not resolved
}

export interface SpeakerStat {
  speaker: string
  talkSeconds: number
  talkShare: number // 0-1
  wordCount: number
}

export type Sentiment = 'positive' | 'neutral' | 'mixed' | 'negative'

export interface SpeakerStanding {
  speaker: string
  talkShare: number // 0-1
  engagement: number // 0-100
  sentiment: Sentiment
}

export interface MeetingAnalytics {
  durationSeconds: number
  speakerStats: SpeakerStat[]
  sentiment: Sentiment
  sentimentScore: number // 0-100
  sentimentReason: string
  engagement: number // 0-100
  engagementReason: string
  readScore: number // 0-100, average of sentimentScore and engagement (Read AI's headline metric)
  standings: SpeakerStanding[]
}

export interface Chapter {
  title: string
  start: number // seconds
  end: number
  summary: string
}

export interface ScreenCapture {
  index: number // frame index, used to fetch the stored image
  timeSec: number // when in the meeting it appeared
  title: string // short title of what's on screen
  text: string // text/content extracted from the screen
  description: string // one-line description of the visual
}

export interface CoachingMetric {
  speaker: string
  talkRatio: number // 0-1
  wpm: number
  fillerCount: number
  fillerRate: number // 0-1, fillers / total words
  questionsAsked: number
  longestMonologueSec: number
  interruptions: number
  tips: string[]
}

export interface Meeting {
  id: string
  createdAt: string
  title: string
  durationSeconds: number
  transcript: TranscriptSegment[]
  notes: MeetingNotes
  analytics: MeetingAnalytics
  chapters: Chapter[]
  coaching: CoachingMetric[]
  screens: ScreenCapture[]
  audioPath?: string
}
