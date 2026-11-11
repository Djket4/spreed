/**
 * ket4tec: k4stk. Гифка или стикер вместо камеры: состояние и транспорт (сигналинг HPB, как у k4draw).
 * Протокол v1: { op:'set', k:'g'|'s', id, ttl } (ttl — остаток мс, 0 = пока не уберут), { op:'clr' }, { op:'q' }.
 */
import { reactive } from 'vue'
import { callParticipantCollection, k4drawSignaling } from '../../../utils/webrtc/index.js'
import { canDraw } from '../k4draw/useDrawing.js'
import { find } from './catalog.js'

const TTLS = [3, 5, 10, 0] // владелец 11.11: 3, 5, 10 с и «до отмены»
const MAX_TTL = 3600000
const GRACE = 2000 // чужое состояние живёт ещё 2 с после ttl
const IN_RATE = 10 // входящих в секунду от одного автора
/**
 *
 */
function lsGet() {
	try {
		return +localStorage.getItem('k4stk.ttl')
	} catch (e) {
		return NaN
	}
}

export const state = reactive({
	mine: null, // { k, id, until } until=0: пока не уберу
	peers: {}, // sessionId -> { k, id, until }
	open: false, // вкладка «Гифки» в боковой панели открыта (ставит RightSidebar)
	hpb: false, // сигналинг HPB доступен
	sid: '', // мой sessionId
	ttl: TTLS.includes(lsGet()) ? lsGet() : 5, // «Держать», секунды
	p: 0, // 0..1 — сколько прошло (кольцо на кнопке)
})
if (typeof window !== 'undefined') {
	window.__k4stk = { state } // только для проверок
}

export const canUse = () => state.hpb && canDraw()

/**
 * @param {number} s секунд (0 = пока не уберу)
 */
export function setTtl(s) {
	state.ttl = s
	try {
		localStorage.setItem('k4stk.ttl', String(s))
	} catch (e) {
		// выбор живёт до перезагрузки
	}
}

let sig = null
let refs = 0
let myTimer = 0
let tick = 0
let addTimer = 0
let lastQ = 0
const peerTimers = {}
const buckets = new Map()

const me = () => (sig || k4drawSignaling())?.getSessionId() || ''
const left = () => (state.mine?.until ? state.mine.until - Date.now() : 0)

/**
 * @param {object} data тело сообщения
 */
function wire(data) {
	sig?.doSend({ type: 'message', message: { recipient: { type: 'call' }, data: { type: 'k4stk', v: 1, ...data } } })
}

/** Отправить своё состояние (остаток ttl). */
function sendSet() {
	const m = state.mine
	if (m && (!m.until || left() > 0)) {
		wire({ op: 'set', k: m.k, id: m.id, ttl: m.until ? left() : 0 })
	}
}

/**
 * Снять своё состояние.
 *
 * @param {boolean} send сообщить остальным
 */
export function clear(send = true) {
	clearTimeout(myTimer)
	clearInterval(tick)
	state.p = 0
	if (state.mine) {
		state.mine = null
		send && wire({ op: 'clr' })
	}
}

/**
 * Выбрать элемент; тот же ещё раз — убрать.
 *
 * @param {string} k 'g' | 's'
 * @param {string} id id из каталога
 */
export function pick(k, id) {
	if (!find(k, id) || !canUse()) {
		return
	}
	if (state.mine?.id === id) {
		return clear()
	}
	clearTimeout(myTimer)
	clearInterval(tick)
	const ms = state.ttl * 1000
	state.mine = { k, id, until: ms ? Date.now() + ms : 0 }
	state.p = 0
	if (ms) {
		myTimer = setTimeout(clear, ms)
		tick = setInterval(() => {
			state.p = Math.min(1, 1 - left() / ms)
		}, 250)
	}
	sendSet()
}

/**
 * @param {string} sid sessionId
 */
function dropPeer(sid) {
	clearTimeout(peerTimers[sid])
	delete peerTimers[sid]
	delete state.peers[sid]
}

/**
 * @param {object} d данные сообщения (границa доверия)
 */
function onMsg(d) {
	if (!d || d.type !== 'k4stk' || d.v !== 1) {
		return
	}
	const from = d.from
	if (typeof from !== 'string' || !from || from === me()) {
		return
	}
	const now = performance.now()
	const b = buckets.get(from) || { t: now, n: IN_RATE }
	b.n = Math.min(IN_RATE, b.n + (now - b.t) * IN_RATE / 1000)
	b.t = now
	buckets.set(from, b)
	if (b.n < 1) {
		return
	}
	b.n--
	if (d.op === 'q') {
		if (now - lastQ > 1000) {
			lastQ = now
			sendSet()
		}
	} else if (d.op === 'clr') {
		dropPeer(from)
	} else if (d.op === 'set' && find(d.k, d.id) && Number.isFinite(d.ttl) && d.ttl >= 0) {
		const ttl = Math.min(d.ttl, MAX_TTL)
		dropPeer(from)
		state.peers[from] = { k: d.k, id: d.id, until: ttl ? Date.now() + ttl : 0 }
		ttl && (peerTimers[from] = setTimeout(() => dropPeer(from), ttl + GRACE))
	}
}

/**
 * @param {object} model участник звонка
 */
function onLeave(model) {
	const sid = model?.attributes?.peerId
	sid && dropPeer(sid)
	buckets.delete(sid)
}

/** Новый участник: через ~0,8 с повторить своё состояние (если `q` потерялся). */
function onAdd() {
	clearTimeout(addTimer)
	addTimer = setTimeout(sendSet, 800)
}

/**
 * Пока идёт звонок: слушать сигналинг, новичком спросить `q`. Вызывается из CallView.
 *
 * @return {Function} отписка (снимает своё состояние)
 */
export function watchStickers() {
	let held = false
	let n = 0
	const t = setInterval(() => {
		if (!held) {
			const s = k4drawSignaling()
			if (s && typeof s.doSend === 'function') {
				held = true
				if (!refs++) {
					sig = s
					sig.on('message', onMsg)
					callParticipantCollection.on('remove', onLeave)
					callParticipantCollection.on('add', onAdd)
				}
				state.hpb = true
				state.sid = me()
			}
			return
		}
		n < 3 && wire({ op: 'q' })
		++n >= 3 && clearInterval(t)
	}, 2000)
	return () => {
		clearInterval(t)
		clearTimeout(addTimer)
		held && clear()
		if (held && !--refs) {
			sig?.off('message', onMsg)
			callParticipantCollection.off('remove', onLeave)
			callParticipantCollection.off('add', onAdd)
			sig = null
			Object.keys(state.peers).forEach(dropPeer)
			buckets.clear()
			state.hpb = false
		}
	}
}
