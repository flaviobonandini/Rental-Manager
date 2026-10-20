<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '../utils/authFetch'

interface Rental {
  id: number
  service_id?: number
  service_name?: string | null
  product_id?: number
  product_name?: string | null
  user_owner_id: number
  owner_nome: string | null
  owner_cognome: string | null
  owner_username: string | null
  rental_number: string
  rental_start_date: string
  rental_stop_date: string
  status: string
  notes: string | null
  created_at: string
  updated_at: string
}

const props = withDefaults(defineProps<{ product?: boolean }>(), {
  product: false,
})
const isProductBooking = computed(() => props.product)
const rentals = ref<Rental[]>([])
const route = useRoute()
const router = useRouter()
const notificationMessage = ref('')
let notificationTimer: ReturnType<typeof setTimeout> | null = null
const isAdministrator = computed(() => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    const role = String(user?.role || '').toLowerCase()
    return role === 'admin' || role === 'superadmin'
  } catch {
    return false
  }
})
const loading = ref(true)
const error = ref('')
const search = ref('')
const itemsPerPage = ref(10)
const currentPage = ref(1)
const sortKey = ref<keyof Rental>('rental_start_date')
const sortDirection = ref<'asc' | 'desc'>('desc')

function errorMessage(value: unknown) {
  return value instanceof Error
    ? value.message
    : 'Error loading bookings'
}

function showNotification(message: string) {
  notificationMessage.value = message
  if (notificationTimer) clearTimeout(notificationTimer)
  notificationTimer = setTimeout(() => {
    notificationMessage.value = ''
    notificationTimer = null
  }, 3200)
}

function closeNotification() {
  notificationMessage.value = ''
  if (notificationTimer) {
    clearTimeout(notificationTimer)
    notificationTimer = null
  }
}

async function loadRentals() {
  loading.value = true
  error.value = ''

  try {
    const response = await authFetch(isProductBooking.value ? '/api/rental-products' : '/api/rentals')
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Unable to load bookings.')
    }

    if (!Array.isArray(data)) {
      throw new Error('The server response does not contain a list of bookings.')
    }

    rentals.value = data
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    loading.value = false
  }
}

const filteredRentals = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('en')

  if (!query) {
    return rentals.value
  }

  return rentals.value.filter((rental) =>
    [
      rental.rental_number,
        isProductBooking.value ? rental.product_name : rental.service_name,
        isProductBooking.value ? rental.product_id : rental.service_id,
      rental.owner_nome,
      rental.owner_cognome,
      rental.owner_username,
      rental.user_owner_id,
      rental.status,
      rental.notes,
    ].some((value) => String(value ?? '').toLocaleLowerCase('en').includes(query)),
  )
})

const sortedRentals = computed(() =>
  [...filteredRentals.value].sort((a, b) => {
    const left = a[sortKey.value] ?? ''
    const right = b[sortKey.value] ?? ''
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right), 'en', {
          numeric: true,
          sensitivity: 'base',
        })

    return sortDirection.value === 'asc' ? comparison : -comparison
  }),
)

const totalPages = computed(() =>
  Math.ceil(sortedRentals.value.length / itemsPerPage.value),
)

const visibleRentals = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value
  return sortedRentals.value.slice(start, start + itemsPerPage.value)
})

watch([search, itemsPerPage], () => {
  currentPage.value = 1
})

function sortBy(key: keyof Rental) {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDirection.value = 'asc'
  }

  currentPage.value = 1
}

function sortIndicator(key: keyof Rental) {
  if (sortKey.value !== key) return ''
  return sortDirection.value === 'asc' ? '↑' : '↓'
}

function formatDate(value: string | null) {
  if (!value) return '—'

  if (isProductBooking.value) {
    const date = new Date(`${value.slice(0, 10)}T00:00:00`)
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat('en-US', { dateStyle: 'short' }).format(date)
  }

  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized)

  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function statusClass(status: string) {
  const normalized = status.toUpperCase()
  if (['CONFIRMED'].includes(normalized)) {
    return 'positive'
  }
  if (['REJECTED'].includes(normalized)) {
    return 'negative'
  }
  if (['REQUEST'].includes(normalized)) {
    return 'pending'
  }
  return 'neutral'
}

function printRentals() {
  window.print()
}

async function deleteRental(rental: Rental) {
  if (!window.confirm(`Delete the booking "${rental.rental_number}"?`)) {
    return
  }

  try {
    const endpoint = isProductBooking.value ? '/api/rental-products' : '/api/rentals'
    const response = await authFetch(`${endpoint}/${rental.id}`, {
      method: 'DELETE',
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Unable to delete the booking.')
    }

    rentals.value = rentals.value.filter((item) => item.id !== rental.id)
    if (currentPage.value > 1 && visibleRentals.value.length === 0) {
      currentPage.value--
    }
  } catch (cause) {
    window.alert(errorMessage(cause))
  }
}

async function duplicateRental(rental: Rental) {
  if (!window.confirm(`Create a new booking similar to "${rental.rental_number}"? You will be able to choose a new available time.`)) {
    return
  }

  await router.push({
    path: isProductBooking.value ? '/bookings-product/new' : '/bookings-service/new',
    query: {
      [isProductBooking.value ? 'product_id' : 'service_id']: String(
        isProductBooking.value ? rental.product_id : rental.service_id,
      ),
      user_owner_id: String(rental.user_owner_id),
      notes: rental.notes || '',
    },
  })
}

onMounted(() => {
  const saved = route.query.saved
  if (saved === 'created' || saved === 'updated') {
    const bookingType = isProductBooking.value ? 'Product booking' : 'Service booking'
    showNotification(`${bookingType} ${saved} successfully.`)
    void router.replace({ query: { ...route.query, saved: undefined } })
  }
  void loadRentals()
})

onUnmounted(() => {
  if (notificationTimer) clearTimeout(notificationTimer)
})
</script>

<template>
  <section class="bookings-page">
    <Transition name="toast">
      <div
        v-if="notificationMessage"
        class="notification-toast"
        role="status"
        aria-live="polite"
      >
        <span class="notification-icon" aria-hidden="true">✓</span>
        <span>{{ notificationMessage }}</span>
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

    <header class="page-header">
      <div class="title-block">
        <h2>{{ isProductBooking ? 'Product bookings' : 'Service bookings' }}</h2>
        <p class="booking-count">
          {{ filteredRentals.length }}
          {{ filteredRentals.length === 1 ? 'booking' : 'bookings' }}
        </p>
      </div>

      <div class="header-actions">
        <button
          type="button"
          class="new-booking-button"
          @click="router.push(isProductBooking ? '/bookings-product/new' : '/bookings-service/new')"
        >
          {{ isProductBooking ? '+ New Product Booking' : '+ New Booking' }}
        </button>
        <label class="page-size">
          <span>Show</span>
          <select v-model.number="itemsPerPage" aria-label="Bookings per page">
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
          </select>
        </label>

        <input
          v-model="search"
          class="search-input"
          type="search"
          :placeholder="`Search by number, ${isProductBooking ? 'product' : 'service'}, status...`"
          aria-label="Search bookings"
        />

        <button type="button" class="print-button" @click="printRentals">
          Print
        </button>
        <button type="button" class="refresh-button" :disabled="loading" @click="loadRentals">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="state-card" role="status">
      {{ isProductBooking ? 'Loading product bookings...' : 'Loading bookings...' }}
    </div>

    <div v-else-if="error" class="state-card error-card" role="alert">
      <p>{{ error }}</p>
      <button type="button" class="refresh-button" @click="loadRentals">Retry</button>
    </div>

    <div v-else class="table-container">
      <table>
        <thead>
          <tr>
            <th class="sortable" scope="col" @click="sortBy('rental_number')">
              Number <span>{{ sortIndicator('rental_number') }}</span>
            </th>
            <th class="sortable" scope="col" @click="sortBy(isProductBooking ? 'product_name' : 'service_name')">
              {{ isProductBooking ? 'Product' : 'Service' }}
              <span>{{ sortIndicator(isProductBooking ? 'product_name' : 'service_name') }}</span>
            </th>
            <th class="sortable" scope="col" @click="sortBy('rental_start_date')">
              Start <span>{{ sortIndicator('rental_start_date') }}</span>
            </th>
            <th class="sortable" scope="col" @click="sortBy('rental_stop_date')">
              End <span>{{ sortIndicator('rental_stop_date') }}</span>
            </th>
            <th class="sortable" scope="col" @click="sortBy('status')">
              Status <span>{{ sortIndicator('status') }}</span>
            </th>
            <th class="sortable" scope="col" @click="sortBy('owner_cognome')">
              Owner <span>{{ sortIndicator('owner_cognome') }}</span>
            </th>
            <th v-if="isAdministrator" class="actions-column" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rental in visibleRentals" :key="rental.id">
            <td class="rental-number">{{ rental.rental_number }}</td>
            <td class="service-name">
              {{ isProductBooking
                ? rental.product_name || `Product #${rental.product_id}`
                : rental.service_name || `Service #${rental.service_id}` }}
            </td>
            <td>{{ formatDate(rental.rental_start_date) }}</td>
            <td>{{ formatDate(rental.rental_stop_date) }}</td>
            <td>
              <span class="status-badge" :class="statusClass(rental.status)">
                {{ rental.status }}
              </span>
            </td>
            <td class="owner-cell">
              <strong v-if="rental.owner_nome || rental.owner_cognome">
                {{ [rental.owner_nome, rental.owner_cognome].filter(Boolean).join(' ') }}
              </strong>
              <strong v-else>{{ rental.owner_username || `User #${rental.user_owner_id}` }}</strong>
              <span v-if="rental.owner_username && (rental.owner_nome || rental.owner_cognome)">
                {{ rental.owner_username }}
              </span>
            </td>
            <td v-if="isAdministrator" class="actions">
              <button
                type="button"
                class="action-button view"
                title="View"
                aria-label="View booking"
                @click="router.push(`${isProductBooking ? '/bookings-product' : '/bookings-service'}/view/${rental.id}`)"
              >
                👁
              </button>
              <button
                type="button"
                class="action-button edit"
                title="Edit"
                aria-label="Edit booking"
                @click="router.push(`${isProductBooking ? '/bookings-product' : '/bookings-service'}/edit/${rental.id}`)"
              >
                ✏️
              </button>
              <button
                type="button"
                class="action-button copy"
                title="Duplicate"
                aria-label="Duplicate booking"
                @click="duplicateRental(rental)"
              >
                📋
              </button>
              <button
                type="button"
                class="action-button delete"
                title="Delete"
                aria-label="Delete booking"
                @click="deleteRental(rental)"
              >
                🗑
              </button>
            </td>
          </tr>
          <tr v-if="visibleRentals.length === 0">
            <td :colspan="isAdministrator ? 7 : 6" class="empty-state">
              {{ search
                ? 'No bookings match your search.'
                : isProductBooking ? 'No product bookings available.' : 'No bookings available.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="!loading && !error && totalPages > 1" class="pagination" aria-label="Bookings pagination">
      <button type="button" :disabled="currentPage === 1" @click="currentPage--">
        Previous
      </button>
      <button
        v-for="page in totalPages"
        :key="page"
        type="button"
        class="page-number"
        :class="{ active: currentPage === page }"
        :aria-current="currentPage === page ? 'page' : undefined"
        @click="currentPage = page"
      >
        {{ page }}
      </button>
      <button type="button" :disabled="currentPage === totalPages" @click="currentPage++">
        Next
      </button>
    </nav>

    <article class="print-list">
      <header>
        <div>
          <h1>{{ isProductBooking ? 'PRODUCT BOOKINGS' : 'SERVICE BOOKINGS' }}</h1>
          <p>
            {{ sortedRentals.length }}
            {{ sortedRentals.length === 1 ? 'booking' : 'bookings' }}
          </p>
        </div>
        <p>{{ new Date().toLocaleDateString('en-US') }}</p>
      </header>
      <table>
        <thead>
          <tr>
            <th>Number</th>
            <th>{{ isProductBooking ? 'Product' : 'Service' }}</th>
            <th>Start</th>
            <th>End</th>
            <th>Status</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rental in sortedRentals" :key="rental.id">
            <td>{{ rental.rental_number }}</td>
            <td>{{ isProductBooking
              ? rental.product_name || `Product #${rental.product_id}`
              : rental.service_name || `Service #${rental.service_id}` }}</td>
            <td>{{ formatDate(rental.rental_start_date) }}</td>
            <td>{{ formatDate(rental.rental_stop_date) }}</td>
            <td>{{ rental.status }}</td>
            <td>{{ [rental.owner_nome, rental.owner_cognome].filter(Boolean).join(' ') || rental.owner_username || `User #${rental.user_owner_id}` }}</td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>

<style scoped>
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
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  background: #f0fdf4;
  box-shadow: 0 12px 30px rgb(15 23 42 / 14%);
  color: #166534;
  font-size: 14px;
  font-weight: 600;
}

.notification-icon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #22c55e;
  color: white;
  font-size: 14px;
  font-weight: 800;
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
  background: rgb(0 0 0 / 6%);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.bookings-page {
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
  line-height: 1.2;
}

.booking-count {
  display: inline-flex;
  min-height: 25px;
  align-items: center;
  margin: 9px 0 0;
  padding: 2px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: #eff6ff;
  color: #1e40af;
  font-size: 12px;
  font-weight: 700;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-size {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #374151;
  font-size: 14px;
  font-weight: 600;
}

.page-size select,
.search-input {
  min-height: 40px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
  color: #111827;
  box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
}

.page-size select {
  padding: 8px;
}

.search-input {
  width: 260px;
  padding: 9px 12px;
}

.search-input::placeholder {
  color: #64748b;
}

.search-input:focus,
.page-size select:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgb(37 99 235 / 14%);
}

.print-button,
.refresh-button,
.new-booking-button {
  min-height: 40px;
  padding: 9px 15px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
  color: #1e40af;
  font-weight: 650;
  box-shadow: 0 2px 5px rgb(15 23 42 / 8%);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.refresh-button {
  border-color: transparent;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: white;
}

.new-booking-button {
  border-color: transparent;
  background: linear-gradient(135deg, #0f766e, #0d9488);
  color: white;
}

.print-button:hover,
.refresh-button:hover:not(:disabled),
.new-booking-button:hover {
  transform: translateY(-1px);
}

.print-button:hover {
  border-color: #93c5fd;
  background: #eff6ff;
}

.refresh-button:hover:not(:disabled) {
  background: #1d4ed8;
}

.new-booking-button:hover {
  background: #0f766e;
}

.refresh-button:disabled {
  opacity: 0.65;
  cursor: wait;
}

.table-container {
  overflow: auto;
  border: 1px solid #dbe2ec;
  border-radius: 12px;
  background: white;
  box-shadow: 0 8px 24px rgb(15 23 42 / 7%);
}

table {
  width: 100%;
  min-width: 900px;
  border: 0;
  border-collapse: separate;
  border-spacing: 0;
}

th,
td {
  padding: 14px 13px;
  border-bottom: 1px solid #e8edf4;
  color: #263247;
  text-align: left;
  white-space: nowrap;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #e9eff8;
  color: #24344f;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.035em;
  text-transform: uppercase;
}

.sortable {
  cursor: pointer;
  user-select: none;
}

.sortable:hover {
  background: #dce7f5;
}

.sortable span {
  color: #1d4ed8;
}

tbody tr:nth-child(even) {
  background: #f8fafd;
}

tbody tr:hover {
  background: #edf5ff;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.rental-number {
  color: #172554;
  font-weight: 700;
}

.service-name {
  color: #1e3a8a;
  font-weight: 650;
}

.owner-column {
  text-align: center;
}

.owner-cell {
  min-width: 155px;
}

.owner-cell strong,
.owner-cell span {
  display: block;
}

.owner-cell strong {
  color: #172554;
  font-weight: 700;
}

.owner-cell span {
  margin-top: 2px;
  color: #64748b;
  font-size: 12px;
}

.actions-column {
  width: 170px;
  text-align: center;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.action-button {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  background: white;
  color: #27364d;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.action-button:hover {
  background: #f1f5f9;
}

.action-button.view:hover {
  border-color: #2563eb;
}

.action-button.edit:hover {
  border-color: #f59e0b;
}

.action-button.copy:hover {
  border-color: #7c3aed;
}

.action-button.delete:hover {
  border-color: #dc2626;
  background: #fff7f7;
}

.status-badge {
  display: inline-flex;
  min-height: 25px;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.status-badge.positive {
  background: #dcfce7;
  color: #14532d;
}

.status-badge.negative {
  background: #fee2e2;
  color: #7f1d1d;
}

.status-badge.pending {
  background: #fef3c7;
  color: #78350f;
}

.status-badge.neutral {
  background: #e2e8f0;
  color: #334155;
}

.empty-state {
  padding: 42px 24px;
  color: #475569;
  font-weight: 600;
  text-align: center;
}

.state-card {
  padding: 20px;
  border: 1px solid #dbe2ec;
  border-radius: 10px;
  background: white;
  color: #334155;
  box-shadow: 0 4px 14px rgb(15 23 42 / 5%);
}

.error-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-color: #fecaca;
  background: #fff7f7;
  color: #991b1b;
}

.error-card p {
  margin: 0;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin-top: 20px;
}

.pagination button {
  min-width: 38px;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: white;
  color: #27364d;
  font-weight: 600;
  cursor: pointer;
}

.pagination button:hover:not(:disabled) {
  background: #f1f5f9;
}

.pagination button.active {
  border-color: #1d4ed8;
  background: #1d4ed8;
  color: white;
}

.pagination button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.print-list {
  display: none;
}

@media (max-width: 1000px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .search-input {
    flex: 1;
    min-width: 220px;
  }
}

@media (max-width: 600px) {
  .bookings-page {
    padding: 24px 16px;
  }

  .title-block h2 {
    font-size: 25px;
  }

  .header-actions {
    gap: 8px;
  }

  .search-input {
    min-width: 100%;
  }
}

@page {
  size: A4 landscape;
  margin: 12mm;
}

@media print {
  :global(body *) {
    visibility: hidden !important;
  }

  .print-list,
  .print-list * {
    visibility: visible !important;
  }

  .bookings-page {
    min-height: 0;
    padding: 0;
  }

  .print-list {
    display: block !important;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    color: #111;
    background: white;
    font: 9pt Arial, sans-serif;
  }

  .print-list header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
    padding-bottom: 8px;
    border-bottom: 1px solid #999;
  }

  .print-list table {
    width: 100%;
    min-width: 0;
    border-collapse: collapse;
  }

  .print-list th,
  .print-list td {
    position: static;
    padding: 6px 7px;
    border: 1px solid #bbb;
    background: white;
    color: black;
    text-align: left;
    text-transform: none;
    vertical-align: top;
  }

  .print-list th {
    background: #f3f4f6 !important;
    font-weight: 700;
  }

  .print-list tr {
    break-inside: avoid;
  }
}
</style>
