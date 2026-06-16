import { contextBridge, ipcRenderer } from 'electron'
import type { Meeting, TranscriptSegment } from '../main/types.js'

const api = {
  processMeeting: (payload: {
    transcript: TranscriptSegment[]
    durationSeconds: number
    audio?: Uint8Array
    systemWav?: Uint8Array
    frames?: { timeSec: number; bytes: Uint8Array }[]
  }): Promise<Meeting> => ipcRenderer.invoke('process-meeting', payload),
  listMeetings: (): Promise<Meeting[]> => ipcRenderer.invoke('list-meetings'),
  getMeeting: (id: string): Promise<Meeting | null> => ipcRenderer.invoke('get-meeting', id),
  getAudio: (id: string): Promise<Uint8Array | null> => ipcRenderer.invoke('get-audio', id),
  getFrame: (id: string, index: number): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('get-frame', { id, index }),
  ask: (question: string, meetingIds?: string[]): Promise<string> =>
    ipcRenderer.invoke('ask', { question, meetingIds })
}

contextBridge.exposeInMainWorld('recap', api)

export type RecapAPI = typeof api
