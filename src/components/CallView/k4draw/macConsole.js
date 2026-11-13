/**
 * ket4tec: k4draw. Мини-пульт звонка в приложении для Мака: состояние звонка и кадры камер (v2: квадрат 128×128, старое приложение: 160×90)
 * (MediaStream между источниками не передать), команды микрофон / камера / остановить показ / покинуть.
 */
import store from '../../../store/index.js'
import { useActorStore } from '../../../stores/actor.ts'
import { callParticipantCollection, localMediaModel } from '../../../utils/webrtc/index.js'

const MAX = 8
const SQ = 128
const RTC_MAX = 6 // приложение показывает первые 6 плиток: дорожек больше не кодируем
const TILE = 240 // короткая сторона дорожки v3
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
// приложение 1.6/1.6.1 (tick без v) рисует плитку 180×101 растяжением: ему по-прежнему 160×90 cover
const cvOld = document.createElement('canvas')
cvOld.width = 160
cvOld.height = 90
let box = null
const last = new Map() // id плитки -> прошлый jpg (ответ на tick v2 без перекодирования)
let cost = 0 // скользящее среднее времени ответа на fr (кодирование всех плиток + отправка), мс
let late = 0 // таймер отложенного ответа на fr
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
 * Квадрат 128×128 «по заполнению» (sq) или прежний 160×90 cover для старого приложения, base64 JPEG без префикса.
 *
 * @param v
 * @param sq квадрат (приложение v2)
 */
export function jpg(v, sq = true) {
	const w = v.videoWidth
	const h = v.videoHeight
	if (!w || !h) {
		return null
	}
	if (!sq) {
		const k = Math.max(160 / w, 90 / h)
		cvOld.getContext('2d').drawImage(v, (160 - w * k) / 2, (90 - h * k) / 2, w * k, h * k)
		return cvOld.toDataURL('image/jpeg', 0.6).slice(23)
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
const frame = (id, stream, on, fresh, sq) => {
	if (!(on && stream?.getVideoTracks().length)) {
		last.delete(id)
		return null
	}
	const v = video(id, stream)
	if (!fresh && last.has(id)) {
		return last.get(id)
	}
	const j = jpg(v, sq)
	j ? last.set(id, j) : last.delete(id)
	return j
}

// --- v3: настоящее видео по WebRTC (PROTOCOL.md, «Видео камер вместо кадров») ---
let out = () => {} // последняя отправка в окно моста
let pc = null
const trs = new Map() // id плитки -> { tr, clone, src, mid }
let paused = false // приложение спрятало плитки
let dirty = false // набор дорожек изменился, пока шёл обмен offer/answer
let offerAt = 0
let cool = 0 // не предлагать видео до (после bye приложения)
let down = 0 // таймер «disconnected дольше 3 с»

const rtcMid = (id) => trs.get(id)?.mid ?? null

/**
 * Параметры отправки: короткая сторона 240, до 30 к/с, ~300 кбит/с, низкий приоритет (звонок важнее плиток).
 *
 * @param clone дорожка-клон
 */
const enc = (clone) => {
	const { width: w, height: h } = clone.getSettings()
	return { active: !paused, scaleResolutionDownBy: Math.max(1, Math.min(w || TILE, h || TILE) / TILE), maxFramerate: 30, maxBitrate: 300000, priority: 'low', networkPriority: 'low' }
}

/** Дорожки, которые нужны приложению: первые RTC_MAX плиток с включённой камерой. */
function wanted() {
	const L = localMediaModel.attributes
	const list = [['me', L.videoEnabled, L.localStream]]
	callParticipantCollection.callParticipantModels.slice(0, MAX - 1).forEach((m) => {
		const a = m.attributes
		list.push([String(a.peerId), a.videoAvailable, a.stream])
	})
	const w = new Map()
	list.slice(0, RTC_MAX).forEach(([id, on, st]) => {
		const t = on && st?.getVideoTracks()[0]
		t && t.readyState !== 'ended' && w.set(id, t)
	})
	return w
}

function dropTr(id) {
	const e = trs.get(id)
	try {
		e.tr.stop()
	} catch (_) { /* transceiver уже остановлен */ }
	e.clone.stop()
	trs.delete(id)
}

/**
 * Закрыть соединение, остановить клоны дорожек.
 *
 * @param bye сообщить приложению (оно вернётся на v2)
 */
function closeRtc(bye) {
	clearTimeout(down)
	if (!pc) {
		return
	}
	const p = pc
	pc = null
	p.onconnectionstatechange = p.onicecandidate = null
	p.close()
	;[...trs.keys()].forEach(dropTr)
	paused = false
	dirty = false
	bye && out({ t: 'rtc', bye: 1 })
}

function newPc() {
	const p = (pc = new RTCPeerConnection({}))
	p.onicecandidate = (e) => e.candidate?.candidate && pc === p && out({ t: 'rtc', ice: e.candidate.toJSON() })
	p.onconnectionstatechange = () => {
		clearTimeout(down)
		const s = p.connectionState
		if (s === 'failed') {
			closeRtc(true)
		} else if (s === 'disconnected') {
			down = setTimeout(() => pc === p && closeRtc(true), 3000)
		}
	}
}

async function offer() {
	dirty = false
	offerAt = Date.now()
	const p = pc
	await p.setLocalDescription(await p.createOffer())
	if (pc !== p) {
		return
	}
	trs.forEach((e) => {
		e.mid = e.tr.mid
	})
	out({ t: 'rtc', sdp: p.localDescription.toJSON() })
}

/** Привести дорожки к набору плиток; при изменении — новый offer (или bye, если камер не осталось). */
function rtcSync(on) {
	if (!on) {
		return closeRtc(false) // rtc:0 — видео сейчас не предлагать
	}
	const w = wanted()
	if (!pc) {
		if (!w.size || Date.now() < cool) {
			return
		}
		newPc()
	}
	let changed = false
	;[...trs.keys()].forEach((id) => {
		const e = trs.get(id)
		if (!w.has(id)) {
			dropTr(id)
			changed = true
		} else if (e.src !== w.get(id)) { // камера переключена: та же дорожка-отправитель, новый источник
			const old = e.clone
			e.src = w.get(id)
			e.clone = e.src.clone()
			e.clone.contentHint = 'motion'
			e.tr.sender.replaceTrack(e.clone)
			old.stop()
		}
	})
	w.forEach((t, id) => {
		if (!trs.has(id)) {
			const clone = t.clone()
			clone.contentHint = 'motion'
			trs.set(id, { tr: pc.addTransceiver(clone, { direction: 'sendonly', sendEncodings: [enc(clone)] }), clone, src: t, mid: null })
			changed = true
		}
	})
	if (!trs.size) {
		return closeRtc(true)
	}
	if (changed) {
		dirty = true
	}
	if (pc.signalingState === 'stable') {
		dirty && offer().catch(() => closeRtc(true))
	} else if (Date.now() - offerAt > 5000) {
		closeRtc(true) // answer не пришёл: приложение само вернётся на v2
	}
}

async function setActive() {
	const p = pc
	for (const e of [...trs.values()]) {
		const sender = e.tr.sender
		const par = sender.getParameters()
		if (par.encodings?.[0] && par.encodings[0].active !== !paused) {
			par.encodings[0].active = !paused
			await sender.setParameters(par).catch(() => {})
		}
		if (pc !== p) {
			return
		}
	}
}

/**
 * Сообщение `rtc` от приложения: answer, ice, pause / resume, bye.
 *
 * @param d сообщение
 */
export async function consoleRtc(d) {
	if (d.bye) {
		cool = Date.now() + 2000 // защита от петли bye -> offer -> bye
		return closeRtc(false)
	}
	if (!pc) {
		return
	}
	const p = pc
	try {
		if (d.pause || d.resume) {
			paused = !!d.pause
			await setActive()
		} else if (d.sdp?.type === 'answer' && p.signalingState === 'have-local-offer') {
			await p.setRemoteDescription(d.sdp)
			pc === p && (await setActive())
			pc === p && dirty && trs.size && (await offer())
		} else if (d.ice?.candidate) {
			await p.addIceCandidate(d.ice)
		}
	} catch (_) {
		pc === p && closeRtc(true)
	}
}

/** Для живой проверки: window.__k4rtc() */
window.__k4rtc = () => ({ state: pc?.connectionState ?? null, signaling: pc?.signalingState ?? null, paused, mids: [...trs].map(([id, e]) => [id.slice(0, 6), e.mid]) })

/**
 * Состояние звонка и плитки; свои первыми.
 */
function snapshot(fresh = true, sq = true) {
	const L = localMediaModel.attributes
	const live = new Set() // плитки, которые уже идут видео: jpg не кодируем
	const fr = (id, stream, on) => {
		const mid = rtcMid(id)
		if (mid === null) {
			return { jpg: frame(id, stream, on, fresh, sq) }
		}
		const ok = pc?.connectionState === 'connected'
		ok && live.add(id)
		return { vid: mid, jpg: ok ? null : frame(id, stream, on, fresh, sq) }
	}
	const tiles = [{ id: 'me', name: 'Вы', me: true, speaking: !!(L.speaking && L.audioEnabled), mic: !!L.audioEnabled, cam: !!L.videoEnabled, ...fr('me', L.localStream, L.videoEnabled) }]
	callParticipantCollection.callParticipantModels.slice(0, MAX - 1).forEach((m) => {
		const a = m.attributes
		if (m.k4VideoBlocker && !held.has(String(a.peerId))) {
			m.k4VideoBlocker.increaseVisibleCounter()
			held.set(String(a.peerId), m.k4VideoBlocker)
		}
		tiles.push({ id: String(a.peerId), name: a.name || 'Гость', me: false, speaking: !!a.speaking, mic: a.audioAvailable !== false, cam: !!a.videoAvailable, ...fr(String(a.peerId), a.stream, a.videoAvailable) })
	})
	const ids = new Set(tiles.map((t) => t.id))
	held.forEach((b, id) => {
		if (!ids.has(id)) {
			b.decreaseVisibleCounter()
			held.delete(id)
		}
	})
	vids.forEach((v, id) => {
		if (!ids.has(id) || live.has(id)) {
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
 * @param v2 tick с `v:2` или `v:3`
 * @param rtc null — приложение без v3; иначе `tick.rtc` (1 — видео можно предлагать, 0 — нельзя)
 */
export function consoleTick(send, v2 = false, rtc = null) {
	out = send
	rtc === null ? closeRtc(true) : rtcSync(rtc)
	send(snapshot(!v2, v2))
}

/**
 * `fr` приложения (до 25/с): свежие кадры камер на каждый fr, пока ответы укладываются в ~12% главного потока:
 * следующий ответ не раньше чем через 7 × среднее время предыдущего. Дорого (много камер, слабая машина) —
 * ответ откладываем (приложение ждёт до 200 мс); частота падает, вкладка не тормозит.
 *
 * @param send отправка в окно моста
 */
export function consoleFrame(send) {
	const now = performance.now()
	if (now < nextAt) {
		// слишком рано: отвечаем, когда уложимся в бюджет (приложение ждёт ответ до 200 мс, потом шлёт fr снова)
		stat.skip++
		late ||= setTimeout(() => {
			late = 0
			inCall() && consoleFrame(send)
		}, nextAt - now)
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
	closeRtc(false)
	held.forEach((b) => b.decreaseVisibleCounter())
	held.clear()
	vids.forEach((v) => {
		v.srcObject = null
	})
	vids.clear()
	last.clear()
	clearTimeout(late)
	late = 0
	cost = 0
	nextAt = 0
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
