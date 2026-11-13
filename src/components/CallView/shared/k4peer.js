/**
 * ket4tec (NAS_CLOUD#195): кто без связи — участник или я сам.
 * Участник без связи → шум «NO SIGNAL» в его плитке; я без связи → одна общая плашка «Переподключаемся…».
 */
import { reactive, ref } from 'vue'
import { ConnectionState } from '../../../utils/webrtc/models/CallParticipantModel.js'

/**
 * Связь с участником была и пропала (та же логика, что раньше вела K4Reconnect в VideoVue).
 *
 * @param {object} a attributes модели участника
 * @return {boolean}
 */
export function peerLost(a) {
	if (!a?.connectedAtLeastOnce) {
		return false
	}
	const s = a.connectionState
	const connected = s === ConnectionState.CONNECTED || s === ConnectionState.COMPLETED
	// isDisconnected (включая failed-no-restart) || isReconnecting — как в VideoVue
	const disconnected = !connected && s !== ConnectionState.NEW && s !== ConnectionState.CHECKING
	const reconnecting = !a.initialConnection && ((a.negotiating && !connected) || !!a.connecting)
	return disconnected || reconnecting
}

/**
 * Связь пропала у меня: сигнальный сервер отвалился, браузер офлайн, мой собственный peer не соединён,
 * или пропали сразу все (≥2) собеседники — значит, дело во мне, а не в них.
 *
 * @param {object} p
 * @param {boolean} [p.sigDown] сигнальный сокет закрыт
 * @param {boolean} [p.offline] navigator.onLine === false
 * @param {boolean} [p.localLost] мой peer (MCU/own) был соединён и потерян
 * @param {boolean[]} [p.peers] peerLost каждого собеседника
 * @return {boolean}
 */
export function selfLost({ sigDown = false, offline = false, localLost = false, peers = [] } = {}) {
	return sigDown || offline || localLost || (peers.length >= 2 && peers.every(Boolean))
}

/** Общее состояние сети звонка: sigDown пишет signaling.js, selfLost — CallView. */
export const k4net = reactive({ sigDown: false, selfLost: false })

/**
 * Кнопки плитки по тапу: первый тап показывает, второй или 3 с — прячут.
 *
 * @param {number} [ms]
 */
export function useTapReveal(ms = 3000) {
	const shown = ref(false)
	let timer = null
	const hide = () => {
		clearTimeout(timer)
		timer = null
		shown.value = false
	}
	const toggle = () => {
		if (shown.value) {
			hide()
			return
		}
		shown.value = true
		timer = setTimeout(hide, ms)
	}
	return { shown, toggle, hide }
}

/**
 * Размер квадрата полосы на телефоне (вариант «Б»): 3 в ряд, до 3 человек — 120, больше — 110;
 * видно не больше двух рядов, дальше полоса листается.
 *
 * @param {number} n плиток в полосе
 * @return {{ sq: number, rows: number }}
 */
export function phoneStrip(n) {
	return { sq: n <= 3 ? 120 : 110, rows: Math.min(Math.max(Math.ceil(n / 3), 1), 2) }
}
