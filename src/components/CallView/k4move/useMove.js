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

// Протокол переноса v2 (NAS_CLOUD#177). v1 `take` больше не понимаем ни в какую сторону.
// Принимающая B → исходная A: offer(id) → A: accept(id) | busy(id).
// accept: A в состоянии `moving` до конца своего выхода; любой новый offer — busy.
// B входит → joined(id) → A выходит (leaveOnce) → moved(id) → окну приложения moved.
// B не вошла → cancel(id), A остаётся. A не дождалась joined за JOIN_WAIT → cancel(id), A остаётся.
// B слушает cancel до moved или до JOIN_WAIT + LATE_CANCEL от accept; на cancel выходит (leaveOnce).
// Нет ответа v2 за ACCEPT_WAIT (старая страница) — B НЕ входит: «Обновите страницу».
const V = 2
/** Сколько исходная сессия ждёт `joined` после accept; дольше — отменяет перенос и остаётся в звонке. */
export const JOIN_WAIT = 30000
/** Сколько принимающая ждёт accept/busy; молчание — перенос отменяется, вход не делаем. */
export const ACCEPT_WAIT = 5000
/** Запас принимающей сверх JOIN_WAIT исходной: столько ещё слушает cancel. */
export const LATE_CANCEL = 5000

/**
 * @param {string[]} sids кому
 * @param {string} op offer | accept | busy | joined | moved | cancel
 * @param {string} id перенос
 */
function sendOp(sids, op, id) {
	const s = hpb()
	sids.forEach((sid) => s?.doSend({ type: 'message', message: { recipient: { type: 'session', sessionid: sid }, data: { type: 'k4move', v: V, op, id } } }))
}

const isOp = (d) => d?.type === 'k4move' && d.v === V && typeof d.from === 'string' && typeof d.id === 'string' && typeof d.op === 'string'

let leaving = null
/**
 * Выход из звонка, один на всех: параллельные вызовы ждут тот же промис, вне звонка — ничего.
 *
 * @param {string} token комната
 * @return {Promise<void>}
 */
export function leaveOnce(token) {
	if (!leaving) {
		leaving = (store.getters.isInCall(token)
			? Promise.resolve(store.dispatch('leaveCall', { token, participantIdentifier: useActorStore().participantIdentifier, all: false }))
			: Promise.resolve()
		).catch(() => {}).finally(() => {
			leaving = null
		})
	}
	return leaving
}

/**
 * Принимающая сторона: offer, ответ A, вход здесь, joined; на cancel от A — выйти (или не входить).
 *
 * @param {string[]} sids исходные сессии
 * @param {string} token комната
 * @param {Function} join войти здесь без проверки
 * @return {Promise<string>} joined | busy | stale | failed | cancelled
 */
export async function moveHere(sids, token, join) {
	const sig = hpb()
	const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
	let src = null // ответившая исходная
	let state = 'offer' // offer → busy | accept → moved | cancelled
	let wake = () => {}
	let told = false
	const cancelled = () => {
		told || showInfo('Перенос отменён: звонок остался в другой вкладке')
		told = true
		return leaveOnce(token)
	}
	const onMsg = (d) => {
		if (!isOp(d) || d.id !== id || !sids.includes(d.from) || (src && d.from !== src)) {
			return
		}
		if (state === 'offer' && (d.op === 'accept' || d.op === 'busy')) {
			src = d.from
			state = d.op
			wake()
		} else if (state === 'accept' && d.op === 'moved') {
			state = 'moved'
			wake()
		} else if (state === 'accept' && d.op === 'cancel') {
			state = 'cancelled'
			wake()
			store.getters.isInCall(token) && cancelled()
		}
	}
	const until = (ms) => new Promise((resolve) => {
		const t = setTimeout(resolve, ms)
		wake = () => {
			clearTimeout(t)
			resolve()
		}
	})
	sig?.on('message', onMsg)
	try {
		sendOp(sids, 'offer', id)
		await until(ACCEPT_WAIT)
		if (state === 'busy') {
			showInfo('Звонок уже переносится в другую вкладку')
			return 'busy'
		}
		if (state !== 'accept') {
			state = 'stale'
			sendOp(sids, 'cancel', id) // вдруг accept ещё в пути
			showInfo('Обновите страницу в браузере, где идёт звонок, и повторите перенос')
			return 'stale'
		}
		const deadline = Date.now() + JOIN_WAIT + LATE_CANCEL
		try {
			await join()
		} catch (e) {
			// вход не удался — ниже cancel
		}
		if (state === 'cancelled') {
			await cancelled()
			return 'cancelled'
		}
		if (!store.getters.isInCall(token)) {
			sendOp([src], 'cancel', id)
			return 'failed'
		}
		sendOp([src], 'joined', id)
		while (state === 'accept' && Date.now() < deadline) {
			await until(deadline - Date.now())
		}
		if (state === 'cancelled') {
			await cancelled()
			return 'cancelled'
		}
		return 'joined'
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
 * Одно состояние `moving` от accept до конца выхода; выходит только на joined активного переноса.
 *
 * @return {Function} отписка
 */
export function watchMove() {
	let sig = null
	let moving = null // { from, id, t, out }: out — уже выходим по joined
	const drop = () => {
		clearTimeout(moving?.t)
		moving = null
	}
	const onMsg = (d) => {
		if (!isOp(d)) {
			return
		}
		const token = useTokenStore().token
		const actor = useActorStore()
		// только от своей же сессии (иначе — чужие запросы)
		if (!isTrustedTake(useSessionStore().getSession(d.from), actor.participantIdentifier.attendeeId, actor.actorType, token)) {
			return
		}
		const { from, id, op } = d
		const active = moving && moving.from === from && moving.id === id
		if (op === 'offer') {
			if (moving) {
				!active && sendOp([from], 'busy', id) // один перенос за раз, включая время выхода
			} else if (store.getters.isInCall(token)) {
				moving = { from, id, t: setTimeout(() => {
					sendOp([from], 'cancel', id) // не дождались входа: получатель выйдет, если всё же вошёл
					drop()
				}, JOIN_WAIT) }
				sendOp([from], 'accept', id)
			}
			return
		}
		if (op === 'cancel') {
			active && !moving.out && drop()
			return
		}
		if (op !== 'joined') {
			return
		}
		if (!active) {
			sendOp([from], 'cancel', id) // поздний или чужой joined: звонок остаётся здесь, получатель выходит
			return
		}
		if (moving.out) {
			return
		}
		clearTimeout(moving.t)
		moving.out = true
		const m = moving
		leaveOnce(token).then(() => {
			sendOp([from], 'moved', id)
			if (moving === m) {
				moving = null
			}
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
		if (!moving?.out) { // выход уже идёт — пусть дойдёт до moved
			drop()
		}
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
