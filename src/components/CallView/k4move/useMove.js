/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#113): тот же пользователь открыл звонок второй раз (вкладка/устройство): спросить и перенести звонок.
// Транспорт: сообщения сигналинга HPB { type:'k4move', v:2, op, id } конкретной сессии (recipient session), протокол — у moveHere.
import axios from '@nextcloud/axios'
import { getDialogBuilder, showInfo } from '@nextcloud/dialogs'
import { generateOcsUrl, generateUrl } from '@nextcloud/router'
import store from '../../../store/index.js'
import { useActorStore } from '../../../stores/actor.ts'
import { useSessionStore } from '../../../stores/session.ts'
import { useTokenStore } from '../../../stores/token.ts'
import { k4drawSignaling } from '../../../utils/webrtc/index.js'
import { appPost } from '../k4draw/macBridge.js'

/**
 * Другие сессии этого же участника (attendeeId), которые сейчас в звонке. Чистая функция.
 *
 * @param {object[]} sessions значения sessionStore.sessions
 * @param {string} token комната
 * @param {number} attendeeId мой attendeeId
 * @param {string} mySid мой signalingSessionId
 * @param {boolean} any участник точно в звонке (свежий ответ сервера) — брать все его другие сессии: у не вошедшей вкладки inCall сессий в хранилище устаревший (0)
 * @return {string[]} signalingSessionId
 */
export function otherSessionsInCall(sessions, token, attendeeId, mySid, any = false) {
	if (!attendeeId) {
		return []
	}
	return sessions
		.filter((s) => s.token === token && s.attendeeId === attendeeId && s.signalingSessionId !== mySid && (any || (s.inCall ?? 0) > 0))
		.map((s) => s.signalingSessionId)
}

/**
 * Можно ли верить `take` от этой сессии: тот же участник, не гость.
 *
 * @param {object|undefined} from сессия отправителя из sessionStore
 * @param {number} attendeeId мой attendeeId
 * @param {string} actorType мой actorType
 * @param {string} token комната
 */
export function isTrustedTake(from, attendeeId, actorType, token) {
	return !!from && actorType === 'users' && !!attendeeId && from.attendeeId === attendeeId && from.token === token
}

let joiner = null
/**
 * useJoinCall регистрирует свой joinCall — «Вернуть сюда» вызывает его из CallView (там композабл недоступен).
 *
 * @param {Function} fn joinCall(token, options)
 */
export function setJoiner(fn) {
	joiner = fn
}

/**
 *
 */
function hpb() {
	const s = k4drawSignaling()
	return s && typeof s.doSend === 'function' ? s : null
}

// Протокол переноса v2 (NAS_CLOUD#177). Старые страницы понимают только v1 `take` («выйди сразу») и v2 игнорируют.
// Принимающая B → исходная A: offer(id) → A: accept(id) | busy(id) → B входит → joined(id) → A выходит, окну moved.
// Вход у B не удался → B: cancel(id). A не дождалась joined за JOIN_WAIT → A: cancel(id), B выходит, если уже вошла.
// joined без активного переноса (поздний) → A отвечает cancel. Активный перенос у A один: offer другой сессии → busy.
const V = 2
/** Сколько исходная сессия ждёт `joined` после accept; дольше — отменяет перенос и остаётся в звонке. */
export const JOIN_WAIT = 30000
/** Сколько принимающая ждёт accept/busy; молчание (старая страница, сессия ушла) — входит как раньше. */
export const ACCEPT_WAIT = 5000
/** Сколько принимающая после joined ещё слушает cancel (joined и cancel по таймауту разминулись). */
const LATE_CANCEL = 10000

/**
 * @param {string[]} sids кому
 * @param {string} op offer | accept | busy | joined | cancel
 * @param {string} id перенос
 */
function sendOp(sids, op, id) {
	const s = hpb()
	sids.forEach((sid) => s?.doSend({ type: 'message', message: { recipient: { type: 'session', sessionid: sid }, data: { type: 'k4move', v: V, op, id } } }))
}

const isOp = (d) => d?.type === 'k4move' && d.v === V && typeof d.from === 'string' && typeof d.id === 'string' && typeof d.op === 'string'

/**
 * Принимающая сторона: offer, ответ A, вход здесь, joined; на cancel от A — выйти (или не входить).
 *
 * @param {string[]} sids исходные сессии
 * @param {string} token комната
 * @param {Function} join войти здесь без проверки
 * @return {Promise<string>} joined | busy | failed | cancelled
 */
export async function moveHere(sids, token, join) {
	const sig = hpb()
	const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
	let cancelled = false
	let answer = null
	let wake = () => {}
	const leave = () => store.dispatch('leaveCall', { token, participantIdentifier: useActorStore().participantIdentifier, all: false })
	const onMsg = (d) => {
		if (!isOp(d) || d.id !== id || !sids.includes(d.from)) {
			return
		}
		if (d.op === 'accept' || d.op === 'busy') {
			answer = d.op
			wake()
		} else if (d.op === 'cancel') {
			cancelled = true
			if (store.getters.isInCall(token)) {
				leave()
				showInfo('Перенос отменён: звонок остался в другой вкладке')
			}
		}
	}
	sig?.on('message', onMsg)
	try {
		sendOp(sids, 'offer', id)
		await new Promise((resolve) => {
			wake = resolve
			setTimeout(resolve, ACCEPT_WAIT)
		})
		if (answer === 'busy') {
			showInfo('Звонок уже переносится в другую вкладку')
			return 'busy'
		}
		try {
			await join()
		} catch (e) {
			// вход не удался — ниже cancel
		}
		if (!store.getters.isInCall(token)) {
			sendOp(sids, 'cancel', id)
			return 'failed'
		}
		if (cancelled) {
			await leave()
			showInfo('Перенос отменён: звонок остался в другой вкладке')
			return 'cancelled'
		}
		sendOp(sids, 'joined', id)
		await new Promise((resolve) => setTimeout(resolve, LATE_CANCEL))
		return cancelled ? 'cancelled' : 'joined'
	} finally {
		sig?.off('message', onMsg)
	}
}

/**
 * @param {string} name заголовок
 * @param {string} text текст
 * @param {Array} buttons кнопки
 */
function ask(name, text, buttons) {
	getDialogBuilder(name).setText(text).setButtons(buttons).build().show()
}

/**
 * Перед входом в звонок: есть ли моя другая сессия в звонке. Если да — показывает диалог и возвращает true (вход не делать).
 *
 * @param {string} token комната
 * @param {Function} join войти здесь без проверки
 * @return {Promise<boolean>} true — вход отложен диалогом
 */
export async function moveGate(token, join) {
	const s = hpb()
	const actor = useActorStore()
	if (!s || actor.actorType !== 'users') {
		return false
	}
	const att = actor.participantIdentifier.attendeeId
	// я сам ещё не в звонке: если сервер говорит, что мой участник в звонке, — это другая моя вкладка или устройство
	let busy = false
	try {
		const list = (await axios.get(generateOcsUrl('apps/spreed/api/v4/room/{token}/participants', { token }))).data.ocs.data
		busy = (list.find((p) => p.attendeeId === att)?.inCall ?? 0) > 0
	} catch (e) {
		return false // не узнали — входим как раньше
	}
	if (!busy) {
		return false
	}
	const others = otherSessionsInCall(Object.values(useSessionStore().sessions), token, att, s.getSessionId(), true)
	ask('Вы уже в этом звонке', 'Звонок открыт в другой вкладке или на другом устройстве.', [
		{ label: 'Остаться там', callback: () => {} },
		{ label: 'Перенести звонок сюда', type: 'primary', callback: () => moveHere(others, token, join) },
	])
	return true
}

/**
 * Слушатель переноса — пока я в звонке (CallView), исходная сторона протокола v2 (см. moveHere).
 * Выходит из звонка и шлёт окну приложения `moved` только на joined активного переноса.
 *
 * @return {Function} отписка
 */
export function watchMove() {
	let sig = null
	let wait = null // активный перенос: { from, id, t }
	const drop = () => {
		clearTimeout(wait?.t)
		wait = null
	}
	const onMsg = (d) => {
		if (!isOp(d)) {
			return
		}
		const token = useTokenStore().token
		const actor = useActorStore()
		// только та сессия, что сейчас в звонке, и только от своей же (иначе — перекидывание по кругу и чужие запросы)
		if (!store.getters.isInCall(token) || !isTrustedTake(useSessionStore().getSession(d.from), actor.participantIdentifier.attendeeId, actor.actorType, token)) {
			return
		}
		const { from, id, op } = d
		const active = wait && wait.from === from && wait.id === id
		if (op === 'offer') {
			if (wait && !active) {
				sendOp([from], 'busy', id) // один перенос за раз
				return
			}
			drop()
			wait = { from, id, t: setTimeout(() => {
				sendOp([from], 'cancel', id) // не дождались входа: получатель выйдет, если всё же вошёл
				drop()
			}, JOIN_WAIT) }
			sendOp([from], 'accept', id)
			return
		}
		if (op === 'cancel') {
			active && drop()
			return
		}
		if (op !== 'joined') {
			return
		}
		if (!active) {
			sendOp([from], 'cancel', id) // поздний или чужой joined: звонок остаётся здесь, получатель выходит
			return
		}
		drop()
		store.dispatch('leaveCall', { token, participantIdentifier: actor.participantIdentifier, all: false }).then(() => {
			appPost('moved') // окно приложения K4Draw (NAS_CLOUD#177): звонок уже идёт там, окно можно закрыть
			ask('Звонок перенесён', 'Звонок продолжается в другой вкладке или на другом устройстве.', [
				{ label: 'Закрыть', callback: () => {} },
				{ label: 'Вернуть сюда', type: 'primary', callback: () => joiner && moveHere([from], token, () => joiner(token, { k4take: true })) },
			])
		})
	}
	const t = setInterval(() => {
		sig = hpb()
		if (sig) {
			clearInterval(t)
			sig.on('message', onMsg)
		}
	}, 2000)
	return () => {
		clearInterval(t)
		drop()
		sig?.off('message', onMsg)
	}
}

/**
 * Ссылка раздела шапки платформы, которую нужно открыть в новой вкладке (чистая функция).
 *
 * @param {object} e событие click (target, button, ctrlKey, metaKey)
 * @param {string} origin location.origin
 * @param {string} here location.pathname + location.search, текущая страница
 * @param {string} appPath путь приложения звонков (например /index.php/apps/spreed)
 * @return {string|null} абсолютный href или null — не трогать
 */
export function headerLinkToOpen(e, origin, here, appPath) {
	if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) {
		return null
	}
	const a = e.target?.closest?.('a[href]')
	const raw = a?.getAttribute('href')
	if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw) || a.target === '_blank' || a.hasAttribute('download')) {
		return null
	}
	let u
	try {
		u = new URL(raw, origin + here)
	} catch (err) {
		return null
	}
	if (u.origin === origin && (u.pathname.startsWith(appPath) || (u.pathname + u.search) === here)) { // чужой сайт (фото) — тоже в новую вкладку
		return null
	}
	return u.href
}

/**
 * Пока я в звонке: разделы шапки открываются в новой вкладке, звонок остаётся здесь (CallView).
 *
 * @return {Function} отписка
 */
export function watchHeaderLinks() {
	const onClick = (e) => {
		if (!e.target?.closest?.('#header, .k7-hdr')) { // .k7-hdr — наша шапка, #header — штатная
			return
		}
		const here = location.pathname + location.search
		const href = headerLinkToOpen(e, location.origin, here, generateUrl('/apps/spreed'))
		if (href) {
			e.preventDefault()
			e.stopPropagation()
			window.open(href, '_blank', 'noopener')
			showInfo('Звонок остался в этой вкладке')
		}
	}
	document.addEventListener('click', onClick, true)
	return () => document.removeEventListener('click', onClick, true)
}
