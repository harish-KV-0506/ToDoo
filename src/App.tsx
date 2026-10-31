import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  Circle,
  Clipboard,
  BriefcaseBusiness,
  Clock3,
  Flag,
  LayoutGrid,
  ListTodo,
  LoaderCircle,
  LogOut,
  MailPlus,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { getSupabaseClient, isSupabaseConfigured, supabaseConfigIssue } from './lib/supabase'
import type { Task, TaskPriority, TaskStatus, Workspace, WorkspaceInvitation, WorkspaceMember } from './lib/types'
import ProfessionalNetwork from './ProfessionalNetwork'
import './App.css'

type Filter = 'all' | 'mine' | 'today' | 'upcoming' | 'completed'
type Area = 'tasks' | 'network'

const filters: { id: Filter; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'all', label: 'All tasks', icon: LayoutGrid },
  { id: 'mine', label: 'Assigned to me', icon: Users },
  { id: 'today', label: 'Due today', icon: CalendarDays },
  { id: 'upcoming', label: 'Upcoming', icon: Clock3 },
  { id: 'completed', label: 'Completed', icon: CheckCircle2 },
]

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'
}

function formatDueDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function isPastDue(value: string | null) {
  if (!value) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(`${value}T00:00:00`).getTime() < today.getTime()
}

const appToday = new Date()
const appTodayKey = `${appToday.getFullYear()}-${String(appToday.getMonth() + 1).padStart(2, '0')}-${String(appToday.getDate()).padStart(2, '0')}`

function App() {
  const supabase = useMemo(() => getSupabaseClient(), [])
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [workspaceList, setWorkspaceList] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [activeArea, setActiveArea] = useState<Area>('tasks')
  const [workspaceName, setWorkspaceName] = useState('')
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('medium')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [taskAssignee, setTaskAssignee] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitedEmail, setInvitedEmail] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const invitationConsumed = useRef('')

  const user = session?.user ?? null
  const selectedWorkspace = workspaceList.find((item) => item.id === workspaceId) ?? null

  const loadWorkspaces = useCallback(async () => {
    if (!supabase || !user) return
    const membershipResult = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
    if (membershipResult.error) throw membershipResult.error

    const ids = membershipResult.data.map((membership) => membership.workspace_id)
    if (ids.length === 0) {
      setWorkspaceList([])
      setWorkspaceId('')
      setActiveArea('tasks')
      setWorkspaceName('')
      return
    }

    const workspacesResult = await supabase
      .from('workspaces')
      .select('id, name, created_by, created_at')
      .in('id', ids)
      .order('created_at', { ascending: true })
    if (workspacesResult.error) throw workspacesResult.error

    setWorkspaceList(workspacesResult.data)
    setWorkspaceId((current) =>
      workspacesResult.data.some((workspace) => workspace.id === current)
        ? current
        : workspacesResult.data[0]?.id ?? '',
    )
  }, [supabase, user])

  const loadWorkspaceData = useCallback(async () => {
    if (!supabase || !user || !workspaceId) {
      setTasks([])
      setMembers([])
      setInvitations([])
      setWorkspaceName('')
      return
    }

    const [workspaceResult, taskResult, memberResult, invitationResult] = await Promise.all([
      supabase.from('workspaces').select('name').eq('id', workspaceId).single(),
      supabase.from('tasks').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      supabase.from('workspace_members').select('user_id, role').eq('workspace_id', workspaceId),
      supabase
        .from('workspace_invitations')
        .select('id, email, expires_at, created_at')
        .eq('workspace_id', workspaceId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false }),
    ])

    if (workspaceResult.error) throw workspaceResult.error
    if (taskResult.error) throw taskResult.error
    if (memberResult.error) throw memberResult.error
    if (invitationResult.error) throw invitationResult.error

    const memberIds = memberResult.data.map((member) => member.user_id)
    const profilesResult = memberIds.length
      ? await supabase.from('profiles').select('user_id, display_name').in('user_id', memberIds)
      : { data: [], error: null }
    if (profilesResult.error) throw profilesResult.error

    const profileNames = new Map(profilesResult.data.map((profile) => [profile.user_id, profile.display_name]))
    setWorkspaceName(workspaceResult.data.name)
    setTasks(taskResult.data)
    setMembers(
      memberResult.data.map((member) => ({
        user_id: member.user_id,
        role: member.role,
        display_name: profileNames.get(member.user_id) ?? 'Team member',
      })),
    )
    setInvitations(invitationResult.data)
  }, [supabase, user, workspaceId])

  useEffect(() => {
    if (!supabase) {
      return
    }

    let active = true
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setSession(data.session)
      setAuthReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setError('')
      setAuthMessage('')
      setWorkspaceList([])
      setWorkspaceId('')
      setWorkspaceName('')
      setTasks([])
      setMembers([])
      setInvitations([])
      setRealtimeConnected(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [supabase])

  useEffect(() => {
    if (!supabase || !user) return
    let active = true
    void loadWorkspaces().catch((loadError: Error) => {
      if (active) setError(`Could not load your workspaces: ${loadError.message}`)
    })
    return () => {
      active = false
    }
  }, [supabase, user, loadWorkspaces])

  useEffect(() => {
    if (!workspaceId) return
    let active = true
    void loadWorkspaceData().catch((loadError: Error) => {
      if (active) setError(`Could not load this board: ${loadError.message}`)
    })
    return () => {
      active = false
    }
  }, [workspaceId, loadWorkspaceData])

  useEffect(() => {
    if (!supabase || !workspaceId || !user) {
      return
    }

    const channel = supabase
      .channel(`workspace:${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `workspace_id=eq.${workspaceId}` }, () => {
        void loadWorkspaceData().catch((loadError: Error) => setError(`Live refresh failed: ${loadError.message}`))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_members', filter: `workspace_id=eq.${workspaceId}` }, () => {
        void loadWorkspaceData().catch((loadError: Error) => setError(`Live refresh failed: ${loadError.message}`))
      })
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED')
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Live updates are disconnected. Check the Supabase Realtime setup and your network.')
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, workspaceId, user, loadWorkspaceData])

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invite')
    if (!token || !user || !supabase || invitationConsumed.current === token) return
    invitationConsumed.current = token
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const { data, error: acceptError } = await supabase.rpc('accept_workspace_invitation', { invitation_token: token })
        if (acceptError) throw acceptError
        const cleanUrl = new URL(window.location.href)
        cleanUrl.searchParams.delete('invite')
        window.history.replaceState({}, '', cleanUrl)
        setWorkspaceId(data)
        setAuthMessage('You joined the shared board.')
        await loadWorkspaces()
      } catch (acceptError) {
        setError(`Could not accept this invitation: ${(acceptError as Error).message}`)
        invitationConsumed.current = ''
      } finally {
        setLoading(false)
      }
    })()
  }, [supabase, user, loadWorkspaces])

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return tasks.filter((task) => {
      if (filter === 'mine' && task.assigned_to !== user?.id) return false
      if (filter === 'today' && task.due_date !== appTodayKey) return false
      if (filter === 'upcoming' && (!task.due_date || task.due_date <= appTodayKey || task.status === 'done')) return false
      if (filter === 'completed' && task.status !== 'done') return false
      if (filter !== 'completed' && filter !== 'upcoming' && task.status === 'done') return false
      if (
        normalizedQuery &&
        !`${task.title} ${task.description ?? ''}`.toLowerCase().includes(normalizedQuery)
      ) return false
      return true
    })
  }, [tasks, filter, query, user?.id])

  const completeCount = tasks.filter((task) => task.status === 'done').length
  const openCount = tasks.length - completeCount
  const progress = tasks.length ? Math.round((completeCount / tasks.length) * 100) : 0

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    setLoading(true)
    setError('')
    setAuthMessage('')
    try {
      if (authMode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            data: { display_name: displayName.trim() },
            emailRedirectTo: window.location.href,
          },
        })
        if (signUpError) throw signUpError
        if (!data.session) {
          setAuthMessage('Check your email for a confirmation link, then return here to sign in.')
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        })
        if (signInError) throw signInError
      }
    } catch (authError) {
      setError(`Could not ${authMode === 'signup' ? 'create your account' : 'sign in'}: ${(authError as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !newWorkspaceName.trim()) return
    setLoading(true)
    setError('')
    try {
      const { data, error: createError } = await supabase.rpc('create_workspace', {
        workspace_name: newWorkspaceName.trim(),
      })
      if (createError) throw createError
      setNewWorkspaceName('')
      await loadWorkspaces()
      setWorkspaceId(data)
    } catch (createError) {
      setError(`Could not create the board: ${(createError as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const addTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !user || !workspaceId || !taskTitle.trim()) return
    setLoading(true)
    setError('')
    try {
      const { error: insertError } = await supabase.from('tasks').insert({
        workspace_id: workspaceId,
        title: taskTitle.trim(),
        description: taskDescription.trim() || null,
        status: 'todo',
        priority: taskPriority,
        due_date: taskDueDate || null,
        assigned_to: taskAssignee || null,
        created_by: user.id,
      })
      if (insertError) throw insertError
      setTaskTitle('')
      setTaskDescription('')
      setTaskDueDate('')
      setTaskAssignee('')
      setTaskPriority('medium')
      await loadWorkspaceData()
    } catch (insertError) {
      setError(`Could not save this task: ${(insertError as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const updateTask = async (task: Task, updates: { status?: TaskStatus; assigned_to?: string | null }) => {
    if (!supabase) return
    setError('')
    const { error: updateError } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', task.id)
    if (updateError) {
      setError(`Could not update “${task.title}”: ${updateError.message}`)
      return
    }
    await loadWorkspaceData().catch((loadError: Error) => setError(`Could not refresh the board: ${loadError.message}`))
  }

  const deleteTask = async (task: Task) => {
    if (!supabase || !window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return
    setError('')
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', task.id)
    if (deleteError) {
      setError(`Could not delete the task: ${deleteError.message}`)
      return
    }
    await loadWorkspaceData().catch((loadError: Error) => setError(`Could not refresh the board: ${loadError.message}`))
  }

  const createInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !workspaceId || !inviteEmail.trim()) return
    setLoading(true)
    setError('')
    setInviteLink('')
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
      const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const { error: inviteError } = await supabase.rpc('create_workspace_invitation', {
        target_workspace: workspaceId,
        invited_email: inviteEmail.trim(),
        token_hash: tokenHash,
      })
      if (inviteError) throw inviteError
      setInvitedEmail(inviteEmail.trim())
      const inviteUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
      inviteUrl.searchParams.set('invite', token)
      setInviteLink(inviteUrl.toString())
      setInviteEmail('')
      await loadWorkspaceData()
    } catch (inviteError) {
      setError(`Could not create the invite: ${(inviteError as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const copyInvite = async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (copyError) {
      setError(`The invitation is ready, but your browser could not copy it: ${(copyError as Error).message}`)
    }
  }

  const signOut = async () => {
    if (!supabase) return
    setError('')
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(`Could not sign out: ${signOutError.message}`)
  }

  if (!isSupabaseConfigured) {
    return <SetupScreen />
  }

  if (!authReady) {
    return <LoadingScreen />
  }

  if (!user) {
    return (
      <main className="auth-page">
        <div className="auth-brand"><Brand /></div>
        <section className="auth-card">
          <div className="auth-icon"><ListTodo size={25} /></div>
          <p className="eyebrow">A little more in sync</p>
          <h1>{authMode === 'signin' ? 'Welcome back' : 'Make room for done'}</h1>
          <p className="auth-description">Plan together, keep the small things moving, and see every update as it happens.</p>
          <form className="auth-form" onSubmit={handleAuth}>
            {authMode === 'signup' && (
              <label>Your name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How should we call you?" required maxLength={70} /></label>
            )}
            <label>Email address<input type="email" autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com" required /></label>
            <label>Password<input type="password" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required /></label>
            <button className="primary-button auth-submit" disabled={loading}>
              {loading ? <LoaderCircle size={16} className="spin" /> : authMode === 'signin' ? 'Sign in' : 'Create my account'}
            </button>
          </form>
          {error && <Notice tone="error">{error}</Notice>}
          {authMessage && <Notice tone="success">{authMessage}</Notice>}
          <p className="auth-switch">
            {authMode === 'signin' ? 'New to ToDoo?' : 'Already have an account?'}{' '}
            <button onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setError(''); setAuthMessage('') }}>
              {authMode === 'signin' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
          <p className="auth-security">Your board is private to invited members.</p>
        </section>
        <footer className="auth-footer">MAKE SPACE FOR WHAT MATTERS</footer>
      </main>
    )
  }

  if (workspaceList.length === 0) {
    if (activeArea === 'network') {
      return (
        <main className="network-standalone">
          <header className="network-standalone-header">
            <Brand />
            <div>
              <button className="quiet-button" onClick={() => setActiveArea('tasks')}><ListTodo size={16} /> Create a board</button>
              <button className="quiet-button" onClick={signOut}><LogOut size={16} /> Sign out</button>
            </div>
          </header>
          <ProfessionalNetwork key={user.id} supabase={supabase!} user={user} />
        </main>
      )
    }
    return (
      <main className="onboarding-page">
        <header className="onboarding-top"><Brand /><div className="onboarding-actions"><button className="quiet-button" onClick={() => setActiveArea('network')}><BriefcaseBusiness size={15} /> Explore professionals</button><button className="quiet-button" onClick={signOut}><LogOut size={16} /> Sign out</button></div></header>
        <section className="onboarding-card">
          <div className="onboarding-art"><span className="art-sparkle art-sparkle-one">✳</span><span className="art-card art-card-back" /><span className="art-card art-card-mid" /><span className="art-card art-card-front"><Check size={26} /></span><span className="art-sparkle art-sparkle-two">✦</span></div>
          <p className="eyebrow">Your first little win</p>
          <h1>Make a space for your team.</h1>
          <p>Create a shared board. Add tasks, invite your people, and keep everyone in the loop in real time.</p>
          <form className="workspace-form" onSubmit={createWorkspace}>
            <label className="sr-only" htmlFor="workspace-name">Board name</label>
            <input id="workspace-name" autoFocus value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} placeholder="e.g. Studio week, Home projects" maxLength={80} required />
            <button className="primary-button" disabled={loading}>{loading ? 'Creating…' : 'Create my board'} <ArrowUpRight size={16} /></button>
          </form>
          {error && <Notice tone="error">{error}</Notice>}
          {authMessage && <Notice tone="success">{authMessage}</Notice>}
        </section>
      </main>
    )
  }

  return (
    <div className="todo-app">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-switcher">
          <span className="workspace-monogram">{initials(selectedWorkspace?.name ?? 'ToDoo')}</span>
          <span className="workspace-copy"><strong>{workspaceName || selectedWorkspace?.name || 'Your board'}</strong><small>Shared space</small></span>
          {workspaceList.length > 1 && (
            <select aria-label="Switch board" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
              {workspaceList.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}
            </select>
          )}
        </div>
        <span className="sidebar-label">YOUR SPACE</span>
        <nav className="sidebar-nav" aria-label="Task filters and professional network">
          {filters.map(({ id, label, icon: Icon }) => (
            <button className={`sidebar-link ${activeArea === 'tasks' && filter === id ? 'sidebar-link-active' : ''}`} key={id} onClick={() => { setActiveArea('tasks'); setFilter(id) }} aria-label={label} aria-current={activeArea === 'tasks' && filter === id ? 'page' : undefined}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {id === 'all' && <small className="nav-count">{openCount}</small>}
              {id === 'completed' && <small className="nav-count">{completeCount}</small>}
            </button>
          ))}
          <button className={`sidebar-link ${activeArea === 'network' ? 'sidebar-link-active' : ''}`} onClick={() => setActiveArea('network')} aria-label="Professional network" aria-current={activeArea === 'network' ? 'page' : undefined}>
            <BriefcaseBusiness size={18} strokeWidth={1.8} /><span>Professional network</span>
          </button>
        </nav>
        <button className="invite-sidebar" onClick={() => setShowInvite(true)}><MailPlus size={17} /> Invite a teammate</button>
        <div className="sidebar-bottom">
          <div className="member-stack">
            {members.slice(0, 4).map((member, index) => <span className={`member-avatar member-color-${index}`} title={member.display_name} key={member.user_id}>{initials(member.display_name)}</span>)}
            {members.length > 4 && <span className="member-extra">+{members.length - 4}</span>}
            <span className="member-caption">{members.length} {members.length === 1 ? 'person' : 'people'} here</span>
          </div>
          <div className="account-row">
            <span className="account-avatar">{initials(user.user_metadata.display_name ?? user.email ?? 'You')}</span>
            <span className="account-copy"><strong>{user.user_metadata.display_name || user.email?.split('@')[0]}</strong><small>{user.email}</small></span>
            <button className="icon-quiet" onClick={signOut} aria-label="Sign out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="mobile-brand"><Brand /></div>
          <div className="breadcrumb"><span>{activeArea === 'network' ? 'ToDoo community' : workspaceName || 'Your board'}</span><span className="breadcrumb-slash">/</span><strong>{activeArea === 'network' ? 'Professional network' : filters.find((item) => item.id === filter)?.label}</strong></div>
          <div className="topbar-actions">
            {activeArea === 'tasks' && <><span className={`live-indicator ${realtimeConnected ? 'live-indicator-on' : ''}`}><i />{realtimeConnected ? 'Live' : 'Connecting'}</span><button className="member-pill" onClick={() => setShowInvite(true)}><Users size={15} /><span>{members.length}</span><Plus size={15} /></button></>}
            <button className="topbar-avatar" aria-label="Account settings">{initials(user.user_metadata.display_name ?? user.email ?? 'You')}</button>
          </div>
        </header>

        {activeArea === 'network' ? (
          <ProfessionalNetwork key={user.id} supabase={supabase!} user={user} />
        ) : <section className="board-content">
          <div className="board-heading">
            <div className="board-heading-copy">
              <p className="eyebrow"><Sparkles size={13} /> A calmer way to get things done</p>
              <h1>{filter === 'all' ? 'Your shared space.' : filters.find((item) => item.id === filter)?.label + '.'}</h1>
              <p className="board-subtitle">A little progress adds up. Let’s make today count.</p>
            </div>
            <button className="primary-button add-task-cta" onClick={() => document.getElementById('new-task-title')?.focus()}><Plus size={17} /> Add a task</button>
          </div>

          <section className="progress-card" aria-label="Board progress">
            <div className="progress-copy"><span className="progress-icon"><CheckCheck size={17} /></span><span><strong>You’re doing great.</strong><small>{completeCount} of {tasks.length} tasks complete</small></span></div>
            <div className="progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Task completion">
              <span style={{ width: `${progress}%` }} />
            </div>
            <strong className="progress-percent">{progress}%</strong>
          </section>

          <section className="task-compose-card">
            <div className="compose-title"><span className="compose-plus"><Plus size={17} /></span><span><strong>Put it on the list</strong><small>Big or small, it all belongs somewhere.</small></span></div>
            <form className="task-form" onSubmit={addTask}>
              <label className="sr-only" htmlFor="new-task-title">Task title</label>
              <input id="new-task-title" className="task-title-input" placeholder="What needs to get done?" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} maxLength={180} required />
              <label className="sr-only" htmlFor="task-description">Details (optional)</label>
              <input id="task-description" className="task-details-input" placeholder="Add a little detail…" value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} maxLength={1000} />
              <div className="task-form-bottom">
                <div className="task-options">
                  <label className="select-chip"><Flag size={14} /><span className="sr-only">Priority</span><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as TaskPriority)}><option value="low">Low priority</option><option value="medium">Medium priority</option><option value="high">High priority</option></select></label>
                  <label className="select-chip"><CalendarDays size={14} /><span className="sr-only">Due date</span><input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} /></label>
                  <label className="select-chip assignee-select"><Users size={14} /><span className="sr-only">Assign to</span><select value={taskAssignee} onChange={(event) => setTaskAssignee(event.target.value)}><option value="">Anyone</option>{members.map((member) => <option value={member.user_id} key={member.user_id}>{member.display_name}{member.user_id === user.id ? ' (you)' : ''}</option>)}</select></label>
                </div>
                <button className="submit-task-button" type="submit" disabled={loading || !taskTitle.trim()}>{loading ? <LoaderCircle size={15} className="spin" /> : <><Plus size={15} /> Add task</>}</button>
              </div>
            </form>
          </section>

          <div className="list-toolbar">
            <div className="list-toolbar-title"><ListTodo size={17} /><strong>{filters.find((item) => item.id === filter)?.label}</strong><span className="task-total">{visibleTasks.length}</span></div>
            <label className="task-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a task" aria-label="Find a task" />{query && <button onClick={() => setQuery('')} aria-label="Clear task search"><X size={14} /></button>}</label>
          </div>

          {error && <Notice tone="error" onDismiss={() => setError('')}>{error}</Notice>}
          {authMessage && <Notice tone="success" onDismiss={() => setAuthMessage('')}>{authMessage}</Notice>}

          {visibleTasks.length ? (
            <div className="task-list">
              {visibleTasks.map((task) => {
                return (
                  <article className={`task-row ${task.status === 'done' ? 'task-row-done' : ''}`} key={task.id}>
                    <button className={`task-check ${task.status === 'done' ? 'task-check-done' : ''}`} onClick={() => updateTask(task, { status: task.status === 'done' ? 'todo' : 'done' })} aria-label={task.status === 'done' ? 'Mark task as not done' : 'Mark task complete'} aria-pressed={task.status === 'done'}>
                      {task.status === 'done' ? <Check size={15} /> : <Circle size={19} />}
                    </button>
                    <div className="task-main">
                      <strong>{task.title}</strong>
                      {task.description && <p>{task.description}</p>}
                      <div className="task-meta">
                        <span className={`priority priority-${task.priority}`}><i />{task.priority}</span>
                        {task.due_date && <span className={`due-date ${isPastDue(task.due_date) && task.status !== 'done' ? 'due-date-late' : ''}`}><CalendarDays size={12} />{formatDueDate(task.due_date)}</span>}
                        <label className="assignee-editor"><Users size={12} /><span className="sr-only">Assign {task.title} to a teammate</span><select value={task.assigned_to ?? ''} onChange={(event) => updateTask(task, { assigned_to: event.target.value || null })}><option value="">Unassigned</option>{members.map((member) => <option value={member.user_id} key={member.user_id}>{member.display_name}{member.user_id === user.id ? ' (you)' : ''}</option>)}</select></label>
                      </div>
                    </div>
                    <label className="status-select"><span className="sr-only">Task status</span><select value={task.status} onChange={(event) => updateTask(task, { status: event.target.value as TaskStatus })}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label>
                    <button className="delete-task" onClick={() => void deleteTask(task)} aria-label={`Delete ${task.title}`}><Trash2 size={15} /></button>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="empty-board">
              <span className="empty-board-art"><CheckCircle2 size={26} /></span>
              <h2>{query ? 'No matching tasks.' : filter === 'completed' ? 'Nothing checked off just yet.' : 'A little room to breathe.'}</h2>
              <p>{query ? 'Try another search.' : filter === 'completed' ? 'Finish a task and it will find a home here.' : 'Add your first task above. Future you says thanks.'}</p>
            </div>
          )}

          <div className="board-bottom"><span><RefreshCw size={12} /> Changes sync with your team</span><button onClick={() => setShowInvite(true)}>Share this board <ArrowUpRight size={13} /></button></div>
        </section>}
      </main>

      {showInvite && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setShowInvite(false); setInviteLink('') } }}>
          <section className="invite-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title">
            <header><span className="invite-icon"><Users size={20} /></span><button className="icon-quiet" onClick={() => { setShowInvite(false); setInviteLink('') }} aria-label="Close invite window"><X size={19} /></button></header>
            <p className="eyebrow">Better, together</p>
            <h2 id="invite-title">Bring your people in.</h2>
            <p className="invite-description">Invite teammates to <strong>{workspaceName}</strong>. They’ll be able to see, add, and update tasks on this board.</p>
            <form className="invite-form" onSubmit={createInvite}><label className="sr-only" htmlFor="invite-email">Teammate email address</label><input id="invite-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" required /><button className="primary-button" disabled={loading}><MailPlus size={15} /> Create invite</button></form>
            {inviteLink && <div className="invite-created"><div><CheckCircle2 size={16} /><strong>Your invite is ready</strong></div><p>Share this one-time link with {invitedEmail}; it expires in 7 days.</p><div className="invite-link-row"><input readOnly value={inviteLink} aria-label="Invitation link" /><button className="copy-button" onClick={() => void copyInvite()}>{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? 'Copied' : 'Copy link'}</button></div></div>}
            {error && <Notice tone="error">{error}</Notice>}
            <div className="members-section"><strong>On this board <span>{members.length}</span></strong>{members.map((member, index) => <div className="dialog-member" key={member.user_id}><span className={`member-avatar member-color-${index % 4}`}>{initials(member.display_name)}</span><span><strong>{member.display_name}</strong><small>{member.user_id === user.id ? 'You' : 'Board member'}</small></span><small className="member-role">{member.role}</small></div>)}{invitations.length > 0 && <p className="pending-invites">{invitations.length} invite{invitations.length === 1 ? '' : 's'} awaiting acceptance</p>}</div>
          </section>
        </div>
      )}
    </div>
  )
}

function Brand() {
  return <a className="brand" href={import.meta.env.BASE_URL} aria-label="ToDoo home"><span className="brand-mark"><Check size={17} strokeWidth={2.6} /></span><span>ToDoo<span className="brand-period">.</span></span></a>
}

function Notice({ tone, children, onDismiss }: { tone: 'error' | 'success'; children: string; onDismiss?: () => void }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{tone === 'error' ? <Settings2 size={15} /> : <CheckCircle2 size={15} />}<span>{children}</span>{onDismiss && <button onClick={onDismiss} aria-label="Dismiss message"><X size={14} /></button>}</div>
}

function LoadingScreen() {
  return <main className="loading-screen"><LoaderCircle size={23} className="spin" /><span>Getting your space ready…</span></main>
}

function SetupScreen() {
  return (
    <main className="setup-page">
      <section className="setup-card">
        <Brand />
        <div className="setup-icon"><Settings2 size={21} /></div>
        <p className="eyebrow">One last connection</p>
        <h1>Connect your ToDoo workspace.</h1>
        <p>{supabaseConfigIssue} This site cannot sign in or sync tasks until the connection is configured.</p>
        <ol><li>Create a Supabase project.</li><li>Run the SQL migration in <code>supabase/migrations</code>.</li><li>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to the site’s build settings.</li></ol>
        <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase dashboard <ArrowUpRight size={15} /></a>
      </section>
    </main>
  )
}

export default App
