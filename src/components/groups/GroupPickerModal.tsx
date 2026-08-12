import { useState } from 'react'
import { useExpenseGroups } from '../../hooks/useExpenseGroups'
import { addGroupDraft } from '../../lib/expenses/groupDrafts'

interface GroupPickerModalProps {
  /** Shown in the title, e.g. «3 расхода». */
  subject: string
  onClose: () => void
  /** `null` means «убрать из группы». */
  onPick: (groupName: string | null) => void | Promise<void>
}

/**
 * Group chooser for a bulk action: pick an existing group, create one on the
 * spot, or clear the group of the selected expenses.
 */
export function GroupPickerModal({ subject, onClose, onPick }: GroupPickerModalProps) {
  const { groups } = useExpenseGroups()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = async (groupName: string | null) => {
    if (busy) return
    setBusy(true)
    try {
      await onPick(groupName)
    } finally {
      setBusy(false)
    }
  }

  const createAndPick = async () => {
    const name = newName.trim()
    if (!name || busy) return
    // Kept as a draft too, so the name survives if the patch below fails.
    addGroupDraft(name)
    await pick(name)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-bg-secondary w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] flex flex-col">
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-[17px] font-bold text-text">{subject} — в группу</h3>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createAndPick()
              }}
              placeholder="Новая группа..."
              className="flex-1 min-w-0 bg-surface rounded-xl px-4 py-2.5 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow"
            />
            <button
              type="button"
              onClick={() => void createAndPick()}
              disabled={!newName.trim() || busy}
              className="shrink-0 px-4 py-2.5 bg-primary text-on-primary rounded-xl text-[14px] font-semibold disabled:opacity-30 active:opacity-80 transition-opacity"
            >
              Создать
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5 min-h-0">
          {groups.map((group) => (
            <button
              key={group.name}
              type="button"
              disabled={busy}
              onClick={() => void pick(group.name)}
              className="w-full bg-surface rounded-xl px-4 py-3 text-left text-[15px] text-text active:opacity-70 transition-opacity disabled:opacity-40"
            >
              {group.name}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => void pick(null)}
            className="w-full bg-surface rounded-xl px-4 py-3 text-left text-[15px] text-text-hint active:opacity-70 transition-opacity disabled:opacity-40"
          >
            Без группы
          </button>
        </div>

        <div className="p-4 border-t border-separator/20">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 text-primary-text font-medium active:bg-primary/10 rounded-xl transition-colors"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
