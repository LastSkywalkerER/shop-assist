import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type {
  ExpenseDocument,
  StoreDocument,
  ExpenseCategoryDocument,
  ReceiptDocument,
  ReceiptItemDocument,
  ExpenseAttachmentDocument,
  ProductDocument,
  PurchaseDocument,
} from '../../db/types'
import { ConfirmModal } from '../shared/ConfirmModal'
import { EditExpense } from './EditExpense'
import { FileUpload, type AttachmentFile } from './FileUpload'
import { ReceiptItemsManager, type ReceiptItem } from './ReceiptItemsManager'
import { showBackButton } from '../../telegram/backButton'

export function ExpenseDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [localAttachments, setLocalAttachments] = useState<AttachmentFile[]>([])
  const [localReceiptItems, setLocalReceiptItems] = useState<ReceiptItem[]>([])

  useEffect(() => {
    return showBackButton(() => navigate('/expenses'))
  }, [navigate])

  const expensesCol = useRxCollection<ExpenseDocument>('expenses')
  const storesCol = useRxCollection<StoreDocument>('stores')
  const categoriesCol = useRxCollection<ExpenseCategoryDocument>('expenseCategories')
  const receiptsCol = useRxCollection<ReceiptDocument>('receipts')
  const receiptItemsCol = useRxCollection<ReceiptItemDocument>('receiptItems')
  const attachmentsCol = useRxCollection<ExpenseAttachmentDocument>('expenseAttachments')
  const productsCol = useRxCollection<ProductDocument>('products')
  const purchasesCol = useRxCollection<PurchaseDocument>('purchases')

  const expenses = useRxQuery(expensesCol)
  const stores = useRxQuery(storesCol)
  const categories = useRxQuery(categoriesCol)
  const receipts = useRxQuery(receiptsCol)
  const receiptItems = useRxQuery(receiptItemsCol)
  const attachments = useRxQuery(attachmentsCol)
  const products = useRxQuery(productsCol)

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

  // Sync local state with DB data
  useEffect(() => {
    setLocalAttachments(
      expenseAttachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        dataUrl: a.dataUrl,
        size: a.size,
      }))
    )
  }, [expenseAttachments])

  useEffect(() => {
    setLocalReceiptItems(
      expenseReceiptItems.map((i) => ({
        id: i.id,
        name: i.name,
        amount: i.amount,
        manufacturer: i.manufacturer,
        packageVolume: i.packageVolume,
        category: i.category,
        qualityRating: i.qualityRating,
        notes: i.notes,
        addToProducts: !!i.convertedToPurchaseId,
      }))
    )
  }, [expenseReceiptItems])

  const handleCreateStore = async (data: { name: string; type?: 'market' | 'store'; address?: string }) => {
    if (!storesCol) return
    const nameLower = data.name.toLowerCase()
    const existing = stores.find((s) => {
      if (s.name.toLowerCase() !== nameLower) return false
      if (data.address) return s.address?.toLowerCase() === data.address.toLowerCase()
      return !s.address
    })
    if (existing) return
    const now = new Date().toISOString()
    const store: StoreDocument = {
      id: crypto.randomUUID(),
      name: data.name,
      type: data.type,
      address: data.address,
      createdAt: now,
      updatedAt: now,
    }
    await storesCol.insert(store)
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
      await receiptsCol.insert({
        id: receiptId,
        expenseId: id,
        createdAt: now,
        updatedAt: now,
      })
      // Re-query to get the new receipt (will happen via reactive query)
      return
    }

    if (!currentReceipt) return

    // Find added and removed attachments
    const oldIds = new Set(localAttachments.map((a) => a.id))
    const newIds = new Set(newAttachments.map((a) => a.id))

    // Add new attachments
    for (const attachment of newAttachments) {
      if (!oldIds.has(attachment.id)) {
        await attachmentsCol.insert({
          id: attachment.id,
          receiptId: currentReceipt.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
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
      await receiptsCol.insert({
        id: receiptId,
        expenseId: id,
        createdAt: now,
        updatedAt: now,
      })
      // Re-query to get the new receipt (will happen via reactive query)
      return
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

        // Create product and purchase if requested
        if (item.addToProducts && productsCol && purchasesCol && store) {
          // Find or create product
          let product = products.find((p) => {
            if (p.name.toLowerCase() !== item.name.toLowerCase()) return false
            if (item.manufacturer && p.manufacturer?.toLowerCase() !== item.manufacturer.toLowerCase()) return false
            if (item.packageVolume && p.packageVolume !== item.packageVolume) return false
            return true
          })

          if (!product) {
            const productId = crypto.randomUUID()
            await productsCol.insert({
              id: productId,
              name: item.name,
              manufacturer: item.manufacturer,
              packageVolume: item.packageVolume,
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
            storeId: store.id,
            priceByn: item.amount,
            qualityRating: item.qualityRating,
            purchaseDate: expense.date,
            notes: item.notes,
            createdAt: now,
            updatedAt: now,
          })

          convertedToPurchaseId = purchaseId
        }

        await receiptItemsCol.insert({
          id: item.id,
          receiptId: currentReceipt.id,
          name: item.name,
          amount: item.amount,
          manufacturer: item.manufacturer,
          packageVolume: item.packageVolume,
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
          oldItem.manufacturer !== item.manufacturer ||
          oldItem.packageVolume !== item.packageVolume ||
          oldItem.category !== item.category ||
          oldItem.qualityRating !== item.qualityRating ||
          oldItem.notes !== item.notes ||
          oldItem.addToProducts !== item.addToProducts

        if (hasChanges) {
          const doc = await receiptItemsCol.findOne(item.id).exec()
          if (doc) {
            let convertedToPurchaseId = doc.convertedToPurchaseId

            // Create product and purchase if newly requested
            if (item.addToProducts && !oldItem.addToProducts && productsCol && purchasesCol && store) {
              // Find or create product
              let product = products.find((p) => {
                if (p.name.toLowerCase() !== item.name.toLowerCase()) return false
                if (item.manufacturer && p.manufacturer?.toLowerCase() !== item.manufacturer.toLowerCase()) return false
                if (item.packageVolume && p.packageVolume !== item.packageVolume) return false
                return true
              })

              if (!product) {
                const productId = crypto.randomUUID()
                await productsCol.insert({
                  id: productId,
                  name: item.name,
                  manufacturer: item.manufacturer,
                  packageVolume: item.packageVolume,
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
                storeId: store.id,
                priceByn: item.amount,
                qualityRating: item.qualityRating,
                purchaseDate: expense.date,
                notes: item.notes,
                createdAt: now,
                updatedAt: now,
              })

              convertedToPurchaseId = purchaseId
            }

            await doc.patch({
              name: item.name,
              amount: item.amount,
              manufacturer: item.manufacturer,
              packageVolume: item.packageVolume,
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

  const handleDelete = async () => {
    if (!expensesCol || !expense) return
    setDeleting(true)
    try {
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

      navigate('/expenses')
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
    <div className="pb-10">
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
            onDone={() => navigate('/expenses')}
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
        <ReceiptItemsManager items={localReceiptItems} onChange={handleReceiptItemsChange} productCategories={productCategories} />
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
