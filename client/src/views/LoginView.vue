<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  authenticated: []
}>()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const email = ref('')
const nome = ref('')
const cognome = ref('')
const password = ref('')

const loading = ref(false)
const error = ref('')
const localNotice = ref('')

async function submit() {
  error.value = ''
  localNotice.value = ''

  if (
    !username.value ||
    !password.value ||
    (mode.value === 'register' &&
      (!email.value || !nome.value.trim() || !cognome.value.trim()))
  ) {
    error.value = mode.value === 'register'
      ? 'Enter first name, last name, username, email and password'
      : 'Enter username and password'
    return
  }

  if (mode.value === 'register' && password.value.length < 8) {
    error.value = 'Password must contain at least 8 characters'
    return
  }

  try {
    loading.value = true

    const isRegistering = mode.value === 'register'
    const response = await fetch(isRegistering ? '/api/register' : '/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: username.value,
        password: password.value,
        ...(isRegistering
          ? {
              email: email.value,
              nome: nome.value.trim(),
              cognome: cognome.value.trim(),
            }
          : {}),
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || (isRegistering
        ? 'Registration failed'
        : 'Login failed'))
    }

    if (isRegistering) {
      localNotice.value = data.message || 'Registration completed. You can sign in now.'
      mode.value = 'login'
      password.value = ''
      return
    }

    if (!data.token || !data.user) {
      throw new Error('Invalid login response')
    }

    localStorage.setItem(
      'user',
      JSON.stringify(data.user)
    )

    localStorage.setItem(
      'token',
      data.token
    )
    emit('authenticated')

  } catch (err) {
    error.value = err instanceof Error
      ? err.message
      : 'Error during login'
  } finally {
    loading.value = false
  }
}

function switchMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  error.value = ''
  localNotice.value = ''
}
</script>

<template>
  <div class="login-page">

    <div class="login-card">

      <div class="login-header">
        <h1>Booking Manager</h1>
        <p>{{ mode === 'login' ? 'Sign in to your account' : 'Create a new account' }}</p>
      </div>

      <form
        class="login-form"
        @submit.prevent="submit"
      >
        <div v-if="mode === 'register'" class="registration-fields">
          <div class="form-group">
            <label for="nome">First name</label>
            <input
              id="nome"
              v-model="nome"
              type="text"
              autocomplete="given-name"
              placeholder="First name"
              maxlength="100"
              required
            />
          </div>

          <div class="form-group">
            <label for="cognome">Last name</label>
            <input
              id="cognome"
              v-model="cognome"
              type="text"
              autocomplete="family-name"
              placeholder="Last name"
              maxlength="100"
              required
            />
          </div>
        </div>

        <div class="form-group">
          <label for="username">Username</label>
          <input
            id="username"
            v-model="username"
            type="text"
            autocomplete="username"
            placeholder="Username"
            minlength="3"
            maxlength="50"
            required
            autofocus
          />
        </div>

        <div v-if="mode === 'register'" class="form-group">
          <label for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="email"
            placeholder="name@example.com"
            maxlength="150"
            required
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            placeholder="Password"
            :minlength="mode === 'register' ? 8 : undefined"
            maxlength="128"
            required
          />
        </div>

        <div v-if="error" class="error" role="alert">
          {{ error }}
        </div>

        <p v-if="localNotice" class="notice" role="status">
          {{ localNotice }}
        </p>

        <button type="submit" class="login-button" :disabled="loading">
          {{ loading
            ? (mode === 'login' ? 'Signing in...' : 'Registering...')
            : (mode === 'login' ? 'Sign in' : 'Sign up') }}
        </button>
      </form>

      <button
        type="button"
        class="mode-button"
        :disabled="loading"
        @click="switchMode"
      >
        {{ mode === 'login'
          ? 'Don\'t have an account? Sign up'
          : 'Already have an account? Sign in' }}
      </button>
    </div>

  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 20px;

  background: #f3f4f6;
}

.login-card {
  width: 100%;
  max-width: 420px;

  padding: 32px;

  background: white;

  border: 1px solid #e5e7eb;
  border-radius: 12px;

  box-shadow:
    0 10px 30px
    rgba(0, 0, 0, 0.08);
}

.login-header {
  margin-bottom: 28px;

  text-align: center;
}

.login-header h1 {
  margin: 0;

  color: #111827;
}

.login-header p {
  margin: 8px 0 0;

  color: #6b7280;
}

.login-form {
  display: flex;
  flex-direction: column;

  gap: 18px;
}

.registration-fields {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-bottom: 18px;
}

.form-group {
  display: flex;
  flex-direction: column;

  gap: 6px;
}

.form-group label {
  font-size: 14px;
  font-weight: 600;

  color: #374151;
}

.form-group input {
  width: 100%;

  padding: 11px 12px;

  border: 1px solid #d1d5db;
  border-radius: 6px;

  font-size: 14px;
}

.form-group input:focus {
  outline: none;

  border-color: #2563eb;

  box-shadow:
    0 0 0 2px
    rgba(37, 99, 235, 0.1);
}

.login-button {
  width: 100%;

  padding: 11px;

  border: none;
  border-radius: 6px;

  background: #2563eb;
  color: white;

  font-weight: 600;

  cursor: pointer;
}

.login-button:hover:not(:disabled) {
  background: #1d4ed8;
}

.login-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  padding: 10px 12px;

  background: #fee2e2;
  color: #991b1b;

  border-radius: 6px;

  font-size: 14px;
}

.notice {
  margin: 0;
  padding: 10px 12px;
  background: #dcfce7;
  color: #166534;
  border-radius: 6px;
  font-size: 14px;
}

.mode-button {
  display: block;
  margin: 18px auto 0;
  padding: 4px;
  border: 0;
  background: transparent;
  color: #2563eb;
  font-size: 14px;
  cursor: pointer;
}

.mode-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>