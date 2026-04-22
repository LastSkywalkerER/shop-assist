import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// NBRB sets most pairs daily; IDR (and some others) are monthly (periodicity=1) only.
const DAILY_CURRENCIES = ['USD', 'EUR', 'RUB', 'PLN', 'UAH'] as const
const MONTHLY_CURRENCIES = ['IDR'] as const

interface NbrbRate {
  Cur_ID: number
  Date: string
  Cur_Abbreviation: string
  Cur_Scale: number
  Cur_Name: string
  Cur_OfficialRate: number
}

async function fetchNbrbRates(
  ondate: string,
  periodicity: 0 | 1,
): Promise<NbrbRate[]> {
  const url = `https://api.nbrb.by/exrates/rates?ondate=${ondate}&periodicity=${periodicity}&parammode=2`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeout)

      if (res.status >= 500 && attempt === 0) {
        await new Promise(r => setTimeout(r, 1_000))
        continue
      }
      if (!res.ok) {
        throw new Error(`NBRB API ${res.status}: ${await res.text().catch(() => '')}`)
      }
      return await res.json() as NbrbRate[]
    } catch (err) {
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 1_000))
        continue
      }
      throw err
    }
  }
  return []
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json().catch(() => ({}))
    // Allow manual backfill via { ondate: "YYYY-MM-DD" }; default is today (UTC).
    const ondate: string = typeof body?.ondate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.ondate)
      ? body.ondate
      : new Date().toISOString().slice(0, 10)

    const [dailyRates, monthlyRates] = await Promise.all([
      fetchNbrbRates(ondate, 0),
      fetchNbrbRates(ondate, 1),
    ])

    const nowIso = new Date().toISOString()

    function buildRow(
      code: string,
      entry: NbrbRate,
    ) {
      const scale = entry.Cur_Scale || 1
      const rate = entry.Cur_OfficialRate / scale
      const rateDate = entry.Date?.slice(0, 10) ?? ondate
      return {
        id: crypto.randomUUID(),
        currency: code,
        date: rateDate,
        rate,
        scale,
        source: 'nbrb',
        created_at: nowIso,
        updated_at: nowIso,
        _deleted: false,
      }
    }

    const rows: ReturnType<typeof buildRow>[] = []

    for (const code of DAILY_CURRENCIES) {
      const entry = dailyRates.find(r => r.Cur_Abbreviation === code)
      if (entry) rows.push(buildRow(code, entry))
    }
    for (const code of MONTHLY_CURRENCIES) {
      const entry = monthlyRates.find(r => r.Cur_Abbreviation === code)
      if (entry) rows.push(buildRow(code, entry))
    }

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          ondate,
          skipped: true,
          reason: 'tracked currencies missing from NBRB response',
          expected: [...DAILY_CURRENCIES, ...MONTHLY_CURRENCIES],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Upsert on (currency, date); on conflict we still want updated_at to bump so
    // clients pull the latest record. Let the DB refresh updated_at by passing it explicitly.
    const { error } = await supabase
      .from('currency_rates_sync')
      .upsert(rows, { onConflict: 'currency,date', ignoreDuplicates: false })

    if (error) {
      console.error('Upsert failed:', error)
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        ok: true,
        ondate,
        upserted: rows.length,
        currencies: rows.map(r => r.currency),
        dates: rows.map(r => ({ currency: r.currency, date: r.date })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('fetch-nbrb-rates error:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
