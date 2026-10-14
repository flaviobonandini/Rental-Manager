import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import BookingsView from './views/BookingsView.vue'
import ProductBookingsView from './views/ProductBookingsView.vue'
import UsersView from './views/UsersView.vue'
import UserFormView from './views/UserFormView.vue'
import RentalFormView from './views/RentalFormView.vue'
import ProductRentalFormView from './views/ProductRentalFormView.vue'

function isAdministrator() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    const role = String(user?.role || '').toLowerCase()
    return role === 'admin' || role === 'superadmin'
  } catch {
    return false
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { title: 'Home' },
    },
    {
      path: '/bookings',
      name: 'bookings',
      component: BookingsView,
      meta: { title: 'Service booking' },
    },
    {
      path: '/bookings/new',
      name: 'rental-new',
      component: RentalFormView,
      meta: { title: 'New service booking' },
    },
    {
      path: '/bookings/view/:id',
      name: 'rental-view',
      component: RentalFormView,
      meta: { title: 'Service booking details', requiresAdmin: true },
    },
    {
      path: '/bookings/edit/:id',
      name: 'rental-edit',
      component: RentalFormView,
      meta: { title: 'Modify service booking', requiresAdmin: true },
    },
    {
      path: '/bookingsp',
      name: 'product-bookings',
      component: ProductBookingsView,
      meta: { title: 'Product booking' },
    },
    {
      path: '/bookingsp/new',
      name: 'product-rental-new',
      component: ProductRentalFormView,
      meta: { title: 'New product booking' },
    },
    {
      path: '/bookingsp/view/:id',
      name: 'product-rental-view',
      component: ProductRentalFormView,
      meta: { title: 'Product booking details', requiresAdmin: true },
    },
    {
      path: '/bookingsp/edit/:id',
      name: 'product-rental-edit',
      component: ProductRentalFormView,
      meta: { title: 'Modify product booking', requiresAdmin: true },
    },
    {
      path: '/users',
      name: 'users',
      component: UsersView,
      meta: { title: 'Users', requiresAdmin: true },
    },
    {
      path: '/users/new',
      name: 'user-new',
      component: UserFormView,
      meta: { title: 'New user', requiresAdmin: true },
    },
    {
      path: '/users/edit/:id',
      name: 'user-edit',
      component: UserFormView,
      meta: { title: 'Edit User', requiresAdmin: true },
    },
    {
      path: '/users/view/:id',
      name: 'user-view',
      component: UserFormView,
      meta: { title: 'User details', requiresAdmin: true },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAdmin && !isAdministrator()) {
    return { name: 'home' }
  }
})

export default router
