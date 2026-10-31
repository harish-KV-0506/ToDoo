const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const maximumHtmlBytes = 512 * 1024

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function isPublicIpv4(address: string) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [first, second, third] = parts
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false
  if (first === 100 && second >= 64 && second <= 127) return false
  if (first === 169 && second === 254) return false
  if (first === 172 && second >= 16 && second <= 31) return false
  if (first === 192 && second === 168) return false
  if (first === 192 && second === 0 && (third === 0 || third === 2)) return false
  if (first === 192 && second === 88 && third === 99) return false
  if (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) return false
  if (first === 203 && second === 0 && third === 113) return false
  return true
}

function isPublicIpv6(address: string) {
  const normalized = address.toLowerCase().split('%')[0]
  if (!/^[23]/.test(normalized)) return false
  return !normalized.startsWith('2001:db8:') && !normalized.startsWith('2001:0:') && !normalized.startsWith('2002:')
}

async function validatePublicHttpsUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a valid HTTPS link.')
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || (url.port && url.port !== '443')
    || !host
    || host.includes(':')
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)
  ) {
    throw new Error('Only public HTTPS links can be previewed.')
  }

  const [ipv4Records, ipv6Records] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ])
  const addresses = [...ipv4Records, ...ipv6Records]
  if (!addresses.length) throw new Error('The link host could not be resolved.')
  if (addresses.some((address) => address.includes(':') ? !isPublicIpv6(address) : !isPublicIpv4(address))) {
    throw new Error('Private or reserved network destinations cannot be previewed.')
  }
  return url
}

function decodeHtml(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x[0-9a-f]+|#\d+);/gi, (entity) => {
    const key = entity.toLowerCase()
    if (key === '&amp;') return '&'
    if (key === '&lt;') return '<'
    if (key === '&gt;') return '>'
    if (key === '&quot;') return '"'
    if (key === '&apos;' || key === '&#39;') return "'"
    if (key === '&nbsp;') return ' '
    const numeric = key.startsWith('&#x')
      ? Number.parseInt(key.slice(3, -1), 16)
      : Number.parseInt(key.slice(2, -1), 10)
    return Number.isInteger(numeric) && numeric > 0 && numeric <= 0x10ffff
      ? String.fromCodePoint(numeric)
      : ''
  })
}

function cleanText(value: string | null, maximumLength: number) {
  return value?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximumLength) || null
}

async function readMetadata(html: string, pageUrl: URL) {
  const values = new Map<string, string>()
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map<string, string>()
    for (const attribute of tag[0].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? '')
    }
    const key = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase()
    const content = attributes.get('content')
    if (key && content && !values.has(key)) values.set(key, decodeHtml(content))
  }

  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
  const title = cleanText(values.get('og:title') ?? values.get('twitter:title') ?? decodeHtml(titleTag), 200)
  if (!title) throw new Error('The linked site did not provide a page title.')

  const description = cleanText(values.get('og:description') ?? values.get('description') ?? values.get('twitter:description') ?? null, 500)
  const rawImage = values.get('og:image:secure_url') ?? values.get('og:image') ?? values.get('twitter:image') ?? null
  let imageUrl: string | null = null
  if (rawImage) {
    try {
      const candidate = await validatePublicHttpsUrl(new URL(rawImage, pageUrl).toString())
      imageUrl = candidate.toString()
    } catch {
      imageUrl = null
    }
  }

  return {
    title,
    description,
    image_url: imageUrl,
    site_name: cleanText(values.get('og:site_name') ?? null, 120),
  }
}

async function readHtml(response: Response) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error('The link does not point to an HTML page.')
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumHtmlBytes) {
    throw new Error('The linked page is too large to preview.')
  }
  if (!response.body) throw new Error('The linked page did not return preview content.')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumHtmlBytes) {
        await reader.cancel()
        throw new Error('The linked page is too large to preview.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply({ error: 'Use POST to request a link preview.' }, 405)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return reply({ error: 'The request body must be valid JSON.' }, 400)
  }
  if (!body || typeof body !== 'object' || !('url' in body) || typeof body.url !== 'string' || body.url.length > 2048) {
    return reply({ error: 'Provide one link of 2048 characters or fewer.' }, 400)
  }

  try {
    const url = await validatePublicHttpsUrl(body.url)
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'ToDoo Link Preview/1.0',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return reply({ error: 'The linked site did not allow a preview.' }, 422)
    const html = await readHtml(response)
    return reply({ url: url.toString(), ...await readMetadata(html, url) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The link preview could not be created.'
    const clientError = message.startsWith('Only public')
      || message.startsWith('Private or reserved')
      || message.startsWith('Enter a valid')
    return reply({ error: message }, clientError ? 400 : 422)
  }
})
