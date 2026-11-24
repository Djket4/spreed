/**
 * SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import './utils/k7NoKeyHints.js'
import { getCSPNonce } from '@nextcloud/auth'
import { emit, subscribe } from '@nextcloud/event-bus'
import { generateFilePath } from '@nextcloud/router'
import { createApp, reactive } from 'vue'
import App from './App.vue'
import { initializeTalkOnce } from './init.js'
import { createTalkRouter } from './router/router.ts'
import { SettingsAPI } from './services/SettingsAPI.ts'
import store from './store/index.js'
import pinia from './stores/pinia.ts'
import { useSidebarStore } from './stores/sidebar.ts'
import { initCalllog } from './utils/calllog.js'

initCalllog()
initializeTalkOnce()

// ket4tec: метка форка v7 — тема облака (custom.css) не применяет к нему правила штатного Talk (html:not(.k7f))
document.documentElement.classList.add('k7f')
// ket4tec (NAS_CLOUD#162 п.2): в звонке стопка уведомлений (#k7-toasts) стоит в постоянной полосе под верхней строкой звонка:
// --k7-toast-top = низ строки + 8, --k7-call-top = низ строки + 8 + высота стопки (не меньше одной плашки, 52) + 8 —
// с неё начинаются плитки и доска. В звонке видно не больше двух плашек (html.k7-lane, k7ui.scss), третья вытесняет старшую.
// Сам звонок опрашиваем раз в полсекунды (строка появляется при входе), размеры строки и стопки ловит ResizeObserver.
// ponytail: опрос 500 мс вместо слежки за DOM; заменить, если появится событие входа в звонок на всю страницу.
{
	const root = document.documentElement
	const landscapePhone = window.matchMedia('(max-height: 500px) and (orientation: landscape)') // там своя раскладка (k7call.scss)
	const watched = new Set()
	const ro = new ResizeObserver(() => update())
	/** Пересчитать полосу под уведомления */
	function update() {
		const bar = document.querySelector('.top-bar--in-call')
		const box = document.getElementById('call-container')
		const stack = document.getElementById('k7-toasts')
		for (const el of watched) {
			if (!el.isConnected) {
				ro.unobserve(el)
				watched.delete(el)
			}
		}
		for (const el of [bar, stack]) {
			if (el && !watched.has(el)) {
				watched.add(el)
				ro.observe(el)
			}
		}
		const on = !!(bar && box) && !landscapePhone.matches
		root.classList.toggle('k7-lane', on)
		if (!on) {
			root.style.removeProperty('--k7-toast-top')
			root.style.removeProperty('--k7-call-top')
			root.style.removeProperty('--k7-stack-bottom')
			return
		}
		const bottom = bar.getBoundingClientRect().bottom
		// пока видна хоть одна плашка — полоса сразу под две (52 + 8 + 52), чтобы плитки не меняли размер на второй; выше — по факту
		const shown = stack ? [...stack.children].some((e) => e.offsetHeight) : false
		const stackH = Math.max(shown ? 112 : 52, stack ? stack.getBoundingClientRect().height : 0)
		root.style.setProperty('--k7-toast-top', Math.round(bottom + 8) + 'px')
		root.style.setProperty('--k7-call-top', Math.round(bottom - box.getBoundingClientRect().top + 8 + stackH + 8) + 'px')
		root.style.setProperty('--k7-call-top0', Math.round(bottom - box.getBoundingClientRect().top + 8) + 'px') // без полосы плашек: «один в звонке» — плашка поверх, сцена не ездит (#172)
		root.style.setProperty('--k7-stack-bottom', Math.round(bottom + 8 + stackH + 8) + 'px') // верх окон на телефоне (k7ui.scss)
		// ket4tec (NAS_CLOUD#172, iPhone владельца 16.11): один в звонке — своя камера самым большим квадратом между «Отправить ссылку»
		// и панелью. Отступы по факту: на iPhone шапка выше, и постоянные 170/96 px оставляли плитку ~130 px
		const link = box.classList.contains('k7-alone') && box.querySelector('.empty-call-view__link')
		const vids = link && document.getElementById('videos')
		const panel = vids && box.querySelector(':scope > .bottom-bar')
		if (vids && link.offsetHeight) {
			const v = vids.getBoundingClientRect()
			box.style.setProperty('--k7-alone-top', Math.max(16, Math.round(link.getBoundingClientRect().bottom - v.top + 16)) + 'px')
			box.style.setProperty('--k7-alone-bottom', Math.max(16, Math.round(v.bottom - (panel ? panel.getBoundingClientRect().top : v.bottom) + 16)) + 'px')
		}
	}
	setInterval(update, 500)
	window.addEventListener('resize', update)
	window.addEventListener('k7-layout', update) // CallView: остался один — меряем сразу, а не через до 500 мс (плитка прыгала дважды)
}
// ket4tec: шторки не уходят под нижнюю панель Safari. --k7-vv-gap — сколько низа страницы закрыто (visualViewport),
// html.k7-ios-bar — iPhone в Safari (не на экране «Домой»). Развёрнутая панель iOS 26 стоит под страницей (вьюпорт кончается над ней),
// свёрнутая плавает пилюлей поверх низа — тогда вьюпорт почти во весь экран и нужен отступ --k7-ios-pill.
// ponytail: эвристика по screen.height - innerHeight (порог 120), заменить, если Safari даст env() для своей панели
{
	const root = document.documentElement
	const vv = window.visualViewport
	const iosPillHeight = 64
	const ios = /iP(hone|od)/.test(navigator.userAgent) && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches
	const setGap = () => {
		// --k7-vh — высота области fixed-слоёв: в iOS 26 Safari 100dvh больше неё (считает и место под панелью), шторка уходила под панель
		root.style.setProperty('--k7-vh', `${window.innerHeight}px`)
		const gap = Math.max(0, Math.round(window.innerHeight - (vv ? vv.height + vv.offsetTop : window.innerHeight)))
		root.style.setProperty('--k7-vv-gap', `${gap}px`)
		// NAS_CLOUD#567: keyboard-sized gaps are only used by call sheets while editing a field.
		root.style.setProperty('--k7-call-sheet-gap', `${ios && gap > iosPillHeight ? 0 : gap}px`)
		if (ios) {
			root.style.setProperty('--k7-ios-pill', screen.height - window.innerHeight < 120 ? `${iosPillHeight}px` : '0px')
		}
	}
	setGap()
	vv?.addEventListener('resize', setGap)
	vv?.addEventListener('scroll', setGap)
	window.addEventListener('resize', setGap)
	if (ios) root.classList.add('k7-ios-bar')
}

if (!IS_DESKTOP) {
	// CSP config for webpack dynamic chunk loading
	__webpack_nonce__ = getCSPNonce()

	// Correct the root of the app for chunk loading
	// OC.linkTo matches the apps folders
	// OC.generateUrl ensure the index.php (or not)
	// We do not want the index.php since we're loading files
	__webpack_public_path__ = generateFilePath('spreed', '', 'js/')
}

const router = createTalkRouter()

const instance = createApp(App, { fileInfo: null })
	.use(store)
	.use(pinia)
	.use(router)
	.mount('#content')

// Setup Viewer to be used with Talk sidebar
/**
 *
 * @param sidebarElement
 * @param resolve
 */
function waitForSidebarToBeOpen(sidebarElement, resolve) {
	if ('ontransitionend' in sidebarElement) {
		const resolveOnceSidebarWidthHasChanged = (event) => {
			if (!['min-width', 'width', 'max-width', 'margin-right'].includes(event.propertyName)) {
				return
			}

			sidebarElement.removeEventListener('transitionend', resolveOnceSidebarWidthHasChanged)

			emit('files:sidebar:opened')

			resolve()
		}

		sidebarElement.addEventListener('transitionend', resolveOnceSidebarWidthHasChanged)
	} else {
		const animationQuickValue = getComputedStyle(document.documentElement).getPropertyValue('--animation-quick')

		// The browser does not support the "ontransitionend" event, so just
		// wait a few milliseconds more than the duration of the transition.
		setTimeout(() => {
			console.debug('ontransitionend is not supported; the sidebar should have been fully shown by now')

			emit('files:sidebar:opened')

			resolve()
		}, Number.parseInt(animationQuickValue) + 200)
	}
}

subscribe('viewer:sidebar:open', (node) => {
	const sidebarStore = useSidebarStore()
	// The sidebar is already open, so this can return immediately.
	if (sidebarStore.show) {
		emit('files:sidebar:opened')

		return
	}

	sidebarStore.showSidebar()

	const sidebarElement = document.getElementById('app-sidebar') ?? document.getElementById('app-sidebar-vue')

	// The Viewer adjusts its width to the sidebar width once the sidebar has
	// been opened. The sidebar opens with an animation, so a delay is needed
	// before the width can be properly adjusted.
	return new Promise((resolve, reject) => {
		waitForSidebarToBeOpen(sidebarElement, resolve)
	})
})

// make the instance available to global components that might run on the same page
if (!window.OCA.Talk) {
	window.OCA.Talk = reactive({})
}
OCA.Talk.instance = instance
OCA.Talk.Settings = SettingsAPI

export default instance
