/**
 * ket4tec: k4draw. Мост к приложению для Мака «Рисовать на экране» (NAS_CLOUD mac/k4draw, PROTOCOL.md).
 * Вкладка показывающего открывает окно http://127.0.0.1:47811/ (его отдаёт приложение), окно держит ws
 * с приложением и пересылает сообщения сюда через postMessage. Прямой ws://127.0.0.1 из https-страницы
 * Safari не пускает (mixed content), CSP Talk — тоже.
 */
import { showWarning } from '@nextcloud/dialogs'
import { reactive } from 'vue'
import { consoleCmd, consoleTick, inCall, stopConsole } from './macConsole.js'
import { clearAll, eraseMarks, hash, identity, localScreen, myId, myShow, onDraw, PALETTE, pumpNow, state, strokeEnd, strokePoint, strokeStart, textPut, undo } from './useDrawing.js'

const ORIGIN = 'http://127.0.0.1:47811'
const URL = ORIGIN + '/'
const TOOLS = ['laser', 'fade', 'marker', 'arrow', 'frame']
const SIZES = ['s', 'm', 'l']
const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : null)

/** Для кнопки в доке: idle | wait (ждём окно моста) | launch (приложение не ответило) | start (запуск попросили, нажать ещё раз) | on | lost (окно моста закрыто или приложение вышло) */
export const mac = reactive({ st: 'idle' })
/** Подпись кнопки «Рисовать на экране» по состоянию (док и плашка показа) */
export const macLabel = { idle: 'Рисовать на экране', wait: 'Подключаю…', launch: 'Запустить приложение', start: 'Подключить приложение', on: 'На экране ✓', lost: 'Связь потеряна — переподключить' }
export const isMac = () => /Mac/.test(navigator.platform || navigator.userAgent)

let pop = null
let off = null
let timer = 0
let cur = null
let watch = 0

const show = myShow // по ключу показа: id сессии сигналинга мог смениться посреди показа
const send = (m) => pop && !pop.closed && pop.postMessage(m, ORIGIN)

/**
 * Пометка целиком, как её видят зрители (цвет из карты показа).
 *
 * @param s показ
 * @param m пометка
 */
function ser(s, m) {
	const id = identity(m.by)
	const o = { t: 'mark', key: m.key, tool: m.tool, name: id.name, mine: m.by === myId() || m.by === s.presenter, done: m.done, ttl: m.ttl || 0 }
	o.color = PALETTE[s.cols[m.by] ?? hash(String(id.key || 'Гость')) % PALETTE.length]
	if (m.tool === 'text') {
		Object.assign(o, { x: m.x, y: m.y, size: m.size, text: m.text })
	} else {
		o.pts = m.pts.flat()
		if (m.tool === 'laser') {
			const now = performance.now()
			o.age = m.ts.map((t) => Math.round(now - t))
		}
	}
	return o
}

const undoN = (s) => (s ? s.hist.filter((k) => s.marks.has(k) && !s.marks.get(k).fading).length : 0)

/** Состояние, размер кадра и все пометки заново (подключение, новый показ). */
function full() {
	const s = show()
	const t = localScreen()?.getVideoTracks()[0]
	const g = (s && t?.getSettings()) || {}
	send({ t: 'hello', me: myId(), w: g.width || 0, h: g.height || 0, surface: g.displaySurface || null })
	send({ t: 'reset' })
	s?.marks.forEach((m) => send(ser(s, m)))
	send({ t: 'state', live: !!s, undo: undoN(s) })
}

/**
 * События слоя → приложение.
 *
 * @param ev событие onDraw
 */
function onEv(ev) {
	if (mac.st !== 'on') {
		return
	}
	if (ev.t === 'show') {
		ev.show === show() && full()
		return
	}
	const s = ev.show
	if (!s || s !== show()) {
		return
	}
	const m = ev.mark
	if (['add', 'upd', 'pts', 'end'].includes(ev.t)) {
		send(ser(s, m))
	} else if (ev.t === 'fade' || ev.t === 'del') {
		send({ t: ev.t, key: m.key })
	} else if (ev.t === 'ping' || ev.t === 'cur') {
		const id = identity(ev.by)
		send({ t: ev.t, by: ev.by, x: ev.x, y: ev.y, name: id.name, color: PALETTE[s.cols[ev.by] ?? hash(String(id.key || 'Гость')) % PALETTE.length] })
	}
	if (ev.t === 'end' || ev.t === 'del' || ev.t === 'fade') {
		// после текущего вызова: strokeEnd/textPut кладут пометку в историю уже после события `end`
		queueMicrotask(() => send({ t: 'state', live: true, undo: undoN(s) }))
	}
}

/** Окно моста закрыто или приложение вышло: кнопка в доке предложит переподключить. */
function lost() {
	if (mac.st === 'on') {
		mac.st = 'lost'
		clearInterval(watch)
		stopConsole()
		const s = show()
		cur && s && strokeEnd(s, cur)
		cur = null
		showWarning('Связь с приложением «Рисовать на экране» потеряна. Переподключить — кнопкой в панели рисования.')
	}
}

/** Звонок окончен или вкладка уходит: окно моста закрываем молча, приложение спрячет слой и пульт. */
function finish() {
	clearInterval(watch)
	clearTimeout(timer)
	stopConsole()
	const s = show()
	cur && s && strokeEnd(s, cur)
	cur = null
	pop && !pop.closed && pop.close()
	pop = null
	mac.st = 'idle'
}

/**
 * Приложение → рисование от имени показывающего.
 *
 * @param d сообщение
 */
function onCmd(d) {
	const s = show()
	const x = num(d.x)
	const y = num(d.y)
	if (d.t === 'ready') {
		clearTimeout(timer)
		mac.st = 'on'
		clearInterval(watch)
		watch = setInterval(() => (inCall() ? pop?.closed && lost() : finish()), 1000)
		return full()
	}
	if (d.t === 'tick') {
		// часы от приложения: события в фоновой вкладке приходят сразу, а свои таймеры спят
		if (!inCall()) {
			return finish()
		}
		pumpNow()
		return consoleTick(send)
	}
	if (d.t === 'bye') {
		lost()
		return
	}
	if (consoleCmd(d.t)) {
		return
	}
	if (!s) {
		cur = null
		return
	}
	switch (d.t) {
		case 's':
			cur && strokeEnd(s, cur)
			cur = TOOLS.includes(d.tool) && x !== null && y !== null ? strokeStart(s, d.tool, [x, y]) : null
			break
		case 'p':
			cur && x !== null && y !== null && strokePoint(s, cur, [x, y])
			break
		case 'e':
			cur && strokeEnd(s, cur)
			cur = null
			break
		case 'text':
			x !== null && y !== null && typeof d.text === 'string' && SIZES.includes(d.size) && textPut(s, { x, y, size: d.size, text: d.text })
			break
		case 'erase':
			Array.isArray(d.keys) && eraseMarks(s, d.keys.slice(0, 200).map((k) => s.marks.get(k)).filter((m) => m && m.by === myId()))
			break
		case 'undo':
			undo(s)
			break
		case 'clearAll':
			clearAll(s)
			break
	}
	pumpNow() // штрих ведущего уходит зрителям сразу, не дожидаясь спящего таймера фоновой вкладки
}

/**
 * @param e MessageEvent
 */
function onMsg(e) {
	e.origin === ORIGIN && e.source === pop && e.data && typeof e.data === 'object' && onCmd(e.data)
}

/**
 * Окно моста не ответило: приложение не запущено. Окно со страницей ошибки закрыть — Safari его уже
 * не загрузит заново (ни из вкладки, ни перезагрузкой), годится только свежее окно.
 */
function retry() {
	clearTimeout(timer)
	timer = setTimeout(() => {
		if (mac.st !== 'wait') {
			return
		}
		pop?.close()
		pop = null
		mac.st = 'launch'
	}, 1500)
}

/**
 * Кнопка «Рисовать на экране» (только из клика: окно и запуск приложения требуют жеста).
 */
export function openMac() {
	if (!off) {
		off = onDraw(onEv)
		window.addEventListener('message', onMsg)
		window.addEventListener('pagehide', finish)
	}
	if (mac.st === 'on' && pop && !pop.closed) {
		pop.focus()
		return
	}
	const launch = mac.st === 'launch'
	pop?.close() // всегда свежее окно: окно, где Safari показал ошибку, больше не загрузится
	pop = window.open(launch ? 'k4draw://open' : URL, 'k4draw', 'popup,width=380,height=170')
	if (launch || !pop) {
		// запуск: Safari спросит, открыть ли приложение; после запуска — ещё раз нажать (пульт приложения подскажет)
		mac.st = launch && pop ? 'start' : 'idle' // !pop: окно заблокировано
		return
	}
	mac.st = 'wait'
	retry()
}
