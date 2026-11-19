/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec: статистика звонка для тестового режима (NAS_CLOUD#189).
// Форма `k4stats` — контракт для интерфейса (вкладка и плитки), см. JSDoc ниже.
import { getCurrentUser } from '@nextcloud/auth'
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { reactive, watch } from 'vue'
import { calllog } from './calllog.js'

/**
 * Предупреждение по участнику.
 *
 * @typedef {object} K4Warn
 * @property {'drop'|'loss'|'rtt'|'jit'|'novideo'|'noaudio'|'fps'|'own'|'stall'} w вид: обрыв, потери, задержка, дрожание звука,
 *   нет видео, нет звука, видео рывками, свой канал (только у 'local'), поток стоит (NAS_CLOUD#183)
 * @property {'yellow'|'red'} lvl уровень
 */

/**
 * Последние числа по одному участнику. Нет данных (Safari, ещё не было замера) = `null`, не 0.
 *
 * @typedef {object} K4PeerStats
 * @property {number|null} kbps битрейт, кбит/с: у чужого участника входящий, у 'local' исходящий
 * @property {number|null} loss потери за окно замера, %, 0..100
 * @property {number|null} rtt задержка до сервера/пира, мс (candidate-pair currentRoundTripTime)
 * @property {number|null} jit дрожание входящего звука, мс
 * @property {number|null} fps кадров/с входящего видео
 * @property {'host'|'srflx'|'relay'|'prflx'|null} path тип пары кандидатов; 'relay' = TURN
 * @property {K4Warn[]} warn активные предупреждения (пустой массив = всё хорошо)
 */

/**
 * Единственный реактивный объект. Подписка: `import { k4stats } from '../../utils/k4stats.js'`, читать в
 * computed/template или `watch(() => k4stats.peers[id], ...)`. Писать в него извне нельзя.
 *
 * - `testmode`: true, только если feed ответил 200 (владелец). Иначе интерфейс ничего не показывает.
 * - `peers`: ключ `'local'` (своя исходящая сторона) или id сессии участника в звонке (`CallParticipantModel.attributes.peerId`).
 *   Записи появляются после первого замера и удаляются, когда участник уходит или звонок кончился.
 *   Обновляются раз в 3 с.
 *
 * @type {{ testmode: boolean, hostMute: number, peers: Object<string, K4PeerStats> }}
 */
export const k4stats = reactive({
	testmode: false,
	hostMute: 0, // Date.now() последнего принудительного выключения микрофона ведущим (ставит simplewebrtc.js)
	peers: {},
})

const STEP_MS = 3000
const STATS_TIMEOUT_MS = 5000 // getStats не вернулся: не держим busy до конца звонка
const LOG_EVERY = 5 // раз в 15 с
const DISCONNECTED = ['disconnected', 'disconnected-long', 'failed', 'failed-no-restart']

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null)
const round = (v, n = 0) => (v === null ? null : Math.round(v * 10 ** n) / 10 ** n)

/**
 * Свести отчёт getStats (Map-подобный) к счётчикам.
 *
 * @param {Map|object} report RTCStatsReport
 * @param {'in'|'out'} dir входящий pc (чужой участник) или исходящий (свой)
 */
function read(report, dir) {
	const r = { ts: 0, bytes: 0, pkts: 0, lost: 0, ab: 0, vb: 0, jit: null, fps: null, rtt: null, lt: null, rt: null, proto: null, top: null, layers: 0, hv: false, qlim: null, qw: -1, encfps: 0 }
	let rirRtt = null
	report.forEach((s) => {
		r.ts = Math.max(r.ts, num(s.timestamp) || 0)
		const kind = s.kind || s.mediaType
		if (s.type === 'inbound-rtp' && dir === 'in') {
			r.bytes += s.bytesReceived || 0
			r.pkts += s.packetsReceived || 0
			r.lost += Math.max(0, s.packetsLost || 0)
			if (kind === 'audio') {
				r.ab += s.bytesReceived || 0
				r.jit = num(s.jitter) === null ? r.jit : s.jitter * 1000
			} else if (kind === 'video') {
				r.vb += s.bytesReceived || 0
				r.fps = num(s.framesPerSecond) // Safari: поля нет -> null
			}
		} else if (s.type === 'outbound-rtp' && dir === 'out') {
			r.bytes += s.bytesSent || 0
			r.pkts += s.packetsSent || 0
			// ket4tec (NAS_CLOUD#160): видеобитрейт отправки отдельно, причина ограничения широкого слоя, кадры/с кодера
			if (kind === 'video') {
				r.hv = true
				r.vb += s.bytesSent || 0
				r.encfps += num(s.framesPerSecond) || 0
				if (s.active !== false && (s.frameWidth || 0) > r.qw) {
					r.qw = s.frameWidth || 0
					r.qlim = s.qualityLimitationReason || null
				}
			} else if (kind === 'audio') {
				r.ab += s.bytesSent || 0
			}
			// ket4tec (NAS_CLOUD#375): разрешение и кадры/с отправки: верхний активный слой simulcast (самый широкий) и число слоёв
			if (kind === 'video' && s.frameWidth > 0 && s.active !== false && s.framesPerSecond > 0) {
				r.layers++
				if (!r.top || s.frameWidth > r.top.w) {
					r.top = { w: s.frameWidth, h: s.frameHeight, fps: num(s.framesPerSecond) }
				}
			}
		} else if (s.type === 'remote-inbound-rtp' && dir === 'out') {
			r.lost += Math.max(0, s.packetsLost || 0)
			rirRtt = num(s.roundTripTime) === null ? rirRtt : s.roundTripTime * 1000
		} else if (s.type === 'candidate-pair' && (s.selected || (s.nominated && s.state === 'succeeded'))) {
			r.rtt = num(s.currentRoundTripTime) === null ? r.rtt : s.currentRoundTripTime * 1000
			const l = report.get(s.localCandidateId)
			const rm = report.get(s.remoteCandidateId)
			r.lt = l?.candidateType || r.lt
			r.rt = rm?.candidateType || r.rt
			r.proto = l?.protocol || r.proto
		}
	})
	if (r.rtt === null) {
		r.rtt = rirRtt
	}
	return r
}

/**
 * Числа за окно между двумя отчётами. Нет данных или счётчики сбросились = null, не 0.
 *
 * @param {Map|object|null} prevReport прошлый getStats (null = первый замер)
 * @param {Map|object} report текущий getStats
 * @param {'in'|'out'} [dir] направление
 * @return {{kbps: number|null, loss: number|null, rtt: number|null, jit: number|null, fps: number|null, out: string|null,
 *   path: string|null, proto: string|null, lt: string|null, rt: string|null, ab: number|null, vb: number|null}}
 *   ab/vb: байт аудио/видео за окно (для classify)
 */
export function sample(prevReport, report, dir = 'in') {
	const c = read(report, dir)
	const p = prevReport ? read(prevReport, dir) : null
	const dt = p ? (c.ts - p.ts) / 1000 : 0
	const ok = p && dt > 0 && c.bytes >= p.bytes && c.pkts >= p.pkts && c.lost >= p.lost
	const total = ok ? c.pkts - p.pkts + c.lost - p.lost : 0
	const path = c.lt || c.rt
		? ['relay', 'srflx', 'prflx', 'host'].find((x) => x === c.lt || x === c.rt) || null
		: null
	return {
		kbps: ok ? round((c.bytes - p.bytes) * 8 / 1000 / dt) : null,
		loss: ok && total > 0 ? round((c.lost - p.lost) * 100 / total, 1) : null,
		rtt: round(c.rtt),
		jit: round(c.jit),
		fps: round(c.fps),
		out: c.top ? `${c.top.w}x${c.top.h}${c.top.fps === null ? '' : '@' + Math.round(c.top.fps)} ×${c.layers}` : null,
		path,
		proto: c.proto,
		lt: c.lt,
		rt: c.rt,
		ab: ok && c.ab >= p.ab ? c.ab - p.ab : null,
		vb: ok && c.vb >= p.vb ? c.vb - p.vb : null,
		hv: dir === 'out' ? c.hv : null, // есть ли исходящий видео-RTP в отчёте
		qlim: c.qlim,
		encfps: dir === 'out' && c.qw >= 0 ? round(c.encfps) : null,
	}
}

/**
 * Все заявленные участником потоки молчат (null = нет данных, не молчание).
 *
 * @param {object} s результат sample()
 * @param {object} flags audioAvailable, videoAvailable, videoBlocked
 * @return {boolean}
 */
function stalled(s, flags) {
	const a = flags.audioAvailable === true
	const v = flags.videoAvailable === true && !flags.videoBlocked
	return (a || v) && (!a || s.ab === 0) && (!v || s.vb === 0)
}

const level = (v, yellow, red) => (v === null ? null : v >= red ? 'red' : v >= yellow ? 'yellow' : null)

/**
 * Предупреждения по таблице порогов. Включается после 2 замеров подряд, гаснет после 3 хороших.
 * Чистая: prevState не меняется.
 *
 * @param {{cnt: object, on: object}|null} prevState состояние прошлого вызова (null = начало)
 * @param {object} s результат sample()
 * @param {{conn?: string, videoAvailable?: boolean, videoBlocked?: boolean, audioAvailable?: boolean, own?: 'yellow'|'red'|null}} flags
 * @return {{state: object, warn: K4Warn[], changes: Array<{w: string, lvl: string, on: 0|1}>}}
 */
export function classify(prevState, s, flags = {}) {
	const cnt = { ...(prevState?.cnt || {}) }
	const on = { ...(prevState?.on || {}) }
	const now = {
		drop: DISCONNECTED.includes(flags.conn) ? 'red' : null,
		loss: level(s.loss, 5, 15),
		rtt: level(s.rtt, 300, 800),
		jit: level(s.jit, 50, Infinity),
		novideo: flags.videoAvailable === true && s.vb === 0 ? 'red' : null,
		noaudio: flags.audioAvailable === true && s.ab === 0 ? 'red' : null,
		fps: flags.videoAvailable === true && s.fps !== null && s.fps < 8 ? 'yellow' : null,
		own: flags.own || null,
		// ket4tec (NAS_CLOUD#183): от участника не идёт ни один заявленный поток (видео, отключённое у нас ради экономии, не ждём)
		stall: stalled(s, flags) ? 'red' : null,
	}
	// пустой замер (соединение пересоздаётся, нет данных) не хороший и не плохой: счётчики метрик не трогаем
	const empty = ['kbps', 'loss', 'rtt', 'jit', 'fps', 'ab', 'vb'].every((k) => s[k] === null)
	const changes = []
	for (const w of Object.keys(now)) {
		if (empty && w !== 'drop' && w !== 'own') {
			continue
		}
		const c = { bad: 0, good: 0, ...cnt[w] }
		if (now[w]) {
			c.bad++
			c.good = 0
			if (c.bad >= 2 && on[w] !== now[w]) {
				on[w] = now[w]
				changes.push({ w, lvl: now[w], on: 1 })
			}
		} else {
			c.good++
			c.bad = 0
			if (c.good >= (w === 'stall' ? 1 : 3) && on[w]) { // поток пошёл — плашка «возвращается» гаснет сразу
				changes.push({ w, lvl: on[w], on: 0 })
				delete on[w]
			}
		}
		cnt[w] = c
	}
	return { state: { cnt, on }, warn: Object.entries(on).map(([w, lvl]) => ({ w, lvl })), changes }
}

// ── рантайм ──
let ctx = null
let timer = null
let tickN = 0
let busy = false
let stopWatch = []
let lagTimer = null
let lagLast = 0
let lagMax = 0 // макс. отклонение шага 1 с за интервал rtc_stats, мс
let zeroTick = -1000
const LAG_MS = 1000
const STALL_MS = 3000
const hidden = () => (typeof document !== 'undefined' && document.hidden ? 1 : 0)
const subs = new Map() // дорожка/pc -> снять подписки
let curPc = null
let flowed = false // в этом соединении видео уже уходило (vb > 0)
const per = {} // id -> { report, st, key, last }

const EMPTY = { kbps: null, loss: null, rtt: null, jit: null, fps: null, out: null, path: null, proto: null, lt: null, rt: null, ab: null, vb: null, hv: null, qlim: null, encfps: null }
const lvlOf = (q) => (q >= 4 ? 'red' : q === 3 ? 'yellow' : null)
const clean = (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined))

/**
 * Замер одного pc: sample, classify, журнал, k4stats.peers.
 *
 * @param id
 * @param pc
 * @param dir
 * @param flags
 */
async function measure(id, pc, dir, flags) {
	const e = per[id] || (per[id] = { report: null, st: null, key: null })
	e.miss = 0
	let s = EMPTY // нет pc или getStats упал: «обрыв» всё равно считаем по connectionState
	if (pc) {
		try {
			let to
			const report = await Promise.race([
				pc.getStats(),
				new Promise((_r, rej) => {
					to = setTimeout(rej, STATS_TIMEOUT_MS, new Error('getStats timeout'))
				}),
			]).finally(() => clearTimeout(to))
			s = sample(e.report, report, dir)
			e.report = report
		} catch (err) {
			// ignore
		}
	}
	const res = classify(e.st, s, flags)
	e.st = res.state
	e.last = s
	const peer = id.slice(0, 6)
	const key = `${s.lt}/${s.rt}/${s.proto}`
	if (s.path && key !== e.key) {
		e.key = key
		calllog('rtc_path', clean({ peer, lt: s.lt, rt: s.rt, proto: s.proto }))
	}
	for (const ch of res.changes) {
		calllog('rtc_warn', { peer, w: ch.w, lvl: ch.lvl, on: ch.on })
	}
	k4stats.peers[id] = { kbps: s.kbps, loss: s.loss, rtt: s.rtt, jit: s.jit, fps: s.fps, path: s.path, warn: res.warn }
}

/** Строка rtc_stats: сводка по своему каналу и всем входящим. */
function logStats() {
	const up = per.local?.last
	const peers = Object.entries(per).filter(([id]) => id !== 'local').map(([, e]) => e)
	const sum = (k) => peers.reduce((a, e) => a + (e.last?.[k] ?? 0), 0)
	const vals = (k) => peers.map((e) => e.last?.[k]).filter((v) => v !== null && v !== undefined)
	const dnl = vals('loss')
	const rtts = vals('rtt')
	const fps = vals('fps')
	const jit = vals('jit')
	const first = up?.path ? up : peers.map((e) => e.last).find((l) => l?.path)
	calllog('rtc_stats', clean({
		up: up?.kbps,
		upl: up?.loss,
		out: up?.out, // ket4tec (NAS_CLOUD#375): например '1920x1080@30 ×3'
		rtt: up?.rtt ?? (rtts.length ? Math.max(...rtts) : null),
		dn: vals('kbps').length ? Math.round(sum('kbps')) : null,
		dnl: dnl.length ? Math.round(dnl.reduce((a, b) => a + b, 0) / dnl.length * 10) / 10 : null,
		jit: jit.length ? Math.max(...jit) : null,
		fps: fps.length ? Math.min(...fps) : null,
		path: first?.path,
		proto: first?.proto,
		qa: peers.filter((e) => e.last?.ab > 0).length, // сколько участников, от кого сейчас идёт звук
		qv: peers.filter((e) => e.last?.vb > 0).length, // и видео
	}))
	// ket4tec (NAS_CLOUD#160): rtc_stats уже на 12 ключах, новое отдельной строкой
	calllog('rtc_health', clean({ lag: Math.round(lagMax), qlim: up?.qlim, encfps: up?.encfps, hidden: hidden() }))
	lagMax = 0
}

const localVideo = () => ctx?.localMedia?.attributes?.localStream?.getVideoTracks?.()[0]

/** Раз в шаг 1 с: подписаться на новые локальные дорожки и исходящий pc; ловит провал цикла событий. */
function lagStep() {
	const now = performance.now() // не Date.now: перевод системных часов не должен давать ложный stall
	const step = now - lagLast
	lagLast = now
	lagMax = Math.max(lagMax, step - LAG_MS, 0)
	if (step > STALL_MS) {
		calllog('stall', { ms: Math.round(step), hidden: hidden() })
	}
	try {
		const tracks = ctx?.localMedia?.attributes?.localStream?.getTracks?.() || []
		const pc = ctx?.local?.get('peer')?.pc || null
		// снять подписки с дорожек и pc, которых больше нет
		for (const [o, off] of subs) {
			if (o !== pc && !tracks.includes(o)) {
				off()
				subs.delete(o)
			}
		}
		for (const t of tracks) {
			if (!subs.has(t)) {
				const offs = ['mute', 'unmute', 'ended'].map((ev) => {
					const fn = () => calllog('track_state', { kind: t.kind, st: ev })
					t.addEventListener(ev, fn)
					return () => t.removeEventListener(ev, fn)
				})
				subs.set(t, () => offs.forEach((f) => f()))
			}
		}
		if (pc !== curPc) {
			curPc = pc
			flowed = false
		}
		if (pc && !subs.has(pc)) {
			const fn = () => calllog('pc_state', clean({ ice: pc.iceConnectionState, conn: pc.connectionState }))
			const evs = ['iceconnectionstatechange', 'connectionstatechange']
			evs.forEach((ev) => pc.addEventListener(ev, fn))
			subs.set(pc, () => evs.forEach((ev) => pc.removeEventListener(ev, fn)))
		}
	} catch (e) {
		// журнал не должен влиять на звонок
	}
}

/**
 * Нулевая отправка видео при включённой камере: не чаще раза за интервал rtc_stats.
 *
 * @param {object} lpc исходящий RTCPeerConnection
 * @param {string} lconn connectionState модели
 */
function checkSendZero(lpc, lconn) {
	const up = per.local?.last
	if (up?.vb > 0) {
		flowed = true
	}
	if (!flowed || !up?.hv || up.vb !== 0 || !ctx?.localMedia?.attributes?.videoEnabled || tickN - zeroTick < LOG_EVERY) {
		return
	}
	zeroTick = tickN
	const t = localVideo()
	const b = (v) => (v === undefined ? undefined : v ? 1 : 0)
	calllog('send_zero', clean({ qlim: up.qlim, lag: Math.round(lagMax), trk: t?.readyState, muted: b(t?.muted), enabled: b(t?.enabled), ice: lpc?.iceConnectionState, conn: lpc?.connectionState || lconn, hidden: hidden() }))
}

/** Шаг сбора раз в 3 с. */
async function tick() {
	if (!ctx || busy) {
		return
	}
	busy = true // не наслаиваем замеры, если getStats на слабом телефоне идёт дольше шага
	try {
		const jobs = []
		const seen = new Set()
		const lpc = ctx.local.get('peer')?.pc
		const lconn = ctx.local.get('connectionState')
		if (lpc || lconn) {
			seen.add('local')
			const a = ctx.analyzer?.attributes
			const own = lvlOf(Math.max(a?.senderConnectionQualityAudio || 0, a?.senderConnectionQualityVideo || 0))
			jobs.push(measure('local', lpc, 'out', { conn: lconn, own }))
		}
		for (const m of ctx.collection.callParticipantModels) {
			const id = m.get('peerId')
			if (id) {
				seen.add(id)
				jobs.push(measure(id, m.get('peer')?.pc, 'in', { conn: m.get('connectionState'), videoAvailable: m.get('videoAvailable'), videoBlocked: m.get('videoBlocked'), audioAvailable: m.get('audioAvailable') }))
			}
		}
		for (const id of Object.keys(per)) {
			// пересоздание соединения: запись живёт ещё 2 шага, а не пропадает сразу
			if (!seen.has(id) && (per[id].miss = (per[id].miss || 0) + 1) > 2) {
				delete per[id]
				delete k4stats.peers[id]
			}
		}
		await Promise.allSettled(jobs)
		ctx && checkSendZero(lpc, lconn)
		if (ctx && ++tickN % LOG_EVERY === 0) {
			logStats()
		}
	} catch (e) {
		// статистика не должна влиять на звонок
	} finally {
		busy = false
	}
}

/**
 * Начать сбор (вызывать при входе в звонок).
 *
 * @param {object} c
 * @param {string} c.token токен комнаты
 * @param {object} c.local LocalCallParticipantModel
 * @param {object} c.collection CallParticipantCollection
 * @param {object} c.localMedia LocalMediaModel
 * @param {object} [c.analyzer] CallAnalyzer
 */
export function startK4stats(c) {
	stopK4stats()
	ctx = c
	timer = setInterval(tick, STEP_MS)
	lagLast = performance.now()
	lagTimer = setInterval(lagStep, LAG_MS)
	if (typeof document !== 'undefined') {
		for (const [target, ev, name] of [[document, 'visibilitychange'], [document, 'freeze', 'freeze'], [document, 'resume', 'resume']]) {
			const fn = () => calllog('page_state', { st: name || (document.hidden ? 'hidden' : 'visible') })
			target.addEventListener(ev, fn)
			stopWatch.push(() => target.removeEventListener(ev, fn))
		}
	}
	for (const [kind, key] of [['a', 'audioEnabled'], ['v', 'videoEnabled']]) {
		const fn = (_m, on) => { // первым аргументом идёт модель (EmitterMixin)
			if (!on && kind === 'a' && Date.now() - k4stats.hostMute < 1000) {
				return // это выключил ведущий: событие by=host уже записано
			}
			calllog('media', { kind, on: on ? 1 : 0, by: 'self' })
		}
		c.localMedia.on('change:' + key, fn)
		stopWatch.push(() => c.localMedia.off('change:' + key, fn))
	}
	// гость (не вошёл в Nextcloud) получил бы 401: шум в журнале и в серии отказов, пробу не делаем
	getCurrentUser() && axios.get(generateOcsUrl('apps/spreed/api/v1/calllog/{token}/feed', { token: c.token }), { params: { since: Date.now() / 1000 } })
		.then(() => {
			if (ctx === c) {
				k4stats.testmode = true
			}
		}, () => {}) // 403 = не владелец: тихо
	import('../components/CallView/k4draw/useDrawing.js').then(({ state }) => {
		if (ctx !== c) {
			return
		}
		const sid = () => c.local.get('peerId')
		stopWatch.push(watch(() => state.board, (b, old) => {
			if (b) {
				b === sid() && calllog('board_open', { own: 1 }) // пишет только открывший: у остальных доска появляется по сети
			} else if (old === sid()) {
				calllog('board_close')
			}
		}))
		stopWatch.push(watch(() => state.mode, (on) => calllog('draw_mode', { on: on ? 1 : 0 })))
	}).catch(() => {})
}

/**
 * Остановить сбор (выход из звонка, закрытие страницы).
 */
export function stopK4stats() {
	clearInterval(timer)
	clearInterval(lagTimer)
	timer = ctx = lagTimer = null
	lagMax = 0
	zeroTick = -1000
	subs.forEach((off) => off())
	subs.clear()
	curPc = null
	flowed = false
	tickN = 0
	busy = false
	stopWatch.forEach((f) => f())
	stopWatch = []
	Object.keys(per).forEach((k) => delete per[k])
	Object.keys(k4stats.peers).forEach((k) => delete k4stats.peers[k])
	k4stats.testmode = false
}
