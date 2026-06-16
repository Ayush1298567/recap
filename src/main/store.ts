import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Meeting } from './types.js'

function dir(): string {
  const d = join(app.getPath('userData'), 'meetings')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function audioDir(): string {
  const d = join(app.getPath('userData'), 'recordings')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

export function saveAudio(id: string, bytes: Uint8Array): string {
  const p = join(audioDir(), `${id}.wav`)
  writeFileSync(p, bytes)
  return p
}

export function readAudio(id: string): Uint8Array | null {
  const p = join(audioDir(), `${id}.wav`)
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null
}

function framesDir(id: string): string {
  const d = join(app.getPath('userData'), 'frames', id)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

export function saveFrames(
  id: string,
  frames: { timeSec: number; bytes: Uint8Array }[]
): { index: number; timeSec: number; path: string }[] {
  const dir = framesDir(id)
  return frames.map((f, index) => {
    const p = join(dir, `${index}.png`)
    writeFileSync(p, f.bytes)
    return { index, timeSec: f.timeSec, path: p }
  })
}

export function readFrame(id: string, index: number): Uint8Array | null {
  const p = join(app.getPath('userData'), 'frames', id, `${index}.png`)
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null
}

export function saveMeeting(m: Meeting): void {
  writeFileSync(join(dir(), `${m.id}.json`), JSON.stringify(m, null, 2))
}

export function listMeetings(): Meeting[] {
  return readdirSync(dir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir(), f), 'utf8')) as Meeting)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getMeeting(id: string): Meeting | null {
  const p = join(dir(), `${id}.json`)
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Meeting) : null
}
