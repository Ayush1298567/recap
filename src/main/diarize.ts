import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runClaudeJSON } from './claude.js'
import type { TranscriptSegment } from './types.js'

export interface DiarizationTurn {
  start: number
  end: number
  speaker: number
}

// Resolve a plain Node binary. process.execPath points at the Electron runtime, not Node,
// so probe the known install locations before falling back to a PATH lookup.
const NODE_BIN =
  [
    process.env.NODE_BIN,
    join(homedir(), '.local/opt/node-current/bin/node'),
    join(homedir(), '.local/bin/node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node'
  ].find((p): p is string => !!p && existsSync(p)) ?? 'node'

// The worker is a raw .cjs run by plain Node — it isn't part of the Vite build graph, so it
// lives in src/main (where it also resolves node_modules + models). Prefer that; fall back to
// a co-located copy for packaged builds.
const WORKER =
  [
    fileURLToPath(new URL('../../src/main/diarize-worker.cjs', import.meta.url)),
    fileURLToPath(new URL('./diarize-worker.cjs', import.meta.url))
  ].find((p) => existsSync(p)) ?? fileURLToPath(new URL('./diarize-worker.cjs', import.meta.url))

/**
 * Run speaker diarization on a WAV file in a plain-Node child process. The worker
 * (diarize-worker.cjs) clusters speaker embeddings and prints a JSON array of turns
 * to stdout, or `{"error": "..."}` on failure.
 */
export function runDiarization(wavPath: string, numClusters: number): Promise<DiarizationTurn[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE_BIN, [WORKER, wavPath, String(numClusters)], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`diarize worker exited ${code}: ${stderr.slice(0, 500)}`))
      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch (e) {
        return reject(
          new Error(`failed to parse diarize output: ${(e as Error).message}\n${stdout.slice(0, 500)}`)
        )
      }
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        return reject(new Error(`diarize error: ${String((parsed as { error: unknown }).error)}`))
      }
      resolve(parsed as DiarizationTurn[])
    })
  })
}

/**
 * Relabel transcript segments using diarization turns. For each segment, pick the turn
 * with the most temporal overlap and set the speaker to `${labelPrefix} ${turn.speaker + 1}`.
 * Segments that overlap no turn keep their original label.
 */
export function assignSpeakers(
  transcript: TranscriptSegment[],
  turns: DiarizationTurn[],
  labelPrefix = 'Speaker'
): TranscriptSegment[] {
  return transcript.map((seg) => {
    let best: DiarizationTurn | null = null
    let bestOverlap = 0
    for (const turn of turns) {
      const overlap = Math.min(seg.end, turn.end) - Math.max(seg.start, turn.start)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = turn
      }
    }
    if (!best) return seg
    return { ...seg, speaker: `${labelPrefix} ${best.speaker + 1}` }
  })
}

function renderTranscript(transcript: TranscriptSegment[]): string {
  return transcript.map((s) => `${s.speaker}: ${s.text}`).join('\n')
}

/**
 * Use Claude to map generic speaker labels (e.g. "Speaker 1", "Me", "Others") to real names
 * based on transcript evidence — self-introductions ("Hi this is Priya") and direct address
 * ("Thanks Mark"). Names are suggestions: a label is only mapped when there is real evidence,
 * and is left out otherwise. Optionally constrained to a known attendees list.
 */
export async function mapSpeakerNames(
  transcript: TranscriptSegment[],
  attendees?: string[]
): Promise<Record<string, string>> {
  const labels = [...new Set(transcript.map((s) => s.speaker))]
  const attendeeLine = attendees?.length
    ? `If a name maps to a label, prefer names from this attendee list: ${attendees.join(', ')}. Do not invent names outside it.`
    : 'There is no attendee list; infer names only from explicit evidence in the transcript.'
  const prompt = `Map each generic speaker label to the real person's name, using ONLY evidence in the transcript such as self-introductions ("Hi, this is Priya") or direct address ("Thanks, Mark"). The labels in use are: ${labels.join(', ')}.
${attendeeLine}
Return a JSON object mapping label -> name, e.g. {"Speaker 1": "Priya", "Speaker 2": "Mark"}.
Rules: only include a label when you have real evidence for its name. Leave a label OUT entirely if the name is unknown — never guess. Output ONLY valid minified JSON, no markdown, no commentary.

TRANSCRIPT:
${renderTranscript(transcript)}`
  return runClaudeJSON<Record<string, string>>(
    prompt,
    'You identify meeting speakers from transcript evidence only. You never guess names. Output ONLY valid minified JSON.'
  )
}
