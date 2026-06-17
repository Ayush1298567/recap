import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { runClaude } from './claude.js'
import type { Meeting, ScreenCapture } from './types.js'

const fmtTime = (sec: number) => {
  const t = Math.round(sec)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
const fmtDur = (sec: number) => {
  const t = Math.round(sec)
  return `${Math.floor(t / 60)}m ${t % 60}s`
}

/** Default destination: ~/Ayush/meetings, falling back to ~/Downloads/meetings. */
export function defaultExportDir(): string {
  const ayush = join(homedir(), 'Ayush')
  const base = existsSync(ayush) ? ayush : join(homedir(), 'Downloads')
  return join(base, 'meetings')
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'meeting'
  )
}

/** Claude writes an in-depth narrative of everything shared on screen. */
async function screenRundown(screens: ScreenCapture[]): Promise<string> {
  if (!screens.length) return ''
  const material = screens
    .map((s) => `[${fmtTime(s.timeSec)}] ${s.title}\n${s.text || s.description}`)
    .join('\n\n')
    .slice(0, 40000)
  return runClaude(
    `Below is everything captured from the screen shares during a meeting (slides, docs, demos). Write an in-depth rundown of what was presented: walk through each piece of shared content, explain what it showed, the key details and numbers, and why it mattered to the discussion. Be thorough and specific — this is the permanent record of what was on screen.\n\nSHARED SCREENS:\n${material}`,
    'You write clear, in-depth, faithful rundowns of presented material. Markdown prose, no preamble, never invent content that is not in the source.'
  )
}

/** Claude gives the user candid, specific coaching on how they communicated. */
async function personalFeedback(meeting: Meeting): Promise<string> {
  // The user is the "Me" channel (their mic). If we can't identify them, skip rather than
  // misattribute another participant's metrics to the user.
  const me = meeting.coaching?.find((c) => c.speaker === 'Me')
  if (!me) return ''
  const metrics = `talk ${Math.round(me.talkRatio * 100)}%, ${me.wpm} wpm, ${me.fillerCount} filler words (${(me.fillerRate * 100).toFixed(1)}%), ${me.questionsAsked} questions asked, longest monologue ${me.longestMonologueSec}s, ${me.interruptions} interruptions`
  const transcript = meeting.transcript
    .map((s) => `${s.speaker}: ${s.text}`)
    .join('\n')
    .slice(0, 40000)
  return runClaude(
    `You are my personal communication coach. Give me candid, specific, actionable feedback on how I communicated in this meeting. I am the speaker labelled "Me" (or the host). Cover: what I did well, and what to improve across clarity (pace, filler words), collaboration (interrupting, sharing airtime, listening), and impact (asking questions, getting to the point, driving outcomes). Reference my actual metrics and things I actually said. Be direct and useful — 2-4 short paragraphs, no flattery, no generic advice.\n\nMY METRICS: ${metrics}\n\nTRANSCRIPT:\n${transcript}`,
    'You are a sharp, candid executive communication coach. Specific and honest, never generic or flattering.'
  )
}

function buildMarkdown(meeting: Meeting, rundown: string, feedback: string): string {
  const m = meeting
  const n = m.notes
  const a = m.analytics
  const participants = [...new Set(m.transcript.map((s) => s.speaker))].join(', ')
  const date = new Date(m.createdAt).toLocaleString()
  const L: string[] = []

  L.push(`# ${m.title}`, '')
  L.push(`**Date:** ${date}  `)
  L.push(`**Duration:** ${fmtDur(m.durationSeconds)}  `)
  L.push(`**Participants:** ${participants}`, '')

  if (a) {
    L.push(
      `> **Read Score ${a.readScore}** · Engagement ${a.engagement} · Sentiment ${a.sentimentScore} (${a.sentiment})`,
      ''
    )
  }

  L.push('## Summary', '', n?.summary ?? '_No summary._', '')

  if (n?.keyPoints?.length) {
    L.push('## Key points', '')
    n.keyPoints.forEach((p) => L.push(`- ${p}`))
    L.push('')
  }
  if (n?.decisions?.length) {
    L.push('## Decisions', '')
    n.decisions.forEach((d) => L.push(`- ${d}`))
    L.push('')
  }
  if (n?.actionItems?.length) {
    L.push('## Action items', '')
    n.actionItems.forEach((it) =>
      L.push(`- [ ] ${it.task}${it.owner ? ` — **${it.owner}**` : ''}${it.due ? ` _(${it.due})_` : ''}`)
    )
    L.push('')
  }
  if (n?.questions?.length) {
    L.push('## Open questions', '')
    n.questions.forEach((q) => L.push(`- ${q}`))
    L.push('')
  }
  if (m.chapters?.length) {
    L.push('## Chapters', '')
    m.chapters.forEach((c) => L.push(`- **${fmtTime(c.start)}** ${c.title} — ${c.summary}`))
    L.push('')
  }

  if (m.screens?.length) {
    L.push('## Shared screens', '')
    if (rundown) L.push(rundown, '')
    L.push('### Captured screens', '')
    m.screens.forEach((s) => {
      L.push(`**[${fmtTime(s.timeSec)}] ${s.title}** — ${s.description}`, '')
      if (s.text) {
        // Fence longer than any backtick run inside the (untrusted) screen text, so it can't break out.
        const longest = s.text.match(/`+/g)?.reduce((n, r) => Math.max(n, r.length), 0) ?? 0
        const fence = '`'.repeat(Math.max(3, longest + 1))
        L.push(fence, s.text, fence, '')
      }
    })
  }

  L.push('## Coaching & feedback', '')
  if (feedback) L.push(feedback, '')
  if (m.coaching?.length) {
    L.push('| Speaker | Talk | Pace (wpm) | Fillers | Questions | Longest monologue | Interruptions |')
    L.push('| --- | --- | --- | --- | --- | --- | --- |')
    m.coaching.forEach((c) =>
      L.push(
        `| ${c.speaker} | ${Math.round(c.talkRatio * 100)}% | ${c.wpm} | ${c.fillerCount} (${(c.fillerRate * 100).toFixed(1)}%) | ${c.questionsAsked} | ${fmtDur(c.longestMonologueSec)} | ${c.interruptions} |`
      )
    )
    L.push('')
    m.coaching.forEach((c) => {
      if (c.tips.length) {
        L.push(`**${c.speaker}**`)
        c.tips.forEach((t) => L.push(`- ${t}`))
        L.push('')
      }
    })
  }

  if (a?.speakerStats?.length) {
    L.push('## Talk time', '')
    a.speakerStats.forEach((s) =>
      L.push(`- **${s.speaker}** — ${Math.round(s.talkShare * 100)}% (${fmtDur(s.talkSeconds)}), ${s.wordCount} words`)
    )
    L.push('')
  }

  L.push('## Transcript', '')
  m.transcript.forEach((s) => L.push(`**[${fmtTime(s.start)}] ${s.speaker}:** ${s.text}`, ''))

  L.push('---', `_Generated by Recap on ${new Date().toLocaleString()}._`)
  return L.join('\n')
}

/** Build the full markdown (enriched by Claude) and write it to the meetings folder. Returns the path. */
export async function exportMeetingMarkdown(meeting: Meeting, folder?: string): Promise<string> {
  const [rundown, feedback] = await Promise.all([
    screenRundown(meeting.screens ?? []).catch(() => ''),
    personalFeedback(meeting).catch(() => '')
  ])
  const md = buildMarkdown(meeting, rundown, feedback)
  const dir = folder ?? defaultExportDir()
  mkdirSync(dir, { recursive: true })
  const date = meeting.createdAt.slice(0, 10)
  // id suffix guarantees uniqueness — two same-day meetings with the same title won't overwrite.
  const path = join(dir, `${date}-${slug(meeting.title)}-${meeting.id.slice(0, 8)}.md`)
  writeFileSync(path, md)
  return path
}
