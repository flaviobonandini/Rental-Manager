<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '../utils/authFetch'

interface ServiceOption {
  id: number
  name: string
}

interface OwnerOption {
  id: number
  username: string
  nome: string | null
  cognome: string | null
}

interface RentalAvailability {
  id: number
  rental_start_date: string
  rental_stop_date: string
}

interface RentalForm {
  id: number
  service_id: number
  service_name: string
  user_owner_id: number
  rental_number: string
  rental_start_date: string
  rental_stop_date: string
  status: string
  notes: string
}

const route = useRoute()
const router = useRouter()
const isView = computed(() => route.name === 'rental-view')
const isNew = computed(() => route.name === 'rental-new')
const rentalId = computed(() => String(route.params.id || ''))
const currentUser = (() => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null') as {
      id?: number
      role?: string
      username?: string
      nome?: string | null
      cognome?: string | null
    } | null
  } catch {
    return null
  }
})()
const isAdministrator = ['admin', 'superadmin'].includes(
  String(currentUser?.role || '').toLowerCase(),
)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const services = ref<ServiceOption[]>([])
const owners = ref<OwnerOption[]>([])
const availability = ref<RentalAvailability[]>([])
const availabilityLoading = ref(false)
const availabilityError = ref('')
const isCalendarOpen = ref(false)
const weekStart = ref(getMonday(new Date()))
let availabilityRequest = 0
const rental = ref<RentalForm>({
  id: 0,
  service_id: 0,
  service_name: '',
  user_owner_id: 0,
  rental_number: '',
  rental_start_date: '',
  rental_stop_date: '',
  status: 'DRAFT',
  notes: '',
})

const title = computed(() => {
  if (isNew.value) return 'New booking'
  return isView.value ? 'Booking details' : 'Edit booking'
})

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback
}

function toDateTimeLocal(value: string) {
  if (!value) return ''
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDate(value: string) {
  if (!value) return ''
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function getMonday(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayOffset = (monday.getDay() + 6) % 7
  monday.setDate(monday.getDate() - dayOffset)
  return monday
}

function dateKey(date: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function slotValue(date: Date, hour: number) {
  return `${dateKey(date)}T${String(hour).padStart(2, '0')}:00`
}

function dateForDay(offset: number) {
  const date = new Date(weekStart.value)
  date.setDate(date.getDate() + offset)
  return date
}

const weekDates = computed(() => Array.from({ length: 7 }, (_, day) => dateForDay(day)))
const timeSlots = Array.from({ length: 11 }, (_, index) => index + 8)
const weekLabel = computed(() => {
  const start = dateForDay(0)
  const end = dateForDay(6)
  return `${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(start)} - ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(end)}`
})

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)
}

function formatDay(date: Date) {
  return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: '2-digit' }).format(date)
}

function slotIsUnavailable(date: Date, hour: number) {
  const start = slotValue(date, hour)
  const end = slotValue(date, hour + 1)
  return availability.value.some((booking) => {
    const bookingStart = booking.rental_start_date.replace(' ', 'T').slice(0, 16)
    const bookingEnd = booking.rental_stop_date.replace(' ', 'T').slice(0, 16)
    return bookingStart < end && bookingEnd > start
  })
}

function slotIsInPast(date: Date, hour: number) {
  const key = dateKey(date)
  const year = Number(key.slice(0, 4))
  const month = Number(key.slice(5, 7))
  const day = Number(key.slice(8, 10))
  return new Date(year, month - 1, day, hour) <= new Date()
}

async function loadAvailability() {
  const requestId = ++availabilityRequest
  availabilityLoading.value = true
  availabilityError.value = ''

  const from = dateKey(dateForDay(0))
  const toDate = dateForDay(6)
  toDate.setDate(toDate.getDate() + 1)
  const to = dateKey(toDate)
  const exclude = !isNew.value && rental.value.id
    ? `&excludeId=${encodeURIComponent(rental.value.id)}`
    : ''

  try {
    const response = await authFetch(`/api/rental-availability?from=${from}&to=${to}${exclude}`)
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || 'Unable to load availability.')
    }
    if (!Array.isArray(data)) {
      throw new Error('The server response does not contain availability data.')
    }
    if (requestId !== availabilityRequest) return
    availability.value = data
  } catch (cause) {
    if (requestId === availabilityRequest) {
      availabilityError.value = errorMessage(cause, 'Error while loading availability.')
    }
  } finally {
    if (requestId === availabilityRequest) {
      availabilityLoading.value = false
    }
  }
}

async function openCalendar() {
  if (!rental.value.service_id) return
  if (!isNew.value && rental.value.rental_start_date) {
    weekStart.value = getMonday(new Date(`${rental.value.rental_start_date}:00`))
  }
  isCalendarOpen.value = true
  await loadAvailability()
}

async function moveWeek(amount: number) {
  weekStart.value = new Date(
    weekStart.value.getFullYear(),
    weekStart.value.getMonth(),
    weekStart.value.getDate() + amount * 7,
  )
  await loadAvailability()
}

function chooseSlot(date: Date, hour: number) {
  const start = slotValue(date, hour)
  const stop = slotValue(date, hour + 1)
  rental.value.rental_start_date = start
  rental.value.rental_stop_date = stop
  isCalendarOpen.value = false
}

function ownerLabel(owner: OwnerOption) {
  const name = [owner.nome, owner.cognome].filter(Boolean).join(' ')
  return name ? `${name} (${owner.username})` : owner.username
}

async function loadRental() {
  loading.value = true
  error.value = ''

  try {
    const optionsResponse = await authFetch('/api/rental-options')
    const optionsData = await optionsResponse.json()

    if (!optionsResponse.ok) {
      throw new Error(optionsData.message || 'Unable to load services and owners.')
    }

    services.value = optionsData.services
    owners.value = optionsData.users

    if (isNew.value) {
      rental.value = {
        ...rental.value,
        user_owner_id: isAdministrator ? 0 : Number(currentUser?.id || 0),
        service_id: Number(route.query.service_id) || 0,
        notes: typeof route.query.notes === 'string' ? route.query.notes : '',
      }
      if (isAdministrator && route.query.user_owner_id) {
        const ownerId = Number(route.query.user_owner_id)
        if (owners.value.some((owner) => owner.id === ownerId)) {
          rental.value.user_owner_id = ownerId
        }
      }
      if (services.value.some((service) => service.id === rental.value.service_id)) {
        await openCalendar()
      }
      return
    }

    const rentalResponse = await authFetch(`/api/rentals/${rentalId.value}`)
    const rentalData = await rentalResponse.json()

    if (!rentalResponse.ok) {
      throw new Error(rentalData.message || 'Unable to load the booking.')
    }

    rental.value = {
      ...rentalData,
      rental_start_date: toDateTimeLocal(rentalData.rental_start_date),
      rental_stop_date: toDateTimeLocal(rentalData.rental_stop_date),
      notes: rentalData.notes || '',
    }
  } catch (cause) {
    error.value = errorMessage(cause, 'Error while loading the booking.')
  } finally {
    loading.value = false
  }
}

async function saveRental() {
  error.value = ''

  if (isNew.value && (!rental.value.rental_start_date || !rental.value.rental_stop_date)) {
    error.value = 'Select a day and time from the calendar first.'
    return
  }

  if (new Date(rental.value.rental_stop_date) <= new Date(rental.value.rental_start_date)) {
    error.value = 'The end date must be later than the start date.'
    return
  }

  try {
    saving.value = true
    const response = await authFetch(
      isNew.value ? '/api/rentals' : `/api/rentals/${rentalId.value}`,
      {
        method: isNew.value ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew.value
          ? {
              service_id: rental.value.service_id,
              ...(isAdministrator ? { user_owner_id: rental.value.user_owner_id } : {}),
              rental_start_date: rental.value.rental_start_date,
              rental_stop_date: rental.value.rental_stop_date,
              notes: rental.value.notes,
            }
          : rental.value),
      },
    )
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Unable to save the booking.')
    }

    await router.push({
      path: '/bookings-service',
      query: { saved: isNew.value ? 'created' : 'updated' },
    })
  } catch (cause) {
    error.value = errorMessage(cause, 'Error while saving the booking.')
  } finally {
    saving.value = false
  }
}

onMounted(loadRental)
</script>

<template>
  <section class="rental-form-page">
    <header class="page-header">
      <div class="title-block">
        <h2>{{ title }}</h2>
        <p v-if="isNew">The number is generated automatically in the format RTS-DDMMYY-XXXX</p>
        <p v-else>{{ rental.rental_number }}</p>
      </div>
      <button type="button" class="back-button" @click="router.push('/bookings-service')">
        ← Back to bookings
      </button>
    </header>

    <div v-if="loading" class="state-card" role="status">
      Loading booking...
    </div>

    <div v-else-if="error && !rental.id && !isNew" class="state-card error-card" role="alert">
      {{ error }}
    </div>

    <form v-else class="rental-form" @submit.prevent="saveRental">
      <section class="form-section">
        <h3>{{ isNew ? 'Step 1 - Select a service' : 'Booking details' }}</h3>

        <template v-if="isNew">
          <div class="new-booking-fields">
            <label class="form-group">
              <span>Service</span>
              <select v-model.number="rental.service_id" required @change="openCalendar">
                <option :value="0" disabled>Select a service</option>
                <option v-for="service in services" :key="service.id" :value="service.id">
                  {{ service.name }}
                </option>
              </select>
            </label>
            <button
              type="button"
              class="primary-button"
              :disabled="!rental.service_id"
              @click="openCalendar"
            >
              Select date and time
            </button>
          </div>

          <div v-if="rental.rental_start_date" class="selected-slot">
            <strong>Selected time</strong>
            <span>{{ formatDate(rental.rental_start_date) }} - {{ formatDate(rental.rental_stop_date) }}</span>
            <button type="button" class="secondary-button" @click="openCalendar">
              Change time
            </button>
          </div>

          <div v-if="rental.rental_start_date" class="form-grid booking-details">
            <label v-if="isAdministrator" class="form-group">
              <span>Owner</span>
              <select v-model.number="rental.user_owner_id" required>
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

            <label class="form-group full-width">
              <span>Notes</span>
              <textarea v-model.trim="rental.notes" rows="4" />
            </label>
          </div>
        </template>

        <div v-else class="form-grid">
          <label class="form-group">
            <span>Booking number</span>
            <input v-model.trim="rental.rental_number" maxlength="30" required :disabled="isView" />
          </label>

          <label class="form-group">
            <span>Service</span>
            <select
              v-model.number="rental.service_id"
              required
              :disabled="isView"
              @change="openCalendar"
            >
              <option :value="0" disabled>Select a service</option>
              <option v-for="service in services" :key="service.id" :value="service.id">
                {{ service.name }}
              </option>
            </select>
          </label>

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

          <label class="form-group">
            <span>Status</span>
            <select v-model="rental.status" required :disabled="isView || isNew">
              <option value="DRAFT">DRAFT</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </label>

          <div class="form-group full-width">
            <span>Date and time</span>
            <div class="selected-slot">
              <strong>Selected time</strong>
              <span>{{ formatDate(rental.rental_start_date) }} - {{ formatDate(rental.rental_stop_date) }}</span>
              <button
                v-if="!isView"
                type="button"
                class="secondary-button"
                @click="openCalendar"
              >
                Change time
              </button>
            </div>
          </div>

          <label class="form-group full-width">
            <span>Notes</span>
            <textarea v-model.trim="rental.notes" rows="4" :disabled="isView" />
          </label>
        </div>
      </section>

      <p v-if="error" class="error-message" role="alert">{{ error }}</p>

      <footer class="form-actions">
        <button type="button" class="secondary-button" @click="router.push('/bookings-service')">
          {{ isView ? 'Close' : 'Cancel' }}
        </button>
        <button
          v-if="isView"
          type="button"
          class="primary-button"
          @click="router.push(`/bookings-service/edit/${rentalId}`)"
        >
          ✏️ Edit
        </button>
        <button v-else type="submit" class="primary-button" :disabled="saving">
          {{ saving ? 'Saving...' : isNew ? 'Confirm booking' : 'Save changes' }}
        </button>
      </footer>
    </form>

    <div
      v-if="isCalendarOpen"
      class="calendar-backdrop"
      @click.self="isCalendarOpen = false"
    >
      <section
        class="calendar-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-title"
      >
        <header class="calendar-header">
          <div>
            <h3 id="calendar-title">Select a day and time</h3>
            <p>{{ weekLabel }} · hours 08:00-19:00</p>
          </div>
          <button
            type="button"
            class="calendar-close"
            aria-label="Close calendar"
            @click="isCalendarOpen = false"
          >
            ×
          </button>
        </header>

        <nav class="week-navigation" aria-label="Week navigation">
          <button type="button" @click="moveWeek(-1)">← Previous week</button>
          <button type="button" @click="moveWeek(1)">Next week →</button>
        </nav>

        <p v-if="availabilityError" class="error-message" role="alert">
          {{ availabilityError }}
          <button type="button" class="secondary-button" @click="loadAvailability">Retry</button>
        </p>

        <div v-else class="calendar-table-wrap">
          <p v-if="availabilityLoading" class="calendar-loading" role="status">
            Loading availability...
          </p>
          <table class="availability-table" :aria-busy="availabilityLoading">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th v-for="date in weekDates" :key="dateKey(date)" scope="col">
                  <span>{{ formatWeekday(date) }}</span>
                  <strong>{{ formatDay(date) }}</strong>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="hour in timeSlots" :key="hour">
                <th scope="row">{{ String(hour).padStart(2, '0') }}:00</th>
                <td v-for="date in weekDates" :key="`${dateKey(date)}-${hour}`">
                  <button
                    type="button"
                    class="slot-button"
                    :class="{
                      occupied: slotIsUnavailable(date, hour),
                      selected: rental.rental_start_date === slotValue(date, hour),
                    }"
                    :disabled="availabilityLoading || slotIsUnavailable(date, hour) || slotIsInPast(date, hour)"
                    :aria-label="`${formatWeekday(date)} ${formatDay(date)} at ${String(hour).padStart(2, '0')}:00${slotIsUnavailable(date, hour) ? ', occupied' : ''}`"
                    @click="chooseSlot(date, hour)"
                  >
                    {{ slotIsUnavailable(date, hour) ? 'Occupied' : slotIsInPast(date, hour) ? 'Past' : 'Select' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="calendar-footer">
          <span><i class="slot-legend available"></i> Available</span>
          <span><i class="slot-legend busy"></i> Occupied</span>
          <button type="button" class="secondary-button" @click="isCalendarOpen = false">
            Cancel
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.rental-form-page {
  min-height: calc(100vh - 68px);
  padding: 34px clamp(20px, 3vw, 42px);
  color: #172033;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 26px;
}

.title-block {
  position: relative;
  padding-left: 16px;
}

.title-block::before {
  position: absolute;
  inset: 3px auto 3px 0;
  width: 4px;
  border-radius: 4px;
  background: linear-gradient(180deg, #3b82f6, #1d4ed8);
  content: '';
}

.title-block h2 {
  margin: 0;
  color: #111827;
  font-size: 29px;
  font-weight: 750;
  letter-spacing: -0.035em;
}

.title-block p {
  margin: 7px 0 0;
  color: #475569;
  font-size: 14px;
}

.back-button,
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

.back-button:hover,
.secondary-button:hover {
  border-color: #93c5fd;
  background: #eff6ff;
}

.rental-form {
  max-width: 1120px;
}

.form-section,
.state-card {
  padding: 24px;
  border: 1px solid #dbe2ec;
  border-radius: 12px;
  background: white;
  box-shadow: 0 6px 20px rgb(15 23 42 / 5%);
}

.form-section h3 {
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
  color: #27364d;
  font-size: 14px;
  font-weight: 600;
}

.form-group input,
.form-group select,
.form-group textarea {
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

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgb(37 99 235 / 14%);
}

.form-group :disabled {
  background: #f1f5f9;
  color: #475569;
}

.full-width {
  grid-column: 1 / -1;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 2px;
}

.new-booking-fields {
  display: flex;
  max-width: 680px;
  align-items: flex-end;
  gap: 16px;
}

.new-booking-fields .form-group {
  flex: 1;
}

.booking-details {
  margin-top: 20px;
}

.selected-slot {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 20px;
  padding: 14px 16px;
  border: 1px solid #99f6e4;
  border-radius: 9px;
  background: #f0fdfa;
  color: #134e4a;
}

.selected-slot span {
  flex: 1;
  font-weight: 500;
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
  width: min(1180px, 100%);
  max-height: min(90vh, 900px);
  overflow: auto;
  padding: 24px;
  border: 1px solid #dbe2ec;
  border-radius: 14px;
  background: white;
  box-shadow: 0 24px 70px rgb(15 23 42 / 30%);
}

.calendar-header,
.week-navigation,
.calendar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.calendar-header {
  margin-bottom: 18px;
}

.calendar-header h3 {
  margin: 0;
  color: #172033;
  font-size: 21px;
  font-weight: 750;
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

.week-navigation {
  margin-bottom: 14px;
}

.week-navigation button {
  min-height: 36px;
  padding: 7px 11px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  background: white;
  color: #1e40af;
  font-weight: 600;
  cursor: pointer;
}

.calendar-table-wrap {
  position: relative;
  overflow: auto;
  border: 1px solid #dbe2ec;
  border-radius: 9px;
}

.calendar-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  margin: 0;
  background: rgb(255 255 255 / 75%);
  color: #1e3a8a;
  font-weight: 700;
}

.availability-table {
  width: 100%;
  min-width: 840px;
  border-collapse: collapse;
}

.availability-table th,
.availability-table td {
  min-width: 100px;
  padding: 5px;
  border-right: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  text-align: center;
}

.availability-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #eef3fa;
  color: #27364d;
  font-size: 12px;
  text-transform: capitalize;
}

.availability-table thead th span,
.availability-table thead th strong {
  display: block;
}

.availability-table thead th strong {
  margin-top: 3px;
  font-size: 14px;
}

.availability-table tbody th {
  position: sticky;
  left: 0;
  background: #f8fafc;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.slot-button {
  width: 100%;
  min-height: 36px;
  padding: 5px;
  border: 1px solid #99f6e4;
  border-radius: 6px;
  background: #f0fdfa;
  color: #0f766e;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}

.slot-button:hover:not(:disabled) {
  border-color: #0f766e;
  background: #ccfbf1;
}

.slot-button.occupied {
  border-color: #fecaca;
  background: #fff1f2;
  color: #b91c1c;
  cursor: not-allowed;
}

.slot-button.selected {
  border-color: #2563eb;
  background: #dbeafe;
  color: #1d4ed8;
}

.slot-button:disabled:not(.occupied) {
  border-color: #e2e8f0;
  background: #f1f5f9;
  color: #94a3b8;
  cursor: not-allowed;
}

.calendar-footer {
  justify-content: flex-end;
  margin-top: 16px;
  color: #475569;
  font-size: 12px;
}

.calendar-footer span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 8px;
}

.slot-legend {
  width: 12px;
  height: 12px;
  border: 1px solid #99f6e4;
  border-radius: 3px;
  background: #f0fdfa;
}

.slot-legend.busy {
  border-color: #fecaca;
  background: #fff1f2;
}

.primary-button {
  border-color: transparent;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: white;
  box-shadow: 0 2px 5px rgb(15 23 42 / 10%);
}

.primary-button:hover:not(:disabled) {
  background: #1d4ed8;
}

.primary-button:disabled {
  opacity: 0.65;
  cursor: wait;
}

.state-card {
  color: #334155;
}

.error-card,
.error-message {
  border-color: #fecaca;
  background: #fff7f7;
  color: #991b1b;
}

.error-message {
  margin: 18px 0 0;
  padding: 12px;
  border: 1px solid #fecaca;
  border-radius: 8px;
}

@media (max-width: 700px) {
  .rental-form-page {
    padding: 24px 16px;
  }

  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .title-block h2 {
    font-size: 25px;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .new-booking-fields,
  .selected-slot {
    align-items: stretch;
    flex-direction: column;
  }

  .new-booking-fields .primary-button {
    width: 100%;
  }

  .selected-slot span {
    flex: auto;
  }

  .calendar-backdrop {
    padding: 8px;
  }

  .calendar-modal {
    max-height: 95vh;
    padding: 16px;
  }

  .calendar-header h3 {
    font-size: 18px;
  }

  .week-navigation button {
    font-size: 11px;
  }

  .calendar-footer {
    flex-wrap: wrap;
  }

  .form-section {
    padding: 19px;
  }
}
</style>
