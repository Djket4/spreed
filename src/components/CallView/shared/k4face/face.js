// ket4tec (слово владельца 11.11): плитка без камеры — «интеллект»: облако синапсов, медленно вращается в объёме.
// Голос расходится из центра: низкие полосы зажигают ядро, высокие — внешний слой, по связям бегут вспышки; вокруг — кольцо волны голоса.
// Десять форм и цветов, в одном звонке не повторяются. Без Vue: тот же модуль рисует и в звонке, и в макете.

const NB = 8
// полосы речи 90 Гц – 7 кГц, логарифмически
export const BANDS = Array.from({ length: NB }, (_, i) => 90 * (7000 / 90) ** ((i + 0.5) / NB))
const EDGE = Array.from({ length: NB + 1 }, (_, i) => 90 * (7000 / 90) ** (i / NB))

/**
 *
 * @param seed
 */
function rng(seed) {
	let s = seed >>> 0
	return () => {
		s = (s + 0x6D2B79F5) >>> 0
		let t = Math.imul(s ^ (s >>> 15), 1 | s)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r())
/**
 *
 * @param n
 * @param rad
 * @param out
 * @param r
 * @param jit
 */
function fib(n, rad, out, r, jit = 0) {
	for (let i = 0; i < n; i++) {
		const y = 1 - (2 * (i + 0.5)) / n
		const a = i * 2.399963
		const q = Math.sqrt(1 - y * y)
		out.push([(Math.cos(a) * q + gauss(r) * jit) * rad, (y + gauss(r) * jit) * rad, (Math.sin(a) * q + gauss(r) * jit) * rad])
	}
	return out
}

// формы облака: точки в единичном объёме
const SHAPES = {
	sphere: (r) => fib(70, 1, [], r, 0.04).concat(fib(16, 0.35, [], r, 0.1)),
	brain: (r) => {
		const p = []
		for (const sx of [-1, 1]) {
			for (const q of fib(46, 1, [], r, 0.06)) {
				p.push([sx * 0.42 + q[0] * 0.5, q[1] * 0.72, q[2] * 0.92])
			}
		}
		for (let i = 0; i < 8; i++) {
			p.push([gauss(r) * 0.12, gauss(r) * 0.15, (i / 7 - 0.5) * 1.2])
		}
		return p
	},
	torus: () => Array.from({ length: 96 }, (_, i) => {
		const a = (Math.floor(i / 4) / 24) * Math.PI * 2
		const b = ((i % 4) / 4) * Math.PI * 2 + a * 2
		return [(0.72 + 0.26 * Math.cos(b)) * Math.cos(a), 0.26 * Math.sin(b), (0.72 + 0.26 * Math.cos(b)) * Math.sin(a)]
	}),
	helix: (r) => {
		const p = []
		for (let i = 0; i < 40; i++) {
			const t = i / 39
			for (const ph of [0, Math.PI]) {
				const a = t * Math.PI * 4 + ph
				p.push([Math.cos(a) * 0.55, (t * 2 - 1) * 0.85, Math.sin(a) * 0.55])
			}
			if (i % 4 === 0) {
				p.push([0, (t * 2 - 1) * 0.85, 0])
			}
		}
		return p
	},
	galaxy: (r) => {
		const p = fib(14, 0.18, [], r, 0.1)
		for (let i = 0; i < 80; i++) {
			const t = 0.15 + r() * 0.85
			const a = t * Math.PI * 3 + (i % 2) * Math.PI + gauss(r) * 0.25
			p.push([Math.cos(a) * t, gauss(r) * 0.05, Math.sin(a) * t])
		}
		return p
	},
	gyro: (r) => {
		const p = fib(12, 0.2, [], r, 0.1)
		const ring = (n, rad, f) => {
			for (let i = 0; i < n; i++) {
				const a = (i / n) * Math.PI * 2
				p.push(f(Math.cos(a) * rad, Math.sin(a) * rad))
			}
		}
		ring(30, 1, (a, b) => [a, b, 0])
		ring(26, 0.82, (a, b) => [a, 0, b])
		ring(22, 0.64, (a, b) => [0, a, b])
		return p
	},
	lattice: (r) => {
		const p = []
		for (let x = 0; x < 5; x++) {
			for (let y = 0; y < 5; y++) {
				for (let z = 0; z < 5; z++) {
					const q = [x / 2 - 1, y / 2 - 1, z / 2 - 1]
					if (Math.hypot(...q) <= 1.3) {
						p.push(q.map((c) => c * 0.8 + gauss(r) * 0.03))
					}
				}
			}
		}
		return p
	},
	nebula: (r) => Array.from({ length: 95 }, () => {
		const q = [gauss(r), gauss(r) * 0.8, gauss(r)]
		const m = Math.max(1, Math.hypot(...q) / 1.15)
		return q.map((c) => (c * 0.5) / m)
	}),
	shell: (r) => fib(56, 1, [], r, 0).concat(fib(24, 0.4, [], r, 0.02)),
	vortex: (r) => Array.from({ length: 90 }, (_, i) => {
		const t = i / 89
		const a = t * Math.PI * 7 + gauss(r) * 0.1
		const rad = 0.15 + t * 0.85
		return [Math.cos(a) * rad, (1 - t * 2) * 0.8 + gauss(r) * 0.04, Math.sin(a) * rad]
	}),
}

// десять «интеллектов»: форма, цвет ядра и края, кольцо голоса, скорость вращения и наклон
export const LOOKS = [
	{ shape: 'sphere', color: '#5fd4ff', edge: '#c6f4ff', ring: 'line', spin: 0.22, tilt: 0.35 },
	{ shape: 'brain', color: '#a86bff', edge: '#ff8ae6', ring: 'ticks', spin: 0.16, tilt: 0.25 },
	{ shape: 'torus', color: '#ffb347', edge: '#ffe6b8', ring: 'dots', spin: 0.3, tilt: 0.9 },
	{ shape: 'helix', color: '#2ecf9a', edge: '#c8ffec', ring: 'line', spin: 0.4, tilt: 0.15 },
	{ shape: 'galaxy', color: '#ff5fa2', edge: '#ffd6ea', ring: 'ticks', spin: 0.25, tilt: 0.75 },
	{ shape: 'gyro', color: '#8fb8ff', edge: '#ffffff', ring: 'none', spin: 0.35, tilt: 0.5 },
	{ shape: 'lattice', color: '#3fe0d0', edge: '#d8fffb', ring: 'dots', spin: 0.18, tilt: 0.55 },
	{ shape: 'nebula', color: '#ffd166', edge: '#ff8a3d', ring: 'line', spin: 0.12, tilt: 0.3 },
	{ shape: 'shell', color: '#5b7cff', edge: '#a8dcff', ring: 'ticks', spin: 0.2, tilt: 0.4 },
	{ shape: 'vortex', color: '#ff6b4a', edge: '#ffd0c0', ring: 'dots', spin: 0.33, tilt: 0.6 },
]

/**
 *
 * @param s
 */
function hash(s) {
	let h = 2166136261
	for (const ch of String(s || '?')) {
		h = Math.imul(h ^ ch.codePointAt(0), 16777619)
	}
	return h >>> 0
}

// кто в звонке: roster — весь список звонка (порядок — кто раньше в комнате) плюс плитки, которых в списке нет.
// Вид по хэшу, занят — следующий свободный; новичок никого не сдвигает; больше десяти — та же форма в другом цвете.
// У всех участников одинаково и без повторов при любом числе людей
const NL = LOOKS.length
const seeds = new Map()
let roster = new Map()
let rosterKey = ''
let ver = 0
let slots = new Map()
/**
 *
 * @param seed
 */
export function join(seed) {
	seeds.set(seed, (seeds.get(seed) || 0) + 1)
	ver++
}
/**
 *
 * @param seed
 */
export function leave(seed) {
	const n = (seeds.get(seed) || 1) - 1
	n ? seeds.set(seed, n) : seeds.delete(seed)
	ver++
}
// list: [[seed, порядок]], порядок — номер участника в комнате (attendeeId)
/**
 *
 * @param list
 */
export function setRoster(list) {
	const key = list.map((x) => x.join(':')).sort().join('|')
	if (key !== rosterKey) {
		rosterKey = key
		roster = new Map(list)
		ver++
	}
}
/**
 *
 * @param seed
 */
export function slot(seed) {
	if (slots.ver !== ver) {
		slots = new Map()
		slots.ver = ver
		const used = new Set()
		const all = new Map(roster)
		for (const k of seeds.keys()) {
			if (!all.has(k)) {
				all.set(k, Infinity)
			}
		}
		const list = [...all].map(([k, o]) => [o, hash(k), k]).sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] < y[2] ? -1 : 1))
		for (const [, h, k] of list) {
			let i = h % NL
			for (let n = 1; used.has(i); n++) {
				i = n < NL ? (h + n) % NL : n
			}
			used.add(i)
			slots.set(k, i)
		}
	}
	return slots.get(seed) ?? hash(seed) % NL
}

// граф формы: узлы (радиус от центра → полоса) и связи по 3 ближайшим соседям; один на форму, общий для всех плиток
const graphs = new Map()
/**
 *
 * @param i
 */
function graph(i) {
	if (!graphs.has(i)) {
		const pts = SHAPES[LOOKS[i].shape](rng(1000 + i))
		const maxR = Math.max(...pts.map((p) => Math.hypot(...p)))
		const r = rng(7 + i)
		const nodes = pts.map((p) => {
			// куда узел разлетается: от центра наружу, с небольшим разбросом; у самого центра — в случайную сторону
			const u = p.map((c) => c + gauss(r) * 0.25)
			const m = Math.hypot(...u) || 1
			return { p, r: Math.hypot(...p) / maxR, ph: r() * 6.28, u: u.map((c) => c / m) }
		})
		const links = new Set()
		const nb = nodes.map(() => [])
		nodes.forEach((a, ia) => {
			nodes.map((b, ib) => [ib, (a.p[0] - b.p[0]) ** 2 + (a.p[1] - b.p[1]) ** 2 + (a.p[2] - b.p[2]) ** 2])
				.filter(([ib]) => ib !== ia).sort((x, y) => x[1] - y[1]).slice(0, 3)
				.forEach(([ib]) => {
					links.add(ia < ib ? ia + ',' + ib : ib + ',' + ia)
				})
		})
		const L = [...links].map((s) => s.split(',').map(Number))
		L.forEach(([a, b]) => {
			nb[a].push(b)
			nb[b].push(a)
		})
		const core = nodes.map((n, k) => [n.r, k]).sort((x, y) => x[0] - y[0]).slice(0, 6).map((x) => x[1])
		graphs.set(i, { nodes, links: L, nb, core })
	}
	return graphs.get(i)
}

let ac = null
/**
 *
 */
function audioCtx() {
	if (!ac) {
		ac = new (window.AudioContext || window.webkitAudioContext)()
	}
	if (ac.state === 'suspended') {
		ac.resume().catch(() => {})
		window.addEventListener('pointerdown', () => ac.resume().catch(() => {}), { once: true })
	}
	return ac
}

// анализ звука потока: read(bands, wave) заполняет 8 полос (0..1) и 64 точки волны (-1..1), возвращает громкость
/**
 *
 * @param stream
 */
export function probe(stream) {
	const tracks = stream?.getAudioTracks?.() || []
	if (!tracks.length) {
		return null
	}
	const a = audioCtx()
	const src = a.createMediaStreamSource(new MediaStream(tracks))
	const fa = a.createAnalyser()
	fa.fftSize = 4096
	fa.smoothingTimeConstant = 0.5
	const ta = a.createAnalyser()
	ta.fftSize = 1024
	const mute = a.createGain()
	mute.gain.value = 0 // Safari считает анализатор только когда граф доходит до выхода
	src.connect(fa)
	src.connect(ta)
	ta.connect(mute)
	mute.connect(a.destination)
	const bw = a.sampleRate / fa.fftSize
	const ranges = BANDS.map((fc, k) => {
		const i0 = Math.max(1, Math.floor(EDGE[k] / bw))
		return [i0, Math.max(i0, Math.ceil(EDGE[k + 1] / bw) - 1), 3 * Math.log2(fc / 1000)]
	})
	const fd = new Float32Array(fa.frequencyBinCount)
	const td = new Float32Array(ta.fftSize)
	return {
		read(bands, wave) {
			fa.getFloatFrequencyData(fd)
			ta.getFloatTimeDomainData(td)
			let lvl = 0
			ranges.forEach(([i0, i1, tilt], k) => {
				let p = 0
				for (let i = i0; i <= i1; i++) {
					p += 10 ** (fd[i] / 10)
				}
				const db = 10 * Math.log10(p / (i1 - i0 + 1) + 1e-12) + tilt // +3 дБ/окт, как у RTA: верх не тонет
				bands[k] = Math.min(1, Math.max(0, (db + 78) / 50)) // тише −78 дБ — тишина
				lvl = Math.max(lvl, bands[k])
			})
			for (let k = 0; k < 64; k++) {
				wave[k] = td[k * 16]
			}
			return lvl
		},
		stop() {
			src.disconnect()
			ta.disconnect()
			mute.disconnect()
		},
	}
}

// состояние одной плитки
/**
 *
 * @param seed
 */
export function face(seed) {
	return {
		seed,
		ver: -1,
		...LOOKS[0],
		g: null,
		fire: null,
		cool: null,
		queue: [],
		o: null,
		v: null,
		ep: null,
		parts: [],
		bok: [],
		b: new Float32Array(NB),
		w: new Float32Array(64),
		d: new Float32Array(NB),
		lvl: 0,
		talk: 0,
		t: Math.random() * 100,
		idle: 1,
	}
}

/**
 *
 * @param f
 * @param k
 * @param delay
 */
function ignite(f, k, delay) {
	if (f.cool[k] <= 0) {
		f.queue.push([k, f.t + delay])
		f.cool[k] = 0.5
	}
}

// один кадр: src — probe() или null (нет звука), on — микрофон включён
/**
 *
 * @param g
 * @param W
 * @param H
 * @param f
 * @param src
 * @param on
 * @param dt
 */
export function draw(g, W, H, f, src, on, dt) {
	if (f.ver !== ver) {
		const i = slot(f.seed)
		Object.assign(f, LOOKS[i % NL])
		if (i >= NL) { // одиннадцатый и дальше: форма по кругу, цвет со сдвигом — пара «форма+цвет» не повторяется до 100 человек
			const c = LOOKS[(i + 3 * Math.floor(i / NL)) % NL]
			f.color = c.color
			f.edge = c.edge
		}
		f.g = graph(i % NL)
		f.fire = new Float32Array(f.g.nodes.length)
		f.cool = new Float32Array(f.g.nodes.length)
		f.queue = []
		f.o = new Float32Array(f.g.nodes.length) // вылет узла от места, доли радиуса облака
		f.v = new Float32Array(f.g.nodes.length)
		f.ep = new Float32Array(f.g.nodes.length)
		f.parts = []
		f.bok = Array.from({ length: 3 }, () => ({ x: (Math.random() - 0.5) * 2.4, y: (Math.random() - 0.5) * 1.6, vx: 0, vy: 0, r: 0.6 + Math.random() * 0.7, fq: 0.3 + Math.random() * 0.5, ph: Math.random() * 6.28 }))
		f.ver = ver
	}
	if (!src || !on) {
		f.b.fill(0)
		f.w.fill(0)
	}
	const lvl = src && on ? src.read(f.b, f.w) : 0
	f.lvl = lvl
	f.t += dt
	f.talk += ((lvl > 0.45 ? 1 : 0) - f.talk) * Math.min(1, dt * 5)
	for (let k = 0; k < NB; k++) {
		f.d[k] = Math.max(f.b[k], f.d[k] - dt * 2.2)
	}
	const { nodes, links, nb, core } = f.g
	// вспышки: от ядра наружу по связям; говорит — часто, молчит — изредка «думает»
	f.idle -= dt
	const rate = on ? lvl * lvl * 9 : 0
	if (Math.random() < rate * dt || (on && f.idle < 0)) {
		ignite(f, Math.random() < 0.3 ? Math.floor(Math.random() * nodes.length) : core[Math.floor(Math.random() * core.length)], 0)
		f.idle = 0.8 + Math.random() * 4
	}
	for (let k = 0; k < nodes.length; k++) {
		f.fire[k] = Math.max(0, f.fire[k] - dt * 2.8)
		f.cool[k] -= dt
	}
	f.queue = f.queue.filter(([k, at]) => {
		if (at > f.t) {
			return true
		}
		f.fire[k] = 1
		f.v[k] += 1.6
		for (const n of nb[k]) {
			if (nodes[n].r >= nodes[k].r - 0.05 && Math.random() < 0.75) {
				ignite(f, n, 0.06 + Math.random() * 0.05)
			}
		}
		return false
	})

	const band = (r) => {
		const i = Math.min(NB - 1, r * (NB - 1))
		const i0 = Math.floor(i)
		return f.d[i0] + (f.d[Math.min(NB - 1, i0 + 1)] - f.d[i0]) * (i - i0)
	}
	// пружины: голос держит узлы снаружи, каждый слог толкает их наружу; без голоса — возврат с перелётом и дрожью
	const E = nodes.map((n, i) => {
		const e = band(n.r)
		f.v[i] += Math.max(0, e - f.ep[i]) * 7 * (0.4 + n.r) * (0.4 + Math.random() * 1.2)
		f.ep[i] = e
		return e
	})
	let spread = 0
	for (let t = dt; t > 1e-4; t -= 1 / 120) {
		const h = Math.min(t, 1 / 120)
		for (let i = 0; i < nodes.length; i++) {
			const goal = E[i] * 0.32 * (0.35 + nodes[i].r)
			f.v[i] += (-70 * (f.o[i] - goal) - 5.5 * f.v[i]) * h
			f.o[i] = Math.max(-0.3, Math.min(1.3, f.o[i] + f.v[i] * h))
		}
	}
	for (let i = 0; i < nodes.length; i++) {
		spread += f.o[i] / nodes.length
	}

	// проекция: вращение вокруг вертикали, наклон, перспектива
	const R = Math.min(W * 0.3, H * 0.27)
	const cx = W / 2
	const cy = H * 0.44
	const a = f.t * f.spin * (on ? 1 : 0.5) + Math.sin(f.t * 0.31 + f.bok[0].ph) * 0.5
	const ca = Math.cos(a)
	const sa = Math.sin(a)
	const tl = f.tilt + Math.sin(f.t * 0.23) * 0.08
	const ct = Math.cos(tl)
	const st = Math.sin(tl)
	const k = R / 60
	const dim = on ? 1 : 0.45
	const P = nodes.map((n, i) => {
		const e = E[i]
		const o = f.o[i] + Math.sin(f.t * 1.3 + n.ph) * 0.015
		const x = n.p[0] + n.u[0] * o
		const y = n.p[1] + n.u[1] * o
		const z = n.p[2] + n.u[2] * o
		const x1 = x * ca + z * sa
		const z1 = -x * sa + z * ca
		const y2 = y * ct - z1 * st
		const z2 = y * st + z1 * ct
		const s = Math.max(0.6, Math.min(1.45, 2.6 / (2.6 + z2))) // летящий в камеру узел не раздувается в пятно
		return [cx + x1 * s * R, cy + y2 * s * R, s, Math.min(1, 0.22 + e * 0.7 + Math.abs(f.o[i]) * 0.5 + f.fire[i]) * dim, n.r]
	})
	g.clearRect(0, 0, W, H)
	g.globalCompositeOperation = 'lighter'
	g.lineCap = 'round'
	// блики фона: мягкие пятна бродят по плитке, ярче на голосе
	for (const b of f.bok) {
		b.vx += ((Math.random() - 0.5) * 0.6 - b.x * 0.08) * dt
		b.vy += ((Math.random() - 0.5) * 0.6 - b.y * 0.08) * dt
		b.x += b.vx * dt
		b.y += b.vy * dt
		const x = cx + b.x * R
		const y = cy + b.y * R
		const rad = R * b.r * (1 + lvl * 0.3)
		const gr = g.createRadialGradient(x, y, 0, x, y, rad)
		gr.addColorStop(0, f.color)
		gr.addColorStop(1, 'transparent')
		g.fillStyle = gr
		g.globalAlpha = (0.05 + lvl * 0.07 + Math.sin(f.t * b.fq + b.ph) * 0.02) * dim
		g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
	}
	// искры срываются со связей: точка на связи, вылет в случайную сторону от центра
	const spark = (A, B, sp) => {
		if (f.parts.length > 160) {
			return
		}
		const t = Math.random()
		const x = (A[0] + (B[0] - A[0]) * t - cx) / R
		const y = (A[1] + (B[1] - A[1]) * t - cy) / R
		const ang = Math.atan2(y, x) + (Math.random() - 0.5) * 2.4
		const v = sp * (0.15 + Math.random() * 0.6)
		const life = 1 + Math.random() * 2.5
		f.parts.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life, max: life, sz: 0.4 + Math.random() ** 3 * 1.6, tw: 3 + Math.random() * 12, ph: Math.random() * 6.28 })
	}
	// связи
	g.lineWidth = Math.max(1, k * 0.55)
	for (const [i, j] of links) {
		const A = P[i]
		const B = P[j]
		const fire = Math.max(f.fire[i], f.fire[j])
		g.strokeStyle = fire > 0.05 ? f.edge : f.color
		g.globalAlpha = (0.07 + (A[3] + B[3]) * 0.13 + fire * 0.55) * Math.min(A[2], B[2]) * dim
		g.beginPath()
		g.moveTo(A[0], A[1])
		g.lineTo(B[0], B[1])
		g.stroke()
		if (fire > 0.3 && Math.random() < fire * 0.15) {
			spark(A, B, 2.6)
		}
	}
	// узлы: ореол и ядро
	for (let i = 0; i < P.length; i++) {
		const [x, y, s, b, r] = P[i]
		g.fillStyle = r < 0.55 ? f.color : f.edge
		g.globalAlpha = b * 0.18 * s
		g.beginPath()
		g.arc(x, y, k * (2.5 + b * 1.8) * s, 0, 6.283)
		g.fill()
		g.globalAlpha = Math.min(1, b * 1.1) * s
		g.fillStyle = f.fire[i] > 0.3 ? '#ffffff' : (r < 0.55 ? f.color : f.edge)
		g.beginPath()
		g.arc(x, y, k * (0.9 + b * 1.1) * s, 0, 6.283)
		g.fill()
	}
	for (let n = (on ? 5 + lvl * 60 : 1) * dt; n > 0; n--) {
		if (Math.random() < n) {
			const [i, j] = links[Math.floor(Math.random() * links.length)]
			spark(P[i], P[j], 0.8 + lvl * 1.6)
		}
	}
	f.parts = f.parts.filter((q) => (q.life -= dt) > 0)
	for (const q of f.parts) {
		q.vx += (Math.random() - 0.5) * 1.8 * dt
		q.vy += ((Math.random() - 0.5) * 1.8 - 0.04) * dt
		q.vx *= 1 - dt * 0.9
		q.vy *= 1 - dt * 0.9
		q.x += q.vx * dt
		q.y += q.vy * dt
		const x = cx + q.x * R
		const y = cy + q.y * R
		const tw = 0.55 + 0.45 * Math.sin(f.t * q.tw + q.ph)
		const al = Math.sin((Math.PI * q.life) / q.max) * tw * dim
		g.globalAlpha = al * 0.9
		g.fillStyle = q.sz > 1.2 ? '#ffffff' : f.edge
		g.beginPath()
		g.arc(x, y, Math.max(0.8, k * 1.3 * q.sz), 0, 6.283)
		g.fill()
		if (q.sz > 1.1 && tw > 0.9) { // блик-звёздочка на пике мерцания
			const L = k * 3.5 * q.sz * tw
			g.strokeStyle = '#ffffff'
			g.lineWidth = Math.max(1, k * 0.3)
			g.globalAlpha = al * 0.6
			g.beginPath()
			g.moveTo(x - L, y)
			g.lineTo(x + L, y)
			g.moveTo(x, y - L)
			g.lineTo(x, y + L)
			g.stroke()
		}
	}
	// кольцо волны голоса
	if (f.ring !== 'none') {
		const rr = R * (1.3 + spread * 0.6)
		g.strokeStyle = f.edge
		g.fillStyle = f.edge
		g.lineWidth = Math.max(1, k * 0.5)
		g.globalAlpha = (0.22 + f.talk * 0.35) * dim
		const pt = (q) => {
			const w = (f.w[(q + 63) % 64] + f.w[q % 64] * 2 + f.w[(q + 1) % 64]) / 4
			const amp = 1 + Math.max(-0.08, Math.min(0.08, w * 1.2))
			const ang = (q / 64) * 6.283 - 1.5708
			return [cx + Math.cos(ang) * rr * amp, cy + Math.sin(ang) * rr * amp * 0.94, ang]
		}
		if (f.ring === 'line') {
			g.beginPath()
			for (let q = 0; q <= 64; q++) {
				const [x, y] = pt(q)
				q ? g.lineTo(x, y) : g.moveTo(x, y)
			}
			g.stroke()
		} else {
			for (let q = 0; q < 64; q++) {
				const [x, y, ang] = pt(q)
				g.beginPath()
				if (f.ring === 'dots') {
					g.arc(x, y, k * 0.8, 0, 6.283)
					g.fill()
				} else {
					g.moveTo(x, y)
					g.lineTo(x - Math.cos(ang) * k * 2.4, y - Math.sin(ang) * k * 2.4)
					g.stroke()
				}
			}
		}
	}
	g.globalAlpha = 1
	g.globalCompositeOperation = 'source-over'
	return k
}
