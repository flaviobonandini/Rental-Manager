<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { authFetch } from '../utils/authFetch'

interface ProductForm {
  codice: string
  nome: string
  descrizione: string
  immagine: string
  active: number
}

const route = useRoute()
const router = useRouter()

const productId = computed(() => String(route.params.id || ''))

const isView = computed(() => route.name === 'product-view')
const isEdit = computed(() => route.name === 'product-edit')
const isNew = computed(() => route.name === 'product-new')

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notificationMessage = ref('')
const notificationType = ref<'success' | 'error'>('success')
let notificationTimer: ReturnType<typeof setTimeout> | null = null

const product = ref<ProductForm>({
  codice: '',
  nome: '',
  descrizione: '',
  active: 1,
  immagine: ''
})

const editor = useEditor({
  extensions: [StarterKit],
  content: '',
  editable: !isView.value,
  onUpdate: ({ editor }) => {
    product.value.descrizione = editor.getHTML()
  },
})

watch(isView, (readOnly) => {
  editor.value?.setEditable(!readOnly)
})

function pageTitle() {
  if (isView.value) return 'View product'
  if (isEdit.value) return 'Edit product'
  return 'New product'
}

function formatDate(value: string | Date | null) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('en-US')
}

function showNotification(
  message: string,
  type: 'success' | 'error' = 'success',
  duration = 3200,
) {

  notificationMessage.value = message
  notificationType.value = type

  if (notificationTimer) {
    clearTimeout(notificationTimer)
  }

  notificationTimer = setTimeout(() => {
    notificationMessage.value = ''
    notificationTimer = null
  }, duration)
}

function closeNotification() {

  notificationMessage.value = ''

  if (notificationTimer) {
    clearTimeout(notificationTimer)
    notificationTimer = null
  }
}

function wait(ms: number) {

  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function loadProduct() {
  if (!productId.value) {
    return
  }

  try {
    loading.value = true
    error.value = ''

    const response = await authFetch(`/api/products/${productId.value}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data.message ||
        'Failed to load the product.'
      )
    }

    product.value = {
      ...product.value,
      ...data,
      password: '',
      confirmPassword: '',
    }
    editor.value?.commands.setContent(product.value.descrizione || '', {
      emitUpdate: false,
    })

  } catch (err) {
    error.value = err instanceof Error
      ? err.message
      : 'Failed to load the product.'
  } finally {
    loading.value = false
  }
}

async function saveProduct() {
  if (isView.value) {
    return
  }

  error.value = ''

  if (!product.value.nome.trim()) {
    error.value = 'Name is required.'
    showNotification(error.value, 'error')
    return
  }


  try {
    saving.value = true

    const payload = {
      codice: product.value.codice.trim(),
      nome: product.value.nome,
      descrizione: product.value.descrizione,
      active: Number(product.value.active),
      immagine: product.value.immagine,
    }

    const url = isEdit.value
      ? `/api/products/${productId.value}`
      : '/api/products'

    const method = isEdit.value
      ? 'PUT'
      : 'POST'

    const response = await authFetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data.message ||
        'Failed to save the product.'
      )
    }

    showNotification(
      isEdit.value
        ? 'Product updated successfully.'
        : 'Product created successfully.',
      'success',
      1800
    )

    await wait(900)
    await router.push('/products')

  } catch (err) {
    error.value = err instanceof Error
      ? err.message
      : 'Failed to save the product.'
    showNotification(
      error.value,
      'error'
    )
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  if (isEdit.value || isView.value) {
    await loadProduct()
  }
})

onUnmounted(() => {
  if (notificationTimer) {
    clearTimeout(notificationTimer)
  }
})


</script>

<template>
  <div class="page">

    <Transition name="toast">
      <div
        v-if="notificationMessage"
        class="notification-toast"
        :class="notificationType"
        role="status"
        aria-live="polite"
      >
        <span class="notification-icon">
          {{
            notificationType === 'success'
              ? '✓'
              : '!'
          }}
        </span>

        <span>
          {{ notificationMessage }}
        </span>

        <button
          type="button"
          class="notification-close"
          aria-label="Close notification"
          @click="closeNotification"
        >
          ×
        </button>
      </div>
    </Transition>

    <div class="page-header">
      <div>
        <h1>{{ pageTitle() }}</h1>

        <p v-if="isEdit || isView">
          Product code : {{ product.codice }}
        </p>

        <p v-else>
          The Product code is generated automatically in the format PRDXXX
        </p>
      </div>

      <button
        type="button"
        class="back-button"
        @click="router.push('/products')"
      >
        ← Back to products
      </button>
    </div>

    <div v-if="loading">
      Loading...
    </div>

    <div
      v-else-if="error && isView"
      class="error"
    >
      {{ error }}
    </div>

    <form
      v-else
      class="product-form"
      @submit.prevent="saveProduct"
    >

      <div class="form-section">
        <h2>Product details</h2>

        <div class="form-grid">

          <div class="form-group">
            <label>Product name *</label>

            <input
              v-model="product.nome"
              type="text"
              :disabled="isView"
            />
          </div>

          <div class="form-group">
            <label>Status</label>

            <select
              v-model.number="product.active"
              :disabled="isView"
            >
              <option :value="1">
                Active
              </option>

              <option :value="0">
                Disabled
              </option>
            </select>
          </div>

        </div>
        <br>

        <div class="form-group description">
          <label>Description</label>

          <div
            v-if="editor"
            class="editor-wrapper"
            :class="{ 'editor-readonly': isView }"
          >
            <div
              v-if="!isView"
              class="editor-toolbar"
              role="toolbar"
              aria-label="Description formatting"
            >
              <div class="toolbar-group">
                <button
                  type="button"
                  class="toolbar-button"
                  :class="{ active: editor.isActive('bold') }"
                  aria-label="Bold"
                  title="Bold"
                  @click="editor.chain().focus().toggleBold().run()"
                >
                  <strong>B</strong>
                </button>
                <button
                  type="button"
                  class="toolbar-button italic-button"
                  :class="{ active: editor.isActive('italic') }"
                  aria-label="Italic"
                  title="Italic"
                  @click="editor.chain().focus().toggleItalic().run()"
                >
                  <em>I</em>
                </button>
                <button
                  type="button"
                  class="toolbar-button strike-button"
                  :class="{ active: editor.isActive('strike') }"
                  aria-label="Strikethrough"
                  title="Strikethrough"
                  @click="editor.chain().focus().toggleStrike().run()"
                >
                  S
                </button>
              </div>

              <span class="toolbar-divider" aria-hidden="true"></span>

              <div class="toolbar-group">
                <button
                  type="button"
                  class="toolbar-button"
                  :class="{ active: editor.isActive('heading', { level: 2 }) }"
                  aria-label="Heading"
                  title="Heading"
                  @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
                >
                  H2
                </button>
                <button
                  type="button"
                  class="toolbar-button"
                  :class="{ active: editor.isActive('bulletList') }"
                  aria-label="Bulleted list"
                  title="Bulleted list"
                  @click="editor.chain().focus().toggleBulletList().run()"
                >
                  • List
                </button>
                <button
                  type="button"
                  class="toolbar-button"
                  :class="{ active: editor.isActive('orderedList') }"
                  aria-label="Numbered list"
                  title="Numbered list"
                  @click="editor.chain().focus().toggleOrderedList().run()"
                >
                  1. List
                </button>
                <button
                  type="button"
                  class="toolbar-button"
                  :class="{ active: editor.isActive('blockquote') }"
                  aria-label="Blockquote"
                  title="Blockquote"
                  @click="editor.chain().focus().toggleBlockquote().run()"
                >
                  “ ”
                </button>
              </div>

              <span class="toolbar-divider" aria-hidden="true"></span>

              <div class="toolbar-group history-group">
                <button
                  type="button"
                  class="toolbar-button history-button"
                  :disabled="!editor.can().undo()"
                  aria-label="Undo"
                  title="Undo"
                  @click="editor.chain().focus().undo().run()"
                >
                  ↶
                </button>
                <button
                  type="button"
                  class="toolbar-button history-button"
                  :disabled="!editor.can().redo()"
                  aria-label="Redo"
                  title="Redo"
                  @click="editor.chain().focus().redo().run()"
                >
                  ↷
                </button>
              </div>
            </div>

            <EditorContent :editor="editor" />
          </div>
        </div>

      </div>
      <div
        v-if="error"
        class="error"
      >
        {{ error }}
      </div>

      <div class="form-actions">

        <button
          type="button"
          class="cancel-button"
          @click="router.push('/products')"
        >
          {{
            isView
              ? 'Close'
              : 'Cancel'
          }}
        </button>

        <button
          v-if="isView"
          type="button"
          class="edit-button"
          @click="router.push(`/products/edit/${productId}`)"
        >
          ✏️ Edit
        </button>

        <button
          v-if="!isView"
          type="submit"
          class="save-button"
          :disabled="saving"
        >
          {{
            saving
              ? 'Saving...'
              : isEdit
                ? 'Save changes'
                : 'Save product'
          }}
        </button>

      </div>

    </form>

  </div>
</template>

<style scoped>
.page {
  width: 100%;
  min-height: calc(100vh - 68px);
  padding: 34px clamp(20px, 3vw, 42px);
  color: #172033;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-bottom: 26px;
}

.page-header h1 {
  margin: 0;
  color: #111827;
  font-size: 29px;
  font-weight: 750;
  letter-spacing: -0.035em;
  line-height: 1.2;
}

.page-header p {
  margin: 9px 0 0;
  color: #475569;
  font-size: 14px;
}

.product-form {
  width: 100%;
  max-width: 1120px;
}

.form-section {
  margin-bottom: 18px;
  padding: 24px;
  background: white;
  border: 1px solid #dbe2ec;
  border-radius: 12px;
  box-shadow: 0 6px 20px rgb(15 23 42 / 5%);
}

.form-section h2 {
  margin: 0 0 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8edf4;
  color: #1e293b;
  font-size: 17px;
  font-weight: 700;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 14px;
  font-weight: 600;
  color: #27364d;
}

.form-group input,
.form-group select {
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
  color: #111827;
  font-size: 14px;
  box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgb(37 99 235 / 14%);
}

.form-group input:disabled,
.form-group select:disabled {
  border-color: #dbe2ec;
  background: #f1f5f9;
  color: #475569;
  cursor: not-allowed;
}

.description {
  margin-top: 22px;
}

.editor-wrapper {
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 2px 5px rgb(15 23 42 / 4%);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.editor-wrapper:focus-within {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgb(37 99 235 / 13%);
}

.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  min-height: 52px;
  padding: 8px 10px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 3px;
}

.toolbar-divider {
  width: 1px;
  height: 25px;
  margin: 0 3px;
  background: #dbe2ec;
}

.toolbar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 34px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #334155;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.toolbar-button:hover:not(:disabled) {
  border-color: #cbd5e1;
  background: #fff;
  color: #1d4ed8;
}

.toolbar-button.active {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.toolbar-button:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 1px;
}

.toolbar-button:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}

.italic-button {
  font-size: 15px;
}

.strike-button {
  text-decoration: line-through;
}

.history-button {
  font-size: 20px;
  font-weight: 400;
}

.editor-wrapper :deep(.tiptap) {
  min-height: 190px;
  padding: 16px 18px;
  color: #1e293b;
  font-size: 14px;
  line-height: 1.7;
  outline: none;
}

.editor-wrapper :deep(.tiptap > :first-child) {
  margin-top: 0;
}

.editor-wrapper :deep(.tiptap > :last-child) {
  margin-bottom: 0;
}

.editor-wrapper :deep(.tiptap p) {
  margin: 0 0 10px;
}

.editor-wrapper :deep(.tiptap h2) {
  margin: 18px 0 8px;
  color: #172033;
  font-size: 19px;
  line-height: 1.35;
}

.editor-wrapper :deep(.tiptap ul),
.editor-wrapper :deep(.tiptap ol) {
  margin: 8px 0;
  padding-left: 25px;
}

.editor-wrapper :deep(.tiptap blockquote) {
  margin: 12px 0;
  padding: 3px 0 3px 14px;
  border-left: 3px solid #93c5fd;
  color: #475569;
}

.editor-wrapper :deep(.tiptap blockquote p:last-child) {
  margin-bottom: 0;
}

.editor-wrapper :deep(.tiptap code) {
  padding: 2px 5px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #be123c;
  font-size: 0.9em;
}

.editor-readonly {
  background: #f8fafc;
}

.editor-readonly :deep(.tiptap) {
  min-height: 0;
}

.editor-readonly :deep(.tiptap p:last-child) {
  margin-bottom: 0;
}

.password-help {
  margin: -10px 0 20px;
  color: #475569;
  font-size: 13px;
}

.readonly-password {
  padding: 12px;
  border: 1px solid #dbe2ec;
  border-radius: 8px;
  background: #f1f5f9;
  color: #475569;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 4px 2px 12px;
}

.save-button,
.cancel-button,
.back-button,
.edit-button {
  min-height: 42px;
  padding: 10px 17px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.save-button,
.edit-button {
  border: 0;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: white;
  box-shadow: 0 2px 5px rgb(15 23 42 / 10%);
}

.save-button:hover:not(:disabled),
.edit-button:hover {
  background: #1d4ed8;
  transform: translateY(-1px);
}

.save-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.cancel-button,
.back-button {
  border: 1px solid #cbd5e1;
  background: white;
  color: #27364d;
}

.cancel-button:hover,
.back-button:hover {
  border-color: #93c5fd;
  background: #eff6ff;
}

.back-button {
  box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
}

.notification-toast {
  position: fixed;
  top: 22px;
  right: 22px;
  z-index: 50;

  display: flex;
  align-items: center;

  gap: 10px;

  max-width: min(440px, calc(100vw - 32px));

  padding: 13px 14px;

  border-radius: 8px;

  box-shadow:
    0 12px 30px rgba(15, 23, 42, .14);

  font-size: 14px;
  font-weight: 600;
}

.notification-toast.success {
  border: 1px solid #bbf7d0;

  background: #f0fdf4;
  color: #166534;
}

.notification-toast.error {
  border: 1px solid #fecaca;

  background: #fef2f2;
  color: #991b1b;
}

.notification-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  flex: 0 0 auto;

  width: 22px;
  height: 22px;

  border-radius: 999px;

  color: white;

  font-size: 14px;
  font-weight: 800;
}

.notification-toast.success .notification-icon {
  background: #22c55e;
}

.notification-toast.error .notification-icon {
  background: #ef4444;
}

.notification-close {
  margin-left: 6px;
  padding: 2px 6px;

  border: 0;
  border-radius: 6px;

  background: transparent;
  color: inherit;

  font-size: 18px;
  line-height: 1;

  cursor: pointer;
}

.notification-close:hover {
  background: rgba(0, 0, 0, .06);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity .18s ease,
    transform .18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.error {
  margin-bottom: 20px;
  padding: 12px;
  border: 1px solid #fecaca;
  border-radius: 8px;
  background: #fff7f7;
  color: #991b1b;
}

@media (max-width: 800px) {
  .page {
    padding: 24px 16px;
  }

  .page-header h1 {
    font-size: 25px;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .page-header {
    gap: 15px;
    flex-direction: column;
  }

  .form-section {
    padding: 19px;
  }

  .form-actions {
    flex-wrap: wrap;
  }

  .editor-toolbar {
    gap: 5px;
    padding: 7px;
  }

  .toolbar-divider {
    margin: 0 1px;
  }

  .editor-wrapper :deep(.tiptap) {
    min-height: 160px;
    padding: 13px;
  }
}
</style>
