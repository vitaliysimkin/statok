import { createApp } from 'vue'
import { addCollection } from '@iconify/vue'
import { icons as systemUicons } from '@iconify-json/system-uicons'
import '@vitaliysimkin/t-components/style.css'
import './styles/theme.css'
import App from './App.vue'
import router from './router'
import i18n from './i18n'

// Register system-uicons offline so the kit's Icon never fetches api.iconify.design
// (NFR-01). @iconify/vue is a single shared instance, so this collection is visible
// to the kit's <Icon> too. Must run before mount.
addCollection(systemUicons)

const app = createApp(App)

app.use(router)
app.use(i18n)

app.mount('#app')
