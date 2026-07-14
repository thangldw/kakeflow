const DATABASE_NAME = 'kakeflow-reference-capture-uploader'
const DATABASE_VERSION = 1
const STORE_NAME = 'captures'

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')), { once: true })
  })
}

function transactionCompleted(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')), { once: true })
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')), { once: true })
  })
}

export async function openCaptureQueueStore(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) throw new Error('このブラウザーでは永続キューを利用できません。')
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
  request.addEventListener('upgradeneeded', () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'captureId' })
  }, { once: true })
  const database = await requestResult(request)

  return Object.freeze({
    list: async () => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const records = await requestResult(transaction.objectStore(STORE_NAME).getAll())
      await transactionCompleted(transaction)
      return records.sort((left, right) => left.createdAt - right.createdAt)
    },
    put: async (record) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const completion = transactionCompleted(transaction)
      await requestResult(transaction.objectStore(STORE_NAME).put(record))
      await completion
      return record
    },
    delete: async (captureId) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const completion = transactionCompleted(transaction)
      await requestResult(transaction.objectStore(STORE_NAME).delete(captureId))
      await completion
    },
  })
}
