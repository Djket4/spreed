/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec: постоянный журнал звонков (NAS_CLOUD#163, этап 2). Технические события клиента -> сервер, пачками.
// Без имён, текстов, названий устройств и IP. Любой сбой молча глотается: журнал не должен влиять на звонок.
import { getRequestToken } from '@nextcloud/auth'
import { generateOcsUrl } from '@nextcloud/router'

const MAX_BUF = 200
const MAX_POST = 50 // столько принимает сервер за запрос
const FLUSH_MS = 5000

let token = null
let sid = null
let buf = []
let timer = null
let preTimer = null
let started = false
let screenOn = false
let paused = false // после 403 (сессия устарела) не шлём до следующего calllogSession
let sessionSent = false
const cid = Array.from({ length: 5 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
// события, которые можно отдать до входа в комнату (список сервера для /pre)
const PRE = ['page_load', 'join_click', 'join_blocked', 'gum_err', 'js_error', 'pagehide', 'net']
const MAX_PRE = 20
const PRE_MS = 15000
const tries = {}

const cut = (v, n) => (v === null || v === undefined ? '' : String(v)).split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * Записать событие. Безопасно вызывать откуда угодно.
 *
 * @param {string} k вид события (a-z_)
 * @param {object} [d] плоские скалярные поля
 */
export function calllog(k, d) {
	try {
		buf.push({ t: Date.now(), k, d })
		if (buf.length > MAX_BUF) {
			buf = buf.slice(-MAX_BUF)
		}
		if (sid && buf.length >= MAX_POST) {
			flush()
		} else if (!sid && k === 'join_blocked') {
			flushPre()
		}
	} catch (e) {
		// журнал не должен ломать звонок
	}
}

/**
 * @param {boolean} [last] страница закрывается: отдать всё сразу
 */
function flush(last) {
	try {
		while (token && sid && !paused && buf.length) {
			const ev = buf.splice(0, MAX_POST)
			const sent = sid
			fetch(generateOcsUrl('apps/spreed/api/v1/calllog/{token}', { token }), {
				method: 'POST',
				keepalive: true, // переживает закрытие вкладки; sendBeacon не умеет заголовки OCS
				headers: { 'OCS-APIRequest': 'true', 'Content-Type': 'application/json', requesttoken: getRequestToken() },
				body: JSON.stringify({ s: sent, sent: Date.now(), ev }),
			}).then((r) => {
				if (r?.status === 403) {
					// сессия устарела (переподключение): пачку вернуть в начало, ждать новую сессию
					buf = ev.concat(buf).slice(-MAX_BUF)
					if (sent === sid) {
						paused = true
					} else {
						flush() // сессию успели сменить, пока шёл запрос: слать с новой
					}
				}
			}, () => {})
			if (!last) {
				break
			}
		}
	} catch (e) {
		// ignore
	}
}

/**
 * Отдать до входа в комнату события из белого списка (гость без сессии): /pre, не больше 20.
 */
function flushPre() {
	try {
		if (sid || !token) {
			return
		}
		const ev = buf.filter((e) => PRE.includes(e.k)).slice(0, MAX_PRE)
		if (!ev.length) {
			return
		}
		buf = buf.filter((e) => !ev.includes(e))
		fetch(generateOcsUrl('apps/spreed/api/v1/calllog/{token}/pre', { token }), {
			method: 'POST',
			keepalive: true,
			headers: { 'OCS-APIRequest': 'true', 'Content-Type': 'application/json', requesttoken: getRequestToken() },
			body: JSON.stringify({ c: cid, sent: Date.now(), ev }),
		}).catch(() => {})
	} catch (e) {
		// ignore
	}
}

/**
 * Участник вошёл в комнату: известна room session id, можно слать.
 *
 * @param {string} newToken токен комнаты
 * @param {string} sessionId room session id (та же, что видит сервер)
 */
export function calllogSession(newToken, sessionId) {
	try {
		if (token && token !== newToken) {
			buf = buf.filter((e) => e.k === 'page_load')
		}
		token = newToken
		sid = sessionId
		paused = false
		if (!sessionSent) {
			sessionSent = true
			calllog('session', { cid }) // связать «до входа» с настоящей сессией
		}
		flush()
	} catch (e) {
		// ignore
	}
}

/**
 * Состояние WebRTC-соединения; номер попытки = сколько раз оно уже обрывалось.
 *
 * @param {string} peer 'local' или первые 6 символов id сессии собеседника
 * @param {string} st состояние
 */
export function calllogRtc(peer, st) {
	const id = String(peer).slice(0, 6)
	if (st === 'disconnected' || st === 'failed') {
		tries[id] = (tries[id] || 0) + 1
	}
	calllog('rtc_state', { peer: id, st: cut(st, 30), n: tries[id] || 0 })
}

/**
 * Показ экрана с точки зрения клиента (стоп только после старта: tracks.stop() события ended не даёт).
 *
 * @param {'start'|'stop'|'denied'} what что случилось
 * @param {string} [name] имя ошибки
 */
export function calllogScreen(what, name) {
	if (what === 'stop' && !screenOn) {
		return
	}
	screenOn = what === 'start'
	calllog('screen_' + what, name ? { name: cut(name, 60) } : undefined)
}

/**
 * Ошибка страницы; тело целиком в try/catch: у объекта без прототипа String() бросает.
 *
 * @param {ErrorEvent} e событие
 */
function onError(e) {
	try {
		calllog('js_error', { name: cut(e.error?.name || 'Error', 40), msg: cut(e.message, 120) })
	} catch (err) {
		// журнал не должен ломать страницу
	}
}

/**
 * Необработанный reject; см. onError.
 *
 * @param {PromiseRejectionEvent} e событие
 */
function onRejection(e) {
	try {
		calllog('js_error', { name: cut(e.reason?.name || 'Rejection', 40), msg: cut(e.reason?.message ?? e.reason, 120) })
	} catch (err) {
		// журнал не должен ломать страницу
	}
}
/**
 *
 */
function onPageHide() {
	calllog('pagehide')
	flushPre()
	flush(true)
}

/**
 * Один раз при загрузке страницы.
 */
export function initCalllog() {
	try {
		if (started) {
			return
		}
		started = true
		token = (location.pathname.match(/\/call\/([a-z0-9]{4,30})/) || [])[1] || null
		calllog('page_load', { ua: cut(navigator.userAgent, 200), w: window.innerWidth, h: window.innerHeight })
		window.addEventListener('error', onError)
		window.addEventListener('unhandledrejection', onRejection)
		window.addEventListener('pagehide', onPageHide)
		window.addEventListener('online', () => calllog('net', { st: 'online' }))
		window.addEventListener('offline', () => calllog('net', { st: 'offline' }))
		timer = setInterval(flush, FLUSH_MS)
		preTimer = setTimeout(flushPre, PRE_MS)
	} catch (e) {
		// ignore
	}
}

// только для тестов
/**
 * Сбросить состояние.
 */
export function _reset() {
	clearInterval(timer)
	clearTimeout(preTimer)
	paused = sessionSent = false
	token = sid = timer = preTimer = null
	buf = []
	started = screenOn = false
	Object.keys(tries).forEach((k) => delete tries[k])
}

/**
 * Буфер для проверки.
 */
export function _buf() {
	return buf
}
