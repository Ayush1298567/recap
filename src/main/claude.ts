import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Chapter, MeetingNotes, Sentiment, TranscriptSegment } from './types.js'

// Resolve the real `claude` binary. A packaged .app or a spawned child may not inherit
// the shell PATH, so probe the known install locations before falling back to PATH lookup.
const CLAUDE_BIN =
  [
    process.env.CLAUDE_BIN,
    join(homedir(), '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ].find((p): p is string => !!p && existsSync(p)) ?? 'claude'

/**
 * The brain. Runs Claude headlessly via the `claude` CLI in print mode, which
 * authenticates against the user's Claude subscription — no API key, no per-token cost.
 * The full prompt is piped over stdin so arbitrarily long transcripts are fine.
 */
export function runClaude(
  prompt: string,
  system?: string,
  opts?: { skipPermissions?: boolean }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json']
    if (system) args.push('--append-system-prompt', system)
    // Vision calls need the Read tool to open frame images on disk without an interactive prompt.
    if (opts?.skipPermissions) args.push('--dangerously-skip-permissions')
    const child = spawn(CLAUDE_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`))
      try {
        const outer = JSON.parse(stdout)
        if (outer.is_error) return reject(new Error(`claude error: ${outer.result}`))
        resolve(String(outer.result ?? ''))
      } catch (e) {
        reject(new Error(`failed to parse claude output: ${(e as Error).message}\n${stdout.slice(0, 500)}`))
      }
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

/** Extract the first balanced JSON object/array from a model response. */
function extractJSON<T>(raw: string): T {
  let s = raw.trim()
  // strip ```json ... ``` fences if present
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  const start = s.search(/[{[]/)
  if (start === -1) throw new Error(`no JSON found in:\n${raw.slice(0, 300)}`)
  // walk to the matching close
  const open = s[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else {
      if (c === '"') inStr = true
      else if (c === open) depth++
      else if (c === close) {
        depth--
        if (depth === 0) return JSON.parse(s.slice(start, i + 1)) as T
      }
    }
  }
  throw new Error(`unbalanced JSON in:\n${raw.slice(0, 300)}`)
}

export async function runClaudeJSON<T>(
  prompt: string,
  system?: string,
  opts?: { skipPermissions?: boolean }
): Promise<T> {
  const raw = await runClaude(prompt, system, opts)
  return extractJSON<T>(raw)
}

function renderTranscript(transcript: TranscriptSegment[]): string {
  return transcript.map((s) => `${s.speaker}: ${s.text}`).join('\n')
}

const NOTES_SYSTEM =
  'You are an expert meeting analyst. You read raw meeting transcripts and produce precise, ' +
  'faithful structured notes. You never invent facts, owners, or decisions that are not in the transcript. ' +
  'When an action item has no clear owner, set owner to null. Output ONLY valid minified JSON, no markdown, no commentary.'

export async function generateNotes(
  transcript: TranscriptSegment[],
  screenContext?: string
): Promise<MeetingNotes> {
  const screens = screenContext
    ? `\n\nCONTENT SHARED ON SCREEN (slides, docs, demos shown during the meeting — use this to enrich the notes):\n${screenContext}`
    : ''
  const prompt = `Analyze this meeting transcript and return notes as JSON matching exactly this shape:
{
  "title": "short descriptive meeting title (<= 8 words)",
  "summary": "2-4 sentence overview of what happened and why it mattered",
  "keyPoints": ["the most important points discussed"],
  "decisions": ["concrete decisions that were made"],
  "actionItems": [{"task": "what needs doing", "owner": "person name or null", "due": "when, or null"}],
  "topics": ["short topic tags"],
  "questions": ["open questions raised but left unresolved"]
}
Rules: be faithful to the transcript, never fabricate. Empty arrays are fine when nothing applies.

TRANSCRIPT:
${renderTranscript(transcript)}${screens}`
  return runClaudeJSON<MeetingNotes>(prompt, NOTES_SYSTEM)
}

export interface SentimentRead {
  sentiment: Sentiment
  sentimentScore: number
  sentimentReason: string
  engagement: number
  engagementReason: string
  standings: { speaker: string; engagement: number; sentiment: Sentiment }[]
}

export async function readSentiment(transcript: TranscriptSegment[]): Promise<SentimentRead> {
  const speakers = [...new Set(transcript.map((s) => s.speaker))]
  const prompt = `Analyze the sentiment and engagement of this meeting. Return JSON:
{
  "sentiment": "positive | neutral | mixed | negative",
  "sentimentScore": 0-100 integer (how positive the overall tone is; 50 is neutral),
  "sentimentReason": "one sentence citing what in the transcript drove this",
  "engagement": 0-100 integer for how engaged/active participants were overall,
  "engagementReason": "one sentence justification",
  "standings": [{"speaker": "<exact speaker label>", "engagement": 0-100, "sentiment": "positive|neutral|mixed|negative"}]
}
Provide one standings entry per speaker, using these exact speaker labels: ${speakers.join(', ')}.
Base engagement on back-and-forth, questions, energy, and balance of participation — not just length.

TRANSCRIPT:
${renderTranscript(transcript)}`
  return runClaudeJSON<SentimentRead>(
    prompt,
    'You analyze meeting tone objectively. Output ONLY valid minified JSON.'
  )
}

export async function generateChapters(transcript: TranscriptSegment[]): Promise<Chapter[]> {
  const lines = transcript
    .map((s) => `[${Math.round(s.start)}s] ${s.speaker}: ${s.text}`)
    .join('\n')
  const prompt = `Segment this meeting into contiguous topic chapters. Return a JSON array:
[{"title": "short sentence-case topic title like \\"Introductions and casual opening\\" or \\"Q3 budget discussion\\"", "start": <seconds, integer>, "end": <seconds, integer>, "summary": "one-line summary of this chapter"}]
Rules: one chapter per major topic shift, NOT one per line. Aim for 3-12 chapters depending on length. Chapters must be contiguous and cover the whole meeting (first chapter starts at 0). Use the [Ns] timestamps to set start/end.

TRANSCRIPT:
${lines}`
  return runClaudeJSON<Chapter[]>(
    prompt,
    'You segment meetings into clean topic chapters. Output ONLY a valid minified JSON array.'
  )
}

/** Generate per-speaker coaching tips given the hard metrics + transcript context. */
export async function generateCoachingTips(
  metricsSummary: string,
  transcript: TranscriptSegment[]
): Promise<{ speaker: string; tips: string[] }[]> {
  const prompt = `You are a communication coach. For each speaker, give 1-3 concrete, specific coaching tips, organized around clarity (pace, filler words), inclusion (interruptions, sharing airtime), and impact (asking questions, getting to the point). Ground them in the metrics and what they actually said. Return JSON:
[{"speaker": "<exact label>", "tips": ["specific actionable tip", ...]}]

METRICS:
${metricsSummary}

TRANSCRIPT:
${renderTranscript(transcript)}`
  return runClaudeJSON<{ speaker: string; tips: string[] }[]>(
    prompt,
    'You are a sharp, specific communication coach. No generic advice. Output ONLY valid minified JSON.'
  )
}

/** Chat with one or more meetings — used by the "Ask Recap" feature. */
export async function askMeeting(question: string, context: string): Promise<string> {
  const prompt = `Answer the user's question using ONLY the meeting transcript(s) below. If the answer isn't in them, say so plainly. Cite who said it when relevant.

MEETINGS:
${context}

QUESTION: ${question}`
  return runClaude(
    prompt,
    'You answer questions about past meetings accurately and concisely, grounded only in the provided transcripts.'
  )
}
