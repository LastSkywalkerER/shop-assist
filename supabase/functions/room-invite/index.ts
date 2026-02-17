import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify the JWT and get user
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get the app user by auth_user_id
    let { data: appUser } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', authUser.id)
      .maybeSingle()

    // Fallback: look up by telegram_id from JWT metadata and fix the link
    if (!appUser && authUser.user_metadata?.telegram_id) {
      const { data: userByTelegram } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', authUser.user_metadata.telegram_id)
        .maybeSingle()

      if (userByTelegram) {
        await supabase
          .from('users')
          .update({ auth_user_id: authUser.id })
          .eq('id', userByTelegram.id)
        appUser = userByTelegram
      }
    }

    if (!appUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json()
    const { action } = body

    if (action === 'create') {
      const roomId = body.room_id
      const role = body.role || 'editor'

      // Verify user is a member of this room
      const { data: membership } = await supabase
        .from('room_memberships')
        .select('role')
        .eq('user_id', appUser.id)
        .eq('room_id', roomId)
        .single()

      if (!membership) {
        return new Response(JSON.stringify({ error: 'Not a member of this room' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Check if there's already an active invite for this room by this user
      const { data: existing } = await supabase
        .from('room_invites')
        .select('*')
        .eq('room_id', roomId)
        .eq('created_by', appUser.id)
        .is('expires_at', null)
        .maybeSingle()

      if (existing) {
        const botUsername = Deno.env.get('BOT_USERNAME') || 'SkyShopAssistBot'
        const miniAppSlug = Deno.env.get('MINI_APP_SLUG') || 'skyshopassist'
        const deepLink = `https://t.me/${botUsername}/${miniAppSlug}?startapp=inv_${existing.invite_code}`
        return new Response(JSON.stringify({ invite: existing, deep_link: deepLink }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const inviteCode = generateInviteCode()
      const { data: invite, error: inviteError } = await supabase
        .from('room_invites')
        .insert({
          room_id: roomId,
          invite_code: inviteCode,
          created_by: appUser.id,
          role,
        })
        .select()
        .single()

      if (inviteError) throw inviteError

      const botUsername = Deno.env.get('BOT_USERNAME') || 'SkyShopAssistBot'
      const miniAppSlug = Deno.env.get('MINI_APP_SLUG') || 'skyshopassist'
      const deepLink = `https://t.me/${botUsername}/${miniAppSlug}?startapp=inv_${inviteCode}`

      return new Response(JSON.stringify({ invite, deep_link: deepLink }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } else if (action === 'accept') {
      const inviteCode = body.invite_code

      const { data: invite, error: inviteError } = await supabase
        .from('room_invites')
        .select('*, rooms(name)')
        .eq('invite_code', inviteCode)
        .maybeSingle()

      if (inviteError || !invite) {
        return new Response(JSON.stringify({ error: 'Invalid invite code' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Check expiry
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: 'Invite expired' }), {
          status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Check max uses
      if (invite.max_uses && invite.use_count >= invite.max_uses) {
        return new Response(JSON.stringify({ error: 'Invite limit reached' }), {
          status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Check if already a member
      const { data: existingMembership } = await supabase
        .from('room_memberships')
        .select('id')
        .eq('user_id', appUser.id)
        .eq('room_id', invite.room_id)
        .maybeSingle()

      if (existingMembership) {
        return new Response(JSON.stringify({ message: 'Already a member', room_id: invite.room_id, room_name: invite.rooms?.name }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Add membership
      const { error: memberError } = await supabase
        .from('room_memberships')
        .insert({
          user_id: appUser.id,
          room_id: invite.room_id,
          role: invite.role,
        })

      if (memberError) throw memberError

      // Increment use count
      await supabase
        .from('room_invites')
        .update({ use_count: invite.use_count + 1 })
        .eq('id', invite.id)

      return new Response(JSON.stringify({
        message: 'Joined room',
        room_id: invite.room_id,
        room_name: invite.rooms?.name,
        role: invite.role,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } else {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
