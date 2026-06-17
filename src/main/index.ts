import { app, shell, BrowserWindow, ipcMain, session, desktopCapturer } from 'electron'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { generateNotes, generateChapters, askMeeting } from './claude.js'
import { buildAnalytics } from './analytics.js'
import { buildCoaching } from './coaching.js'
import { runDiarization, assignSpeakers, mapSpeakerNames } from './diarize.js'
import { analyzeFrames, screensToContext } from './screen-vision.js'
import { exportMeetingMarkdown } from './export.js'
import { saveMeeting, listMeetings, getMeeting, saveAudio, readAudio, saveFrames, readFrame } from './store.js'
import type { Chapter, CoachingMetric, Meeting, ScreenCapture, TranscriptSegment } from './types.js'

/**
 * Separate the remote speakers and give everyone real names. The mixed "Others" channel
 * is diarized into distinct speakers, then Claude maps the generic labels (and "Me") to
 * names from transcript evidence. Best-effort: any failure falls back to Me/Others.
 */
async function diarizeAndName(
  transcript: TranscriptSegment[],
  systemWav?: Uint8Array
): Promise<TranscriptSegment[]> {
  if (!systemWav) return transcript
  const tmp = join(tmpdir(), `recap-diar-${randomUUID()}.wav`)
  let result = transcript
  try {
    writeFileSync(tmp, systemWav)
    const turns = await runDiarization(tmp, -1)
    const others = result.filter((s) => s.speaker === 'Others')
    if (others.length && turns.length) {
      const relabeled = assignSpeakers(others, turns)
      let k = 0
      result = result.map((s) => (s.speaker === 'Others' ? relabeled[k++] : s))
    }
    try {
      const names = await mapSpeakerNames(result)
      if (names && Object.keys(names).length) {
        // Keep "Me" literal — it's the stable marker for the user (their mic channel), used by
        // coaching and personal feedback. Only the other speakers get mapped to real names.
        result = result.map((s) => (s.speaker === 'Me' ? s : { ...s, speaker: names[s.speaker] ?? s.speaker }))
      }
    } catch {
      // names are best-effort; keep the Speaker N labels
    }
  } catch (e) {
    console.log('[diarize] failed, keeping Me/Others:', (e as Error).message)
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      // temp file may already be gone
    }
  }
  return result
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#080304',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler((d) => {
    shell.openExternal(d.url)
    return { action: 'deny' }
  })

  // Surface renderer errors to the terminal so we can debug a blank window.
  win.webContents.on('console-message', (...args: unknown[]) => {
    const a = args as Array<{ message?: string } | string | number>
    const msg = typeof a[0] === 'object' ? a[0]?.message : a[2]
    console.log('[renderer]', msg ?? args)
  })
  win.webContents.on('render-process-gone', (_e, d) => console.log('[renderer gone]', d.reason))
  win.webContents.on('did-fail-load', (_e, code, desc) => console.log('[did-fail-load]', code, desc))

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    if (!process.env.RECAP_REMOTE_DEBUG) win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// Opt-in remote debugging for live UI tests (off unless RECAP_REMOTE_DEBUG is set).
if (process.env.RECAP_REMOTE_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.RECAP_REMOTE_DEBUG)
}

app.whenReady().then(() => {
  // Grant system-audio loopback capture so getDisplayMedia returns the meeting's audio
  // without a screen picker. On macOS this uses ScreenCaptureKit under the hood.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' })
      })
    },
    { useSystemPicker: true }
  )

  ipcMain.handle(
    'process-meeting',
    async (
      _e,
      payload: {
        transcript: TranscriptSegment[]
        durationSeconds: number
        audio?: Uint8Array
        systemWav?: Uint8Array
        frames?: { timeSec: number; bytes: Uint8Array }[]
      }
    ): Promise<Meeting> => {
      const { durationSeconds, audio, systemWav, frames } = payload
      const id = randomUUID()
      const transcript = await diarizeAndName(payload.transcript, systemWav)
      // Vision over shared screens runs alongside the transcript analysis; notes wait for it
      // so the summary can fold in what was on screen.
      const [analytics, chapters, coaching, screens] = await Promise.all([
        buildAnalytics(transcript),
        generateChapters(transcript).catch((): Chapter[] => []),
        buildCoaching(transcript).catch((): CoachingMetric[] => []),
        frames?.length
          ? analyzeFrames(saveFrames(id, frames)).catch((): ScreenCapture[] => [])
          : Promise.resolve([] as ScreenCapture[])
      ])
      const notes = await generateNotes(transcript, screens.length ? screensToContext(screens) : undefined)
      const meeting: Meeting = {
        id,
        createdAt: new Date().toISOString(),
        title: notes.title,
        durationSeconds: durationSeconds || analytics.durationSeconds,
        transcript,
        notes,
        analytics,
        chapters,
        coaching,
        screens,
        audioPath: audio ? saveAudio(id, audio) : undefined
      }
      saveMeeting(meeting)
      return meeting
    }
  )

  ipcMain.handle('list-meetings', () => listMeetings())
  ipcMain.handle('get-meeting', (_e, id: string) => getMeeting(id))
  ipcMain.handle('get-audio', (_e, id: string) => readAudio(id))
  ipcMain.handle('get-frame', (_e, p: { id: string; index: number }) => readFrame(p.id, p.index))
  ipcMain.handle('export-markdown', async (_e, id: string): Promise<string | null> => {
    try {
      const m = getMeeting(id)
      if (!m) return null
      const path = await exportMeetingMarkdown(m)
      shell.showItemInFolder(path)
      return path
    } catch (e) {
      console.log('[export] failed:', (e as Error).message)
      return null
    }
  })

  ipcMain.handle('ask', async (_e, payload: { question: string; meetingIds?: string[] }) => {
    const meetings = (payload.meetingIds?.length
      ? payload.meetingIds.map(getMeeting).filter(Boolean)
      : listMeetings()) as Meeting[]
    const context = meetings
      .map(
        (m) =>
          `## ${m.title} (${new Date(m.createdAt).toLocaleString()})\n` +
          m.transcript.map((s) => `${s.speaker}: ${s.text}`).join('\n')
      )
      .join('\n\n')
    return askMeeting(payload.question, context)
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
