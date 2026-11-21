import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { initDisplayPrefs } from './lib/display-prefs.js'

initDisplayPrefs()
mount(App, { target: document.getElementById('app') })
