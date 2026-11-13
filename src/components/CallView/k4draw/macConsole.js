/**
 * ket4tec: k4draw. Мини-пульт звонка в приложении для Мака: состояние звонка и кадры камер 128×128 (квадрат)
 * (MediaStream между источниками не передать), команды микрофон / камера / остановить показ / покинуть.
 */
import store from '../../../store/index.js'
import { useActorStore } from '../../../stores/actor.ts'
import { callParticipantCollection, localMediaModel } from '../../../utils/webrtc/index.js'

const MAX = 8
const SQ = 128
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
cv.width = cv.height = SQ
let box = null
const last = new Map() // id плитки -> прошлый jpg (ответ на tick v2 без перекодирования)
let cost = 0 // скользящее среднее времени ответа на fr (кодирование всех плиток + отправка), мс
let nextAt = 0 // не отвечать на fr раньше (держим ответы в ~12% главного потока)
// счётчики для замера в живом звонке: window.__k4fr
const stat = (window.__k4fr = { n: 0, ms: 0, skip: 0 })

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
 * Окно исходного кадра, которое идёт в квадрат. Сейчас — центр (cover, как плитка в звонке);
 * когда ветка face-center сдвинет окно к лицу у получателя, подменить только эту функцию.
 *
 * @param w ширина кадра
 * @param h высота кадра
 * @return {[number, number, number, number]} sx, sy, sw, sh
 */
export const cropWindow = (w, h) => {
	const m = Math.min(w, h)
	return [(w - m) / 2, (h - m) / 2, m, m]
}

/**
 * Квадрат 128×128 «по заполнению», base64 JPEG без префикса.
 *
 * @param v
 */
export function jpg(v) {
	const w = v.videoWidth
	const h = v.videoHeight
	if (!w || !h) {
		return null
	}
	const [sx, sy, sw, sh] = cropWindow(w, h)
	cv.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, SQ, SQ)
	return cv.toDataURL('image/jpeg', 0.6).slice(23)
}

/**
 * @param id
 * @param stream
 * @param on камера включена
 */
const frame = (id, stream, on, fresh) => {
	if (!(on && stream?.getVideoTracks().length)) {
		last.delete(id)
		return null
	}
	const v = video(id, stream)
	if (!fresh && last.has(id)) {
		return last.get(id)
	}
	const j = jpg(v)
	j ? last.set(id, j) : last.delete(id)
	return j
}

/**
 * Состояние звонка и плитки; свои первыми.
 */
function snapshot(fresh = true) {
	const L = localMediaModel.attributes
	const tiles = [{ id: 'me', name: 'Вы', me: true, speaking: !!(L.speaking && L.audioEnabled), mic: !!L.audioEnabled, cam: !!L.videoEnabled, jpg: frame('me', L.localStream, L.videoEnabled, fresh) }]
	callParticipantCollection.callParticipantModels.slice(0, MAX - 1).forEach((m) => {
		const a = m.attributes
		if (m.k4VideoBlocker && !held.has(String(a.peerId))) {
			m.k4VideoBlocker.increaseVisibleCounter()
			held.set(String(a.peerId), m.k4VideoBlocker)
		}
		tiles.push({ id: String(a.peerId), name: a.name || 'Гость', me: false, speaking: !!a.speaking, mic: a.audioAvailable !== false, cam: !!a.videoAvailable, jpg: frame(String(a.peerId), a.stream, a.videoAvailable, fresh) })
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
			last.delete(id)
			v.srcObject = null
			v.remove()
			vids.delete(id)
		}
	})
	return { t: 'call', mic: !!L.audioEnabled, cam: !!L.videoEnabled, share: !!L.localScreen, tiles }
}

/**
 * Кадр пульта по `tick` приложения (часы приложения: свой таймер в фоновой вкладке Safari спит).
 * Приложение 1.6.1 и старее (tick без v): свежие кадры на каждый tick. v2: прошлые jpg без перекодирования,
 * свежие приходят на `fr`.
 *
 * @param send отправка в окно моста
 * @param v2 tick с `v:2`
 */
export function consoleTick(send, v2 = false) {
	send(snapshot(!v2))
}

/**
 * `fr` приложения (до 25/с): свежие кадры камер на каждый fr, пока ответы укладываются в ~12% главного потока:
 * следующий ответ не раньше чем через 7 × среднее время предыдущего. Дорого (много камер, слабая машина) —
 * fr пропускаем, приложение само повторит через 200 мс; частота падает, вкладка не тормозит.
 *
 * @param send отправка в окно моста
 */
export function consoleFrame(send) {
	const now = performance.now()
	if (now < nextAt) {
		stat.skip++
		return
	}
	send(snapshot(true))
	const d = performance.now() - now
	cost = cost ? cost * 0.8 + d * 0.2 : d
	stat.n++
	stat.ms += d
	nextAt = now + cost * 7
}

/** */
export function stopConsole() {
	held.forEach((b) => b.decreaseVisibleCounter())
	held.clear()
	vids.forEach((v) => {
		v.srcObject = null
	})
	vids.clear()
	last.clear()
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
