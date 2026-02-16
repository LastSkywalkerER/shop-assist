import { useRef, useState } from 'react'

export interface AttachmentFile {
  id: string
  fileName: string
  mimeType: string
  dataUrl: string
  size: number
}

interface FileUploadProps {
  attachments: AttachmentFile[]
  onChange: (attachments: AttachmentFile[]) => void
  maxSizeMB?: number
}

export function FileUpload({ attachments, onChange, maxSizeMB = 10 }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>('')

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setError('')
    const maxSize = maxSizeMB * 1024 * 1024 // Convert MB to bytes

    try {
      const newAttachments: AttachmentFile[] = []

      for (const file of Array.from(files)) {
        // Validate size
        if (file.size > maxSize) {
          setError(`Файл "${file.name}" превышает лимит ${maxSizeMB}MB`)
          continue
        }

        // Convert to base64
        const dataUrl = await fileToBase64(file)

        newAttachments.push({
          id: crypto.randomUUID(),
          fileName: file.name,
          mimeType: file.type,
          dataUrl,
          size: file.size,
        })
      }

      onChange([...attachments, ...newAttachments])
    } catch (err) {
      console.error('Failed to process files:', err)
      setError('Ошибка загрузки файлов')
    }

    // Reset input
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  const handleRemove = (id: string) => {
    onChange(attachments.filter((a) => a.id !== id))
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-3">
      {/* Upload button */}
      <div>
        <label className="text-[13px] text-section-header font-medium pl-1 block mb-2">
          Фото чека
        </label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full py-3 bg-surface text-text text-[15px] font-medium rounded-2xl active:bg-bg-secondary/50 transition-colors flex items-center justify-center gap-2"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Загрузить фото
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-[13px] text-destructive">
          {error}
        </div>
      )}

      {/* Attachments list */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="bg-surface rounded-2xl p-3 flex items-start gap-3"
            >
              {/* Thumbnail */}
              <div className="w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-bg-secondary">
                <img
                  src={attachment.dataUrl}
                  alt={attachment.fileName}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-text truncate">
                  {attachment.fileName}
                </div>
                <div className="text-[12px] text-text-hint mt-0.5">
                  {formatSize(attachment.size)}
                </div>
              </div>

              {/* Remove button */}
              <button
                type="button"
                onClick={() => handleRemove(attachment.id)}
                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full active:bg-destructive/10 transition-colors"
                title="Удалить"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Helper function to convert File to base64 data URL
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
