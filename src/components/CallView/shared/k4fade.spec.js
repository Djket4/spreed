/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, expect, test, vi } from 'vitest'
import { FADE_MS, hasPicture, useK4VideoFade } from './k4fade.js'

vi.mock('vue', async (orig) => ({ ...(await orig()), onBeforeUnmount: () => {} }))

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

test('NAS_CLOUD#271: быстрые выкл/вкл (2 цикла) не оставляют снимок поверх живого видео', async () => {
	vi.useFakeTimers()
	const vproto = window.HTMLVideoElement.prototype
	vi.spyOn(vproto, 'videoWidth', 'get').mockReturnValue(640)
	vi.spyOn(vproto, 'videoHeight', 'get').mockReturnValue(360)
	vi.spyOn(vproto, 'readyState', 'get').mockReturnValue(4)
	vproto.play = () => Promise.resolve()
	vproto.pause = () => {}
	vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data: new Array(256).fill(200) }) })
	const box = document.createElement('div')
	const v = document.createElement('video')
	box.append(v)
	const fade = useK4VideoFade()
	const get = () => v
	// снимок — постоянный канвас за видео, виден только на угасании
	const snaps = () => [...box.querySelectorAll('.k4-vsnap')].filter((e) => e.style.opacity === '1').length

	fade.set(true, get)
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	expect(fade.state.full).toBe(true)
	for (let i = 0; i < 2; i++) {
		fade.set(false, get)
		expect(snaps()).toBe(1) // гаснет снимок последнего кадра
		await vi.advanceTimersByTimeAsync(300) // переход прерван до конца фейда
		fade.set(true, get)
		expect(snaps()).toBe(0)
		await vi.advanceTimersByTimeAsync(FADE_MS + 100)
		expect(snaps()).toBe(0)
		expect(fade.state.opaque).toBe(true)
	}
	fade.set(false, get)
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	expect(snaps()).toBe(0)
	expect(fade.state.shown).toBe(false)
})

test('NAS_CLOUD#271: кадр поменьше посередине прозрачного поля (первые кадры iOS) — не целый, чёрный — тоже', () => {
	const px = (lit) => {
		const d = new Array(256).fill(0)
		for (let y = 0; y < 8; y++) {
			for (let x = 0; x < 8; x++) {
				if (lit(x, y)) {
					d.fill(200, (y * 8 + x) * 4, (y * 8 + x) * 4 + 3)
				}
			}
		}
		return d
	}
	const check = (data) => {
		vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data }) })
		return hasPicture(document.createElement('video'))
	}
	expect(check(px(() => true))).toBe(true)
	expect(check(px((x, y) => x >= 2 && x <= 5 && y >= 2 && y <= 5))).toBe(false)
	expect(check(px(() => false))).toBe(false)
	// тёмный фон, но лицо посередине и светлые места у каждого края — целый кадр
	expect(check(px((x, y) => (x > 2 && x < 5) || y === 3))).toBe(true)
	// NAS_CLOUD#279 п.4: тёмная комната — края почти чёрные, но непрозрачные, лицо посередине — целый кадр
	const dark = new Array(256).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 5))
	;[[3, 3], [4, 4]].forEach(([x, y]) => dark.fill(90, (y * 8 + x) * 4, (y * 8 + x) * 4 + 3))
	expect(check(dark)).toBe(true)
	// а тот же кадр с прозрачным полем вокруг — нет
	expect(check(dark.map((c, i) => (i % 4 === 3 ? 0 : c)))).toBe(false)
})

test('NAS_CLOUD#271: повторный выкл (сигнал «скоро выкл», затем сам выкл) не начинает угасание заново; видео под снимком скрыто', async () => {
	vi.useFakeTimers()
	const vproto = window.HTMLVideoElement.prototype
	vi.spyOn(vproto, 'videoWidth', 'get').mockReturnValue(640)
	vi.spyOn(vproto, 'videoHeight', 'get').mockReturnValue(360)
	vi.spyOn(vproto, 'readyState', 'get').mockReturnValue(4)
	vproto.play = () => Promise.resolve()
	vproto.pause = () => {}
	const draws = []
	vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => draws.push(1), getImageData: () => ({ data: new Array(256).fill(200) }) })
	const box = document.createElement('div')
	const v = document.createElement('video')
	box.append(v)
	const fade = useK4VideoFade()
	const get = () => v
	fade.set(true, get)
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	// копия кадра обновляется, пока камера показана (без rVFC — раз в 300 мс)
	const n = draws.length
	await vi.advanceTimersByTimeAsync(700)
	expect(draws.length).toBeGreaterThan(n)

	fade.set(false, get)
	expect(v.style.visibility).toBe('hidden')
	const snap = box.querySelector('.k4-vsnap')
	expect(snap.style.opacity).toBe('1')
	const frozen = draws.length
	await vi.advanceTimersByTimeAsync(600)
	fade.set(false, get) // сам выкл через 0,6 с после сигнала
	expect(draws.length).toBe(frozen) // снимок не переснят с выключенного трека
	await vi.advanceTimersByTimeAsync(FADE_MS - 600 + 50)
	expect(fade.state.shown).toBe(false) // угасание кончилось через 1 с от первого сигнала
	expect(snap.style.opacity).toBe('0')
	expect(v.style.visibility).toBe('')
})

test('NAS_CLOUD#279 п.3: rVFC не стреляет — плитка проявляется по ходу currentTime, а не через 5 с', async () => {
	vi.useFakeTimers()
	const vproto = window.HTMLVideoElement.prototype
	vi.spyOn(vproto, 'videoWidth', 'get').mockReturnValue(640)
	vi.spyOn(vproto, 'videoHeight', 'get').mockReturnValue(360)
	vi.spyOn(vproto, 'readyState', 'get').mockReturnValue(4)
	let ct = 0
	vi.spyOn(vproto, 'currentTime', 'get').mockImplementation(() => ct)
	vproto.play = () => Promise.resolve()
	vproto.requestVideoFrameCallback = () => 0 // молчит
	vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data: new Array(256).fill(200) }) })
	const v = document.createElement('video')
	document.createElement('div').append(v)
	const fade = useK4VideoFade()
	fade.set(true, () => v)
	await vi.advanceTimersByTimeAsync(200)
	expect(fade.state.opaque).toBe(false) // время стоит — кадр старый
	ct = 0.1
	await vi.advanceTimersByTimeAsync(100)
	expect(fade.state.opaque).toBe(true)
	delete vproto.requestVideoFrameCallback
})

test('NAS_CLOUD#159: смена потока на той же плитке - старый кадр держится поверх, пока новый не дал первый целый кадр', async () => {
	vi.useFakeTimers()
	const vproto = window.HTMLVideoElement.prototype
	vi.spyOn(vproto, 'videoWidth', 'get').mockReturnValue(640)
	vi.spyOn(vproto, 'videoHeight', 'get').mockReturnValue(360)
	let ready = 4
	vi.spyOn(vproto, 'readyState', 'get').mockImplementation(() => ready)
	vproto.play = () => Promise.resolve()
	vproto.pause = () => {}
	vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data: new Array(256).fill(200) }) })
	const box = document.createElement('div')
	const v = document.createElement('video')
	let frame = null
	v.requestVideoFrameCallback = (f) => {
		frame = f
	}
	box.append(v)
	const fade = useK4VideoFade()
	const get = () => v
	fade.set(true, get)
	frame?.()
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	expect(fade.state.opaque).toBe(true)
	const snap = box.querySelector('.k4-vsnap')

	fade.swap(get)
	expect(snap.style.opacity).toBe('1')
	ready = 0 // подмена srcObject: пустое поле
	await vi.advanceTimersByTimeAsync(200)
	expect(snap.style.opacity).toBe('1') // нового кадра ещё нет - старый на месте
	ready = 4
	const f = frame
	frame = null
	f?.() // старый колбэк keeper не в счёт, ждём тот, что поставил swap
	await vi.advanceTimersByTimeAsync(40)
	frame?.()
	await vi.advanceTimersByTimeAsync(100)
	expect(snap.style.opacity).toBe('0') // новый кадр пришёл - снимок снят сразу
})

test('NAS_CLOUD#159: поток не пришёл - старый кадр не висит дольше 0,8 с', async () => {
	vi.useFakeTimers()
	const vproto = window.HTMLVideoElement.prototype
	vi.spyOn(vproto, 'videoWidth', 'get').mockReturnValue(640)
	vi.spyOn(vproto, 'videoHeight', 'get').mockReturnValue(360)
	vi.spyOn(vproto, 'readyState', 'get').mockReturnValue(4)
	vproto.play = () => Promise.resolve()
	vproto.pause = () => {}
	vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data: new Array(256).fill(200) }) })
	const box = document.createElement('div')
	const v = document.createElement('video')
	box.append(v)
	const fade = useK4VideoFade()
	const get = () => v
	fade.set(true, get)
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	const snap = box.querySelector('.k4-vsnap')
	fade.swap(get)
	expect(snap.style.opacity).toBe('1')
	await vi.advanceTimersByTimeAsync(900)
	expect(snap.style.opacity).toBe('0')
})

// ket4tec (NAS_CLOUD#159, ревью #78): поколения смены потока и запасной путь по currentTime
function swapRig() {
	vi.useFakeTimers()
	const vproto = window.HTMLVideoElement.prototype
	vi.spyOn(vproto, 'videoWidth', 'get').mockReturnValue(640)
	vi.spyOn(vproto, 'videoHeight', 'get').mockReturnValue(360)
	const rig = { ready: 4, ct: 0, cbs: new Map(), id: 0, cancelled: [], draws: 0 }
	vi.spyOn(vproto, 'readyState', 'get').mockImplementation(() => rig.ready)
	vi.spyOn(vproto, 'currentTime', 'get').mockImplementation(() => rig.ct)
	vproto.play = () => Promise.resolve()
	vproto.pause = () => {}
	vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => rig.draws++, getImageData: () => ({ data: new Array(256).fill(200) }) })
	const box = document.createElement('div')
	const v = document.createElement('video')
	v.requestVideoFrameCallback = (f) => {
		rig.cbs.set(++rig.id, f)
		return rig.id
	}
	v.cancelVideoFrameCallback = (id) => {
		rig.cancelled.push(id)
		rig.cbs.delete(id)
	}
	box.append(v)
	const fade = useK4VideoFade()
	const get = () => v
	// следующий кадр: все ожидающие rVFC срабатывают
	rig.fire = () => {
		const all = [...rig.cbs.values()]
		rig.cbs.clear()
		all.forEach((f) => f())
	}
	return { rig, fade, get, snap: () => box.querySelector('.k4-vsnap') }
}

test('NAS_CLOUD#159 (#78 п.1): A->B->A быстрее 0,8 с - прежний опрос отменён, снимок не снимается раньше времени и не переснимается пустым', async () => {
	const { rig, fade, get, snap } = swapRig()
	fade.set(true, get)
	await vi.advanceTimersByTimeAsync(10)
	rig.fire()
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	expect(fade.state.opaque).toBe(true)

	fade.swap(get) // A -> B
	await vi.advanceTimersByTimeAsync(20) // первый опрос поставил rVFC поколения 1
	expect(snap().style.opacity).toBe('1')
	const first = [...rig.cbs.keys()].pop()

	rig.ready = 0 // подмена: пустое поле, кадра нет
	await vi.advanceTimersByTimeAsync(300)
	const drawn = rig.draws
	fade.swap(get) // B -> A: keep() уже не получится (кадра нет) - снимок всё равно держится
	expect(snap().style.opacity).toBe('1')
	expect(rig.cancelled).toContain(first) // rVFC первого поколения отменён
	expect(rig.draws).toBe(drawn) // пустое поле в снимок не рисовали

	rig.ready = 4
	rig.fire() // кадр пришёл до того, как поставлен rVFC второго поколения
	await vi.advanceTimersByTimeAsync(20)
	expect(snap().style.opacity).toBe('1') // прежний опрос не снял снимок: нужен кадр после второй смены
	rig.fire()
	await vi.advanceTimersByTimeAsync(60)
	expect(snap().style.opacity).toBe('0')
})

test('NAS_CLOUD#159 (#78 п.2): rVFC есть, но молчит (Safari на подмене srcObject) - новый кадр виден по currentTime, снимок не висит 0,8 с', async () => {
	const { rig, fade, get, snap } = swapRig()
	fade.set(true, get)
	await vi.advanceTimersByTimeAsync(10)
	rig.fire()
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	fade.swap(get)
	await vi.advanceTimersByTimeAsync(20)
	expect(snap().style.opacity).toBe('1')
	await vi.advanceTimersByTimeAsync(200)
	expect(snap().style.opacity).toBe('1') // время стоит - кадра нет
	rig.ct = 0.04 // время пошло, rVFC так и не сработал
	await vi.advanceTimersByTimeAsync(100)
	expect(snap().style.opacity).toBe('0')
	expect(rig.cancelled.length).toBeGreaterThan(0) // ожидавший rVFC отменён при завершении
})

test('NAS_CLOUD#159 (#78): set() и размонтирование отменяют смену потока', async () => {
	const { rig, fade, get, snap } = swapRig()
	fade.set(true, get)
	await vi.advanceTimersByTimeAsync(10)
	rig.fire()
	await vi.advanceTimersByTimeAsync(FADE_MS + 100)
	fade.swap(get)
	await vi.advanceTimersByTimeAsync(20)
	const pending = [...rig.cbs.keys()].pop()
	fade.set(false, get)
	expect(rig.cancelled).toContain(pending)
	await vi.advanceTimersByTimeAsync(50)
	expect(snap().style.opacity).toBe('1') // угасание ведёт set(), старый опрос его не сбил
})
