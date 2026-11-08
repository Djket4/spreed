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
const IN_RATE = 60 // входящих сообщений в секунду от одного автора
const Q_GAP = 2000 // показывающий отвечает на `q` не чаще раза в 2 с
const MAX_PINGS = 5 // активных отметок `m` на автора
const PING_LIFE = 2400
const STROKE_IDLE = 5000 // штрих без новых точек и без `e` закрываем
const MAX_PERM = 500 // постоянных пометок на автора
const MAX_TEMP = 200 // laser/fade на автора
const MAX_PERM_SHOW = 3000 // постоянных пометок на весь показ (авторы `r` выдуманные, лимит на автора обходится)
const RE_Q = 10000 // нет `last` за 10 с после `h` -> повторный `q`, не чаще
const OLD_QUIET = 3000 // отправитель без `last` (старый): 3 с тишины = синхронизирован
const IDLE_GC = 60000 // записи buckets/pings молчащих авторов чистим через 60 с
const R_LIMIT = 30000 // длина JSON одного `r`

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
let queue = [] // только живые сообщения; по одному на id (p склеены, t/c — последняя версия)
let snap = null // полоса досинхронизации: { k, parts, i, again }
let laneTok = 0
let laneAt = 0
const syncs = {} // показывающий -> { t, done, old, n } состояние досинхронизации у получателя
let tokens = RATE
let lastRefill = 0
let pump = 0
let leaveTimer = 0
let leaving = null
let qTimer = 0
let lastQ = 0
let lastGc = 0
const buckets = new Map() // автор -> { t, n } token bucket приёма
const pings = new Map() // автор -> время активных отметок

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
	snap = null
	buckets.clear()
	pings.clear()
	// приём остановлен: всё чужое состояние устарело, новый слой обязан спросить `q`
	Object.keys(state.keys).forEach((p) => p !== me() && dropShow(p))
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
	// живое не выкидываем: одно сообщение на id, очередь ограничена числом id
	// p склеиваем без лимита: flush сам режет по MAX_PTS_MSG
	const same = (q) => q.op === data.op && q.k === data.k && (data.op === 'c' || q.id === data.id)
	if (data.op === 'p' || data.op === 't' || data.op === 'c') {
		let i = -1
		queue.forEach((q, j) => same(q) && (i = j))
		if (i >= 0) {
			if (data.op === 'p') {
				const room = MAX_PTS_STROKE * 2 - queue[i].pts.length
				room > 0 && (queue[i] = { ...queue[i], pts: queue[i].pts.concat(data.pts.slice(0, room)) })
			} else {
				queue[i] = data
			}
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
	// полоса снимка: только когда живых нет, и не больше половины бюджета
	laneTok = Math.min(2, laneTok + (now - laneAt) * RATE / 2000)
	laneAt = now
	if (snap && snap.k !== myK) {
		snap = null
	}
	if (snap && !queue.length && laneTok >= 1 && tokens >= 1) {
		const last = snap.i === snap.parts.length - 1
		const show = shows.get(snap.k)
		const marks = snap.parts[snap.i++].map((key) => show && ser(show, show.marks.get(key))).filter(Boolean)
		wire({ op: 'r', k: snap.k, marks, last: last ? 1 : 0 })
		tokens--
		laneTok--
		if (last) {
			const again = snap.again
			snap = null
			again && startSnap() // `q` пришёл во время прохода: ещё один (целиком)
		}
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
	const now = performance.now()
	if (now - lastGc > 10000) {
		lastGc = now
		buckets.forEach((v, a) => now - v.t > IDLE_GC && buckets.delete(a))
		pings.forEach((v, a) => (!v.length || now - v[v.length - 1] > IDLE_GC) && pings.delete(a))
	}
	const b = buckets.get(from) || { t: now, n: IN_RATE }
	b.n = Math.min(IN_RATE, b.n + (now - b.t) * IN_RATE / 1000)
	b.t = now
	buckets.set(from, b)
	if (b.n < 1) {
		return
	}
	b.n--
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
 * @param m
 */
function stop(m) {
	clearTimeout(m.timer)
	clearTimeout(m.idle)
}

/**
 * Забыть показ и его ключ: новый слой снова спросит `q`.
 *
 * @param presenter
 */
function dropShow(presenter) {
	const old = shows.get(state.keys[presenter])
	old?.marks.forEach(stop)
	old && shows.delete(old.k)
	delete state.keys[presenter]
	delete syncs[presenter]
}

/**
 *
 * @param presenter
 * @param k
 */
function setShow(presenter, k) {
	dropShow(presenter)
	const show = { k, presenter, marks: new Map(), hist: [], authors: {}, cnt: {}, perm: 0 }
	shows.set(k, show)
	state.keys[presenter] = k
	syncs[presenter] = { t: performance.now(), done: false, old: false, n: 0 }
	emit({ t: 'show', show })
}

const isTemp = (tool) => tool === 'laser' || tool === 'fade'
const cntKey = (by, tool) => by + '|' + isTemp(tool)

/**
 *
 * @param show
 * @param mark
 * @param out
 */
function drop(show, mark, out) {
	stop(mark)
	if (show.marks.get(mark.key) === mark) {
		show.marks.delete(mark.key)
		show.cnt[cntKey(mark.by, mark.tool)]--
		isTemp(mark.tool) || show.perm--
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
	stop(m)
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
	if (show.marks.has(key)) {
		return null
	}
	const temp = isTemp(tool)
	const ck = cntKey(by, tool)
	if ((show.cnt[ck] || 0) >= (temp ? MAX_TEMP : MAX_PERM) || (!temp && show.perm >= MAX_PERM_SHOW)) {
		return null
	}
	show.cnt[ck] = (show.cnt[ck] || 0) + 1
	temp || show.perm++
	const m = { key, id, by, tool, ttl, pts: [], ts: [], done: false }
	show.marks.set(key, m)
	return m
}

/**
 * Чужой штрих без новых точек дольше STROKE_IDLE закрываем: иначе он висит вечно.
 *
 * @param show
 * @param m
 * @param from
 */
function idle(show, m, from) {
	if (from !== me()) {
		clearTimeout(m.idle)
		m.idle = setTimeout(() => !m.done && endMark(show, m), STROKE_IDLE)
	}
}

/**
 *
 * @param d
 * @param from
 */
function apply(d, from) {
	const op = d.op
	if (op === 'q') {
		if (myK && !qTimer) {
			// несколько `q` в окне — один ответ, не чаще раза в Q_GAP
			qTimer = setTimeout(() => {
				qTimer = 0
				lastQ = performance.now()
				if (myK && snap) {
					snap.again = true // проход идёт: не перезапускаем, пройдём ещё раз после последней части
				} else if (myK) {
					startSnap()
				}
			}, Math.max(0, lastQ + Q_GAP - performance.now()))
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
			if (m) {
				idle(show, m, from)
				emit({ t: 'add', show, mark: m })
			}
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
			idle(show, m, from)
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
			const now = performance.now()
			const act = (pings.get(from) || []).filter((t) => now - t < PING_LIFE)
			pings.set(from, act)
			if (act.length >= MAX_PINGS) {
				return
			}
			x !== null && y !== null && act.push(now) && emit({ t: 'ping', show, by: from, x, y })
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
				const sy = syncs[from]
				if (sy) {
					sy.t = performance.now()
					sy.old = !('last' in d)
					d.last === 1 && (sy.done = true)
				}
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
 */
function startSnap() {
	if (!myK) {
		return
	}
	enqueue({ op: 'h', k: myK })
	snap = { k: myK, parts: buildState(shows.get(myK)), i: 0, again: false }
}

/**
 * Пометка для `r` или null, если в снимок не идёт.
 *
 * @param show
 * @param m
 */
function ser(show, m) {
	if (!m || !(PERM.includes(m.tool) || (m.tool === 'text' && !m.ttl)) || !m.done || !m.pts.length) {
		return null
	}
	const a = show.authors[m.by] || {}
	return m.tool === 'text'
		? { id: m.id, author: m.by, tool: 'text', ttl: 0, x: m.x, y: m.y, size: m.size, text: m.text, name: a.name, uid: a.key }
		: { id: m.id, author: m.by, tool: m.tool, ttl: 0, pts: m.pts.flat().map((v) => +v.toFixed(4)), name: a.name, uid: a.key }
}

/**
 * Части снимка — ключи пометок; содержимое берётся в момент отправки части (flush), поэтому
 * стёртое после начала снимка не воскресает, а правка текста не откатывается старой версией.
 *
 * @param show
 */
function buildState(show) {
	const parts = []
	let batch = []
	let n = 0
	const base = JSON.stringify({ type: 'k4draw', v: 1, op: 'r', k: show.k, marks: [], from: 'x'.repeat(60) }).length
	const out = () => {
		batch.length && parts.push(batch)
		batch = []
		n = base
	}
	n = base
	show.marks.forEach((m) => {
		const e = ser(show, m)
		if (!e) {
			return
		}
		const w = JSON.stringify(e).length + 1
		if (base + w > R_LIMIT) {
			return // одна пометка не влезает в сообщение
		}
		if (n + w > R_LIMIT) {
			out()
		}
		n += w
		batch.push(m.key)
	})
	out()
	parts.length || parts.push([]) // пустой показ: всё равно нужна часть с last
	return parts
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
	dropShow(me())
	queue = queue.filter((q) => q.k !== myK)
	snap = null
	clearTimeout(qTimer)
	qTimer = 0
	emit({ t: 'show', show: { presenter: me(), marks: new Map() } })
	myK = null
	release()
}

/**
 * Слой чужого показа ушёл насовсем: приём остановлен, состояние устарело.
 *
 * @param presenter
 */
function forget(presenter) {
	presenter !== me() && dropShow(presenter)
}

let bound = null
const sync = () => (bound?.attributes.localScreen ? startShow() : endShow())

/**
 * Привязать показ к самому локальному экранному потоку, а не к экземпляру ScreenShare:
 * закрепление камеры размонтирует компонент, но остановка показа всё равно должна закрыть `k`.
 *
 * @param {object} model LocalMediaModel
 */
export function bindLocalScreen(model) {
	if (bound !== model) {
		bound?.off('change:localScreen', sync)
		bound = model
		model.on('change:localScreen', sync)
	}
	sync()
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
	// прошлый чужой показ, который не успели закрыть: забыть, иначе известный ключ запретит `q`
	leaving && leaving !== presenter && forget(leaving)
	leaving = null
	state.big = presenter
	let tries = 0
	const ask = () => {
		if (presenter === me()) {
			return
		}
		if (state.keys[presenter]) {
			// `h` есть; ждём `last`. Старый отправитель (r без last): 3 с тишины = готово
			const sy = syncs[presenter]
			const now = performance.now()
			if (!sy || sy.done) {
				return
			}
			if (sy.old && now - sy.t >= OLD_QUIET) {
				sy.done = true
				return
			}
			if (!sy.old && now - sy.t >= RE_Q && sy.n++ < 6) {
				sy.t = now
				wire({ op: 'q' })
			}
			timer = setTimeout(ask, 1000)
			return
		}
		if (++tries > 20) {
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
		leaving = presenter
		leaveTimer = setTimeout(() => {
			leaving = null
			forget(presenter)
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
