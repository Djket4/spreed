/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getRequestToken } from '@nextcloud/auth'
// Журнал действий в звонке (отладка). Пишет на сервер пачками, вне звонка - no-op.
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'

const MAX_BUF = 500
const MAX_POST = 300 // сервер принимает до 300 событий за запрос (K4DrawController::log)
const FLUSH_MS = 4000
const tab = Math.random().toString(36).slice(2, 8)

let token = null
let buf = []
let timer = null
let lastResize = 0

const cut = (v, n) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, n)

/**
 *
 * @param ev
 */
function push(ev) {
	buf.push(ev)
	if (buf.length > MAX_BUF) {
		buf = buf.slice(-MAX_BUF)
	}
}

/**
 *
 */
function url() {
	return generateOcsUrl('apps/spreed/api/v1/k4draw/{token}/log', { token })
}

/**
 *
 */
function flush() {
	if (!token || !buf.length) {
		return
	}
	const ev = buf.splice(0, MAX_POST)
	const room = token
	axios.post(url(), { s: tab, ev }).catch((e) => {
		// вернуть в очередь — только при обрыве сети и только в ту же комнату (в событиях имена участников)
		!e.response && room === token && (buf = ev.concat(buf).slice(-MAX_BUF))
	})
}

/**
 *
 */
function flushBeacon() {
	if (!token || !buf.length) {
		return
	}
	// весь буфер пачками по MAX_POST, свежие первыми (у keepalive-запросов общий предел ~64 КБ: если не влезет, пропадут старые)
	for (let ev; (ev = buf.splice(-MAX_POST)).length;) {
		try {
			fetch(url(), {
				method: 'POST',
				keepalive: true,
				headers: { 'OCS-APIRequest': 'true', 'Content-Type': 'application/json', requesttoken: getRequestToken() },
				body: JSON.stringify({ s: tab, ev }),
			}).catch(() => {})
		} catch (e) {
			// ignore
		}
	}
}

/**
 *
 * @param k
 * @param d
 */
export function k4log(k, d) {
	if (!token) {
		return
	}
	push({ t: Date.now(), k, d })
}

/**
 *
 * @param e
 */
function onTap(e) {
	const el = e.target?.closest?.('button, [role=button], [role=menuitem], [role=tab], a')
	if (!el) {
		return
	}
	k4log('tap', {
		type: e.type,
		l: cut(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText, 60),
		c: String(el.className?.baseVal ?? el.className ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join(' '),
	})
}
const onError = (e) => k4log('error', { message: cut(e.message, 200), stack: cut(e.error?.stack, 300), src: cut(e.filename, 80), line: e.lineno })
const onRejection = (e) => k4log('unhandledrejection', { message: cut(e.reason?.message ?? e.reason, 200), stack: cut(e.reason?.stack, 300) })
/**
 *
 */
function onVisibility() {
	k4log('visibilitychange', { state: document.visibilityState })
	if (document.visibilityState === 'hidden') {
		flushBeacon()
	}
}
/**
 *
 */
function onPageHide() {
	k4log('pagehide')
	flushBeacon()
}
const onOnline = () => k4log('online')
const onOffline = () => k4log('offline')
/**
 *
 * @param e
 */
function onResize(e) {
	const now = Date.now()
	if (e.type === 'resize' && now - lastResize < 2000) {
		return
	}
	lastResize = now
	k4log(e.type, { w: window.innerWidth, h: window.innerHeight })
}

const listeners = [
	[document, 'click', onTap, true],
	[document, 'pointerup', onTap, true],
	[document, 'visibilitychange', onVisibility, false],
	[window, 'error', onError, false],
	[window, 'unhandledrejection', onRejection, false],
	[window, 'pagehide', onPageHide, false],
	[window, 'online', onOnline, false],
	[window, 'offline', onOffline, false],
	[window, 'orientationchange', onResize, false],
	[window, 'resize', onResize, false],
]

/**
 *
 * @param newToken
 */
export function startK4Log(newToken) {
	if (token === newToken) {
		return
	}
	stopK4Log()
	token = newToken
	listeners.forEach(([t, n, f, c]) => t.addEventListener(n, f, c))
	timer = setInterval(flush, FLUSH_MS)
	const ua = navigator.userAgent
	push({
		t: Date.now(),
		k: 'start',
		d: {
			ua,
			w: window.innerWidth,
			h: window.innerHeight,
			dpr: window.devicePixelRatio,
			standalone: !!window.matchMedia?.('(display-mode: standalone)').matches,
			ios: /iPhone|iPad/.test(ua),
		},
	})
}

/**
 *
 */
export function stopK4Log() {
	if (!token) {
		return
	}
	push({ t: Date.now(), k: 'stop' })
	while (buf.length) {
		flush() // весь буфер пачками по MAX_POST, `stop` — последним
	}
	buf = [] // остаток не уходит в журнал следующей комнаты
	listeners.forEach(([t, n, f, c]) => t.removeEventListener(n, f, c))
	clearInterval(timer)
	timer = null
	token = null
}

// только для тестов
/**
 *
 */
export function _k4buf() {
	return buf
}
