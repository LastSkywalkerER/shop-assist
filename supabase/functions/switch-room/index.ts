import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { room_id } = await req.json()
    if (!room_id) {
      return new Response(JSON.stringify({ error: 'room_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get the app user by auth_user_id
    let { data: appUser } = await supabase
      .from('users')
      .select('id, telegram_id, username, first_name')
      .eq('auth_user_id', authUser.id)
      .maybeSingle()

    // Fallback: find by telegram_id from JWT metadata and auto-fix auth_user_id
    if (!appUser && authUser.user_metadata?.telegram_id) {
      const { data: userByTelegram } = await supabase
        .from('users')
        .select('id, telegram_id, username, first_name')
        .eq('telegram_id', authUser.user_metadata.telegram_id)
        .maybeSingle()

      if (userByTelegram) {
        // Fix the missing auth_user_id link
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

    // Verify membership
    const { data: membership } = await supabase
      .from('room_memberships')
      .select('role')
      .eq('user_id', appUser.id)
      .eq('room_id', room_id)
      .single()

    if (!membership) {
      return new Response(JSON.stringify({ error: 'Not a member of this room' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Update JWT metadata with new room_id
    await supabase.auth.admin.updateUserById(authUser.id, {
      user_metadata: {
        ...authUser.user_metadata,
        room_id: room_id,
      },
    })

    const email = `${appUser.telegram_id}@telegram.user`
    const tempPassword = `tg_${appUser.telegram_id}_${Date.now()}`

    await supabase.auth.admin.updateUserById(authUser.id, {
      password: tempPassword
    })

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email, password: tempPassword
    })

    if (signInError) throw signInError

    const { data: room } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', room_id)
      .single()

    return new Response(JSON.stringify({
      room,
      role: membership.role,
      access_token: signInData.session!.access_token,
      refresh_token: signInData.session!.refresh_token,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
