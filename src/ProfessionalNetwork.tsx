import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowUpRight, BriefcaseBusiness, Check, Clock3, Globe2, MapPin, Pencil, Search, Send, UserRoundPlus, Users, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, ProfessionalConnection, ProfessionalProfile, WorkPost } from './lib/types'

type Props = {
  supabase: SupabaseClient<Database>
  user: User
}

type FeedPost = WorkPost & { author: ProfessionalProfile }
type NetworkTab = 'feed' | 'people' | 'profile'

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

function safeUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d ago` : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))
}

export default function ProfessionalNetwork({ supabase, user }: Props) {
  const fallbackName = String(user.user_metadata.display_name ?? user.email?.split('@')[0] ?? 'ToDoo member')
  const [tab, setTab] = useState<NetworkTab>('feed')
  const [profile, setProfile] = useState<ProfessionalProfile | null>(null)
  const [profiles, setProfiles] = useState<ProfessionalProfile[]>([])
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [connections, setConnections] = useState<ProfessionalConnection[]>([])
  const [postText, setPostText] = useState('')
  const [projectUrl, setProjectUrl] = useState('')
  const [search, setSearch] = useState('')
  const [headline, setHeadline] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const initializedProfileId = useRef<string | null>(null)

  const loadNetwork = useCallback(async () => {
    const [profileResult, profilesResult, postsResult, connectionsResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', user.id).single(),
      supabase.from('profiles').select('*').order('display_name').limit(100),
      supabase.from('work_posts').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('professional_connections').select('*').or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`).order('created_at', { ascending: false }),
    ])
    if (profileResult.error) throw profileResult.error
    if (profilesResult.error) throw profilesResult.error
    if (postsResult.error) throw postsResult.error
    if (connectionsResult.error) throw connectionsResult.error

    const profileRows = profilesResult.data
    const authorIds = [...new Set(postsResult.data.map((post) => post.author_id))]
    const missingAuthorIds = authorIds.filter((id) => !profileRows.some((person) => person.user_id === id))
    const missingAuthorsResult = missingAuthorIds.length
      ? await supabase.from('profiles').select('*').in('user_id', missingAuthorIds)
      : { data: [], error: null }
    if (missingAuthorsResult.error) throw missingAuthorsResult.error

    const people = [...profileRows, ...missingAuthorsResult.data]
    const byId = new Map(people.map((person) => [person.user_id, person]))
    setProfile(profileResult.data)
    if (initializedProfileId.current !== user.id) {
      setHeadline(profileResult.data.headline ?? '')
      setBio(profileResult.data.bio ?? '')
      setLocation(profileResult.data.location ?? '')
      setPortfolioUrl(profileResult.data.portfolio_url ?? '')
      initializedProfileId.current = user.id
    }
    setProfiles(profileRows)
    setPosts(postsResult.data.flatMap((post) => {
      const author = byId.get(post.author_id)
      return author ? [{ ...post, author }] : []
    }))
    setConnections(connectionsResult.data)
    setLoading(false)
  }, [supabase, user.id])

  const reportInitialLoadError = useCallback((loadError: Error) => {
    setError(`Could not load the professional network: ${loadError.message}`)
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    void loadNetwork()
      .catch((loadError: Error) => { if (active) reportInitialLoadError(loadError) })
    return () => { active = false }
  }, [loadNetwork, reportInitialLoadError])

  useEffect(() => {
    const channel = supabase
      .channel(`professional-network:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_posts' }, () => {
        void loadNetwork().catch((loadError: Error) => setError(`Could not refresh the work feed: ${loadError.message}`))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'professional_connections' }, () => {
        void loadNetwork().catch((loadError: Error) => setError(`Could not refresh connections: ${loadError.message}`))
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [supabase, user.id, loadNetwork])

  const connectionByPerson = useMemo(() => {
    const index = new Map<string, ProfessionalConnection>()
    for (const connection of connections) {
      index.set(connection.requester_id === user.id ? connection.addressee_id : connection.requester_id, connection)
    }
    return index
  }, [connections, user.id])
  const incoming = connections.filter((connection) => connection.addressee_id === user.id && connection.status === 'pending')
  const connectionCount = connections.filter((connection) => connection.status === 'accepted').length
  const visiblePeople = profiles.filter((person) => person.user_id !== user.id && (
    !search.trim() || `${person.display_name} ${person.headline ?? ''} ${person.location ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
  ))

  const createPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanText = postText.trim()
    const cleanUrl = projectUrl.trim()
    if (!cleanText) return
    if (cleanUrl && !safeUrl(cleanUrl)) {
      setError('Use a valid project link starting with https:// or http://.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const { error: insertError } = await supabase.from('work_posts').insert({
        author_id: user.id,
        content: cleanText,
        project_url: cleanUrl || null,
      })
      if (insertError) throw insertError
      setPostText('')
      setProjectUrl('')
      await loadNetwork()
    } catch (saveError) {
      setError(`Could not publish your work: ${(saveError as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanPortfolioUrl = portfolioUrl.trim()
    if (cleanPortfolioUrl && !safeUrl(cleanPortfolioUrl)) {
      setError('Use a valid portfolio link starting with https:// or http://.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({
          headline: headline.trim() || null,
          bio: bio.trim() || null,
          location: location.trim() || null,
          portfolio_url: cleanPortfolioUrl || null,
        })
        .eq('user_id', user.id)
        .select('*')
        .single()
      if (updateError) throw updateError
      setProfile(data)
      setProfiles((current) => current.map((person) => person.user_id === user.id ? data : person))
      setNotice('Your professional profile is up to date.')
    } catch (saveError) {
      setError(`Could not save your profile: ${(saveError as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const sendRequest = async (personId: string) => {
    setError('')
    setNotice('')
    const { error: requestError } = await supabase.from('professional_connections').insert({
      requester_id: user.id,
      addressee_id: personId,
      status: 'pending',
    })
    if (requestError) {
      setError(requestError.code === '23505'
        ? 'A connection request already exists with this member.'
        : `Could not send the connection request: ${requestError.message}`)
      return
    }
    setNotice('Connection request sent.')
    await loadNetwork().catch((loadError: Error) => setError(`Request sent, but connections could not refresh: ${loadError.message}`))
  }

  const respondToRequest = async (connection: ProfessionalConnection, accept: boolean) => {
    setError('')
    setNotice('')
    const result = accept
      ? await supabase.from('professional_connections').update({ status: 'accepted' }).eq('id', connection.id)
      : await supabase.from('professional_connections').delete().eq('id', connection.id)
    if (result.error) {
      setError(`Could not ${accept ? 'accept' : 'decline'} the connection request: ${result.error.message}`)
      return
    }
    setNotice(accept ? 'You are now connected.' : 'Connection request declined.')
    await loadNetwork().catch((loadError: Error) => setError(`Your response was saved, but connections could not refresh: ${loadError.message}`))
  }

  const removePost = async (postId: string) => {
    if (!window.confirm('Delete this work post? This cannot be undone.')) return
    const { error: deleteError } = await supabase.from('work_posts').delete().eq('id', postId).eq('author_id', user.id)
    if (deleteError) {
      setError(`Could not delete the post: ${deleteError.message}`)
      return
    }
    setPosts((current) => current.filter((post) => post.id !== postId))
  }

  return (
    <section className="network-content">
      <header className="network-heading">
        <div>
          <p className="eyebrow"><BriefcaseBusiness size={13} /> Grow together</p>
          <h1>Your professional network.</h1>
          <p className="board-subtitle">Share what you’re making and meet the people making things happen.</p>
        </div>
        <div className="network-stat"><Users size={17} /><strong>{connectionCount}</strong><span>connections</span></div>
      </header>

      <nav className="network-tabs" aria-label="Professional network sections">
        <button className={tab === 'feed' ? 'network-tab-active' : ''} onClick={() => setTab('feed')}>Work feed</button>
        <button className={tab === 'people' ? 'network-tab-active' : ''} onClick={() => setTab('people')}>Professionals{incoming.length > 0 && <span className="network-tab-count">{incoming.length}</span>}</button>
        <button className={tab === 'profile' ? 'network-tab-active' : ''} onClick={() => setTab('profile')}>My profile</button>
      </nav>

      {error && <div className="network-alert network-alert-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
      {notice && <div className="network-alert network-alert-success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={15} /></button></div>}

      {loading ? (
        <div className="network-empty"><span className="network-avatar"><Users size={20} /></span><p>Loading your professional network…</p></div>
      ) : tab === 'feed' ? (
        <div className="network-feed-layout">
          <div className="network-feed-main">
            <form className="network-compose" onSubmit={createPost}>
              <div className="network-compose-top">
                <span className="network-avatar">{initials(profile?.display_name ?? fallbackName)}</span>
                <label className="sr-only" htmlFor="work-post">Share a work update</label>
                <textarea id="work-post" value={postText} onChange={(event) => setPostText(event.target.value)} maxLength={2000} placeholder="Share a project, a win, or something you’ve learned…" required />
              </div>
              <div className="network-compose-bottom">
                <label className="network-link-input"><Globe2 size={15} /><span className="sr-only">Project or portfolio link</span><input type="url" value={projectUrl} onChange={(event) => setProjectUrl(event.target.value)} maxLength={2048} placeholder="Add a project link (optional)" /></label>
                <button className="primary-button" disabled={saving || !postText.trim()}>{saving ? 'Sharing…' : <><Send size={14} /> Share work</>}</button>
              </div>
              <small className="network-compose-note">Visible to all signed-in ToDoo members · {postText.length}/2000</small>
            </form>

            {posts.length ? posts.map((post) => (
              <article className="network-post" key={post.id}>
                <header className="network-post-author">
                  <span className="network-avatar">{initials(post.author.display_name)}</span>
                  <span className="network-author-copy"><strong>{post.author.display_name}</strong><small>{post.author.headline || 'ToDoo member'} · {timeAgo(post.created_at)}</small></span>
                  {post.author_id === user.id && <button className="quiet-button network-delete" onClick={() => void removePost(post.id)} aria-label="Delete your work post"><X size={16} /></button>}
                </header>
                <p className="network-post-text">{post.content}</p>
                {post.project_url && safeUrl(post.project_url) && (
                  <a className="network-project-link" href={safeUrl(post.project_url) ?? undefined} target="_blank" rel="noreferrer">
                    <span><Globe2 size={16} /> Project link</span><ArrowUpRight size={15} />
                  </a>
                )}
              </article>
            )) : <div className="network-empty"><span className="network-avatar"><BriefcaseBusiness size={20} /></span><h2>The feed starts with you.</h2><p>Share a project or a recent win with the ToDoo community.</p></div>}
          </div>

          <aside className="network-side-card">
            <div className="network-side-profile"><span className="network-avatar network-avatar-large">{initials(profile?.display_name ?? fallbackName)}</span><strong>{profile?.display_name ?? fallbackName}</strong><span>{profile?.headline || 'Add a headline to introduce yourself.'}</span></div>
            {profile?.location && <p className="network-location"><MapPin size={14} />{profile.location}</p>}
            <button className="network-edit-profile" onClick={() => setTab('profile')}><Pencil size={14} /> Complete your profile</button>
            <button className="network-discover-link" onClick={() => setTab('people')}><UserRoundPlus size={14} /> Find professionals</button>
          </aside>
        </div>
      ) : tab === 'people' ? (
        <div className="network-people-layout">
          {incoming.length > 0 && (
            <section className="network-requests">
              <div className="network-section-heading"><h2>Connection requests</h2><span>{incoming.length} waiting</span></div>
              {incoming.map((connection) => {
                const person = profiles.find((item) => item.user_id === connection.requester_id)
                return person ? (
                  <article className="network-person-card network-request-card" key={connection.id}>
                    <span className="network-avatar">{initials(person.display_name)}</span>
                    <span className="network-person-copy"><strong>{person.display_name}</strong><small>{person.headline || 'ToDoo member'}</small></span>
                    <div className="network-person-actions"><button className="primary-button" onClick={() => void respondToRequest(connection, true)}><Check size={14} /> Accept</button><button className="quiet-button" onClick={() => void respondToRequest(connection, false)}>Decline</button></div>
                  </article>
                ) : null
              })}
            </section>
          )}
          <div className="network-section-heading"><div><h2>Meet the professionals</h2><p>Explore ToDoo members and send a connection request.</p></div><label className="network-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people" aria-label="Search professionals" /></label></div>
          <div className="network-people-grid">
            {visiblePeople.map((person) => {
              const connection = connectionByPerson.get(person.user_id)
              const incomingRequest = connection?.status === 'pending' && connection.addressee_id === user.id
              return (
                <article className="network-person-card" key={person.user_id}>
                  <span className="network-avatar network-avatar-large">{initials(person.display_name)}</span>
                  <div className="network-person-copy"><strong>{person.display_name}</strong><small>{person.headline || 'ToDoo member'}</small>{person.location && <small className="network-person-location"><MapPin size={12} />{person.location}</small>}</div>
                  {person.portfolio_url && safeUrl(person.portfolio_url) && <a className="network-person-link" href={safeUrl(person.portfolio_url) ?? undefined} target="_blank" rel="noreferrer" aria-label={`Open ${person.display_name}'s portfolio`}><ArrowUpRight size={15} /></a>}
                  {connection?.status === 'accepted'
                    ? <span className="network-connected"><Check size={14} /> Connected</span>
                    : incomingRequest
                      ? <button className="network-connect-button" onClick={() => void respondToRequest(connection, true)}>Accept request</button>
                      : connection?.status === 'pending'
                        ? <span className="network-pending"><Clock3 size={13} /> Pending</span>
                        : <button className="network-connect-button" onClick={() => void sendRequest(person.user_id)}><UserRoundPlus size={14} /> Connect</button>}
                </article>
              )
            })}
            {visiblePeople.length === 0 && <div className="network-empty"><h2>No professionals found.</h2><p>Try a different name, role, or location.</p></div>}
          </div>
        </div>
      ) : (
        <form className="network-profile-form" onSubmit={saveProfile}>
          <div className="network-profile-banner"><span className="network-avatar network-avatar-xl">{initials(profile?.display_name ?? fallbackName)}</span><div><p className="eyebrow">Your public introduction</p><h2>{profile?.display_name ?? fallbackName}</h2><span>{user.email}</span></div></div>
          <label>Professional headline<input value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={120} placeholder="e.g. Product designer building accessible tools" /></label>
          <label>About<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={1000} rows={5} placeholder="Share your experience, interests, and what you’re working on." /></label>
          <div className="network-profile-row">
            <label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} placeholder="e.g. Bengaluru, India" /></label>
            <label>Portfolio or website<input type="url" value={portfolioUrl} onChange={(event) => setPortfolioUrl(event.target.value)} maxLength={2048} placeholder="https://yourportfolio.com" /></label>
          </div>
          <p className="network-profile-note">Your name, headline, about section, location, and portfolio are visible to signed-in ToDoo members.</p>
          <button className="primary-button network-save-profile" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        </form>
      )}
    </section>
  )
}
