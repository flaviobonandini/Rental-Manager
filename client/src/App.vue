<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import LoginView from './views/LoginView.vue'

const route = useRoute()
const router = useRouter()
const isAuthenticated = ref(false)
const isCheckingSession = ref(true)
const sessionError = ref('')
const isAdministrator = ref(false)
const currentUserName = ref('')

const pageTitle = computed(() => String(route.meta.title || 'Home'))

async function checkSession() {
  sessionError.value = ''
  isCheckingSession.value = true

  const token = localStorage.getItem('token')

  if (!token) {
    isAuthenticated.value = false
    isCheckingSession.value = false
    return
  }

  try {
    const response = await fetch('/api/test-auth', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (response.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      isAuthenticated.value = false
      return
    }

    if (!response.ok) {
      throw new Error('Unable to verify the session')
    }

    const data = await response.json()
    const user = data.user || JSON.parse(localStorage.getItem('user') || 'null')
    const role = String(user?.role || '').toLowerCase()

    isAuthenticated.value = true
    isAdministrator.value = role === 'admin' || role === 'superadmin'
    currentUserName.value = user?.nome
      ? `${user.nome} ${user.cognome || ''}`.trim()
      : user?.username || ''
    localStorage.setItem('user', JSON.stringify(user))
  } catch (error) {
    sessionError.value = error instanceof Error
      ? error.message
      : 'Error while verifying the session'
  } finally {
    isCheckingSession.value = false
  }
}

function handleAuthenticated() {
  isAuthenticated.value = true
  void checkSession()
}

function logout() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  isAuthenticated.value = false
  isAdministrator.value = false
  currentUserName.value = ''
  void router.push('/')
}

function handleAuthExpired() {
  isAuthenticated.value = false
  isAdministrator.value = false
  currentUserName.value = ''
  void router.push('/')
}

onMounted(() => {
  window.addEventListener('auth-expired', handleAuthExpired)
  void checkSession()
})

onUnmounted(() => {
  window.removeEventListener('auth-expired', handleAuthExpired)
})
</script>

<template>
  <main v-if="isCheckingSession" class="session-state">
    Verifying the session...
  </main>

  <LoginView
    v-else-if="!isAuthenticated && !sessionError"
    @authenticated="handleAuthenticated"
  />

  <main v-else-if="sessionError" class="session-state">
    <section class="session-error">
      <p role="alert">{{ sessionError }}</p>
      <button type="button" @click="checkSession">Retry</button>
    </section>
  </main>

  <div v-else class="app-shell">
    <aside class="sidebar">
      <RouterLink class="brand" to="/">
        <span class="brand-mark">R</span>
        <span>Rental</span>
      </RouterLink>

      <p class="menu-caption">MENU</p>
      <nav class="side-navigation" aria-label="Main menu">
        <RouterLink to="/" class="nav-link" exact-active-class="active">
          <span class="nav-icon" aria-hidden="true">⌂</span>
          <span>Home</span>
        </RouterLink>
        <RouterLink to="/bookings-service" class="nav-link" active-class="active">
          <span class="nav-icon" aria-hidden="true">▣</span>
          <span>Service booking </span>
        </RouterLink>
        <RouterLink to="/bookings-product" class="nav-link" active-class="active">
          <span class="nav-icon" aria-hidden="true">▣</span>
          <span>Product booking</span>
        </RouterLink>        
        <RouterLink
          v-if="isAdministrator"
          to="/users"
          class="nav-link"
          active-class="active"
        >
          <span class="nav-icon" aria-hidden="true">♙</span>
          <span>Users</span>
        </RouterLink>
        <RouterLink
          v-if="isAdministrator"
          to="/products"
          class="nav-link"
          active-class="active"
        >
          <span class="nav-icon" aria-hidden="true">▣</span>
          <span>Products</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <div class="user-avatar" aria-hidden="true">
          {{ currentUserName.slice(0, 1).toUpperCase() || 'U' }}
        </div>
        <div class="user-identity">
          <strong>{{ currentUserName || 'User' }}</strong>
          <span>{{ isAdministrator ? 'Administrator' : 'User' }}</span>
        </div>
        <button class="logout-button" type="button" title="Logout" aria-label="Logout" @click="logout">
          ↪
        </button>
      </div>
    </aside>

    <main class="main-panel">
      <header class="topbar">
        <h1>{{ pageTitle }}</h1>
        <span class="topbar-user">{{ currentUserName }}</span>
      </header>
      <div class="page-content">
        <RouterView />
      </div>
    </main>
  </div>
</template>

<style>
:root {
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1f2937;
  background: #f4f6fa;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-weight: 400;
}

* {
  box-sizing: border-box;
}

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  background: #f4f6fa;
}

button,
input,
select {
  font: inherit;
}

.session-state {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 20px;
  color: #6b7280;
}

.session-error {
  max-width: 420px;
  padding: 28px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  text-align: center;
}

.session-error p {
  color: #991b1b;
}

.session-error button {
  padding: 10px 16px;
  color: white;
  background: #2563eb;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.app-shell {
  min-height: 100vh;
}

.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 5;
  display: flex;
  width: 250px;
  flex-direction: column;
  padding: 24px 16px 16px;
  background: #111827;
  color: #f9fafb;
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 10px;
  color: white;
  font-size: 20px;
  font-weight: 700;
  text-decoration: none;
}

.brand-mark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  background: #2563eb;
  font-size: 18px;
}

.menu-caption {
  margin: 42px 10px 12px;
  color: #9ca3af;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.side-navigation {
  display: grid;
  gap: 6px;
}

.nav-link {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-radius: 8px;
  color: #d1d5db;
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-link:hover,
.nav-link.active {
  background: #263449;
  color: white;
}

.nav-link.active {
  box-shadow: inset 3px 0 #60a5fa;
}

.nav-icon {
  width: 20px;
  color: #9ca3af;
  font-size: 18px;
  text-align: center;
}

.nav-link.active .nav-icon {
  color: #93c5fd;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding: 16px 4px 4px;
  border-top: 1px solid #374151;
}

.user-avatar {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: #374151;
  color: #bfdbfe;
  font-weight: 700;
}

.user-identity {
  display: grid;
  min-width: 0;
  gap: 2px;
  flex: 1;
}

.user-identity strong,
.user-identity span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-identity strong {
  color: white;
  font-size: 13px;
}

.user-identity span {
  color: #9ca3af;
  font-size: 11px;
}

.logout-button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #d1d5db;
  font-size: 19px;
  cursor: pointer;
}

.logout-button:hover {
  background: #374151;
  color: white;
}

.main-panel {
  min-height: 100vh;
  margin-left: 250px;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  min-height: 68px;
  align-items: center;
  justify-content: space-between;
  padding: 0 30px;
  border-bottom: 1px solid #e5e7eb;
  background: rgba(255, 255, 255, 0.96);
}

.topbar h1 {
  margin: 0;
  color: #111827;
  font-size: 18px;
  font-weight: 650;
}

.topbar-user {
  color: #6b7280;
  font-size: 13px;
}

.page-content {
  min-height: calc(100vh - 68px);
}

@media (max-width: 700px) {
  .sidebar {
    inset: auto 0 0;
    width: auto;
    height: 68px;
    flex-direction: row;
    align-items: center;
    justify-content: space-around;
    padding: 6px 8px;
  }

  .brand,
  .menu-caption,
  .sidebar-footer {
    display: none;
  }

  .side-navigation {
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }

  .nav-link {
    min-height: 50px;
    justify-content: center;
    gap: 5px;
    padding: 4px;
    font-size: 11px;
  }

  .nav-link.active {
    box-shadow: inset 0 3px #60a5fa;
  }

  .nav-icon {
    width: auto;
    font-size: 16px;
  }

  .main-panel {
    margin-left: 0;
    padding-bottom: 68px;
  }

  .topbar {
    min-height: 58px;
    padding: 0 20px;
  }

  .topbar-user {
    display: none;
  }
}
</style>
