/**
 * ket4tec (NAS_CLOUD#195): кнопки по тапу, раскладка полосы по числу, «нет связи», общий знак переподключения.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ConnectionState } from '../../../utils/webrtc/models/CallParticipantModel.js'
import { peerLost, phoneStrip, selfLost, useTapReveal } from './k4peer.js'

describe('useTapReveal', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test('первый тап показывает, через 3 с прячет', () => {
		const tap = useTapReveal()
		expect(tap.shown.value).toBe(false)
		tap.toggle()
		expect(tap.shown.value).toBe(true)
		vi.advanceTimersByTime(2999)
		expect(tap.shown.value).toBe(true)
		vi.advanceTimersByTime(1)
		expect(tap.shown.value).toBe(false)
	})

	test('второй тап прячет сразу, таймер не срабатывает повторно', () => {
		const tap = useTapReveal()
		tap.toggle()
		tap.toggle()
		expect(tap.shown.value).toBe(false)
		tap.toggle()
		vi.advanceTimersByTime(2000)
		expect(tap.shown.value).toBe(true)
	})
})

describe('phoneStrip', () => {
	test.each([
		[1, 120, 1],
		[3, 120, 1],
		[4, 110, 2],
		[6, 110, 2],
		[7, 110, 2],
		[12, 110, 2],
	])('%i плиток → квадрат %i, видно рядов %i', (n, sq, rows) => {
		expect(phoneStrip(n)).toEqual({ sq, rows })
	})
})

describe('peerLost', () => {
	const at = (o) => ({ connectedAtLeastOnce: true, initialConnection: false, negotiating: false, connecting: false, connectionState: ConnectionState.CONNECTED, ...o })

	test('ещё не соединялись — не «нет связи»', () => {
		expect(peerLost({ connectedAtLeastOnce: false, connectionState: ConnectionState.FAILED })).toBe(false)
	})
	test('соединены — связь есть', () => {
		expect(peerLost(at({}))).toBe(false)
		expect(peerLost(at({ connectionState: ConnectionState.COMPLETED }))).toBe(false)
	})
	test.each([ConnectionState.DISCONNECTED, ConnectionState.DISCONNECTED_LONG, ConnectionState.FAILED, ConnectionState.FAILED_NO_RESTART])('после соединения %s → нет связи', (s) => {
		expect(peerLost(at({ connectionState: s }))).toBe(true)
	})
	test('переподключение после соединения → нет связи', () => {
		expect(peerLost(at({ connectionState: ConnectionState.CHECKING, connecting: true }))).toBe(true)
	})
})

describe('selfLost: один общий знак, а не по плиткам', () => {
	test('сигнальный сокет, офлайн, свой peer', () => {
		expect(selfLost({ sigDown: true })).toBe(true)
		expect(selfLost({ offline: true })).toBe(true)
		expect(selfLost({ localLost: true })).toBe(true)
	})
	test('пропали все ≥2 собеседника — дело во мне', () => {
		expect(selfLost({ peers: [true, true] })).toBe(true)
		expect(selfLost({ peers: [true, false] })).toBe(false)
	})
	test('один собеседник пропал — это его шум, не мой знак', () => {
		expect(selfLost({ peers: [true] })).toBe(false)
		expect(selfLost({})).toBe(false)
	})
})
