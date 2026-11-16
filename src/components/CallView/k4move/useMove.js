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

// Протокол переноса v2 (NAS_CLOUD#177). Принимающая B → исходная A: offer(id) → A: accept(id) | busy(id).
// accept: A в состоянии «источник» до конца своего выхода; любой новый offer — busy.
// B входит → joined(id) → A выходит (leaveOnce) → moved(id); выход A не удался → failed(id), B выходит сама.
// B не вошла → cancel(id), A остаётся. A не дождалась joined за JOIN_WAIT → cancel(id), A остаётся.
// B слушает cancel/failed до moved или до JOIN_WAIT + LATE_CANCEL от accept; на них выходит (leaveOnce).
// Нет ответа v2 за ACCEPT_WAIT (старая исходная) — B НЕ входит: «Обновите страницу».
// v1 `take` от старой принимающей (боевой #113): A выходит сразу, как старый код, и шлёт окну moved.
// Одна сессия — одна роль: пока идёт попытка как получатель, offer к ней — busy, и наоборот.
const V = 2
/** Сколько исходная сессия ждёт `joined` после accept; столько же принимающая ждёт свой вход. */
export const JOIN_WAIT = 30000
/** Сколько принимающая ждёт accept/busy; молчание — перенос отменяется, вход не делаем. */
export const ACCEPT_WAIT = 5000
/** Запас принимающей сверх JOIN_WAIT исходной: столько ещё слушает cancel. */
export const LATE_CANCEL = 5000

let seq = 0 // номер последней попытки получателя: старая попытка после новой ничего не делает
let recv = null // идёт попытка как получатель (id)
let src = null // идёт перенос как источник: { from, id, t, out }
let leaving = null

/**
 * @param {string[]} sids кому
 * @param {string} op offer | accept | busy | joined | moved | failed | cancel
 * @param {string} id перенос
 */
function sendOp(sids, op, id) {
	const s = hpb()
	sids.forEach((sid) => s?.doSend({ type: 'message', message: { recipient: { type: 'session', sessionid: sid }, data: { type: 'k4move', v: V, op, id } } }))
}

const isOp = (d) => d?.type === 'k4move' && d.v === V && typeof d.from === 'string' && typeof d.id === 'string' && typeof d.op === 'string'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Выход из звонка, один на всех: параллельные вызовы ждут тот же промис.
 *
 * @param {string} token комната
 * @return {Promise<boolean>} true — после выхода я не в звонке
 */
export function leaveOnce(token) {
	if (!leaving) {
		leaving = (store.getters.isInCall(token)
			? Promise.resolve().then(() => store.dispatch('leaveCall', { token, participantIdentifier: useActorStore().participantIdentifier, all: false }))
			: Promise.resolve()
		).catch(() => {}).then(() => !store.getters.isInCall(token)).finally(() => {
			leaving = null
		})
	}
	return leaving
}

/**
 * Принимающая сторона: offer, ответ A, вход здесь, joined; на cancel/failed от A — выйти (или не входить).
 *
 * @param {string[]} sids исходные сессии
 * @param {string} token комната
 * @param {Function} join войти здесь без проверки
 * @return {Promise<string>} joined | busy | stale | failed | cancelled | expired | superseded
 */
export async function moveHere(sids, token, join) {
	if (src) {
		showInfo('Звонок уже переносится в другую вкладку')
		return 'busy'
	}
	const sig = hpb()
	const n = ++seq
	const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
	const live = () => seq === n
	recv = id
	let from = null // ответившая исходная
	let state = 'offer' // offer → busy | accept → moved | cancel | failed
	let wake = () => {}
	let told = false
	const out = () => {
		told || showInfo('Перенос отменён: звонок остался в другой вкладке')
		told = true
		return leaveOnce(token)
	}
	const onMsg = (d) => {
		if (!live() || !isOp(d) || d.id !== id || !sids.includes(d.from) || (from && d.from !== from)) {
			return
		}
		if (state === 'offer' && (d.op === 'accept' || d.op === 'busy')) {
			from = d.from
			state = d.op
			wake()
		} else if (state === 'accept' && (d.op === 'moved' || d.op === 'cancel' || d.op === 'failed')) {
			state = d.op
			wake()
			d.op !== 'moved' && store.getters.isInCall(token) && out()
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
		if (!live()) {
			return 'superseded'
		}
		if (state === 'busy') {
			showInfo('Звонок уже переносится в другую вкладку')
			return 'busy'
		}
		if (state !== 'accept') {
			sendOp(sids, 'cancel', id) // вдруг accept ещё в пути
			showInfo('Обновите страницу в браузере, где идёт звонок, и повторите перенос')
			return 'stale'
		}
		const deadline = Date.now() + JOIN_WAIT + LATE_CANCEL
		const joining = Promise.resolve().then(join).catch(() => {})
		const inTime = await Promise.race([joining.then(() => true), sleep(JOIN_WAIT).then(() => false)])
		if (!live()) {
			sendOp([from], 'cancel', id) // освободить исходную; звонок не трогаем — он уже у новой попытки
			return 'superseded'
		}
		if (!inTime) {
			sendOp([from], 'cancel', id)
			joining.then(() => live() && leaveOnce(token)) // вход всё-таки завершится — выйти
			await leaveOnce(token)
			return 'expired'
		}
		if (state === 'cancel' || state === 'failed') {
			await out()
			return state === 'cancel' ? 'cancelled' : 'failed'
		}
		if (!store.getters.isInCall(token)) {
			sendOp([from], 'cancel', id)
			return 'failed'
		}
		sendOp([from], 'joined', id)
		while (state === 'accept' && Date.now() < deadline) {
			await until(deadline - Date.now())
		}
		if (live() && (state === 'cancel' || state === 'failed')) {
			await out()
			return state === 'cancel' ? 'cancelled' : 'failed'
		}
		return 'joined'
	} finally {
		sig?.off('message', onMsg)
		if (recv === id) {
			recv = null
		}
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
 * Диалог после переноса у исходной: «Вернуть сюда» — перенос обратно по v2.
 *
 * @param {string} from куда ушёл звонок
 * @param {string} token комната
 */
function moved(from, token) {
	appPost('moved') // окно приложения K4Draw (NAS_CLOUD#177): звонок уже идёт там, окно можно закрыть
	ask('Звонок перенесён', 'Звонок продолжается в другой вкладке или на другом устройстве.', [
		{ label: 'Закрыть', callback: () => {} },
		{ label: 'Вернуть сюда', type: 'primary', callback: () => joiner && moveHere([from], token, () => joiner(token, { k4take: true })) },
	])
}

/**
 * Слушатель переноса — пока я в звонке (CallView), исходная сторона протокола (см. moveHere).
 * Роль «источник» от accept до конца выхода; выходит только на joined активного переноса или на v1 take.
 *
 * @return {Function} отписка
 */
export function watchMove() {
	let sig = null
	const drop = () => {
		clearTimeout(src?.t)
		src = null
	}
	const leave = (from, id, token) => {
		const m = src
		leaveOnce(token).then((ok) => {
			if (src === m) {
				src = null
			}
			if (!ok) {
				id && sendOp([from], 'failed', id) // звонок остался здесь — получатель выходит
				return
			}
			id && sendOp([from], 'moved', id)
			moved(from, token)
		})
	}
	const onMsg = (d) => {
		if (d?.type !== 'k4move' || typeof d.from !== 'string') {
			return
		}
		const token = useTokenStore().token
		const actor = useActorStore()
		// только от своей же сессии (иначе — чужие запросы)
		if (!isTrustedTake(useSessionStore().getSession(d.from), actor.participantIdentifier.attendeeId, actor.actorType, token)) {
			return
		}
		const { from, id, op } = d
		if (d.v === 1) { // старая принимающая (боевой #113): выйти сразу, как старый код
			if (op === 'take' && !src && !recv && store.getters.isInCall(token)) {
				src = { from, id: null, out: true }
				leave(from, null, token)
			}
			return
		}
		if (!isOp(d)) {
			return
		}
		const active = src && src.from === from && src.id === id
		if (op === 'offer') {
			if (src || recv) {
				!active && sendOp([from], 'busy', id) // одна роль и один перенос за раз, включая время выхода
			} else if (store.getters.isInCall(token)) {
				src = { from, id, t: setTimeout(() => {
					sendOp([from], 'cancel', id) // не дождались входа: получатель выйдет, если всё же вошёл
					drop()
				}, JOIN_WAIT) }
				sendOp([from], 'accept', id)
			}
			return
		}
		if (op === 'cancel') {
			active && !src.out && drop()
			return
		}
		if (op !== 'joined') {
			return
		}
		if (!active) {
			sendOp([from], 'cancel', id) // поздний или чужой joined: звонок остаётся здесь, получатель выходит
			return
		}
		if (src.out) {
			return
		}
		clearTimeout(src.t)
		src.out = true
		leave(from, id, token)
	}
	const attach = () => {
		sig = hpb()
		sig?.on('message', onMsg)
		return !!sig
	}
	let t = null
	if (!attach()) { // сигналинг уже есть (вход после переноса) — слушаем сразу, иначе ждём его
		t = setInterval(() => attach() && clearInterval(t), 2000)
	}
	return () => {
		clearInterval(t)
		if (!src?.out) { // выход уже идёт — пусть дойдёт до moved
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
