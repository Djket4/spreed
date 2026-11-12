/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#113): тот же пользователь открыл звонок второй раз (вкладка/устройство): спросить и перенести звонок.
// Транспорт: сообщение сигналинга HPB { type:'k4move', v:1, op:'take' } конкретной сессии (recipient session).
import axios from '@nextcloud/axios'
import { getDialogBuilder, showInfo } from '@nextcloud/dialogs'
import { generateOcsUrl, generateUrl } from '@nextcloud/router'
import store from '../../../store/index.js'
import { useActorStore } from '../../../stores/actor.ts'
import { useSessionStore } from '../../../stores/session.ts'
import { useTokenStore } from '../../../stores/token.ts'
import { k4drawSignaling } from '../../../utils/webrtc/index.js'

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

/**
 * @param {string[]} sids куда отправить `take`
 */
function sendTake(sids) {
	const s = hpb()
	sids.forEach((sid) => s?.doSend({ type: 'message', message: { recipient: { type: 'session', sessionid: sid }, data: { type: 'k4move', v: 1, op: 'take' } } }))
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
		{ label: 'Перенести звонок сюда', type: 'primary', callback: () => {
			sendTake(others)
			join()
		} },
	])
	return true
}

/**
 * Слушатель `take` — пока я в звонке (CallView). Выходит из звонка и предлагает вернуть.
 *
 * @return {Function} отписка
 */
export function watchMove() {
	let sig = null
	const onMsg = (data) => {
		if (data?.type !== 'k4move' || data.v !== 1 || data.op !== 'take' || typeof data.from !== 'string') {
			return
		}
		const token = useTokenStore().token
		const actor = useActorStore()
		// только та сессия, что сейчас в звонке, и только от своей же (иначе — перекидывание по кругу и чужие запросы)
		if (!store.getters.isInCall(token) || !isTrustedTake(useSessionStore().getSession(data.from), actor.participantIdentifier.attendeeId, actor.actorType, token)) {
			return
		}
		const from = data.from
		store.dispatch('leaveCall', { token, participantIdentifier: actor.participantIdentifier, all: false }).then(() => {
			ask('Звонок перенесён', 'Звонок продолжается в другой вкладке или на другом устройстве.', [
				{ label: 'Закрыть', callback: () => {} },
				{ label: 'Вернуть сюда', type: 'primary', callback: () => {
					sendTake([from])
					joiner?.(token, { k4take: true })
				} },
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
