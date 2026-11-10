/**
 * ket4tec: k4draw. Рисование поверх показа экрана: транспорт (сигналинг HPB, протокол v1) и состояние.
 * Один модуль на всех: слой, док и кнопка в панели звонка работают с одним `state` и одним набором показов.
 */
import { reactive } from 'vue'
import store from '../../../store/index.js'
import { useActorStore } from '../../../stores/actor.ts'
import { useTokenStore } from '../../../stores/token.ts'
import { beforeLeaveCall, callParticipantCollection, k4drawSignaling } from '../../../utils/webrtc/index.js'

export const PALETTE = ['#ffd84d', '#ff9a66', '#6cc4ff', '#ff8fc7', '#7fd6d0', '#b98bff', '#a6e36b', '#ff6b6b']
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
export const WSZ = [1, 2, 4] // толщина пометки: тонкая / средняя / толстая (множитель к базовой)
/**
 * @param k ключ
 */
function ls(k) {
	try {
		return localStorage.getItem('k4draw.' + k)
	} catch (e) {
		return null
	}
}
/**
 * @param k ключ
 * @param v значение
 */
function lsSet(k, v) {
	try {
		localStorage.setItem('k4draw.' + k, v)
	} catch (e) {
		// хранилище закрыто: выбор живёт до перезагрузки
	}
}

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
	board: null, // sessionId того, кто открыл доску (одна на звонок)
	boardHidden: false, // доска скрыта только у себя
	ask: false, // «Сохранить рисунок?» перед закрытием своей доски
	gd: true, // гости рисуют (переключает модератор)
	col: PALETTE.includes(ls('col')) ? ls('col') : '', // свой цвет пометок ('' = цвет автора, назначенный автоматически)
	sz: WSZ.includes(+ls('sz')) ? +ls('sz') : 1, // своя толщина
})

// ── доска и права ──
// Доска — тот же показ, только без экрана: ключ `sid:b<время>`, соотношение сторон задаёт открывший (`h.ar`).
export const isBoard = (k) => /:b\d+$/.test(k || '')
const MODS = [1, 2, 6] // владелец, модератор, гость-модератор
/**
 *
 * @param sid
 */
function attendee(sid) {
	const nc = callParticipantCollection.get(sid)?.attributes.nextcloudSessionId
	return nc ? store.getters.findParticipant(useTokenStore().token, { sessionId: nc }) : null
}
export const amMod = () => !!store.getters.isModerator
export const amGuest = () => useActorStore().actorType !== 'users'
// модератор только по типу 1/2/6: из списка участников, а у гостя (списка нет) — из сигналинга (webrtc.js usersChanged)
const isMod = (sid) => (sid === me() ? amMod() : MODS.includes(attendee(sid)?.participantType ?? callParticipantCollection.get(sid)?.attributes.participantType))
const isGuestSid = (sid) => (sid === me() ? amGuest() : (attendee(sid) ? ['guests', 'emails'].includes(attendee(sid).actorType) : !callParticipantCollection.get(sid)?.attributes.userId))
/** Можно ли мне рисовать сейчас. */
export const canDraw = () => state.gd || !amGuest()
/**
 *
 * @param k
 * @param cols
 */
function hOf(k, cols) {
	const s = shows.get(k)
	return { op: 'h', k, ...(shows.get(k)?.presenter === me() && !k.startsWith(me() + ':') ? { ho: 1 } : {}), ...(cols ? { cols } : {}), ...(s?.ar ? { ar: s.ar } : {}), gd: state.gd ? 1 : 0 }
}

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

const shows = new Map() // k -> { k, presenter, marks: Map(key -> mark), hist: [], authors: {}, cols: {} }
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
 * Цвет автора: из карты показа на экране (showOf(state.big).cols), пока её нет — хэш ключа.
 *
 * @param sid
 * @param key
 */
function colorFor(sid, key) {
	const i = showOf(state.big)?.cols[sid] // только карта показа, который на экране: чужой `h` её не подменит
	return PALETTE[i ?? hash(String(key || 'Гость')) % PALETTE.length]
}

/**
 *
 * @param sid
 */
export function identity(sid) {
	const show = [...shows.values()].find((s) => s.authors[sid])
	if (sid && sid === me()) {
		const a = useActorStore()
		const key = a.actorType === 'users' ? a.actorId : a.displayName
		return { name: 'Вы', key, color: colorFor(sid, key) }
	}
	const a = callParticipantCollection.get(sid)?.attributes
	if (a && (a.userId || a.name)) {
		const prev = show?.authors[sid]
		const id = { name: a.name || (prev && prev.name !== prev.key ? prev.name : a.userId), key: a.userId || a.name }
		shows.forEach((s) => {
			s.authors[sid] = id
		})
		return { name: id.name, key: id.key, color: colorFor(sid, id.key) }
	}
	const c = show?.authors[sid]
	return c ? { name: c.name, key: c.key, color: colorFor(sid, c.key) } : { name: 'Гость', key: 'Гость', color: colorFor(sid, 'Гость') }
}

// Цвета назначает показывающий при первой пометке автора и не меняет до конца показа; карта уходит в `h`.
const COLS_MAX = 500
let colsTimer = 0

/**
 * Первый свободный индекс палитры от хэша ключа автора.
 *
 * @param show
 * @param sid
 */
function assignCol(show, sid) {
	if (show.cols[sid] !== undefined || Object.keys(show.cols).length >= COLS_MAX) {
		return
	}
	const used = new Set(Object.values(show.cols))
	let i = hash(String(identity(sid).key || 'Гость')) % PALETTE.length
	for (let n = 0; n < PALETTE.length && used.has(i); n++) {
		i = (i + 1) % PALETTE.length
	}
	show.cols[sid] = i
	clearTimeout(colsTimer)
	colsTimer = setTimeout(() => {
		colsTimer = 0
		myK && show.k === myK && enqueue(hOf(myK, colsOut(show)))
	}, 300)
}

/**
 * Карта цветов, влезающая в сообщение.
 *
 * @param show
 */
function colsOut(show) {
	const out = {}
	let len = 0
	for (const [sid, i] of Object.entries(show.cols)) {
		len += sid.length + 6
		if (len > R_LIMIT) {
			break
		}
		out[sid] = i
	}
	return out
}

/**
 * Принять карту от показывающего (с валидацией). Возвращает true, если цвета изменились.
 *
 * @param show
 * @param cols
 */
function applyCols(show, cols) {
	if (!cols || typeof cols !== 'object' || Array.isArray(cols)) {
		return
	}
	const e = Object.entries(cols)
	if (e.length > COLS_MAX || e.some(([sid, i]) => sid.length > 300 || !Number.isInteger(i) || i < 0 || i >= PALETTE.length)) {
		return
	}
	let ch = false
	e.forEach(([sid, i]) => {
		if (show.cols[sid] !== i) {
			show.cols[sid] = i
			ch = true
		}
	})
	ch && emit({ t: 'show', show }) // перекрасить пометки и подписи
}

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
	if (data.op === 'p' || data.op === 't' || data.op === 'c' || data.op === 'g') {
		let i = -1
		queue.forEach((q, j) => same(q) && (i = j))
		if (i >= 0) {
			if (data.op === 'p') {
				const room = MAX_PTS_STROKE * 2 - queue[i].pts.length
				let pts = room > 0 ? queue[i].pts.concat(data.pts.slice(0, room)) : queue[i].pts
				const pr = queue[i].pr && data.pr && room > 0 ? queue[i].pr.concat(data.pr.slice(0, room / 2)) : undefined
				// при переполнении у arrow/frame важен конец: последняя пара заменяется актуальной (marker: хвост отбрасывается)
				const tool = shows.get(data.k)?.marks.get(me() + '/' + data.id)?.tool
				if ((tool === 'arrow' || tool === 'frame') && data.pts.length > Math.max(room, 0) && data.pts.length >= 2) {
					pts = pts.slice(0, -2).concat(data.pts.slice(-2))
				}
				queue[i] = { ...queue[i], pts, pr: pts.length === queue[i].pts.length ? queue[i].pr : pr }
				queue[i].pr || delete queue[i].pr
			} else {
				queue[i] = data
			}
			return
		}
	}
	queue.push(data)
}

/**
 * Сессия сигналинга сменилась посреди своего показа (переподключение с новой сессией — «переподключился к
 * вызову», бывает у фоновой вкладки Safari). Зрители принимают `h` только с ключом от id отправителя, поэтому
 * тот же показ (с пометками) получает ключ от нового id; старый id остаётся псевдонимом для слоя, смонтированного с ним.
 */
function rekey() {
	const sid = me()
	if (!myK || !sid || myK.startsWith(sid + ':')) {
		return
	}
	const old = myK
	myK = sid + ':' + Date.now()
	const s = shows.get(old)
	if (s) {
		shows.delete(old)
		s.k = myK
		shows.set(myK, s)
	}
	Object.keys(state.keys).forEach((p) => state.keys[p] === old && (state.keys[p] = myK))
	state.keys[sid] = myK
	queue = queue.map((q) => (q.k === old ? { ...q, k: myK } : q))
	snap = null
	wire(hOf(myK))
}

/**
 *
 */
function flush() {
	rekey()
	const now = performance.now()
	tokens = Math.min(RATE, tokens + (now - lastRefill) * RATE / 1000)
	lastRefill = now
	while (queue.length && tokens >= 1) {
		const d = queue[0]
		if (d.op === 'p' && d.pts.length > MAX_PTS_MSG * 2) {
			// лишнее остаётся в очереди для следующей пачки
			queue.unshift({ ...d, pts: d.pts.slice(0, MAX_PTS_MSG * 2), ...(d.pr ? { pr: d.pr.slice(0, MAX_PTS_MSG) } : {}) })
			queue[1] = { ...d, pts: d.pts.slice(MAX_PTS_MSG * 2), ...(d.pr ? { pr: d.pr.slice(MAX_PTS_MSG) } : {}) }
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
		const show = shows.get(snap.k)
		const keys = snap.parts[snap.i++]
		const items = keys.map((key) => [key, show && ser(show, show.marks.get(key))]).filter((e) => e[1])
		// после правок текстов часть могла вырасти: берём порцию <= R_LIMIT, остаток — следующей частью
		let len = rEnv(snap.k)
		let cut = items.findIndex((e) => (len += JSON.stringify(e[1]).length + 1) > R_LIMIT)
		cut = cut < 1 ? (cut === 0 ? 1 : items.length) : cut
		const marks = items.slice(0, cut).map((e) => e[1])
		cut < items.length && snap.parts.splice(snap.i, 0, items.slice(cut).map((e) => e[0]))
		const last = snap.i === snap.parts.length
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

/**
 * Свой показ по ключу, а не по id сессии: сессия сигналинга может смениться посреди показа
 * (переподключение HPB в фоновой вкладке Safari), а показ и слой остаются под прежним id.
 */
export const myShow = () => (myK && shows.get(myK)) || null

/** Отправить очередь сейчас (мост k4draw: в фоновой вкладке Safari interval flush почти спит, часы ведёт приложение). */
export function pumpNow() {
	sig && flush()
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

const pendG = new Map() // перенос рамки, пришедший раньше её снимка: ключ пометки → две точки
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
 * Выбрать свой цвет и запомнить.
 *
 * @param c цвет из PALETTE или '' (автоматический)
 */
export function setColor(c) {
	state.col = PALETTE.includes(c) ? c : ''
	lsSet('col', state.col)
}

/**
 * Выбрать свою толщину и запомнить.
 *
 * @param n 1 | 2 | 4
 */
export function setSize(n) {
	state.sz = WSZ.includes(n) ? n : 1
	lsSet('sz', state.sz)
}

/** Цвет моих новых пометок. */
export const myColor = () => state.col || identity(me()).color

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
	pendG.clear() // отложенные переносы относятся к ушедшему показу
}

/**
 *
 * @param presenter
 * @param k
 */
function setShow(presenter, k) {
	dropShow(presenter)
	const show = { k, presenter, marks: new Map(), hist: [], authors: {}, cols: {}, cnt: {}, perm: 0 }
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
	show.k === myK && assignCol(show, by)
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
	if (op === 'G') {
		if (isMod(from)) {
			state.gd = !!d.on
			!canDraw() && (state.mode = false)
		}
		return
	}
	if (op === 'q') {
		// модератор напоминает новичку, что гости не рисуют
		if (!state.gd && amMod() && performance.now() - (apply.g || 0) > Q_GAP) {
			apply.g = performance.now()
			enqueue({ op: 'G', on: 0 })
		}
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
		// ket4tec: k4draw. `ho`: новый владелец доски после ухода открывшего; принимаем, если прежнего владельца уже нет в звонке
		const ho = d.ho === 1 && isBoard(d.k) && from !== me() && !!callParticipantCollection.get(from) && !callParticipantCollection.get(shows.get(d.k)?.presenter || d.k.slice(0, d.k.lastIndexOf(':')))
		if (ho && shows.has(d.k) && shows.get(d.k).presenter !== from) {
			moveBoard(shows.get(d.k), from)
		}
		if (d.k.startsWith(from + ':') || ho) {
			state.keys[from] !== d.k && setShow(from, d.k)
			const s = shows.get(d.k)
			applyCols(s, d.cols) // повторный `h` того же ключа состояние не сбрасывает
			if (isBoard(d.k)) {
				const ar = Math.min(3, Math.max(0.33, Number(d.ar) || 1))
				if (s.ar !== ar) {
					s.ar = ar
					emit({ t: 'show', show: s })
				}
				if (state.board !== from) {
					state.board = from
					state.boardHidden = false
				}
			}
			'gd' in d && isMod(from) && (state.gd = !!d.gd)
		}
		return
	}
	const show = shows.get(d.k)
	if (!show) {
		return
	}
	identity(from) // запомнить имя автора, пока он в звонке
	if (!state.gd && (op === 's' || op === 't' || op === 'g' || op === 'm') && isGuestSid(from)) {
		return // гости сейчас не рисуют
	}
	switch (op) {
		case 's': {
			if (!idOk(d.id) || !TOOLS.includes(d.tool)) {
				return
			}
			const ttl = d.tool === 'fade' ? Math.min(30, Math.max(1, Number(d.ttl) || 3)) : 0
			const m = addMark(show, from, d.id, d.tool, ttl)
			if (m) {
				m.col = PALETTE.includes(d.c) ? d.c : '' // свой цвет автора; чужое значение -> цвет автора
				m.wm = WSZ.includes(d.w) ? d.w : 1
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
				// нажим пера (необязательный `pr`, 0..1 на точку): толщина линии
				const pr = Array.isArray(d.pr) && d.pr.length === P.length && (m.tool === 'marker' || m.tool === 'fade') ? d.pr.map((v) => num(v) ?? 0.5) : null
				pr && !m.pr && !m.pts.length && (m.pr = [])
				P.forEach((p, i) => {
					m.pts.push(p)
					m.ts.push(now)
					m.pr?.push(pr ? pr[i] : 0.5)
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
				Object.assign(m, { ttl, x, y, size: d.size, text, pts: [[x, y]], col: PALETTE.includes(d.c) ? d.c : '' })
				emit({ t: 'upd', show, mark: m })
			} else {
				m = addMark(show, from, d.id, 'text', ttl)
				if (!m) {
					return
				}
				Object.assign(m, { x, y, size: d.size, text, pts: [[x, y]], col: PALETTE.includes(d.c) ? d.c : '' })
				emit({ t: 'add', show, mark: m })
			}
			endMark(show, m)
			break
		}
		case 'g': {
			// перенос или новый размер готовой рамки/стрелки автора: две точки целиком
			if (!idOk(d.id) || !okPts(d.pts, 2) || d.pts.length !== 4) {
				return
			}
			const m = show.marks.get(from + '/' + d.id)
			if (!m) {
				// пометка ещё не пришла снимком `r` (вошли посреди показа): применим, когда придёт
				pendG.size < 200 && pendG.set(from + '/' + d.id, pairs(d.pts))
				return
			}
			if (!m.done || (m.tool !== 'frame' && m.tool !== 'arrow')) {
				return
			}
			m.pts = pairs(d.pts)
			emit({ t: 'upd', show, mark: m })
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
			// ket4tec: k4draw. Ластик модератора: чужие пометки парами [автор, id]
			if (Array.isArray(d.of) && isMod(from)) {
				d.of.slice(0, 200).forEach((p) => {
					const m = Array.isArray(p) && typeof p[0] === 'string' && p[0].length <= 300 && idOk(p[1]) && show.marks.get(p[0] + '/' + p[1])
					m && PERM.concat('text').includes(m.tool) && drop(show, m, true)
				})
			}
			break
		case 'X':
			show.marks.forEach((m) => m.by === from && drop(show, m, true))
			break
		case 'Z':
			// «Очистить всё»: модератор; показывающий экран — на своём показе
			if ((from === show.presenter && !isBoard(show.k)) || isMod(from)) {
				show.marks.forEach((m) => drop(show, m, true))
			}
			break
		case 'H': // доску закрыл тот, кто открыл
			from === show.presenter && isBoard(show.k) && (d.ho === 1 ? passBoard(from) : boardGone(from))
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
					m.col = PALETTE.includes(r.c) ? r.c : ''
					m.wm = WSZ.includes(r.w) ? r.w : 1
					if (txt) {
						Object.assign(m, { x: num(r.x), y: num(r.y), size: r.size, text: r.text.trim() })
						m.pts = [[m.x, m.y]]
					} else {
						const g = (r.tool === 'frame' || r.tool === 'arrow') && pendG.get(m.key)
						m.pts = g || pairs(r.pts)
						pendG.delete(m.key)
						Array.isArray(r.pr) && r.pr.length === m.pts.length && r.tool === 'marker' && (m.pr = r.pr.map((v) => num(v) ?? 0.5))
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
	enqueue(hOf(myK, colsOut(shows.get(myK))))
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
	const cw = { ...(m.col ? { c: m.col } : {}), ...(m.wm > 1 ? { w: m.wm } : {}) }
	return m.tool === 'text'
		? { id: m.id, author: m.by, tool: 'text', ttl: 0, x: m.x, y: m.y, size: m.size, text: m.text, name: a.name, uid: a.key, ...cw }
		: { id: m.id, author: m.by, tool: m.tool, ttl: 0, ...cw, pts: m.pts.flat().map((v) => +v.toFixed(4)), ...(m.pr ? { pr: m.pr.map((v) => +v.toFixed(2)) } : {}), name: a.name, uid: a.key }
}

/**
 * Длина оболочки `r` без пометок (с from до 60 символов и last).
 *
 * @param k
 */
function rEnv(k) {
	return JSON.stringify({ type: 'k4draw', v: 1, op: 'r', k, marks: [], last: 1, from: 'x'.repeat(60) }).length
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
	const base = rEnv(show.k)
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
	isBoard(myK) && closeBoard() // показ экрана закрывает свою доску
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
	if (!myK || isBoard(myK)) {
		return
	}
	dropShow(me())
	queue = queue.filter((q) => q.k !== myK)
	snap = null
	clearTimeout(qTimer)
	qTimer = 0
	clearTimeout(colsTimer)
	colsTimer = 0
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
/** Экранный поток показывающего (для моста k4draw: размер кадра и что показывается). */
export const localScreen = () => bound?.attributes.localScreen || null
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
			if (!sy || sy.done || (!sy.old && sy.n >= 6)) {
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
 * @param pr
 */
export function strokeStart(show, tool, p, pr) {
	const id = rid()
	local(show, { op: 's', id, tool, ttl: tool === 'fade' ? state.ft : 0, ...(state.col ? { c: state.col } : {}), ...(state.sz > 1 ? { w: state.sz } : {}) })
	const m = show.marks.get(me() + '/' + id)
	strokePoint(show, m, p, pr)
	return m
}

/**
 *
 * @param show
 * @param m
 * @param p
 * @param pr
 */
export function strokePoint(show, m, p, pr) {
	m && !m.done && local(show, { op: 'p', id: m.id, pts: [r4(p[0]), r4(p[1])], ...(pr === undefined ? {} : { pr: [+Math.min(1, Math.max(0, pr)).toFixed(2)] }) })
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
	local(show, { op: 't', id, x: r4(t.x), y: r4(t.y), size: t.size, text, ttl: old ? old.ttl : state.tl, ...(state.col ? { c: state.col } : {}) })
	const m = show.marks.get(me() + '/' + id)
	if (m && !old) {
		show.hist.push(m.key)
		refreshUndo(show)
	}
}

/**
 * Перенести или растянуть свою готовую рамку/стрелку: P — две точки 0..1.
 *
 * @param show показ
 * @param m пометка
 * @param P точки
 */
export function moveMark(show, m, P) {
	m && m.done && m.by === me() && (m.tool === 'frame' || m.tool === 'arrow') && local(show, { op: 'g', id: m.id, pts: P.flatMap((p) => [r4(p[0]), r4(p[1])]) })
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
	// чужие пометки (ластик модератора) уходят парами [автор, id]; приёмник проверяет, что отправитель модератор
	const own = marks.filter((m) => m.by === me())
	const of = amMod() ? marks.filter((m) => m.by !== me()).map((m) => [m.by, m.id]) : []
	;(own.length || of.length) && local(show, { op: 'x', ...(own.length ? { ids: own.map((m) => m.id) } : {}), ...(of.length ? { of } : {}) })
}

/**
 *
 * @param show
 */
export function undo(show = showOf(state.big)) {
	let m = null
	while (show?.hist.length && !m) {
		const key = show.hist.pop()
		m = show.marks.get(key)
		m = m && !m.fading ? m : null // история не чищена, пока показ не крупно (мост k4draw)
	}
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

/**
 * «Очистить всё»: только у показывающего (остальные такое сообщение отбросят).
 *
 * @param show
 */
export function clearAll(show = showOf(state.big)) {
	show && canClearAll(show) && local(show, { op: 'Z' })
}

/**
 * «Очистить всё» доступно: модератору; показывающему экран — на своём показе (по ключу: id сессии мог смениться).
 *
 * @param show
 */
export function canClearAll(show = showOf(state.big)) {
	return !!show && (amMod() || (show.k === myK && !isBoard(show.k)))
}

/**
 * Модератор: гости рисуют или нет.
 *
 * @param {boolean} on
 */
export function setGuestsDraw(on) {
	state.gd = !!on
	hpb() && enqueue({ op: 'G', on: on ? 1 : 0 })
}

/**
 * Открыть доску у всех.
 *
 * @param {number} ar соотношение сторон доски (ширина / высота) у открывшего
 */
export function openBoard(ar) {
	if (myK || state.board === me()) {
		return
	}
	if (!acquire()) {
		release()
		return
	}
	snapped = false
	myK = me() + ':b' + Date.now()
	setShow(me(), myK)
	shows.get(myK).ar = Math.min(3, Math.max(0.33, +ar.toFixed(3)))
	state.board = me()
	state.boardHidden = false
	wire(hOf(myK))
	state.mode = canDraw()
}

/** Своя доска с рисунком: перед закрытием спросить «Сохранить рисунок?». */
export function requestCloseBoard() {
	const s = myShow()
	if (s && isBoard(s.k) && s.perm > 0) {
		state.ask = true
	} else {
		closeBoard()
	}
}

/**
 * Закрыть свою доску у всех.
 *
 * @param {boolean} pass не закрывать, а передать доску следующему в звонке (я ухожу из звонка)
 */
export function closeBoard(pass = false) {
	if (!isBoard(myK)) {
		return
	}
	wire({ op: 'H', k: myK, ...(pass ? { ho: 1 } : {}) })
	queue = queue.filter((q) => q.k !== myK)
	snap = null
	clearTimeout(qTimer)
	qTimer = 0
	clearTimeout(colsTimer)
	colsTimer = 0
	myK = null
	boardGone(me())
	release()
}

/**
 * ket4tec: k4draw. Следующий владелец доски: сначала модераторы с учёткой, потом остальные с учёткой,
 * гости только если учёток не осталось; внутри ранга по sessionId — все клиенты выбирают одинаково без сообщений.
 *
 * @param excl кто уходит
 */
function pickOwner(excl) {
	const rank = (s) => (isGuestSid(s) ? 2 : 0) + (isMod(s) ? 0 : 1)
	return [me(), ...callParticipantCollection.callParticipantModels.map((m) => m.attributes.peerId)]
		.filter((s) => s && s !== excl)
		.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))[0]
}

/**
 * Показ доски переходит к новому владельцу: пометки те же, ключ прежний.
 *
 * @param show
 * @param next
 */
function moveBoard(show, next) {
	const old = show.presenter
	delete state.keys[old]
	delete syncs[old]
	show.presenter = next
	state.keys[next] = show.k
	syncs[next] = { t: performance.now(), done: true, old: false, n: 0 }
	state.board === old && (state.board = next)
	state.big === old && (state.big = next)
	if (next === me()) {
		acquire()
		snapped = false
		myK = show.k
		enqueue(hOf(myK, colsOut(show))) // новичкам и тем, кто пропустил уход: теперь доску держу я
	}
	emit({ t: 'show', show })
}

/**
 * Открывший доску ушёл: передать следующему, а если больше никого нет — доска закрывается.
 *
 * @param old кто открывал
 */
export function passBoard(old) {
	const show = shows.get(state.keys[old])
	const next = show && isBoard(show.k) && pickOwner(old)
	next ? moveBoard(show, next) : boardGone(old)
}

let autoSnap = null
/**
 * snapshot.js регистрирует автоснимок (без цикла импортов).
 *
 * @param f функция снимка
 */
export function setAutoSnap(f) {
	autoSnap = f
}
let snapped = false // автоснимок уже сделан при выходе из звонка
// До выхода из звонка (список участников и холст ещё целы): последний на доске с рисунком снимает её в Файлы, ждём до 4 с
beforeLeaveCall.fn = async () => {
	const s = myShow()
	console.debug('k4snap hook ' + JSON.stringify({ k: s?.k, myK, perm: s?.perm, snapped, others: callParticipantCollection.callParticipantModels.length, big: state.big, board: state.board }))
	if (!s || !isBoard(s.k) || s.perm <= 0 || snapped || callParticipantCollection.callParticipantModels.length) {
		return
	}
	snapped = true
	await Promise.race([autoSnap?.(), new Promise((r) => setTimeout(r, 4000))]).catch(() => {})
}
let others = 0 // сколько других в звонке было видно в последний раз (при выходе из звонка список уже пуст)

/** Выход из звонка: своя доска уходит к следующему, если никого — закрывается. */
function leaveBoard() {
	isBoard(myK) && closeBoard(others > 0)
}

/**
 * Доска ушла (закрыли или открывший ушёл из звонка).
 *
 * @param sid кто открывал
 */
export function boardGone(sid) {
	dropShow(sid)
	if (state.board === sid) {
		state.board = null
		state.boardHidden = false
		state.ask = false
	}
	if (state.big === sid) {
		state.big = null
		state.mode = false
		state.undo = 0
	}
}

/** Кнопка «Доска»: открыть у всех / показать скрытую / закрыть свою / скрыть чужую у себя. */
export function toggleBoard() {
	if (!state.board) {
		// соотношение сторон — от области видео открывшего за вычетом полей доски (DrawBoard.vue)
		const el = document.getElementById('videos')
		openBoard(((el?.clientWidth || 800) - 24) / Math.max(100, (el?.clientHeight || 600) - 160))
	} else if (state.boardHidden) {
		state.boardHidden = false
	} else if (state.board === me()) {
		requestCloseBoard()
	} else {
		state.boardHidden = true
		state.mode = false
	}
}
export const boardLabel = () => (!state.board ? 'Доска' : state.boardHidden ? 'Показать доску' : state.board === me() ? 'Закрыть доску' : 'Скрыть доску')
/** Кнопку «Доска» показываем: есть HPB, и мне можно рисовать (или доска уже открыта). */
export const boardBtn = () => hasHpb() && (!!state.board || canDraw())

let views = 0 // смонтированные виды звонка
/**
 * Пока идёт звонок: слушать сигналинг (о доске узнаём без экрана), новичком спросить `q`.
 *
 * @return {Function} отписка
 */
export function watchCall() {
	let held = false
	let n = 0
	views++
	const seen = setInterval(() => {
		others = callParticipantCollection.callParticipantModels.length
	}, 2000)
	const t = setInterval(() => {
		if (!held) {
			held = acquire()
			held || release()
			return
		}
		me() && n < 3 && wire({ op: 'q' })
		++n >= 3 && clearInterval(t)
	}, 2000)
	return () => {
		clearInterval(t)
		clearInterval(seen)
		views--
		held && release()
		if (!views) {
			others = Math.max(others, callParticipantCollection.callParticipantModels.length)
			// некому передать доску: снимок рисунка в Файлы, пока холст ещё в DOM
			const s = myShow()
			s && isBoard(s.k) && s.perm > 0 && !others && !snapped && autoSnap?.() // запасной путь
		}
		// звонок ушёл (а не перерисовка вида звонка): доска переходит дальше по звонку или, если никого нет, закрывается
		setTimeout(() => views || leaveBoard(), 1500)
	}
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
