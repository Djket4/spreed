/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#113): тот же пользователь открыл звонок второй раз (вкладка/устройство): спросить и перенести звонок.
// Транспорт: сообщения сигналинга HPB { type:'k4move', v:2, op, id } конкретной сессии (recipient session), протокол — у moveHere.
import axios from '@nextcloud/axios'
import { getDialogBuilder, showError, showInfo } from '@nextcloud/dialogs'
import { generateOcsUrl, generateUrl } from '@nextcloud/router'
import { fetchPeers } from '../../../services/callsService.ts'
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

// Протокол переноса v2 (NAS_CLOUD#177). Истина — у сервера (список участников звонка), сообщения только будят.
// Принимающая B → исходная A: offer(id, sid — Nextcloud-сессия B) → A: accept(id) | busy(id).
// B после accept входит и шлёт joined(id). Сама B не выходит никогда: худший исход — две мои сессии в звонке, ноль — нет.
// A выходит, только когда сервер показал сессию sid в звонке (опрос до JOIN_WAIT, joined — проверить сразу).
// Срок вышел — A остаётся в звонке, роль снята; ещё LATE_WAIT следит за поздним входом B и тогда выходит (добивание).
// Свой выход A проверяет по серверу: B в звонке и меня нет — moved(id) и окну moved; B пропала — вход обратно; я ещё там — ошибка.
// Нет ответа v2 за ACCEPT_WAIT (старая исходная) — B НЕ входит: «Обновите страницу».
// v1 `take` от старой принимающей (боевой #113): A выходит, когда сервер покажет новую мою сессию в звонке (не было при take).
// Перед moved A проверяет по серверу: получатель в звонке, меня нет. Получатель пропал — A входит обратно.
// Одна сессия — одна роль: пока идёт попытка как получатель, offer к ней — busy, и наоборот.
const V = 2
/** Сколько исходная держит роль и ждёт входа получателя по серверу; потом остаётся в звонке. */
export const JOIN_WAIT = 30000
/** Сколько принимающая ждёт accept/busy; молчание — перенос отменяется, вход не делаем. */
export const ACCEPT_WAIT = 5000
/** Сколько исходная ещё следит за поздним входом получателя после JOIN_WAIT. */
export const LATE_WAIT = 30000
/** Шаг опроса списка участников звонка. */
export const POLL = 1000
/** Таймаут одного GET списка участников; ответ позже — недействителен. */
export const GET_TIMEOUT = 5000
/** Попытки вернуться в звонок, если перенос не подтвердился, и пауза между ними. */
export const REJOIN_TRIES = 3
export const REJOIN_PAUSE = 2000
/** Сколько после moved исходная следит, что получатель всё ещё в звонке (закрылся — предложить вернуться). */
export const MOVED_WATCH = 60000
/** Сколько после срока помнить перенос, чтобы добить очень поздний вход получателя (его joined приходит после join). */
export const LATE_KEEP = 600000

let seq = 0 // номер последней попытки получателя: старая попытка после новой ничего не делает
let recv = null // идёт попытка как получатель (id)
let src = null // идёт перенос как источник: { from, id, sid, until, out }
let leaving = null

/**
 * @param {string[]} sids кому
 * @param {string} op offer | accept | busy | joined | moved
 * @param {string} id перенос
 * @param {object} extra доп. поля (sid у offer)
 */
function sendOp(sids, op, id, extra = {}) {
	const s = hpb()
	sids.forEach((sid) => s?.doSend({ type: 'message', message: { recipient: { type: 'session', sessionid: sid }, data: { type: 'k4move', v: V, op, id, ...extra } } }))
}

const isOp = (d) => d?.type === 'k4move' && d.v === V && typeof d.from === 'string' && typeof d.id === 'string' && typeof d.op === 'string'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Участники звонка — по серверу.
 *
 * @param {string} token комната
 * @return {Promise<object[]|null>} CallPeer[]; null — сервер не ответил за GET_TIMEOUT (поздний ответ отбрасывается)
 */
export async function peersInCall(token) {
	const ctl = new AbortController()
	let t
	try {
		return await Promise.race([
			fetchPeers(token, { signal: ctl.signal }).then((r) => r.data.ocs.data),
			new Promise((resolve) => {
				t = setTimeout(() => resolve(null), GET_TIMEOUT)
			}),
		])
	} catch (e) {
		return null
	} finally {
		clearTimeout(t)
		ctl.abort()
	}
}

/**
 * Вернуться в звонок и подтвердить по серверу; при отказе — повторы, потом честная плашка с кнопкой входа.
 *
 * @param {string} token комната
 * @return {Promise<boolean>} true — сервер показал меня в звонке
 */
export async function rejoin(token) {
	const me = () => useActorStore().sessionId
	for (let i = 0; i < REJOIN_TRIES; i++) {
		i && await sleep(REJOIN_PAUSE)
		await Promise.resolve().then(() => joiner?.(token, { k4take: true })).catch(() => {})
		if ((await peersInCall(token))?.some((p) => p.sessionId === me())) {
			return true
		}
	}
	ask('Не удалось вернуться в звонок', 'Перенос не удался, и звонок не вернулся в эту вкладку. Нажмите «Войти».', [
		{ label: 'Войти', type: 'primary', callback: () => joiner?.(token, { k4take: true }) },
	])
	return false
}

/**
 * Выход из звонка, один на всех: параллельные вызовы ждут тот же промис.
 *
 * @param {string} token комната
 * @return {Promise<void>}
 */
export function leaveOnce(token) {
	if (!leaving) {
		leaving = (store.getters.isInCall(token)
			? Promise.resolve().then(() => store.dispatch('leaveCall', { token, participantIdentifier: useActorStore().participantIdentifier, all: false }))
			: Promise.resolve()
		).catch(() => {}).finally(() => {
			leaving = null
		})
	}
	return leaving
}

/**
 * Исходная: выйти и проверить по серверу, что получатель в звонке, а меня там нет. Только тогда moved получателю и окну.
 * Получатель пропал (закрылся во время выхода, устаревший снимок) или сервер не ответил — звонок возвращается сюда.
 *
 * @param {string} from куда ушёл звонок
 * @param {string|null} id перенос (null — v1)
 * @param {string} token комната
 * @param {string} rsid Nextcloud-сессия получателя, которую сервер показал в звонке
 * @return {Promise<boolean>} true — перенос подтверждён сервером
 */
export async function leaveVerified(from, id, token, rsid) {
	await leaveOnce(token)
	const list = await peersInCall(token)
	const there = !!list?.some((p) => p.sessionId === rsid)
	const me = !!list?.some((p) => p.sessionId === useActorStore().sessionId)
	if (there && !me) {
		id && sendOp([from], 'moved', id)
		moved(from, token)
		watchRecipient(token, rsid)
		return true
	}
	if (!there) { // получатель пропал или сервер не подтвердил (таймаут) — moved не шлём
		if (me || await rejoin(token)) { // ноль сессий не оставляем: войти обратно и проверить по серверу
			showInfo('Перенос не удался: звонок остаётся в этой вкладке')
		}
		return false
	}
	showError('Не удалось выйти из звонка в этой вкладке: звонок идёт в двух местах. Выйдите здесь вручную.')
	return false
}

/**
 * После moved: пока получатель в звонке — молчим; пропал (закрыл вкладку) и меня нигде нет — предложить вернуться.
 * Пропажа подтверждается двумя ответами сервера подряд (null — не ответил, не считается).
 * Кнопка, не автовозврат: сервер не отличает закрытую вкладку от осознанного «Выйти».
 *
 * @param {string} token комната
 * @param {string} rsid Nextcloud-сессия получателя
 */
async function watchRecipient(token, rsid) {
	const end = Date.now() + MOVED_WATCH
	let gone = 0
	while (Date.now() < end) {
		await sleep(POLL) // и роль источника к этому моменту уже снята
		if (src || recv || store.getters.isInCall(token)) {
			return // новый перенос или я уже в звонке
		}
		const list = await peersInCall(token)
		if (!list) {
			continue
		}
		if (list.some((p) => p.sessionId === useActorStore().sessionId)) {
			return
		}
		gone = list.some((p) => p.sessionId === rsid) ? 0 : gone + 1
		if (gone >= 2) {
			ask('Звонок остался без вас', 'Вкладка, куда был перенесён звонок, закрылась. Вернуть звонок сюда?', [
				{ label: 'Закрыть', callback: () => {} },
				{ label: 'Вернуть сюда', type: 'primary', callback: () => rejoin(token) },
			])
			return
		}
	}
}

/**
 * Принимающая сторона: offer, ответ A, вход здесь, joined. Сама не выходит никогда — решает A по серверу.
 *
 * @param {string[]} sids исходные сессии
 * @param {string} token комната
 * @param {Function} join войти здесь без проверки
 * @return {Promise<string>} joined | busy | stale | superseded | failed
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
	let state = 'offer' // offer → accept | busy
	let wake = () => {}
	const onMsg = (d) => {
		if (live() && state === 'offer' && isOp(d) && d.id === id && sids.includes(d.from) && (d.op === 'accept' || d.op === 'busy')) {
			from = d.from
			state = d.op
			wake()
		}
	}
	sig?.on('message', onMsg)
	try {
		sendOp(sids, 'offer', id, { sid: useActorStore().sessionId })
		await new Promise((resolve) => {
			const t = setTimeout(resolve, ACCEPT_WAIT)
			wake = () => {
				clearTimeout(t)
				resolve()
			}
		})
		sig?.off('message', onMsg)
		if (!live()) {
			return 'superseded'
		}
		if (state === 'busy') {
			showInfo('Звонок уже переносится в другую вкладку')
			return 'busy'
		}
		if (state !== 'accept') {
			showInfo('Обновите страницу в браузере, где идёт звонок, и повторите перенос')
			return 'stale'
		}
		try {
			await join()
		} catch (e) { // вход упал: A не будим, звонок остаётся у неё
			showError('Не удалось войти в звонок здесь: звонок остаётся в другой вкладке')
			return 'failed'
		}
		sendOp([from], 'joined', id) // разбудить A; вошла ли я — A проверит по серверу
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
 * Выходит только когда сервер показал получателя в звонке, или на v1 take.
 *
 * @return {Function} отписка
 */
export function watchMove() {
	let sig = null
	let alive = true
	const tries = new Map() // принятые переносы: id → { from, id, sid, until }
	const late = new Map() // переносы, у которых вышел срок наблюдения: id → t (помнить LATE_KEEP)
	const finish = (t, token, rsid) => {
		if (src?.out) {
			return
		}
		src = { ...t, out: true } // роль держим до конца выхода
		tries.clear()
		leaveVerified(t.from, t.v1 ? null : t.id, token, rsid).finally(() => {
			src = null
		})
	}
	const check = async (t, token) => {
		const a = useActorStore()
		const list = await peersInCall(token)
		// получатель: v2 — сессия из offer; v1 — моя сессия, которой не было в звонке при take
		const r = list?.find((p) => p.actorType === a.actorType && p.actorId === a.actorId && p.sessionId !== a.sessionId
			&& (t.v1 ? !!t.before && !t.before.includes(p.sessionId) : p.sessionId === t.sid))
		if (alive && tries.get(t.id) === t && r) {
			finish(t, token, r.sessionId)
		}
	}
	const follow = async (t, token) => {
		const end = t.until + LATE_WAIT
		while (alive && tries.get(t.id) === t && Date.now() < end) {
			if (src === t && Date.now() >= t.until) {
				src = null // срок вышел: звонок остаётся здесь, новые переносы можно; поздний вход ещё добьём
			}
			await check(t, token)
			await sleep(POLL)
		}
		if (src === t) {
			src = null
		}
		if (tries.get(t.id) === t) {
			tries.delete(t.id)
			alive && !t.v1 && late.set(t.id, t) // поздний joined получателя (после LATE_WAIT) ещё добьём
		}
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
		if (d.v === 1) { // старая принимающая (боевой #113) шлёт take и сразу входит: выходим, только когда сервер покажет её вход
			if (op === 'take' && !src && !recv && store.getters.isInCall(token)) {
				const t = { from, id: 'v1:' + from, v1: true, until: Date.now() + JOIN_WAIT }
				src = t
				tries.set(t.id, t)
				peersInCall(token).then((list) => {
					if (!list) { // не знаем, кто был в звонке до take — остаёмся
						src === t && (src = null)
						tries.delete(t.id)
						return
					}
					t.before = list.map((p) => p.sessionId)
					follow(t, token)
				})
			}
			return
		}
		if (!isOp(d)) {
			return
		}
		if (op === 'offer') {
			if (src || recv) {
				!(src && src.from === from && src.id === id) && sendOp([from], 'busy', id) // одна роль и один перенос за раз, включая время выхода
			} else if (typeof d.sid === 'string' && store.getters.isInCall(token)) {
				const t = { from, id, sid: d.sid, until: Date.now() + JOIN_WAIT }
				src = t
				tries.set(id, t)
				sendOp([from], 'accept', id)
				follow(t, token)
			}
			return
		}
		let t = tries.get(id)
		const l = op === 'joined' && late.get(id)
		if (l) {
			late.delete(id)
			if (!t && !src && l.from === from && Date.now() < l.until + LATE_WAIT + LATE_KEEP && store.getters.isInCall(token)) {
				t = l // получатель вошёл совсем поздно: одна проверка по серверу; вошла — выходим, нет — забыли
				tries.set(id, t)
				check(t, token).finally(() => tries.get(id) === t && tries.delete(id))
				return
			}
		}
		if (op === 'joined' && t && t.from === from) {
			check(t, token) // проверить сразу, не ждать шага опроса
		}
	}
	const attach = () => {
		sig = hpb()
		sig?.on('message', onMsg)
		return !!sig
	}
	let iv = null
	if (!attach()) { // сигналинг уже есть (вход после переноса) — слушаем сразу, иначе ждём его
		iv = setInterval(() => attach() && clearInterval(iv), 2000)
	}
	return () => {
		alive = false
		clearInterval(iv)
		if (!src?.out) { // выход уже идёт — пусть дойдёт до moved
			src = null
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
