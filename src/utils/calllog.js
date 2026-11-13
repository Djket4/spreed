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
let started = false
let screenOn = false
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
		while (token && sid && buf.length) {
			const ev = buf.splice(0, MAX_POST)
			const sentSid = sid
			fetch(generateOcsUrl('apps/spreed/api/v1/calllog/{token}', { token }), {
				method: 'POST',
				keepalive: true, // переживает закрытие вкладки; sendBeacon не умеет заголовки OCS
				headers: { 'OCS-APIRequest': 'true', 'Content-Type': 'application/json', requesttoken: getRequestToken() },
				body: JSON.stringify({ s: sid, sent: Date.now(), ev }),
			}).then((r) => {
				// комнаты/доступа нет (или сессия умерла): дальше слать бессмысленно, до следующего входа
				if ([403, 404, 410].includes(r?.status) && sid === sentSid) {
					calllogStop(false)
				}
			}).catch(() => {})
			if (!last) {
				break
			}
		}
	} catch (e) {
		// ignore
	}
}

/**
 * Выход из комнаты/звонка (или ответ 403/404/410): остановить маячок до следующего calllogSession.
 *
 * @param {boolean} [final] отдать накопленное одним последним запросом
 */
export function calllogStop(final = true) {
	try {
		if (final) {
			flush(true)
		}
		clearInterval(timer)
		timer = sid = null
		buf = []
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
		if (!timer) {
			timer = setInterval(flush, FLUSH_MS)
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
	token = sid = timer = null
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
