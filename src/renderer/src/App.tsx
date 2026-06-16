import { useEffect, useRef, useState } from 'react'
import { Recorder } from './recorder.js'
import { warmup } from '../../main/transcribe.js'
import type { Meeting } from '../../main/types.js'

type Status = 'idle' | 'recording' | 'processing'

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [selected, setSelected] = useState<Meeting | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [stage, setStage] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [engine, setEngine] = useState<'loading' | 'ready' | 'error'>('loading')
  const recorder = useRef<Recorder | null>(null)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)

  useEffect(() => {
    window.recap.listMeetings().then(setMeetings)
    warmup().then(
      () => setEngine('ready'),
      () => setEngine('error')
    )
  }, [])

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
    setStage('Reading shared screens, identifying speakers & writing notes…')
    const meeting = await window.recap.processMeeting({ transcript, durationSeconds, audio, systemWav, frames })
    setMeetings(await window.recap.listMeetings())
    setSelected(meeting)
    setStatus('idle')
  }

  return (
    <div className="flex h-full">
      <aside className="w-[300px] shrink-0 border-r border-[#2a1c1d] bg-[#0d0708] flex flex-col">
        <div className="px-5 pt-12 pb-5">
          <h1 className="font-serif text-2xl tracking-tight">Recap</h1>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                engine === 'ready' ? 'bg-[#5fd38d]' : engine === 'error' ? 'bg-[#ff5a69]' : 'bg-[#ff9d6c] rec-dot'
              }`}
            />
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#9b8a87]">
              {engine === 'ready' ? 'engine ready' : engine === 'error' ? 'engine error' : 'loading engine…'}
            </p>
          </div>
        </div>

        <div className="px-4 pb-4">
          {status === 'recording' ? (
            <button
              onClick={stopRec}
              className="w-full rounded-xl bg-[#ff5a69] py-3 font-medium text-[#1a0405] flex items-center justify-center gap-2 hover:brightness-110 transition"
            >
              <span className="rec-dot h-2.5 w-2.5 rounded-full bg-[#1a0405]" />
              Stop · {fmtDur(elapsed)}
            </button>
          ) : (
            <button
              onClick={startRec}
              disabled={status === 'processing'}
              className="w-full rounded-xl border border-[#ff5a69]/40 bg-[#ff5a69]/10 py-3 font-medium text-[#ff9d6c] hover:bg-[#ff5a69]/20 transition disabled:opacity-40"
            >
              {status === 'processing' ? stage : '● Record a meeting'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {meetings.length === 0 && (
            <p className="px-3 py-6 text-sm text-[#9b8a87]">No meetings yet. Hit record on your next call.</p>
          )}
          {meetings.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              className={`w-full text-left rounded-lg px-3 py-2.5 mb-1 transition ${
                selected?.id === m.id ? 'bg-[#1f1213]' : 'hover:bg-[#160d0e]'
              }`}
            >
              <div className="text-sm font-medium truncate">{m.title}</div>
              <div className="text-[11px] text-[#9b8a87] mt-0.5">
                {fmtDate(m.createdAt)} · {fmtDur(m.durationSeconds)}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {selected ? (
          <MeetingView key={selected.id} meeting={selected} />
        ) : (
          <div className="h-full flex items-center justify-center text-center px-8">
            <div className="max-w-md">
              <h2 className="font-serif text-3xl mb-3">Never take meeting notes again.</h2>
              <p className="text-[#9b8a87] leading-relaxed">
                Recap records your call locally, transcribes it on your machine, and writes the summary,
                action items, and analytics with your Claude subscription. Nothing leaves your laptop except
                the prompt.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

type Tab = 'recap' | 'deepdive' | 'coaching' | 'screens' | 'transcript'

function MeetingView({ meeting }: { meeting: Meeting }) {
  const [tab, setTab] = useState<Tab>('recap')
  const tabs: [Tab, string][] = [
    ['recap', 'Recap'],
    ['deepdive', 'Deep Dive'],
    ['coaching', 'Coaching'],
    ...(meeting.screens?.length ? ([['screens', `Screens (${meeting.screens.length})`]] as [Tab, string][]) : []),
    ['transcript', 'Transcript']
  ]
  const audioRef = useRef<HTMLAudioElement>(null)
  const [src, setSrc] = useState('')
  const [time, setTime] = useState(0)

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
    <div className="px-10 py-10 max-w-4xl">
      <div className="text-[11px] uppercase tracking-[0.2em] text-[#9b8a87]">
        {fmtDate(meeting.createdAt)} · {fmtDur(meeting.durationSeconds)}
      </div>
      <h2 className="font-serif text-4xl mt-2 leading-tight">{meeting.title}</h2>

      {src && <Player audioRef={audioRef} src={src} time={time} setTime={setTime} duration={meeting.durationSeconds} />}

      <div className="flex gap-1 mt-7 border-b border-[#2a1c1d]">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm -mb-px border-b-2 transition ${
              tab === key ? 'border-[#ff5a69] text-[#f2e9e7]' : 'border-transparent text-[#9b8a87] hover:text-[#f2e9e7]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-7">
        {tab === 'recap' && <Notes meeting={meeting} />}
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
    <div className="mt-6 rounded-xl border border-[#2a1c1d] bg-[#0d0708] p-4 flex items-center gap-4">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button
        onClick={toggle}
        className="h-10 w-10 shrink-0 rounded-full bg-[#ff5a69] text-[#1a0405] flex items-center justify-center hover:brightness-110 transition"
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="flex-1 cursor-pointer py-2" onClick={scrub}>
        <div className="h-1.5 rounded-full bg-[#160d0e]">
          <div className="h-full rounded-full bg-[#ff5a69]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="font-mono text-xs text-[#9b8a87] shrink-0">
        {fmtDur(Math.floor(time))} / {fmtDur(duration)}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="text-[11px] uppercase tracking-[0.2em] text-[#ff9d6c] mb-3">{title}</h3>
      {children}
    </section>
  )
}

function Notes({ meeting }: { meeting: Meeting }) {
  const n = meeting.notes
  return (
    <div>
      <p className="text-lg leading-relaxed text-[#e8dcd9] mb-8">{n.summary}</p>

      {meeting.chapters?.length > 0 && (
        <Section title="Chapters">
          <div className="space-y-2.5">
            {meeting.chapters.map((c, i) => (
              <div key={i} className="flex gap-3">
                <span className="font-mono text-xs text-[#9b8a87] pt-0.5 w-10 shrink-0">{fmtDur(Math.round(c.start))}</span>
                <div>
                  <div className="text-sm font-medium">{c.title}</div>
                  <div className="text-sm text-[#9b8a87]">{c.summary}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {n.actionItems.length > 0 && (
        <Section title="Action items">
          <ul className="space-y-2">
            {n.actionItems.map((a, i) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#ff5a69] shrink-0" />
                <span>
                  {a.task}
                  {a.owner && <span className="text-[#ff9d6c]"> — {a.owner}</span>}
                  {a.due && <span className="text-[#9b8a87]"> · {a.due}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {n.decisions.length > 0 && (
        <Section title="Decisions">
          <ul className="space-y-2">
            {n.decisions.map((d, i) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#9b8a87] shrink-0" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {n.keyPoints.length > 0 && (
        <Section title="Key points">
          <ul className="space-y-2 text-[#cdbfbc]">
            {n.keyPoints.map((p, i) => (
              <li key={i} className="flex gap-3 items-start">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#3a2a2b] shrink-0" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {n.questions.length > 0 && (
        <Section title="Open questions">
          <ul className="space-y-2 text-[#cdbfbc]">
            {n.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </Section>
      )}

      {n.topics.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {n.topics.map((t, i) => (
            <span key={i} className="rounded-full bg-[#160d0e] border border-[#2a1c1d] px-3 py-1 text-xs text-[#9b8a87]">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const SENT_COLOR = { positive: '#5fd38d', neutral: '#9b8a87', mixed: '#ff9d6c', negative: '#ff5a69' }
const scoreColor = (n: number) => (n >= 80 ? '#5fd38d' : n >= 70 ? '#ff9d6c' : '#ff5a69')

function DeepDive({ meeting }: { meeting: Meeting }) {
  const a = meeting.analytics
  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl border border-[#2a1c1d] bg-[#0d0708] p-5">
          <div className="text-[11px] uppercase tracking-[0.2em] text-[#9b8a87]">Read Score</div>
          <div className="font-serif text-5xl mt-2" style={{ color: scoreColor(a.readScore ?? 0) }}>
            {a.readScore ?? '—'}
          </div>
          <p className="text-sm text-[#9b8a87] mt-2 leading-snug">Average of sentiment & engagement.</p>
        </div>
        <div className="rounded-xl border border-[#2a1c1d] bg-[#0d0708] p-5">
          <div className="text-[11px] uppercase tracking-[0.2em] text-[#9b8a87]">Engagement</div>
          <div className="font-serif text-5xl mt-2">{a.engagement}</div>
          <p className="text-sm text-[#9b8a87] mt-2 leading-snug">{a.engagementReason}</p>
        </div>
        <div className="rounded-xl border border-[#2a1c1d] bg-[#0d0708] p-5">
          <div className="text-[11px] uppercase tracking-[0.2em] text-[#9b8a87]">Sentiment</div>
          <div className="font-serif text-5xl mt-2" style={{ color: SENT_COLOR[a.sentiment] }}>
            {a.sentimentScore ?? '—'}
          </div>
          <p className="text-sm text-[#9b8a87] mt-2 leading-snug">{a.sentimentReason}</p>
        </div>
      </div>

      <Section title="Talk time">
        <div className="space-y-3">
          {a.speakerStats.map((s) => (
            <div key={s.speaker}>
              <div className="flex justify-between text-sm mb-1">
                <span>{s.speaker}</span>
                <span className="text-[#9b8a87] font-mono">
                  {Math.round(s.talkShare * 100)}% · {fmtDur(s.talkSeconds)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#160d0e] overflow-hidden">
                <div className="h-full bg-[#ff5a69]" style={{ width: `${s.talkShare * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {a.standings?.length > 0 && (
        <Section title="Participant standings">
          <div className="space-y-2">
            {a.standings.map((s) => (
              <div
                key={s.speaker}
                className="flex items-center justify-between rounded-lg border border-[#2a1c1d] bg-[#0d0708] px-4 py-3"
              >
                <span className="text-sm font-medium">{s.speaker}</span>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-[#9b8a87]">
                    talk <span className="text-[#f2e9e7] font-mono">{Math.round(s.talkShare * 100)}%</span>
                  </span>
                  <span className="text-[#9b8a87]">
                    engagement <span className="font-mono" style={{ color: scoreColor(s.engagement) }}>{s.engagement}</span>
                  </span>
                  <span className="capitalize" style={{ color: SENT_COLOR[s.sentiment] }}>
                    {s.sentiment}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>
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
    <div className="space-y-6">
      {coaching.map((c) => (
        <div key={c.speaker} className="rounded-xl border border-[#2a1c1d] bg-[#0d0708] p-5">
          <div className="text-sm font-medium mb-4">{c.speaker}</div>
          <div className="grid grid-cols-3 gap-y-5 gap-x-4 sm:grid-cols-6">
            {stat('Talk', `${Math.round(c.talkRatio * 100)}%`)}
            {stat('Pace', `${c.wpm}`, c.wpm > 0 && (c.wpm < 130 || c.wpm > 175))}
            {stat('Fillers', `${c.fillerCount}`, c.fillerRate >= 0.04)}
            {stat('Questions', `${c.questionsAsked}`)}
            {stat('Monologue', fmtDur(c.longestMonologueSec))}
            {stat('Interrupts', `${c.interruptions}`, c.interruptions > 0)}
          </div>
          {c.tips.length > 0 && (
            <ul className="mt-5 space-y-2 border-t border-[#2a1c1d] pt-4">
              {c.tips.map((t, i) => (
                <li key={i} className="flex gap-3 items-start text-sm text-[#cdbfbc]">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#ff5a69] shrink-0" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-xs text-[#6b5a57]">
        Pace ideal 130–175 wpm · fillers flagged above 4% of words. Charisma/bias omitted — Read derives those from video.
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
    <div className="space-y-6">
      {screens.map((s) => (
        <div key={s.index} className="rounded-xl border border-[#2a1c1d] bg-[#0d0708] overflow-hidden">
          {urls[s.index] && (
            <img
              src={urls[s.index]}
              onClick={() => seek(s.timeSec)}
              className="w-full cursor-pointer border-b border-[#2a1c1d]"
            />
          )}
          <div className="p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{s.title}</span>
              <button
                onClick={() => seek(s.timeSec)}
                className="font-mono text-xs text-[#9b8a87] hover:text-[#ff9d6c] shrink-0"
              >
                {fmtDur(Math.round(s.timeSec))}
              </button>
            </div>
            {s.text && <p className="mt-2 text-sm text-[#cdbfbc] whitespace-pre-wrap leading-relaxed">{s.text}</p>}
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
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search transcript…"
        className="w-full mb-5 rounded-lg bg-[#0d0708] border border-[#2a1c1d] px-4 py-2.5 text-sm outline-none focus:border-[#ff5a69]/50"
      />
      <div className="space-y-1">
        {segs.length === 0 && <p className="text-sm text-[#9b8a87]">No matches.</p>}
        {segs.map((s, i) => {
          const active = time >= s.start && time < (s.end > s.start ? s.end : s.start + 4)
          const ci = chapterOf(s.start)
          const showHeader = ci >= 0 && ci !== chapterOf(i > 0 ? segs[i - 1].start : -1)
          return (
            <div key={i}>
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
                  <span className="text-xs font-mono text-[#9b8a87]">{fmtDur(Math.round(s.start))}</span>
                </div>
                <div>
                  <span className={`text-sm font-medium ${s.speaker === 'Me' ? 'text-[#ff9d6c]' : 'text-[#9bb8d3]'}`}>
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
    <div className="mt-12 border-t border-[#2a1c1d] pt-6">
      <h3 className="text-[11px] uppercase tracking-[0.2em] text-[#ff9d6c] mb-3">Ask Recap</h3>
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="What did we decide about pricing?"
          className="flex-1 rounded-lg bg-[#0d0708] border border-[#2a1c1d] px-4 py-2.5 text-sm outline-none focus:border-[#ff5a69]/50"
        />
        <button
          onClick={ask}
          disabled={loading}
          className="rounded-lg bg-[#ff5a69] px-5 text-sm font-medium text-[#1a0405] hover:brightness-110 transition disabled:opacity-40"
        >
          {loading ? '…' : 'Ask'}
        </button>
      </div>
      {a && <p className="mt-4 text-[#cdbfbc] leading-relaxed whitespace-pre-wrap">{a}</p>}
    </div>
  )
}
