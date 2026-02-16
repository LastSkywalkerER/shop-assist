import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TelegramAuthData {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authData: TelegramAuthData = await req.json()

    // Verify Telegram hash
    const botToken = Deno.env.get('BOT_TOKEN')
    if (!botToken) {
      throw new Error('BOT_TOKEN not configured')
    }

    const isValid = await verifyTelegramAuth(authData, botToken)
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid Telegram authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Check if user exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, auth_user_id')
      .eq('telegram_id', authData.id)
      .single()

    let userId: string
    let authUserId: string | null = null

    if (existingUser) {
      // User exists - update info
      userId = existingUser.id
      authUserId = existingUser.auth_user_id

      await supabaseAdmin
        .from('users')
        .update({
          username: authData.username,
          first_name: authData.first_name,
          last_name: authData.last_name,
          photo_url: authData.photo_url,
          auth_date: authData.auth_date,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
    } else {
      // New user - create record
      const { data: newUser, error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          telegram_id: authData.id,
          username: authData.username,
          first_name: authData.first_name,
          last_name: authData.last_name,
          photo_url: authData.photo_url,
          auth_date: authData.auth_date
        })
        .select('id')
        .single()

      if (insertError || !newUser) {
        throw new Error(`Failed to create user: ${insertError?.message}`)
      }

      userId = newUser.id
    }

    // Check for personal room
    const { data: personalRoom } = await supabaseAdmin
      .from('rooms')
      .select('id')
      .eq('owner_id', userId)
      .eq('is_personal', true)
      .single()

    let roomId: string

    if (personalRoom) {
      roomId = personalRoom.id
    } else {
      // Create personal room
      const { data: newRoom, error: roomError } = await supabaseAdmin
        .from('rooms')
        .insert({
          name: 'My Room',
          owner_id: userId,
          is_personal: true
        })
        .select('id')
        .single()

      if (roomError || !newRoom) {
        throw new Error(`Failed to create room: ${roomError?.message}`)
      }

      roomId = newRoom.id

      // Create room membership
      await supabaseAdmin
        .from('room_memberships')
        .insert({
          user_id: userId,
          room_id: roomId,
          role: 'owner'
        })
    }

    // Create or get auth user
    if (!authUserId) {
      // Create auth user with unique email
      const email = `telegram_${authData.id}@shopassist.app`
      const password = crypto.randomUUID()

      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          telegram_id: authData.id,
          username: authData.username,
          first_name: authData.first_name,
          room_id: roomId
        }
      })

      if (authError || !authUser.user) {
        throw new Error(`Failed to create auth user: ${authError?.message}`)
      }

      authUserId = authUser.user.id

      // Link auth_user_id to users table
      await supabaseAdmin
        .from('users')
        .update({ auth_user_id: authUserId })
        .eq('id', userId)
    } else {
      // Update existing auth user metadata with current room_id
      await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        user_metadata: {
          telegram_id: authData.id,
          username: authData.username,
          first_name: authData.first_name,
          room_id: roomId
        }
      })
    }

    // Generate JWT tokens
    const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: `telegram_${authData.id}@shopassist.app`
    })

    if (sessionError || !sessionData) {
      throw new Error(`Failed to generate session: ${sessionError?.message}`)
    }

    // Get full user data
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()

    // Return success with tokens
    return new Response(
      JSON.stringify({
        user: userData,
        room_id: roomId,
        access_token: sessionData.properties.action_link.split('#')[1]?.split('&')[0]?.replace('access_token=', ''),
        refresh_token: sessionData.properties.action_link.split('refresh_token=')[1]?.split('&')[0]
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

async function verifyTelegramAuth(data: TelegramAuthData, botToken: string): Promise<boolean> {
  const { hash, ...authData } = data

  // Create data check string
  const checkString = Object.keys(authData)
    .sort()
    .map(key => `${key}=${authData[key as keyof typeof authData]}`)
    .join('\n')

  // Create secret key from bot token
  const encoder = new TextEncoder()
  const secretKey = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', encoder.encode(botToken)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // Calculate hash
  const signature = await crypto.subtle.sign(
    'HMAC',
    secretKey,
    encoder.encode(checkString)
  )

  const calculatedHash = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return calculatedHash === hash
}
