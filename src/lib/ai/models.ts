export type ModelRole = 'extract' | 'validate' | 'escalate'

export interface ModelInfo {
  id: string
  label: string
  roles: ModelRole[]
  /** Approximate $ per receipt for ballpark UI display. */
  costPerReceipt: number
  qualityTier: 'A+' | 'A' | 'B'
  notes: string
}

export const MODELS: ModelInfo[] = [
  {
    id: 'google/gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    roles: ['extract', 'validate'],
    costPerReceipt: 0.00046,
    qualityTier: 'A+',
    notes: 'топ русский OCR · нативный JSON schema',
  },
  {
    id: 'google/gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    roles: ['extract'],
    costPerReceipt: 0.00016,
    qualityTier: 'B',
    notes: 'самый дешёвый · для чистых принтов',
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    roles: ['escalate'],
    costPerReceipt: 0.012,
    qualityTier: 'A+',
    notes: 'лидер MWS Vision Bench KIE',
  },
  {
    id: 'qwen/qwen3-vl-30b-a3b-instruct',
    label: 'Qwen3-VL 30B',
    roles: ['extract', 'escalate'],
    costPerReceipt: 0.00036,
    qualityTier: 'A',
    notes: 'лучший open-weights для русского',
  },
  {
    id: 'qwen/qwen3-vl-235b-a22b',
    label: 'Qwen3-VL 235B',
    roles: ['escalate'],
    costPerReceipt: 0.0015,
    qualityTier: 'A',
    notes: 'A+ OCR · strict JSON зависит от провайдера',
  },
  {
    id: 'openai/gpt-5-mini',
    label: 'GPT-5 mini',
    roles: ['validate'],
    costPerReceipt: 0.0001,
    qualityTier: 'A+',
    notes: 'нативный strict JSON · лучший валидатор',
  },
  {
    id: 'openai/gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    roles: ['extract', 'escalate'],
    costPerReceipt: 0.0009,
    qualityTier: 'A',
    notes: 'топ-3 для русских чеков (MTS AI)',
  },
]

export const DEFAULT_MODELS: Record<ModelRole, string> = {
  extract: 'google/gemini-2.5-flash',
  validate: 'openai/gpt-5-mini',
  escalate: 'google/gemini-2.5-pro',
}

export function modelsForRole(role: ModelRole): ModelInfo[] {
  return MODELS.filter((m) => m.roles.includes(role))
}

export function findModel(id: string | null | undefined): ModelInfo | undefined {
  if (!id) return undefined
  return MODELS.find((m) => m.id === id)
}

export function formatCost(usd: number): string {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(2)}/1000 чеков`
  return `$${usd.toFixed(4)}/чек`
}
