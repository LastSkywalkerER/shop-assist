import { supabase } from './client'
import { DEFAULT_MODELS } from '../ai/models'

export interface RoomAiSettings {
  roomId: string
  aiEnabled: boolean
  modelExtract: string
  modelValidate: string
  modelEscalate: string
}

function withDefaults(roomId: string, row: Partial<RoomAiSettings> | null): RoomAiSettings {
  return {
    roomId,
    aiEnabled: row?.aiEnabled ?? false,
    modelExtract: row?.modelExtract || DEFAULT_MODELS.extract,
    modelValidate: row?.modelValidate || DEFAULT_MODELS.validate,
    modelEscalate: row?.modelEscalate || DEFAULT_MODELS.escalate,
  }
}

/**
 * Fetch AI settings for the current room. Returns defaults (ai disabled) when
 * the row doesn't exist yet, when the user isn't signed in, or when the table
 * isn't reachable (e.g. offline).
 */
export async function fetchAiSettings(roomId: string): Promise<RoomAiSettings> {
  const { data, error } = await supabase
    .from('room_ai_settings')
    .select('ai_enabled, model_extract, model_validate, model_escalate')
    .eq('room_id', roomId)
    .maybeSingle()

  if (error) {
    console.warn('fetchAiSettings failed:', error.message)
    return withDefaults(roomId, null)
  }
  if (!data) return withDefaults(roomId, null)

  return withDefaults(roomId, {
    aiEnabled: data.ai_enabled,
    modelExtract: data.model_extract,
    modelValidate: data.model_validate,
    modelEscalate: data.model_escalate,
  })
}

export async function updateAiSettings(patch: RoomAiSettings): Promise<void> {
  const { error } = await supabase
    .from('room_ai_settings')
    .upsert({
      room_id: patch.roomId,
      ai_enabled: patch.aiEnabled,
      model_extract: patch.modelExtract,
      model_validate: patch.modelValidate,
      model_escalate: patch.modelEscalate,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'room_id' })
  if (error) throw error
}
