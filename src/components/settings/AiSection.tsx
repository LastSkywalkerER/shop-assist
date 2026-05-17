import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAiSettings } from '../../contexts/AiSettingsContext'
import { useToast } from '../../contexts/ToastContext'
import { MODELS, modelsForRole, formatCost, type ModelRole } from '../../lib/ai/models'

interface ModelRowProps {
  label: string
  role: ModelRole
  value: string
  disabled: boolean
  onChange: (id: string) => void
}

function ModelRow({ label, role, value, disabled, onChange }: ModelRowProps) {
  const options = modelsForRole(role)
  const current = MODELS.find((m) => m.id === value)
  return (
    <div className="px-4 py-3">
      <label className="block text-[13px] text-section-header font-medium mb-1.5">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="w-full bg-bg-secondary rounded-xl px-3 py-2.5 text-[15px] text-text disabled:opacity-40"
      >
        {options.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
      {current && (
        <div className="text-[12px] text-text-hint mt-1.5 leading-snug">
          <span className="font-medium text-text/70">{current.qualityTier}</span>
          <span className="mx-1.5">·</span>
          <span>{formatCost(current.costPerReceipt)}</span>
          <span className="mx-1.5">·</span>
          <span>{current.notes}</span>
        </div>
      )}
    </div>
  )
}

export function AiSection() {
  const { isAuthenticated, roomId } = useAuth()
  const { settings, loading, update } = useAiSettings()
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)

  const aiEnabled = !!settings?.aiEnabled
  const canConfigure = isAuthenticated && !!roomId

  const persist = async (patch: Parameters<typeof update>[0]) => {
    setSaving(true)
    try {
      await update(patch)
    } catch (err) {
      console.error('AI settings update failed:', err)
      showToast('Не удалось сохранить настройки AI', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="px-4 pt-5 pb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-section-header">
          AI-функции
        </span>
      </div>

      <div className="mx-4 glass rounded-2xl overflow-hidden border border-separator/15 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[15px] text-text font-medium">Включить AI-фичи</div>
            <div className="text-[12px] text-text-hint mt-0.5 leading-snug">
              Сканирование чеков камерой через OpenRouter. Распознавание выполняется на сервере по защищённому ключу.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aiEnabled}
            disabled={!canConfigure || loading || saving}
            onClick={() => persist({ aiEnabled: !aiEnabled })}
            className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 ${
              aiEnabled ? 'bg-primary' : 'bg-separator/50'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                aiEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {!canConfigure && (
          <>
            <div className="h-px bg-separator/20" />
            <div className="px-4 py-3">
              <p className="text-[13px] text-text-hint">
                Войдите в аккаунт, чтобы включить AI-функции.
              </p>
            </div>
          </>
        )}

        {canConfigure && settings && (
          <>
            <div className="h-px bg-separator/20" />
            <ModelRow
              label="Распознавание (Pass 1)"
              role="extract"
              value={settings.modelExtract}
              disabled={!aiEnabled || saving}
              onChange={(id) => persist({ modelExtract: id })}
            />
            <div className="h-px bg-separator/20" />
            <ModelRow
              label="Проверка (Pass 2)"
              role="validate"
              value={settings.modelValidate}
              disabled={!aiEnabled || saving}
              onChange={(id) => persist({ modelValidate: id })}
            />
            <div className="h-px bg-separator/20" />
            <ModelRow
              label="Эскалация (Pass 3)"
              role="escalate"
              value={settings.modelEscalate}
              disabled={!aiEnabled || saving}
              onChange={(id) => persist({ modelEscalate: id })}
            />
          </>
        )}
      </div>
    </section>
  )
}
