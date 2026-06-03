import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type {
  ExpenseDocument,
  StoreDocument,
  ExpenseCategoryDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  ExpenseAttachmentDocument,
  ExpenseParticipantDocument,
  ProductDocument,
  PurchaseDocument,
} from '../../db/types'
import { ConfirmModal } from '../shared/ConfirmModal'
import { EditExpense } from './EditExpense'
import { FileUpload, type AttachmentFile } from './FileUpload'
import { ReceiptItemsManager, type ReceiptItem } from './ReceiptItemsManager'
import { ExpenseSplitManager, type SplitParticipant } from './ExpenseSplitManager'
import { useAuth } from '../../contexts/AuthContext'
import { DEFAULT_CURRENCY } from '../../config/currencies'
import { showBackButton } from '../../telegram/backButton'
import { addPendingUpload, blobStoreRemove } from '../../db/blobStore'

export function ExpenseDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [localAttachments, setLocalAttachments] = useState<AttachmentFile[]>([])
  const [localReceiptItems, setLocalReceiptItems] = useState<ReceiptItem[]>([])
  const [localParticipants, setLocalParticipants] = useState<SplitParticipant[]>([])
  const { roomId } = useAuth()

  useEffect(() => {
    return showBackButton(() => navigate(-1))
  }, [navigate])

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const attachmentsCol = useRxCollection<ExpenseAttachmentDocument>('expenseAttachments')
  const participantsCol = useRxCollection<ExpenseParticipantDocument>('expenseParticipants')
  const productsCol = useRxCollection<ProductDocument>('products')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')

  const { data: expenses } = useRxQuery(expensesCol)
  const { data: stores } = useRxQuery(storesCol)
  const { data: categories } = useRxQuery(categoriesCol)
  const { data: receipts } = useRxQuery(receiptsCol)
  const { data: receiptItems } = useRxQuery(receiptItemsCol)
  const { data: attachments } = useRxQuery(attachmentsCol)
  const { data: allParticipants } = useRxQuery(participantsCol)
  const { data: products } = useRxQuery(productsCol)
  const { data: purchases } = useRxQuery(purchasesCol)

  // Extract product categories
  const productCategories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      if (p.category) set.add(p.category)
    }
    return Array.from(set).sort()
  }, [products])

  const expense = useMemo(() => expenses.find((e) => e.id === id), [expenses, id])
  const receipt = useMemo(() => receipts.find((r) => r.expenseId === id), [receipts, id])
  const expenseReceiptItems = useMemo(() => (receipt ? receiptItems.filter((i) => i.receiptId === receipt.id) : []), [receipt, receiptItems])
  const expenseAttachments = useMemo(() => (receipt ? attachments.filter((a) => a.receiptId === receipt.id) : []), [receipt, attachments])
  const expenseParticipants = useMemo(() => allParticipants.filter((p) => p.expenseId === id), [allParticipants, id])

  // Sync local state with DB data
  useEffect(() => {
    setLocalAttachments(
      expenseAttachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.size,
      }))
    )
  }, [expenseAttachments])

  useEffect(() => {
    const purchaseMap = new Map(purchases.map((p) => [p.id, p]))
    setLocalReceiptItems(
      expenseReceiptItems.map((i) => {
        // If linked to a purchase, sync fields from that purchase
        const linkedPurchase = i.convertedToPurchaseId ? purchaseMap.get(i.convertedToPurchaseId) : undefined
        return {
          id: i.id,
          name: i.name,
          amount: linkedPurchase ? linkedPurchase.price : i.amount,
          quantity: i.quantity ?? 1,
          currency: linkedPurchase ? linkedPurchase.currency : (i.currency || DEFAULT_CURRENCY),
          manufacturer: linkedPurchase ? linkedPurchase.manufacturer : i.manufacturer,
          packageVolume: linkedPurchase ? linkedPurchase.packageVolume : i.packageVolume,
          variety: linkedPurchase ? linkedPurchase.variety : i.variety,
          category: i.category,
          qualityRating: linkedPurchase ? linkedPurchase.qualityRating : i.qualityRating,
          notes: linkedPurchase ? linkedPurchase.notes : i.notes,
          addToProducts: !!i.convertedToPurchaseId,
          existingPurchaseId: i.convertedToPurchaseId,
        }
      })
    )
  }, [expenseReceiptItems, purchases])

  // Hydrate local participants from the DB on load. While there are unsaved
  // edits, stop hydrating so async DB data doesn't clobber in-progress input.
  // The dirty flag resets when navigating to a different expense.
  const [participantsDirty, setParticipantsDirty] = useState(false)
  const [savingParticipants, setSavingParticipants] = useState(false)
  const hydratedExpenseId = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (hydratedExpenseId.current !== id) {
      hydratedExpenseId.current = id
      setParticipantsDirty(false)
    }
    if (participantsDirty) return
    setLocalParticipants(
      expenseParticipants.map((p) => ({
        id: p.id,
        name: p.name,
        shareMode: p.shareMode,
        shareAmount: p.shareAmount,
        itemIds: p.itemIds,
        settledAmount: p.settledAmount,
      }))
    )
  }, [id, expenseParticipants, participantsDirty])

  // Names already used across this expense's category — seeded as equal-split
  // participants when the split section is opened on an empty expense.
  const categoryParticipantNames = useMemo(() => {
    if (!expense?.categoryId) return []
    const categoryExpenseIds = new Set(
      expenses.filter((e) => e.categoryId === expense.categoryId).map((e) => e.id),
    )
    const names = new Set<string>()
    for (const p of allParticipants) {
      if (categoryExpenseIds.has(p.expenseId)) names.add(p.name)
    }
    return Array.from(names)
  }, [expenses, allParticipants, expense?.categoryId])

  const handleCreateStore = async (data: { name: string; address?: string }): Promise<StoreDocument | undefined> => {
    if (!storesCol) return undefined
    const nameLower = data.name.toLowerCase()
    const existing = stores.find((s) => {
      if (s.name.toLowerCase() !== nameLower) return false
      if (data.address) return s.address?.toLowerCase() === data.address.toLowerCase()
      return !s.address
    })
    if (existing) return existing
    const now = new Date().toISOString()
    const store: StoreDocument = {
      id: crypto.randomUUID(),
      name: data.name,
      address: data.address,
      createdAt: now,
      updatedAt: now,
    }
    await storesCol.insert(store)
    return store
  }

  const handleCreateCategory = async (categoryName: string) => {
    if (!categoriesCol) return
    const now = new Date().toISOString()
    const newCategory: ExpenseCategoryDocument = {
      id: crypto.randomUUID(),
      name: categoryName,
      createdAt: now,
      updatedAt: now,
    }
    await categoriesCol.insert(newCategory)
  }

  const handleAttachmentsChange = async (newAttachments: AttachmentFile[]) => {
    if (!id || !receiptsCol || !attachmentsCol) return

    const now = new Date().toISOString()

    // Ensure receipt exists if we have attachments or items
    let currentReceipt = receipt
    if (!currentReceipt && (newAttachments.length > 0 || localReceiptItems.length > 0)) {
      const receiptId = crypto.randomUUID()
      const newReceipt = { id: receiptId, expenseId: id, createdAt: now, updatedAt: now }
      await receiptsCol.insert(newReceipt)
      currentReceipt = newReceipt as any
    }

    if (!currentReceipt) return

    // Find added and removed attachments
    const oldIds = new Set(localAttachments.map((a) => a.id))
    const newIds = new Set(newAttachments.map((a) => a.id))

    // Add new attachments (blob already in store from FileUpload)
    for (const attachment of newAttachments) {
      if (!oldIds.has(attachment.id)) {
        addPendingUpload(attachment.id)
        await attachmentsCol.insert({
          id: attachment.id,
          receiptId: currentReceipt.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    // Remove deleted attachments
    for (const attachment of localAttachments) {
      if (!newIds.has(attachment.id)) {
        const doc = await attachmentsCol.findOne(attachment.id).exec()
        if (doc) await doc.remove()
        blobStoreRemove(attachment.id).catch(() => {})
      }
    }

    // Delete receipt if empty (no attachments and no items)
    if (newAttachments.length === 0 && localReceiptItems.length === 0) {
      const receiptDoc = await receiptsCol.findOne(currentReceipt.id).exec()
      if (receiptDoc) await receiptDoc.remove()
    }

    setLocalAttachments(newAttachments)
  }

  const handleReceiptItemsChange = async (newItems: ReceiptItem[]) => {
    if (!id || !receiptsCol || !receiptItemsCol || !expense) return

    const now = new Date().toISOString()
    const store = stores.find((s) => s.id === expense.storeId)

    // Ensure receipt exists if we have items or attachments
    let currentReceipt = receipt
    if (!currentReceipt && (newItems.length > 0 || localAttachments.length > 0)) {
      const receiptId = crypto.randomUUID()
      const newReceipt = { id: receiptId, expenseId: id, createdAt: now, updatedAt: now }
      await receiptsCol.insert(newReceipt)
      currentReceipt = newReceipt as any
    }

    if (!currentReceipt) return

    // Find added, updated, and removed items
    const oldMap = new Map(localReceiptItems.map((i) => [i.id, i]))
    const newMap = new Map(newItems.map((i) => [i.id, i]))

    // Add new items or update existing
    for (const item of newItems) {
      const oldItem = oldMap.get(item.id)

      if (!oldItem) {
        // New item - insert
        let convertedToPurchaseId: string | undefined

        // Link to existing purchase or create new one
        if (item.addToProducts && productsCol && purchasesCol) {
          if (item.existingPurchaseId) {
            // Link to existing purchase and update it with form data
            convertedToPurchaseId = item.existingPurchaseId
            const purchaseDoc = await purchasesCol.findOne(item.existingPurchaseId).exec()
            if (purchaseDoc) {
              await purchaseDoc.patch({
                price: item.amount,
                currency: item.currency || DEFAULT_CURRENCY,
                manufacturer: item.manufacturer,
                packageVolume: item.packageVolume,
                variety: item.variety,
                qualityRating: item.qualityRating,
                notes: item.notes,
                updatedAt: now,
              })
            }
            if (!expense.storeId && expensesCol) {
              const existingPurchase = purchases.find((p) => p.id === item.existingPurchaseId)
              if (existingPurchase?.storeId) {
                const expenseDoc = await expensesCol.findOne(expense.id).exec()
                if (expenseDoc) await expenseDoc.patch({ storeId: existingPurchase.storeId, updatedAt: now })
              }
            }
          } else if (store || expense.storeId) {
            const effectiveStore = store ?? stores.find((s) => s.id === expense.storeId)
            if (effectiveStore) {
              // Find or create product
              let product = products.find((p) => p.name.toLowerCase() === item.name.toLowerCase())

              if (!product) {
                const productId = crypto.randomUUID()
                await productsCol.insert({
                  id: productId,
                  name: item.name,
                  category: item.category,
                  createdAt: now,
                  updatedAt: now,
                })
                product = { id: productId, name: item.name, createdAt: now, updatedAt: now } as ProductDocument
              }

              // Create purchase
              const purchaseId = crypto.randomUUID()
              await purchasesCol.insert({
                id: purchaseId,
                productId: product.id,
                storeId: effectiveStore.id,
                price: item.amount,
                currency: item.currency || DEFAULT_CURRENCY,
                manufacturer: item.manufacturer,
                packageVolume: item.packageVolume,
                variety: item.variety,
                qualityRating: item.qualityRating,
                purchaseDate: expense.date,
                notes: item.notes,
                createdAt: now,
                updatedAt: now,
              })

              convertedToPurchaseId = purchaseId
            }
          }
        }

        await receiptItemsCol.insert({
          id: item.id,
          receiptId: currentReceipt.id,
          name: item.name,
          amount: item.amount,
          quantity: item.quantity ?? 1,
          currency: item.currency || DEFAULT_CURRENCY,
          manufacturer: item.manufacturer,
          packageVolume: item.packageVolume,
          variety: item.variety,
          category: item.category,
          qualityRating: item.qualityRating,
          notes: item.notes,
          convertedToPurchaseId,
          createdAt: now,
          updatedAt: now,
        })
      } else {
        // Existing item - check if changed
        const hasChanges =
          oldItem.name !== item.name ||
          oldItem.amount !== item.amount ||
          (oldItem.quantity ?? 1) !== (item.quantity ?? 1) ||
          oldItem.manufacturer !== item.manufacturer ||
          oldItem.packageVolume !== item.packageVolume ||
          oldItem.variety !== item.variety ||
          oldItem.category !== item.category ||
          oldItem.qualityRating !== item.qualityRating ||
          oldItem.notes !== item.notes ||
          oldItem.addToProducts !== item.addToProducts ||
          oldItem.existingPurchaseId !== item.existingPurchaseId

        if (hasChanges) {
          const doc = await receiptItemsCol.findOne(item.id).exec()
          if (doc) {
            let convertedToPurchaseId = doc.convertedToPurchaseId

            // Update linked purchase if it exists, or create new one if needed
            if (item.addToProducts && purchasesCol) {
              if (item.existingPurchaseId) {
                convertedToPurchaseId = item.existingPurchaseId
                // Update the linked purchase with current form data
                const purchaseDoc = await purchasesCol.findOne(item.existingPurchaseId).exec()
                if (purchaseDoc) {
                  await purchaseDoc.patch({
                    price: item.amount,
                    currency: item.currency || DEFAULT_CURRENCY,
                    manufacturer: item.manufacturer,
                    packageVolume: item.packageVolume,
                    variety: item.variety,
                    qualityRating: item.qualityRating,
                    notes: item.notes,
                    updatedAt: now,
                  })
                }
              } else if (!oldItem.addToProducts && productsCol) {
                const effectiveStore = store ?? stores.find((s) => s.id === expense.storeId)
                if (effectiveStore) {
                  let product = products.find((p) => p.name.toLowerCase() === item.name.toLowerCase())

                  if (!product) {
                    const productId = crypto.randomUUID()
                    await productsCol.insert({
                      id: productId,
                      name: item.name,
                      category: item.category,
                      createdAt: now,
                      updatedAt: now,
                    })
                    product = { id: productId, name: item.name, createdAt: now, updatedAt: now } as ProductDocument
                  }

                  const purchaseId = crypto.randomUUID()
                  await purchasesCol.insert({
                    id: purchaseId,
                    productId: product.id,
                    storeId: effectiveStore.id,
                    price: item.amount,
                    currency: item.currency || DEFAULT_CURRENCY,
                    manufacturer: item.manufacturer,
                    packageVolume: item.packageVolume,
                    variety: item.variety,
                    qualityRating: item.qualityRating,
                    purchaseDate: expense.date,
                    notes: item.notes,
                    createdAt: now,
                    updatedAt: now,
                  })

                  convertedToPurchaseId = purchaseId
                }
              }
            }

            await doc.patch({
              name: item.name,
              amount: item.amount,
              quantity: item.quantity ?? 1,
              currency: item.currency || DEFAULT_CURRENCY,
              manufacturer: item.manufacturer,
              packageVolume: item.packageVolume,
              variety: item.variety,
              category: item.category,
              qualityRating: item.qualityRating,
              notes: item.notes,
              convertedToPurchaseId,
              updatedAt: now,
            })
          }
        }
      }
    }

    // Remove deleted items
    for (const item of localReceiptItems) {
      if (!newMap.has(item.id)) {
        const doc = await receiptItemsCol.findOne(item.id).exec()
        if (doc) await doc.remove()
      }
    }

    // Delete receipt if empty (no items and no attachments)
    if (newItems.length === 0 && localAttachments.length === 0) {
      const receiptDoc = await receiptsCol.findOne(currentReceipt.id).exec()
      if (receiptDoc) await receiptDoc.remove()
    }

    setLocalReceiptItems(newItems)
  }

  const handleParticipantsChange = (newItems: SplitParticipant[]) => {
    // Hold edits in local state only — they are written to the DB when the
    // user presses "Сохранить участников", not while typing.
    setParticipantsDirty(true)
    setLocalParticipants(newItems)
  }

  const handleSaveParticipants = async () => {
    setSavingParticipants(true)
    try {
      await persistParticipants(localParticipants)
      setParticipantsDirty(false)
    } catch (err) {
      console.error('Failed to save participants:', err)
    } finally {
      setSavingParticipants(false)
    }
  }

  const persistParticipants = async (items: SplitParticipant[]) => {
    if (!id || !participantsCol) return
    const now = new Date().toISOString()
    const keepIds = new Set<string>()

    for (const part of items) {
      const trimmed = part.name.trim()
      if (!trimmed) continue
      keepIds.add(part.id)
      const fields = {
        name: trimmed,
        shareMode: part.shareMode,
        shareAmount: part.shareMode === 'amount' ? part.shareAmount : undefined,
        itemIds: part.shareMode === 'items' ? (part.itemIds ?? []) : undefined,
        settledAmount: part.settledAmount ?? 0,
      }
      const doc = await participantsCol.findOne(part.id).exec()
      if (doc) {
        const changed =
          doc.name !== trimmed ||
          doc.shareMode !== part.shareMode ||
          doc.shareAmount !== fields.shareAmount ||
          JSON.stringify(doc.itemIds ?? []) !== JSON.stringify(fields.itemIds ?? []) ||
          (doc.settledAmount ?? 0) !== fields.settledAmount
        if (changed) await doc.patch({ ...fields, updatedAt: now })
      } else {
        await participantsCol.insert({ id: part.id, expenseId: id, ...fields, createdAt: now, updatedAt: now })
      }
    }

    // Remove DB rows for this expense that are no longer present or were blanked.
    const existing = await participantsCol.find({ selector: { expenseId: id } }).exec()
    for (const doc of existing) {
      if (!keepIds.has(doc.id)) await doc.remove()
    }
  }

  const handleDelete = async () => {
    if (!expensesCol || !expense) return
    setDeleting(true)
    try {
      // Delete split participants
      if (participantsCol) {
        for (const part of expenseParticipants) {
          const doc = await participantsCol.findOne(part.id).exec()
          if (doc) await doc.remove()
        }
      }

      // Delete receipt items
      if (receipt && receiptItemsCol) {
        for (const item of expenseReceiptItems) {
          const doc = await receiptItemsCol.findOne(item.id).exec()
          if (doc) await doc.remove()
        }
      }

      // Delete attachments
      if (receipt && attachmentsCol) {
        for (const att of expenseAttachments) {
          const doc = await attachmentsCol.findOne(att.id).exec()
          if (doc) await doc.remove()
          blobStoreRemove(att.id).catch(() => {})
        }
      }

      // Delete receipt
      if (receipt && receiptsCol) {
        const receiptDoc = await receiptsCol.findOne(receipt.id).exec()
        if (receiptDoc) await receiptDoc.remove()
      }

      // Delete expense
      const expenseDoc = await expensesCol.findOne(expense.id).exec()
      if (expenseDoc) await expenseDoc.remove()

      navigate(-1)
    } catch (err) {
      console.error('Failed to delete expense:', err)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!expense) {
    return <div className="p-4 text-text-hint text-[15px]">Расход не найден</div>
  }

  return (
    <div className="pb-10 flex-1 overflow-y-auto min-h-0">
      {/* Header */}
      <div className="p-4 pb-2 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-text">Редактирование</h2>
      </div>

      {/* Edit form */}
      {expensesCol && (
        <div className="px-4">
          <EditExpense
            expense={expense}
            collection={expensesCol}
            stores={stores}
            categories={categories}
            expenses={expenses}
            onDone={() => navigate(-1)}
            onCreateStore={handleCreateStore}
            onCreateCategory={handleCreateCategory}
          />
        </div>
      )}

      {/* Receipt attachments */}
      <div className="px-4 mt-4">
        <FileUpload attachments={localAttachments} onChange={handleAttachmentsChange} />
      </div>

      {/* Receipt items */}
      <div className="px-4 mt-4">
        <ReceiptItemsManager
          items={localReceiptItems}
          onChange={handleReceiptItemsChange}
          productCategories={productCategories}
          products={products}
          purchases={purchases}
          stores={stores}
          expenseStoreId={expense?.storeId}
        />
      </div>

      {/* Split between participants */}
      <div className="px-4 mt-4">
        <ExpenseSplitManager
          participants={localParticipants}
          onChange={handleParticipantsChange}
          expenseAmount={expense.amount}
          currency={expense.currency}
          receiptItems={localReceiptItems}
          payerName={expense.creatorName ?? ''}
          categoryParticipantNames={categoryParticipantNames}
          roomId={roomId}
        />
        {participantsDirty && (
          <button
            onClick={handleSaveParticipants}
            disabled={savingParticipants}
            className="w-full mt-3 bg-primary text-on-primary py-3 rounded-2xl font-semibold text-[15px] disabled:opacity-30 active:opacity-80 transition-opacity"
          >
            {savingParticipants ? 'Сохранение...' : 'Сохранить участников'}
          </button>
        )}
      </div>

      {/* Delete button */}
      <div className="mx-4 mt-4">
        <button
          onClick={() => setConfirmDelete(true)}
          className="w-full py-3 text-destructive text-[15px] font-medium bg-surface rounded-2xl active:bg-bg-secondary/50 transition-colors"
        >
          Удалить расход
        </button>
      </div>

      {/* Confirm delete modal */}
      {confirmDelete && (
        <ConfirmModal
          title="Удалить расход?"
          message={`Расход будет удалён без возможности восстановления${receipt ? ', включая все вложения и позиции чека' : ''}.`}
          confirmLabel="Удалить"
          cancelLabel="Отмена"
          destructive
          confirmDisabled={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
