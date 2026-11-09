/**
 * ket4tec: k4draw. Мини-пульт звонка в приложении для Мака: состояние звонка и кадры камер 160×90
 * (MediaStream между источниками не передать), команды микрофон / камера / остановить показ / покинуть.
 */
import store from '../../../store/index.js'
import { useActorStore } from '../../../stores/actor.ts'
import { callParticipantCollection, localMediaModel } from '../../../utils/webrtc/index.js'

const MAX = 8
const vids = new Map() // id плитки -> <video> со своим потоком
// Talk не принимает камеру участника, чья плитка не видна (при показе экрана полоса скрыта) — пока пульт
// подключён, его плитки считаются видимыми: id -> RemoteVideoBlocker, которому добавлен счётчик
const held = new Map()
// для проверки в живом звонке: window.__k4mc()
window.__k4mc = () => callParticipantCollection.callParticipantModels.map((m) => {
	const a = m.attributes
	const b = m.k4VideoBlocker
	return { peer: String(a.peerId).slice(0, 6), video: a.videoAvailable, tracks: a.stream?.getVideoTracks().length ?? null, blocked: b?._blocked, counter: b?._visibleCounter, held: held.has(String(a.peerId)), vw: vids.get(String(a.peerId))?.videoWidth ?? null }
})
const cv = document.createElement('canvas')
cv.width = 160
cv.height = 90
let box = null

/**
 * Скрытый, но в DOM: Safari не отдаёт кадры <video> вне документа.
 *
 * @param id
 * @param stream
 */
function video(id, stream) {
	if (!box) {
		box = document.createElement('div')
		box.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none'
		document.body.append(box)
	}
	let v = vids.get(id)
	if (!v) {
		v = document.createElement('video')
		v.muted = true
		v.playsInline = true
		v.width = 2
		box.append(v)
		vids.set(id, v)
	}
	if (v.srcObject !== stream) {
		v.srcObject = stream
		v.play().catch(() => {})
	}
	return v
}

/**
 * Кадр 160×90 «по заполнению», base64 JPEG без префикса.
 *
 * @param v
 */
function jpg(v) {
	const w = v.videoWidth
	const h = v.videoHeight
	if (!w || !h) {
		return null
	}
	const k = Math.max(160 / w, 90 / h)
	const g = cv.getContext('2d')
	g.drawImage(v, (160 - w * k) / 2, (90 - h * k) / 2, w * k, h * k)
	return cv.toDataURL('image/jpeg', 0.6).slice(23)
}

/**
 * @param id
 * @param stream
 * @param on камера включена
 */
const frame = (id, stream, on) => (on && stream?.getVideoTracks().length ? jpg(video(id, stream)) : null)

/**
 * Состояние звонка и плитки; свои первыми.
 */
function snapshot() {
	const L = localMediaModel.attributes
	const tiles = [{ id: 'me', name: 'Вы', me: true, speaking: !!(L.speaking && L.audioEnabled), mic: !!L.audioEnabled, cam: !!L.videoEnabled, jpg: frame('me', L.localStream, L.videoEnabled) }]
	callParticipantCollection.callParticipantModels.slice(0, MAX - 1).forEach((m) => {
		const a = m.attributes
		if (m.k4VideoBlocker && !held.has(String(a.peerId))) {
			m.k4VideoBlocker.increaseVisibleCounter()
			held.set(String(a.peerId), m.k4VideoBlocker)
		}
		tiles.push({ id: String(a.peerId), name: a.name || 'Гость', me: false, speaking: !!a.speaking, mic: a.audioAvailable !== false, cam: !!a.videoAvailable, jpg: frame(String(a.peerId), a.stream, a.videoAvailable) })
	})
	const ids = new Set(tiles.map((t) => t.id))
	held.forEach((b, id) => {
		if (!ids.has(id)) {
			b.decreaseVisibleCounter()
			held.delete(id)
		}
	})
	vids.forEach((v, id) => {
		if (!ids.has(id)) {
			v.srcObject = null
			v.remove()
			vids.delete(id)
		}
	})
	return { t: 'call', mic: !!L.audioEnabled, cam: !!L.videoEnabled, share: !!L.localScreen, tiles }
}

/**
 * Кадр пульта: по `tick` приложения (5 раз в секунду), а не по своему таймеру — в фоновой вкладке Safari он спит.
 *
 * @param send отправка в окно моста
 */
export function consoleTick(send) {
	send(snapshot())
}

/** */
export function stopConsole() {
	held.forEach((b) => b.decreaseVisibleCounter())
	held.clear()
	vids.forEach((v) => {
		v.srcObject = null
	})
	vids.clear()
	box?.remove()
	box = null
}

/** Вкладка ещё в звонке. */
export const inCall = () => !!localMediaModel.attributes.token && store.getters.isInCall(localMediaModel.attributes.token)

/**
 * Команда пульта. Возвращает true, если команда его.
 *
 * @param t тип сообщения
 */
export function consoleCmd(t) {
	const L = localMediaModel.attributes
	const token = L.token // текущий звонок вкладки, а не тот, где нажали «Рисовать на экране»
	if (t === 'mic') {
		L.audioEnabled ? localMediaModel.disableAudio() : localMediaModel.enableAudio()
	} else if (t === 'cam') {
		L.videoEnabled ? localMediaModel.disableVideo() : localMediaModel.enableVideo()
	} else if (t === 'stopShare') {
		L.localScreen && localMediaModel.stopSharingScreen()
	} else if (t === 'leave') {
		token && store.dispatch('leaveCall', { token, participantIdentifier: useActorStore().participantIdentifier, all: false })
	} else {
		return false
	}
	return true
}
