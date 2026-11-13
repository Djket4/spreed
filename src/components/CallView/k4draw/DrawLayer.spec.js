/*
 * ket4tec: k4draw (NAS_CLOUD#108) — второе касание на показе (в т.ч. на поле вокруг кадра) отменяет штрих
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive } from 'vue'

const m = vi.hoisted(() => ({ start: vi.fn(() => ({ tool: 'marker', pts: [] })), cancel: vi.fn(), point: vi.fn(), cursor: vi.fn() }))

vi.mock('./useDrawing.js', () => {
	const state = reactive({ mode: true, tool: 'marker', board: null, big: null })
	return {
		amMod: () => false,
		canDraw: () => true,
		cursor: m.cursor,
		eraseMarks: vi.fn(),
		hash: () => 0,
		identity: () => ({}),
		join: () => () => {},
		laserLife: () => 1000,
		moveMark: vi.fn(),
		myColor: () => '#f00',
		myId: () => 'me',
		onDraw: () => () => {},
		ping: vi.fn(),
		reducedMotion: () => true,
		showOf: () => ({ marks: new Map(), cols: {} }),
		SP: {},
		state,
		strokeCancel: m.cancel,
		strokeEnd: vi.fn(),
		strokePoint: m.point,
		strokeStart: m.start,
		textPut: vi.fn(),
	}
})

const DrawLayer = (await import('./DrawLayer.vue')).default

const video = { videoWidth: 1280, videoHeight: 720, clientWidth: 1280, clientHeight: 720, addEventListener() {}, removeEventListener() {} }

/**
 * @param el цель
 * @param type тип
 * @param props поля события
 */
function fire(el, type, props) {
	const e = new Event(type, { bubbles: true })
	Object.assign(e, props)
	el.dispatchEvent(e)
}

describe('DrawLayer: второе касание', () => {
	let w, ink, box, field
	beforeEach(() => {
		globalThis.ResizeObserver ??= class { observe() {} disconnect() {} }
		box = document.createElement('div')
		document.body.appendChild(box)
		w = mount(DrawLayer, { props: { presenter: 'p', video }, attachTo: box })
		field = document.createElement('div') // поле вокруг кадра: в контейнере показа, но не на .k4-ink
		w.element.parentElement.appendChild(field)
		ink = w.find('.k4-ink').element
		w.find('.k4-surf').element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 })
		Object.values(m).forEach((f) => f.mockClear())
	})
	afterEach(() => {
		w.unmount()
		box.remove()
	})

	test('палец на кадре + палец на поле: штрих отменён, оставшийся палец не рисует и не шлёт курсор', () => {
		const t1 = { target: ink, touchType: 'direct' }
		fire(ink, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 })
		fire(ink, 'touchstart', { touches: [t1] })
		expect(m.start).toHaveBeenCalledTimes(1)
		const t2 = { target: field, touchType: 'direct' }
		fire(field, 'touchstart', { touches: [t1, t2], changedTouches: [t2] })
		expect(m.cancel).toHaveBeenCalledTimes(1)
		// второй палец отпущен, первый ещё на стекле
		fire(field, 'touchend', { touches: [t1] })
		fire(ink, 'pointermove', { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 200 })
		expect(m.point).not.toHaveBeenCalled()
		fire(ink, 'pointerup', { pointerType: 'touch', pointerId: 1 })
		fire(ink, 'pointermove', { pointerType: 'touch', pointerId: 1, clientX: 210, clientY: 210 })
		expect(m.cursor).not.toHaveBeenCalled()
		// полное отпускание: новый штрих снова рисуется
		fire(ink, 'touchend', { touches: [] })
		fire(ink, 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 100 })
		expect(m.start).toHaveBeenCalledTimes(1 + 1)
	})

	test('второй палец вне контейнера показа (grid-main-wrapper) отменяет штрих и отдаёт жест зуму', () => {
		const t1 = { target: ink, touchType: 'direct' }
		fire(ink, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 })
		fire(ink, 'touchstart', { touches: [t1] })
		const t2 = { target: document.body, touchType: 'direct' }
		fire(document.body, 'touchstart', { touches: [t1, t2], changedTouches: [t2] })
		expect(m.cancel).toHaveBeenCalledTimes(1)
		fire(ink, 'pointermove', { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 200 })
		expect(m.point).not.toHaveBeenCalled()
	})

	test('держатель лежит вне показа до штриха: штрих рисуется', () => {
		const hold = { target: document.body, touchType: 'direct' }
		const t1 = { target: ink, touchType: 'direct' }
		fire(document.body, 'touchstart', { touches: [hold], changedTouches: [hold] })
		fire(ink, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 })
		fire(ink, 'touchstart', { touches: [hold, t1], changedTouches: [t1] })
		expect(m.cancel).not.toHaveBeenCalled()
		fire(ink, 'pointermove', { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 200 })
		expect(m.point).toHaveBeenCalled()
	})
})
