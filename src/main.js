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
// ket4tec: тост в звонке стоит под верхней панелью звонка — при появлении тоста замеряем её низ (k7ui.scss, --k7-toast-top)
new MutationObserver((muts) => {
	if (!muts.some((m) => [...m.addedNodes].some((n) => n.classList?.contains('toastify')))) {
		return
	}
	const bar = document.querySelector('.top-bar--in-call')
	if (bar) {
		document.documentElement.style.setProperty('--k7-toast-top', Math.round(bar.getBoundingClientRect().bottom + 8) + 'px')
	}
}).observe(document.body, { childList: true })
// ket4tec: шторки не уходят под нижнюю панель Safari. --k7-vv-gap — сколько низа страницы закрыто (visualViewport),
// html.k7-ios-bar — iPhone в Safari (не на экране «Домой»). Развёрнутая панель iOS 26 стоит под страницей (вьюпорт кончается над ней),
// свёрнутая плавает пилюлей поверх низа — тогда вьюпорт почти во весь экран и нужен отступ --k7-ios-pill.
// ponytail: эвристика по screen.height - innerHeight (порог 120), заменить, если Safari даст env() для своей панели
{
	const root = document.documentElement
	const vv = window.visualViewport
	const ios = /iP(hone|od)/.test(navigator.userAgent) && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches
	const setGap = () => {
		// --k7-vh — высота области fixed-слоёв: в iOS 26 Safari 100dvh больше неё (считает и место под панелью), шторка уходила под панель
		root.style.setProperty('--k7-vh', `${window.innerHeight}px`)
		root.style.setProperty('--k7-vv-gap', `${Math.max(0, Math.round(window.innerHeight - (vv ? vv.height + vv.offsetTop : window.innerHeight)))}px`)
		if (ios) root.style.setProperty('--k7-ios-pill', screen.height - window.innerHeight < 120 ? '64px' : '0px')
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
