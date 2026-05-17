import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'
import webpush from 'https://esm.sh/web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface QueueTask {
  id: string
  room_id: string
  type: string
  items: string[]
  last_updated_at: string
  created_at: string
  immediate_sent: boolean
}

interface PushSubRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

interface MemberRow {
  user_id: string
  users: {
    telegram_id: number | null
    notify_via_pwa: boolean | null
    notify_via_telegram: boolean | null
  } | null
}

type PushPayload = {
  title: string
  body?: string
  url?: string
  tag?: string
}

// Narrow shape of the Supabase client we use here (avoids importing full types in Deno edge).
// deno-lint-ignore no-explicit-any
type SupabaseLike = any

async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function sendWebPush(
  supabase: SupabaseLike,
  sub: PushSubRow,
  payload: PushPayload,
  stats: { ok: number; gone: number; failed: number; lastError?: string },
): Promise<void> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      {
        // Tell the push service to deliver right away even if the device is in
        // Doze / power-saving. Without this, Android FCM may hold the push until
        // the user wakes the device or opens Chrome — which is exactly the
        // "push arrives only when I open the app" symptom.
        urgency: 'high',
        TTL: 60 * 60 * 24, // 24h — if device is offline longer, drop it.
      },
    )
    stats.ok++
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode
    const message = err instanceof Error ? err.message : String(err)
    if (statusCode === 404 || statusCode === 410) {
      stats.gone++
      // Subscription is gone — clean up.
      await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      return
    }
    stats.failed++
    stats.lastError = `status=${statusCode ?? 'n/a'} ${message}`
    console.error('Web Push send failed:', statusCode, message)
  }
}

async function sendToRoomMembers(
  supabase: SupabaseLike,
  botToken: string,
  roomId: string,
  telegramText: string,
  pushPayload: PushPayload,
  stats: { ok: number; gone: number; failed: number; lastError?: string },
): Promise<void> {
  const { data: memberships, error: mErr } = await supabase
    .from('room_memberships')
    .select('user_id, users(telegram_id, notify_via_pwa, notify_via_telegram)')
    .eq('room_id', roomId)

  if (mErr || !memberships) {
    if (mErr) console.error('Failed to load memberships:', mErr)
    return
  }

  const userIds: string[] = (memberships as MemberRow[])
    .map((m) => m.user_id)
    .filter((id): id is string => !!id)

  // Load all push subscriptions for these users in one query.
  let subsByUser = new Map<string, PushSubRow[]>()
  if (userIds.length > 0) {
    const { data: subs, error: sErr } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', userIds)
    if (sErr) {
      console.error('Failed to load push subscriptions:', sErr)
    } else if (subs) {
      subsByUser = (subs as Array<PushSubRow & { user_id: string }>).reduce((acc, s) => {
        const arr = acc.get(s.user_id) ?? []
        arr.push({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })
        acc.set(s.user_id, arr)
        return acc
      }, new Map<string, PushSubRow[]>())
    }
  }

  const sends: Promise<void>[] = []
  for (const m of memberships as MemberRow[]) {
    const u = m.users
    if (!u) continue
    const userSubs = subsByUser.get(m.user_id) ?? []
    const pwaEnabled = u.notify_via_pwa !== false
    const tgEnabled = u.notify_via_telegram !== false

    // PWA priority: deliver via push if user has it enabled AND at least one subscription.
    if (pwaEnabled && userSubs.length > 0) {
      for (const s of userSubs) sends.push(sendWebPush(supabase, s, pushPayload, stats))
      continue
    }
    // Fallback: Telegram.
    if (tgEnabled && u.telegram_id) {
      sends.push(sendTelegramMessage(botToken, u.telegram_id, telegramText))
    }
  }
  await Promise.allSettled(sends)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const botToken = Deno.env.get('BOT_TOKEN')
    if (!botToken) {
      return new Response(JSON.stringify({ error: 'BOT_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
    const vapidSubject = Deno.env.get('VAPID_SUBJECT')
    if (vapidPublic && vapidPrivate && vapidSubject) {
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
    } else {
      console.warn('VAPID env vars not fully configured; Web Push will fail until set.')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json().catch(() => ({}))
    const action: string = body.action ?? 'process_queue'

    if (action === 'diag') {
      const { count: subCount } = await supabase
        .from('push_subscriptions')
        .select('*', { count: 'exact', head: true })
      return new Response(
        JSON.stringify({
          ok: true,
          vapid: {
            publicSet: !!vapidPublic,
            privateSet: !!vapidPrivate,
            subjectSet: !!vapidSubject,
          },
          push_subscriptions_count: subCount ?? 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (action === 'test_push') {
      // Fan out a test push to all of caller's subscriptions (or by user_id in body).
      const userId: string | undefined = body.user_id
      let query = supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth, user_id')
      if (userId) query = query.eq('user_id', userId)
      const { data: subs, error } = await query
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const stats = { ok: 0, gone: 0, failed: 0, lastError: undefined as string | undefined }
      const sends: Promise<void>[] = []
      for (const s of subs ?? []) {
        sends.push(
          sendWebPush(
            supabase,
            { id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
            {
              title: 'Тестовое уведомление',
              body: 'Если ты это видишь — Web Push работает.',
              url: '/',
              tag: 'test',
            },
            stats,
          ),
        )
      }
      await Promise.allSettled(sends)
      return new Response(
        JSON.stringify({ ok: true, total: subs?.length ?? 0, ...stats }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (action === 'process_queue') {
      const { data: tasks, error } = await supabase.from('notification_queue').select('*')

      if (error) {
        console.error('Failed to fetch notification queue:', error)
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000)
      const processed: string[] = []
      const immediated: string[] = []
      const stats = { ok: 0, gone: 0, failed: 0, lastError: undefined as string | undefined }

      for (const task of (tasks as QueueTask[]) ?? []) {
        if (!task.immediate_sent) {
          await sendToRoomMembers(
            supabase,
            botToken,
            task.room_id,
            '🛒 <b>Список покупок обновлён</b>',
            {
              title: '🛒 Список покупок обновлён',
              url: '/shopping-list',
              tag: `shopping_list_update_${task.room_id}`,
            },
            stats,
          )
          await supabase
            .from('notification_queue')
            .update({ immediate_sent: true })
            .eq('id', task.id)
          immediated.push(task.id)
        } else if (new Date(task.last_updated_at) < thirtyMinAgo) {
          const itemNames = (task.items as string[]).filter(Boolean)
          if (itemNames.length > 0) {
            const list = itemNames.map((name) => `• ${name}`).join('\n')
            await sendToRoomMembers(
              supabase,
              botToken,
              task.room_id,
              `🛒 <b>В список добавлено:</b>\n${list}`,
              {
                title: '🛒 В список добавлено',
                body: itemNames.join(', '),
                url: '/shopping-list',
                tag: `shopping_list_update_${task.room_id}`,
              },
              stats,
            )
          }
          await supabase.from('notification_queue').delete().eq('id', task.id)
          processed.push(task.id)
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          immediated: immediated.length,
          processed: processed.length,
          push: stats,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-notification error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
