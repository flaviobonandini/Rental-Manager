<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { authFetch } from '../utils/authFetch'

interface Service {
  id: number
  name: string | null
  time_type: number
  time_unit: number
  description: string | null
  immagine: string | null
  price: number
  sort_order: number
  active: number
}

const router = useRouter()

const services = ref<Service[]>([])
const imageDialog = ref<HTMLDialogElement | null>(null)
const selectedImage = ref('')
const selectedImageName = ref('')

function openImage(service: Service) {
  if (!service.immagine) return
  selectedImage.value = service.immagine
  selectedImageName.value = service.name || 'Service image'
  imageDialog.value?.showModal()
}

const loading = ref(true)
const error = ref('')

const search = ref('')
const itemsPerPage = ref(10)
const currentPage = ref(1)

const sortKey = ref<keyof Service>('id')
const sortDirection = ref('asc')

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/* =========================================================
   CARICAMENTO UTENTI
========================================================= */
function getLoggedService() {
  const rawService = localStorage.getItem('service')

  if (!rawService) {
    return null
  }

  try {
    return JSON.parse(rawService)
  } catch {
    return null
  }
}

async function deleteService(service: Service) {

  const loggedService = getLoggedService()

  if (
    loggedService &&
    Number(loggedService.id) === Number(service.id)
  ) {
    alert(
      'You cannot delete the service you are currently logged in as.'
    )

    return
  }

  const confirmed = confirm(
    `Would you like to delete service "${service.id}"?`
  )

  if (!confirmed) {
    return
  }

  try {

    const response = await authFetch(
      `/api/services/${service.id}`,
      {
        method: 'DELETE',
      }
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        'Failed to delete the service.'
      )
    }

    services.value = services.value.filter(
      (item) => item.id !== service.id
    )

    if (
      currentPage.value > 1 &&
      visibleServices.value.length === 0
    ) {
      currentPage.value--
    }

    alert('Service deleted successfully.')

  } catch (err) {

    alert(errorMessage(err, 'Failed to delete the service.'))

  }
}

async function loadServices() {
  try {
    loading.value = true
    error.value = ''

    const response = await authFetch('/api/services')
    //const response = await fetch('/api/users')

    if (!response.ok) {
      throw new Error(
        'Failed to load services.'
      )
    }

    services.value = await response.json()

  } catch (err) {
    error.value = errorMessage(err, 'Failed to load services.')

  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadServices()
})

/* =========================================================
   RESET PAGINA
========================================================= */

watch(search, () => {
  currentPage.value = 1
})

watch(itemsPerPage, () => {
  currentPage.value = 1
})

/* =========================================================
   RICERCA
========================================================= */

const filteredServices = computed(() => {
  const text = search.value
    .toLowerCase()
    .trim()

  if (!text) {
    return services.value
  }

  return services.value.filter((service) => {
    return Object.values(service).some((value) =>
      String(value ?? '')
        .toLowerCase()
        .includes(text)
    )
  })
})

/* =========================================================
   ORDINAMENTO
========================================================= */

function sortBy(key: keyof Service) {
  if (sortKey.value === key) {
    sortDirection.value =
      sortDirection.value === 'asc'
        ? 'desc'
        : 'asc'
  } else {
    sortKey.value = key
    sortDirection.value = 'asc'
  }

  currentPage.value = 1
}

const sortedServices = computed(() => {
  return [...filteredServices.value].sort((a, b) => {

    let valueA: string | number = a[sortKey.value] ?? ''
    let valueB: string | number = b[sortKey.value] ?? ''

    if (
      !isNaN(Number(valueA)) &&
      !isNaN(Number(valueB)) &&
      valueA !== '' &&
      valueB !== ''
    ) {
      valueA = Number(valueA)
      valueB = Number(valueB)
    } else {
      valueA = String(valueA).toLowerCase()
      valueB = String(valueB).toLowerCase()
    }

    if (valueA < valueB) {
      return sortDirection.value === 'asc'
        ? -1
        : 1
    }

    if (valueA > valueB) {
      return sortDirection.value === 'asc'
        ? 1
        : -1
    }

    return 0
  })
})

/* =========================================================
   PAGINAZIONE
========================================================= */

const totalPages = computed(() => {
  return Math.ceil(
    filteredServices.value.length /
    itemsPerPage.value
  )
})

const visibleServices = computed(() => {

  const start =
    (currentPage.value - 1) *
    itemsPerPage.value

  const end =
    start + itemsPerPage.value

  return sortedServices.value.slice(
    start,
    end
  )
})

function previousPage() {
  if (currentPage.value > 1) {
    currentPage.value--
  }
}

function nextPage() {
  if (
    currentPage.value <
    totalPages.value
  ) {
    currentPage.value++
  }
}

function goToPage(page: number) {
  currentPage.value = page
}

function printServices() {
  window.print()
}

/* =========================================================
   DATE
========================================================= */

function formatDate(value: string | null) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('en-US')
}

async function duplicateService(service: Service) {

  const confirmed = confirm(
    `Would you like to duplicate service "${service.name}"?`
  )

  if (!confirmed) {
    return
  }

  try {

    const response = await authFetch(
      `/api/services/${service.id}/copy`,
      {
        method: 'POST',
      }
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data.message ||
        'Failed to duplicate the service.'
      )
    }

    alert(
      `Service duplicated successfully.\n\n` +
      `Update the name.`
    )

    router.push(
      `/services/edit/${data.id}`
    )

  } catch (err) {

    alert(errorMessage(err, 'Failed to duplicate the service.'))

  }
}

</script>

<template>
  <div class="page">

    <!-- HEADER -->
    <div class="page-header">

      <div>
        <h1>Services</h1>

        <p class="service-count">
          {{ filteredServices.length }}
          {{
            filteredServices.length === 1
              ? 'service'
              : 'services'
          }}
        </p>
      </div>


      <div class="header-actions">

        <!-- NUMERO RIGHE -->
        <div class="page-size">

          <span>Show</span>

          <select
            v-model.number="itemsPerPage"
          >
            <option :value="5">
              5
            </option>

            <option :value="10">
              10
            </option>

            <option :value="20">
              20
            </option>

            <option :value="50">
              50
            </option>
          </select>

        </div>


        <!-- RICERCA -->
        <input
          v-model="search"
          type="text"
          class="search-input"
          placeholder="Search services..."
        />

        <button
          type="button"
          class="print-button"
          @click="printServices"
        >
          Print services
        </button>

        <!-- NUOVO -->
        <button
          type="button"
          class="new-button"
          @click="
            router.push('/services/new')
          "
        >
          + New service
        </button>

      </div>

    </div>


    <!-- CARICAMENTO -->
    <div
      v-if="loading"
      class="message"
    >
      Loading...
    </div>


    <!-- ERRORE -->
    <div
      v-else-if="error"
      class="error"
    >
      {{ error }}
    </div>


    <!-- TABELLA -->
    <div
      v-else
      class="table-container"
    >

      <table>

        <thead>
          <tr>

            <th
              class="sortable"
              @click="sortBy('id')"
            >
              ID

              <span v-if="sortKey === 'id'">
                {{
                  sortDirection === 'asc'
                    ? '↑'
                    : '↓'
                }}
              </span>
            </th>


            <th
              class="sortable"
              @click="sortBy('name')"
            >
              Service name

              <span
                v-if="sortKey === 'name'"
              >
                {{
                  sortDirection === 'asc'
                    ? '↑'
                    : '↓'
                }}
              </span>
            </th>


            <th
              class="sortable"
              @click="sortBy('immagine')"
            >
              Image

              <span
                v-if="sortKey === 'immagine'"
              >
                {{
                  sortDirection === 'asc'
                    ? '↑'
                    : '↓'
                }}
              </span>
            </th>

            <th
              class="sortable"
              @click="sortBy('time_type')"
            >
              Time Type

              <span
                v-if="sortKey === 'time_type'"
              >
                {{
                  sortDirection === 'asc'
                    ? '↑'
                    : '↓'
                }}
              </span>
            </th>

            <th
              class="sortable"
              @click="sortBy('time_unit')"
            >
              Time Unit

              <span
                v-if="sortKey === 'time_unit'"
              >
                {{
                  sortDirection === 'asc'
                    ? '↑'
                    : '↓'
                }}
              </span>
            </th>

            
            <th
              class="sortable"
              @click="sortBy('sort_order')"
            >
              sort Order

              <span
                v-if="sortKey === 'sort_order'"
              >
                {{
                  sortDirection === 'asc'
                    ? '↑'
                    : '↓'
                }}
              </span>
            </th>

            <th
              class="sortable"
              @click="sortBy('price')"
            >
              Price

              <span
                v-if="sortKey === 'price'"
              >
                {{
                  sortDirection === 'asc'
                    ? '↑'
                    : '↓'
                }}
              </span>
            </th>

            <th
              class="sortable"
              @click="sortBy('active')"
            >
              Active

              <span
                v-if="sortKey === 'active'"
              >
                {{
                  sortDirection === 'asc'
                    ? '↑'
                    : '↓'
                }}
              </span>
            </th>


            <th class="actions-column">
              Actions
            </th>

          </tr>
        </thead>


        <tbody>

          <tr
            v-for="service in visibleServices"
            :key="service.id"
          >

            <td>
              {{ service.id }}
            </td>

            <td>
              {{ service.name || '—' }}
            </td>

            <td>
              <button
                v-if="service.immagine"
                type="button"
                class="thumbnail-button"
                :aria-label="`Enlarge image: ${service.name}`"
                aria-haspopup="dialog"
                @click="openImage(service)"
              >
                <img
                  :src="service.immagine"
                  :alt="service.name || 'Service image'"
                  class="service-thumbnail"
                  loading="lazy"
                />
              </button>
              <span v-else>—</span>
            </td>

            <td>
              {{ service.time_type === 0 ? 'HOUR' : 'DAY' }}
            </td>
            <td>
              {{ service.time_unit || '1' }}
            </td>
            <td>
              {{ service.sort_order || '100' }}
            </td>
            <td>
              {{ service.price || '0' }}
            </td>
            <td>

              <span
                class="status"
                :class="
                  Number(service.active) === 1
                    ? 'active'
                    : 'inactive'
                "
              >
                {{
                  Number(service.active) === 1
                    ? 'Active'
                    : 'Inactive'
                }}
              </span>

            </td>


            <td class="actions">

              <button
                type="button"
                class="action-button view"
                title="View"
                aria-label="View service"
                @click="router.push(`/services/view/${service.id}`)"
              >
                👁
              </button>

              <button
                type="button"
                class="action-button edit"
                title="Edit"
                aria-label="Edit service"
                @click="router.push(`/services/edit/${service.id}`)"
              >
                ✏️
              </button>

              <button
                type="button"
                class="action-button copy"
                title="Duplicate"
                aria-label="Duplicate service"
                @click="duplicateService(service)"
              >
                📋
              </button>

              <button
                type="button"
                class="action-button delete"
                title="Delete"
                aria-label="Delete service"
                @click="deleteService(service)"
              >
                🗑
              </button>

            </td>

          </tr>


          <tr
            v-if="
              visibleServices.length === 0
            "
          >
            <td
              colspan="10"
              class="no-results"
            >
              No Services found
            </td>
          </tr>

        </tbody>

      </table>

    </div>


    <!-- PAGINAZIONE -->
    <div
      v-if="
        !loading &&
        !error &&
        totalPages > 1
      "
      class="pagination"
    >

      <button
        type="button"
        :disabled="
          currentPage === 1
        "
        @click="previousPage"
      >
        ← Previous
      </button>


      <button
        v-for="page in totalPages"
        :key="page"
        type="button"
        class="page-number"
        :class="{
          active:
            currentPage === page
        }"
        @click="goToPage(page)"
      >
        {{ page }}
      </button>


      <button
        type="button"
        :disabled="
          currentPage === totalPages
        "
        @click="nextPage"
      >
        Next →
      </button>

    </div>

  </div>

  <article class="services-print">
    <header class="services-print-header">
      <div>
        <h1>USERS</h1>
        <p>
          {{ sortedServices.length }} services
          <span v-if="search.trim()"> — Search: {{ search.trim() }}</span>
        </p>
      </div>
      <p>{{ new Date().toLocaleDateString('en-GB') }}</p>
    </header>

    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Codice</th>
          <th>Name</th>
          <th>Description</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="service in sortedServices" :key="service.id">
          <td>{{ service.id }}</td>
           <td>{{ service.name || '—' }}</td>
          <td>{{ service.description || '—' }}</td>
          <td>{{ Number(service.active) === 1 ? 'Active' : 'Inactive' }}</td>
        </tr>
        <tr v-if="sortedServices.length === 0">
          <td colspan="9">No services found</td>
        </tr>
      </tbody>
    </table>
  </article>
  <dialog
    ref="imageDialog"
    class="image-dialog"
    aria-label="Enlarged service image"
    @click.self="imageDialog?.close()"
  >
    <div class="image-dialog-content">
      <button
        type="button"
        class="image-dialog-close"
        aria-label="Close image"
        autofocus
        @click="imageDialog?.close()"
      >
        &times;
      </button>
      <img
        v-if="selectedImage"
        :src="selectedImage"
        :alt="selectedImageName"
        class="image-enlarged"
      />
    </div>
  </dialog>
</template>

<style scoped>
.thumbnail-button {
  display: block;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: zoom-in;
}

.thumbnail-button:focus-visible {
  outline: 3px solid #2563eb;
  outline-offset: 3px;
}

.image-dialog {
  position: fixed;
  inset: 0;
  margin: auto;
  max-width: 96vw;
  max-height: 96dvh;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
}

.image-dialog::backdrop {
  background: rgb(15 23 42 / 80%);
}

.image-dialog-content {
  position: relative;
  padding: 48px 16px 16px;
  background: #fff;
}

.image-enlarged {
  display: block;
  max-width: min(1100px, 85vw);
  max-height: 75dvh;
  object-fit: contain;
  margin: auto;
}

.image-dialog-close {
  position: absolute;
  top: 6px;
  right: 8px;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 6px;
  background: #f1f5f9;
  color: #172033;
  font-size: 26px;
  cursor: pointer;
}

.service-thumbnail {
  display: block;
  width: 80px;
  height: 60px;
  object-fit: contain;
  border: 1px solid #dbe2ec;
  border-radius: 6px;
  background: #fff;
}

.page {
  width: 100%;
  padding: 30px;
}


/* =========================
   HEADER
========================= */

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;

  gap: 20px;

  margin-bottom: 20px;
}

.page-header h1 {
  margin: 0;
}

.service-count {
  margin: 5px 0 0;

  color: #6b7280;

  font-size: 14px;
}

.header-actions {
  display: flex;
  align-items: center;

  gap: 12px;
}


/* =========================
   MOSTRA
========================= */

.page-size {
  display: flex;
  align-items: center;

  gap: 7px;

  font-size: 14px;
}

.page-size select {
  padding: 9px;

  border: 1px solid #d1d5db;
  border-radius: 6px;

  background: white;
}


/* =========================
   RICERCA
========================= */

.search-input {
  width: 220px;

  padding: 10px 12px;

  border: 1px solid #d1d5db;
  border-radius: 6px;

  font-size: 14px;
}

.search-input:focus,
.page-size select:focus {
  outline: none;

  border-color: #2563eb;
}


/* =========================
   NUOVO UTENTE
========================= */

.new-button {
  padding: 10px 16px;

  border: 0;
  border-radius: 6px;

  background: #2563eb;
  color: white;

  font-weight: 600;

  cursor: pointer;
}

.new-button:hover {
  background: #1d4ed8;
}

.print-button {
  padding: 10px 16px;

  border: 1px solid #2563eb;
  border-radius: 6px;

  background: white;
  color: #2563eb;

  font-weight: 600;

  cursor: pointer;
}

.print-button:hover {
  background: #eff6ff;
}

.services-print {
  display: none;
}


/* =========================
   TABELLA
========================= */

.table-container {
  width: 100%;

  overflow-x: auto;
}

table {
  width: 100%;

  background: white;

  border-collapse: collapse;

  border: 1px solid #e5e7eb;
}

th,
td {
  padding: 12px;

  border-bottom: 1px solid #e5e7eb;

  text-align: left;

  white-space: nowrap;
}

th {
  background: #f3f4f6;

  font-size: 14px;
}

td {
  font-size: 14px;
}

tbody tr:hover {
  background: #f9fafb;
}


/* =========================
   ORDINAMENTO
========================= */

.sortable {
  cursor: pointer;

  user-select: none;
}

.sortable:hover {
  background: #e5e7eb;
}


/* =========================
   USERNAME
========================= */

.username {
  font-weight: 600;
}


/* =========================
   RUOLO
========================= */

.role-badge {
  display: inline-block;

  padding: 4px 8px;

  border-radius: 20px;

  background: #e0e7ff;
  color: #3730a3;

  font-size: 12px;
  font-weight: 600;
}


/* =========================
   STATO
========================= */

.status {
  display: inline-block;

  padding: 4px 8px;

  border-radius: 20px;

  font-size: 12px;
  font-weight: 600;
}

.status.active {
  background: #dcfce7;
  color: #166534;
}

.status.inactive {
  background: #fee2e2;
  color: #991b1b;
}


/* =========================
   ULTIMO ACCESSO
========================= */

.last-login {
  color: #4b5563;

  font-size: 13px;
}


/* =========================
   AZIONI
========================= */

.actions-column {
  width: 100px;

  text-align: center;
}

.actions {
  display: flex;
  justify-content: center;
  align-items: center;

  gap: 6px;
}

.action-button {
  width: 34px;
  height: 34px;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px solid #d1d5db;
  border-radius: 6px;

  background: white;

  cursor: pointer;

  font-size: 15px;
}

.action-button:hover {
  background: #f3f4f6;
}

.action-button.view:hover {
  border-color: #2563eb;
}

.action-button.edit:hover {
  border-color: #f59e0b;
}


/* =========================
   PAGINAZIONE
========================= */

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;

  gap: 6px;

  margin-top: 20px;
}

.pagination button {
  min-width: 38px;
  height: 38px;

  padding: 0 12px;

  border: 1px solid #d1d5db;
  border-radius: 6px;

  background: white;
  color: #374151;

  cursor: pointer;
}

.pagination button:hover:not(:disabled) {
  background: #f3f4f6;
}

.pagination button.active {
  background: #2563eb;
  border-color: #2563eb;

  color: white;
}

.pagination button:disabled {
  opacity: 0.4;

  cursor: not-allowed;
}


/* =========================
   ALTRO
========================= */

.no-results {
  padding: 30px;

  text-align: center;

  color: #6b7280;
}

.message {
  padding: 20px;
}

.error {
  padding: 15px;

  background: #fee2e2;
  color: #991b1b;

  border-radius: 6px;
}

.page {
  min-height: calc(100vh - 68px);
  padding: 34px clamp(20px, 3vw, 42px);
  color: #172033;
}

.page-header {
  align-items: center;
  margin-bottom: 26px;
}

.page-header h1 {
  color: #111827;
  font-size: 29px;
  font-weight: 750;
  letter-spacing: -0.035em;
  line-height: 1.2;
}

.page-header > div:first-child {
  position: relative;
  padding-left: 16px;
}

.page-header > div:first-child::before {
  position: absolute;
  inset: 3px auto 3px 0;
  width: 4px;
  border-radius: 4px;
  background: linear-gradient(180deg, #3b82f6, #1d4ed8);
  content: '';
}

.service-count {
  display: inline-flex;
  align-items: center;
  min-height: 25px;
  margin-top: 9px;
  padding: 2px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: #eff6ff;
  color: #1e40af;
  font-size: 12px;
  font-weight: 700;
}

.header-actions {
  gap: 10px;
}

.page-size {
  color: #374151;
  font-weight: 600;
}

.page-size select,
.search-input {
  min-height: 40px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #111827;
  box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
}

.search-input {
  width: 240px;
}

.search-input::placeholder {
  color: #64748b;
}

.search-input:focus,
.page-size select:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgb(37 99 235 / 14%);
}

.new-button,
.print-button {
  min-height: 40px;
  border-radius: 8px;
  box-shadow: 0 2px 5px rgb(15 23 42 / 10%);
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.new-button {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
}

.new-button:hover,
.print-button:hover {
  transform: translateY(-1px);
}

.print-button {
  border-color: #cbd5e1;
  color: #1e40af;
}

.print-button:hover {
  border-color: #93c5fd;
  background: #eff6ff;
}

.table-container {
  overflow: auto;
  border: 1px solid #dbe2ec;
  border-radius: 12px;
  background: white;
  box-shadow: 0 8px 24px rgb(15 23 42 / 7%);
}

.table-container table {
  min-width: 980px;
  border: 0;
  border-collapse: separate;
  border-spacing: 0;
}

.table-container th,
.table-container td {
  padding: 14px 13px;
  border-bottom: 1px solid #e8edf4;
  color: #263247;
}

.table-container th {
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

.table-container th:first-child {
  padding-left: 18px;
}

.table-container tbody tr:nth-child(even) {
  background: #f8fafd;
}

.table-container tbody tr:hover {
  background: #edf5ff;
}

.table-container tbody tr:last-child td {
  border-bottom: 0;
}

.table-container .username {
  color: #172554;
  font-weight: 700;
}

.table-container .last-login {
  color: #475569;
}

.role-badge {
  background: #e7edff;
  color: #293a8b;
}

.status.active {
  background: #dcfce7;
  color: #14532d;
}

.status.inactive {
  background: #fee2e2;
  color: #7f1d1d;
}

.action-button {
  border-color: #cbd5e1;
  color: #27364d;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.action-button:hover {
  background: #f1f5f9;
}

.pagination button {
  border-color: #cbd5e1;
  color: #27364d;
  font-weight: 600;
}

.pagination button.active {
  background: #1d4ed8;
  border-color: #1d4ed8;
}

.no-results {
  padding: 42px 24px;
  color: #475569;
  font-weight: 600;
}

.message,
.error {
  border: 1px solid #dbe2ec;
  border-radius: 10px;
  background: white;
  color: #334155;
  box-shadow: 0 4px 14px rgb(15 23 42 / 5%);
}

.error {
  border-color: #fecaca;
  background: #fff7f7;
  color: #991b1b;
}

@media (max-width: 1000px) {
  .page-header {
    gap: 18px;
  }
}

@media (max-width: 600px) {
  .page {
    padding: 24px 16px;
  }

  .page-header h1 {
    font-size: 25px;
  }

  .header-actions {
    gap: 8px;
  }

  .search-input {
    min-width: 100%;
  }
}

.action-button.delete:hover {
  border-color: #dc2626;
}

.action-button.copy:hover {
  border-color: #7c3aed;
}

.action-button.delete:hover {
  border-color: #dc2626;
}

/* =========================
   RESPONSIVE
========================= */

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
    min-width: 180px;
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

  .services-print,
  .services-print * {
    visibility: visible !important;
  }

  .services-print {
    display: block !important;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    color: #111;
    background: white;
    font: 9pt Arial, sans-serif;
  }

  .services-print-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #999;
  }

  .services-print-header h1 {
    margin: 0;
    font-size: 18pt;
  }

  .services-print-header p {
    margin: 5px 0 0;
  }

  .services-print table {
    width: 100%;
    border-collapse: collapse;
  }

  .services-print th,
  .services-print td {
    padding: 6px 7px;
    border: 1px solid #bbb;
    text-align: left;
    vertical-align: top;
  }

  .services-print th {
    background: #f3f4f6 !important;
    font-weight: 700;
  }

  .services-print tr {
    break-inside: avoid;
  }
}
</style>
