import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'

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

async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function sendToRoomMembers(
  supabase: any,
  botToken: string,
  roomId: string,
  text: string,
): Promise<void> {
  const { data: memberships } = await supabase
    .from('room_memberships')
    .select('user_id, users(telegram_id)')
    .eq('room_id', roomId)

  if (!memberships) return

  const sends: Promise<void>[] = []
  for (const m of memberships) {
    const telegramId: number | undefined = m.users?.telegram_id
    if (!telegramId) continue
    sends.push(sendTelegramMessage(botToken, telegramId, text))
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json().catch(() => ({}))
    const action: string = body.action ?? 'process_queue'

    if (action === 'process_queue') {
      // Fetch all pending notification tasks
      const { data: tasks, error } = await supabase
        .from('notification_queue')
        .select('*')

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

      for (const task of (tasks as QueueTask[]) ?? []) {
        if (!task.immediate_sent) {
          // Send immediate "list updated" notification
          await sendToRoomMembers(
            supabase,
            botToken,
            task.room_id,
            '🛒 <b>Список покупок обновлён</b>',
          )
          await supabase
            .from('notification_queue')
            .update({ immediate_sent: true })
            .eq('id', task.id)
          immediated.push(task.id)
        } else if (new Date(task.last_updated_at) < thirtyMinAgo) {
          // Send summary notification with accumulated items
          const itemNames = (task.items as string[]).filter(Boolean)
          if (itemNames.length > 0) {
            const list = itemNames.map((name) => `• ${name}`).join('\n')
            await sendToRoomMembers(
              supabase,
              botToken,
              task.room_id,
              `🛒 <b>В список добавлено:</b>\n${list}`,
            )
          }
          await supabase
            .from('notification_queue')
            .delete()
            .eq('id', task.id)
          processed.push(task.id)
        }
      }

      return new Response(
        JSON.stringify({ ok: true, immediated: immediated.length, processed: processed.length }),
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
