import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  Clock3,
  ExternalLink,
  Globe2,
  ImagePlus,
  MapPin,
  MessageCircle,
  Pencil,
  Search,
  Send,
  Sparkles,
  ThumbsUp,
  UserRoundPlus,
  Users,
  X,
} from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, ProfessionalConnection, ProfessionalProfile, WorkPost, WorkPostComment } from './lib/types'

type Props = {
  supabase: SupabaseClient<Database>
  user: User
}

type FeedPost = WorkPost & {
  author: ProfessionalProfile
  imageUrl: string | null
}

type FeedComment = WorkPostComment & {
  author: ProfessionalProfile
  avatarUrl: string | null
}

type LinkPreview = {
  url: string
  title: string
  description: string | null
  image_url: string | null
  site_name: string | null
}

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error'
type NetworkTab = 'feed' | 'people' | 'profile'

const imageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

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

function interestTokens(profile: ProfessionalProfile | null) {
  const stopWords = new Set(['about', 'and', 'are', 'build', 'building', 'from', 'have', 'into', 'that', 'the', 'this', 'with', 'you', 'your'])
  return new Set(
    `${profile?.headline ?? ''} ${profile?.bio ?? ''}`
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((word) => word.length > 2 && !stopWords.has(word)),
  )
}

function sharedInterestCount(first: ProfessionalProfile | null, second: ProfessionalProfile) {
  const firstInterests = interestTokens(first)
  return [...interestTokens(second)].filter((interest) => firstInterests.has(interest)).length
}

function Avatar({ name, imageUrl, size = '' }: { name: string; imageUrl: string | null; size?: string }) {
  return (
    <span className={`network-avatar ${size}`} role="img" aria-label={`${name}'s profile photo`}>
      {imageUrl ? <img src={imageUrl} alt="" /> : initials(name)}
    </span>
  )
}

function LinkPreviewCard({
  href,
  title,
  description,
  imageUrl,
  siteName,
}: {
  href: string
  title: string | null
  description: string | null
  imageUrl: string | null
  siteName: string | null
}) {
  const url = safeUrl(href)
  if (!url) return null
  let domain = new URL(url).hostname.replace(/^www\./, '')
  if (siteName?.trim()) domain = siteName.trim()
  const image = imageUrl && safeUrl(imageUrl)?.startsWith('https://') ? imageUrl : null

  return (
    <a className="network-link-preview" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      {image && <img className="network-link-preview-image" src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <span className="network-link-preview-copy">
        <small>{domain}</small>
        <strong>{title || domain}</strong>
        {description && <span>{description}</span>}
        <span className="network-link-preview-open">Open link <ExternalLink size={12} /></span>
      </span>
      <ArrowUpRight size={15} />
    </a>
  )
}

export default function SocialNetwork({ supabase, user }: Props) {
  const fallbackName = String(user.user_metadata.display_name ?? user.email?.split('@')[0] ?? 'ToDoo member')
  const [tab, setTab] = useState<NetworkTab>('feed')
  const [profile, setProfile] = useState<ProfessionalProfile | null>(null)
  const [profiles, setProfiles] = useState<ProfessionalProfile[]>([])
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [comments, setComments] = useState<FeedComment[]>([])
  const [connections, setConnections] = useState<ProfessionalConnection[]>([])
  const [usefulPostIds, setUsefulPostIds] = useState<Set<string>>(new Set())
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [postText, setPostText] = useState('')
  const [projectUrl, setProjectUrl] = useState('')
  const [postImage, setPostImage] = useState<File | null>(null)
  const [postImagePreviewUrl, setPostImagePreviewUrl] = useState<string | null>(null)
  const postImagePreviewRef = useRef<string | null>(null)
  const [search, setSearch] = useState('')
  const [headline, setHeadline] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle')
  const [previewMessage, setPreviewMessage] = useState('')
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [openCommentPosts, setOpenCommentPosts] = useState<Set<string>>(new Set())
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

    const postIds = postsResult.data.map((post) => post.id)
    const [commentsResult, usefulResult] = postIds.length
      ? await Promise.all([
          supabase.from('work_post_comments').select('*').in('post_id', postIds).order('created_at').limit(500),
          supabase.from('work_post_useful_marks').select('post_id').eq('user_id', user.id).in('post_id', postIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }]
    if (commentsResult.error) throw commentsResult.error
    if (usefulResult.error) throw usefulResult.error

    const authorIds = [
      ...postsResult.data.map((post) => post.author_id),
      ...commentsResult.data.map((comment) => comment.author_id),
    ]
    const missingAuthorIds = [...new Set(authorIds)].filter((id) => !profilesResult.data.some((person) => person.user_id === id))
    const missingAuthorsResult = missingAuthorIds.length
      ? await supabase.from('profiles').select('*').in('user_id', missingAuthorIds)
      : { data: [], error: null }
    if (missingAuthorsResult.error) throw missingAuthorsResult.error

    const people = [...profilesResult.data, ...missingAuthorsResult.data]
    const byId = new Map(people.map((person) => [person.user_id, person]))
    const mediaPaths = [...new Set([
      ...people.flatMap((person) => person.avatar_path ? [person.avatar_path] : []),
      ...postsResult.data.flatMap((post) => post.image_path ? [post.image_path] : []),
    ])]
    const imageMap: Record<string, string> = {}
    if (mediaPaths.length) {
      const signedResult = await supabase.storage.from('network-media').createSignedUrls(mediaPaths, 3600)
      if (signedResult.error) throw signedResult.error
      for (const signed of signedResult.data) {
        if (signed.error) throw new Error(`Could not create an image link: ${signed.error}`)
        if (signed.path && signed.signedUrl) imageMap[signed.path] = signed.signedUrl
      }
    }

    setProfile(profileResult.data)
    if (initializedProfileId.current !== user.id) {
      setHeadline(profileResult.data.headline ?? '')
      setBio(profileResult.data.bio ?? '')
      setLocation(profileResult.data.location ?? '')
      setPortfolioUrl(profileResult.data.portfolio_url ?? '')
      initializedProfileId.current = user.id
    }
    setProfiles(people)
    setImageUrls(imageMap)
    setConnections(connectionsResult.data)
    setPosts(postsResult.data.flatMap((post) => {
      const author = byId.get(post.author_id)
      return author ? [{ ...post, author, imageUrl: post.image_path ? imageMap[post.image_path] ?? null : null }] : []
    }))
    setComments(commentsResult.data.flatMap((comment) => {
      const author = byId.get(comment.author_id)
      return author
        ? [{ ...comment, author, avatarUrl: author.avatar_path ? imageMap[author.avatar_path] ?? null : null }]
        : []
    }))
    setUsefulPostIds(new Set(usefulResult.data.map((mark) => mark.post_id)))
    setLoading(false)
  }, [supabase, user.id])

  const reportInitialLoadError = useCallback((loadError: Error) => {
    setError(`Could not load the home feed: ${loadError.message}`)
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    void loadNetwork().catch((loadError: Error) => { if (active) reportInitialLoadError(loadError) })
    return () => { active = false }
  }, [loadNetwork, reportInitialLoadError])

  useEffect(() => {
    const channel = supabase
      .channel(`social-network:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_posts' }, () => {
        void loadNetwork().catch((loadError: Error) => setError(`Could not refresh the home feed: ${loadError.message}`))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_post_comments' }, () => {
        void loadNetwork().catch((loadError: Error) => setError(`Could not refresh comments: ${loadError.message}`))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_post_useful_marks' }, () => {
        void loadNetwork().catch((loadError: Error) => setError(`Could not refresh useful marks: ${loadError.message}`))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'professional_connections' }, () => {
        void loadNetwork().catch((loadError: Error) => setError(`Could not refresh connections: ${loadError.message}`))
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [supabase, user.id, loadNetwork])

  useEffect(() => () => {
    if (postImagePreviewRef.current) URL.revokeObjectURL(postImagePreviewRef.current)
  }, [])

  useEffect(() => {
    const cleanUrl = projectUrl.trim()
    const validUrl = safeUrl(cleanUrl)
    if (!validUrl || !validUrl.startsWith('https://') || previewStatus !== 'loading') return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void supabase.functions.invoke('link-preview', {
        body: { url: validUrl },
        signal: controller.signal,
      }).then(({ data, error: previewError }) => {
        if (controller.signal.aborted) return
        if (previewError) throw previewError
        if (!data || typeof data.title !== 'string') throw new Error('The preview service returned incomplete metadata.')
        setPreview({ url: validUrl, ...data })
        setPreviewStatus('ready')
      }).catch((previewError: Error) => {
        if (controller.signal.aborted) return
        setPreviewStatus('error')
        setPreviewMessage(`Could not fetch the link preview: ${previewError.message}`)
      })
    }, 500)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [projectUrl, previewStatus, supabase])

  const connectionByPerson = useMemo(() => {
    const index = new Map<string, ProfessionalConnection>()
    for (const connection of connections) {
      index.set(connection.requester_id === user.id ? connection.addressee_id : connection.requester_id, connection)
    }
    return index
  }, [connections, user.id])
  const incoming = connections.filter((connection) => connection.addressee_id === user.id && connection.status === 'pending')
  const connectionCount = connections.filter((connection) => connection.status === 'accepted').length
  const recentActivityByPerson = useMemo(() => {
    const activity = new Map(profiles.map((person) => [person.user_id, person.created_at]))
    for (const post of posts) {
      if (post.created_at > (activity.get(post.author_id) ?? '')) activity.set(post.author_id, post.created_at)
    }
    return activity
  }, [profiles, posts])
  const suggestedPeople = useMemo(() => profiles
    .filter((person) => person.user_id !== user.id && !connectionByPerson.has(person.user_id))
    .sort((first, second) =>
      sharedInterestCount(profile, second) - sharedInterestCount(profile, first)
      || (recentActivityByPerson.get(second.user_id) ?? second.created_at).localeCompare(
        recentActivityByPerson.get(first.user_id) ?? first.created_at,
      ),
    ), [profiles, profile, connectionByPerson, recentActivityByPerson, user.id])
  const visiblePeople = useMemo(() => profiles
    .filter((person) => person.user_id !== user.id && (
      !search.trim() || `${person.display_name} ${person.headline ?? ''} ${person.location ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
    ))
    .sort((first, second) =>
      sharedInterestCount(profile, second) - sharedInterestCount(profile, first)
      || (recentActivityByPerson.get(second.user_id) ?? second.created_at).localeCompare(
        recentActivityByPerson.get(first.user_id) ?? first.created_at,
      ),
    ), [profiles, profile, recentActivityByPerson, search, user.id])
  const recommendedPosts = useMemo(() => [...posts].sort((first, second) => {
    const firstConnected = connectionByPerson.get(first.author_id)?.status === 'accepted'
    const secondConnected = connectionByPerson.get(second.author_id)?.status === 'accepted'
    if (firstConnected !== secondConnected) return firstConnected ? -1 : 1
    const sharedDifference = sharedInterestCount(profile, second.author) - sharedInterestCount(profile, first.author)
    return sharedDifference || second.created_at.localeCompare(first.created_at)
  }), [posts, profile, connectionByPerson])
  const commentsByPost = useMemo(() => {
    const index = new Map<string, FeedComment[]>()
    for (const comment of comments) {
      const postComments = index.get(comment.post_id) ?? []
      postComments.push(comment)
      index.set(comment.post_id, postComments)
    }
    return index
  }, [comments])

  const chooseImage = (file: File | undefined, maximumBytes: number, kind: string) => {
    if (!file) return null
    if (!imageTypes.has(file.type)) {
      setError('Choose a JPG, PNG, or WebP image.')
      return null
    }
    if (file.size > maximumBytes) {
      setError(`${kind} must be ${maximumBytes <= 2 * 1024 * 1024 ? '2' : '5'} MB or smaller.`)
      return null
    }
    setError('')
    return file
  }

  const updatePostImage = (file: File | undefined) => {
    const selected = chooseImage(file, 5 * 1024 * 1024, 'Post image')
    if (!selected) return
    if (postImagePreviewRef.current) URL.revokeObjectURL(postImagePreviewRef.current)
    const objectUrl = URL.createObjectURL(selected)
    postImagePreviewRef.current = objectUrl
    setPostImagePreviewUrl(objectUrl)
    setPostImage(selected)
  }

  const updateProjectUrl = (value: string) => {
    setProjectUrl(value)
    setPreview(null)
    setPreviewMessage('')
    const cleanUrl = value.trim()
    if (!cleanUrl) {
      setPreviewStatus('idle')
      return
    }
    const validUrl = safeUrl(cleanUrl)
    if (!validUrl) {
      setPreviewStatus('error')
      setPreviewMessage('Enter a valid http:// or https:// link.')
    } else if (!validUrl.startsWith('https://')) {
      setPreviewStatus('error')
      setPreviewMessage('Rich previews require an HTTPS link. The post can still include this link.')
    } else {
      setPreviewStatus('loading')
    }
  }

  const createPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanText = postText.trim()
    const cleanUrl = projectUrl.trim()
    if (!cleanText) return
    if (cleanUrl && !safeUrl(cleanUrl)) {
      setError('Use a valid project link starting with https:// or http://.')
      return
    }
    if (previewStatus === 'loading') {
      setError('Wait for the link preview to finish before sharing.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    let uploadedPath: string | null = null
    try {
      if (postImage) {
        const extension = imageTypes.get(postImage.type)
        if (!extension) throw new Error('Choose a JPG, PNG, or WebP image.')
        uploadedPath = `${user.id}/posts/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await supabase.storage.from('network-media').upload(uploadedPath, postImage, {
          contentType: postImage.type,
          cacheControl: '3600',
          upsert: false,
        })
        if (uploadError) throw uploadError
      }
      const linkPreview = preview?.url === safeUrl(cleanUrl) ? preview : null
      const { error: insertError } = await supabase.from('work_posts').insert({
        author_id: user.id,
        content: cleanText,
        project_url: cleanUrl || null,
        project_title: linkPreview?.title ?? null,
        project_description: linkPreview?.description ?? null,
        project_image_url: linkPreview?.image_url ?? null,
        image_path: uploadedPath,
      })
      if (insertError) throw insertError
      setPostText('')
      updateProjectUrl('')
      if (postImagePreviewRef.current) URL.revokeObjectURL(postImagePreviewRef.current)
      postImagePreviewRef.current = null
      setPostImagePreviewUrl(null)
      setPostImage(null)
      await loadNetwork().catch((loadError: Error) => setError(`Your post was published, but the feed could not refresh: ${loadError.message}`))
    } catch (saveError) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from('network-media').remove([uploadedPath])
        if (cleanupError) {
          setError(`Could not publish your work (${(saveError as Error).message}); the uploaded image also needs cleanup (${cleanupError.message}).`)
          setSaving(false)
          return
        }
      }
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
      setNotice('Your profile is up to date.')
    } catch (saveError) {
      setError(`Could not save your profile: ${(saveError as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const uploadAvatar = async (file: File | undefined) => {
    const selected = chooseImage(file, 2 * 1024 * 1024, 'Profile photo')
    if (!selected) return
    const extension = imageTypes.get(selected.type)
    if (!extension) return
    const path = `${user.id}/avatars/${crypto.randomUUID()}.${extension}`
    const oldPath = profile?.avatar_path ?? null
    setSaving(true)
    setError('')
    setNotice('')
    const { error: uploadError } = await supabase.storage.from('network-media').upload(path, selected, {
      contentType: selected.type,
      cacheControl: '3600',
      upsert: false,
    })
    if (uploadError) {
      setError(`Could not upload your profile photo: ${uploadError.message}`)
      setSaving(false)
      return
    }
    const { data, error: updateError } = await supabase.from('profiles')
      .update({ avatar_path: path })
      .eq('user_id', user.id)
      .select('*')
      .single()
    if (updateError) {
      const { error: cleanupError } = await supabase.storage.from('network-media').remove([path])
      setError(cleanupError
        ? `Could not save your photo (${updateError.message}); the uploaded image also needs cleanup (${cleanupError.message}).`
        : `Could not save your profile photo: ${updateError.message}`)
      setSaving(false)
      return
    }
    setProfile(data)
    setProfiles((current) => current.map((person) => person.user_id === user.id ? data : person))
    await loadNetwork().catch((loadError: Error) => setError(`Photo saved, but the profile could not refresh: ${loadError.message}`))
    if (oldPath) {
      const { error: removeError } = await supabase.storage.from('network-media').remove([oldPath])
      if (removeError) setError(`Your new photo is saved, but the old photo could not be removed: ${removeError.message}`)
    }
    setNotice('Your profile photo is up to date.')
    setSaving(false)
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

  const toggleUseful = async (postId: string) => {
    setError('')
    const isUseful = usefulPostIds.has(postId)
    const result = isUseful
      ? await supabase.from('work_post_useful_marks').delete().eq('post_id', postId).eq('user_id', user.id)
      : await supabase.from('work_post_useful_marks').insert({ post_id: postId, user_id: user.id })
    if (result.error) {
      setError(`Could not update your useful mark: ${result.error.message}`)
      return
    }
    setUsefulPostIds((current) => {
      const next = new Set(current)
      if (isUseful) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  const addComment = async (event: FormEvent<HTMLFormElement>, postId: string) => {
    event.preventDefault()
    const content = commentDrafts[postId]?.trim() ?? ''
    if (!content) return
    setError('')
    const { error: insertError } = await supabase.from('work_post_comments').insert({
      post_id: postId,
      author_id: user.id,
      content,
    })
    if (insertError) {
      setError(`Could not add your comment: ${insertError.message}`)
      return
    }
    setCommentDrafts((current) => ({ ...current, [postId]: '' }))
    await loadNetwork().catch((loadError: Error) => setError(`Comment saved, but comments could not refresh: ${loadError.message}`))
  }

  const removeComment = async (comment: FeedComment) => {
    const { error: deleteError } = await supabase.from('work_post_comments').delete().eq('id', comment.id)
    if (deleteError) {
      setError(`Could not remove the comment: ${deleteError.message}`)
      return
    }
    setComments((current) => current.filter((item) => item.id !== comment.id))
  }

  const removePost = async (post: FeedPost) => {
    if (!window.confirm('Delete this work post? This cannot be undone.')) return
    const { error: deleteError } = await supabase.from('work_posts').delete().eq('id', post.id).eq('author_id', user.id)
    if (deleteError) {
      setError(`Could not delete the post: ${deleteError.message}`)
      return
    }
    if (post.image_path) {
      const { error: removeError } = await supabase.storage.from('network-media').remove([post.image_path])
      if (removeError) setError(`The post was deleted, but its image could not be removed: ${removeError.message}`)
    }
    setPosts((current) => current.filter((item) => item.id !== post.id))
    setComments((current) => current.filter((item) => item.post_id !== post.id))
  }

  const updateCommentDraft = (postId: string, value: string) => {
    setCommentDrafts((current) => ({ ...current, [postId]: value }))
  }

  const toggleComments = (postId: string) => {
    setOpenCommentPosts((current) => {
      const next = new Set(current)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  return (
    <section className="network-content">
      <header className="network-heading">
        <div>
          <p className="eyebrow"><Sparkles size={13} /> Ideas, work, community</p>
          <h1>Your corner of the professional world.</h1>
          <p className="board-subtitle">A place to share what you’re making and meet people who care about the same things.</p>
        </div>
        <div className="network-stat"><Users size={17} /><strong>{connectionCount}</strong><span>connections</span></div>
      </header>

      <nav className="network-tabs" aria-label="Social network sections">
        <button className={tab === 'feed' ? 'network-tab-active' : ''} onClick={() => setTab('feed')}>Home feed</button>
        <button className={tab === 'people' ? 'network-tab-active' : ''} onClick={() => setTab('people')}>Discover{incoming.length > 0 && <span className="network-tab-count">{incoming.length}</span>}</button>
        <button className={tab === 'profile' ? 'network-tab-active' : ''} onClick={() => setTab('profile')}>My profile</button>
      </nav>

      {error && <div className="network-alert network-alert-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
      {notice && <div className="network-alert network-alert-success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={15} /></button></div>}

      {loading ? (
        <div className="network-empty"><span className="network-avatar"><Users size={20} /></span><p>Loading your home feed…</p></div>
      ) : tab === 'feed' ? (
        <div className="network-feed-layout">
          <div className="network-feed-main">
            <form className="network-compose" onSubmit={createPost}>
              <div className="network-compose-top">
                <Avatar name={profile?.display_name ?? fallbackName} imageUrl={profile?.avatar_path ? imageUrls[profile.avatar_path] ?? null : null} />
                <label className="sr-only" htmlFor="work-post">Share a work update</label>
                <textarea id="work-post" value={postText} onChange={(event) => setPostText(event.target.value)} maxLength={2000} placeholder="Share an idea, project, or small win…" required />
              </div>
              <div className="network-compose-bottom">
                <label className="network-link-input"><Globe2 size={15} /><span className="sr-only">Project or portfolio link</span><input type="url" value={projectUrl} onChange={(event) => updateProjectUrl(event.target.value)} maxLength={2048} placeholder="Add a link (optional)" /></label>
                <label className="network-image-picker">
                  <ImagePlus size={15} /><span>{postImage ? 'Change image' : 'Add one image'}</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => updatePostImage(event.currentTarget.files?.[0])} />
                </label>
                <button className="primary-button" disabled={saving || !postText.trim() || previewStatus === 'loading'}>{saving ? 'Sharing…' : <><Send size={14} /> Share work</>}</button>
              </div>
              {postImagePreviewUrl && (
                <div className="network-compose-image-preview">
                  <img src={postImagePreviewUrl} alt="Selected post preview" />
                  <button type="button" className="quiet-button" onClick={() => { if (postImagePreviewRef.current) URL.revokeObjectURL(postImagePreviewRef.current); postImagePreviewRef.current = null; setPostImagePreviewUrl(null); setPostImage(null) }} aria-label="Remove selected image"><X size={14} /> Remove</button>
                </div>
              )}
              {projectUrl.trim() && previewStatus === 'loading' && <p className="network-preview-status" role="status">Creating a secure link preview…</p>}
              {previewStatus === 'error' && <p className="network-preview-status network-preview-error" role="status">{previewMessage}</p>}
              {previewStatus === 'ready' && preview && (
                <LinkPreviewCard href={preview.url} title={preview.title} description={preview.description} imageUrl={preview.image_url} siteName={preview.site_name} />
              )}
              <small className="network-compose-note">Visible to signed-in ToDoo members · one image, up to 5 MB · {postText.length}/2000</small>
            </form>

            {recommendedPosts.length ? recommendedPosts.map((post) => {
              const postComments = commentsByPost.get(post.id) ?? []
              const authorConnected = connectionByPerson.get(post.author_id)?.status === 'accepted'
              const interestCount = sharedInterestCount(profile, post.author)
              const recommendationReason = authorConnected
                ? 'From your network'
                : interestCount > 0
                  ? `Shares ${interestCount} professional interest${interestCount === 1 ? '' : 's'}`
                  : 'A recent community post'
              const commentListOpen = openCommentPosts.has(post.id)
              return (
                <article className="network-post" key={post.id}>
                  <p className="network-recommendation"><Sparkles size={12} /> {recommendationReason}</p>
                  <header className="network-post-author">
                    <Avatar name={post.author.display_name} imageUrl={post.author.avatar_path ? imageUrls[post.author.avatar_path] ?? null : null} />
                    <span className="network-author-copy"><strong>{post.author.display_name}</strong><small>{post.author.headline || 'ToDoo member'} · {timeAgo(post.created_at)}</small></span>
                    {post.author_id === user.id && <button className="quiet-button network-delete" onClick={() => void removePost(post)} aria-label="Delete your work post"><X size={16} /></button>}
                  </header>
                  <p className="network-post-text">{post.content}</p>
                  {post.imageUrl && <img className="network-post-image" src={post.imageUrl} alt={`Image shared by ${post.author.display_name}`} loading="lazy" />}
                  {post.project_url && (
                    <LinkPreviewCard
                      href={post.project_url}
                      title={post.project_title}
                      description={post.project_description}
                      imageUrl={post.project_image_url}
                      siteName={null}
                    />
                  )}
                  <div className="network-post-actions">
                    <button className={`network-action-button ${usefulPostIds.has(post.id) ? 'network-action-active' : ''}`} onClick={() => void toggleUseful(post.id)} aria-pressed={usefulPostIds.has(post.id)}>
                      <ThumbsUp size={15} /> {usefulPostIds.has(post.id) ? 'Marked useful' : 'Mark useful'}
                    </button>
                    <button className="network-action-button" onClick={() => toggleComments(post.id)} aria-expanded={commentListOpen}>
                      <MessageCircle size={15} /> Comments <span>{postComments.length}</span>
                    </button>
                  </div>
                  {commentListOpen && (
                    <section className="network-comments" aria-label={`Comments on ${post.author.display_name}'s post`}>
                      {postComments.map((comment) => (
                        <article className="network-comment" key={comment.id}>
                          <Avatar name={comment.author.display_name} imageUrl={comment.avatarUrl} size="network-avatar-small" />
                          <div className="network-comment-content">
                            <strong>{comment.author.display_name}<small> · {timeAgo(comment.created_at)}</small></strong>
                            <p>{comment.content}</p>
                          </div>
                          {(comment.author_id === user.id || post.author_id === user.id) && <button className="network-comment-delete" onClick={() => void removeComment(comment)} aria-label="Delete comment"><X size={13} /></button>}
                        </article>
                      ))}
                      <form className="network-comment-form" onSubmit={(event) => void addComment(event, post.id)}>
                        <label className="sr-only" htmlFor={`comment-${post.id}`}>Write a comment</label>
                        <input id={`comment-${post.id}`} value={commentDrafts[post.id] ?? ''} onChange={(event) => updateCommentDraft(post.id, event.target.value)} placeholder="Add a thoughtful comment…" maxLength={1000} />
                        <button className="quiet-button" disabled={!commentDrafts[post.id]?.trim()} aria-label="Post comment"><Send size={14} /></button>
                      </form>
                    </section>
                  )}
                </article>
              )
            }) : <div className="network-empty"><span className="network-avatar"><BriefcaseBusiness size={20} /></span><h2>Your feed starts here.</h2><p>Share a project or a recent win, then connect with people who share your interests.</p></div>}
          </div>

          <aside className="network-side-card">
            <div className="network-side-profile"><Avatar name={profile?.display_name ?? fallbackName} imageUrl={profile?.avatar_path ? imageUrls[profile.avatar_path] ?? null : null} size="network-avatar-large" /><strong>{profile?.display_name ?? fallbackName}</strong><span>{profile?.headline || 'Add a headline to introduce yourself.'}</span></div>
            {profile?.location && <p className="network-location"><MapPin size={14} />{profile.location}</p>}
            <button className="network-edit-profile" onClick={() => setTab('profile')}><Pencil size={14} /> Complete your profile</button>
            <button className="network-discover-link" onClick={() => setTab('people')}><UserRoundPlus size={14} /> Find professionals</button>
            {suggestedPeople.length > 0 && (
              <section className="network-suggestions">
                <h2>Suggested for you</h2>
                {suggestedPeople.slice(0, 3).map((person) => {
                  const interests = sharedInterestCount(profile, person)
                  return (
                    <article className="network-suggestion" key={person.user_id}>
                      <Avatar name={person.display_name} imageUrl={person.avatar_path ? imageUrls[person.avatar_path] ?? null : null} size="network-avatar-small" />
                      <span><strong>{person.display_name}</strong><small>{interests ? `${interests} shared interest${interests === 1 ? '' : 's'}` : person.headline || 'New member'}</small></span>
                      <button onClick={() => void sendRequest(person.user_id)} aria-label={`Connect with ${person.display_name}`}><UserRoundPlus size={14} /></button>
                    </article>
                  )
                })}
              </section>
            )}
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
                    <Avatar name={person.display_name} imageUrl={person.avatar_path ? imageUrls[person.avatar_path] ?? null : null} />
                    <span className="network-person-copy"><strong>{person.display_name}</strong><small>{person.headline || 'ToDoo member'}</small></span>
                    <div className="network-person-actions"><button className="primary-button" onClick={() => void respondToRequest(connection, true)}><Check size={14} /> Accept</button><button className="quiet-button" onClick={() => void respondToRequest(connection, false)}>Decline</button></div>
                  </article>
                ) : null
              })}
            </section>
          )}
          <div className="network-section-heading"><div><h2>People you may know</h2><p>Suggested by shared professional interests, then recent activity.</p></div><label className="network-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people" aria-label="Search professionals" /></label></div>
          <div className="network-people-grid">
            {visiblePeople.map((person) => {
              const connection = connectionByPerson.get(person.user_id)
              const incomingRequest = connection?.status === 'pending' && connection.addressee_id === user.id
              const interests = sharedInterestCount(profile, person)
              return (
                <article className="network-person-card" key={person.user_id}>
                  <Avatar name={person.display_name} imageUrl={person.avatar_path ? imageUrls[person.avatar_path] ?? null : null} size="network-avatar-large" />
                  <div className="network-person-copy"><strong>{person.display_name}</strong><small>{person.headline || 'ToDoo member'}</small>{person.location && <small className="network-person-location"><MapPin size={12} />{person.location}</small>}{interests > 0 && <small>{interests} shared professional interest{interests === 1 ? '' : 's'}</small>}</div>
                  {person.portfolio_url && safeUrl(person.portfolio_url) && <a className="network-person-link" href={safeUrl(person.portfolio_url) ?? undefined} target="_blank" rel="noopener noreferrer" aria-label={`Open ${person.display_name}'s portfolio`}><ArrowUpRight size={15} /></a>}
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
          <div className="network-profile-banner">
            <Avatar name={profile?.display_name ?? fallbackName} imageUrl={profile?.avatar_path ? imageUrls[profile.avatar_path] ?? null : null} size="network-avatar-xl" />
            <div><p className="eyebrow">Your public introduction</p><h2>{profile?.display_name ?? fallbackName}</h2><span>{user.email}</span></div>
          </div>
          <label className="network-avatar-upload"><ImagePlus size={15} /> Upload profile photo
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadAvatar(event.currentTarget.files?.[0])} disabled={saving} />
          </label>
          <small className="network-upload-note">JPG, PNG, or WebP · up to 2 MB</small>
          <label>Professional headline<input value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={120} placeholder="e.g. Product designer building accessible tools" /></label>
          <label>About<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={1000} rows={5} placeholder="Share your experience, interests, and what you’re working on." /></label>
          <div className="network-profile-row">
            <label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} placeholder="e.g. Bengaluru, India" /></label>
            <label>Portfolio or website<input type="url" value={portfolioUrl} onChange={(event) => setPortfolioUrl(event.target.value)} maxLength={2048} placeholder="https://yourportfolio.com" /></label>
          </div>
          <p className="network-profile-note">Your name, photo, headline, about section, location, and portfolio are visible to signed-in ToDoo members.</p>
          <button className="primary-button network-save-profile" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        </form>
      )}
    </section>
  )
}
