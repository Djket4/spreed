/**
 * ket4tec: k4draw. Рисование поверх показа экрана: транспорт (сигналинг HPB, протокол v1) и состояние.
 * Один модуль на всех: слой, док и кнопка в панели звонка работают с одним `state` и одним набором показов.
 */
import { reactive } from 'vue'
import { useActorStore } from '../../../stores/actor.ts'
import { callParticipantCollection, k4drawSignaling } from '../../../utils/webrtc/index.js'

export const PALETTE = ['#ffd84d', '#ff9a66', '#6cc4ff', '#ff8fc7', '#7fd6d0', '#b98bff']
const TOOLS = ['laser', 'fade', 'marker', 'arrow', 'frame']
const PERM = ['marker', 'arrow', 'frame']
const MAX_TEXT = 200
export const TSIZE = ['s', 'm', 'l']
const MAX_MSG = 32768
const MAX_PTS_MSG = 64
const MAX_PTS_STROKE = 2000
const RATE = 40
const LASER_LIFE = 650

/** Реактивное состояние для UI (кнопка, док). Данные пометок реактивными не делаем: рендерит слой руками. */
export const state = reactive({
	mode: false, // режим рисования включён
	tool: 'laser', // laser | fade | marker | arrow | frame | text | eraser
	tsz: 'm', // размер текста s | m | l
	tl: 0, // сколько секунд живёт текст (0 = остаётся)
	ft: 3, // сколько секунд живёт «гаснущий» маркер
	big: null, // sessionId показывающего, чей показ сейчас крупно
	keys: {}, // sessionId показывающего -> ключ показа (известен, когда пришёл `h`)
	undo: 0, // сколько своих пометок можно отменить в крупном показе
})

/**
 * FNV-1a, как в прототипе.
 *
 * @param s
 */
export function hash(s) {
	let h = 2166136261
	for (const c of s) {
		h ^= c.codePointAt(0)
		h = Math.imul(h, 16777619)
	}
	return h >>> 0
}

const shows = new Map() // k -> { k, presenter, marks: Map(key -> mark), hist: [], authors: {} }
const listeners = new Set()
const emit = (ev) => listeners.forEach((f) => f(ev))
/**
 * @param {Function} fn слушатель событий {t, ...}
 */
export function onDraw(fn) {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

let sig = null
let refs = 0
let myK = null
let queue = []
let tokens = RATE
let lastRefill = 0
let pump = 0
let leaveTimer = 0

const hpb = () => !!sig && typeof sig.doSend === 'function'
const me = () => (sig || k4drawSignaling())?.getSessionId() || ''

/**
 *
 */
export function hasHpb() {
	const s = k4drawSignaling()
	return !!s && typeof s.doSend === 'function'
}

/**
 *
 */
function acquire() {
	if (!refs++) {
		sig = k4drawSignaling()
		sig?.on('message', onMsg)
		pump = setInterval(flush, 33)
	}
	return hpb()
}

/**
 *
 */
function release() {
	if (--refs > 0) {
		return
	}
	refs = 0
	sig?.off('message', onMsg)
	sig = null
	clearInterval(pump)
	queue = []
}

/**
 *
 * @param presenter
 */
export function showOf(presenter) {
	return shows.get(state.keys[presenter]) || null
}

// ── идентичность автора: имя и цвет ──
/**
 *
 * @param sid
 */
export function identity(sid) {
	const show = [...shows.values()].find((s) => s.authors[sid])
	if (sid && sid === me()) {
		const a = useActorStore()
		return { name: 'Вы', color: colorOf(a.actorType === 'users' ? a.actorId : a.displayName) }
	}
	const a = callParticipantCollection.get(sid)?.attributes
	if (a && (a.userId || a.name)) {
		const prev = show?.authors[sid]
		const id = { name: a.name || (prev && prev.name !== prev.key ? prev.name : a.userId), key: a.userId || a.name }
		shows.forEach((s) => {
			s.authors[sid] = id
		})
		return { name: id.name, color: colorOf(id.key) }
	}
	const c = show?.authors[sid]
	return c ? { name: c.name, color: colorOf(c.key) } : { name: 'Гость', color: colorOf('Гость') }
}
const colorOf = (key) => PALETTE[hash(String(key || 'Гость')) % PALETTE.length]

// ── отправка: одна очередь, 40 сообщений/с, пачки точек склеиваются ──
/**
 *
 * @param data
 */
function wire(data) {
	sig.doSend({ type: 'message', message: { recipient: { type: 'call' }, data: { type: 'k4draw', v: 1, ...data } } })
}

/**
 *
 * @param data
 */
function enqueue(data) {
	if (!hpb()) {
		return
	}
	const tail = queue[queue.length - 1]
	if (data.op === 'p' && tail && tail.op === 'p' && tail.id === data.id && tail.k === data.k && tail.pts.length + data.pts.length <= MAX_PTS_MSG * 2) {
		tail.pts = tail.pts.concat(data.pts)
		return
	}
	if (data.op === 'c') {
		const i = queue.findIndex((q) => q.op === 'c')
		if (i >= 0) {
			queue[i] = data
			return
		}
	}
	queue.push(data)
}

/**
 *
 */
function flush() {
	const now = performance.now()
	tokens = Math.min(RATE, tokens + (now - lastRefill) * RATE / 1000)
	lastRefill = now
	while (queue.length && tokens >= 1) {
		const d = queue[0]
		if (d.op === 'p' && d.pts.length > MAX_PTS_MSG * 2) {
			// лишнее остаётся в очереди для следующей пачки
			queue.unshift({ ...d, pts: d.pts.slice(0, MAX_PTS_MSG * 2) })
			queue[1] = { ...d, pts: d.pts.slice(MAX_PTS_MSG * 2) }
		}
		wire(queue.shift())
		tokens--
	}
}

// ── приём ──
/**
 *
 * @param d
 */
function onMsg(d) {
	if (!d || d.type !== 'k4draw' || d.v !== 1) {
		return
	}
	const from = d.from
	if (!from || from === me() || JSON.stringify(d).length > MAX_MSG) {
		return
	}
	apply(d, from)
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : null)
const okPts = (a, max) => Array.isArray(a) && a.length > 0 && a.length % 2 === 0 && a.length <= max * 2 && a.every((v) => typeof v === 'number' && isFinite(v))
/**
 *
 * @param a
 */
function pairs(a) {
	const o = []
	for (let i = 0; i < a.length; i += 2) {
		o.push([Math.min(1, Math.max(0, a[i])), Math.min(1, Math.max(0, a[i + 1]))])
	}
	return o
}
const idOk = (id) => typeof id === 'string' && id.length > 0 && id.length <= 40

/**
 *
 * @param presenter
 * @param k
 */
function setShow(presenter, k) {
	const old = shows.get(state.keys[presenter])
	if (old) {
		old.marks.forEach((m) => clearTimeout(m.timer))
		shows.delete(old.k)
	}
	const show = { k, presenter, marks: new Map(), hist: [], authors: {} }
	shows.set(k, show)
	state.keys[presenter] = k
	emit({ t: 'show', show })
}

/**
 *
 * @param show
 * @param mark
 * @param out
 */
function drop(show, mark, out) {
	clearTimeout(mark.timer)
	if (show.marks.get(mark.key) === mark) {
		show.marks.delete(mark.key)
		emit({ t: 'del', show, mark, out })
		refreshUndo(show)
	}
}

/**
 *
 * @param show
 */
function refreshUndo(show) {
	if (show.presenter === state.big) {
		show.hist = show.hist.filter((key) => show.marks.has(key) && !show.marks.get(key).fading)
		state.undo = show.hist.length
	}
}

/**
 *
 * @param show
 * @param m
 */
function endMark(show, m) {
	m.done = true
	if (m.tool === 'laser') {
		m.timer = setTimeout(() => drop(show, m), LASER_LIFE + 100)
	} else if (m.tool === 'fade' || (m.tool === 'text' && m.ttl)) {
		m.timer = setTimeout(() => {
			m.fading = true
			emit({ t: 'fade', show, mark: m })
			refreshUndo(show)
			m.timer = setTimeout(() => drop(show, m), 820)
		}, m.ttl * 1000)
	}
	emit({ t: 'end', show, mark: m })
}

/**
 *
 * @param show
 * @param by
 * @param id
 * @param tool
 * @param ttl
 */
function addMark(show, by, id, tool, ttl) {
	const key = by + '/' + id
	if (show.marks.has(key) || show.marks.size > 3000) {
		return null
	}
	const m = { key, id, by, tool, ttl, pts: [], ts: [], done: false }
	show.marks.set(key, m)
	return m
}

/**
 *
 * @param d
 * @param from
 */
function apply(d, from) {
	const op = d.op
	if (op === 'q') {
		if (myK) {
			wire({ op: 'h', k: myK })
			sendState(shows.get(myK))
		}
		return
	}
	if (typeof d.k !== 'string') {
		return
	}
	if (op === 'h') {
		if (d.k.startsWith(from + ':') && state.keys[from] !== d.k) {
			setShow(from, d.k)
		}
		return
	}
	const show = shows.get(d.k)
	if (!show) {
		return
	}
	identity(from) // запомнить имя автора, пока он в звонке
	switch (op) {
		case 's': {
			if (!idOk(d.id) || !TOOLS.includes(d.tool)) {
				return
			}
			const ttl = d.tool === 'fade' ? Math.min(30, Math.max(1, Number(d.ttl) || 3)) : 0
			const m = addMark(show, from, d.id, d.tool, ttl)
			m && emit({ t: 'add', show, mark: m })
			break
		}
		case 'p': {
			const m = show.marks.get(from + '/' + d.id)
			if (!m || m.done || !okPts(d.pts, MAX_PTS_MSG)) {
				return
			}
			const now = performance.now()
			let P = pairs(d.pts)
			if (m.tool === 'arrow' || m.tool === 'frame') {
				P = [m.pts[0] || P[0], P[P.length - 1]]
				m.pts = P
			} else if (m.pts.length + P.length <= MAX_PTS_STROKE) {
				P.forEach((p) => {
					m.pts.push(p)
					m.ts.push(now)
				})
				if (m.tool === 'laser') {
					while (m.ts.length && now - m.ts[0] > LASER_LIFE) {
						m.ts.shift()
						m.pts.shift()
					}
				}
			} else {
				return
			}
			emit({ t: 'pts', show, mark: m })
			break
		}
		case 'e': {
			const m = show.marks.get(from + '/' + d.id)
			m && !m.done && endMark(show, m)
			break
		}
		case 't': {
			// текст: повторный `t` с тем же id = правка; длиннее 200 символов отбрасываем
			const x = num(d.x)
			const y = num(d.y)
			const text = typeof d.text === 'string' ? d.text.trim() : ''
			if (!idOk(d.id) || x === null || y === null || !text || d.text.length > MAX_TEXT || !TSIZE.includes(d.size)) {
				return
			}
			const ttl = Math.min(30, Math.max(0, Number(d.ttl) || 0))
			let m = show.marks.get(from + '/' + d.id)
			if (m && m.tool !== 'text') {
				return
			}
			if (m) {
				clearTimeout(m.timer)
				m.fading = false
				Object.assign(m, { ttl, x, y, size: d.size, text, pts: [[x, y]] })
				emit({ t: 'upd', show, mark: m })
			} else {
				m = addMark(show, from, d.id, 'text', ttl)
				if (!m) {
					return
				}
				Object.assign(m, { x, y, size: d.size, text, pts: [[x, y]] })
				emit({ t: 'add', show, mark: m })
			}
			endMark(show, m)
			break
		}
		case 'm': {
			const x = num(d.x)
			const y = num(d.y)
			x !== null && y !== null && emit({ t: 'ping', show, by: from, x, y })
			break
		}
		case 'c': {
			const x = num(d.x)
			const y = num(d.y)
			x !== null && y !== null && emit({ t: 'cur', show, by: from, x, y })
			break
		}
		case 'x':
			if (Array.isArray(d.ids)) {
				d.ids.slice(0, 200).forEach((id) => {
					const m = idOk(id) && show.marks.get(from + '/' + id)
					m && drop(show, m, true)
				})
			}
			break
		case 'X':
			show.marks.forEach((m) => m.by === from && drop(show, m, true))
			break
		case 'Z':
			if (from === show.presenter) {
				show.marks.forEach((m) => drop(show, m, true))
			}
			break
		case 'S': // снимок сохранён: только для счётчика и тоста
			emit({ t: 'snap', show, by: from, n: Math.min(999, Math.max(1, Number(d.n) || 1)), name: identity(from).name })
			break
		case 'r':
			if (from === show.presenter && Array.isArray(d.marks)) {
				d.marks.slice(0, 500).forEach((r) => {
					if (!r || !idOk(r.id) || typeof r.author !== 'string' || r.author.length > 300 || (r.tool !== 'text' && !PERM.includes(r.tool))) {
						return
					}
					const txt = r.tool === 'text'
					if (txt ? (num(r.x) === null || num(r.y) === null || typeof r.text !== 'string' || !r.text.trim() || r.text.length > MAX_TEXT || !TSIZE.includes(r.size)) : !okPts(r.pts, MAX_PTS_STROKE)) {
						return
					}
					const m = addMark(show, r.author, r.id, r.tool, 0)
					if (!m) {
						return
					}
					if (txt) {
						Object.assign(m, { x: num(r.x), y: num(r.y), size: r.size, text: r.text.trim() })
						m.pts = [[m.x, m.y]]
					} else {
						m.pts = pairs(r.pts)
					}
					if (typeof r.name === 'string' && !show.authors[r.author]) {
						show.authors[r.author] = { name: r.name.slice(0, 60), key: String(r.uid || r.name).slice(0, 60) }
					}
					emit({ t: 'add', show, mark: m })
					endMark(show, m)
				})
			}
			break
	}
	refreshUndo(show)
}

// Ответ на `q`: все постоянные пометки показа, включая авторов, которые ушли. Порциями < 32 KiB.
/**
 *
 * @param show
 */
function sendState(show) {
	let batch = []
	let n = 0
	const out = () => {
		batch.length && wire({ op: 'r', k: show.k, marks: batch })
		batch = []
		n = 0
	}
	show.marks.forEach((m) => {
		if (!(PERM.includes(m.tool) || (m.tool === 'text' && !m.ttl)) || !m.done || !m.pts.length) {
			return
		}
		const a = show.authors[m.by] || {}
		const w = m.tool === 'text' ? 120 : m.pts.length * 2
		if (n + w > 2500) {
			out()
		}
		n += w
		if (m.tool === 'text') {
			batch.push({ id: m.id, author: m.by, tool: 'text', ttl: 0, x: m.x, y: m.y, size: m.size, text: m.text, name: a.name, uid: a.key })
			return
		}
		batch.push({ id: m.id, author: m.by, tool: m.tool, ttl: 0, pts: m.pts.flat().map((v) => +v.toFixed(4)), name: a.name, uid: a.key })
	})
	out()
}

// ── программный интерфейс для слоя и дока ──

/** Показывающий начал показ: объявить ключ. */
export function startShow() {
	if (myK) {
		return
	}
	if (!acquire()) {
		release()
		return
	}
	myK = me() + ':' + Date.now()
	setShow(me(), myK)
	wire({ op: 'h', k: myK })
}

/**
 *
 */
export function endShow() {
	if (!myK) {
		return
	}
	const show = shows.get(myK)
	show?.marks.forEach((m) => clearTimeout(m.timer))
	shows.delete(myK)
	delete state.keys[me()]
	emit({ t: 'show', show: { presenter: me(), marks: new Map() } })
	myK = null
	release()
}

/**
 * Слой появился: подписаться и (если показ чужой) спросить состояние.
 *
 * @param {string} presenter sessionId показывающего
 * @return {Function} отписка
 */
export function join(presenter) {
	if (!acquire()) {
		release()
		return () => {}
	}
	clearTimeout(leaveTimer)
	state.big = presenter
	let tries = 0
	const ask = () => {
		if (state.keys[presenter] || presenter === me() || ++tries > 20) {
			return
		}
		wire({ op: 'q' })
		timer = setTimeout(ask, tries < 6 ? 1500 : 5000)
	}
	let timer = setTimeout(ask, 0)
	return () => {
		clearTimeout(timer)
		release()
		// слой может тут же пересоздаться (перерисовка звонка): режим рисования не сбрасываем сразу
		leaveTimer = setTimeout(() => {
			if (state.big === presenter) {
				state.big = null
				state.mode = false
				state.undo = 0
			}
		}, 600)
	}
}

const rid = () => Math.random().toString(36).slice(2, 12)
const r4 = (v) => +Math.min(1, Math.max(0, v)).toFixed(4)

/**
 *
 * @param show
 * @param data
 */
function local(show, data) {
	const d = { k: show.k, ...data }
	apply({ ...d }, me())
	enqueue(d)
}

/**
 *
 * @param show
 * @param tool
 * @param p
 */
export function strokeStart(show, tool, p) {
	const id = rid()
	local(show, { op: 's', id, tool, ttl: tool === 'fade' ? state.ft : 0 })
	const m = show.marks.get(me() + '/' + id)
	strokePoint(show, m, p)
	return m
}

/**
 *
 * @param show
 * @param m
 * @param p
 */
export function strokePoint(show, m, p) {
	m && !m.done && local(show, { op: 'p', id: m.id, pts: [r4(p[0]), r4(p[1])] })
}

/**
 *
 * @param show
 * @param m
 */
export function strokeEnd(show, m) {
	if (!m || m.done) {
		return
	}
	local(show, { op: 'e', id: m.id })
	if (m.tool !== 'laser') {
		show.hist.push(m.key)
		refreshUndo(show)
	}
}

/**
 *
 * @param show
 * @param m
 */
export function strokeCancel(show, m) {
	m && local(show, { op: 'x', ids: [m.id] })
}

/**
 * Зафиксировать текст (новый или правку с тем же id). Пустой текст у правки стирает пометку.
 *
 * @param show
 * @param {object} t {id?, x, y, size, text}
 */
export function textPut(show, t) {
	const text = t.text.trim().slice(0, MAX_TEXT)
	const old = t.id && show.marks.get(me() + '/' + t.id)
	if (!text) {
		old && eraseMarks(show, [old])
		return
	}
	const id = t.id || rid()
	local(show, { op: 't', id, x: r4(t.x), y: r4(t.y), size: t.size, text, ttl: old ? old.ttl : state.tl })
	const m = show.marks.get(me() + '/' + id)
	if (m && !old) {
		show.hist.push(m.key)
		refreshUndo(show)
	}
}

/**
 *
 * @param show
 * @param p
 */
export function ping(show, p) {
	local(show, { op: 'm', x: r4(p[0]), y: r4(p[1]) })
}

/**
 *
 * @param show
 * @param p
 */
export function cursor(show, p) {
	const now = performance.now()
	if (now - (cursor.t || 0) < 66) {
		return
	}
	cursor.t = now
	enqueue({ k: show.k, op: 'c', x: r4(p[0]), y: r4(p[1]) })
}

/**
 *
 * @param show
 * @param marks
 */
export function eraseMarks(show, marks) {
	marks.length && local(show, { op: 'x', ids: marks.map((m) => m.id) })
}

/**
 *
 */
export function undo() {
	const show = showOf(state.big)
	const key = show?.hist.pop()
	const m = key && show.marks.get(key)
	m && eraseMarks(show, [m])
	show && refreshUndo(show)
}

/**
 *
 */
export function clearMine() {
	const show = showOf(state.big)
	show && local(show, { op: 'X' })
}

/** «Очистить всё»: только у показывающего (остальные такое сообщение отбросят). */
export function clearAll() {
	const show = showOf(state.big)
	show && show.presenter === me() && local(show, { op: 'Z' })
}

/**
 * Сообщить остальным (и себе), что снимок сохранён.
 *
 * @param n сколько снимков в этом показе
 */
export function sendSnap(n) {
	const show = showOf(state.big)
	show && local(show, { op: 'S', n })
}

export const isPresenter = () => !!state.big && state.big === me()
export const myId = me

// ── пружина → CSS linear() (формула из прототипа) ──
/**
 *
 * @param z
 * @param w
 * @param d
 * @param n
 */
function spring(z, w, d, n = 40) {
	const o = []
	for (let i = 0; i <= n; i++) {
		const x = d * i / n
		let v
		if (z < 1) {
			const wd = w * Math.sqrt(1 - z * z)
			v = 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + z / Math.sqrt(1 - z * z) * Math.sin(wd * x))
		} else {
			v = 1 - Math.exp(-w * x) * (1 + w * x)
		}
		o.push(v.toFixed(4))
	}
	o[n] = '1'
	return 'linear(' + o.join(',') + ')'
}
export const SP = { in: spring(0.78, 16, 0.48), menu: spring(0.72, 20, 0.36), pop: spring(0.5, 22, 0.5) }
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
export const LIFE = LASER_LIFE
