import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'

interface TelegramAuthData {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function verifyTelegramAuth(data: TelegramAuthData, botToken: string): Promise<boolean> {
  const { hash, ...checkData } = data
  const dataCheckString = Object.keys(checkData)
    .sort()
    .map(k => `${k}=${checkData[k as keyof typeof checkData]}`)
    .join('\n')
  const encoder = new TextEncoder()
  const tokenHash = await crypto.subtle.digest('SHA-256', encoder.encode(botToken))
  const secretKey = await crypto.subtle.importKey(
    'raw', tokenHash, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(dataCheckString))
  const hexSignature = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  return hexSignature === hash
}

async function verifyMiniAppInitData(initDataRaw: string, botToken: string): Promise<any> {
  const urlParams = new URLSearchParams(initDataRaw)
  const hash = urlParams.get('hash')
  urlParams.delete('hash')
  const dataCheckString = Array.from(urlParams.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`).join('\n')
  const encoder = new TextEncoder()
  const webAppDataKey = await crypto.subtle.importKey(
    'raw', encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const secretKeyData = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(botToken))
  const secretKey = await crypto.subtle.importKey(
    'raw', secretKeyData,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(dataCheckString))
  const hexSignature = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  if (hexSignature !== hash) throw new Error('Invalid initData signature')
  const userParam = urlParams.get('user')
  if (!userParam) throw new Error('No user data in initData')
  return JSON.parse(userParam)
}

function extractStartParam(initDataRaw: string): string | null {
  try {
    const urlParams = new URLSearchParams(initDataRaw)
    return urlParams.get('start_param') || null
  } catch {
    return null
  }
}

/** Find an auth user by email across all pages. */
async function findAuthUserByEmail(supabase: any, email: string): Promise<any | null> {
  let page = 1
  const perPage = 1000
  while (true) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage })
    if (!data?.users?.length) return null
    const found = data.users.find((u: any) => u.email === email)
    if (found) return found
    if (data.users.length < perPage) return null
    page++
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const botToken = Deno.env.get('BOT_TOKEN')
    if (!botToken) throw new Error('BOT_TOKEN not configured')

    let userData: any
    let startParam: string | null = null

    if (body.initDataRaw) {
      userData = await verifyMiniAppInitData(body.initDataRaw, botToken)
      startParam = extractStartParam(body.initDataRaw)
    } else {
      const isValid = await verifyTelegramAuth(body as TelegramAuthData, botToken)
      if (!isValid) {
        return new Response(JSON.stringify({ error: 'Invalid auth data' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      userData = body
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Upsert app user record
    const { data: user, error: userError } = await supabase
      .from('users')
      .upsert({
        telegram_id: userData.id,
        username: userData.username,
        first_name: userData.first_name,
        last_name: userData.last_name,
        photo_url: userData.photo_url,
        auth_date: userData.auth_date || Math.floor(Date.now() / 1000),
      }, { onConflict: 'telegram_id' })
      .select().single()

    if (userError) throw userError

    // Ensure personal room exists
    const { data: existingRoom } = await supabase
      .from('rooms')
      .select('id')
      .eq('owner_id', user.id)
      .eq('is_personal', true)
      .maybeSingle()

    let personalRoomId = existingRoom?.id

    if (!personalRoomId) {
      const roomName = `${userData.first_name}'s room`
      const { data: newRoom, error: roomError } = await supabase
        .from('rooms')
        .insert({ name: roomName, owner_id: user.id, is_personal: true })
        .select().single()
      if (roomError) throw roomError
      personalRoomId = newRoom.id
      await supabase.from('room_memberships').insert({
        user_id: user.id, room_id: personalRoomId, role: 'owner'
      })
    }

    // Default to personal room; will be overridden by stored JWT room_id or invite below
    let roomId = personalRoomId

    // Handle invite code from startapp parameter (takes priority)
    let inviteResult: any = null
    if (startParam && startParam.startsWith('inv_')) {
      const inviteCode = startParam.slice(4)
      const { data: invite } = await supabase
        .from('room_invites')
        .select('*, rooms(name)')
        .eq('invite_code', inviteCode)
        .maybeSingle()

      if (invite) {
        const isExpired = invite.expires_at && new Date(invite.expires_at) < new Date()
        const isMaxed = invite.max_uses && invite.use_count >= invite.max_uses

        if (!isExpired && !isMaxed) {
          const { data: existingMembership } = await supabase
            .from('room_memberships')
            .select('id')
            .eq('user_id', user.id)
            .eq('room_id', invite.room_id)
            .maybeSingle()

          if (existingMembership) {
            inviteResult = { status: 'already_member', room_id: invite.room_id, room_name: invite.rooms?.name }
            roomId = invite.room_id
          } else {
            await supabase.from('room_memberships').insert({
              user_id: user.id, room_id: invite.room_id, role: invite.role
            })
            await supabase.from('room_invites')
              .update({ use_count: invite.use_count + 1 })
              .eq('id', invite.id)
            inviteResult = { status: 'joined', room_id: invite.room_id, room_name: invite.rooms?.name, role: invite.role }
            roomId = invite.room_id
          }
        } else {
          inviteResult = { status: 'expired' }
        }
      } else {
        inviteResult = { status: 'not_found' }
      }
    }

    // Get all rooms for the user
    const { data: memberships } = await supabase
      .from('room_memberships')
      .select('room_id, role, rooms(id, name, is_personal, owner_id, created_at, updated_at)')
      .eq('user_id', user.id)

    const rooms = (memberships || []).map((m: any) => ({ ...m.rooms, role: m.role }))

    // Resolve auth user: prefer stored auth_user_id, then search by email, then create
    const email = `${userData.id}@telegram.user`
    const tempPassword = `tg_${userData.id}_${Date.now()}`

    let authUserId: string
    let accessToken: string
    let refreshToken: string

    if (user.auth_user_id) {
      authUserId = user.auth_user_id

      // If no invite override, preserve the room_id already stored in JWT metadata
      // (user may have switched rooms previously — don't reset it to personal room)
      if (!inviteResult) {
        const existingAuthUser = await supabase.auth.admin.getUserById(authUserId)
        const storedRoomId = existingAuthUser.data?.user?.user_metadata?.room_id
        if (storedRoomId) {
          // Verify the stored room is still a valid membership
          const { data: membership } = await supabase
            .from('room_memberships')
            .select('room_id')
            .eq('user_id', user.id)
            .eq('room_id', storedRoomId)
            .maybeSingle()
          if (membership) roomId = storedRoomId
        }
      }

      await supabase.auth.admin.updateUserById(authUserId, {
        user_metadata: {
          telegram_id: userData.id,
          username: userData.username,
          first_name: userData.first_name,
          user_db_id: user.id,
          room_id: roomId,
        },
        password: tempPassword,
      })

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email, password: tempPassword
      })
      if (signInError) throw signInError
      accessToken = signInData.session!.access_token
      refreshToken = signInData.session!.refresh_token
    } else {
      // No stored auth_user_id — try to find existing auth user or create one
      let existingAuthUser = await findAuthUserByEmail(supabase, email)

      if (!existingAuthUser) {
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            telegram_id: userData.id,
            username: userData.username,
            first_name: userData.first_name,
            user_db_id: user.id,
            room_id: roomId,
          },
        })

        if (authError) {
          if (authError.message?.toLowerCase().includes('already') || authError.message?.toLowerCase().includes('registered')) {
            existingAuthUser = await findAuthUserByEmail(supabase, email)
            if (!existingAuthUser) throw new Error(`Auth user exists but cannot be found: ${authError.message}`)
          } else {
            throw authError
          }
        } else {
          existingAuthUser = authData.user
        }
      }

      authUserId = existingAuthUser.id

      await supabase.auth.admin.updateUserById(authUserId, {
        user_metadata: {
          telegram_id: userData.id,
          username: userData.username,
          first_name: userData.first_name,
          user_db_id: user.id,
          room_id: roomId,
        },
        password: tempPassword,
      })

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email, password: tempPassword
      })
      if (signInError) throw signInError
      accessToken = signInData.session!.access_token
      refreshToken = signInData.session!.refresh_token

      await supabase
        .from('users')
        .update({ auth_user_id: authUserId })
        .eq('id', user.id)
    }

    return new Response(JSON.stringify({
      user, room_id: roomId, rooms, access_token: accessToken, refresh_token: refreshToken,
      invite_result: inviteResult,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
