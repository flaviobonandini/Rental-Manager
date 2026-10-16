import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import BookingsView from './views/BookingsView.vue'
import ProductBookingsView from './views/ProductBookingsView.vue'
import UsersView from './views/UsersView.vue'
import UserFormView from './views/UserFormView.vue'
import ProductsView from './views/ProductsView.vue'
import ProductFormView from './views/ProductFormView.vue'  //ATTENTION: This is a temporary fix. The correct component should be ProductFormView, but it is currently not implemented.
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
      path: '/bookings-service',
      name: 'bookings',
      component: BookingsView,
      meta: { title: 'Service booking' },
    },
    {
      path: '/bookings-service/new',
      name: 'rental-new',
      component: RentalFormView,
      meta: { title: 'New service booking' },
    },
    {
      path: '/bookings-service/view/:id',
      name: 'rental-view',
      component: RentalFormView,
      meta: { title: 'Service booking details', requiresAdmin: true },
    },
    {
      path: '/bookings-service/edit/:id',
      name: 'rental-edit',
      component: RentalFormView,
      meta: { title: 'Modify service booking', requiresAdmin: true },
    },
    {
      path: '/bookings-product',
      name: 'product-bookings',
      component: ProductBookingsView,
      meta: { title: 'Product booking' },
    },
    {
      path: '/bookings-product/new',
      name: 'product-rental-new',
      component: ProductRentalFormView,
      meta: { title: 'New product booking' },
    },
    {
      path: '/bookings-product/view/:id',
      name: 'product-rental-view',
      component: ProductRentalFormView,
      meta: { title: 'Product booking details', requiresAdmin: true },
    },
    {
      path: '/bookings-product/edit/:id',
      name: 'product-rental-edit',
      component: ProductRentalFormView,
      meta: { title: 'Modify product booking', requiresAdmin: true },
    },
    {
      path: '/products',
      name: 'products',
      component: ProductsView,
      meta: { title: 'Products', requiresAdmin: true },
    },
    {
      path: '/products/new',
      name: 'product-new',
      component: ProductFormView,
      meta: { title: 'New product', requiresAdmin: true },
    },
    {
      path: '/products/edit/:id',
      name: 'product-edit',
      component: ProductFormView,
      meta: { title: 'Edit Product', requiresAdmin: true },
    },
    {
      path: '/products/view/:id',
      name: 'product-view',
      component: ProductFormView,
      meta: { title: 'Product details', requiresAdmin: true },
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
