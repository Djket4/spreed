/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec: статистика звонка для тестового режима (NAS_CLOUD#189).
// Форма `k4stats` — контракт для интерфейса (вкладка и плитки), см. JSDoc ниже.
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { reactive, watch } from 'vue'
import { calllog } from './calllog.js'

/**
 * Предупреждение по участнику.
 *
 * @typedef {object} K4Warn
 * @property {'drop'|'loss'|'rtt'|'jit'|'novideo'|'noaudio'|'fps'|'own'} w вид: обрыв, потери, задержка, дрожание звука,
 *   нет видео, нет звука, видео рывками, свой канал (только у 'local')
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
 * @type {{ testmode: boolean, peers: Object<string, K4PeerStats> }}
 */
export const k4stats = reactive({
	testmode: false,
	peers: {},
})

const STEP_MS = 3000
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
	const r = { ts: 0, bytes: 0, pkts: 0, lost: 0, ab: 0, vb: 0, jit: null, fps: null, rtt: null, lt: null, rt: null, proto: null }
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
 * @return {{kbps: number|null, loss: number|null, rtt: number|null, jit: number|null, fps: number|null,
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
		path,
		proto: c.proto,
		lt: c.lt,
		rt: c.rt,
		ab: ok && c.ab >= p.ab ? c.ab - p.ab : null,
		vb: ok && c.vb >= p.vb ? c.vb - p.vb : null,
	}
}

const level = (v, yellow, red) => (v === null ? null : v >= red ? 'red' : v >= yellow ? 'yellow' : null)

/**
 * Предупреждения по таблице порогов. Включается после 2 замеров подряд, гаснет после 3 хороших.
 * Чистая: prevState не меняется.
 *
 * @param {{cnt: object, on: object}|null} prevState состояние прошлого вызова (null = начало)
 * @param {object} s результат sample()
 * @param {{conn?: string, videoAvailable?: boolean, audioAvailable?: boolean, own?: 'yellow'|'red'|null}} flags
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
	}
	const changes = []
	for (const w of Object.keys(now)) {
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
			if (c.good >= 3 && on[w]) {
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
let stopWatch = []
const per = {} // id -> { report, st, key, last }

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
	const report = await pc.getStats()
	const e = per[id] || (per[id] = { report: null, st: null, key: null })
	const s = sample(e.report, report, dir)
	e.report = report
	const res = classify(e.st, s, flags)
	e.st = res.state
	e.last = s
	e.flags = flags
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
}

/** Шаг сбора раз в 3 с. */
async function tick() {
	if (!ctx) {
		return
	}
	try {
		const jobs = []
		const seen = new Set()
		const lpc = ctx.local.get('peer')?.pc
		if (lpc) {
			seen.add('local')
			const a = ctx.analyzer?.attributes
			const own = lvlOf(Math.max(a?.senderConnectionQualityAudio || 0, a?.senderConnectionQualityVideo || 0))
			jobs.push(measure('local', lpc, 'out', { conn: ctx.local.get('connectionState'), own }))
		}
		for (const m of ctx.collection.callParticipantModels) {
			const pc = m.get('peer')?.pc
			const id = m.get('peerId')
			if (pc && id) {
				seen.add(id)
				jobs.push(measure(id, pc, 'in', { conn: m.get('connectionState'), videoAvailable: m.get('videoAvailable'), audioAvailable: m.get('audioAvailable') }))
			}
		}
		for (const id of Object.keys(per)) {
			if (!seen.has(id)) {
				delete per[id]
				delete k4stats.peers[id]
			}
		}
		await Promise.allSettled(jobs)
		if (ctx && ++tickN % LOG_EVERY === 0) {
			logStats()
		}
	} catch (e) {
		// статистика не должна влиять на звонок
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
	for (const [kind, key] of [['a', 'audioEnabled'], ['v', 'videoEnabled']]) {
		const fn = (on) => calllog('media', { kind, on: on ? 1 : 0, by: 'self' })
		c.localMedia.on('change:' + key, fn)
		stopWatch.push(() => c.localMedia.off('change:' + key, fn))
	}
	axios.get(generateOcsUrl('apps/spreed/api/v1/calllog/{token}/feed', { token: c.token }), { params: { since: Date.now() / 1000 } })
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
				calllog('board_open', { own: b === sid() ? 1 : 0 })
			} else if (old) {
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
	timer = ctx = null
	tickN = 0
	stopWatch.forEach((f) => f())
	stopWatch = []
	Object.keys(per).forEach((k) => delete per[k])
	Object.keys(k4stats.peers).forEach((k) => delete k4stats.peers[k])
	k4stats.testmode = false
}
