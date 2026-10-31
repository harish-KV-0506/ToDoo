import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { Code2, Gamepad2, Pencil, Play, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommunityGame, Database, GameActivity, GameGenre } from './lib/types'

type Props = {
  supabase: SupabaseClient<Database>
  user: User
}

const templates: { name: string; genre: GameGenre; html: string }[] = [
  {
    name: 'Click challenge',
    genre: 'arcade',
    html: `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font:20px system-ui;text-align:center;padding:30px;background:#f4f6ef;color:#30352b}
button{font:inherit;padding:15px 24px;border:0;border-radius:12px;background:#64764f;color:white;cursor:pointer}
</style></head><body>
<h1>Click challenge</h1><p id="score">Score: 0</p>
<button onclick="document.querySelector('#score').textContent='Score: '+(++score)">Click me!</button>
<script>let score=0</script></body></html>`,
  },
  {
    name: 'Number guess',
    genre: 'puzzle',
    html: `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font:18px system-ui;text-align:center;padding:30px;background:#f4f6ef;color:#30352b}
input,button{font:inherit;padding:10px;border:1px solid #ccd2c2;border-radius:8px}
</style></head><body>
<h1>Number guess</h1><p>Guess a number from 1 to 10.</p>
<input id="guess" type="number" min="1" max="10"><button onclick="check()">Guess</button><p id="result"></p>
<script>const answer=Math.ceil(Math.random()*10);function check(){document.querySelector('#result').textContent=Number(document.querySelector('#guess').value)===answer?'You got it!':'Try again!'}</script>
</body></html>`,
  },
  {
    name: 'Make your own',
    genre: 'other',
    html: `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font:18px system-ui;text-align:center;padding:30px;background:#f4f6ef;color:#30352b}
</style></head><body><h1>My game</h1><p>Change this page and make it your own.</p></body></html>`,
  },
]

const genres: { value: GameGenre; label: string }[] = [
  { value: 'arcade', label: 'Arcade' },
  { value: 'puzzle', label: 'Puzzle' },
  { value: 'platformer', label: 'Platformer' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'other', label: 'Other' },
]

function currentStreakDates() {
  const today = new Date()
  return Array.from({ length: 367 }, (_, offset) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })
}

function activityStreak(activity: GameActivity[], type: GameActivity['activity_type'], dateKeys: string[]) {
  const activeDates = new Set(activity.filter((item) => item.activity_type === type).map((item) => item.activity_date))
  let offset = activeDates.has(dateKeys[0]) ? 0 : activeDates.has(dateKeys[1]) ? 1 : -1
  if (offset < 0) return 0
  let streak = 0
  while (dateKeys[offset] && activeDates.has(dateKeys[offset])) {
    streak += 1
    offset += 1
  }
  return streak
}

function gameDocument(html: string) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; navigate-to 'none'">`
  const head = /<head[^>]*>/i
  return head.test(html)
    ? html.replace(head, (opening) => `${opening}${policy}`)
    : `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`
}

function currentActivityTimestamp() {
  const now = new Date()
  return {
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    timestamp: now.toISOString(),
  }
}

export default function GamesStudio({ supabase, user }: Props) {
  const [games, setGames] = useState<CommunityGame[]>([])
  const [authors, setAuthors] = useState<Record<string, string>>({})
  const [activity, setActivity] = useState<GameActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [streakDates] = useState(currentStreakDates)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [genreFilter, setGenreFilter] = useState<GameGenre | 'all'>('all')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [genre, setGenre] = useState<GameGenre>('arcade')
  const [source, setSource] = useState(templates[0].html)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)

  const loadGames = useCallback(async () => {
    const [gamesResult, profilesResult, activityResult] = await Promise.all([
      supabase.from('community_games').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('profiles').select('user_id, display_name').order('display_name').limit(200),
      supabase.from('game_activity').select('*').eq('user_id', user.id).order('activity_date', { ascending: false }).limit(800),
    ])
    if (gamesResult.error) throw gamesResult.error
    if (profilesResult.error) throw profilesResult.error
    if (activityResult.error) throw activityResult.error

    setGames(gamesResult.data)
    setAuthors(Object.fromEntries(profilesResult.data.map((profile) => [profile.user_id, profile.display_name])))
    setActivity(activityResult.data)
    setLoading(false)
  }, [supabase, user.id])

  useEffect(() => {
    let active = true
    void loadGames().catch((loadError: Error) => {
      if (active) {
        setError(`Could not load the game library: ${loadError.message}`)
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [loadGames])

  useEffect(() => {
    const channel = supabase
      .channel(`community-games:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_games' }, () => {
        void loadGames().catch((loadError: Error) => setError(`Could not refresh the game library: ${loadError.message}`))
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [supabase, user.id, loadGames])

  const filteredGames = useMemo(() => games.filter((game) =>
    (genreFilter === 'all' || game.genre === genreFilter)
    && (!search.trim() || `${game.title} ${game.description} ${authors[game.author_id] ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())),
  ), [games, genreFilter, search, authors])

  const recordActivity = async (type: GameActivity['activity_type']) => {
    const now = currentActivityTimestamp()
    const activityDate = now.date
    const { error: activityError } = await supabase.from('game_activity').upsert({
      user_id: user.id,
      activity_date: activityDate,
      activity_type: type,
    }, { onConflict: 'user_id,activity_date,activity_type', ignoreDuplicates: true })
    if (activityError) throw activityError
    setActivity((current) => current.some((item) => item.activity_date === activityDate && item.activity_type === type)
      ? current
      : [...current, { user_id: user.id, activity_date: activityDate, activity_type: type, created_at: now.timestamp }])
  }

  const resetEditor = () => {
    setTitle('')
    setDescription('')
    setGenre('arcade')
    setSource(templates[0].html)
    setEditingId(null)
  }

  const applyTemplate = (name: string) => {
    const selected = templates.find((template) => template.name === name)
    if (!selected) return
    setGenre(selected.genre)
    setSource(selected.html)
  }

  const uploadSource = async (file: File | undefined) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.html') || file.size > 60_000) {
      setError('Choose an .html file smaller than 60 KB.')
      return
    }
    try {
      setSource(await file.text())
      setError('')
    } catch (readError) {
      setError(`Could not read the HTML file: ${(readError as Error).message}`)
    }
  }

  const saveGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim() || !source.trim()) return
    if (source.length > 60_000) {
      setError('Game code must be 60 KB or smaller.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    const gameValues = {
      title: title.trim(),
      description: description.trim(),
      genre,
      html: source,
    }
    const gameResult = editingId
      ? await supabase.from('community_games').update(gameValues).eq('id', editingId).eq('author_id', user.id).select('*').single()
      : await supabase.from('community_games').insert({ ...gameValues, author_id: user.id }).select('*').single()
    if (gameResult.error) {
      setError(`Could not ${editingId ? 'update' : 'publish'} your game: ${gameResult.error.message}`)
      setSaving(false)
      return
    }
    setGames((current) => editingId
      ? current.map((game) => game.id === editingId ? gameResult.data : game)
      : [gameResult.data, ...current])
    try {
      await recordActivity('created')
      setNotice(editingId ? 'Your game has been updated.' : 'Your game is published for the ToDoo community.')
      resetEditor()
    } catch (activityError) {
      setError(`Your game was saved, but your creation streak could not be updated: ${(activityError as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const startEditing = (game: CommunityGame) => {
    setTitle(game.title)
    setDescription(game.description)
    setGenre(game.genre)
    setSource(game.html)
    setEditingId(game.id)
    setPlayingId(null)
    document.getElementById('game-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const deleteGame = async (game: CommunityGame) => {
    if (!window.confirm(`Delete “${game.title}”? This cannot be undone.`)) return
    const { error: deleteError } = await supabase.from('community_games').delete().eq('id', game.id).eq('author_id', user.id)
    if (deleteError) {
      setError(`Could not delete your game: ${deleteError.message}`)
      return
    }
    setGames((current) => current.filter((item) => item.id !== game.id))
    if (playingId === game.id) setPlayingId(null)
    setNotice('Your game has been deleted.')
  }

  const playGame = async (game: CommunityGame) => {
    setPlayingId(game.id)
    setError('')
    setNotice('')
    try {
      await recordActivity('played')
    } catch (activityError) {
      setError(`The game is open, but your play streak could not be updated: ${(activityError as Error).message}`)
    }
  }

  const playingGame = games.find((game) => game.id === playingId)

  return (
    <section className="games-content">
      <header className="games-heading">
        <div>
          <p className="eyebrow"><Sparkles size={13} /> Make, share, play</p>
          <h1>A little game goes a long way.</h1>
          <p className="board-subtitle">Build a browser game, share it with the community, and play what others are making.</p>
        </div>
        <div className="games-streaks" aria-label="Your current streaks">
          <span><Code2 size={16} /><strong>{activityStreak(activity, 'created', streakDates)}</strong><small>create streak</small></span>
          <span><Gamepad2 size={16} /><strong>{activityStreak(activity, 'played', streakDates)}</strong><small>play streak</small></span>
        </div>
      </header>

      {error && <div className="network-alert network-alert-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
      {notice && <div className="network-alert network-alert-success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={15} /></button></div>}

      <form className="game-builder-card" onSubmit={(event) => void saveGame(event)}>
        <div className="network-section-heading">
          <div><h2>{editingId ? 'Edit your game' : 'Build a game'}</h2><p>Write or upload one self-contained HTML game. The starter templates are optional.</p></div>
          {editingId && <button className="quiet-button" type="button" onClick={resetEditor}>Cancel edit</button>}
        </div>
        <div className="game-builder-fields">
          <label>Game title<input id="game-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="e.g. Tiny space adventure" required /></label>
          <label>Game type<select value={genre} onChange={(event) => setGenre(event.target.value as GameGenre)}>{genres.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="game-description-field">Description<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="What should players know?" required /></label>
          <label>Start with a template<select defaultValue="" onChange={(event) => applyTemplate(event.target.value)}><option value="" disabled>Choose a starter</option>{templates.map((template) => <option value={template.name} key={template.name}>{template.name}</option>)}</select></label>
        </div>
        <label className="game-code-label" htmlFor="game-source">Your HTML, CSS and JavaScript</label>
        <textarea id="game-source" className="game-code-editor" value={source} onChange={(event) => setSource(event.target.value)} maxLength={60_000} spellCheck={false} required />
        <div className="game-builder-footer">
          <label className="game-upload-button"><Upload size={15} /> Upload .html<input type="file" accept=".html,text/html" onChange={(event) => void uploadSource(event.currentTarget.files?.[0])} /></label>
          <small>{source.length.toLocaleString()}/60,000 characters · Games are sandboxed and can't access ToDoo data.</small>
          <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : <><Plus size={15} /> {editingId ? 'Save changes' : 'Publish game'}</>}</button>
        </div>
      </form>

      {playingGame && (
        <section className="game-player-card" aria-label={`${playingGame.title} game player`}>
          <div className="network-section-heading">
            <div><p className="eyebrow"><Gamepad2 size={13} /> Now playing</p><h2>{playingGame.title}</h2></div>
            <button className="quiet-button" onClick={() => setPlayingId(null)}><X size={15} /> Close game</button>
          </div>
          <iframe
            className="game-frame"
            title={`${playingGame.title} by ${authors[playingGame.author_id] ?? 'ToDoo member'}`}
            srcDoc={gameDocument(playingGame.html)}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
          />
          <p className="game-sandbox-note">This game runs in an isolated browser sandbox. It cannot access your ToDoo account or send network requests.</p>
        </section>
      )}

      <section className="game-library">
        <div className="network-section-heading">
          <div><h2>Community games</h2><p>Games from ToDoo members, ready to try.</p></div>
          <label className="network-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a game" aria-label="Find a game" /></label>
        </div>
        <div className="game-filter-row">
          <button className={genreFilter === 'all' ? 'game-filter-active' : ''} onClick={() => setGenreFilter('all')}>All games</button>
          {genres.map((item) => <button className={genreFilter === item.value ? 'game-filter-active' : ''} key={item.value} onClick={() => setGenreFilter(item.value)}>{item.label}</button>)}
        </div>
        {loading ? (
          <div className="network-empty"><Gamepad2 size={22} /><p>Loading games…</p></div>
        ) : filteredGames.length ? (
          <div className="game-grid">
            {filteredGames.map((game) => (
              <article className="game-card" key={game.id}>
                <div className="game-card-icon"><Gamepad2 size={20} /></div>
                <span className="game-genre">{genres.find((item) => item.value === game.genre)?.label ?? 'Other'}</span>
                <h3>{game.title}</h3>
                <p>{game.description}</p>
                <small>By {authors[game.author_id] ?? 'ToDoo member'} · {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(game.created_at))}</small>
                <div className="game-card-actions">
                  <button className="primary-button" onClick={() => void playGame(game)}><Play size={14} /> Play</button>
                  {game.author_id === user.id && <>
                    <button className="icon-quiet" onClick={() => startEditing(game)} aria-label={`Edit ${game.title}`}><Pencil size={15} /></button>
                    <button className="icon-quiet" onClick={() => void deleteGame(game)} aria-label={`Delete ${game.title}`}><Trash2 size={15} /></button>
                  </>}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="network-empty"><Gamepad2 size={22} /><h2>No games found yet</h2><p>Try a different search, or publish the first game for the community.</p></div>
        )}
      </section>
    </section>
  )
}
