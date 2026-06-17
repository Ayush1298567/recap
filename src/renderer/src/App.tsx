import { useEffect, useRef, useState } from 'react'
import { Recorder } from './recorder.js'
import { warmup } from '../../main/transcribe.js'
import type { Meeting } from '../../main/types.js'

type Status = 'idle' | 'recording' | 'processing'

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const clock = (s: number) => fmtDur(Math.round(s))
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const SENT_COLOR = { positive: '#5fd38d', neutral: '#9b8a87', mixed: '#ff9d6c', negative: '#ff5a69' }
const scoreColor = (n: number) => (n >= 80 ? '#5fd38d' : n >= 70 ? '#ff9d6c' : '#ff5a69')
const speakerColor = (s: string) => (s === 'Me' ? '#ff9d6c' : '#9bb8d3')

async function copyText(t: string) {
  try {
    await navigator.clipboard.writeText(t)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = t
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={async () => {
        await copyText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition ${
        done
          ? 'border-[#5fd38d]/40 text-[#5fd38d]'
          : 'border-[#2a1c1d] text-[#9b8a87] hover:text-[#ff9d6c] hover:border-[#3a2a2b]'
      }`}
    >
      {done ? '✓ Copied' : `⧉ ${label}`}
    </button>
  )
}

/** Mini soundwave wordmark — echoes the app icon. */
function Mark() {
  const bars = [9, 17, 13, 21, 11, 15]
  return (
    <span className="flex items-end gap-[3px]" style={{ height: 22 }}>
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full"
          style={{ height: h, background: i % 3 === 0 ? '#ff9d6c' : '#ff5a69' }}
        />
      ))}
    </span>
  )
}

const participantsOf = (m: Meeting) => [...new Set(m.transcript.map((s) => s.speaker))]

export default function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [stage, setStage] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [engine, setEngine] = useState<'loading' | 'ready' | 'error'>('loading')
  const [filter, setFilter] = useState('')
  const recorder = useRef<Recorder | null>(null)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)

  useEffect(() => {
    window.recap.listMeetings().then(setMeetings)
    warmup().then(
      () => setEngine('ready'),
      () => setEngine('error')
    )
  }, [])

  const selected = meetings.find((m) => m.id === selectedId) ?? null

  async function startRec() {
    recorder.current = new Recorder()
    await recorder.current.start()
    setStatus('recording')
    setElapsed(0)
    timer.current = setInterval(() => setElapsed((e) => e + 1), 1000)
  }

  async function stopRec() {
    clearInterval(timer.current)
    setStatus('processing')
    setStage('Finishing recording…')
    const { transcript, durationSeconds, audio, systemWav, frames } = await recorder.current!.stop(setStage)
    if (!transcript.length) {
      setStage('No speech captured.')
      setStatus('idle')
      return
    }
    setStage('Reading screens, identifying speakers & writing notes…')
    const meeting = await window.recap.processMeeting({ transcript, durationSeconds, audio, systemWav, frames })
    setMeetings(await window.recap.listMeetings())
    setSelectedId(meeting.id)
    setStatus('idle')
  }

  const visible = filter
    ? meetings.filter((m) => m.title.toLowerCase().includes(filter.toLowerCase()))
    : meetings

  return (
    <div className="flex h-full">
      <aside className="w-[296px] shrink-0 border-r border-[#241718] bg-[#0b0506] flex flex-col">
        <div className="px-5 pt-12 pb-4">
          <div className="flex items-center gap-2.5">
            <Mark />
            <h1 className="font-serif text-2xl tracking-tight">Recap</h1>
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                engine === 'ready' ? 'bg-[#5fd38d]' : engine === 'error' ? 'bg-[#ff5a69]' : 'bg-[#ff9d6c] rec-dot'
              }`}
            />
            <p className="text-[10px] uppercase tracking-[0.22em] text-[#9b8a87]">
              {engine === 'ready' ? 'on-device · your claude' : engine === 'error' ? 'engine error' : 'loading engine…'}
            </p>
          </div>
        </div>

        <div className="px-4 pb-3">
          {status === 'recording' ? (
            <button
              onClick={stopRec}
              className="w-full rounded-xl bg-[#ff5a69] py-3 font-medium text-[#1a0405] flex items-center justify-center gap-2 hover:brightness-110 transition shadow-[0_0_28px_-8px_#ff5a69]"
            >
              <span className="rec-dot h-2.5 w-2.5 rounded-full bg-[#1a0405]" />
              Stop · {fmtDur(elapsed)}
            </button>
          ) : (
            <button
              onClick={startRec}
              disabled={status === 'processing'}
              className="w-full rounded-xl border border-[#ff5a69]/40 bg-[#ff5a69]/10 py-3 font-medium text-[#ff9d6c] hover:bg-[#ff5a69]/20 transition disabled:opacity-50 disabled:cursor-default"
            >
              {status === 'processing' ? (
                <span className="inline-flex items-center gap-2">
                  <span className="rec-dot h-2 w-2 rounded-full bg-[#ff9d6c]" />
                  Processing…
                </span>
              ) : (
                '● Record a meeting'
              )}
            </button>
          )}
          {status === 'processing' && <p className="mt-2 text-[11px] text-[#9b8a87] leading-snug">{stage}</p>}
        </div>

        {meetings.length > 3 && (
          <div className="px-4 pb-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter meetings…"
              className="w-full rounded-lg bg-[#0d0708] border border-[#241718] px-3 py-2 text-xs outline-none focus:border-[#ff5a69]/50"
            />
          </div>
        )}

        <div className="px-5 pt-2 pb-1.5 text-[10px] uppercase tracking-[0.22em] text-[#6b5a57]">
          {meetings.length ? `${meetings.length} meeting${meetings.length > 1 ? 's' : ''}` : 'Meetings'}
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {meetings.length === 0 && (
            <p className="px-3 py-6 text-sm text-[#9b8a87] leading-relaxed">
              No meetings yet. Hit record on your next call and Recap takes it from there.
            </p>
          )}
          {visible.map((m) => {
            const score = m.analytics?.readScore
            return (
              <button
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className={`group w-full text-left rounded-lg px-3 py-2.5 mb-1 flex items-center gap-3 transition ${
                  selectedId === m.id ? 'bg-[#1f1213]' : 'hover:bg-[#160d0e]'
                }`}
              >
                <span
                  className={`w-0.5 self-stretch rounded-full transition ${
                    selectedId === m.id ? 'bg-[#ff5a69]' : 'bg-transparent group-hover:bg-[#3a2a2b]'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{m.title}</span>
                  <span className="block text-[11px] text-[#9b8a87] mt-0.5">
                    {fmtDate(m.createdAt)} · {fmtDur(m.durationSeconds)}
                  </span>
                </span>
                {typeof score === 'number' && (
                  <span
                    className="shrink-0 font-mono text-xs tabular-nums"
                    style={{ color: scoreColor(score) }}
                    title="Read Score"
                  >
                    {score}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {selected ? <MeetingView key={selected.id} meeting={selected} /> : <EmptyState />}
      </main>
    </div>
  )
}

function EmptyState() {
  const points = [
    ['Records locally', 'Your mic + everyone’s audio, captured on your Mac. No bot joins the call.'],
    ['Transcribes on-device', 'Whisper runs on your machine — who said what, with names.'],
    ['Writes it up with Claude', 'Summary, action items, chapters, coaching, and your shared slides.']
  ]
  return (
    <div className="h-full flex items-center justify-center px-10">
      <div className="max-w-lg reveal">
        <Mark />
        <h2 className="font-serif text-4xl mt-5 leading-tight">Never take meeting notes again.</h2>
        <p className="text-[#9b8a87] leading-relaxed mt-3">
          Everything runs on your laptop and your Claude subscription. Nothing leaves except the prompt.
        </p>
        <div className="mt-8 space-y-4">
          {points.map(([h, b]) => (
            <div key={h} className="flex gap-3.5">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#ff5a69] shrink-0" />
              <div>
                <div className="text-sm font-medium">{h}</div>
                <div className="text-sm text-[#9b8a87] leading-relaxed">{b}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-[#6b5a57]">Hit “Record a meeting” to start.</p>
      </div>
    </div>
  )
}

type Tab = 'recap' | 'deepdive' | 'coaching' | 'screens' | 'transcript'

function notesDigest(m: Meeting): string {
  const n = m.notes
  const lines = [m.title, '', n.summary]
  if (n.actionItems.length)
    lines.push(
      '',
      'Action items:',
      ...n.actionItems.map((a) => `• ${a.task}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (${a.due})` : ''}`)
    )
  if (n.decisions.length) lines.push('', 'Decisions:', ...n.decisions.map((d) => `• ${d}`))
  if (n.keyPoints.length) lines.push('', 'Key points:', ...n.keyPoints.map((p) => `• ${p}`))
  return lines.join('\n')
}

function MeetingView({ meeting }: { meeting: Meeting }) {
  const [tab, setTab] = useState<Tab>('recap')
  const tabs: [Tab, string][] = [
    ['recap', 'Recap'],
    ['deepdive', 'Deep Dive'],
    ['coaching', 'Coaching'],
    ...(meeting.screens?.length ? ([['screens', `Screens · ${meeting.screens.length}`]] as [Tab, string][]) : []),
    ['transcript', 'Transcript']
  ]
  const audioRef = useRef<HTMLAudioElement>(null)
  const [src, setSrc] = useState('')
  const [time, setTime] = useState(0)
  const [exportMsg, setExportMsg] = useState('')
  const parts = participantsOf(meeting)

  async function doExport() {
    setExportMsg('Exporting…')
    const path = await window.recap.exportMarkdown(meeting.id)
    setExportMsg(path ? `Saved to ${path}` : 'Export failed — check that ~/Ayush or ~/Downloads is writable.')
  }

  useEffect(() => {
    let url = ''
    window.recap.getAudio(meeting.id).then((bytes) => {
      if (!bytes) return
      url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }))
      setSrc(url)
    })
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [meeting.id])

  const seek = (t: number) => {
    const a = audioRef.current
    if (a) {
      a.currentTime = t
      void a.play()
    }
  }

  return (
    <div className="px-10 py-10 max-w-5xl reveal">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.2em] text-[#9b8a87]">
            {fmtDate(meeting.createdAt)} · {fmtDur(meeting.durationSeconds)} · {parts.length} participant
            {parts.length > 1 ? 's' : ''}
          </div>
          <h2 className="font-serif text-[2.6rem] leading-[1.05] mt-2.5">{meeting.title}</h2>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-1.5">
          <CopyButton text={notesDigest(meeting)} label="Copy notes" />
          <button
            onClick={doExport}
            className="rounded-lg border border-[#2a1c1d] bg-[#0d0708] px-3.5 py-1.5 text-[13px] text-[#ff9d6c] hover:bg-[#160d0e] hover:border-[#3a2a2b] transition"
          >
            Export .md
          </button>
        </div>
      </div>
      {exportMsg && <div className="mt-2 text-xs font-mono text-[#9b8a87] break-all">{exportMsg}</div>}

      {src && <Player audioRef={audioRef} src={src} time={time} setTime={setTime} duration={meeting.durationSeconds} />}

      <div className="flex gap-1 mt-7 border-b border-[#241718] overflow-x-auto">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap -mb-px border-b-2 transition ${
              tab === key
                ? 'border-[#ff5a69] text-[#f2e9e7]'
                : 'border-transparent text-[#9b8a87] hover:text-[#f2e9e7]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-7">
        {tab === 'recap' && <Recap meeting={meeting} />}
        {tab === 'deepdive' && <DeepDive meeting={meeting} />}
        {tab === 'coaching' && <Coaching meeting={meeting} />}
        {tab === 'screens' && <Screens meeting={meeting} seek={seek} />}
        {tab === 'transcript' && <Transcript meeting={meeting} time={time} seek={seek} />}
      </div>

      <Ask meeting={meeting} />
    </div>
  )
}

function Player({
  audioRef,
  src,
  time,
  setTime,
  duration
}: {
  audioRef: React.RefObject<HTMLAudioElement | null>
  src: string
  time: number
  setTime: (t: number) => void
  duration: number
}) {
  const [playing, setPlaying] = useState(false)
  const dur = audioRef.current?.duration && isFinite(audioRef.current.duration) ? audioRef.current.duration : duration
  const pct = dur ? (time / dur) * 100 : 0

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }
  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current
    if (!a) return
    const r = e.currentTarget.getBoundingClientRect()
    a.currentTime = ((e.clientX - r.left) / r.width) * dur
  }

  return (
    <div className="card mt-6 p-3.5 flex items-center gap-4">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button
        onClick={toggle}
        className="h-11 w-11 shrink-0 rounded-full bg-[#ff5a69] text-[#1a0405] text-sm flex items-center justify-center hover:brightness-110 transition"
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="flex-1 cursor-pointer group py-2" onClick={scrub}>
        <div className="h-1.5 rounded-full bg-[#1c1011]">
          <div className="h-full rounded-full bg-[#ff5a69] relative" style={{ width: `${pct}%` }}>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-3 w-3 rounded-full bg-[#ff9d6c] opacity-0 group-hover:opacity-100 transition" />
          </div>
        </div>
      </div>
      <span className="font-mono text-xs text-[#9b8a87] shrink-0 tabular-nums">
        {fmtDur(Math.floor(time))} / {fmtDur(duration)}
      </span>
    </div>
  )
}

function SectionHead({ title, copy }: { title: string; copy?: string }) {
  return (
    <div className="flex items-center justify-between mb-3 gap-3">
      <h3 className="text-[11px] uppercase tracking-[0.2em] text-[#ff9d6c]">{title}</h3>
      {copy != null && copy.length > 0 && <CopyButton text={copy} />}
    </div>
  )
}

function Recap({ meeting }: { meeting: Meeting }) {
  const n = meeting.notes
  const a = meeting.analytics
  const parts = participantsOf(meeting)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-8">
      {/* Left: narrative */}
      <div>
        <div className="mb-8">
          <SectionHead title="Summary" copy={n.summary} />
          <p className="text-[1.05rem] leading-relaxed text-[#e8dcd9]">{n.summary}</p>
        </div>

        {meeting.chapters?.length > 0 && (
          <section className="mb-8">
            <SectionHead title="Chapters" />
            <div className="space-y-3">
              {meeting.chapters.map((c, i) => (
                <div key={i} className="flex gap-3.5">
                  <span className="font-mono text-xs text-[#9b8a87] pt-0.5 w-10 shrink-0 tabular-nums">
                    {clock(c.start)}
                  </span>
                  <div>
                    <div className="text-sm font-medium">{c.title}</div>
                    <div className="text-sm text-[#9b8a87] leading-snug">{c.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {n.keyPoints.length > 0 && (
          <section className="mb-8">
            <SectionHead title="Key points" copy={n.keyPoints.map((p) => `• ${p}`).join('\n')} />
            <ul className="space-y-2 text-[#cdbfbc]">
              {n.keyPoints.map((p, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#3a2a2b] shrink-0" />
                  <span className="leading-relaxed">{p}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Right: at a glance + actionables */}
      <div className="space-y-6">
        {a && (
          <div className="card p-5">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#9b8a87]">Read Score</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-serif text-6xl leading-none" style={{ color: scoreColor(a.readScore ?? 0) }}>
                {a.readScore ?? '—'}
              </span>
              <span className="text-[#6b5a57] text-sm">/ 100</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-5">
              <Glance label="Engagement" value={`${a.engagement}`} />
              <Glance label="Sentiment" value={`${a.sentimentScore ?? '—'}`} color={SENT_COLOR[a.sentiment]} />
              <Glance label="Duration" value={fmtDur(meeting.durationSeconds)} />
              <Glance label="Action items" value={`${n.actionItems.length}`} />
            </div>
            <div className="mt-4 pt-4 border-t border-[#241718] flex flex-wrap gap-1.5">
              {parts.map((p) => (
                <span
                  key={p}
                  className="rounded-full bg-[#160d0e] border border-[#241718] px-2.5 py-0.5 text-[11px]"
                  style={{ color: speakerColor(p) }}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        {n.actionItems.length > 0 && (
          <section>
            <SectionHead
              title="Action items"
              copy={n.actionItems
                .map((a) => `• ${a.task}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (${a.due})` : ''}`)
                .join('\n')}
            />
            <ul className="space-y-2.5">
              {n.actionItems.map((it, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="mt-[5px] h-3.5 w-3.5 rounded border border-[#3a2a2b] shrink-0" />
                  <span className="leading-snug">
                    {it.task}
                    {it.owner && <span className="text-[#ff9d6c]"> — {it.owner}</span>}
                    {it.due && <span className="text-[#9b8a87]"> · {it.due}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {n.decisions.length > 0 && (
          <section>
            <SectionHead title="Decisions" copy={n.decisions.map((d) => `• ${d}`).join('\n')} />
            <ul className="space-y-2">
              {n.decisions.map((d, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#5fd38d] shrink-0" />
                  <span className="leading-snug">{d}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {n.questions.length > 0 && (
          <section>
            <SectionHead title="Open questions" />
            <ul className="space-y-2 text-[#cdbfbc]">
              {n.questions.map((q, i) => (
                <li key={i} className="leading-snug">
                  {q}
                </li>
              ))}
            </ul>
          </section>
        )}

        {n.topics.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {n.topics.map((t, i) => (
              <span
                key={i}
                className="rounded-full bg-[#160d0e] border border-[#241718] px-3 py-1 text-xs text-[#9b8a87]"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Glance({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-[#9b8a87]">{label}</div>
      <div className="font-serif text-2xl mt-0.5" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  )
}

function DeepDive({ meeting }: { meeting: Meeting }) {
  const a = meeting.analytics
  const cards = [
    { label: 'Read Score', value: a.readScore ?? '—', color: scoreColor(a.readScore ?? 0), note: 'Average of sentiment & engagement.' },
    { label: 'Engagement', value: a.engagement, color: undefined as string | undefined, note: a.engagementReason },
    { label: 'Sentiment', value: a.sentimentScore ?? '—', color: SENT_COLOR[a.sentiment], note: a.sentimentReason }
  ]
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="card card-hover p-5">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#9b8a87]">{c.label}</div>
            <div className="font-serif text-5xl mt-2" style={c.color ? { color: c.color } : undefined}>
              {c.value}
            </div>
            <p className="text-sm text-[#9b8a87] mt-2 leading-snug">{c.note}</p>
          </div>
        ))}
      </div>

      <section className="mb-8">
        <SectionHead title="Talk time" />
        <div className="space-y-3.5">
          {a.speakerStats.map((s) => (
            <div key={s.speaker}>
              <div className="flex justify-between text-sm mb-1.5">
                <span style={{ color: speakerColor(s.speaker) }}>{s.speaker}</span>
                <span className="text-[#9b8a87] font-mono tabular-nums">
                  {Math.round(s.talkShare * 100)}% · {fmtDur(s.talkSeconds)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#1c1011] overflow-hidden">
                <div className="h-full rounded-full bg-[#ff5a69]" style={{ width: `${s.talkShare * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {a.standings?.length > 0 && (
        <section>
          <SectionHead title="Participant standings" />
          <div className="space-y-2">
            {a.standings.map((s) => (
              <div key={s.speaker} className="card flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium" style={{ color: speakerColor(s.speaker) }}>
                  {s.speaker}
                </span>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-[#9b8a87]">
                    talk <span className="text-[#f2e9e7] font-mono tabular-nums">{Math.round(s.talkShare * 100)}%</span>
                  </span>
                  <span className="text-[#9b8a87]">
                    engagement{' '}
                    <span className="font-mono tabular-nums" style={{ color: scoreColor(s.engagement) }}>
                      {s.engagement}
                    </span>
                  </span>
                  <span className="capitalize" style={{ color: SENT_COLOR[s.sentiment] }}>
                    {s.sentiment}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Coaching({ meeting }: { meeting: Meeting }) {
  const coaching = meeting.coaching ?? []
  if (!coaching.length) return <p className="text-sm text-[#9b8a87]">No coaching data for this meeting.</p>
  const stat = (label: string, value: string, warn = false) => (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-[#9b8a87]">{label}</div>
      <div className={`font-serif text-2xl mt-0.5 ${warn ? 'text-[#ff9d6c]' : ''}`}>{value}</div>
    </div>
  )
  return (
    <div className="space-y-5">
      {coaching.map((c) => (
        <div key={c.speaker} className="card p-5">
          <div className="text-sm font-medium mb-4" style={{ color: speakerColor(c.speaker) }}>
            {c.speaker}
          </div>
          <div className="grid grid-cols-3 gap-y-5 gap-x-4 sm:grid-cols-6">
            {stat('Talk', `${Math.round(c.talkRatio * 100)}%`)}
            {stat('Pace', `${c.wpm}`, c.wpm > 0 && (c.wpm < 130 || c.wpm > 175))}
            {stat('Fillers', `${c.fillerCount}`, c.fillerRate >= 0.04)}
            {stat('Questions', `${c.questionsAsked}`)}
            {stat('Monologue', fmtDur(c.longestMonologueSec))}
            {stat('Interrupts', `${c.interruptions}`, c.interruptions > 0)}
          </div>
          {c.tips.length > 0 && (
            <ul className="mt-5 space-y-2 border-t border-[#241718] pt-4">
              {c.tips.map((t, i) => (
                <li key={i} className="flex gap-3 items-start text-sm text-[#cdbfbc]">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#ff5a69] shrink-0" />
                  <span className="leading-relaxed">{t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-xs text-[#6b5a57] leading-relaxed">
        Pace ideal 130–175 wpm · fillers flagged above 4% of words. Charisma & bias are omitted — Read AI derives
        those from video, which Recap doesn’t capture.
      </p>
    </div>
  )
}

function Screens({ meeting, seek }: { meeting: Meeting; seek: (t: number) => void }) {
  const screens = meeting.screens ?? []
  const [urls, setUrls] = useState<Record<number, string>>({})

  useEffect(() => {
    const created: string[] = []
    screens.forEach(async (s) => {
      const bytes = await window.recap.getFrame(meeting.id, s.index)
      if (!bytes) return
      const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
      created.push(u)
      setUrls((prev) => ({ ...prev, [s.index]: u }))
    })
    return () => created.forEach(URL.revokeObjectURL)
  }, [meeting.id])

  if (!screens.length) return <p className="text-sm text-[#9b8a87]">No shared screens captured.</p>
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {screens.map((s) => (
        <div key={s.index} className="card card-hover overflow-hidden flex flex-col">
          {urls[s.index] && (
            <img
              src={urls[s.index]}
              onClick={() => seek(s.timeSec)}
              className="w-full cursor-pointer border-b border-[#241718]"
              title="Jump to this moment"
            />
          )}
          <div className="p-4 flex flex-col gap-2 flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{s.title}</span>
              <button
                onClick={() => seek(s.timeSec)}
                className="font-mono text-xs text-[#9b8a87] hover:text-[#ff9d6c] shrink-0 tabular-nums"
              >
                {clock(s.timeSec)}
              </button>
            </div>
            {s.text && (
              <p className="text-sm text-[#cdbfbc] whitespace-pre-wrap leading-relaxed">{s.text}</p>
            )}
            {s.text && (
              <div className="mt-auto pt-1">
                <CopyButton text={s.text} label="Copy text" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function highlight(text: string, q: string) {
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[#ff5a69]/30 text-[#f2e9e7] rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

function Transcript({ meeting, time, seek }: { meeting: Meeting; time: number; seek: (t: number) => void }) {
  const [q, setQ] = useState('')
  const segs = q
    ? meeting.transcript.filter((s) => s.text.toLowerCase().includes(q.toLowerCase()))
    : meeting.transcript
  const fullText = meeting.transcript.map((s) => `[${clock(s.start)}] ${s.speaker}: ${s.text}`).join('\n')

  const chapters = q ? [] : meeting.chapters ?? []
  const chapterOf = (t: number) => {
    let idx = -1
    for (let k = 0; k < chapters.length; k++) {
      if (t >= chapters[k].start) idx = k
      else break
    }
    return idx
  }

  return (
    <div>
      <div className="flex gap-2 mb-5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search transcript…"
          className="flex-1 rounded-lg bg-[#0d0708] border border-[#241718] px-4 py-2.5 text-sm outline-none focus:border-[#ff5a69]/50"
        />
        <CopyButton text={fullText} label="Copy transcript" />
      </div>
      <div className="space-y-0.5">
        {segs.length === 0 && <p className="text-sm text-[#9b8a87]">No matches.</p>}
        {segs.map((s, i) => {
          const active = time >= s.start && time < (s.end > s.start ? s.end : s.start + 4)
          const ci = chapterOf(s.start)
          const showHeader = ci >= 0 && ci !== chapterOf(i > 0 ? segs[i - 1].start : -1)
          return (
            <div key={i} className="group">
              {showHeader && (
                <h4 className="text-[11px] uppercase tracking-[0.2em] text-[#ff9d6c] mt-6 mb-2 px-2">
                  {chapters[ci].title}
                </h4>
              )}
              <div
                onClick={() => seek(s.start)}
                className={`flex gap-4 cursor-pointer rounded-lg px-2 py-1.5 transition ${
                  active ? 'bg-[#1f1213]' : 'hover:bg-[#120a0b]'
                }`}
              >
                <div className="w-12 shrink-0 text-right pt-0.5">
                  <span className="text-xs font-mono text-[#9b8a87] tabular-nums">{clock(s.start)}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-medium" style={{ color: speakerColor(s.speaker) }}>
                    {s.speaker}
                  </span>
                  <p className="text-[#cdbfbc] leading-relaxed">{highlight(s.text, q)}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Ask({ meeting }: { meeting: Meeting }) {
  const [q, setQ] = useState('')
  const [a, setA] = useState('')
  const [loading, setLoading] = useState(false)

  async function ask() {
    if (!q.trim()) return
    setLoading(true)
    setA('')
    const answer = await window.recap.ask(q, [meeting.id])
    setA(answer)
    setLoading(false)
  }

  return (
    <div className="mt-12 border-t border-[#241718] pt-6">
      <h3 className="text-[11px] uppercase tracking-[0.2em] text-[#ff9d6c] mb-3">Ask Recap</h3>
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="What did we decide about pricing?"
          className="flex-1 rounded-lg bg-[#0d0708] border border-[#241718] px-4 py-2.5 text-sm outline-none focus:border-[#ff5a69]/50"
        />
        <button
          onClick={ask}
          disabled={loading}
          className="rounded-lg bg-[#ff5a69] px-5 text-sm font-medium text-[#1a0405] hover:brightness-110 transition disabled:opacity-50"
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>
      {a && (
        <div className="mt-4 card p-4">
          <p className="text-[#cdbfbc] leading-relaxed whitespace-pre-wrap">{a}</p>
          <div className="mt-3">
            <CopyButton text={a} label="Copy answer" />
          </div>
        </div>
      )}
    </div>
  )
}
