import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function inviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply({ error: 'Use POST to send a workspace invitation.' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in before inviting a teammate.' }, 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return reply({ error: 'The request body must be valid JSON.' }, 400)
  }
  if (
    !body || typeof body !== 'object'
    || !('target_workspace' in body) || typeof body.target_workspace !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.target_workspace)
    || !('invited_email' in body) || typeof body.invited_email !== 'string'
    || body.invited_email.length > 320
  ) {
    return reply({ error: 'Provide a workspace and a valid email address.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !supabaseKey) return reply({ error: 'The invitation service is not configured.' }, 503)

  const token = inviteToken()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const appUrl = Deno.env.get('APP_URL') ?? 'https://harish-kv-0506.github.io/ToDoo/'
  let inviteUrl: URL
  try {
    inviteUrl = new URL(appUrl)
    if (inviteUrl.protocol !== 'https:' && inviteUrl.hostname !== 'localhost') {
      return reply({ error: 'The invitation app URL must use HTTPS.' }, 500)
    }
    inviteUrl.searchParams.set('invite', token)
  } catch {
    return reply({ error: 'Configure APP_URL as a valid HTTPS application URL.' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(authorization.slice('Bearer '.length))
  if (authError || !user) return reply({ error: 'Your session is invalid or expired. Sign in again.' }, 401)

  const invitedEmail = body.invited_email.trim().toLowerCase()
  const { error: createError } = await supabase.rpc('create_workspace_invitation', {
    target_workspace: body.target_workspace,
    invited_email: invitedEmail,
    token_hash: tokenHash,
  })
  if (createError) return reply({ error: createError.message }, 400)

  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('name')
    .eq('id', body.target_workspace)
    .single()
  if (workspaceError) return reply({ error: `The invitation was created, but the board name could not be loaded: ${workspaceError.message}`, invite_url: inviteUrl.toString(), email_sent: false }, 200)

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('INVITE_FROM_EMAIL')
  if (!apiKey || !fromEmail) {
    return reply({
      invite_url: inviteUrl.toString(),
      email_sent: false,
      message: 'The invite link was created, but email is not configured. Add RESEND_API_KEY and INVITE_FROM_EMAIL to Supabase Edge Function secrets.',
    })
  }

  const sender = user.user_metadata.display_name?.trim() || user.email || 'A ToDoo member'
  const escapedSender = escapeHtml(sender)
  const escapedWorkspace = escapeHtml(workspace.name)
  const escapedUrl = escapeHtml(inviteUrl.toString())
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [invitedEmail],
        subject: `${sender} invited you to a ToDoo board`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#34372e"><p style="color:#687953;font-weight:bold">ToDoo</p><h1 style="font-size:24px">You’re invited to collaborate</h1><p>${escapedSender} invited you to join <strong>${escapedWorkspace}</strong>.</p><p>Sign in or create a ToDoo account using <strong>${escapeHtml(invitedEmail)}</strong>, then accept the invitation:</p><p style="margin:28px 0"><a href="${escapedUrl}" style="background:#64764f;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Accept invitation</a></p><p style="font-size:12px;color:#777">This link expires in 7 days and can only be used by the invited email address.</p></div>`,
        text: `${sender} invited you to join ${workspace.name} on ToDoo. Sign in or create an account with ${invitedEmail}, then accept the invitation: ${inviteUrl.toString()}. This link expires in 7 days.`,
      }),
    })
    if (!response.ok) {
      const responseText = await response.text()
      console.error(`Resend invitation request failed (${response.status}): ${responseText.slice(0, 1000)}`)
      return reply({
        invite_url: inviteUrl.toString(),
        email_sent: false,
        message: 'The invite link was created, but the email provider could not send the message. Check the Resend API key and verified sender address.',
      })
    }
  } catch (sendError) {
    console.error(`Resend invitation request failed: ${sendError instanceof Error ? sendError.message : 'network error'}`)
    return reply({
      invite_url: inviteUrl.toString(),
      email_sent: false,
      message: 'The invite link was created, but the email provider could not be reached. Check the Supabase function logs and try again.',
    })
  }

  return reply({ invite_url: inviteUrl.toString(), email_sent: true, message: `Invitation email sent to ${invitedEmail}.` })
})
