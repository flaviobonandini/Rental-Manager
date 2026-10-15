<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '../utils/authFetch'

interface ProductOption {
  id: number
  codice: string
  nome: string
}

interface OwnerOption {
  id: number
  username: string
  nome: string | null
  cognome: string | null
}

interface ProductRental {
  id: number
  product_id: number
  product_name: string
  user_owner_id: number
  rental_number: string
  rental_start_date: string
  rental_stop_date: string
  status: string
  notes: string
}

const route = useRoute()
const router = useRouter()
const isNew = computed(() => route.name === 'product-rental-new')
const isView = computed(() => route.name === 'product-rental-view')
const rentalId = computed(() => String(route.params.id || ''))
const currentUser = (() => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null') as {
      id?: number
      role?: string
      username?: string
    } | null
  } catch {
    return null
  }
})()
const isAdministrator = ['admin', 'superadmin'].includes(String(currentUser?.role || '').toLowerCase())
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const products = ref<ProductOption[]>([])
const owners = ref<OwnerOption[]>([])
const availability = ref<boolean | null>(null)
const availabilityLoading = ref(false)
const availabilityError = ref('')
const isDateModalOpen = ref(false)
const startCalendarDate = ref('')
const stopCalendarDate = ref('')
const draftStartDate = ref('')
const draftStopDate = ref('')
let availabilityRequest = 0
const rental = ref<ProductRental>({
  id: 0,
  product_id: 0,
  product_name: '',
  user_owner_id: 0,
  rental_number: '',
  rental_start_date: '',
  rental_stop_date: '',
  status: 'DRAFT',
  notes: '',
})

const title = computed(() => {
  if (isNew.value) return 'New product booking'
  return isView.value ? 'Product booking details' : 'Edit product booking'
})

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback
}

async function readResponse(response: Response) {
  try {
    return await response.json()
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause
    if (response.status === 404) {
      throw new Error('Product booking API not found. Restart the backend to load the new product booking routes.')
    }
    throw new Error(`The product booking API returned an invalid response (HTTP ${response.status}).`)
  }
}

function ownerLabel(owner: OwnerOption) {
  const name = [owner.nome, owner.cognome].filter(Boolean).join(' ')
  return name ? `${name} (${owner.username})` : owner.username
}

function formatDate(value: string) {
  if (!value) return ''
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('it-IT', { dateStyle: 'short' }).format(date)
}

function dateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dateFromKey(value: string) {
  const parts = value.split('-')
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
}

function addDays(value: string, amount: number) {
  const date = dateFromKey(value)
  date.setDate(date.getDate() + amount)
  return dateKey(date)
}

function formatCalendarDate(value: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dateFromKey(value))
}

const today = computed(() => dateKey(new Date()))
const minimumStopDate = computed(() =>
  addDays(draftStartDate.value || today.value, 1),
)

function openDateModal() {
  draftStartDate.value = rental.value.rental_start_date >= today.value
    ? rental.value.rental_start_date
    : ''
  startCalendarDate.value = draftStartDate.value || today.value

  const firstStopDate = addDays(draftStartDate.value || startCalendarDate.value, 1)
  draftStopDate.value = rental.value.rental_stop_date >= firstStopDate
    ? rental.value.rental_stop_date
    : ''
  stopCalendarDate.value = draftStopDate.value || firstStopDate
  isDateModalOpen.value = true
}

function moveCalendarDate(which: 'start' | 'stop', amount: number) {
  if (which === 'start') {
    const nextDate = addDays(startCalendarDate.value, amount)
    if (nextDate < today.value) return
    startCalendarDate.value = nextDate
    if (draftStopDate.value && draftStopDate.value <= nextDate) {
      draftStopDate.value = ''
    }
    if (stopCalendarDate.value <= nextDate) {
      stopCalendarDate.value = addDays(nextDate, 1)
    }
    return
  }

  const nextDate = addDays(stopCalendarDate.value, amount)
  if (nextDate < minimumStopDate.value) return
  stopCalendarDate.value = nextDate
}

function selectStartDate() {
  if (startCalendarDate.value < today.value) return
  draftStartDate.value = startCalendarDate.value
  if (draftStopDate.value && draftStopDate.value <= startCalendarDate.value) {
    draftStopDate.value = ''
  }
  if (stopCalendarDate.value <= startCalendarDate.value) {
    stopCalendarDate.value = addDays(startCalendarDate.value, 1)
  }
}

function selectStopDate() {
  if (stopCalendarDate.value < minimumStopDate.value) return
  draftStopDate.value = stopCalendarDate.value
}

function confirmDates() {
  if (!draftStartDate.value || !draftStopDate.value) return
  rental.value.rental_start_date = draftStartDate.value
  rental.value.rental_stop_date = draftStopDate.value
  isDateModalOpen.value = false
  updateAvailability()
}

function updateAvailability() {
  availability.value = null
  if (rental.value.rental_start_date && rental.value.rental_stop_date) {
    void checkAvailability()
  }
}

async function checkAvailability() {
  const requestId = ++availabilityRequest
  availability.value = null
  availabilityError.value = ''

  if (
    !rental.value.product_id ||
    !/^\d{4}-\d{2}-\d{2}$/.test(rental.value.rental_start_date) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(rental.value.rental_stop_date) ||
    rental.value.rental_start_date >= rental.value.rental_stop_date
  ) {
    availabilityLoading.value = false
    return
  }

  availabilityLoading.value = true
  const params = new URLSearchParams({
    productId: String(rental.value.product_id),
    from: rental.value.rental_start_date,
    to: rental.value.rental_stop_date,
  })
  if (!isNew.value && isAdministrator && rental.value.id) {
    params.set('excludeId', String(rental.value.id))
  }

  try {
    const response = await authFetch(`/api/rental-product-availability?${params}`)
    const data = await readResponse(response)
    if (!response.ok) throw new Error(data.message || 'Unable to check product availability.')
    if (typeof data.available !== 'boolean') {
      throw new Error('The server response does not contain availability data.')
    }
    if (requestId === availabilityRequest) availability.value = data.available
  } catch (cause) {
    if (requestId === availabilityRequest) {
      availabilityError.value = errorMessage(cause, 'Error while checking product availability.')
    }
  } finally {
    if (requestId === availabilityRequest) availabilityLoading.value = false
  }
}

function onAvailabilityChange() {
  void checkAvailability()
}

async function loadRental() {
  loading.value = true
  error.value = ''

  try {
    const optionsResponse = await authFetch('/api/rental-product-options')
    const optionsData = await readResponse(optionsResponse)
    if (!optionsResponse.ok) {
      throw new Error(optionsData.message || 'Unable to load products and owners.')
    }
    if (!Array.isArray(optionsData.products) || !Array.isArray(optionsData.users)) {
      throw new Error('The server response does not contain product booking options.')
    }
    products.value = optionsData.products
    owners.value = optionsData.users

    if (isNew.value) {
      rental.value = {
        ...rental.value,
        user_owner_id: isAdministrator ? 0 : Number(currentUser?.id || 0),
        product_id: Number(route.query.product_id) || 0,
        notes: typeof route.query.notes === 'string' ? route.query.notes : '',
      }
      if (isAdministrator && route.query.user_owner_id) {
        const ownerId = Number(route.query.user_owner_id)
        if (owners.value.some((owner) => owner.id === ownerId)) {
          rental.value.user_owner_id = ownerId
        }
      }
      return
    }

    const rentalResponse = await authFetch(`/api/rental-products/${rentalId.value}`)
    const rentalData = await readResponse(rentalResponse)
    if (!rentalResponse.ok) {
      throw new Error(rentalData.message || 'Unable to load the product booking.')
    }
    rental.value = {
      ...rentalData,
      product_id: Number(rentalData.product_id),
      rental_start_date: String(rentalData.rental_start_date || '').slice(0, 10),
      rental_stop_date: String(rentalData.rental_stop_date || '').slice(0, 10),
      notes: rentalData.notes || '',
    }
    if (!products.value.some((product) => product.id === rental.value.product_id)) {
      products.value.unshift({
        id: rental.value.product_id,
        codice: '',
        nome: rentalData.product_name || `Product #${rental.value.product_id}`,
      })
    }
    await checkAvailability()
  } catch (cause) {
    error.value = errorMessage(cause, 'Error while loading the product booking.')
  } finally {
    loading.value = false
  }
}

async function saveRental() {
  error.value = ''
  if (!rental.value.rental_start_date || !rental.value.rental_stop_date) {
    error.value = 'Select both the start and return dates.'
    return
  }
  if (rental.value.rental_start_date >= rental.value.rental_stop_date) {
    error.value = 'The return date must be later than the start date.'
    return
  }
  if (isNew.value && availability.value !== true) {
    error.value = 'Check that the product is available for the selected dates before confirming.'
    return
  }

  try {
    saving.value = true
    const response = await authFetch(
      isNew.value ? '/api/rental-products' : `/api/rental-products/${rentalId.value}`,
      {
        method: isNew.value ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew.value
          ? {
              product_id: rental.value.product_id,
              ...(isAdministrator ? { user_owner_id: rental.value.user_owner_id } : {}),
              rental_start_date: rental.value.rental_start_date,
              rental_stop_date: rental.value.rental_stop_date,
              notes: rental.value.notes,
            }
          : rental.value),
      },
    )
    const data = await readResponse(response)
    if (!response.ok) throw new Error(data.message || 'Unable to save the product booking.')
    await router.push({
      path: '/bookings-product',
      query: { saved: isNew.value ? 'created' : 'updated' },
    })
  } catch (cause) {
    error.value = errorMessage(cause, 'Error while saving the product booking.')
  } finally {
    saving.value = false
  }
}

onMounted(loadRental)
</script>

<template>
  <section class="product-rental-form-page">
    <header class="page-header">
      <div>
        <h2>{{ title }}</h2>
        <p v-if="isNew">The number is generated automatically in the format RTP-DDMMYY-XXXX</p>
        <p v-else>{{ rental.rental_number }}</p>
      </div>
      <button type="button" class="secondary-button" @click="router.push('/bookings-product')">
        ← Back to product bookings
      </button>
    </header>

    <div v-if="loading" class="state-card" role="status">Loading product booking...</div>
    <div v-else-if="error && !rental.id && !isNew" class="state-card error-card" role="alert">
      {{ error }}
    </div>
    <form v-else class="form-card" @submit.prevent="saveRental">
      <h3>{{ isNew ? 'Select a product and rental dates' : 'Booking details' }}</h3>
        <label class="form-group">
          <span>Product</span>
          <select
            v-model.number="rental.product_id"
            required
            :disabled="isView"
            @change="onAvailabilityChange"
          >
            <option :value="0" disabled>Select a product</option>
            <option v-for="product in products" :key="product.id" :value="product.id">
              {{ product.codice }} — {{ product.nome }}
            </option>
          </select>
        </label>
      <div class="form-grid mt-2">

<!-- 
        <label v-if="!isNew" class="form-group">
          <span>Booking number</span>
          <input v-model.trim="rental.rental_number" maxlength="30" required :disabled="isView" />
        </label>

 -->          <template v-if="!isView">
   <div class="form-group full-width">
     <span>Rental dates</span>
     <div class="date-selection">
       <button
         type="button"
         class="date-select-button"
         @click="openDateModal"
       >
         <strong>Start</strong>
         <span>{{ rental.rental_start_date ? formatDate(rental.rental_start_date) : 'Select start date' }}</span>
       </button>
       <button
         type="button"
         class="date-select-button"
         @click="openDateModal"
       >
         <strong>Return</strong>
         <span>{{ rental.rental_stop_date ? formatDate(rental.rental_stop_date) : 'Select return date' }}</span>
       </button>
     </div>
     <button type="button" class="secondary-button date-change-button" @click="openDateModal">
       {{ rental.rental_start_date ? 'Change dates' : 'Select dates' }}
     </button>
   </div>
 </template>
 <template v-else>
   <div class="form-group">
     <span>Start date</span>
     <div class="read-only-date">{{ formatDate(rental.rental_start_date) }}</div>
   </div>

   <div class="form-group">
     <span>Return date</span>
     <div class="read-only-date">{{ formatDate(rental.rental_stop_date) }}</div>
   </div>
 </template>

        <label v-if="isAdministrator" class="form-group">
          <span>Owner</span>
          <select v-model.number="rental.user_owner_id" required :disabled="isView">
            <option :value="0" disabled>Select an owner</option>
            <option v-for="owner in owners" :key="owner.id" :value="owner.id">
              {{ ownerLabel(owner) }}
            </option>
          </select>
        </label>

        <div v-else class="form-group">
          <span>Owner</span>
          <input :value="owners[0] ? ownerLabel(owners[0]) : currentUser?.username || 'Current user'" disabled />
        </div>

        <label v-if="!isNew" class="form-group">
          <span>Status</span>
          <select v-model="rental.status" required :disabled="isView">
            <option value="DRAFT">DRAFT</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </label>

        <label class="form-group full-width">
          <span>Notes</span>
          <textarea v-model.trim="rental.notes" rows="4" :disabled="isView" />
        </label>
      </div>

      <p v-if="availabilityLoading" class="availability-message" role="status">
        Checking product availability...
      </p>
      <p v-else-if="availability === false" class="error-message" role="alert">
        This product is already booked for the selected dates.
      </p>
      <p v-else-if="availability === true" class="available-message" role="status">
        Product available for the selected dates.
      </p>
      <p v-if="availabilityError" class="error-message" role="alert">
        {{ availabilityError }}
        <button type="button" class="secondary-button" @click="checkAvailability">Retry</button>
      </p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>

      <footer class="form-actions">
        <button type="button" class="secondary-button" @click="router.push('/bookings-product')">
          {{ isView ? 'Close' : 'Cancel' }}
        </button>
        <button
          v-if="isView"
          type="button"
          class="primary-button"
          @click="router.push(`/bookings-product/edit/${rentalId}`)"
        >
          Edit
        </button>
        <button
          v-else
          type="submit"
          class="primary-button"
          :disabled="saving || availabilityLoading || availability === false"
        >
          {{ saving ? 'Saving...' : isNew ? 'Confirm booking' : 'Save changes' }}
        </button>
      </footer>
    </form>

    <div
      v-if="isDateModalOpen"
      class="calendar-backdrop"
      @click.self="isDateModalOpen = false"
    >
      <section
        class="calendar-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="date-calendar-title"
      >
        <header class="calendar-header">
          <div>
            <h3 id="date-calendar-title">Select rental dates</h3>
            <p>Choose a start date and a return date. Past dates are unavailable.</p>
          </div>
          <button
            type="button"
            class="calendar-close"
            aria-label="Close calendar"
            @click="isDateModalOpen = false"
          >
            ×
          </button>
        </header>

        <div class="date-calendars">
          <section class="date-calendar-panel" aria-label="Start date">
            <h4>Start date</h4>
            <nav class="day-navigation" aria-label="Start date navigation">
              <button
                type="button"
                :disabled="startCalendarDate <= today"
                @click="moveCalendarDate('start', -1)"
              >
                ← Previous day
              </button>
              <button type="button" @click="moveCalendarDate('start', 1)">
                Next day →
              </button>
            </nav>
            <div class="calendar-day-card" :class="{ selected: draftStartDate === startCalendarDate }">
              <span>{{ formatCalendarDate(startCalendarDate) }}</span>
              <strong v-if="draftStartDate === startCalendarDate">Selected</strong>
              <button type="button" class="primary-button" @click="selectStartDate">
                Select start
              </button>
            </div>
          </section>

          <section class="date-calendar-panel" aria-label="Return date">
            <h4>Return date</h4>
            <nav class="day-navigation" aria-label="Return date navigation">
              <button
                type="button"
                :disabled="stopCalendarDate <= minimumStopDate"
                @click="moveCalendarDate('stop', -1)"
              >
                ← Previous day
              </button>
              <button type="button" @click="moveCalendarDate('stop', 1)">
                Next day →
              </button>
            </nav>
            <div class="calendar-day-card" :class="{ selected: draftStopDate === stopCalendarDate }">
              <span>{{ formatCalendarDate(stopCalendarDate) }}</span>
              <strong v-if="draftStopDate === stopCalendarDate">Selected</strong>
              <button
                type="button"
                class="primary-button"
                :disabled="stopCalendarDate < minimumStopDate"
                @click="selectStopDate"
              >
                Select return
              </button>
            </div>
          </section>
        </div>

        <p v-if="draftStartDate && draftStopDate" class="date-range-summary">
          Rental period: {{ formatDate(draftStartDate) }} – {{ formatDate(draftStopDate) }}
        </p>
        <p v-else class="date-range-summary">
          Select both dates to continue.
        </p>

        <footer class="calendar-footer">
          <button type="button" class="secondary-button" @click="isDateModalOpen = false">
            Cancel
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="!draftStartDate || !draftStopDate"
            @click="confirmDates"
          >
            Confirm dates
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.product-rental-form-page {
  min-height: calc(100vh - 68px);
  padding: 34px clamp(20px, 3vw, 42px);
  color: #172033;
}

.page-header,
.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-header {
  margin-bottom: 24px;
}

h2 {
  margin: 0;
  font-size: 28px;
}

.page-header p {
  margin: 7px 0 0;
  color: #64748b;
}

.form-card,
.state-card {
  max-width: 980px;
  padding: 24px;
  border: 1px solid #dbe2ec;
  border-radius: 12px;
  background: white;
  box-shadow: 0 6px 20px rgb(15 23 42 / 5%);
}

.form-card h3 {
  margin: 0 0 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8edf4;
  font-size: 18px;
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
  color: #27364d;
  font-size: 14px;
  font-weight: 600;
}

.form-group input,
.form-group select,
.form-group textarea,
.read-only-date {
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
  color: #111827;
  font: inherit;
  font-weight: 400;
}

.form-group :disabled {
  background: #f1f5f9;
  color: #475569;
}

.read-only-date {
  display: flex;
  align-items: center;
  background: #f1f5f9;
  color: #475569;
}

.full-width {
  grid-column: 1 / -1;
}

.form-actions {
  justify-content: flex-end;
  margin-top: 22px;
}

.date-selection {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.date-select-button {
  display: flex;
  min-height: 68px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 5px;
  padding: 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
  color: #27364d;
  text-align: left;
  cursor: pointer;
}

.date-select-button:hover {
  border-color: #60a5fa;
  background: #f8fbff;
}

.date-select-button span {
  color: #1e40af;
  font-weight: 500;
}

.date-change-button {
  align-self: flex-start;
  margin-top: 10px;
}

.primary-button,
.secondary-button {
  min-height: 40px;
  padding: 9px 15px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
  color: #27364d;
  font-weight: 650;
  cursor: pointer;
}

.primary-button {
  border-color: #1d4ed8;
  background: #2563eb;
  color: white;
}

.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.available-message,
.availability-message,
.error-message {
  margin: 18px 0 0;
  padding: 12px;
  border: 1px solid;
  border-radius: 8px;
}

.available-message {
  border-color: #99f6e4;
  background: #f0fdfa;
  color: #134e4a;
}

.availability-message {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1e40af;
}

.error-message,
.error-card {
  border-color: #fecaca;
  background: #fff7f7;
  color: #991b1b;
}

.calendar-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(15 23 42 / 60%);
}

.calendar-modal {
  width: min(900px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 24px;
  border: 1px solid #dbe2ec;
  border-radius: 14px;
  background: white;
  box-shadow: 0 24px 70px rgb(15 23 42 / 30%);
}

.calendar-header,
.day-navigation,
.calendar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.calendar-header {
  margin-bottom: 20px;
}

.calendar-header h3 {
  margin: 0;
  color: #172033;
  font-size: 21px;
}

.calendar-header p {
  margin: 5px 0 0;
  color: #64748b;
  font-size: 13px;
}

.calendar-close {
  width: 36px;
  height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
  color: #334155;
  font-size: 25px;
  line-height: 1;
  cursor: pointer;
}

.date-calendars {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.date-calendar-panel {
  padding: 16px;
  border: 1px solid #dbe2ec;
  border-radius: 10px;
  background: #fbfdff;
}

.date-calendar-panel h4 {
  margin: 0 0 12px;
  color: #1e293b;
  font-size: 16px;
}

.day-navigation {
  margin-bottom: 12px;
}

.day-navigation button {
  min-height: 36px;
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  background: white;
  color: #1e40af;
  font-weight: 600;
  cursor: pointer;
}

.day-navigation button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.calendar-day-card {
  display: flex;
  min-height: 150px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  border: 1px solid #dbe2ec;
  border-radius: 9px;
  background: white;
  color: #27364d;
  text-align: center;
}

.calendar-day-card span {
  font-size: 18px;
  font-weight: 650;
}

.calendar-day-card strong {
  color: #0f766e;
  font-size: 12px;
}

.calendar-day-card.selected {
  border-color: #5eead4;
  background: #f0fdfa;
}

.date-range-summary {
  margin: 18px 0 0;
  padding: 12px;
  border-radius: 8px;
  background: #eff6ff;
  color: #1e40af;
  font-weight: 600;
}

.calendar-footer {
  justify-content: flex-end;
  margin-top: 18px;
}

@media (max-width: 700px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-card {
    padding: 19px;
  }

  .calendar-backdrop {
    padding: 8px;
  }

  .calendar-modal {
    max-height: 95vh;
    padding: 16px;
  }

  .date-calendars,
  .date-selection {
    grid-template-columns: 1fr;
  }

  .calendar-header {
    align-items: flex-start;
  }

  .day-navigation button {
    padding: 7px;
    font-size: 12px;
  }
}

.mt-2 {
  margin-top: 10px !important;
}
</style>
